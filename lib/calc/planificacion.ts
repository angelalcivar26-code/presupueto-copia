/**
 * PLANIFICACIÓN por agencia: modelo anual 2027 a partir del ritmo real (balance y ER del último corte, anualizado).
 *
 *  - basePlanificacion(): arma el punto de partida de una oficina desde los históricos (cuentas por producto,
 *    tasas efectivas, costo de captaciones, fondeo interno, gastos). Reproduce exactamente la utilidad anualizada.
 *  - modelo(): aplica las palancas (crecimiento por producto, tasas, morosidad, captación, tasa interna,
 *    asesores, gastos) y devuelve estado de resultados y balance a diciembre que cuadra.
 *  - armarPlan(): combina acciones en orden de prioridad hasta llegar al ROA meta (o todo el potencial).
 * Todo es puro: corre igual en el servidor y en el navegador (el simulador recalcula al instante).
 */
export const PRODUCTOS_PLAN = ["Productivo", "Consumo", "Inmobiliario", "Microcrédito"] as const;
export type ProductoPlan = (typeof PRODUCTOS_PLAN)[number];

export interface ProductoBase { nombre: ProductoPlan; pv: number; mora: number; ingreso: number; provision: number }
export interface BasePlan {
  periodo: string;
  productos: ProductoBase[];
  ingresoOtrosCartera: number;
  vista: number; plazo: number; otrasCapt: number; vistaProm: number; plazoProm: number;
  tasaVista: number; tasaPlazo: number; costoOtrasCapt: number;
  liquidez: number; ingresoLiquidez: number; provisionCartera: number; otrosActivos: number;
  envia: number; recibe: number; otrosPasivos: number; patrimonio: number; activo: number; activoProm: number;
  interesInternoPagado: number; interesInternoCobrado: number; otrosGastosFin: number; otrasProvisiones: number;
  personal: number; generales: number; otrosIngresos: number; otrosGastos: number; utilidad: number;
  crecimientoActual: number;
  /** Versión del cálculo de la base (sube cuando cambia lo que se guarda). */
  version?: number;
  extra?: ExtraBase;
}
/** Insumos del modelo integrado: gastos por subcuenta, cartera de los últimos 13 meses y provisión de 12 meses. */
export interface ExtraBase {
  gastos: Record<string, number>;            // 45xxxx anualizado (y "45xx99" para lo que no tiene detalle)
  serie: { p: string; pv: number; v: number }[]; // cartera por vencer y vencida (no devenga + vencida), 13 meses
  prov0: number; prov4402: number; rev12: number; imora12: number; // 1499 hace 12 meses; 4402, 5.6.04.10 y 5.1.04.50 de 12 meses
  revAn: number; imoraAn: number;            // 5.6.04.10 y 5.1.04.50 del año en curso, anualizados
  /** Otros ingresos y gastos de los últimos 12 meses por subcuenta (42, 47, 53, 54, 55, 56 sin 5604); "xxxx99" = sin detalle. */
  otros?: Record<string, number>;
}
export const VERSION_BASE = 3;
export interface Referencias { roa: number; mora: number; eficiencia: number; autof: number; crec: number; riesgo: number }
export const REFERENCIAS_INICIALES: Referencias = { roa: 0.01, mora: 0.08, eficiencia: 0.70, autof: 1, crec: 0.05, riesgo: 0.04 };
export const PLAZOS_INICIALES: Record<ProductoPlan, number> = { Productivo: 36, Consumo: 36, Inmobiliario: 120, "Microcrédito": 24 };
export interface TopesPlan { recuperacion: number; crecimiento: number; crecimientoProducto: number; asesores: number; gastos: number; tasa: number }
export const TOPES_INICIALES: TopesPlan = { recuperacion: 0.06, crecimiento: 0.15, crecimientoProducto: 0.4, asesores: 0.25, gastos: 0.10, tasa: 0.5 };

/** Contexto de una agencia: base, asesores, plazos y referencias. */
export interface Ctx { base: BasePlan; asesores: number; plazos: Record<ProductoPlan, number>; ref: Referencias; topes: TopesPlan; costoAsesor: number; prodCoop: number }

