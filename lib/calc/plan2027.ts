/**
 * MODELO INTEGRADO DE PLANIFICACIÓN · mes a mes y por producto.
 *
 * Una decisión mueve todo: colocación → asesores → gasto de personal; cartera → intereses y provisión;
 * cobro y recuperación → morosidad, castigos y reversión de provisión; captaciones y cartera → posición con otras
 * oficinas → interés interno; utilidad → patrimonio. El balance siempre cuadra.
 *
 * Escenarios de cada agencia:
 *  - Histórico: como en los últimos 12 meses (calibrado con la contabilidad: 1499, 4402, 5.6.04.10, 5.1.04.50).
 *  - Presupuestado: con los parámetros cargados (tasas, % de recuperación, efectividad, metas de asesores).
 *  - Propuestos: parten de lo presupuestado (si la agencia tiene parámetros cargados; si no, del histórico).
 *      conservador = la mitad del camino hacia el histórico, solo en lo que el histórico es peor que el presupuesto;
 *      medio = un tercio del camino hacia el optimista; optimista = lo que logra el 25 % mejor de las agencias,
 *      nunca peor que el presupuesto. Si cambia un parámetro del presupuesto, los tres escenarios lo arrastran.
 *  - Meta asignada: parte de lo presupuestado y mejora solo lo necesario (nunca empeora una palanca)
 *      para cumplir la parte de la meta de la cooperativa que le toca a la agencia.
 * Todo es puro: corre en el navegador y responde al instante.
 */
import { PRODUCTOS_PLAN, PLAZOS_INICIALES, type BasePlan, type ProductoPlan } from "./planificacion";

export const PROD = PRODUCTOS_PLAN;
export const GRUPOS_GASTO: Record<string, string> = { "4501": "Personal", "4502": "Honorarios", "4503": "Servicios varios", "4504": "Impuestos y aportes", "4505": "Depreciaciones", "4506": "Amortizaciones", "4507": "Otros gastos" };
const NOMBRES: Record<string, string> = {
  "450105": "Remuneraciones mensuales", "450110": "Beneficios sociales", "450115": "Gastos de representación", "450120": "Aportes al IESS", "450125": "Impuesto a la renta del personal",
  "450130": "Pensiones y jubilaciones", "450135": "Fondo de reserva IESS", "450190": "Otros gastos de personal",
  "450205": "Honorarios a directivos", "450210": "Honorarios profesionales", "450290": "Otros honorarios",
  "450305": "Movilización, fletes y embalajes", "450310": "Guardianía", "450315": "Publicidad y propaganda", "450320": "Servicios básicos", "450325": "Seguros", "450330": "Arrendamientos", "450390": "Otros servicios",
  "450405": "Aportes a la Superintendencia", "450410": "Impuestos fiscales", "450415": "Aportes a la SEPS", "450420": "Aportes COSEDE (prima fija)", "450421": "Aportes COSEDE (prima variable)", "450490": "Otros impuestos y contribuciones",
  "450505": "Depreciación bienes arrendados", "450515": "Depreciación edificios", "450525": "Depreciación muebles y equipos", "450530": "Depreciación equipos de computación", "450535": "Depreciación vehículos", "450590": "Otras depreciaciones",
  "450605": "Amortización gastos de constitución", "450615": "Amortización gastos anticipados", "450620": "Amortización gastos de instalación", "450625": "Amortización de adecuaciones", "450630": "Amortización de programas", "450690": "Otras amortizaciones",
  "450705": "Suministros diversos", "450710": "Donaciones", "450715": "Mantenimiento y reparaciones", "450790": "Otros gastos",
};
export const nombreCuenta = (k: string, catalogo?: Record<string, string>) => catalogo?.[k] ?? NOMBRES[k] ?? (k.endsWith("99") ? `${GRUPOS_GASTO[k.slice(0, 4)]} sin detalle` : `Cuenta ${k}`);
/**
 * Cómo se mueve cada gasto: sueldos (personal y asesores), captaciones (seguro de depósitos), fijo (va sí o sí:
 * impuestos, depreciaciones, amortizaciones, servicios básicos, seguros, arriendos, guardianía, directivos) o
 * ajustable (lo que la gerencia puede recortar: publicidad, movilización, suministros, mantenimiento, honorarios…).
 */
type Motor = "sal" | "capt" | "fijo" | "gen";
const FIJOS = new Set(["450205", "450310", "450320", "450325", "450330"]);
export function motor(k: string): Motor {
  if (k.startsWith("4501")) return "sal";
  if (k === "450420" || k === "450421") return "capt";
  if (k.startsWith("4504") || k.startsWith("4505") || k.startsWith("4506") || FIJOS.has(k)) return "fijo";
  return "gen";
}

