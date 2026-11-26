import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { CODIGOS_ER_ANALISIS, type RealOficina } from "../../../lib/calc/analisis-agencia";

/**
 * ANÁLISIS DE AGENCIA (Planificación): la situación real de cada oficina para compararla con el presupuesto 2027.
 * Por oficina, del último mes cargado en Históricos:
 *  - er: estado de resultados ACUMULADO del año a ese mes (solo las cuentas que usa el análisis);
 *  - prom: saldos promedio de diciembre del año anterior al mes (misma convención que el Diagnóstico).
 */
const BAL = ["21", "2103", "1908", "2908"];

async function leerGET(_req: NextRequest) {
  try {
    const db = getDb();
    const ult = await db.execute(`SELECT MAX(periodo) AS p FROM historico_cuentas WHERE tipo = 'ER'`);
    const p0 = String(ult.rows[0]?.p ?? "");
    if (!p0) return NextResponse.json({ oficinas: {} });
    const desde = `${Number(p0.slice(0, 4)) - 1}-12`;
    // tres lecturas por código (índice tipo+código): solo las filas que se usan, no todo el año de todas las cuentas
    const sel = `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas`;
    const partes = await Promise.all([
      db.execute({ sql: `${sel} WHERE tipo = 'BAL' AND codigo IN (${BAL.map(() => "?").join(",")}) AND periodo >= ? AND oficina <> 'Consolidado'`, args: [...BAL, desde] }),
      db.execute({ sql: `${sel} WHERE tipo = 'BAL' AND codigo >= '14' AND codigo < '15' AND LENGTH(codigo) = 4 AND periodo >= ? AND oficina <> 'Consolidado'`, args: [desde] }),
      db.execute({ sql: `${sel} WHERE tipo = 'ER' AND codigo IN (${CODIGOS_ER_ANALISIS.map(() => "?").join(",")}) AND periodo >= ? AND oficina <> 'Consolidado'`, args: [...CODIGOS_ER_ANALISIS, desde] }),
    ]);
    const r = { rows: partes.flatMap((x) => x.rows) };
    // oficina → periodo → tipo → cuentas
    const t: Record<string, Record<string, { BAL?: Record<string, number>; ER?: Record<string, number> }>> = {};
    for (const x of r.rows) {
      const o = String(x.oficina), per = String(x.periodo), tipo = String(x.tipo) as "BAL" | "ER";
      ((t[o] ??= {})[per] ??= {})[tipo] = { ...(t[o][per][tipo] ?? {}), [String(x.codigo)]: Number(x.valor) || 0 };
    }
    const oficinas: Record<string, RealOficina> = {};
    for (const [o, porPer] of Object.entries(t)) {
      // último mes del año en curso con estado de resultados
      const p = Object.keys(porPer).filter((k) => k > desde && porPer[k].ER).sort().pop();
      if (!p) continue;
      const y = p.slice(0, 4), k = Number(p.slice(5, 7));
      const meses = [`${Number(y) - 1}-12`, ...Array.from({ length: k }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`)].filter((m) => porPer[m]?.BAL);
      const bal = (f: (b: Record<string, number>) => number) => (meses.length ? meses.reduce((s, m) => s + f(porPer[m].BAL!), 0) / meses.length : 0);
      const cartera = (b: Record<string, number>, desdeRiesgo: boolean) => Object.entries(b)
        .reduce((s, [c, v]) => (c.length === 4 && c.startsWith("14") && c !== "1499" && (desdeRiesgo ? Number(c.slice(2)) >= 25 : Number(c.slice(2)) < 25) ? s + v : s), 0);
      oficinas[o] = {
        periodo: p, k, saldosPromediados: meses.length,
        er: porPer[p].ER ?? {},
        prom: {
          porVencer: bal((b) => cartera(b, false)), enRiesgo: bal((b) => cartera(b, true)),
          captaciones: bal((b) => b["21"] ?? 0), dpf: bal((b) => b["2103"] ?? 0),
          envia: bal((b) => b["1908"] ?? 0), recibe: bal((b) => b["2908"] ?? 0),
        },
      };
    }
    return NextResponse.json({ oficinas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los históricos para el análisis" }, { status: 500 });
  }
}
export const GET = conCacheGET("analisis-agencia", leerGET);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
