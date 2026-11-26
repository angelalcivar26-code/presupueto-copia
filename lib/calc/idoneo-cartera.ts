/**
 * Idóneo de cartera de una agencia (Planificación → Cartera → Idóneo y Supuestos, y «Aplicar idóneo a las 10 agencias»).
 * Con los meses sin alivio (desde el inicio de la ventana de la provisión hasta el último mes cargado):
 *  - Real: lo que hizo en esos meses (suma ÷ suma).
 *  - Su mejor nivel: promedio de sus 2 mejores meses; su mejor mes: el tope de lo que ya demostró.
 *  - Punto de equilibrio: el nivel con el que la utilidad del ejercicio de la agencia queda en cero (motor del presupuesto,
 *    todo lo demás igual). Primero el pase a riesgo y, con ese, la recuperación de vencida.
 *  - Meta gradual: cerrar la mitad de la distancia entre su real y su mejor nivel (la misma regla de la meta de provisión).
 *    Pase a riesgo: al menos 10 % menos que su real (cobranza temprana); si la agencia pasa más que la cooperativa, la mitad
 *    del camino hasta la cooperativa (lo que otras logran), lo que sea más exigente.
 *    Los meses atípicos (más de 50 % mejores que su real, p. ej. un pase casi en cero por reclasificaciones) no cuentan.
 *  - Idóneo = el más exigente entre su real, la meta gradual y el equilibrio, sin pasar de su mejor mes (elegirIdoneo).
 *  - Límite: con el idóneo, el gasto neto de provisión de la agencia no baja más de 25 % frente a su real
 *    (LIMITE_BAJA_PROVISION, el mismo del aviso de Integridad); si baja más, el idóneo se acerca al real hasta ese límite.
 * La recuperación por vencer no mueve la utilidad: su idóneo es su mejor nivel.
 * Precancelación de cartera por vencer: su real de los meses sin alivio (lo precancelado con dinero, sin refinanciamientos,
 * ÷ cartera por vencer), un solo valor para todos los productos; la administración puede cambiarlo en la Meta.
 * Tasa, distribución y % que vence no llevan idóneo: quedan como están en el presupuesto.
 * Una sola función para las tres pantallas: los mismos números en todas.
 */
import type { Corrida } from "./plan2027";
import { NOMBRE_LINEA, moraReal, type MesReal, type VersionCartera } from "./estudio-agencia";
import { elegirIdoneo, type FuenteIdoneo } from "./provision-metas";

export interface FilaIdoneo {
  clave: string; label: string; real: number | null; mejor: number | null; tope: number | null; eq: number | null; eqTexto?: string;
  idoneo: number | null; fuente: FuenteIdoneo | null; pres: number; noAlcanza?: boolean; alto: boolean; pct: 1 | 2;
  gradual: number | null; limitado?: boolean;
  /** Pase a riesgo: referencia de la cooperativa y si el idóneo sale de ella. */
  ref?: number | null; porReferencia?: boolean; porMinimo?: boolean;
}
/** Con el idóneo, la provisión de la agencia no baja más de esto frente a su real (mismo límite del aviso de Integridad). */
export const LIMITE_BAJA_PROVISION = 0.25;
/** Meses atípicos: más de 50 % mejores que su real no cuentan como logro. */
const ATIPICO = 0.5;
/**
 * Pase a riesgo del idóneo (decisión de la administración, nov-2026): la morosidad debe bajar ≈ 1 punto (meta 14,5 %), no
 * más; la mejora se pide sobre todo en recuperación de vencida. Por eso el pase no lleva mejora mínima ni referencia de la
 * cooperativa (quedan disponibles: MEJORA_MIN_PASE > 0 y PASE_CON_REFERENCIA = true).
 */
export const MEJORA_MIN_PASE = 0;
export const PASE_CON_REFERENCIA = false;

export interface CalculoIdoneo {
  sm: MesReal[]; U0: number; bajaProvision: number; limitado: boolean; filas: FilaIdoneo[]; v0: VersionCartera; eReal: number | null; capMes: number;
  pase: { i: number; real: number | null; mejor: number | null; tope: number | null; pv0: number }[];
}