export interface Palancas {
  crec: number[]; dTasa: number[]; mora: number | null; crecCapt: number; dPasiva: number;
  tasaInterna: number | null; asesores: number; personal: number; generales: number;
}
export const palancas0 = (): Palancas => ({ crec: [0, 0, 0, 0], dTasa: [0, 0, 0, 0], mora: null, crecCapt: 0, dPasiva: 0, tasaInterna: null, asesores: 0, personal: 0, generales: 0 });
const copiar = (L: Palancas): Palancas => ({ ...L, crec: [...L.crec], dTasa: [...L.dTasa] });

// ---------------------------------------------------------------------
// Base desde los históricos
// ---------------------------------------------------------------------
type Cuentas = Record<string, number>;
const v = (c: Cuentas | undefined, k: string) => c?.[k] ?? 0;
/** 14xx → producto: 01/09/17/25/33/41/49/57/65 productivo, 02/10/… consumo, 03/… inmobiliario, 04/… microcrédito. */
function productoDeCuenta(k: string): number | null { const n = Number(k.slice(2)); const r = (n - 1) % 8; return r < 4 ? r : null; }
function carteraPorProducto(b?: Cuentas) {
  const out = [0, 1, 2, 3].map(() => ({ pv: 0, mo: 0 }));
  if (!b) return out;
  for (const [k, x] of Object.entries(b)) {
    if (k.length !== 4 || !k.startsWith("14") || k === "1499") continue;
    const p = productoDeCuenta(k); if (p === null) continue;
    if (Number(k.slice(2)) >= 25) out[p].mo += x; else out[p].pv += x;
  }
  return out;
}
const carteraTotal = (b?: Cuentas) => carteraPorProducto(b).reduce((t, x) => t + x.pv + x.mo, 0);

