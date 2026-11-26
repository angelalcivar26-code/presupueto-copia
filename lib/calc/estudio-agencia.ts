/**
 * ESTUDIO DE AGENCIA · 14 CARTERA DE CRÉDITOS
 *
 * La realidad de la cartera de una agencia, mes a mes, leída de sus históricos (balance mensual y estado de
 * resultados acumulado), expresada en los mismos parámetros que usa el motor del presupuesto por línea:
 *   - Colocación del mes      C = PV_t − PV_{t−1} + p × PV_{t−1}
 *       (p = % de recuperación del período: la cuota que vence cada mes, la misma del presupuesto)
 *   - Tasa efectiva           i = interés del mes (5104 de la línea) × 12 ÷ promedio de PV_{t−1} y PV_t
 *   - Castigos del mes        K = provisión_{t−1} + gasto 4402 − reversión 560410 − provisión_t   (si es positivo)
 *                              repartidos entre líneas según su cartera en riesgo
 *   - Paso a riesgo           mig = R_t − R_{t−1} + rv × R_{t−1} + K
 *   - Efectividad de cobro    e = 1 − Σ mig ÷ Σ (p × PV_{t−1})
 *   - Distribución            colocación de la línea ÷ colocación total
 *   - Cumplimiento de la meta colocación mensual promedio ÷ meta de los asesores
 * PV = cartera por vencer y R = cartera que no devenga + vencida, con las mismas cuentas que lee el motor.
 */
import { CODIGOS_CARTERA, type FilaParametroCaptaciones, type FilaParametroCredito, type FilaOficialCredito, type MetasCreditoInstitucional } from "./orquestador";

export const LINEAS_ESTUDIO = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as const;
export const NOMBRE_LINEA = ["Productivo", "Consumo", "Inmobiliario", "Microcrédito"];
/** El sistema de cartera cobra el interés por días reales sobre un año de 360 (saldo × tasa × días ÷ 360): en el año cobra
 *  tasa × 365 ÷ 360 del saldo. El motor calcula saldo × tasa ÷ 12, así que la tasa que reproduce lo contable es la de base 360. */
export const FACTOR_BASE_360 = 365 / 360;
/** Tasa nominal más alta con la que está otorgada la cartera vigente de cada línea, en el orden de LINEAS_ESTUDIO
 *  (tarifario de la cooperativa, noviembre 2026): Productivo PYMES 10,65 %, Consumo normal 15,60 %, Microcrédito minorista /
 *  acumulación simple 18,99 %. Inmobiliario: la vivienda hoy se otorga al 8,74 %, pero la cartera vigente (plazos largos)
 *  se otorgó antes entre 9 % y 9,80 %, así que el tope es 9,80 %. */
export const TASA_PRODUCTO_MAX = [0.1065, 0.156, 0.098, 0.1899];
/** Tope de la tasa real de cada línea: la tasa más alta del producto llevada a base 360. Más que eso sería ingreso inflado. */
export const TOPE_TASA_LINEA = TASA_PRODUCTO_MAX.map((x) => x * FACTOR_BASE_360);
const CUENTA_INTERES = ["510405", "510410", "510415", "510420"];
/** Interés de la cartera refinanciada (510430) y reestructurada (510435): no viene por línea; se reparte entre las líneas
 *  según su saldo refinanciado y reestructurado por vencer (1409–1412 y 1417–1420), que sí está en la cartera por vencer. */
const CUENTA_INTERES_REFI = ["510430", "510435"];
const COD_REFI_LINEA = [["1409", "1417"], ["1410", "1418"], ["1411", "1419"], ["1412", "1420"]];
const CUENTA_PROVISION = ["440210", "440220", "440230", "440240"];
const CUENTA_PROV_LINEA = ["149905", "149910", "149915", "149920"];

/** Lo que entrega /api/estudio-agencia: periodo → código → valor. */
export interface HistoricoEstudio {
  agencia: string;
  bal: Record<string, Record<string, number>>;
  er: Record<string, Record<string, number>>;
  /** Recuperación de cartera del sistema de cartera (Carga de datos → Recuperación de cartera), por mes. */
  rec?: Record<string, { VIGENTE?: FilaRec; VENCIDO?: FilaRec }>;
  /** Presupuesto departamental 2027 de la agencia en cuentas 45 (con su modo) y nombres de las subcuentas 45. */
  dep?: { departamento: string; concepto: string; cuenta_nombre: string | null; mes: number; monto: number; modo: string }[];
  nombres?: Record<string, string>;
  /** Pase a riesgo mensual de la cooperativa por línea en los meses sin alivio (referencia del idóneo). */
  paseCoop?: (number | null)[] | null;
}
export interface FilaRec { saldo: number; capital: number; recuperado: number; precancelados: number; refinanciado: number; neto: number }