/** Mitad de la distancia entre el real y el mejor nivel (si el mejor nivel es mejor que el real). */
export const gradual = (real: number | null, mejor: number | null, alto: boolean) => {
  if (real === null || mejor === null) return mejor;
  const mejorQueReal = alto ? mejor > real : mejor < real;
  return mejorQueReal ? real + (mejor - real) / 2 : mejor;
};
/** Quita los meses atípicos frente al real (más de 50 % mejores). */
const sinAtipicos = (v: number[], real: number | null, alto: boolean) =>
  real === null || real <= 0 ? v : v.filter((x) => (alto ? x <= real * (1 + ATIPICO) : x >= real * (1 - ATIPICO)));
const prom2 = (v: number[], alto: boolean) => { const s = [...v].sort((a, b) => (alto ? b - a : a - b)).slice(0, 2); return s.length ? s.reduce((a, x) => a + x, 0) / s.length : null; };

export function calcularIdoneo({ ms, idx, pres, correr, desde, paseRef }: {
  ms: MesReal[]; idx: number[]; pres: VersionCartera; correr: (v: VersionCartera) => Corrida | null; desde: string;
  /** Pase a riesgo de la cooperativa por línea (referencia de lo que logran las agencias en conjunto). */
  paseRef?: (number | null)[] | null;
}): CalculoIdoneo | null {
  const sm = ms.filter((m) => !desde || m.p >= desde);
  if (sm.length < 2) return null;
  // --- reales y mejores meses ---
  const conRep = sm.filter((m) => m.rep && m.rep.capital > 0);
  const eReal = conRep.length ? conRep.reduce((t, m) => t + m.rep!.neto, 0) / conRep.reduce((t, m) => t + m.rep!.capital, 0) : null;
  const eMes = sinAtipicos(conRep.map((m) => m.rep!.neto / m.rep!.capital), eReal, true);
  const conVen = sm.filter((m) => m.rep && m.rep.capVen > 0);
  const cvReal = conVen.length ? conVen.reduce((t, m) => t + m.rep!.netoVen, 0) / conVen.reduce((t, m) => t + m.rep!.capVen, 0) : null;
  const cvMes = sinAtipicos(conVen.map((m) => m.rep!.netoVen / m.rep!.capVen), cvReal, true);
  const pase = idx.map((i) => {
    const xs = sm.filter((m) => m.pv0[i] > 1000);
    // meses con pase negativo (reclasificaciones o recuperaciones mayores a lo que entró) no cuentan como logro
    const b = xs.reduce((t, m) => t + m.pv0[i], 0);
    const real = b > 0 ? Math.max(0, xs.reduce((t, m) => t + m.mig[i], 0) / b) : null;
    const mes = sinAtipicos(xs.filter((m) => m.mig[i] > 0).map((m) => m.mig[i] / m.pv0[i]), real, false);
    return { i, real, mejor: prom2(mes, false), tope: mes.length ? Math.min(...mes) : null, pv0: xs.length ? b / xs.length : 0 };
  });
  const capMes = conRep.length ? conRep.reduce((t, m) => t + m.rep!.capital, 0) / conRep.length : 0;
  // precancelación con dinero de la cartera por vencer (sin refinanciamientos) ÷ cartera por vencer del mes anterior
  const pvRep = conRep.reduce((t, m) => t + m.pv0.reduce((a, x) => a + x, 0), 0);
  const qReal = pvRep > 0 ? conRep.reduce((t, m) => t + (m.rep!.prec ?? 0), 0) / pvRep : null;
  // interés de mora: 5104.50 ÷ interés normal de la cartera de estos meses
  const mReal = moraReal(sm);

  // --- versión base: el presupuesto, con el real de estos meses en los tres parámetros ---
  const v0: VersionCartera = {
    ...pres, e: pres.e.map((x) => eReal ?? x), rv: pres.rv.map((x) => cvReal ?? x),
    pase: pres.pase.map((x, i) => pase.find((p) => p.i === i)?.real ?? x),
    q: pres.q.map((x) => qReal ?? x),
    mora: pres.mora,
  };
  const util = (v: VersionCartera) => correr(v)?.er.util ?? null;
  const U0 = util(v0);
  if (U0 === null) return null;

  // --- pase a riesgo: equilibrio (k × el real de cada línea) ---
  const conPase = (k: number): VersionCartera => ({ ...v0, pase: v0.pase.map((x, i) => (idx.includes(i) ? x * k : x)) });
  let kEq: number | null = null, paseNoAlcanza = false;
  if (U0 < 0) {
    const U5 = util(conPase(0.5));
    if (U5 !== null && U5 > U0) {
      kEq = 1 + (U0 * 0.5) / (U5 - U0);
      // una corrección con la secante
      const Uk = util(conPase(Math.max(0, kEq)));
      if (Uk !== null && Math.abs(Uk) > 1 && kEq > 0) { const s = (Uk - U0) / (kEq - 1); if (s !== 0) kEq = kEq - Uk / s; }
    } else paseNoAlcanza = true;
  }
  if (kEq !== null && kEq <= 0) paseNoAlcanza = true;
  const filasPase: FilaIdoneo[] = pase.map((p) => {
    const eq = kEq !== null && kEq > 0 ? (p.real ?? 0) * kEq : null;
    // referencia de la cooperativa: la agencia con más pase que la cooperativa recorre la mitad del camino hasta ella (lo que
    // otras agencias ya logran); no se le pide pasar de la cooperativa ni de su propio mejor mes
    const ref = paseRef?.[p.i] ?? null;
    // sin referencia válida (la cooperativa en cero o negativa por reclasificaciones, p. ej. inmobiliario) solo rige el 10 %
    const peer = PASE_CON_REFERENCIA && ref !== null && ref > 0 && p.real !== null && p.real > ref ? p.real - (p.real - ref) / 2 : null;
    // mejora mínima pareja de cobranza temprana: 10 % menos que su real
    const minimo = MEJORA_MIN_PASE > 0 && p.real !== null && p.real > 0 ? p.real * (1 - MEJORA_MIN_PASE) : null;
    const g0 = gradual(p.real, p.mejor, false);
    const g = [g0, peer, minimo].filter((x): x is number => x !== null).reduce<number | null>((a, x) => (a === null || x < a ? x : a), null);
    const topeOwn = p.tope !== null && p.real !== null && p.tope < p.real ? p.tope : null;
    const t = Math.min(topeOwn ?? Infinity, peer !== null ? ref! : Infinity, minimo ?? Infinity);
    const tope = Number.isFinite(t) ? t : p.tope;
    const r = elegirIdoneo({ real: p.real, mejor: g, tope, eq, altoEsMejor: false, conPerdidaSinAlcance: paseNoAlcanza && U0 < 0 });
    return { clave: `pase${p.i}`, label: `Pase a cartera en riesgo mensual · ${NOMBRE_LINEA[p.i]}`, real: p.real, mejor: p.mejor, gradual: g, tope, eq, ref, porReferencia: peer !== null && g === peer, porMinimo: minimo !== null && g === minimo && g !== peer, idoneo: r.valor, fuente: r.fuente,
      pres: pres.pase[p.i], noAlcanza: r.noAlcanza, pct: 2, alto: false, eqTexto: U0 >= 0 ? "Con utilidad" : eq === null ? "Ni con 0 %" : undefined };
  });
  const v1: VersionCartera = { ...v0, pase: v0.pase.map((x, i) => filasPase.find((f) => f.clave === `pase${i}`)?.idoneo ?? x) };

  // --- recuperación de vencida: equilibrio con el pase idóneo ---
  const cvTope = cvMes.length ? Math.max(...cvMes) : null, cvMejor = prom2(cvMes, true);
  const U1 = util(v1);
  let cvEq: number | null = null;
  if (U1 !== null && U1 < 0 && cvReal !== null) {
    const Ud = util({ ...v1, rv: v1.rv.map((x) => x + 0.02) });
    if (Ud !== null && Ud > U1) cvEq = cvReal + (-U1) * 0.02 / (Ud - U1);
  }
  const cvGradual = gradual(cvReal, cvMejor, true);
  const rcv = elegirIdoneo({ real: cvReal, mejor: cvGradual, tope: cvTope, eq: cvEq, altoEsMejor: true, conPerdidaSinAlcance: U1 !== null && U1 < 0 && cvEq === null });
  const filaCv: FilaIdoneo = { clave: "cv", label: "Recuperación de cartera vencida", real: cvReal, mejor: cvMejor, gradual: cvGradual, tope: cvTope, eq: cvEq, idoneo: rcv.valor, fuente: rcv.fuente, pres: pres.rv[idx[0] ?? 1],
    noAlcanza: rcv.noAlcanza, pct: 1, alto: true, eqTexto: U1 !== null && U1 >= 0 ? (U0 >= 0 ? "Con utilidad" : "Ya alcanza") : cvEq === null ? "No alcanza" : undefined };

  // --- recuperación por vencer: su mejor nivel (trae efectivo; casi no mueve la utilidad) ---
  const eMejor = prom2(eMes, true), eTope = eMes.length ? Math.max(...eMes) : null;
  const eGradual = gradual(eReal, eMejor, true);
  const re = elegirIdoneo({ real: eReal, mejor: eGradual, tope: eTope, eq: null, altoEsMejor: true, conPerdidaSinAlcance: false });
  const filaE: FilaIdoneo = { clave: "e", label: "Recuperación de cartera por vencer", real: eReal, mejor: eMejor, gradual: eGradual, tope: eTope, eq: null, eqTexto: "No mueve la utilidad", idoneo: re.valor, fuente: re.fuente, pres: pres.e[idx[0] ?? 1], pct: 1, alto: true };

  // --- precancelación: su real (un solo valor para todos los productos) ---
  const filaQ: FilaIdoneo = { clave: "q", label: "Precancelación de cartera por vencer (todos los productos)", real: qReal, mejor: null, gradual: null, tope: null, eq: null,
    eqTexto: "Se usa su real", idoneo: qReal, fuente: qReal === null ? null : "real", pres: pres.q[idx[0] ?? 1], pct: 2, alto: false };

  const filaMora: FilaIdoneo = { clave: "mora", label: "Interés de mora (% del interés de cartera)", real: mReal, mejor: null, gradual: null, tope: null, eq: null,
    eqTexto: "Automático: su real", idoneo: mReal, fuente: mReal === null ? null : "real", pres: pres.mora ?? 0, pct: 2, alto: false };

  const filas = [filaE, ...filasPase, filaCv, filaQ, filaMora];

  // --- límite: la provisión de la agencia no baja más de 25 % frente a su real ---
  const gasto = (v: VersionCartera) => { const R = correr(v); return R ? R.er.provCart - R.er.reversion : null; };
  const g0 = gasto(v0);
  const mezcla = (t: number): VersionCartera => {
    const m = (clave: string, x: number) => { const f = filas.find((y) => y.clave === clave); return f && f.idoneo !== null && f.real !== null ? f.real + (f.idoneo - f.real) * t : x; };
    return { ...v0, e: v0.e.map((x) => m("e", x)), rv: v0.rv.map((x) => m("cv", x)), pase: v0.pase.map((x, i) => m(`pase${i}`, x)) };
  };
  const baja = (t: number) => { const g = gasto(mezcla(t)); return g0 !== null && g0 > 0 && g !== null ? 1 - g / g0 : 0; };
  let bajaProvision = baja(1), limitado = false;
  if (bajaProvision > LIMITE_BAJA_PROVISION + 1e-4) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (baja(mid) > LIMITE_BAJA_PROVISION) hi = mid; else lo = mid; }
    for (const f of filas) if (f.idoneo !== null && f.real !== null && Math.abs(f.idoneo - f.real) > 1e-9) { f.idoneo = f.real + (f.idoneo - f.real) * lo; f.limitado = true; }
    bajaProvision = baja(lo); limitado = true;
  }
  return { sm, U0, bajaProvision, limitado, filas, v0, eReal, capMes, pase };
}

