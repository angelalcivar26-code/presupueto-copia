/**
 * CARTERA → PROVISIÓN: diagnóstico, puente, ficha y controles (cálculos puros, sin base de datos).
 *
 * Período real: los meses sin alivio (desde el inicio de la ventana de la provisión hasta el último mes cargado).
 *  - Diagnóstico de cada agencia con su balance, su estado de resultados y el reporte de recuperación.
 *  - Puente del gasto neto de provisión, real → presupuesto, un cambio a la vez con el mismo modelo por tramos:
 *      real → cartera 2027 con el comportamiento real → + pase a riesgo del presupuesto → + recuperación del presupuesto
 *      → + meta de provisión = presupuesto. Cada paso es la diferencia entre dos corridas; no hay repartos.
 *  - Mínimo de la norma: saldo de cada tramo × % mínimo de su calificación, frente a la provisión 1499 del presupuesto.
 */
import { calcularRealidad, mesAnterior, LINEAS_ESTUDIO, type HistoricoEstudio } from "./estudio-agencia";
import {
  PRODUCTOS, TRAMOS, proyectarProvisionFlow, rangoNormaTramo,
  type Escenario, type ParametrosFlow, type Producto, type ReferenciaCartera, type SupuestosMora,
} from "./provision-flow";

/** Límite de la política: el gasto de provisión del presupuesto no se aleja más de este % del real (el de Integridad). */
export { LIMITE_RAZONABLE as LIMITE_POLITICA } from "../control-provision";

// ---------------------------------------------------------------------
// Diagnóstico real
// ---------------------------------------------------------------------
export interface MesDiagnostico { p: string; pase: number | null; rec: number | null; gasto: number | null; castigos: number }
export interface Diagnostico {
  desde: string; hasta: string; meses: number;
  cartera: number; riesgo: number; mora: number | null;
  /** Cartera por vencer de cada línea al último mes (orden LINEAS_ESTUDIO). */
  pvLinea: number[];
  /** Pase a riesgo: $ al mes y % de la cartera por vencer del mes anterior. */
  paseUsd: number; pasePv0: number;
  /** Recuperación de vencida (reporte): neto recuperado al mes y capital vencido al mes. */
  recUsd: number; recCap: number;
  provInicio: number; provFin: number;
  porMes: MesDiagnostico[];
}

/** Indicadores reales de una agencia en los meses sin alivio (desde `desde` hasta el último mes del ER, `hasta`). null sin meses con balance. */
export function diagnosticoAgencia(h: HistoricoEstudio, desde: string, hasta?: string | null): Diagnostico | null {
  const z = LINEAS_ESTUDIO.map(() => 0);
  const r = calcularRealidad(h, { p: z, rv: z, meta: 0, desde });
  if (!r) return null;
  const ms = r.meses.filter((m) => (!desde || m.p >= desde) && (!hasta || m.p <= hasta));
  if (!ms.length) return null;
  const ult = ms[ms.length - 1];
  const S = (a: number[]) => a.reduce((t, x) => t + x, 0);
  const cartera = S(ult.pv) + S(ult.r), riesgo = S(ult.r);
  const prov0 = Math.abs(h.bal[mesAnterior(ms[0].p)]?.["1499"] ?? 0);
  return {
    desde: ms[0].p, hasta: ult.p, meses: ms.length,
    cartera, riesgo, mora: cartera > 0 ? riesgo / cartera : null, pvLinea: [...ult.pv],
    paseUsd: ms.reduce((t, m) => t + Math.max(0, S(m.mig)), 0) / ms.length,
    pasePv0: ms.reduce((t, m) => t + S(m.pv0), 0) / ms.length,
    recUsd: ms.reduce((t, m) => t + (m.rep?.netoVen ?? 0), 0) / ms.length,
    recCap: ms.reduce((t, m) => t + (m.rep?.capVen ?? 0), 0) / ms.length,
    provInicio: prov0, provFin: ult.prov,
    porMes: ms.map((m) => {
      const pv0 = S(m.pv0), cap = m.rep?.capVen ?? 0;
      return {
        p: m.p, pase: pv0 > 0 ? Math.max(0, S(m.mig)) / pv0 : null,
        rec: m.rep && cap > 0 ? m.rep.netoVen / cap : null,
        gasto: m.gasto4402 === null ? null : m.gasto4402 - (m.rev ?? 0), castigos: m.cas,
      };
    }),
  };
}

// ---------------------------------------------------------------------
// Puente real → presupuesto
// ---------------------------------------------------------------------
export interface SimulacionFlow {
  inicial: Record<Producto, Record<string, number>>; castigoPorProducto: Record<Producto, number>; totales: Record<Producto, number[]>;
  parametros: ParametrosFlow; parametrosSinMejoras: ParametrosFlow; parametrosSoloPase?: ParametrosFlow; parametrosCartera?: ParametrosFlow;
}
export interface Puente {
  /** Montos al mes (gasto neto de provisión, 4402 − 5604.10). */
  real: number; cartera: number; pase: number; recuperacion: number; meta: number; presupuesto: number;
  /** cartera = modelo + crecimiento. modelo: el modelo con la cartera de hoy (constante) y el comportamiento real, frente al
   *  gasto real (lo que el modelo no reproduce del real); crecimiento: lo que cambia por la cartera presupuestada 2027. */
  modelo: number; crecimiento: number;
  /** Gasto del año sin las mejoras (comportamiento real de la agencia con la cartera 2027): escenario pesimista. */
  sinMejorasAnual: number; presupuestoAnual: number;
}

