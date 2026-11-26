import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, ErrorEntrada, monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, agenciaNombre: string | null): Promise<number> {
  if (!agenciaNombre || agenciaNombre === "Matriz") {
    return getOrCreateMatrizId(db);
  }
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [agenciaNombre] });
  if (res.rows.length === 0) {
    throw new Error(`Agencia "${agenciaNombre}" no existe en la tabla agencias`);
  }
  return res.rows[0].id as number;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia");
    // Consolidado (solo lectura): planilla de las 10 agencias
    if (agenciaNombre === "Consolidado") {
      const r = await db.execute(`SELECT e.id, e.nombre, e.basico_2025, e.incremento_pct, e.movilizacion_anual, e.activo, a.nombre AS agencia
                                  FROM nomina_empleados e JOIN agencias a ON a.id = e.agencia_id
                                  WHERE e.activo = 1 ORDER BY a.codigo, e.nombre`);
      return NextResponse.json({ filas: r.rows, consolidado: true });
    }
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    const res = await db.execute({
      sql: `SELECT id, nombre, basico_2025, incremento_pct, movilizacion_anual, activo
            FROM nomina_empleados
            WHERE agencia_id = ? AND activo = 1
            ORDER BY nombre`,
      args: [agenciaId],
    });

    return NextResponse.json({ filas: res.rows });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo la planilla de empleados" }, { status: 500 });
  }
}

/** Datos de un empleado: nombre obligatorio, básico mayor a 0, incremento entre 0 y 50 % (en fracción), movilización ≥ 0. */
function empleadoValido(b: Record<string, unknown>) {
  const nombre = String(b.nombre ?? "").trim();
  if (!nombre) throw new ErrorEntrada("Falta el nombre del empleado.");
  return {
    nombre,
    basico_2025: validarMonto(b.basico_2025, `Básico de ${nombre}`, { min: 0.01 }),
    incremento_pct: validarMonto(b.incremento_pct ?? 0.04, `Incremento de ${nombre}`, { min: 0, max: 0.5 }),
    movilizacion_anual: validarMonto(b.movilizacion_anual, `Movilización de ${nombre}`, { min: 0, vacioCero: true }),
  };
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { agencia } = body;
    const e = empleadoValido(body);
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(agencia));

    const res = await db.execute({
      sql: `INSERT INTO nomina_empleados (agencia_id, nombre, basico_2025, incremento_pct, movilizacion_anual)
            VALUES (?, ?, ?, ?, ?)`,
      args: [agenciaId, e.nombre, e.basico_2025, e.incremento_pct, e.movilizacion_anual],
    });

    return NextResponse.json({ id: Number(res.lastInsertRowid) });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el empleado" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "Falta el id del empleado" }, { status: 400 });
    }
    const e = empleadoValido(body);

    const r = await db.execute({
      sql: `UPDATE nomina_empleados
            SET nombre = ?, basico_2025 = ?, incremento_pct = ?, movilizacion_anual = ?
            WHERE id = ?`,
      args: [e.nombre, e.basico_2025, e.incremento_pct, e.movilizacion_anual, id],
    });
    if (!r.rowsAffected) return NextResponse.json({ error: "El empleado ya no existe; recargue la página." }, { status: 404 });

    return NextResponse.json({ actualizado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error actualizando el empleado" }, { status: 500 });
  }
}

/**
 * PUT { empleados: [{ id, nombre, basico_2025, incremento_pct, movilizacion_anual }, ...] }
 * Guarda varios empleados en una sola llamada y un solo lote (modo "Editar planilla").
 * Solo se envían los que cambiaron.
 */
export async function PUT(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const lista = Array.isArray(body.empleados) ? body.empleados : [];
    // Todos se validan antes de grabar (ya no se descartan en silencio los que vienen sin nombre)
    const validos = (lista as Record<string, unknown>[]).filter((e) => e && e.id).map((e) => ({ id: e.id as number, ...empleadoValido(e) }));
    if (!validos.length) return NextResponse.json({ actualizados: 0 });
    await db.batch(validos.map((e) => ({
      sql: `UPDATE nomina_empleados SET nombre = ?, basico_2025 = ?, incremento_pct = ?, movilizacion_anual = ? WHERE id = ?`,
      args: [e.nombre, e.basico_2025, e.incremento_pct, e.movilizacion_anual, e.id],
    })), "write");
    return NextResponse.json({ actualizados: validos.length });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando la planilla" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getDb();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Falta el parámetro id" }, { status: 400 });
    }
    // Baja lógica (activo = 0) en vez de borrar la fila: conserva el historial
    // si algún día se necesita auditar quién salió de la planilla y cuándo.
    await db.execute({ sql: `UPDATE nomina_empleados SET activo = 0 WHERE id = ?`, args: [id] });
    return NextResponse.json({ eliminado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error eliminando el empleado" }, { status: 500 });
  }
}