// ---------------------------------------------------------------------
// Datos de entrada
// ---------------------------------------------------------------------
export interface ParamCredito { tasa: number; pctRec: number; efect: number; recVenc: number; dist: number | null }
export interface EntradaAgencia {
  base: BasePlan;
  mix: [number, number, number];          // asesores Junior, Senior, Master
  credito: Partial<Record<ProductoPlan, ParamCredito>>;
  vistaNeto: number | null;
  capt13: number[];                       // captaciones de los últimos 13 meses (trayectoria)
}
export interface Calib {
  plazo: number[]; tasa: number[]; dist: number[];
  eObs: number; rvObs: number; k: number; pi: number; ppv: number; rhoObs: number; ingMoraRatio: number; cumplObs: number; gObs: number;
  pres: { e: number; rv: number; cumpl: number; gV: number; gP: number; tasa: number[]; dist: number[]; tieneParametros: boolean };
}
export interface Agencia {
  nombre: string; base: BasePlan; mix: [number, number, number]; metas: [number, number, number]; gastos: Record<string, number>; calib: Calib; revBase: number; imoraBase: number;
  /** Sin asesores cargados: la capacidad es la colocación observada (y el cumplimiento, 100 %). */
  capSinAsesores: number;
  /** Estructura del presupuesto 2027 (gastos por cuenta, otros ingresos y gastos, captaciones): base común de todos los escenarios. */
  pres?: BasePresupuesto;
  /** Conciliación: lo que el presupuesto calcula aparte (castigos, provisión por calificación, partidas a mano); igual en todos los escenarios. */
  ajuste: number;
}
export interface BasePresupuesto { gastos: Record<string, number>; nombres?: Record<string, string>; otrosIng: number; otrosGas: number; otrasProv: number | null; captProm: number; capt12: number; util: number }
export interface Supuestos { costoAsesor: number; infl: number; incSal: number }
/** Corridas de una agencia con el motor del presupuesto (lib/calc/plan-motor). */
export interface MotorAgencia { am: unknown; correr(L: Pal): Corrida; util(L: Pal): number }
export interface Mundo { ags: Record<string, Agencia>; sup: Supuestos; motor?: Record<string, MotorAgencia> }
/** Utilidad del año de un escenario (con el motor si la agencia lo tiene). */
function utilDe(M: Mundo, A: Agencia, L: Pal): number { const mo = M.motor?.[A.nombre]; return mo ? mo.util(L) : correr(M, A, L).kpi.util; }

const lim = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const RV_REF = 0.01, PPV = 0.015;

/** Calibra los supuestos observados de una agencia con su contabilidad de los últimos 12 meses. */
export function calibrar(nombre: string, d: EntradaAgencia, metas: [number, number, number]): Agencia | null {
  const b = d.base, ex = b.extra; if (!ex) return null;
  const prods = b.productos, plazo = prods.map((p, i) => { const pr = d.credito[p.nombre]?.pctRec; return pr && pr > 0 && 1 / pr >= 6 && 1 / pr <= 240 ? Math.round(1 / pr) : PLAZOS_INICIALES[PROD[i]]; });
  const pvT = prods.reduce((a, p) => a + p.pv, 0) || 1;
  const a = prods.reduce((s, p, i) => s + p.pv / plazo[i], 0) / pvT;
  const s = ex.serie, n = s.length;
  const PV = s.map((x) => x.pv), V = s.map((x) => x.v);
  const due = PV.slice(0, n - 1).reduce((t, x) => t + a * x, 0), sV = V.slice(0, n - 1).reduce((t, x) => t + x, 0);
  const prov1 = b.provisionCartera, cas = Math.max(0, ex.prov0 + ex.prov4402 - ex.rev12 - prov1);
  const rec = RV_REF * sV, mig = (V[n - 1] - V[0]) + rec + cas, dPV = Math.max(0, PV[n - 1] - PV[0]);
  const coloc = (PV[n - 1] - PV[0]) + due, cap = d.mix.reduce((t, k, j) => t + k * metas[j], 0);
  // tasa efectiva: intereses del año ÷ cartera por vencer promedio del año (la del corte, corregida por el promedio)
  const y0 = `${Number(b.periodo.slice(0, 4)) - 1}-12`, delAnio = s.filter((x) => x.p >= y0), pvProm = delAnio.length ? delAnio.reduce((t, x) => t + x.pv, 0) / delAnio.length : pvT;
  const tasa = prods.map((p) => (p.pv > 0 ? p.ingreso / (p.pv * pvProm / pvT) : 0));
  const sumaCuotas = prods.reduce((t, p, i) => t + (p.pv + p.mora > 1000 ? p.pv / plazo[i] : 0), 0) || 1;
  const distObs = prods.map((p, i) => (p.pv + p.mora > 1000 ? p.pv / plazo[i] / sumaCuotas : 0));
  const c13 = d.capt13, gObs = c13.length >= 2 && c13[0] ? (c13[c13.length - 1] / c13[0]) ** (12 / (c13.length - 1)) - 1 : 0;
  const eObs = n >= 3 && due > 0 ? lim(1 - mig / due, 0.4, 0.995) : 0.9;
  const colocMes = Math.max(0, coloc / Math.max(1, n - 1));
  const cumplObs = cap ? lim(colocMes / cap, 0.15, 1.2) : 1;
  // presupuesto: lo cargado en parámetros; si no hay, lo observado
  const pc = PROD.map((p) => d.credito[p]);
  const tiene = pc.some((x) => x && (x.efect > 0 || x.tasa > 0));
  // promedio ponderado por el saldo de cada producto (por vencer para el cobro, vencida para la recuperación)
  const prom = (f: (x: ParamCredito) => number, peso: (i: number) => number = (i) => prods[i].pv) => {
    let t = 0, w = 0; pc.forEach((x, i) => { if (x && f(x) > 0) { t += f(x) * peso(i); w += peso(i); } });
    return w > 0 ? t / w : null;
  };
  const distP = PROD.map((p, i) => (prods[i].pv + prods[i].mora > 1000 ? pc[i]?.dist ?? null : 0));
  const sumD = distP.reduce((t: number, x) => t + (x ?? 0), 0);
  return {
    nombre, base: b, mix: d.mix, metas, gastos: ex.gastos, revBase: ex.revAn, imoraBase: ex.imoraAn, capSinAsesores: cap ? 0 : colocMes, ajuste: 0,
    calib: {
      plazo, tasa, dist: distObs, eObs, rvObs: RV_REF, k: sV ? cas / sV : 0, pi: mig > 0 ? lim((ex.prov4402 - PPV * dPV) / mig, 0.3, 1.3) : 0.8, ppv: PPV,
      rhoObs: rec > 0 ? lim(ex.rev12 / rec, 0, 0.8) : 0, ingMoraRatio: rec > 0 ? Math.max(0, ex.imora12 / rec) : 0, cumplObs, gObs,
      pres: {
        e: prom((x) => x.efect) ?? eObs, rv: prom((x) => x.recVenc, (i) => prods[i].mora) ?? prom((x) => x.recVenc) ?? RV_REF, cumpl: tiene && cap ? 1 : cumplObs,
        gV: d.vistaNeto !== null ? (1 + d.vistaNeto) ** 12 - 1 : gObs, gP: gObs,
        tasa: PROD.map((p, i) => (pc[i]?.tasa && pc[i]!.tasa > 0 ? pc[i]!.tasa : tasa[i])),
        dist: sumD > 0 ? distP.map((x) => (x ?? 0) / sumD) : distObs, tieneParametros: tiene,
      },
    },
  };
}

