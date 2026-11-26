/**
 * 52 · 54 · 56 · 47 — OTROS INGRESOS Y GASTOS en el Estudio de agencia.
 *
 * Son montos que salen del histórico (Proyección de ingresos y presupuesto departamental), no de un modelo. El estudio
 * muestra cuánto pesan y deja proponer un crecimiento frente a lo real de los últimos 12 meses. El cambio no toca lo
 * cargado: se guarda como ajuste en el departamento "Estudio de agencia", repartido en proporción a lo cargado
 * (subcuenta y mes). La 5604 (recuperación de castigados y reversión de provisiones) la calcula el modelo de provisión.
 */
import { cuentaCalculada } from "./cuentas-calculadas";
import { delMes, type HistoricoEstudio } from "./estudio-agencia";
import { DEP_ESTUDIO } from "./estudio-gastos";
import type { FilaPresupuestoDepartamental } from "./orquestador";

export const CUENTAS_OTROS = [
  { c: "52", n: "Comisiones ganadas", gasto: false },
  { c: "54", n: "Ingresos por servicios", gasto: false },
  { c: "56", n: "Otros ingresos", gasto: false },
  { c: "47", n: "Otros gastos y pérdidas", gasto: true },
] as const;

const dig = (c: string) => c.replace(/\D/g, "");
const d6 = (c: string) => dig(c).slice(0, 6);
/** Filas del presupuesto que forman la cuenta (sin la 5604 del modelo ni lo que calcula la herramienta). */
export const entraEn = (cuenta: string, concepto: string) => {
  const k = dig(concepto);
  return k.startsWith(cuenta) && !(cuenta === "56" && /^5604(05|10)/.test(k)) && !cuentaCalculada(k);
};

interface RealidadOtros { meses: number; desde: string; hasta: string; anio: number; anual: Record<string, number>; sub: Record<string, number> }

/** Lo real de los últimos 12 meses (o los que haya, llevado a 12) de cada cuenta. */
export function calcularRealidadOtros(h: HistoricoEstudio): RealidadOtros | null {
  const per = Object.keys(h.er).filter((p) => ["51", "52", "54", "56", "47"].some((k) => h.er[p]?.[k] !== undefined)).sort();
  const ult = per.filter((p) => delMes(h.er, p, "51") !== null || delMes(h.er, p, "56") !== null).slice(-12);
  if (!ult.length) return null;
  const n = ult.length, suma = (f: (p: string) => number) => (ult.reduce((t, p) => t + f(p), 0) * 12) / n;
  const v = (p: string, k: string) => delMes(h.er, p, k) ?? 0;
  const anual: Record<string, number> = {
    "52": suma((p) => v(p, "52")),
    "54": suma((p) => v(p, "54")),
    "56": suma((p) => v(p, "56") - v(p, "560405") - v(p, "560410")),
    "5604": suma((p) => v(p, "560405") + v(p, "560410")),
    "47": suma((p) => v(p, "47")),
  };
  // subcuentas (6 dígitos) de 52, 54, 56 y 47
  const sub: Record<string, number> = {};
  const codigos = new Set(ult.flatMap((p) => Object.keys(h.er[p] ?? {}).filter((k) => k.length === 6 && CUENTAS_OTROS.some((x) => k.startsWith(x.c)))));
  for (const k of codigos) sub[k] = suma((p) => v(p, k));
  return { meses: n, desde: ult[0], hasta: ult[n - 1], anio: Number(ult[n - 1].slice(0, 4)), anual, sub };
}

/** Lo que suma el presupuesto 2027 en cada cuenta (filas cargadas + ajustes ya aplicados). */
export function presOtros(filas: FilaPresupuestoDepartamental[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { c } of CUENTAS_OTROS) out[c] = filas.reduce((t, f) => t + (entraEn(c, f.concepto) ? Number(f.monto) || 0 : 0), 0);
  return out;
}

/** Versión: crecimiento de cada cuenta frente a lo real de los últimos 12 meses (las que no están, quedan como en el presupuesto). */
export type VersionOtros = Record<string, number>;

