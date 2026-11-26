import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId } from "../../../lib/insumos-agencia";
import { LINEAS_PRODUCCION, asegurarTablaProduccion, leerParametrosProduccion, type LineaProduccion } from "../../../lib/parametros-produccion";

/** GET ?agencia=Matriz -> { parametros: { LINEA: { operacionesIniciales, creditosPorOficial } } } */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, req.nextUrl.searchParams.get("agencia") ?? "Matriz");
    return NextResponse.json({ parametros: await leerParametrosProduccion(db, agenciaId) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los parámetros de producción" }, { status: 500 });
  }
}

/** POST { agencia, lineas: { LINEA: { operacionesIniciales, creditosPorOficial } } } -> guarda todo en una sola transacción */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { agencia?: string; lineas?: Partial<Record<LineaProduccion, { operacionesIniciales?: number; creditosPorOficial?: number }>> };
    if (!body.lineas) return NextResponse.json({ error: "Faltan las líneas" }, { status: 400 });
    const db = getDb();
    await asegurarTablaProduccion(db);
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(body.agencia));

    const statements: { sql: string; args: (string | number)[] }[] = [];
    for (const l of LINEAS_PRODUCCION) {
      const e = body.lineas[l];
      if (!e) continue;
      const ops = Number(e.operacionesIniciales), cpo = Number(e.creditosPorOficial);
      if (!Number.isFinite(ops) || ops < 0 || !Number.isInteger(ops)) return NextResponse.json({ error: `${l}: las operaciones iniciales deben ser un número entero sin negativos` }, { status: 400 });
      if (!Number.isFinite(cpo) || cpo < 0) return NextResponse.json({ error: `${l}: los créditos por oficial no pueden ser negativos` }, { status: 400 });
      statements.push({
        sql: `INSERT INTO parametros_produccion (agencia_id, linea, operaciones_iniciales, creditos_por_oficial, actualizado_en)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(agencia_id, linea) DO UPDATE SET operaciones_iniciales = excluded.operaciones_iniciales,
                creditos_por_oficial = excluded.creditos_por_oficial, actualizado_en = excluded.actualizado_en`,
        args: [agenciaId, l, ops, cpo],
      });
    }
    if (statements.length) await db.batch(statements, "write");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando los parámetros de producción" }, { status: 500 });
  }
}