export interface MesReal {
  p: string;
  pv0: number[]; pv: number[]; r0: number[]; r: number[]; col: number[]; int: (number | null)[]; tasa: (number | null)[];
  due: number[]; mig: number[];
  cas: number; prov: number; gasto4402: number | null; rev: number | null; intMora: number | null;
  /** 5104 del mes (todo el interés de cartera, con la mora). */
  int5104?: number | null;
  /** Del reporte de recuperación (toda la agencia): capital que vence, neto cobrado, precancelaciones con dinero (precancelados −
   *  refinanciados, reestructurados y novaciones), refinanciamientos y recuperado de vencida (neto y precancelaciones aparte). */
  rep: { capital: number; neto: number; prec: number; refin: number; recVen: number; capVen: number; netoVen: number; precVen: number } | null;
}
interface LineaReal { tasa: number | null; e: number | null; pase: number | null; dist: number | null; colMes: number; pvFin: number; rFin: number; activa: boolean }
interface ResumenAnio { anio: number; meses: number; colocacion: number; colMes: number; interes: number | null; tasa: number | null; e: number | null; cartera: number; mora: number }
interface Realidad {
  anio: number; desde: string; hasta: string; meses: MesReal[]; ventana: MesReal[];
  lineas: LineaReal[]; colMes: number; meta: number; cumpl: number | null; anual: ResumenAnio[];
  /** Interés de mora real: 5104.50 ÷ interés normal de la cartera (meses del período). */
  mora: number | null;
  /** Meses que entran en el ritmo real (la ventana sin los excluidos, p. ej. el salto por el fin de los alivios). */
  base: MesReal[]; excluidos: string[];
  /** Ritmo real del reporte de recuperación (igual para todas las líneas): cobro de cuotas, % que vence al mes,
   *  precancelaciones al mes y recuperación de vencida al mes. null = no hay reporte para los meses del período. */
  /** cv: % neto recuperado de la cartera vencida (valor neto recuperado ÷ capital vencido por cobrar), la columna del reporte. */
  /** q: precancelaciones con dinero ÷ cartera por vencer; rv: recuperado de vencida (neto + precancelaciones) ÷ saldo en riesgo;
   *  rvNeto: solo lo neto ÷ saldo en riesgo; qv: precancelaciones con dinero de vencida ÷ saldo en riesgo. */
  rep: { e: number; p: number; q: number; rv: number; rvNeto: number; qv: number; cv: number | null; meses: number } | null;
  /** Supuestos tomados del presupuesto (no se pueden separar con la contabilidad): p y rv por línea. */
  p: number[]; rv: number[];
}

export const mesAnterior = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const sumaCod = (c: Record<string, number> | undefined, cods: string[]) => cods.reduce((t, k) => t + (c?.[k] ?? 0), 0);
const lim = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Valor del mes de una cuenta del estado de resultados (acumulado del mes − acumulado del mes anterior del mismo año). */
export function delMes(er: HistoricoEstudio["er"], p: string, k: string): number | null {
  const a = er[p]; if (!a) return null;
  if (p.endsWith("-01")) return a[k] ?? 0;
  const b = er[mesAnterior(p)]; if (!b) return null;
  // la cuenta viene acumulada: si el mes anterior no la trae (p. ej. se cargó a menos dígitos) no se puede saber lo del mes
  if (a[k] !== undefined && b[k] === undefined) return null;
  return (a[k] ?? 0) - (b[k] ?? 0);
}

function carteraLinea(bal: Record<string, number> | undefined) {
  const pv = LINEAS_ESTUDIO.map((l) => sumaCod(bal, CODIGOS_CARTERA[l].porVencer));
  const r = LINEAS_ESTUDIO.map((l) => sumaCod(bal, CODIGOS_CARTERA[l].enRiesgo));
  return { pv, r };
}

