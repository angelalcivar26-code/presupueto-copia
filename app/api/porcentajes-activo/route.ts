import { NextRequest, NextResponse } from "next/server";
import { getDb, getDbDirecto } from "../../../lib/turso";
import { calcularActivosYPorcentajesAgencias, guardarPorcentajesActivo } from "../../../lib/prorrateo";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET  -> % de asignación por agencia, con su detalle (activo del balance,
 *         cuenta 1908, base usada, fuente y valor de referencia guardado), y
 *         cuántas filas prorrateadas quedaron repartidas con otros %.
 * POST { accion: "recalcular", ejercicio } -> vuelve a repartir TODAS las
 *         filas prorrateadas del ejercicio (compras de activo fijo y gastos
 *         prorrateados) con los % actuales: monto de la agencia = monto
 *         institucional del mes × % de la agencia. En una sola transacción.
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const { detalle, porcentajes } = await calcularActivosYPorcentajesAgencias(db);
    const total = detalle.reduce((s, d) => s + d.base, 0);
    // los % del corte quedan guardados en la base (sin cambiar la versión de los datos)
    await guardarPorcentajesActivo(getDbDirecto(), detalle).catch((e) => console.error("[porcentajes-activo] no se pudieron guardar", e));

    // Filas prorrateadas que quedaron repartidas con % distintos a los actuales
    const filas = await db.execute({
      sql: `SELECT a.nombre AS agencia, pd.monto, pr.monto AS monto_institucional, pd.departamento, pd.concepto, pd.cuenta_nombre
            FROM presupuesto_departamental pd
            JOIN agencias a ON a.id = pd.agencia_id
            JOIN presupuesto_resumen pr ON pr.id = pd.resumen_id
            WHERE pd.modo = 'prorrateado' AND pd.ejercicio = ?`,
      args: [ejercicio],
    });
    const malas = filas.rows.filter((r) =>
      Math.abs((Number(r.monto) || 0) - (Number(r.monto_institucional) || 0) * (porcentajes[r.agencia as string] ?? 0)) > 0.01
    );
    // de qué son: departamento y cuenta, con cuántos valores y el monto institucional del año
    const grupos = new Map<string, { departamento: string; concepto: string; cuenta: string; valores: number }>();
    for (const r of malas) {
      const k = `${r.departamento}|${r.concepto}`;
      const g = grupos.get(k) ?? { departamento: String(r.departamento ?? ""), concepto: String(r.concepto ?? ""), cuenta: String(r.cuenta_nombre ?? ""), valores: 0 };
      g.valores++; grupos.set(k, g);
    }

    return NextResponse.json({ detalle, total, sumaPorcentajes: detalle.reduce((s, d) => s + d.porcentaje, 0), filasDesactualizadas: malas.length, desactualizadasPorCuenta: [...grupos.values()].sort((a, b) => a.departamento.localeCompare(b.departamento) || a.concepto.localeCompare(b.concepto)) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando los porcentajes de activo" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = (await req.json()) as { accion?: string; ejercicio?: number };
    if (body.accion !== "recalcular") return NextResponse.json({ error: "accion debe ser 'recalcular'" }, { status: 400 });
    const ejercicio = await ejercicioDe(req, body);

    const { porcentajes, detalle } = await calcularActivosYPorcentajesAgencias(db);
    await guardarPorcentajesActivo(db, detalle);
    const filas = await db.execute({
      sql: `SELECT pd.id, a.nombre AS agencia, pr.monto AS monto_institucional
            FROM presupuesto_departamental pd
            JOIN agencias a ON a.id = pd.agencia_id
            JOIN presupuesto_resumen pr ON pr.id = pd.resumen_id
            WHERE pd.modo = 'prorrateado' AND pd.ejercicio = ?`,
      args: [ejercicio],
    });
    const statements = filas.rows.map((r) => ({
      sql: `UPDATE presupuesto_departamental SET monto = ? WHERE id = ?`,
      args: [(Number(r.monto_institucional) || 0) * (porcentajes[r.agencia as string] ?? 0), r.id as number],
    }));
    if (statements.length) await db.batch(statements, "write");
    return NextResponse.json({ ok: true, filasActualizadas: statements.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error recalculando el reparto" }, { status: 500 });
  }
}