// ---------------------------------------------------------------------
// Palancas y corrida
// ---------------------------------------------------------------------
export interface Pal {
  crec: number[] | null; cumpl: number; e: number; rv: number; k: number; gV: number; gP: number; incSal: number; ajGen: number; rho: number;
  asesFijo?: number | null; tasa?: number[] | null; dist?: number[] | null;
}
export type ClavePal = "e" | "rv" | "ajGen" | "cumpl" | "gP";
/** Palancas de gestión (el cumplimiento de la meta de colocación se elige aparte, igual para todos los propuestos). */
export const PALANCAS: ClavePal[] = ["e", "rv", "ajGen", "gP"];
export const NOMBRE_PAL: Record<ClavePal, string> = { e: "Cobrar a tiempo más cuotas", rv: "Recuperar más cartera vencida", ajGen: "Recortar gastos ajustables", cumpl: "Cumplimiento de la meta de colocación", gP: "Captar más a plazo" };
/** Sentido de mejora de cada palanca: +1 subir es mejor, −1 bajar es mejor (recortar gastos). */
const SENTIDO: Record<ClavePal, 1 | -1> = { e: 1, rv: 1, cumpl: 1, ajGen: -1, gP: 1 };
const mejor = (k: ClavePal, a: number, b: number) => (SENTIDO[k] * (a - b) >= 0 ? a : b);
const peor = (k: ClavePal, a: number, b: number) => (SENTIDO[k] * (a - b) <= 0 ? a : b);
export const copiaL = (L: Pal): Pal => ({ ...L, crec: L.crec ? [...L.crec] : null, tasa: L.tasa ? [...L.tasa] : L.tasa, dist: L.dist ? [...L.dist] : L.dist });

export const activos = (A: Agencia) => [0, 1, 2, 3].filter((i) => A.base.productos[i].pv + A.base.productos[i].mora > 1000);
export function tasaInterna(b: BasePlan) { if (b.recibe > 1000 && b.interesInternoPagado) return b.interesInternoPagado / b.recibe; if (b.envia > 1000 && b.interesInternoCobrado) return b.interesInternoCobrado / b.envia; return 0.0703; }

interface Mes { PV: number; V: number; due: number; cob: number; mig: number; rec: number; cas: number; int: number }
function simProd(A: Agencia, i: number, X: number, L: Pal): Mes[] {
  const p = A.base.productos[i], a = 1 / A.calib.plazo[i], tasa = (L.tasa ?? A.calib.tasa)[i];
  let PV = p.pv, V = p.mora; const m: Mes[] = [];
  for (let t = 0; t < 12; t++) {
    const due = PV * a, cob = due * L.e, mig = due - cob, rec = V * L.rv, cas = V * L.k;
    const PV1 = PV - due + X, V1 = V + mig - rec - cas;
    m.push({ PV: PV1, V: V1, due, cob, mig, rec, cas, int: (PV + PV1) / 2 * tasa / 12 });
    PV = PV1; V = V1;
  }
  return m;
}

export interface ER {
  ingProd: number[]; ingOtros: number; ingLiq: number; cobInt: number; costo: number; pagInt: number; otrosGF: number; provCart: number; provOtras: number;
  personal: number; generales: number; det: Record<string, number>; otrosIng: number; reversion: number; ingMora: number; otrosGas: number;
  ingCart: number; ingFin: number; gasFin: number; margen: number; prov: number; util: number; otrosIngTot: number; ajuste: number;
  /** 52, 54, 56 (sin 5604), 5604 y 47 del año */
  cta?: Record<string, number>;
}
export interface Balance { liq: number; cart: number; pv: number; v: number; prov: number; cartNeta: number; envia: number; otrosAct: number; vista: number; plazo: number; otrasCapt: number; capt: number; recibe: number; otrosPas: number; patrimonio: number; totA: number; totP: number }
export interface Kpi { util: number; roa: number; mora: number; efic: number; autof: number; ases: number }
export interface Corrida {
  er: ER; bal: Balance; kpi: Kpi; activoProm: number;
  rec: { due: number; cob: number; mig: number; rec: number; cas: number; vIni: number; vFin: number };
  col: { X: number[]; colMes: number; n0: number; cap: number; nuevos: number; holgura: number; necesarios: number; crecLogrado: number[]; porAsesor: number };
  meses: { coloc: number; due: number; cob: number; mig: number; rec: number; cas: number; cart: number; mora: number; capt: number; util: number; ut: number }[];
  /**
   * Ajustes que solo hace Planificación frente a lo presupuestado (el presupuesto no los calcula):
   * fondeo = interés con otras oficinas por la liquidez que falta o sobra (+ ingreso, − gasto);
   * provMora = provisión adicional por el cambio en el cobro y la recuperación (+ gasto, − menor gasto).
   */
  /** Por línea de crédito (motor): cartera por vencer y en riesgo a diciembre, interés y colocación del año. */
  lin?: { pv: number; r: number; ing: number; col: number }[];
  /** Captaciones del motor a diciembre (vista, Crecer, plazo) e intereses del año (4101, 410115, 410130). */
  capt?: { vista: number; crecer: number; dpf: number; i4101: number; i410115: number; i410130: number };
  /** Castigos del año del modelo de provisión por tramos (Cartera → Provisión). */
  castigos?: number;
  /** Préstamos internos del presupuesto: interés pagado a otras oficinas (41059005) y cobrado (5190), del año. */
  internos?: { pagado: number; cobrado: number };
  ajPlan?: { fondeo: number; provMora: number; tasaInterna: number; tasaBancos: number; factorEntrada: number; liqDif?: number };
}