export function metaAsesores(oficiales: FilaOficialCredito[], metas: MetasCreditoInstitucional) {
  const m = { JUNIOR: metas.meta_junior, SENIOR: metas.meta_senior, MASTER: metas.meta_master };
  return oficiales.filter((o) => o.activo === 1).reduce((t, o) => t + (m[o.rango] ?? 0), 0);
}

/** Promedio de los 12 meses de un parámetro del presupuesto por línea. */
export function promLinea(filas: FilaParametroCredito[], l: string, f: (x: FilaParametroCredito) => number) {
  const x = filas.filter((r) => r.linea === l);
  return x.length ? x.reduce((t, r) => t + (f(r) || 0), 0) / x.length : 0;
}

/** Interés de mora real: 5104.50 ÷ interés normal de la cartera (las 4 líneas con su parte refinanciada), en los meses con los dos. */
export function moraReal(ms: MesReal[]): number | null {
  // misma medida que el automático del presupuesto (lib/interes-mora-db.ts): 5104.50 ÷ (5104 − 5104.50)
  const ok = ms.filter((m) => m.intMora !== null && m.intMora !== undefined && m.int5104 !== null && m.int5104 !== undefined);
  const normal = ok.reduce((t, m) => t + (m.int5104! - m.intMora!), 0);
  return ok.length && normal > 0 ? ok.reduce((t, m) => t + (m.intMora ?? 0), 0) / normal : null;
}

