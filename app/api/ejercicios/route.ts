import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { exigirAdmin } from "../../../lib/autorizacion";
import { tomarInstantanea } from "../../../lib/instantaneas";
import { crearDatosDelEjercicio } from "../../../lib/copia-ejercicio";
import { monto, respuestaEntrada } from "../../../lib/validacion";

export async function GET() {
  try {
    const db = getDb();
    const res = await db.execute({ sql: `SELECT id, anio, nombre, estado, creado_en FROM ejercicios ORDER BY anio DESC` });
    return NextResponse.json({ ejercicios: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo los ejercicios" }, { status: 500 });
  }
}

/**
 * POST { anio, nombre, modo: "blanco" | "copiar", anioOrigen? }
 *
 * "blanco": solo crea la fila en ejercicios. No hay hojas ni cuentas —
 *   se van creando desde cero, igual que hoy.
 *
 * "copiar": además de crear la fila, copia de anioOrigen (en un solo lote):
 *   - hojas_presupuesto (mismo grupo, mismo nombre de hoja)
 *   - las cuentas prorrateadas siguen prorrateadas: su valor institucional
 *     (presupuesto_resumen, con su nota) y el reparto de cada agencia
 *   - las cuentas directas, con sus montos y nota, como punto de partida
 *     para revisar en el nuevo ejercicio.
 */
export async function POST(req: NextRequest) {
  try {
    const permiso = await exigirAdmin("crear ejercicios");
    if ("error" in permiso) return permiso.error;
    const body = await req.json();
    const { modo } = body;
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json({ error: "Falta el nombre del ejercicio." }, { status: 400 });
    const anio = monto(body.anio, "Año", { min: 2000, max: 2100, enteros: true });
    const anioOrigen = modo === "copiar" ? monto(body.anioOrigen, "Año de origen", { min: 2000, max: 2100, enteros: true }) : null;

    const db = getDb();
    // Un solo ejercicio por año: los datos se guardan por año, dos ejercicios del mismo año compartirían (y borrarían) cuentas.
    const existentes = await db.execute({ sql: `SELECT anio FROM ejercicios WHERE anio IN (?, ?)`, args: [anio, anioOrigen ?? anio] });
    if (existentes.rows.some((r) => Number(r.anio) === anio)) {
      return NextResponse.json({ error: `Ya existe un ejercicio ${anio}.` }, { status: 400 });
    }
    if (anioOrigen !== null && !existentes.rows.some((r) => Number(r.anio) === anioOrigen)) {
      return NextResponse.json({ error: `No existe el ejercicio ${anioOrigen} para copiar su estructura.` }, { status: 400 });
    }
    // Primero los parámetros propios del ejercicio (copia del año de origen, o en blanco): si fallan, no se crea.
    await crearDatosDelEjercicio(anio, anioOrigen);
    const res = await db.execute({
      sql: `INSERT INTO ejercicios (anio, nombre, estado) VALUES (?, ?, 'activo')`,
      args: [anio, nombre],
    });

    if (anioOrigen !== null) {
      // Todo en un solo lote: hojas, valores institucionales y cuentas (o queda completo o no queda nada)
      const lote: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO hojas_presupuesto (grupo, nombre, ejercicio) SELECT grupo, nombre, ? FROM hojas_presupuesto WHERE ejercicio = ?`,
          args: [anio, anioOrigen],
        },
        // Valores institucionales de las cuentas prorrateadas: mismos montos y nota de origen
        {
          sql: `INSERT INTO presupuesto_resumen (departamento, nombre, mes, monto, nota, ejercicio)
                SELECT departamento, nombre, mes, monto, nota, ? FROM presupuesto_resumen WHERE ejercicio = ? ORDER BY id`,
          args: [anio, anioOrigen],
        },
        // Cuentas prorrateadas: siguen prorrateadas, enlazadas a su valor institucional del nuevo ejercicio
        {
          sql: `INSERT INTO presupuesto_departamental
                  (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, resumen_id, origen, ejercicio, nota)
                SELECT pd.departamento, pd.concepto, pd.cuenta_nombre, pd.mes, pd.monto, pd.agencia_id, 'prorrateado',
                       (SELECT n.id FROM presupuesto_resumen n
                         WHERE n.ejercicio = ? AND n.departamento IS r.departamento AND n.nombre IS r.nombre AND n.mes IS r.mes
                         ORDER BY n.id LIMIT 1),
                       pd.origen, ?, pd.nota
                FROM presupuesto_departamental pd JOIN presupuesto_resumen r ON r.id = pd.resumen_id
                WHERE pd.ejercicio = ? AND pd.modo = 'prorrateado'`,
          args: [anio, anio, anioOrigen],
        },
        // Cuentas directas: con los montos y la nota del año que se copia, como punto de partida para revisar
        {
          sql: `INSERT INTO presupuesto_departamental
                  (departamento, concepto, cuenta_nombre, mes, monto, agencia_id, modo, resumen_id, origen, ejercicio, nota)
                SELECT departamento, concepto, cuenta_nombre, mes, monto, agencia_id, COALESCE(modo, 'directo'), NULL, origen, ?, nota
                FROM presupuesto_departamental
                WHERE ejercicio = ? AND NOT (COALESCE(modo, '') = 'prorrateado' AND resumen_id IS NOT NULL)`,
          args: [anio, anioOrigen],
        },
      ];
      await db.batch(lote, "write");
    }

    return NextResponse.json({ id: Number(res.lastInsertRowid) });
  } catch (err) {
    const r = respuestaEntrada(err); if (r) return r;
    console.error(err);
    return NextResponse.json({ error: "Error creando el ejercicio" }, { status: 500 });
  }
}

/** PATCH { id, nombre? , estado? } — renombrar, archivar o restaurar. */
export async function PATCH(req: NextRequest) {
  try {
    const permiso = await exigirAdmin("modificar ejercicios");
    if ("error" in permiso) return permiso.error;
    const body = await req.json();
    const { id, nombre, estado } = body;
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    if (!nombre && !estado) return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });

    const db = getDb();
    if (nombre) {
      await db.execute({ sql: `UPDATE ejercicios SET nombre = ? WHERE id = ?`, args: [nombre, id] });
    }
    if (estado) {
      if (estado !== "activo" && estado !== "archivado") {
        return NextResponse.json({ error: "estado debe ser 'activo' o 'archivado'" }, { status: 400 });
      }
      await db.execute({ sql: `UPDATE ejercicios SET estado = ? WHERE id = ?`, args: [estado, id] });
    }
    return NextResponse.json({ actualizado: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error actualizando el ejercicio" }, { status: 500 });
  }
}

/**
 * DELETE ?id=1 — eliminación DEFINITIVA. Solo debe llamarse desde la
 * papelera (un ejercicio ya archivado), nunca desde la tarjeta principal.
 * Borra en cascada sus hojas y todas sus cuentas/valores institucionales.
 */
export async function DELETE(req: NextRequest) {
  try {
    const permiso = await exigirAdmin("eliminar ejercicios");
    if ("error" in permiso) return permiso.error;
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

    const db = getDb();
    const ejercicioRes = await db.execute({ sql: `SELECT anio, estado FROM ejercicios WHERE id = ?`, args: [id] });
    if (ejercicioRes.rows.length === 0) {
      return NextResponse.json({ error: "Ejercicio no encontrado" }, { status: 404 });
    }
    const { anio, estado } = ejercicioRes.rows[0];
    if (estado !== "archivado") {
      return NextResponse.json({ error: "Solo se puede eliminar definitivamente un ejercicio ya archivado" }, { status: 400 });
    }

    // Si otro ejercicio usa el mismo año (registros antiguos), sus cuentas son las mismas: solo se quita esta ficha.
    const otro = await db.execute({ sql: `SELECT 1 FROM ejercicios WHERE anio = ? AND id <> ? LIMIT 1`, args: [anio as number, id] });
    if (otro.rows.length) {
      await db.execute({ sql: `DELETE FROM ejercicios WHERE id = ?`, args: [id] });
      return NextResponse.json({ eliminado: true, datosConservados: true });
    }
    // Copia completa del ejercicio (restaurable desde la Bitácora). Sin copia no se elimina.
    await tomarInstantanea(`Ejercicio ${anio} completo (hojas, cuentas y valores institucionales)`, [
      { tabla: "ejercicios", where: "id = ?", args: [id] },
      { tabla: "hojas_presupuesto", where: "ejercicio = ?", args: [anio as number] },
      { tabla: "presupuesto_resumen", where: "ejercicio = ?", args: [anio as number] },
      { tabla: "presupuesto_departamental", where: "ejercicio = ?", args: [anio as number] },
    ]);
    await db.batch(
      [
        { sql: `DELETE FROM presupuesto_departamental WHERE ejercicio = ?`, args: [anio as number] },
        { sql: `DELETE FROM presupuesto_resumen WHERE ejercicio = ?`, args: [anio as number] },
        { sql: `DELETE FROM hojas_presupuesto WHERE ejercicio = ?`, args: [anio as number] },
        { sql: `DELETE FROM ejercicios WHERE id = ?`, args: [id] },
      ],
      "write"
    );

    return NextResponse.json({ eliminado: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error eliminando el ejercicio" }, { status: 500 });
  }
}