export function correr(M: Mundo, A: Agencia, L: Pal): Corrida {
  const mo = M.motor?.[A.nombre]; if (mo) return mo.correr(L);
  const b = A.base, c = A.calib, act = activos(A), meta = A.metas, mix = A.mix, n0 = mix[0] + mix[1] + mix[2];
  const sinAses = n0 === 0, cap = sinAses ? A.capSinAsesores : mix.reduce((s, n, j) => s + n * meta[j], 0), dist = L.dist ?? c.dist;
  // 1) Colocación: por la capacidad de los asesores (meta × cumplimiento) o la necesaria para el crecimiento pedido
  const X = [0, 0, 0, 0], crecLogrado = [0, 0, 0, 0];
  const fijo = sinAses ? null : L.asesFijo ?? null;
  const capEf = fijo === null ? cap : cap + (fijo - n0) * (fijo >= n0 ? meta[0] : cap / Math.max(1, n0));
  if (!L.crec || fijo !== null) act.forEach((i) => (X[i] = Math.max(0, capEf) * L.cumpl * dist[i]));
  else act.forEach((i) => {
    const p = b.productos[i], c0 = p.pv + p.mora, f = (x: number) => { const u = simProd(A, i, x, L)[11]; return u.PV + u.V; };
    const f0 = f(0), f1 = f(100000);
    X[i] = Math.max(0, (c0 * (1 + L.crec![i] / 100) - f0) / ((f1 - f0) / 100000));
  });
  const colMes = X.reduce((a, x) => a + x, 0);
  // 2) Asesores: colocación ÷ (meta × cumplimiento); los nuevos entran como Junior
  const extra = fijo !== null ? 0 : L.cumpl > 0 ? colMes / L.cumpl - cap : 0;
  const nuevos = sinAses ? 0 : fijo !== null ? fijo - n0 : extra > meta[0] * 0.05 ? Math.ceil(extra / meta[0] - 0.05) : 0;
  const holgura = !sinAses && fijo === null && extra < 0 && n0 ? -extra / (cap / n0) : 0;
  const P = [0, 1, 2, 3].map((i) => (act.includes(i) ? simProd(A, i, X[i], L) : null));
  act.forEach((i) => { const p = b.productos[i], u = P[i]![11]; crecLogrado[i] = ((u.PV + u.V) / (p.pv + p.mora) - 1) * 100; });

  // 3) Mes a mes: captaciones, liquidez, provisión, fondos con otras oficinas, gastos y utilidad
  const capt0 = b.vista + b.plazo + b.otrasCapt, liqR = capt0 ? b.liquidez / capt0 : 0, liqY = b.liquidez ? b.ingresoLiquidez / b.liquidez : 0;
  const tInt = tasaInterna(b), carteraIni = act.reduce((s, i) => s + b.productos[i].pv + b.productos[i].mora, 0) || 1;
  const carteraT = (t: number) => act.reduce((s, i) => s + (t < 0 ? b.productos[i].pv + b.productos[i].mora : P[i]![t].PV + P[i]![t].V), 0);
  const pvT = (t: number) => act.reduce((s, i) => s + (t < 0 ? b.productos[i].pv : P[i]![t].PV), 0);
  const sum = (t: number, f: keyof Mes) => act.reduce((s, i) => s + P[i]![t][f], 0);
  const prov0 = b.provisionCartera, cartNeta0 = carteraIni - prov0;
  let stockProv = prov0;
  // estructura del presupuesto 2027 (si está calculado) o, sin él, el ritmo del año en curso
  // Base común de todos los escenarios del modelo: lo que hoy cuesta la agencia (ritmo del año en curso) más inflación.
  // El presupuesto oficial se compara aparte (no se mezcla con esta base).
  const PR = undefined as BasePresupuesto | undefined, gastosBase = A.gastos, inflF = 1 + M.sup.infl;
  const otrosIngB = b.otrosIngresos - A.revBase, otrosGasB = b.otrosGastos, otrasProvB = b.otrasProvisiones;
  const otrosAct = b.activo - b.liquidez - cartNeta0 - b.envia;
  const utCorte = b.activo - (capt0 + b.recibe + b.otrosPasivos) - b.patrimonio;
  const gV = (1 + L.gV) ** (1 / 12), gP = (1 + L.gP) ** (1 / 12), pos0 = b.envia - b.recibe;
  let vis = b.vista, pla = b.plazo, pos = pos0, ut = 0, activoSum = 0;
  const er: ER = { ingProd: [0, 0, 0, 0], ingOtros: 0, ingLiq: 0, cobInt: 0, costo: 0, pagInt: 0, otrosGF: b.otrosGastosFin, provCart: 0, provOtras: otrasProvB, personal: 0, generales: 0, det: {},
    otrosIng: otrosIngB, reversion: 0, ingMora: 0, otrosGas: otrosGasB, ingCart: 0, ingFin: 0, gasFin: 0, margen: 0, prov: 0, util: 0, otrosIngTot: 0, ajuste: 0 };
  const meses: Corrida["meses"] = [];
  for (let t = 0; t < 12; t++) {
    const vis1 = vis * gV, pla1 = pla * gP, capt = vis1 + pla1 + b.otrasCapt, captPrev = vis + pla + b.otrasCapt;
    const liq = capt * liqR, liqPrev = captPrev * liqR;
    let ingCart = 0; act.forEach((i) => { er.ingProd[i] += P[i]![t].int; ingCart += P[i]![t].int; });
    const carAvg = (carteraT(t) + carteraT(t - 1)) / 2, recM = sum(t, "rec"), migM = sum(t, "mig"), cas = sum(t, "cas");
    const ingMora = recM * c.ingMoraRatio;
    const ingOtros = (b.ingresoOtrosCartera - A.imoraBase) / 12 * carAvg / carteraIni + ingMora;
    const ingLiq = (liq + liqPrev) / 2 * liqY / 12;
    const costo = ((vis + vis1) / 2 * b.tasaVista + (pla + pla1) / 2 * b.tasaPlazo + b.costoOtrasCapt) / 12;
    const interno = pos * tInt / 12, cob = Math.max(0, interno), pag = Math.max(0, -interno);
    // provisión: se constituye sobre lo que pasa a vencida y sobre el crecimiento; el castigo la consume; al recuperar, una parte se revierte
    const provCart = c.pi * migM + c.ppv * Math.max(0, pvT(t) - pvT(t - 1)), reversion = L.rho * recM;
    stockProv = stockProv + provCart - reversion - cas;
    let personal = 0, generales = 0;
    const captRef = PR ? PR.captProm : capt0;
    for (const [k, v] of Object.entries(gastosBase)) {
      const mo = motor(k), base = v / 12;
      const val = mo === "sal" ? base * (1 + L.incSal) : mo === "capt" ? (captRef ? base * ((captPrev + capt) / 2) / captRef : base) : mo === "fijo" ? base * inflF : base * inflF * (1 + L.ajGen);
      er.det[k] = (er.det[k] ?? 0) + val; if (k.startsWith("4501")) personal += val; else generales += val;
    }
    const nuevoCosto = nuevos * M.sup.costoAsesor / 12; personal += nuevoCosto; er.det.nuevos = (er.det.nuevos ?? 0) + nuevoCosto;
    const util = ingCart + ingOtros + ingLiq + cob - costo - pag - b.otrosGastosFin / 12 - provCart - otrasProvB / 12 - personal - generales + (otrosIngB - otrosGasB) / 12 + reversion;
    ut += util; er.reversion += reversion; er.ingMora += ingMora; er.ingOtros += ingOtros; er.ingLiq += ingLiq; er.cobInt += cob; er.costo += costo; er.pagInt += pag;
    er.provCart += provCart; er.personal += personal; er.generales += generales;
    const cartNeta = carteraT(t) - stockProv;
    pos = pos0 + (capt - capt0) + ut - (liq - b.liquidez) - (cartNeta - cartNeta0);
    activoSum += liq + cartNeta + otrosAct;
    const V = sum(t, "V"), cart = carteraT(t);
    meses.push({ coloc: colMes, due: sum(t, "due"), cob: sum(t, "cob"), mig: migM, rec: recM, cas, cart, mora: cart ? V / cart : 0, capt, util, ut });
    vis = vis1; pla = pla1;
  }
  er.ingCart = er.ingProd.reduce((a, x) => a + x, 0); er.ingFin = er.ingCart + er.ingOtros + er.ingLiq + er.cobInt;
  er.gasFin = er.costo + er.pagInt + er.otrosGF; er.margen = er.ingFin - er.gasFin; er.prov = er.provCart + er.provOtras; er.util = ut; er.otrosIngTot = er.otrosIng + er.reversion;
  const capt = vis + pla + b.otrasCapt, liq = capt * liqR, cart = carteraT(11), V = sum(11, "V");
  const bal: Balance = { liq, cart, pv: cart - V, v: V, prov: stockProv, cartNeta: cart - stockProv, envia: Math.max(0, pos), otrosAct, vista: vis, plazo: pla, otrasCapt: b.otrasCapt, capt,
    recibe: Math.max(0, -pos), otrosPas: b.otrosPasivos, patrimonio: b.patrimonio + utCorte + ut, totA: 0, totP: 0 };
  bal.totA = bal.liq + bal.cartNeta + bal.envia + bal.otrosAct; bal.totP = bal.capt + bal.recibe + bal.otrosPas + bal.patrimonio;
  const suma = (f: "due" | "cob" | "mig" | "rec" | "cas") => meses.reduce((a, m) => a + m[f], 0);
  const activoProm = activoSum / 12;
  return {
    er, bal, activoProm, meses,
    rec: { due: suma("due"), cob: suma("cob"), mig: suma("mig"), rec: suma("rec"), cas: suma("cas"), vIni: act.reduce((s, i) => s + b.productos[i].mora, 0), vFin: V },
    col: { X, colMes, n0, cap, nuevos, holgura, necesarios: n0 + nuevos, crecLogrado, porAsesor: colMes / (n0 + nuevos || 1) },
    kpi: { util: ut, roa: activoProm ? ut / activoProm : 0, mora: cart ? V / cart : 0, efic: (er.personal + er.generales) / Math.max(1, er.margen + er.otrosIngTot), autof: cart ? capt / cart : 0, ases: n0 + nuevos },
  };
}