export function calcularRealidad(h: HistoricoEstudio, args: { p: number[]; rv: number[]; meta: number; excluir?: string[]; desde?: string; hasta?: string }): Realidad | null {
  const periodos = Object.keys(h.bal).sort();
  if (!periodos.length) return null;
  const meses: MesReal[] = [];
  for (const p of periodos) {
    const b0 = h.bal[mesAnterior(p)], b1 = h.bal[p];
    if (!b0 || !b1) continue;
    const c0 = carteraLinea(b0), c1 = carteraLinea(b1);
    const prov0 = Math.abs(b0["1499"] ?? 0), prov1 = Math.abs(b1["1499"] ?? 0);
    const g = delMes(h.er, p, "4402"), rv = delMes(h.er, p, "560410");
    const cas = g === null ? 0 : Math.max(0, prov0 + g - (rv ?? 0) - prov1);
    const rT = c0.r.reduce((a, x) => a + x, 0), pvT = c0.pv.reduce((a, x) => a + x, 0);
    // castigos por línea: con la provisión (1499xx) y el gasto (4402xx) de cada línea, si el histórico los trae;
    // si no, el total se reparte según la cartera en riesgo
    const pl0 = CUENTA_PROV_LINEA.map((k) => Math.abs(b0[k] ?? 0)), pl1 = CUENTA_PROV_LINEA.map((k) => Math.abs(b1[k] ?? 0));
    const gl = CUENTA_PROVISION.map((k) => delMes(h.er, p, k));
    const porLinea = g !== null && pl0.some((x) => x > 0) && gl.every((x) => x !== null);
    const sp0 = pl0.reduce((a, x) => a + x, 0) || 1;
    const casL = porLinea
      ? pl0.map((x, i) => Math.max(0, x + (gl[i] ?? 0) - (rv ?? 0) * (x / sp0) - pl1[i]))
      : c0.r.map((x) => (rT > 0 ? cas * x / rT : 0));
    // reporte de recuperación: lo cobrado se reparte entre líneas según su cartera (por vencer o en riesgo)
    const rv1 = h.rec?.[p]?.VIGENTE, rr1 = h.rec?.[p]?.VENCIDO;
    // los refinanciados, reestructurados y novaciones (columna Refin-Reest-Nov, dentro de Precancelados) cancelan y vuelven a
    // colocar el mismo saldo: no son cobro ni colocación nueva
    const rep = rv1 ? {
      capital: rv1.capital, neto: rv1.neto, prec: Math.max(0, rv1.precancelados - rv1.refinanciado), refin: rv1.refinanciado,
      recVen: rr1 ? rr1.neto + Math.max(0, rr1.precancelados - rr1.refinanciado) : 0, capVen: rr1?.capital ?? 0, netoVen: rr1?.neto ?? 0,
      precVen: rr1 ? Math.max(0, rr1.precancelados - rr1.refinanciado) : 0,
    } : null;
    const shPV = (i: number) => (pvT > 0 ? c0.pv[i] / pvT : 0), shR = (i: number) => (rT > 0 ? c0.r[i] / rT : 0);
    const recVenL = c0.r.map((x, i) => (rep ? rep.recVen * shR(i) : args.rv[i] * x));
    const mig = c1.r.map((x, i) => x - c0.r[i] + recVenL[i] + casL[i]);
    // interés de cada línea + su parte del interés refinanciado y reestructurado (misma base que la cartera por vencer)
    const rf = CUENTA_INTERES_REFI.map((k) => delMes(h.er, p, k));
    // si el mes trae interés refinanciado pero no se puede mensualizar, la tasa de ese mes no se calcula (saldría baja)
    const refiNulo = rf.some((x, j) => x === null && h.er[p]?.[CUENTA_INTERES_REFI[j]] !== undefined);
    const intRefi = rf.reduce<number>((t, x) => t + (x ?? 0), 0);
    const refi = COD_REFI_LINEA.map((cs) => (sumaCod(b0, cs) + sumaCod(b1, cs)) / 2), refiT = refi.reduce((a, x) => a + x, 0);
    // sin la cuenta de interés de la línea en el mes (ER cargado a menos dígitos) la tasa de ese mes no se calcula
    const int = CUENTA_INTERES.map((k, i) => {
      if (h.er[p]?.[k] === undefined && (c0.pv[i] + c1.pv[i]) / 2 > 1000) return null;
      const x = delMes(h.er, p, k); return x === null || refiNulo ? null : x + (refiT > 0 ? intRefi * refi[i] / refiT : 0);
    });
    meses.push({
      p, pv0: c0.pv, pv: c1.pv, r0: c0.r, r: c1.r, cas: porLinea ? casL.reduce((a, x) => a + x, 0) : cas, prov: prov1, gasto4402: g, rev: rv, intMora: delMes(h.er, p, "510450"), int5104: delMes(h.er, p, "5104"),
      // colocación = variación de la cartera por vencer + lo que salió (cobro de cuotas y precancelaciones con dinero) + pase a riesgo
      col: c1.pv.map((x, i) => x - c0.pv[i] + (rep ? (rep.neto + rep.prec) * shPV(i) + mig[i] : args.p[i] * c0.pv[i])),
      int, tasa: int.map((x, i) => { const pr = (c0.pv[i] + c1.pv[i]) / 2; return x === null || pr < 1000 ? null : (x * 12) / pr; }),
      due: c0.pv.map((x, i) => (rep ? rep.capital * shPV(i) : args.p[i] * x)),
      mig, rep,
    });
  }
  if (!meses.length) return null;
  const ult = meses[meses.length - 1], anio = Number(ult.p.slice(0, 4));
  // ventana: los meses sin alivio (desde el inicio de la ventana de la provisión), los mismos del Idóneo y de la provisión;
  // sin esa fecha, el año en curso; si tiene menos de 3 meses, los últimos 12
  // hasta: último mes de la base aprobada (los cortes posteriores no cambian el ritmo real mientras la base esté fija)
  let ventana = args.desde ? meses.filter((m) => m.p >= args.desde! && (!args.hasta || m.p <= args.hasta)) : [];
  if (ventana.length < 3) ventana = meses.filter((m) => m.p.startsWith(`${anio}-`));
  if (ventana.length < 3) ventana = meses.slice(-12);
  const excluidos = (args.excluir ?? []).filter((x) => ventana.some((m) => m.p === x));
  let base = ventana.filter((m) => !excluidos.includes(m.p));
  if (!base.length) base = ventana;
  const n = base.length;
  const S = (f: (m: MesReal) => number) => base.reduce((t, m) => t + f(m), 0);
  // ritmo real del reporte (meses del período que lo tienen)
  const conRep = base.filter((m) => m.rep);
  const sPV0 = (ms: MesReal[]) => ms.reduce((t, m) => t + m.pv0.reduce((a, x) => a + x, 0), 0);
  const sR0 = (ms: MesReal[]) => ms.reduce((t, m) => t + m.r0.reduce((a, x) => a + x, 0), 0);
  const capT = conRep.reduce((t, m) => t + (m.rep?.capital ?? 0), 0);
  const rep = conRep.length && capT > 0 ? {
    e: conRep.reduce((t, m) => t + (m.rep?.neto ?? 0), 0) / capT,
    p: capT / Math.max(1, sPV0(conRep)),
    q: conRep.reduce((t, m) => t + (m.rep?.prec ?? 0), 0) / Math.max(1, sPV0(conRep)),
    rv: conRep.reduce((t, m) => t + (m.rep?.recVen ?? 0), 0) / Math.max(1, sR0(conRep)),
    rvNeto: conRep.reduce((t, m) => t + (m.rep?.netoVen ?? 0), 0) / Math.max(1, sR0(conRep)),
    qv: conRep.reduce((t, m) => t + (m.rep?.precVen ?? 0), 0) / Math.max(1, sR0(conRep)),
    // como la columna «% Neto Recuperado» del reporte: valor neto recuperado de la cartera vencida ÷ capital vencido por cobrar
    cv: (() => { const c = conRep.reduce((t, m) => t + (m.rep?.capVen ?? 0), 0); return c > 0 ? conRep.reduce((t, m) => t + (m.rep?.netoVen ?? 0), 0) / c : null; })(),
    meses: conRep.length,
  } : null;
  const colL = LINEAS_ESTUDIO.map((_, i) => S((m) => m.col[i]));
  const colPos = colL.map((x) => Math.max(0, x)), colT = colPos.reduce((a, x) => a + x, 0);
  const lineas: LineaReal[] = LINEAS_ESTUDIO.map((_, i) => {
    const conInt = base.filter((m) => m.int[i] !== null);
    const intL = conInt.reduce((t, m) => t + (m.int[i] ?? 0), 0);
    const pvProm = conInt.reduce((t, m) => t + (m.pv0[i] + m.pv[i]) / 2, 0) / Math.max(1, conInt.length);
    const mig = S((m) => m.mig[i]), pv0 = S((m) => m.pv0[i]);
    const activa = ult.pv[i] + ult.r[i] > 1000;
    return {
      tasa: activa && conInt.length && pvProm > 1000 ? (intL / conInt.length) * 12 / pvProm : null,
      // cobro de cuotas: del reporte (no viene por línea: es el de la agencia)
      e: activa && rep ? lim(rep.e, 0, 1) : null,
      // pase a riesgo: saldo que pasó a cartera en riesgo ÷ cartera por vencer (balances y castigos de la línea)
      pase: activa && pv0 > 1000 && mig > 0 ? mig / pv0 : null,
      dist: colT > 0 ? colPos[i] / colT : null,
      colMes: colL[i] / Math.max(1, n), pvFin: ult.pv[i], rFin: ult.r[i], activa,
    };
  });
  const colMes = colL.reduce((a, x) => a + x, 0) / Math.max(1, n);
  const mora = moraReal(base);
  // resumen por año (colocación, tasa, cobro de cuotas y morosidad al cierre de cada año cargado)
  const anios = [...new Set(meses.map((m) => Number(m.p.slice(0, 4))))].sort();
  const anual: ResumenAnio[] = anios.map((y) => {
    const ms = meses.filter((m) => m.p.startsWith(`${y}-`)), u = ms[ms.length - 1];
    const col = ms.reduce((t, m) => t + m.col.reduce((a, x) => a + x, 0), 0);
    const cap = ms.reduce((t, m) => t + (m.rep?.capital ?? 0), 0), net = ms.reduce((t, m) => t + (m.rep?.neto ?? 0), 0);
    const intAc = h.er[u.p] ? [...CUENTA_INTERES, ...CUENTA_INTERES_REFI].reduce((t, k) => t + (h.er[u.p]?.[k] ?? 0), 0) : null;
    const mesesER = Number(u.p.slice(5));
    const pvProm = ms.reduce((t, m) => t + m.pv.reduce((a, x) => a + x, 0), 0) / ms.length;
    const cart = u.pv.reduce((a, x) => a + x, 0) + u.r.reduce((a, x) => a + x, 0);
    return {
      anio: y, meses: ms.length, colocacion: col, colMes: col / ms.length, interes: intAc,
      tasa: intAc !== null && pvProm > 1000 ? (intAc / mesesER) * 12 / pvProm : null,
      e: cap > 0 ? net / cap : null, cartera: cart, mora: cart ? u.r.reduce((a, x) => a + x, 0) / cart : 0,
    };
  });
  return {
    anio, desde: ventana[0].p, hasta: ult.p, meses, ventana, base, excluidos, rep, lineas, colMes, meta: args.meta, mora,
    cumpl: args.meta > 0 ? colMes / args.meta : null, anual, p: args.p, rv: args.rv,
  };
}

