import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import type { FilaRecuperacion } from "../../../lib/recuperacion-parser";

/**
 * Recuperación de cartera vigente y vencida por oficina y mes (reporte del sistema de cartera).
 * GET (?agencia=X) → { filas } · POST { filas } → reemplaza cada oficina, mes y tipo que llega.
 */
async function tabla(db: ReturnType<typeof getDb>) {
  await db.execute(`CREATE TABLE IF NOT EXISTS recuperacion_cartera (
    oficina TEXT NOT NULL, periodo TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('VIGENTE','VENCIDO')),
    operaciones REAL, saldo REAL, capital REAL, castigado REAL, recuperado REAL, precancelados REAL, refinanciado REAL, neto REAL,
    PRIMARY KEY (oficina, periodo, tipo))`);
}

async function leerGET(req: NextRequest) {
  try {
    const db = getDb(); await tabla(db);
    const ag = req.nextUrl.searchParams.get("agencia");
    const r = ag
      ? await db.execute({ sql: `SELECT * FROM recuperacion_cartera WHERE oficina = ? ORDER BY periodo, tipo`, args: [ag] })
      : await db.execute(`SELECT * FROM recuperacion_cartera ORDER BY periodo, oficina, tipo`);
    return NextResponse.json({ filas: r.rows.map((x) => ({ ...x })) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error leyendo la recuperación de cartera" }, { status: 500 });
  }
}
export const GET = conCacheGET("recuperacion-cartera", leerGET);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filas = (body.filas ?? []) as FilaRecuperacion[];
    if (!filas.length) return NextResponse.json({ error: "No llegaron filas." }, { status: 400 });
    const db = getDb(); await tabla(db);
    await db.batch(filas.map((f) => ({
      sql: `INSERT INTO recuperacion_cartera (oficina, periodo, tipo, operaciones, saldo, capital, castigado, recuperado, precancelados, refinanciado, neto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(oficina, periodo, tipo) DO UPDATE SET operaciones = excluded.operaciones, saldo = excluded.saldo, capital = excluded.capital,
              castigado = excluded.castigado, recuperado = excluded.recuperado, precancelados = excluded.precancelados,
              refinanciado = excluded.refinanciado, neto = excluded.neto`,
      args: [f.oficina, f.periodo, f.tipo, f.operaciones, f.saldo, f.capital, f.castigado, f.recuperado, f.precancelados, f.refinanciado, f.neto],
    })), "write");
    return NextResponse.json({ ok: true, filas: filas.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error guardando la recuperación de cartera" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