/** Columna "Real": ritmo anualizado del año en curso (estado de resultados) y saldos al corte (balance). */
export function real(A: Agencia): Pick<Corrida, "er" | "bal" | "kpi"> {
  const b = A.base, act = activos(A), prov0 = b.provisionCartera;
  const cart = act.reduce((s, i) => s + b.productos[i].pv + b.productos[i].mora, 0), V = act.reduce((s, i) => s + b.productos[i].mora, 0);
  const capt0 = b.vista + b.plazo + b.otrasCapt, utCorte = b.activo - (capt0 + b.recibe + b.otrosPasivos) - b.patrimonio;
  const er: ER = { ingProd: b.productos.map((p) => p.ingreso), ingOtros: b.ingresoOtrosCartera, ingLiq: b.ingresoLiquidez, cobInt: b.interesInternoCobrado,
    costo: b.tasaVista * b.vistaProm + b.tasaPlazo * b.plazoProm + b.costoOtrasCapt, pagInt: b.interesInternoPagado, otrosGF: b.otrosGastosFin,
    provCart: b.productos.reduce((a, p) => a + p.provision, 0), provOtras: b.otrasProvisiones, personal: b.personal, generales: b.generales, det: { ...A.gastos },
    otrosIng: b.otrosIngresos - A.revBase, reversion: A.revBase, ingMora: A.imoraBase, otrosGas: b.otrosGastos, ingCart: 0, ingFin: 0, gasFin: 0, margen: 0, prov: 0, util: 0, otrosIngTot: 0, ajuste: 0 };
  er.ingCart = er.ingProd.reduce((a, x) => a + x, 0); er.ingFin = er.ingCart + er.ingOtros + er.ingLiq + er.cobInt;
  er.gasFin = er.costo + er.pagInt + er.otrosGF; er.margen = er.ingFin - er.gasFin; er.prov = er.provCart + er.provOtras; er.otrosIngTot = er.otrosIng + er.reversion;
  er.util = er.margen - er.prov - er.personal - er.generales + er.otrosIngTot - er.otrosGas;
  const otrosAct = b.activo - b.liquidez - (cart - prov0) - b.envia;
  const bal: Balance = { liq: b.liquidez, cart, pv: cart - V, v: V, prov: prov0, cartNeta: cart - prov0, envia: b.envia, otrosAct, vista: b.vista, plazo: b.plazo, otrasCapt: b.otrasCapt, capt: capt0, recibe: b.recibe, otrosPas: b.otrosPasivos, patrimonio: b.patrimonio + utCorte, totA: 0, totP: 0 };
  bal.totA = bal.liq + bal.cartNeta + bal.envia + bal.otrosAct; bal.totP = bal.capt + bal.recibe + bal.otrosPas + bal.patrimonio;
  return { er, bal, kpi: { util: er.util, roa: b.activoProm ? er.util / b.activoProm : 0, mora: cart ? V / cart : 0, efic: (er.personal + er.generales) / Math.max(1, er.margen + er.otrosIngTot), autof: cart ? capt0 / cart : 0, ases: A.mix[0] + A.mix[1] + A.mix[2] } };
}

