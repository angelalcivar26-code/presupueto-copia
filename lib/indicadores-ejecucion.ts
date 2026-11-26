/**
 * Indicadores de la Ejecución presupuestaria: presupuesto frente a real, con la diferencia en puntos porcentuales.
 * Lo comparten la pestaña Indicadores y las exportaciones (Excel y Word).
 */
import type { Indicadores } from "./calc/indicadores-presupuesto";
import { CATEGORIAS, pct, type Ind } from "./indicadores-categorias";

export interface DatosIndicadores { pres: Indicadores[]; real: (Indicadores | null)[] }


/** Solo los indicadores en porcentaje (los montos ya se comparan en el balance y el estado de resultados). */
export const GRUPOS = CATEGORIAS.map((c) => ({ ...c, indicadores: c.indicadores.filter((i) => i.formato === "pct" && !i.soloComparar) }));
export const TODOS = GRUPOS.flatMap((g) => g.indicadores);

export interface Comp { pres: number | null; real: number | null; dif: number | null; favorable: boolean | null }
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
export function compararInd(ind: Ind, d: DatosIndicadores, m: number): Comp {
  const p = d.pres[m], r = d.real[m];
  const pres = p ? num(ind.valor(p, null as never, m)) : null;
  const real = r ? num(ind.valor(r, null as never, m)) : null;
  if (pres === null || real === null) return { pres, real, dif: null, favorable: null };
  const dif = real - pres;
  return { pres, real, dif, favorable: Math.abs(dif) < 0.00005 ? true : ind.menor ? dif < 0 : dif > 0 };
}
export const pp = (v: number | null, signo = true) => (v === null ? "—" : `${signo ? (v > 0.00005 ? "+" : v < -0.00005 ? "−" : "") : ""}${Math.abs(v * 100).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pp`);

export function principalesIndicadores(d: DatosIndicadores, m: number, n = 5) {
  return TODOS.map((ind) => ({ ind, c: compararInd(ind, d, m) }))
    .filter((x) => x.c.dif !== null && Math.abs(x.c.dif) >= 0.0005)
    .sort((a, b) => Math.abs(b.c.dif!) - Math.abs(a.c.dif!)).slice(0, n);
}
export const fraseIndicador = (ind: Ind, c: Comp) =>
  `${ind.label}: ${pct(c.real)} frente a ${pct(c.pres)} presupuestado, ${pp(Math.abs(c.dif!), false)} ${c.dif! >= 0 ? "por encima" : "por debajo"}. ${c.favorable ? "Favorable" : "Desfavorable"}.`;