/**
 * Puente de una agencia. `gastoPresupuesto` = gasto neto del año del presupuesto (el del Estado de resultados);
 * `realMes` = gasto neto real al mes de los meses sin alivio. Cada corrida se mide contra la corrida con los parámetros
 * guardados, así el último paso llega exacto al presupuesto.
 */
export function puenteAgencia(s: SimulacionFlow, escenario: Escenario, mesesPuente: number, gastoPresupuesto: number, realMes: number): Puente {
  const gasto = (par: ParametrosFlow) => {
    const r = proyectarProvisionFlow({ parametros: par, escenario, inicial: s.inicial, castigoMensualPorProducto: s.castigoPorProducto, mesesPuente, totalesEjercicio: s.totales, restarCastigos: true });
    return PRODUCTOS.reduce((t, p) => t + (r[p]?.gastoNeto ?? []).reduce((a, b) => a + b, 0), 0);
  };
  const base = gasto(s.parametros);
  // el mismo modelo con la cartera de hoy constante (sin crecimiento; los castigos no bajan el total)
  const gastoHoy = (par: ParametrosFlow) => {
    const r = proyectarProvisionFlow({ parametros: par, escenario, inicial: s.inicial, castigoMensualPorProducto: s.castigoPorProducto, mesesPuente, totalesEjercicio: null, restarCastigos: false });
    return PRODUCTOS.reduce((t, p) => t + (r[p]?.gastoNeto ?? []).reduce((a, b) => a + b, 0), 0);
  };
  const conv = (par: ParametrosFlow | undefined) => (par ? gastoPresupuesto + gasto(par) - base : gastoPresupuesto);
  const hoy = gastoPresupuesto + gastoHoy(s.parametrosSinMejoras) - base;
  const sin = conv(s.parametrosSinMejoras), soloPase = conv(s.parametrosSoloPase ?? s.parametrosSinMejoras), cart = conv(s.parametrosCartera ?? s.parametros);
  return {
    real: realMes, cartera: sin / 12 - realMes, pase: (soloPase - sin) / 12, recuperacion: (cart - soloPase) / 12, meta: (gastoPresupuesto - cart) / 12,
    presupuesto: gastoPresupuesto / 12, sinMejorasAnual: sin, presupuestoAnual: gastoPresupuesto,
    modelo: hoy / 12 - realMes, crecimiento: (sin - hoy) / 12,
  };
}

/** Suma de puentes (Consolidado). */
export function sumarPuentes(ps: Puente[]): Puente {
  const k: (keyof Puente)[] = ["real", "cartera", "pase", "recuperacion", "meta", "presupuesto", "sinMejorasAnual", "presupuestoAnual", "modelo", "crecimiento"];
  return Object.fromEntries(k.map((c) => [c, ps.reduce((t, p) => t + p[c], 0)])) as unknown as Puente;
}

// ---------------------------------------------------------------------
// Mínimo de la norma
// ---------------------------------------------------------------------
/** Provisión mínima de la norma de cada mes: saldo de cada tramo × % mínimo de sus calificaciones. */
export function minimoNorma(saldos: Partial<Record<Producto, Record<string, number[]>>>, pesos?: Partial<Record<Producto, Record<string, Record<string, number>>>>): number[] {
  return Array.from({ length: 12 }, (_, i) => PRODUCTOS.reduce((t, p) =>
    t + TRAMOS[p].reduce((a, k) => a + (saldos[p]?.[k]?.[i] ?? 0) * rangoNormaTramo(p, k, pesos?.[p]?.[k])[0], 0), 0));
}

// ---------------------------------------------------------------------
// Ficha: qué debe lograr cada línea
// ---------------------------------------------------------------------
export interface LineaFicha { linea: Producto; paseReal: number | null; pase: number | null; menosRiesgo: number | null; recReal: number | null; rec: number | null }
/**
 * Pase a riesgo y recuperación de vencida de cada línea: real (referencia del modelo) y del presupuesto.
 * La recuperación se muestra como en el reporte (% neto recuperado del capital vencido): la real es la del diagnóstico de la
 * agencia; la del presupuesto, la del modelo (% del saldo) ÷ factorVencida.
 * $ menos en riesgo al mes = (pase real − pase 2027) × cartera por vencer de la línea al último mes.
 */
export function lineasFicha(ref: ReferenciaCartera | null | undefined, sup: SupuestosMora | null | undefined, pvLinea: number[], recReal: number | null = null): LineaFicha[] {
  const f = ref?.factorVencida && ref.factorVencida > 0 ? ref.factorVencida : 1;
  return LINEAS_ESTUDIO.map((l, i) => {
    const p = l as Producto;
    const paseReal = ref?.pase?.[p] ?? null, pase = sup?.pase?.[p] ?? null;
    const rv = sup?.rv?.[p];
    return {
      linea: p, paseReal, pase,
      menosRiesgo: paseReal !== null && pase !== null ? (paseReal - pase) * (pvLinea[i] ?? 0) : null,
      recReal: recReal ?? ref?.cv ?? (ref?.rv !== null && ref?.rv !== undefined ? ref.rv / f : null),
      rec: rv === undefined ? null : rv / f,
    };
  }).filter((x) => (pvLinea[LINEAS_ESTUDIO.indexOf(x.linea as (typeof LINEAS_ESTUDIO)[number])] ?? 0) > 1000);
}