/** Lleva un escenario a "crecimiento explícito" para que el simulador parta del mismo resultado. */
export function aExplicito(M: Mundo, A: Agencia, L: Pal): Pal { const R = correr(M, A, L); const X = copiaL(L); X.crec = R.col.crecLogrado.map((x) => Math.round(x * 10) / 10); return X; }

// ---------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------
export function escHist(M: Mundo, A: Agencia): Pal {
  // con presupuesto, los sueldos ya vienen con su incremento: el incremento aquí es adicional
  const c = A.calib; return { crec: null, cumpl: c.cumplObs, e: c.eObs, rv: c.rvObs, k: c.k, gV: c.gObs, gP: c.gObs, incSal: M.sup.incSal, ajGen: 0, rho: c.rhoObs };
}
export function escPres(M: Mundo, A: Agencia): Pal {
  const c = A.calib, p = c.pres; return { crec: null, cumpl: p.cumpl, e: p.e, rv: p.rv, k: c.k, gV: p.gV, gP: p.gP, incSal: M.sup.incSal, ajGen: 0, rho: c.rhoObs, tasa: p.tasa, dist: p.dist };
}
/** ¿Los escenarios de la agencia parten del presupuesto? (sí, si tiene parámetros cargados). */
const anclaPres = (A: Agencia) => A.calib.pres.tieneParametros;
/** Punto de partida de los escenarios propuestos y de la meta: lo presupuestado (o el histórico si no hay parámetros). */
export function escBase(M: Mundo, A: Agencia): Pal { return anclaPres(A) ? escPres(M, A) : escHist(M, A); }
/**
 * Cumplimiento de la meta de colocación elegido en Planificación (null = el observado en los últimos 12 meses).
 * Con presupuesto se respeta el sentido de cada escenario frente al cumplimiento presupuestado
 * (Cartera → Colocación → Cumplimiento): el conservador nunca coloca más que el presupuesto; medio, optimista y
 * meta nunca colocan menos.
 */
