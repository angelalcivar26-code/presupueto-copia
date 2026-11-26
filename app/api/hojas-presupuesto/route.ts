import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { tomarInstantanea } from "../../../lib/instantaneas";
import { ejercicioDe, ejercicioPorDefecto } from "../../../lib/ejercicio-pedido";


/**
 * Lista las hojas de un grupo de cuenta dentro de un ejercicio: une las hojas
 * creadas explícitamente (tabla hojas_presupuesto) con los nombres de
 * departamento que YA tengan cuentas cargadas de ese grupo en
 * presupuesto_departamental para ese mismo ejercicio.
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const grupo = req.nextUrl.searchParams.get("grupo");
    const ejercicio = await ejercicioDe(req);
    if (!grupo) {
      return NextResponse.json({ error: "Falta el parámetro grupo" }, { status: 400 });
    }

    const [creadas, existentes] = await Promise.all([
      db.execute({ sql: `SELECT DISTINCT nombre FROM hojas_presupuesto WHERE grupo = ? AND ejercicio = ?`, args: [grupo, ejercicio] }),
      db.execute({
        sql: `SELECT DISTINCT departamento AS nombre FROM presupuesto_departamental WHERE concepto LIKE ? AND ejercicio = ?`,
        args: [`${grupo}%`, ejercicio],
      }),
    ]);

    const nombres = new Set<string>();
    for (const r of creadas.rows) nombres.add(r.nombre as string);
    for (const r of existentes.rows) nombres.add(r.nombre as string);

    return NextResponse.json({ hojas: Array.from(nombres).sort() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo las hojas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { grupo, nombre, ejercicio } = body;
    if (!grupo || !nombre) {
      return NextResponse.json({ error: "Faltan campos: grupo y nombre son obligatorios" }, { status: 400 });
    }

    const res = await db.execute({
      sql: `INSERT INTO hojas_presupuesto (grupo, nombre, ejercicio) VALUES (?, ?, ?)`,
      args: [grupo, nombre, ejercicio ?? (await ejercicioPorDefecto())],
    });

    return NextResponse.json({ id: Number(res.lastInsertRowid) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error creando la hoja" }, { status: 500 });
  }
}

/**
 * Renombra una hoja dentro de un ejercicio: actualiza la fila de seguimiento,
 * las cuentas de presupuesto_departamental de ESTE grupo y ejercicio, y las
 * líneas de Resumen institucional de ese mismo ejercicio que usaban el
 * nombre viejo.
 */
export async function PATCH(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { grupo, nombreActual, nombreNuevo, ejercicio } = body;
    const ejercicioFinal = ejercicio ?? (await ejercicioPorDefecto());
    if (!grupo || !nombreActual || !nombreNuevo) {
      return NextResponse.json({ error: "Faltan campos: grupo, nombreActual y nombreNuevo son obligatorios" }, { status: 400 });
    }

    // Un nombre que ya existe en el grupo fusionaría dos hojas sin aviso
    const existe = await db.execute({ sql: `SELECT 1 FROM hojas_presupuesto WHERE grupo = ? AND nombre = ? AND ejercicio = ? LIMIT 1`, args: [grupo, nombreNuevo, ejercicioFinal] });
    if (existe.rows.length && String(nombreNuevo) !== String(nombreActual)) {
      return NextResponse.json({ error: `Ya existe una hoja «${nombreNuevo}» en este grupo. Elija otro nombre.` }, { status: 400 });
    }
    // Las tres tablas en un solo lote: o se renombra todo o nada. Las líneas institucionales que cambian son
    // las que usan las cuentas de ESTE grupo (antes se renombraban las de todos los grupos con ese nombre).
    await db.batch([
      {
        sql: `UPDATE presupuesto_resumen SET departamento = ? WHERE departamento = ? AND ejercicio = ? AND id IN (
                SELECT resumen_id FROM presupuesto_departamental WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ? AND resumen_id IS NOT NULL)`,
        args: [nombreNuevo, nombreActual, ejercicioFinal, nombreActual, `${grupo}%`, ejercicioFinal],
      },
      {
        sql: `UPDATE hojas_presupuesto SET nombre = ? WHERE grupo = ? AND nombre = ? AND ejercicio = ?`,
        args: [nombreNuevo, grupo, nombreActual, ejercicioFinal],
      },
      {
        sql: `UPDATE presupuesto_departamental SET departamento = ? WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ?`,
        args: [nombreNuevo, nombreActual, `${grupo}%`, ejercicioFinal],
      },
    ], "write");

    return NextResponse.json({ renombrada: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error renombrando la hoja" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getDb();
    const grupo = req.nextUrl.searchParams.get("grupo");
    const nombre = req.nextUrl.searchParams.get("nombre");
    const ejercicio = await ejercicioDe(req);
    if (!grupo || !nombre) {
      return NextResponse.json({ error: "Faltan parámetros: grupo y nombre son obligatorios" }, { status: 400 });
    }

    // Copia de todo lo que se va a borrar (restaurable desde la Bitácora). Sin copia no se elimina.
    await tomarInstantanea(`Hoja «${nombre}» (grupo ${grupo}, ejercicio ${ejercicio}) con sus cuentas en las 10 agencias`, [
      { tabla: "hojas_presupuesto", where: "grupo = ? AND nombre = ? AND ejercicio = ?", args: [grupo, nombre, ejercicio] },
      { tabla: "presupuesto_departamental", where: "departamento = ? AND concepto LIKE ? AND ejercicio = ?", args: [nombre, `${grupo}%`, ejercicio] },
      {
        tabla: "presupuesto_resumen",
        where: `departamento = ? AND ejercicio = ? AND id IN (SELECT resumen_id FROM presupuesto_departamental WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ? AND resumen_id IS NOT NULL)`,
        args: [nombre, ejercicio, nombre, `${grupo}%`, ejercicio],
      },
    ]);
    // Un solo lote: la hoja, sus cuentas en las 10 agencias y las líneas institucionales que usaban esas
    // cuentas (antes quedaban sueltas). O se borra todo o nada.
    await db.batch([
      {
        sql: `DELETE FROM presupuesto_resumen WHERE departamento = ? AND ejercicio = ? AND id IN (
                SELECT resumen_id FROM presupuesto_departamental WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ? AND resumen_id IS NOT NULL)`,
        args: [nombre, ejercicio, nombre, `${grupo}%`, ejercicio],
      },
      { sql: `DELETE FROM presupuesto_departamental WHERE departamento = ? AND concepto LIKE ? AND ejercicio = ?`, args: [nombre, `${grupo}%`, ejercicio] },
      { sql: `DELETE FROM hojas_presupuesto WHERE grupo = ? AND nombre = ? AND ejercicio = ?`, args: [grupo, nombre, ejercicio] },
    ], "write");

    return NextResponse.json({ eliminada: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error eliminando la hoja" }, { status: 500 });
  }
}