/** Versión del presupuesto con el idóneo (o la meta escrita) en los tres parámetros; lo demás, como el presupuesto. */
export function versionIdoneo(c: CalculoIdoneo, metas: Record<string, number> = {}): VersionCartera {
  const m = (clave: string) => { const f = c.filas.find((x) => x.clave === clave); return f ? metas[clave] ?? f.idoneo : null; };
  return { ...c.v0, e: c.v0.e.map((x) => m("e") ?? x), rv: c.v0.rv.map((x) => m("cv") ?? x), pase: c.v0.pase.map((x, i) => m(`pase${i}`) ?? x), q: c.v0.q.map((x) => m("q") ?? x), qvReal: true,
    // interés de mora: es automático (el real de la agencia, se actualiza con cada ER); solo se guarda si se escribe otro
    ...(metas.mora !== undefined ? { mora: metas.mora } : {}) };
}

/** Idóneo de un campo de la tabla de Supuestos (e, rv o pase de la línea i); null si ese campo no lleva idóneo. */
export function idoneoDeCampo(c: CalculoIdoneo | null, campo: string, i: number): FilaIdoneo | null {
  if (!c) return null;
  const clave = campo === "e" ? "e" : campo === "rv" ? "cv" : campo === "pase" ? `pase${i}` : campo === "q" ? "q" : campo === "mora" ? "mora" : null;
  return clave ? c.filas.find((f) => f.clave === clave) ?? null : null;
}