function fijarCumpl(A: Agencia, X: Pal, cumpl?: number | null, nivel?: "cons" | "medio" | "opt" | "meta") {
  if (cumpl === undefined || !A.mix.some((n) => n > 0)) return;
  const c = cumpl ?? A.calib.cumplObs;
  if (!anclaPres(A) || !nivel) { X.cumpl = c; return; }
  const p = A.calib.pres.cumpl;
  X.cumpl = nivel === "cons" ? Math.min(c, p) : Math.max(c, p);
}
const ORDEN = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];
const posicion = (a: string) => { const i = ORDEN.indexOf(a); return i < 0 ? 99 : i; };
const agencias = (M: Mundo) => Object.keys(M.ags).filter((a) => a !== "Consolidado").sort((x, y) => posicion(x) - posicion(y) || x.localeCompare(y));
const cacheBench = new WeakMap<Mundo, { e: number; cumpl: number }>();
/** Referencias de la cooperativa: lo que logra el 25 % mejor de las agencias. */
export function bench(M: Mundo) {
  let r = cacheBench.get(M);
  if (!r) {
    const q = (f: (c: Calib) => number) => { const v = agencias(M).map((a) => f(M.ags[a].calib)).sort((x, y) => x - y); return v.length ? v[Math.round(0.75 * (v.length - 1))] : 0; };
    r = { e: q((c) => c.eObs), cumpl: q((c) => c.cumplObs) }; cacheBench.set(M, r);
  }
  return r;
}
/** Gasto que se podría ahorrar si la agencia gastara como la cooperativa por cada dólar de activo. */
function ahorroGasto(M: Mundo, A: Agencia) {
  const cons = M.ags["Consolidado"]; let ahorro = 0, total = 0;
  for (const [k, v] of Object.entries(A.gastos)) {
    if (motor(k) !== "gen") continue; total += v;
    if (cons && A.nombre !== "Consolidado" && cons.base.activoProm) ahorro += Math.max(0, v - (cons.gastos[k] ?? 0) / cons.base.activoProm * A.base.activoProm);
  }
  return { ahorro, total };
}
type Objetivo = Record<ClavePal, number>;
/** Optimista: lo alcanzable en un año con referencias de la propia cooperativa (ajustable por el usuario). */
export function objetivo(M: Mundo, A: Agencia): Objetivo {
  const c = A.calib, b = A.base, B = bench(M), g = ahorroGasto(M, A), pr = c.pres.tieneParametros ? c.pres : null;
  // el optimista nunca pide menos que el presupuesto en cobro, recuperación, colocación ni captación
  return {
    e: Math.max(Math.min(0.97, c.eObs + Math.min(0.15, Math.max(0.03, B.e - c.eObs))), pr ? Math.min(pr.e, TOPE_MAX.e) : 0),
    rv: Math.max(c.rvObs * 2.5, 0.025, pr ? Math.min(pr.rv, TOPE_MAX.rv) : 0),
    cumpl: Math.max(c.cumplObs + Math.min(0.15, Math.max(0.10, B.cumpl - c.cumplObs)), pr ? Math.min(pr.cumpl, TOPE_MAX.cumpl) : 0),
    ajGen: g.total ? -Math.min(0.15, Math.max(0.05, g.ahorro / g.total)) : -0.05,
    gP: Math.max(c.gObs + (b.recibe > b.envia && b.tasaPlazo < tasaInterna(b) ? 0.08 : 0), pr ? Math.min(pr.gP, TOPE_MAX.gP) : -1),
  };
}
const interp = (a: number, b: number, f: number) => a + (b - a) * f;
export type Ajustes = Record<string, Partial<Record<ClavePal, number>>>; // nivel (cons|medio|opt) → palanca → valor
const FRAC: Record<string, number> = { hist: 0, cons: 1 / 3, medio: 2 / 3, opt: 1 };
export const TOPE_MAX: Objetivo = { e: 0.98, rv: 0.06, cumpl: 1.0, ajGen: -0.25, gP: 0.3 };

/**
 * Valor de una palanca en un nivel, con el ajuste del usuario si lo hay.
 * Con presupuesto (ancla = presupuestado):
 *   conservador = mitad del camino hacia el histórico, solo si el histórico es peor (nunca mejor que el presupuesto);
 *   medio = un tercio del camino hacia el optimista; optimista = objetivo. Medio y optimista nunca son peores que el presupuesto.
 * Sin presupuesto (propuesta del modelo): del histórico hacia el objetivo (1/3, 2/3, 1), como antes.
 */
function valorNivel(M: Mundo, A: Agencia, nivel: string, k: ClavePal, aj?: Ajustes): number {
  const H = escHist(M, A);
  if (!anclaPres(A)) { if (nivel === "hist") return H[k]; return aj?.[nivel]?.[k] ?? interp(H[k], objetivo(M, A)[k], FRAC[nivel]); }
  const P = escPres(M, A)[k]; if (nivel === "hist") return P;
  const O = mejor(k, objetivo(M, A)[k], P), man = aj?.[nivel]?.[k];
  if (nivel === "cons") return peor(k, man ?? interp(P, peor(k, H[k], P), 0.5), P);
  return mejor(k, man ?? (nivel === "medio" ? interp(P, O, 1 / 3) : O), P);
}
/**
 * Propuesto. Con presupuesto: parte de lo presupuestado y lleva cada palanca a su valor del nivel (el conservador la
 * empeora, medio y optimista la mejoran). Captar más a plazo solo se usa si suma utilidad (captar cuesta).
 * Sin presupuesto: parte del histórico y cada palanca avanza solo si suma utilidad.
 */
