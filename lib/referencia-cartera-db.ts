import type { getDb } from "./turso";
import { calcularRealidad, promLinea, LINEAS_ESTUDIO, type HistoricoEstudio } from "./calc/estudio-agencia";
import type { FilaParametroCredito } from "./calc/orquestador";
import type { ReferenciaCartera, Producto } from "./calc/provision-flow";
import { leerConfig } from "./provision-flow-db";

type Db = ReturnType<typeof getDb>;

/**
 * Comportamiento real de la cartera de la agencia (Históricos y reporte de recuperación), el mismo "ritmo real" del
 * Estudio de agencia: pase a riesgo por línea y recuperación de cartera vencida. Es la referencia del modelo de
 * provisión: con estos supuestos el modelo da la provisión calibrada; si el presupuesto supone más (o menos) pase a riesgo
 * o menos (o más) recuperación, la provisión sube (o baja) en esa proporción.
 */
export async function leerReferenciaCartera(db: Db, agencia: string, paramsCredito: FilaParametroCredito[]): Promise<ReferenciaCartera | null> {
  const real = await leerRealidadCartera(db, agencia, paramsCredito);
  if (!real) return null;
  const pase: Partial<Record<Producto, number>> = {};
  LINEAS_ESTUDIO.forEach((l, i) => { const v = real.lineas[i].pase; if (v !== null && v > 0) pase[l as Producto] = v; });
  // rv: solo lo neto recuperado de la vencida sobre el saldo en riesgo (las precancelaciones van aparte, en qv)
  const rv = real.rep?.rvNeto ?? null, cv = real.rep?.cv ?? null;
  return { pase, rv, cv, factorVencida: rv !== null && cv ? rv / cv : null, q: real.rep?.q ?? null, qv: real.rep?.qv ?? null, desde: real.base[0]?.p ?? real.desde, hasta: real.hasta };
}

/** Valores reales de cada parámetro de Cartera → Tasas y recuperación, por línea (fracciones; null = sin dato). */
export interface RealParametrosLinea {
  tasa_interes_anual: number | null; pct_recuperacion_periodo: number | null; tasa_efectividad_recup: number | null;
  pct_precancelacion: number | null; pct_pase_riesgo: number | null; tasa_recuperacion_vencida: number | null; pct_precancelacion_vencida: number | null;
}
export async function leerRealParametrosCredito(db: Db, agencia: string, paramsCredito: FilaParametroCredito[]): Promise<{ desde: string; hasta: string; lineas: Record<string, RealParametrosLinea> } | null> {
  const real = await leerRealidadCartera(db, agencia, paramsCredito);
  if (!real) return null;
  const rep = real.rep;
  const lineas = Object.fromEntries(LINEAS_ESTUDIO.map((l, i) => {
    const x = real.lineas[i];
    return [l, {
      tasa_interes_anual: x.tasa, pct_recuperacion_periodo: x.activa && rep ? rep.p : null, tasa_efectividad_recup: x.e,
      pct_precancelacion: x.activa && rep ? rep.q : null, pct_pase_riesgo: x.pase,
      // recuperación de vencida en la unidad del parámetro: % de las cuotas vencidas del mes (columna del reporte)
      tasa_recuperacion_vencida: x.activa && rep ? rep.cv : null, pct_precancelacion_vencida: x.activa && rep ? rep.qv : null,
    } satisfies RealParametrosLinea];
  }));
  return { desde: real.base[0]?.p ?? real.desde, hasta: real.hasta, lineas };
}

/** Ritmo real de la cartera de la agencia (Estudio de agencia) con los Históricos y el reporte de recuperación. */
async function leerRealidadCartera(db: Db, agencia: string, paramsCredito: FilaParametroCredito[]) {
  const ult = await db.execute({ sql: `SELECT MAX(periodo) AS p FROM historico_cuentas WHERE oficina = ? AND tipo = 'BAL'`, args: [agencia] });
  const p = String(ult.rows[0]?.p ?? "");
  if (!p) return null;
  const desde = `${Number(p.slice(0, 4)) - 1}-12`;
  const r = await db.execute({
    sql: `SELECT periodo, tipo, codigo, valor FROM historico_cuentas WHERE oficina = ? AND periodo >= ? AND (
            (tipo = 'BAL' AND (codigo = '1499' OR codigo LIKE '1499__' OR (codigo LIKE '14%' AND LENGTH(codigo) = 4))) OR
            (tipo = 'ER' AND (codigo IN ('4402', '560410', '5104', '510405', '510410', '510415', '510420', '510430', '510435', '510450') OR codigo LIKE '4402__')))`,
    args: [agencia, desde],
  });
  const h: HistoricoEstudio = { agencia, bal: {}, er: {}, rec: {} };
  for (const x of r.rows) ((String(x.tipo) === "BAL" ? h.bal : h.er)[String(x.periodo)] ??= {})[String(x.codigo)] = Number(x.valor) || 0;
  try {
    const rr = await db.execute({ sql: `SELECT periodo, tipo, saldo, capital, recuperado, precancelados, refinanciado, neto FROM recuperacion_cartera WHERE oficina = ? AND periodo >= ?`, args: [agencia, desde] });
    for (const x of rr.rows) ((h.rec![String(x.periodo)] ??= {}) as Record<string, unknown>)[String(x.tipo)] = {
      saldo: Number(x.saldo) || 0, capital: Number(x.capital) || 0, recuperado: Number(x.recuperado) || 0,
      precancelados: Number(x.precancelados) || 0, refinanciado: Number(x.refinanciado) || 0, neto: Number(x.neto) || 0,
    };
  } catch { /* sin reporte de recuperación */ }
  const pRec = LINEAS_ESTUDIO.map((l) => promLinea(paramsCredito, l, (x) => x.pct_recuperacion_periodo) || 1 / 36);
  const rvPres = LINEAS_ESTUDIO.map((l) => promLinea(paramsCredito, l, (x) => x.tasa_recuperacion_vencida));
  // meses sin alivio: los mismos con que se mide el ritmo de atraso de la provisión (desde el inicio de su ventana);
  // los anteriores no entran (el alivio escondía el deterioro y el real saldría mejor de lo que es)
  const cfg = await leerConfig(db).catch(() => null);
  const desdeSinAlivio = cfg?.ventanaDesde ?? "";
  const excluir = desdeSinAlivio ? Object.keys(h.bal).filter((x) => x < desdeSinAlivio) : [];
  return calcularRealidad(h, { p: pRec, rv: rvPres, meta: 0, excluir, desde: desdeSinAlivio || undefined, hasta: cfg?.ventanaHasta });
}