/** Parámetros de una versión (promedio por línea) y el % de cumplimiento de la meta. */
export interface VersionCartera { tasa: number[]; e: number[]; rv: number[]; dist: number[]; p: number[]; q: number[]; pase: number[]; cumpl: number;
  /** Unidad de rv: "cuotas" (% de las cuotas vencidas del mes, como el reporte). Los borradores antiguos no lo tienen: rv era sobre el saldo. */
  rvU?: "cuotas";
  /** Asesores de crédito activos: solo se simula, no se guarda en el presupuesto. */
  ases: number;
  /** Factor de mora de la agencia (entrada a la mora del modelo de provisión; 1 = promedio de la cooperativa). */
  fm: number;
  /** Precancelación de la cartera vencida = su ritmo real × el margen de la cartera por vencer (se borra lo escrito a mano). */
  qvReal?: boolean;
  /** Interés de mora como % del interés normal de la cartera (de la agencia). */
  mora?: number }

/**
 * Filas de parámetros de crédito de una versión: lo que no cambia frente al presupuesto conserva sus 12 meses;
 * lo que cambia queda igual en los 12 meses.
 */
export function filasVersion(filas: FilaParametroCredito[], pres: VersionCartera, v: VersionCartera): FilaParametroCredito[] {
  const dif = (a: number, b: number) => Math.abs(a - b) > 1e-9;
  return filas.map((f) => {
    const i = LINEAS_ESTUDIO.indexOf(f.linea as (typeof LINEAS_ESTUDIO)[number]); if (i < 0) return f;
    return {
      ...f,
      tasa_interes_anual: dif(v.tasa[i], pres.tasa[i]) ? v.tasa[i] : f.tasa_interes_anual,
      tasa_efectividad_recup: dif(v.e[i], pres.e[i]) ? v.e[i] : f.tasa_efectividad_recup,
      tasa_recuperacion_vencida: dif(v.rv[i], pres.rv[i]) ? v.rv[i] : f.tasa_recuperacion_vencida,
      pct_distribucion: dif(v.dist[i], pres.dist[i]) ? v.dist[i] : f.pct_distribucion,
      pct_recuperacion_periodo: dif(v.p[i], pres.p[i]) ? v.p[i] : f.pct_recuperacion_periodo,
      pct_precancelacion: dif(v.q[i], pres.q[i]) ? v.q[i] : f.pct_precancelacion ?? null,
      pct_pase_riesgo: dif(v.pase[i], pres.pase[i]) ? v.pase[i] : f.pct_pase_riesgo ?? null,
      ...(v.qvReal ? { pct_precancelacion_vencida: null } : {}),
    };
  });
}