export function escProp(M: Mundo, A: Agencia, nivel: "cons" | "medio" | "opt", aj?: Ajustes, cumpl?: number | null): Pal {
  const X = copiaL(escBase(M, A)); fijarCumpl(A, X, cumpl, nivel);
  const ancla = anclaPres(A);
  let u = utilDe(M, A, X);
  for (const k of PALANCAS) {
    const v = valorNivel(M, A, nivel, k, aj); if (Math.abs(v - X[k]) < 1e-9) continue;
    const Y = copiaL(X); Y[k] = v;
    const filtra = !ancla || (k === "gP" && nivel !== "cons");
    if (!filtra || aj?.[nivel]?.[k] !== undefined) { X[k] = v; u = utilDe(M, A, X); continue; }
    const uY = utilDe(M, A, Y); if (uY > u + 1) { X[k] = v; u = uY; }
  }
  return X;
}
/**
 * Meta: parte de lo presupuestado (o del histórico sin presupuesto) y mejora las palancas en orden de prioridad, lo
 * mínimo necesario, hasta llegar a la utilidad pedida (topes = optimista). Ninguna palanca queda peor que en el punto
 * de partida; si el presupuesto ya cumple la meta, no pide cambios.
 */
export function planMeta(M: Mundo, A: Agencia, metaU: number, aj?: Ajustes, cumpl?: number | null) {
  const X = copiaL(escBase(M, A)); fijarCumpl(A, X, cumpl, "meta");
  const pasos: { k: ClavePal; de: number; a: number; aporte: number }[] = [];
  let u = utilDe(M, A, X);
  for (const k of PALANCAS) {
    if (u >= metaU - 1) break;
    const de = X[k], tope = mejor(k, valorNivel(M, A, "opt", k, aj), de); if (Math.abs(tope - de) < 1e-9) continue;
    const Y = copiaL(X); Y[k] = tope;
    const uFull = utilDe(M, A, Y); if (uFull <= u + 1) continue;
    if (uFull >= metaU) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 16; it++) { const md = (lo + hi) / 2, Z = copiaL(X); Z[k] = interp(de, tope, md); if (utilDe(M, A, Z) >= metaU) hi = md; else lo = md; }
      X[k] = interp(de, tope, hi);
    } else X[k] = tope;
    const u2 = utilDe(M, A, X); pasos.push({ k, de, a: X[k], aporte: u2 - u }); u = u2;
  }
  // si aún falta, se avanza hacia el optimista completo (sin empeorar ninguna palanca)
  if (u < metaU - 1) {
    const O = escProp(M, A, "opt", aj, cumpl), uO = utilDe(M, A, O);
    if (uO > u + 1) {
      const X0 = copiaL(X);
      const mezcla = (f: number) => {
        const Z = copiaL(X0);
        for (const c of PALANCAS) Z[c] = mejor(c, interp(X0[c], O[c], f), X0[c]);
        Z.gV = interp(X0.gV, O.gV, f); Z.asesFijo = O.asesFijo ?? X0.asesFijo; return Z;
      };
      let f = 1;
      if (uO >= metaU) { let lo = 0, hi = 1; for (let it = 0; it < 16; it++) { const md = (lo + hi) / 2; if (utilDe(M, A, mezcla(md)) >= metaU) hi = md; else lo = md; } f = hi; }
      const Z = mezcla(f); for (const c of PALANCAS) X[c] = Z[c]; X.gV = Z.gV; X.asesFijo = Z.asesFijo;
      const u2 = utilDe(M, A, X);
      for (const k of PALANCAS) if (Math.abs(X[k] - X0[k]) > 1e-9) pasos.push({ k, de: X0[k], a: X[k], aporte: 0 });
      u = u2;
    }
  }
  return { X, pasos, falta: Math.max(0, metaU - u) };
}

/**
 * Reparto de la meta institucional entre agencias. Parte de lo presupuestado (B = punto de partida: presupuesto, o
 * histórico si la agencia no tiene parámetros): brecha = meta − presupuestado; potencial = optimista − presupuestado;
 * cada agencia cubre la misma parte de su potencial. Si el presupuesto ya cumple la meta, no se exige mejora.
 */
interface FilaReparto { a: string; H: Corrida; Pp: Corrida; B: Corrida; O: Corrida; activo: number; pot: number; asign: number; uso: number }
export function distribucion(M: Mundo, metaRoa: number, ajustes: Record<string, Ajustes>, cumpl: number | null) {
  const F = agencias(M).map((a) => {
    const A = M.ags[a], H = correr(M, A, escHist(M, A)), Pp = correr(M, A, escPres(M, A)), O = correr(M, A, escProp(M, A, "opt", ajustes[a], cumpl));
    const B = anclaPres(A) ? Pp : H;
    return { a, H, Pp, B, O, activo: H.activoProm };
  });
  const activo = F.reduce((s, r) => s + r.activo, 0), metaU = metaRoa * activo;
  const hist = F.reduce((s, r) => s + r.H.kpi.util, 0), pres = F.reduce((s, r) => s + r.Pp.kpi.util, 0), opt = F.reduce((s, r) => s + r.O.kpi.util, 0);
  const base = F.reduce((s, r) => s + r.B.kpi.util, 0);
  const brecha = Math.max(0, metaU - base), pot = F.map((r) => Math.max(0, r.O.kpi.util - r.B.kpi.util)), sPot = pot.reduce((a, x) => a + x, 0);
  const filas: FilaReparto[] = F.map((r, i) => {
    const asign = r.B.kpi.util + (sPot ? Math.min(pot[i], brecha * pot[i] / sPot) : 0);
    return { ...r, pot: pot[i], asign, uso: pot[i] ? (asign - r.B.kpi.util) / pot[i] : 0 };
  });
  return { filas, activo, metaU, hist, pres, base, opt, brecha, sPot, falta: Math.max(0, brecha - sPot) };
}
