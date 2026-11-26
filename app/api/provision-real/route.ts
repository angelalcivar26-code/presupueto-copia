import { NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { AGENCIAS_CONSOLIDADO } from "../../../lib/consolidado";
import { CODIGOS_CARTERA } from "../../../lib/calc/orquestador";
import { leerConfig } from "../../../lib/provision-flow-db";

/**
 * GET → provisión real de las 10 agencias en los meses sin alivio del año (desde el inicio de la ventana de la provisión hasta
 * el último mes con ER de todas), para compararla con el modelo:
 * mes a mes 4402, 5604.10 y 5604.05 (valor del mes, desde el acumulado), provisión 1499, cartera en riesgo y bruta,
 * y los castigos implícitos (provisión anterior + 4402 − 5604.10 − provisión del mes).
 */
const RIESGO = Object.values(CODIGOS_CARTERA).flatMap((c) => c.enRiesgo);
const POR_VENCER = Object.values(CODIGOS_CARTERA).flatMap((c) => c.porVencer);
const ER = ["4402", "560410", "560405", "5104", "4", "5"];

async function leerGET() {
  try {
    const db = getDb();
    // último mes con el estado de resultados de todas las agencias (un mes con solo alguna no es un cierre)
    const ult = await db.execute(`SELECT MAX(periodo) AS p FROM (SELECT periodo FROM historico_cuentas WHERE tipo = 'ER' AND codigo = '4402' AND oficina <> 'Consolidado'
                                  GROUP BY periodo HAVING COUNT(DISTINCT oficina) >= ${AGENCIAS_CONSOLIDADO.length})`);
    const hasta = String(ult.rows[0]?.p ?? "");
    if (!hasta) return NextResponse.json({ agencias: [] });
    const anio = Number(hasta.slice(0, 4)), desde = `${anio - 1}-12`;
    // meses sin alivio: desde el inicio de la ventana de la provisión si es de este año; si no, desde enero
    const config = await leerConfig(db);
    const mesIni = config.ventanaDesde.startsWith(String(anio)) && config.ventanaDesde <= hasta ? Number(config.ventanaDesde.slice(5, 7)) : 1;
    const base = mesIni > 1 ? `${anio}-${String(mesIni - 1).padStart(2, "0")}` : desde;
    const cods = ["1499", "14", ...RIESGO, ...POR_VENCER];
    const r = await db.execute({
      sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas
            WHERE periodo >= ? AND periodo <= ? AND ((tipo = 'ER' AND codigo IN (${ER.map(() => "?").join(",")})) OR (tipo = 'BAL' AND codigo IN (${cods.map(() => "?").join(",")})))`,
      args: [desde, hasta, ...ER, ...cods],
    });
    const d: Record<string, Record<string, Record<string, number>>> = {};
    for (const x of r.rows) ((d[String(x.oficina)] ??= {})[`${x.tipo}:${x.periodo}`] ??= {})[String(x.codigo)] = Number(x.valor) || 0;
    const per = (m: number) => `${anio}-${String(m).padStart(2, "0")}`;
    const mesHasta = Number(hasta.slice(5));
    const agencias = AGENCIAS_CONSOLIDADO.map((ag) => {
      const a = d[ag] ?? {};
      const bal = (p: string) => a[`BAL:${p}`];
      const sum = (o: Record<string, number> | undefined, ks: string[]) => ks.reduce((t, k) => t + (o?.[k] ?? 0), 0);
      const meses = Array.from({ length: mesHasta }, (_, i) => i + 1).map((m) => {
        const p = per(m), p0 = m === 1 ? desde : per(m - 1);
        const er = a[`ER:${p}`], er0 = m === 1 ? undefined : a[`ER:${p0}`];
        const delMes = (k: string) => (er ? (er[k] ?? 0) - (er0?.[k] ?? 0) : null);
        const prov = bal(p) ? Math.abs(bal(p)!["1499"] ?? 0) : null, prov0 = bal(p0) ? Math.abs(bal(p0)!["1499"] ?? 0) : null;
        const g = delMes("4402"), rv = delMes("560410");
        return {
          p, g4402: g, r560410: rv, r560405: delMes("560405"), prov,
          riesgo: bal(p) ? sum(bal(p), RIESGO) : null, bruta: bal(p) ? sum(bal(p), RIESGO) + sum(bal(p), POR_VENCER) : null,
          castigos: g !== null && prov !== null && prov0 !== null ? prov0 + g - (rv ?? 0) - prov : null,
        };
      });
      // del inicio de la ventana al último mes: interés de cartera (5104), resultado (5 − 4) y cartera (14); el ER viene
      // acumulado del año: se resta el acumulado del mes anterior a la ventana (en enero no hay que restar)
      const erH = a[`ER:${hasta}`], erB = mesIni > 1 ? a[`ER:${base}`] : {}, balH = bal(hasta);
      const dif = (k: string) => (erH?.[k] ?? 0) - (erB?.[k] ?? 0);
      const acumulado = erH && erB ? {
        g4402: dif("4402"), r560410: dif("560410"), r560405: dif("560405"), i5104: dif("5104"),
        resultado: dif("5") - dif("4"), cartera: balH ? Math.abs(balH["14"] ?? 0) : null, prov: balH ? Math.abs(balH["1499"] ?? 0) : null,
      } : null;
      return { agencia: ag, prov0: bal(base) ? Math.abs(bal(base)!["1499"] ?? 0) : null, riesgo0: bal(base) ? sum(bal(base), RIESGO) : null, meses, acumulado };
    });
    // Calificación de Cartera del mismo mes (o la última anterior): saldo y provisión por calificación de cada agencia
    const cr = await db.execute({ sql: `SELECT MAX(periodo) AS p FROM provision_calificacion WHERE periodo <= ?`, args: [hasta] }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const corte = cr.rows[0]?.p ? String(cr.rows[0].p) : null;
    const calificacion: Record<string, Record<string, { saldo: number; prov: number; desde: number; hasta: number }>> = {};
    if (corte) {
      const q = await db.execute({ sql: `SELECT oficina, cat, SUM(saldo) AS saldo, SUM(prov) AS prov, MIN(desde) AS desde, MAX(hasta) AS hasta FROM provision_calificacion WHERE periodo = ? GROUP BY oficina, cat`, args: [corte] });
      const clave = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
      const porClave = new Map(AGENCIAS_CONSOLIDADO.map((a) => [clave(a), a]));
      for (const x of q.rows) {
        const ag = porClave.get(clave(String(x.oficina))); if (!ag) continue;
        const c = String(x.cat).trim().toUpperCase();
        (calificacion[ag] ??= {})[c] = { saldo: Number(x.saldo) || 0, prov: Number(x.prov) || 0, desde: Number(x.desde) || 0, hasta: Number(x.hasta) || 0 };
      }
    }
    return NextResponse.json({ anio, desde: `${anio}-${String(mesIni).padStart(2, "0")}`, hasta, agencias, corte, calificacion });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error leyendo la provisión real de las agencias" }, { status: 500 });
  }
}
export const GET = conCacheGET("provision-real", leerGET);
export const dynamic = "force-dynamic";