// =====================================================================
// 21 · OBLIGACIONES CON EL PÚBLICO
// =====================================================================
/**
 * La realidad de las captaciones en los parámetros del motor:
 *   - Ahorro (vista y Crecer, 210135): S_t = (S_{t−1} + depósitos − retiros) × (1 + tasa ÷ 12)
 *       → depósitos − retiros del mes (neto) = S_t ÷ S_{t−1} ÷ (1 + tasa ÷ 12) − 1
 *   - Depósitos a plazo (2103): S_t = S_{t−1} × (1 − cancelaciones + cancelaciones × renovaciones)
 *       → renovaciones = 1 + crecimiento del mes ÷ cancelaciones
 *   - Tasa efectiva = interés del mes (410115 ahorro, 410130 plazo) × 12 ÷ saldo promedio del mes
 * Si el histórico trae el detalle (21013505/10/35 vista, 21013515 Crecer) se separan; si no, el ahorro va junto.
 */
export const PRODUCTOS_CAPT = ["VISTA", "CRECER", "DPF"] as const;
export const NOMBRE_PRODUCTO = ["Ahorro a la vista", "Ahorro Crecer", "Depósitos a plazo"];
const COD_VISTA = ["21013505", "21013510", "21013535"], COD_CRECER = ["21013515"];

