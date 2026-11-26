/**
 * Cálculos de la Ejecución presupuestaria que comparten la pantalla y las exportaciones (Excel y Word).
 */
import type { FilaEjecucion } from "./ejecucion";

export type Base = "acumulado" | "mes";
export type Estado = "Balance general" | "Estado de resultados";

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Valor del mes i (0..11). En resultados, "mes" es el movimiento del mes (los datos vienen acumulados en el año). */
export function valorMes(arr: (number | null)[] | null, i: number, er: boolean, base: Base): number | null {
  if (!arr) return null;
  const v = arr[i];
  if (v === null || v === undefined) return null;
  if (!er || base === "acumulado" || i === 0) return v;
  const a = arr[i - 1];
  return a === null || a === undefined ? null : v - a;
}

export interface Comparacion { pres: number | null; real: number | null; dif: number | null; pct: number | null; cumpl: number | null; favorable: boolean | null }

export function comparar(f: FilaEjecucion, i: number, er: boolean, base: Base): Comparacion {
  const pres = valorMes(f.pres, i, er, base), real = valorMes(f.real, i, er, base);
  if (pres === null || real === null) return { pres, real, dif: null, pct: null, cumpl: null, favorable: null };
  const dif = real - pres;
  const pct = Math.abs(pres) >= 0.005 ? dif / Math.abs(pres) : null;
  const cumpl = Math.abs(pres) < 0.005 || Math.abs(real) < 0.005 ? null : f.menos ? pres / real : real / pres;
  const favorable = Math.abs(dif) < 0.005 ? true : f.menos ? dif < 0 : dif > 0;
  return { pres, real, dif, pct, cumpl: cumpl !== null && cumpl > 0 ? cumpl : null, favorable };
}

export function buscar(filas: FilaEjecucion[], pred: (f: FilaEjecucion) => boolean): FilaEjecucion | null {
  for (const f of filas) { if (pred(f)) return f; const x = buscar(f.hijos ?? [], pred); if (x) return x; }
  return null;
}

export function aplanar(filas: FilaEjecucion[], nivel = 0, max = 99, padre = ""): { f: FilaEjecucion; nivel: number; padre: string }[] {
  return filas.flatMap((f) => [{ f, nivel, padre }, ...(nivel < max ? aplanar(f.hijos ?? [], nivel + 1, max, f.label) : [])]);
}

/** Las cuentas con presupuesto de mayor desvío (sin las raíces), para el resumen y el informe. */
export function principales(filas: FilaEjecucion[], i: number, er: boolean, base: Base, n = 5) {
  return aplanar(filas)
    .filter(({ f, nivel }) => nivel > 0 && f.pres && f.id !== "resultado")
    // las filas del cálculo sin código (p. ej. «Microcrédito») llevan el nombre de su grupo: «Cartera en Riesgo · Microcrédito»
    .map(({ f, padre }) => ({ f: f.codigo || !padre ? f : { ...f, label: `${padre} · ${f.label}` }, c: comparar(f, i, er, base) }))
    .filter((x) => x.c.dif !== null && Math.abs(x.c.dif) >= 0.5)
    .sort((a, b) => Math.abs(b.c.dif!) - Math.abs(a.c.dif!))
    // sin repetir una cuenta y su subcuenta con el mismo desvío
    .filter((x, k, arr) => !arr.slice(0, k).some((y) => Math.abs(y.c.dif! - x.c.dif!) < 0.5 && (y.f.codigo.startsWith(x.f.codigo) || x.f.codigo.startsWith(y.f.codigo))))
    .slice(0, n);
}

export const usd = (v: number | null) => {
  if (v === null) return "—";
  const t = Math.abs(v).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${t})` : t;
};
export const pctTxt = (v: number | null, signo = true) => {
  if (v === null || !Number.isFinite(v)) return "—";
  const t = Math.abs(v * 100).toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${signo ? (v > 0 ? "+" : v < 0 ? "−" : "") : ""}${t} %`;
};

/** Texto de una variación para el resumen y el informe. */
export function frase(f: FilaEjecucion, c: Comparacion): string {
  const nombre = /^\d+$/.test(f.codigo) ? `${f.codigo} ${f.label}` : f.label;
  return `${nombre} cerró en $${usd(c.real)}, ${c.dif! >= 0 ? "por encima" : "por debajo"} de lo presupuestado en $${usd(Math.abs(c.dif!))} (${pctTxt(c.pct)}). ${c.favorable ? "Favorable" : "Desfavorable"}.`;
}