export function basePlanificacion(datos: Map<string, Cuentas>, oficina: string, periodo: string): BasePlan | null {
  const [y, m] = periodo.split("-").map(Number);
  const b = datos.get(`${oficina}|${periodo}|BAL`), e = datos.get(`${oficina}|${periodo}|ER`);
  if (!b || !e) return null;
  const meses = [`${y - 1}-12`, ...Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`)];
  const bals = meses.map((p) => datos.get(`${oficina}|${p}|BAL`)).filter((x): x is Cuentas => !!x);
  const prom = (f: (c: Cuentas) => number) => bals.reduce((t, c) => t + f(c), 0) / bals.length;
  const an = 12 / m;
  const cp = carteraPorProducto(b);
  const ingP = ["510405", "510410", "510415", "510420"].map((k) => v(e, k) * an);
  const provP = ["440210", "440220", "440230", "440240"].map((k) => v(e, k) * an);
  const vistaProm = prom((c) => v(c, "2101")), plazoProm = prom((c) => v(c, "2103"));
  const dic = datos.get(`${oficina}|${y - 1}-12|BAL`);
  // --- insumos del modelo integrado
  const gastos: Record<string, number> = {};
  for (const [k, x] of Object.entries(e)) if (k.length === 6 && k.startsWith("45")) gastos[k] = x * an;
  for (const g of ["4501", "4502", "4503", "4504", "4505", "4506", "4507"]) {
    const sub = Object.entries(gastos).filter(([k]) => k.startsWith(g)).reduce((t, [, x]) => t + x, 0), tot = v(e, g) * an;
    if (Math.abs(tot - sub) > 1) gastos[g + "99"] = (gastos[g + "99"] ?? 0) + tot - sub;
  }
  const mesAnt = (k: number) => { const d = new Date(y, m - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const serie = Array.from({ length: 13 }, (_, i) => mesAnt(12 - i)).map((p) => {
    const cp = carteraPorProducto(datos.get(`${oficina}|${p}|BAL`));
    return { p, pv: cp.reduce((t, x) => t + x.pv, 0), v: cp.reduce((t, x) => t + x.mo, 0) };
  }).filter((x) => x.pv + x.v > 0);
  // flujo de 12 meses = acumulado del corte + diciembre anterior − mismo mes del año anterior
  const hace12 = mesAnt(12), erDic = datos.get(`${oficina}|${y - 1}-12|ER`), erAnt = datos.get(`${oficina}|${hace12}|ER`);
  const f12 = (k: string) => v(e, k) + (m < 12 ? v(erDic, k) - v(erAnt, k) : 0);
  const otros: Record<string, number> = {};
  const claves = new Set([...Object.keys(e), ...Object.keys(erDic ?? {}), ...Object.keys(erAnt ?? {})]);
  const deOtros = (k: string) => /^(42|47|53|54|55|56)/.test(k) && !k.startsWith("5604");
  for (const k of claves) if (k.length === 6 && deOtros(k)) { const x = f12(k); if (Math.abs(x) > 0.5) otros[k] = x; }
  for (const g of claves) {
    if (g.length !== 4 || !deOtros(g)) continue;
    const sub = Object.entries(otros).filter(([k]) => k.startsWith(g)).reduce((t, [, x]) => t + x, 0), tot = f12(g);
    if (Math.abs(tot - sub) > 1) otros[g + "99"] = (otros[g + "99"] ?? 0) + tot - sub;
  }
  const extra: ExtraBase = {
    gastos, serie, otros, prov0: -v(datos.get(`${oficina}|${hace12}|BAL`), "1499"),
    prov4402: f12("4402"), rev12: f12("560410"), imora12: f12("510450"), revAn: v(e, "560410") * an, imoraAn: v(e, "510450") * an,
  };
  return {
    version: VERSION_BASE, extra,
    periodo,
    productos: PRODUCTOS_PLAN.map((nombre, i) => ({ nombre, pv: cp[i].pv, mora: cp[i].mo, ingreso: ingP[i], provision: provP[i] })),
    ingresoOtrosCartera: (v(e, "510430") + v(e, "510435") + v(e, "510450")) * an,
    vista: v(b, "2101"), plazo: v(b, "2103"), otrasCapt: v(b, "21") - v(b, "2101") - v(b, "2103"), vistaProm, plazoProm,
    tasaVista: vistaProm ? v(e, "410115") * an / vistaProm : 0, tasaPlazo: plazoProm ? v(e, "410130") * an / plazoProm : 0,
    costoOtrasCapt: (v(e, "4101") - v(e, "410115") - v(e, "410130")) * an,
    liquidez: v(b, "11") + v(b, "13"), ingresoLiquidez: (v(e, "5101") + v(e, "5103")) * an,
    provisionCartera: -v(b, "1499"),
    otrosActivos: v(b, "1") - v(b, "11") - v(b, "13") - v(b, "14") - v(b, "1908"),
    envia: v(b, "1908"), recibe: v(b, "2908"),
    otrosPasivos: v(b, "2") - v(b, "21") - v(b, "2908"), patrimonio: v(b, "3"), activo: v(b, "1"),
    activoProm: prom((c) => v(c, "1") - v(c, "1908")),
    interesInternoPagado: v(e, "41059005") * an, interesInternoCobrado: v(e, "51909005") * an,
    otrosGastosFin: (v(e, "41") - v(e, "4101") - v(e, "41059005") + v(e, "42") + v(e, "43")) * an,
    otrasProvisiones: (v(e, "44") - v(e, "4402")) * an,
    personal: v(e, "4501") * an, generales: (v(e, "45") - v(e, "4501")) * an,
    otrosIngresos: (v(e, "5") - v(e, "5104") - v(e, "5101") - v(e, "5103") - v(e, "51909005")) * an,
    otrosGastos: (v(e, "4") - v(e, "41") - v(e, "42") - v(e, "43") - v(e, "44") - v(e, "45")) * an,
    utilidad: (v(e, "5") - v(e, "4")) * an,
    crecimientoActual: dic && carteraTotal(dic) ? (carteraTotal(b) / carteraTotal(dic)) ** (12 / m) - 1 : 0,
  };
}

// ---------------------------------------------------------------------
// Modelo anual
// ---------------------------------------------------------------------
function tasaInternaBase(b: BasePlan): number {
  if (b.recibe > 1000 && b.interesInternoPagado) return b.interesInternoPagado / b.recibe;
  if (b.envia > 1000 && b.interesInternoCobrado) return b.interesInternoCobrado / b.envia;
  return 0.08;
}

export interface ResultadoModelo {
  det: { nombre: ProductoPlan; c0: number; c1: number; ing: number; pr: number; tasa: number }[];
  ingCart: number; ingOtrosCart: number; ingLiq: number; cobInt: number; ingFin: number;
  costoCapt: number; pagInt: number; otrosGastosFin: number; gasFin: number; margen: number;
  prov: number; personal: number; generales: number; otrosIngresos: number; otrosGastos: number; utilidad: number;
  roa: number; mora: number; eficiencia: number; autof: number; cartera: number; capt: number; t1: number;
  asesores: number;
  balance: { liq: number; cartNeta: number; envia: number; otrosAct: number; capt: number; recibe: number; otrosPas: number; patrimonio: number };
}

export function modelo(ctx: Ctx, L: Palancas): ResultadoModelo {
  const b = ctx.base, P = b.productos;
  const cart0 = P.map((p) => p.pv + p.mora), C0 = cart0.reduce((a, x) => a + x, 0) || 1;
  const moraTot0 = P.reduce((a, p) => a + p.mora, 0);
  const mora0 = moraTot0 / C0, mora1 = L.mora === null ? mora0 : L.mora;
  const k = mora0 > 0 ? mora1 / mora0 : 1;
  let ingCart = 0, prov = 0, C1 = 0, Cavg = 0, improd1 = 0;
  const det = P.map((p, i) => {
    const g = L.crec[i] / 100, c1 = cart0[i] * (1 + g), cavg = cart0[i] * (1 + g / 2);
    const r0 = cart0[i] ? p.mora / cart0[i] : 0;
    const im = Math.min(cavg, cavg * r0 * k), prod0 = cart0[i] - p.mora, prod1 = cavg - im;
    const ing = (prod0 > 0 ? p.ingreso * prod1 / prod0 : 0) + prod1 * L.dTasa[i] / 100;
    const pr = cart0[i] ? p.provision * (cavg / cart0[i]) * k : 0;
    ingCart += ing; prov += pr; C1 += c1; Cavg += cavg; improd1 += c1 * r0 * k;
    return { nombre: p.nombre, c0: cart0[i], c1, ing, pr, tasa: (prod0 > 0 ? p.ingreso / prod0 : 0) + L.dTasa[i] / 100 };
  });
  const ingOtrosCart = b.ingresoOtrosCartera * Cavg / C0;
  const cc = L.crecCapt / 100, capt0 = b.vista + b.plazo + b.otrasCapt, capt1 = capt0 * (1 + cc);
  const costoCapt = b.tasaVista * b.vistaProm * (1 + cc / 2) + (b.tasaPlazo + L.dPasiva / 100) * b.plazoProm * (1 + cc / 2) + b.costoOtrasCapt;
  const liq1 = capt0 ? b.liquidez * capt1 / capt0 : b.liquidez, ingLiq = b.ingresoLiquidez * (1 + cc / 2);
  const prov1499 = moraTot0 > 0 ? b.provisionCartera * improd1 / moraTot0 : b.provisionCartera;
  // Fondeo interno: lo que falta (o sobra) para financiar la cartera sale de / va a otras oficinas
  const pos0 = b.envia - b.recibe;
  const pos1 = pos0 - ((liq1 - b.liquidez) + (C1 - C0) - (prov1499 - b.provisionCartera)) + (capt1 - capt0);
  const t0 = tasaInternaBase(b), t1 = L.tasaInterna === null ? t0 : L.tasaInterna;
  const netoInt = (b.interesInternoPagado - b.interesInternoCobrado) * (t0 ? t1 / t0 : 1) - ((pos1 + pos0) / 2 - pos0) * t1;
  const pagInt = Math.max(0, netoInt), cobInt = Math.max(0, -netoInt);
  const personal = b.personal * (1 + L.personal / 100) + L.asesores * ctx.costoAsesor;
  const generales = b.generales * (1 + L.generales / 100);
  const provTot = prov + b.otrasProvisiones;
  const ingFin = ingCart + ingOtrosCart + ingLiq + cobInt, gasFin = costoCapt + pagInt + b.otrosGastosFin, margen = ingFin - gasFin;
  const utilidad = margen - provTot - personal - generales + b.otrosIngresos - b.otrosGastos;
  // Al cierre la utilidad queda en patrimonio y también financia (mueve la posición con otras oficinas)
  const utCorte = b.activo - (capt0 + b.recibe + b.otrosPasivos) - b.patrimonio;
  const posFin = pos1 + (utilidad - utCorte);
  const activo = b.activoProm + (Cavg - C0) + (liq1 - b.liquidez) / 2 + Math.max(0, (pos1 + pos0) / 2) - Math.max(0, pos0);
  return {
    det, ingCart, ingOtrosCart, ingLiq, cobInt, ingFin, costoCapt, pagInt, otrosGastosFin: b.otrosGastosFin, gasFin, margen,
    prov: provTot, personal, generales, otrosIngresos: b.otrosIngresos, otrosGastos: b.otrosGastos, utilidad,
    roa: activo ? utilidad / activo : 0, mora: mora1, eficiencia: (personal + generales) / Math.max(1, margen + b.otrosIngresos),
    autof: C1 ? capt1 / C1 : 0, cartera: C1, capt: capt1, t1, asesores: ctx.asesores + L.asesores,
    balance: { liq: liq1, cartNeta: C1 - prov1499, envia: Math.max(0, posFin), otrosAct: b.otrosActivos, capt: capt1, recibe: Math.max(0, -posFin), otrosPas: b.otrosPasivos, patrimonio: b.patrimonio + utilidad },
  };
}

/** Colocación anual estimada por producto = cuotas que se cobran (cartera ÷ plazo) + crecimiento neto. Sin palancas: ritmo actual. */
export function colocacion(ctx: Ctx, L: Palancas | null) {
  const por: Partial<Record<ProductoPlan, { coloc: number; cuotas: number; crec: number }>> = {};
  let total = 0;
  ctx.base.productos.forEach((p, i) => {
    const c0 = p.pv + p.mora; if (c0 < 1000) return;
    const g = L ? L.crec[i] / 100 : ctx.base.crecimientoActual;
    const cuotas = c0 * (1 + g / 2) * 12 / (ctx.plazos[p.nombre] || 36);
    const coloc = Math.max(0, cuotas + c0 * g);
    por[p.nombre] = { coloc, cuotas, crec: c0 * g }; total += coloc;
  });
  return { por, total };
}

const margenProducto = (p: ProductoBase) => { const t = p.pv + p.mora; return t ? (p.ingreso - p.provision) / t : -1; };

interface Paso { id: string; nombre: string; aplica: (L: Palancas, f: number) => void }
function pasosPlan(ctx: Ctx): Paso[] {
  const b = ctx.base, A = modelo(ctx, palancas0()), T = ctx.topes;
  const C0 = b.productos.reduce((a, p) => a + p.pv + p.mora, 0) || 1;
  const pos0 = b.envia - b.recibe;
  const moraObj = A.mora > ctx.ref.mora ? Math.max(ctx.ref.mora, A.mora - T.recuperacion) : A.mora;
  const G = Math.min(T.crecimiento, Math.max(0.08, pos0 > 0 ? 0.7 * pos0 / C0 : 0.08));
  const orden = b.productos.map((p, i) => ({ i, m: margenProducto(p), c: p.pv + p.mora })).filter((x) => x.c > 1000).sort((x, y) => y.m - x.m);
  const nuevo = C0 * G, crec = [0, 0, 0, 0];
  const asignar = (x: { i: number; c: number }, monto: number) => { const cab = Math.max(0, x.c * T.crecimientoProducto - x.c * crec[x.i] / 100); const val = Math.min(monto, cab); crec[x.i] += val / x.c * 100; return val; };
  let resto = nuevo;
  if (orden[0]) resto -= asignar(orden[0], nuevo * 0.6);
  for (let vuelta = 0; vuelta < 4 && resto > 1; vuelta++) {
    const libres = orden.filter((x) => x.c * T.crecimientoProducto - x.c * crec[x.i] / 100 > 1); const tot = libres.reduce((a, y) => a + y.c, 0); if (!tot) break;
    const r0 = resto; libres.forEach((x) => { resto -= asignar(x, r0 * x.c / tot); });
  }
  const capt0 = b.vista + b.plazo + b.otrasCapt;
  const crecCapt = pos0 > 0 || !capt0 ? 0 : Math.min(30, nuevo * 0.8 / capt0 * 100);
  const prodAsesor = Math.max(colocacion(ctx, null).total / Math.max(1, ctx.asesores), ctx.prodCoop);
  const pasos: (Paso & { activo: boolean })[] = [
    { id: "rec", nombre: "Recuperar cartera vencida", aplica: (L, f) => { L.mora = A.mora - f * (A.mora - moraObj); }, activo: moraObj < A.mora },
    { id: "crec", nombre: `Crecer la cartera priorizando ${orden[0] ? b.productos[orden[0].i].nombre : ""}`, aplica: (L, f) => {
        L.crec = crec.map((x) => x * f);
        const col = colocacion(ctx, L).total, n0 = Math.max(1, ctx.asesores);
        L.asesores = Math.min(Math.max(1, Math.round(n0 * T.asesores)), Math.max(0, Math.ceil(col / Math.max(1, prodAsesor)) - n0));
      }, activo: orden.length > 0 },
    { id: "capt", nombre: "Financiar el crecimiento con captación propia", aplica: (L, f) => { L.crecCapt = crecCapt * f; }, activo: crecCapt > 0 },
    { id: "gasto", nombre: "Contener el gasto operativo", aplica: (L, f) => { L.generales = -T.gastos * 100 * f; L.personal = -3 * f; }, activo: A.eficiencia > ctx.ref.eficiencia },
    { id: "tasa", nombre: "Ajustar la tasa activa", aplica: (L, f) => { L.dTasa = [1, 1, 1, 1].map(() => T.tasa * f); }, activo: true },
  ];
  return pasos.filter((p) => p.activo);
}

type ModoPlan = "meta" | "potencial";
interface Plan { L: Palancas; M: ResultadoModelo; A: ResultadoModelo; puente: { nombre: string; u: number }[]; alcanzada: boolean; falta: number }
export function armarPlan(ctx: Ctx, meta: number, modo: ModoPlan): Plan {
  const A = modelo(ctx, palancas0());
  let L = palancas0(); L.mora = A.mora; L.tasaInterna = A.t1;
  const puente = [{ nombre: "Utilidad con el ritmo actual", u: A.utilidad }];
  let alcanzada = A.roa >= meta && modo === "meta";
  for (const p of pasosPlan(ctx)) {
    if (alcanzada) break;
    const prueba = (f: number) => { const X = copiar(L); p.aplica(X, f); return X; };
    const full = prueba(1), mFull = modelo(ctx, full);
    if (modo === "meta" && mFull.roa >= meta) {
      let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const md = (lo + hi) / 2; if (modelo(ctx, prueba(md)).roa >= meta) hi = md; else lo = md; }
      L = prueba(hi); alcanzada = true;
    } else if (modo === "potencial" && mFull.utilidad < modelo(ctx, L).utilidad) continue;
    else L = full;
    puente.push({ nombre: p.nombre, u: modelo(ctx, L).utilidad });
  }
  const M = modelo(ctx, L);
  const activo = M.roa ? M.utilidad / M.roa : 0;
  return { L, M, A, puente, alcanzada: M.roa >= meta - 1e-9, falta: Math.max(0, meta * activo - M.utilidad) };
}