export interface MesCapt { p: string; a0: number; a: number; v: number | null; c: number | null; d0: number; d: number; total: number; intA: number | null; intD: number | null; int41: number | null; tasaA: number | null; tasaD: number | null; gA: number; gD: number }
interface ResumenAnioCapt { anio: number; meses: number; ahorro: number; plazo: number; total: number; gAhorro: number | null; gPlazo: number | null; tasaA: number | null; tasaD: number | null; costo: number | null }
interface RealidadCapt {
  anio: number; desde: string; hasta: string; meses: MesCapt[]; ventana: MesCapt[]; separado: boolean;
  gA: number; gD: number; tasaA: number | null; tasaD: number | null; costo: number | null; anual: ResumenAnioCapt[];
}

export function calcularRealidadCapt(h: HistoricoEstudio): RealidadCapt | null {
  const periodos = Object.keys(h.bal).sort();
  const ahorro = (b: Record<string, number>) => b["210135"] ?? b["2101"] ?? 0;
  const meses: MesCapt[] = [];
  for (const p of periodos) {
    const b0 = h.bal[mesAnterior(p)], b1 = h.bal[p];
    if (!b0 || !b1 || !(ahorro(b1) + (b1["2103"] ?? 0))) continue;
    const a0 = ahorro(b0), a = ahorro(b1), d0 = b0["2103"] ?? 0, d = b1["2103"] ?? 0;
    const sep = COD_VISTA.some((k) => b1[k] !== undefined) || COD_CRECER.some((k) => b1[k] !== undefined);
    const intA = delMes(h.er, p, "410115"), intD = delMes(h.er, p, "410130");
    meses.push({
      p, a0, a, d0, d, total: b1["21"] ?? a + d,
      v: sep ? sumaCod(b1, COD_VISTA) : null, c: sep ? sumaCod(b1, COD_CRECER) : null,
      intA, intD, int41: delMes(h.er, p, "4101"),
      tasaA: intA !== null && a0 + a > 2000 ? (Math.abs(intA) * 12) / ((a0 + a) / 2) : null,
      tasaD: intD !== null && d0 + d > 2000 ? (Math.abs(intD) * 12) / ((d0 + d) / 2) : null,
      gA: a0 > 0 ? a / a0 - 1 : 0, gD: d0 > 0 ? d / d0 - 1 : 0,
    });
  }
  if (!meses.length) return null;
  const ult = meses[meses.length - 1], anio = Number(ult.p.slice(0, 4));
  let ventana = meses.filter((m) => m.p.startsWith(`${anio}-`));
  if (ventana.length < 3) ventana = meses.slice(-12);
  const n = ventana.length, v0 = ventana[0];
  const geo = (ini: number, fin: number) => (ini > 0 && fin > 0 ? (fin / ini) ** (1 / n) - 1 : 0);
  const tasa = (f: (m: MesCapt) => number | null, s0: (m: MesCapt) => number, s1: (m: MesCapt) => number) => {
    const ms = ventana.filter((m) => f(m) !== null); if (!ms.length) return null;
    const prom = ms.reduce((t, m) => t + (s0(m) + s1(m)) / 2, 0) / ms.length;
    return prom > 1000 ? (ms.reduce((t, m) => t + Math.abs(f(m) ?? 0), 0) / ms.length) * 12 / prom : null;
  };
  const anios = [...new Set(meses.map((m) => Number(m.p.slice(0, 4))))].sort();
  const anual: ResumenAnioCapt[] = anios.map((y) => {
    const ms = meses.filter((m) => m.p.startsWith(`${y}-`)), u = ms[ms.length - 1], f = ms[0];
    const k = ms.length, er = h.er[u.p], mesesER = Number(u.p.slice(5));
    const pa = ms.reduce((t, m) => t + m.a, 0) / k, pd = ms.reduce((t, m) => t + m.d, 0) / k;
    return {
      anio: y, meses: k, ahorro: u.a, plazo: u.d, total: u.total,
      gAhorro: f.a0 > 0 ? (u.a / f.a0) ** (12 / k) - 1 : null, gPlazo: f.d0 > 0 ? (u.d / f.d0) ** (12 / k) - 1 : null,
      tasaA: er && pa > 1000 ? Math.abs(er["410115"] ?? 0) / mesesER * 12 / pa : null,
      tasaD: er && pd > 1000 ? Math.abs(er["410130"] ?? 0) / mesesER * 12 / pd : null,
      costo: er && pa + pd > 1000 ? Math.abs(er["4101"] ?? 0) / mesesER * 12 / (pa + pd) : null,
    };
  });
  return {
    anio, desde: v0.p, hasta: ult.p, meses, ventana, separado: ult.v !== null,
    gA: geo(v0.a0, ult.a), gD: geo(v0.d0, ult.d),
    tasaA: tasa((m) => m.intA, (m) => m.a0, (m) => m.a), tasaD: tasa((m) => m.intD, (m) => m.d0, (m) => m.d),
    costo: tasa((m) => m.int41, (m) => m.a0 + m.d0, (m) => m.a + m.d), anual,
  };
}

