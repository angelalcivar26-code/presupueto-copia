import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { AGENCIAS_CONSOLIDADO } from "../../../lib/consolidado";
import { cargarInsumosAgencia, resolverAgenciaId } from "../../../lib/insumos-agencia";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import {
  POLITICA_DEFECTO, aplicarPolitica, validarPolitica, vencimientoDelBalance, type PoliticaCaptaciones,
} from "../../../lib/calc/politica-captaciones";

/**
 * Política de captaciones (una regla para las 10 agencias), guardada por ejercicio.
 * GET ?ejercicio=2027 → { politica, guardada, agencias: [{ agencia, corte, saldos: {vista, crecer, dpf, a30}, venc, filas }] }
 * POST { accion: "aplicar", politica } → guarda la política y reemplaza los parámetros de captaciones de las 10 agencias
 *      (tasa, depósitos y retiros de vista y Crecer; vencimientos, renovación y tasa de DPF). Todo en una sola escritura.
 */
async function asegurarTabla(db: ReturnType<typeof getDb>) {
  await db.execute(`CREATE TABLE IF NOT EXISTS politica_captaciones (
    ejercicio INTEGER PRIMARY KEY, datos TEXT NOT NULL, actualizado_en TEXT
  )`);
}

async function leerPolitica(db: ReturnType<typeof getDb>, ejercicio: number): Promise<{ politica: PoliticaCaptaciones; guardada: boolean }> {
  await asegurarTabla(db);
  const r = await db.execute({ sql: `SELECT datos FROM politica_captaciones WHERE ejercicio = ?`, args: [ejercicio] });
  if (!r.rows.length) return { politica: { ...POLITICA_DEFECTO }, guardada: false };
  try { return { politica: { ...POLITICA_DEFECTO, ...JSON.parse(String(r.rows[0].datos)) }, guardada: true }; }
  catch { return { politica: { ...POLITICA_DEFECTO }, guardada: false }; }
}

async function estadoAgencias(ejercicio: number) {
  return Promise.all(AGENCIAS_CONSOLIDADO.map(async (agencia) => {
    const r = await cargarInsumosAgencia(agencia, ejercicio);
    if (!r.ok) throw new Error(`${agencia}: ${r.error}`);
    const s = r.insumos.saldos;
    const v = (c: string) => Math.abs(Number(s[c]) || 0);
    const saldos = { vista: v("21013505") + v("21013510") + v("21013535"), crecer: v("21013515"), dpf: v("2103"), a30: v("210305") };
    return { agencia, corte: r.insumos.corteSaldos, saldos, venc: vencimientoDelBalance(saldos.a30, saldos.dpf), filas: r.insumos.paramsCaptaciones };
  }));
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const ejercicio = await ejercicioDe(req);
    const [p, agencias] = await Promise.all([leerPolitica(db, ejercicio), estadoAgencias(ejercicio)]);
    return NextResponse.json({ ...p, agencias });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error leyendo la política de captaciones" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { accion?: string; politica?: PoliticaCaptaciones; ejercicio?: number };
    if (body.accion !== "aplicar" || !body.politica) return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
    const p: PoliticaCaptaciones = { ...POLITICA_DEFECTO, ...body.politica };
    const error = validarPolitica(p);
    if (error) return NextResponse.json({ error }, { status: 400 });
    const db = getDb();
    const ejercicio = await ejercicioDe(req, body);
    await asegurarTabla(db);
    const agencias = await estadoAgencias(ejercicio);
    const statements: { sql: string; args: (string | number | null)[] }[] = [];
    for (const a of agencias) {
      // la misma agencia que leen el presupuesto y la pantalla de parámetros
      const id = await resolverAgenciaId(db, a.agencia);
      for (const f of aplicarPolitica(a.filas, p, a.venc)) {
        statements.push({
          sql: `INSERT INTO parametros_captaciones (agencia_id, producto, mes, tasa_interes_anual, pct_ingresos, pct_retiros, pct_liquidez, pct_cancelaciones, ratio_renovaciones)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agencia_id, producto, mes) DO UPDATE SET tasa_interes_anual = excluded.tasa_interes_anual, pct_ingresos = excluded.pct_ingresos,
                  pct_retiros = excluded.pct_retiros, pct_liquidez = excluded.pct_liquidez, pct_cancelaciones = excluded.pct_cancelaciones, ratio_renovaciones = excluded.ratio_renovaciones`,
          args: [id, f.producto, f.mes, f.tasa_interes_anual, f.pct_ingresos, f.pct_retiros, f.pct_liquidez ?? 0, f.pct_cancelaciones, f.ratio_renovaciones],
        });
      }
    }
    statements.push({
      sql: `INSERT INTO politica_captaciones (ejercicio, datos, actualizado_en) VALUES (?, ?, datetime('now'))
            ON CONFLICT(ejercicio) DO UPDATE SET datos = excluded.datos, actualizado_en = excluded.actualizado_en`,
      args: [ejercicio, JSON.stringify(p)],
    });
    await db.batch(statements, "write");
    return NextResponse.json({ ok: true, agencias: agencias.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error aplicando la política de captaciones" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