export function versionPresOtros(real: RealidadOtros, pres: Record<string, number>): VersionOtros {
  const v: VersionOtros = {};
  for (const { c } of CUENTAS_OTROS) if (real.anual[c] > 0.5) v[c] = (pres[c] ?? 0) / real.anual[c] - 1;
  return v;
}
export function versionRealOtros(real: RealidadOtros): VersionOtros {
  const v: VersionOtros = {};
  for (const { c } of CUENTAS_OTROS) if (real.anual[c] > 0.5) v[c] = 0;
  return v;
}

/** Monto anual de la cuenta en la versión. */
export const objetivo = (real: RealidadOtros, v: VersionOtros, c: string, pres: number) => (c in v && real.anual[c] > 0.5 ? real.anual[c] * (1 + v[c]) : pres);

/**
 * Ajuste (concepto de 6 dígitos → 12 meses) para llevar la cuenta de lo que suma el presupuesto al monto objetivo:
 * cada fila cargada se escala en la misma proporción; si la cuenta no tiene nada cargado, va en partes iguales a {cuenta}90.
 */
function ajusteCuenta(filas: FilaPresupuestoDepartamental[], cuenta: string, meta: number): Record<string, number[]> {
  const base = filas.filter((f) => entraEn(cuenta, f.concepto));
  const total = base.reduce((t, f) => t + (Number(f.monto) || 0), 0);
  const out: Record<string, number[]> = {};
  if (Math.abs(meta - total) < 1) return out;
  if (Math.abs(total) < 1) { out[`${cuenta}90`] = Array(12).fill(meta / 12); return out; }
  const s = meta / total - 1;
  for (const f of base) {
    if (f.mes < 1 || f.mes > 12) continue;
    (out[d6(f.concepto)] ??= Array(12).fill(0))[f.mes - 1] += (Number(f.monto) || 0) * s;
  }
  return out;
}

/** Ajustes de todas las cuentas que cambian frente al presupuesto. */
export function ajustesOtros(filas: FilaPresupuestoDepartamental[], real: RealidadOtros, pres: Record<string, number>, v: VersionOtros, solo?: string) {
  const out: Record<string, number[]> = {};
  for (const { c } of CUENTAS_OTROS) {
    if (solo && c !== solo) continue;
    const meta = objetivo(real, v, c, pres[c] ?? 0);
    if (Math.abs(meta - (pres[c] ?? 0)) < 1) continue;
    for (const [k, m] of Object.entries(ajusteCuenta(filas, c, meta))) { const a = (out[k] ??= Array(12).fill(0)); m.forEach((x, i) => { a[i] += x; }); }
  }
  return out;
}

/** Filas del presupuesto con los ajustes (para correr el motor). */
export function filasConOtros(filas: FilaPresupuestoDepartamental[], aj: Record<string, number[]>, nombres: Record<string, string> = {}): FilaPresupuestoDepartamental[] {
  const extra = Object.entries(aj).flatMap(([k, m]) => m.map((monto, i) => ({ departamento: DEP_ESTUDIO, concepto: k, cuenta_nombre: nombres[k] ?? null, mes: i + 1, monto })));
  return extra.length ? [...filas, ...extra] : filas;
}

/** Filas a guardar en "Estudio de agencia": lo que ya tenía la agencia en ese concepto + el ajuste nuevo. */
export function filasEstudioOtros(filas: FilaPresupuestoDepartamental[], aj: Record<string, number[]>, nombres: Record<string, string> = {}) {
  const previo: Record<string, number[]> = {};
  for (const f of filas) if (f.departamento === DEP_ESTUDIO && f.mes >= 1 && f.mes <= 12) (previo[d6(f.concepto)] ??= Array(12).fill(0))[f.mes - 1] += Number(f.monto) || 0;
  return Object.entries(aj).map(([k, d]) => {
    const montos = (previo[k] ?? Array(12).fill(0)).map((x, i) => Math.round((x + d[i]) * 100) / 100);
    return { concepto: k, cuenta_nombre: nombres[k] ?? null, montos: montos.every((x) => Math.abs(x) < 0.005) ? null : montos };
  });
}