/** Parámetros de captaciones de una versión (promedio de los 12 meses): VISTA, CRECER y DPF. */
export interface VersionCapt { tasa: number[]; ing: number[]; ret: number[]; canc: number; ren: number }

function promProducto(filas: FilaParametroCaptaciones[], p: string, f: (x: FilaParametroCaptaciones) => number | null | undefined) {
  const x = filas.filter((r) => r.producto === p);
  return x.length ? x.reduce((t, r) => t + (Number(f(r)) || 0), 0) / x.length : 0;
}

export function versionPresCapt(filas: FilaParametroCaptaciones[]): VersionCapt {
  return {
    tasa: PRODUCTOS_CAPT.map((p) => promProducto(filas, p, (x) => x.tasa_interes_anual)),
    ing: ["VISTA", "CRECER"].map((p) => promProducto(filas, p, (x) => x.pct_ingresos)),
    ret: ["VISTA", "CRECER"].map((p) => promProducto(filas, p, (x) => x.pct_retiros)),
    canc: promProducto(filas, "DPF", (x) => x.pct_cancelaciones),
    ren: promProducto(filas, "DPF", (x) => x.ratio_renovaciones),
  };
}

/**
 * Versión "ritmo real": tasas efectivas y crecimiento real. Los retiros y las cancelaciones se dejan como el
 * presupuesto (con la contabilidad solo se ve el neto) y se ajustan los depósitos y las renovaciones.
 * Sin detalle vista/Crecer, las dos tasas se escalan en la misma proporción hasta el costo real del ahorro.
 */
export function versionRealCapt(pres: VersionCapt, r: RealidadCapt, saldosIni: { vista: number; crecer: number }): VersionCapt {
  const sV = saldosIni.vista, sC = saldosIni.crecer;
  const tPresA = sV + sC > 0 ? (pres.tasa[0] * sV + pres.tasa[1] * sC) / (sV + sC) : pres.tasa[0];
  const f = r.tasaA !== null && tPresA > 0 ? r.tasaA / tPresA : 1;
  const tasa = [pres.tasa[0] * f, pres.tasa[1] * f, r.tasaD ?? pres.tasa[2]];
  const neto = (i: number) => (1 + r.gA) / (1 + tasa[i] / 12) - 1;
  return {
    tasa,
    // si el ahorro cae más que los retiros del presupuesto, los depósitos quedan en 0 y suben los retiros
    ing: [0, 1].map((i) => Math.max(0, pres.ret[i] + neto(i))),
    ret: [0, 1].map((i) => Math.max(pres.ret[i], -neto(i))),
    canc: pres.canc,
    ren: pres.canc > 0 ? Math.max(0, 1 + r.gD / pres.canc) : pres.ren,
  };
}

/** Filas de parámetros de captaciones de una versión (lo que no cambia conserva sus 12 meses). */
export function filasVersionCapt(filas: FilaParametroCaptaciones[], pres: VersionCapt, v: VersionCapt): FilaParametroCaptaciones[] {
  const dif = (a: number, b: number) => Math.abs(a - b) > 1e-9;
  return filas.map((f) => {
    const i = PRODUCTOS_CAPT.indexOf(f.producto as (typeof PRODUCTOS_CAPT)[number]); if (i < 0) return f;
    const out = { ...f, tasa_interes_anual: dif(v.tasa[i], pres.tasa[i]) ? v.tasa[i] : f.tasa_interes_anual };
    if (i < 2) {
      if (dif(v.ing[i], pres.ing[i])) out.pct_ingresos = v.ing[i];
      if (dif(v.ret[i], pres.ret[i])) out.pct_retiros = v.ret[i];
    } else {
      if (dif(v.canc, pres.canc)) out.pct_cancelaciones = v.canc;
      if (dif(v.ren, pres.ren)) out.ratio_renovaciones = v.ren;
    }
    return out;
  });
}
