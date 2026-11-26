/**
 * PLANIFICACIÓN CON EL MOTOR DEL PRESUPUESTO.
 *
 * Todos los escenarios se calculan con el mismo motor que produce el Estado de resultados y el Balance del
 * presupuesto (lib/calc/orquestador), con los saldos de cada cuenta. Así "Presupuestado" es exactamente el
 * presupuesto y los demás escenarios solo cambian la gestión:
 *   - cumplimiento de la meta de colocación (escala las metas de los asesores),
 *   - asesores (se agregan o quitan oficiales Junior, con su costo en 4501),
 *   - cuotas cobradas a tiempo y recuperación de la vencida (parámetros de cartera),
 *   - crecimiento de captaciones (parámetros de vista, crecer y DPF),
 *   - gastos ajustables (presupuesto departamental de las cuentas que la gerencia puede recortar).
 * Los supuestos observados (histórico) salen de la calibración con los históricos (lib/calc/plan2027).
 */
import {
  construirTodosLosMotores, calcularEstadoResultadosMatriz, calcularBalanceGeneralMatriz, cumplimientoColocacionDe, type FilaParametroOtrosPasivo,
  type FilaParametroCredito, type FilaParametroCaptaciones, type FilaPresupuestoDepartamental, type FilaOficialCredito, type FilaEmpleadoNomina,
} from "./orquestador";
import { desempaquetar, type InsumosMotor, type PaqueteMotor } from "./paquete-motor";
import { ingresos51De } from "./ingresos-51";
import { motor, nombreCuenta, tasaInterna, type Agencia, type Pal, type Corrida, type ER, type Balance, type MotorAgencia, type Mundo, escPres } from "./plan2027";

interface Nodo { codigo: string; label: string; valores: number[]; hijos?: Nodo[] }
const buscar = (n: Nodo | undefined, c: string): Nodo | undefined => { if (!n) return; if (n.codigo === c) return n; for (const h of n.hijos ?? []) { const r = buscar(h, c); if (r) return r; } };
const fin = (n?: Nodo) => n?.valores?.[11] ?? 0;
const v12 = (n?: Nodo) => n?.valores ?? Array(12).fill(0);
const LINEAS = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as const;

/** Una agencia lista para el motor: sus insumos del presupuesto, la calibración y los valores del presupuesto. */
export interface AgenciaMotor {
  A: Agencia; ins: InsumosMotor; n0: number; costoAsesor: number;
  ref: { e: number; rv: number; gV: number; gP: number; cumpl: number }; // promedios del presupuesto (referencia de los desplazamientos)
  /** Liquidez (caja + bancos + inversiones del Flujo) de cada mes con lo presupuestado: referencia del fondeo. */
  liqRef: number[];
}

/** Efectividad equivalente: con % de pase a riesgo propio, la que daría ese mismo pase con la fórmula de cuotas. */
const eEq = (x: FilaParametroCredito) => (x.pct_pase_riesgo !== null && x.pct_pase_riesgo !== undefined && x.pct_recuperacion_periodo > 0 ? 1 - x.pct_pase_riesgo / x.pct_recuperacion_periodo : x.tasa_efectividad_recup);
/** Promedio de la efectividad equivalente (sin pase propio es la misma efectividad de siempre). */
const promEq = (filas: FilaParametroCredito[]) => { const sinPase = !filas.some((x) => x.pct_pase_riesgo !== null && x.pct_pase_riesgo !== undefined); if (sinPase) return prom(filas, (x) => x.tasa_efectividad_recup); const v = filas.filter((x) => x.pct_recuperacion_periodo > 0 || x.tasa_efectividad_recup > 0).map(eEq); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0; };
const prom = (filas: FilaParametroCredito[], f: (x: FilaParametroCredito) => number) => { const v = filas.map(f).filter((x) => x > 0); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0; };

/** Prepara una agencia: valores de referencia del presupuesto (para mover los parámetros a partir de ellos). */
function prepararAgencia(A: Agencia, ins: InsumosMotor, costoAsesor: number): AgenciaMotor {
  const base = construirTodosLosMotores(ins.saldos, ins.paramsCaptaciones, ins.paramsCredito, ins.filasPresupuesto, ins.empleados, A.nombre, ins.oficialesCredito, ins.metasCredito, ins.factoresDepreciacion, ins.parametrosOtrosPasivo);
  const c = base.captaciones, ini = (r: { saldoInicial: number }[]) => r[0]?.saldoInicial ?? 0, finR = (r: { saldoFinal: number }[]) => r[11]?.saldoFinal ?? 0;
  const vIni = ini(c.vista) + ini(c.crecer), vFin = finR(c.vista) + finR(c.crecer), dIni = ini(c.dpf), dFin = finR(c.dpf);
  return {
    A, ins, costoAsesor, n0: ins.oficialesCredito.filter((o) => o.activo === 1).length,
    liqRef: base.flujoEfectivo.map((r: { saldo_final: number }) => r.saldo_final),
    ref: {
      e: promEq(ins.paramsCredito), rv: prom(ins.paramsCredito, (x) => x.tasa_recuperacion_vencida), gV: vIni ? vFin / vIni - 1 : 0, gP: dIni ? dFin / dIni - 1 : 0,
      // % de cumplimiento de la meta de colocación presupuestado (Cartera → Colocación → Cumplimiento), promedio del año
      cumpl: cumplimientoColocacionDe(ins.parametrosOtrosPasivo).reduce((a, x) => a + x, 0) / 12,
    },
  };
}

/** Palancas → insumos del motor (copias; los insumos guardados no se tocan). */
/** Asesores: los nuevos entran como Junior (con su costo en 450105); si se reducen, salen primero los Junior. */
function conAsesores(am: AgenciaMotor, nObj: number, filas: FilaPresupuestoDepartamental[]) {
  const dif = Math.round(nObj - am.n0);
  let oficialesCredito: FilaOficialCredito[] = am.ins.oficialesCredito, filasPresupuesto = filas;
  if (dif > 0) oficialesCredito = [...oficialesCredito, ...Array.from({ length: dif }, () => ({ rango: "JUNIOR" as const, activo: 1 }))];
  else if (dif < 0) { let quitar = -dif; oficialesCredito = [...oficialesCredito].sort((a, b) => (a.rango === "JUNIOR" ? -1 : 0) - (b.rango === "JUNIOR" ? -1 : 0)).filter((o) => !(o.activo === 1 && quitar > 0 && quitar-- > 0)); }
  if (dif !== 0) filasPresupuesto = [...filasPresupuesto, ...Array.from({ length: 12 }, (_, i) => ({ departamento: "Planificación", concepto: "450105", cuenta_nombre: "Asesores de crédito (planificación)", mes: i + 1, monto: dif * am.costoAsesor / 12 }))];
  return { oficialesCredito, filasPresupuesto };
}

function aplicar(am: AgenciaMotor, L: Pal) {
  const { ins, ref } = am;
  const lim = (x: number) => Math.max(0, Math.min(1, x));
  const dE = Math.abs(L.e - ref.e) > 1e-9 ? L.e - ref.e : 0, dR = Math.abs(L.rv - ref.rv) > 1e-9 ? L.rv - ref.rv : 0;
  // con pase a riesgo propio, cobrar mejor (dE) reduce el pase en la misma proporción de las cuotas
  const paramsCredito: FilaParametroCredito[] = dE || dR ? ins.paramsCredito.map((f) => ({
    ...f, tasa_efectividad_recup: lim(f.tasa_efectividad_recup + dE), tasa_recuperacion_vencida: lim(f.tasa_recuperacion_vencida + dR),
    ...(f.pct_pase_riesgo !== null && f.pct_pase_riesgo !== undefined && dE ? { pct_pase_riesgo: Math.max(0, f.pct_pase_riesgo - dE * f.pct_recuperacion_periodo) } : {}),
  })) : ins.paramsCredito;
  // captaciones: el crecimiento mensual del presupuesto se desplaza hasta el crecimiento pedido
  const mes = (g: number) => (1 + g) ** (1 / 12) - 1;
  const dV = Math.abs(L.gV - ref.gV) > 1e-9 ? mes(L.gV) - mes(ref.gV) : 0, dP = Math.abs(L.gP - ref.gP) > 1e-9 ? mes(L.gP) - mes(ref.gP) : 0;
  const paramsCaptaciones: FilaParametroCaptaciones[] = dV || dP ? ins.paramsCaptaciones.map((f) => {
    if ((f.producto === "VISTA" || f.producto === "CRECER") && dV) return { ...f, pct_ingresos: (f.pct_ingresos ?? 0) + dV };
    if (f.producto === "DPF" && dP) { const cc = f.pct_cancelaciones ?? 0; return cc > 0 ? { ...f, ratio_renovaciones: Math.max(0, (f.ratio_renovaciones ?? 1) + dP / cc) } : f; }
    return f;
  }) : ins.paramsCaptaciones;
  // gastos ajustables
  let filasPresupuesto: FilaPresupuestoDepartamental[] = ins.filasPresupuesto;
  if (Math.abs(L.ajGen) > 1e-9) filasPresupuesto = filasPresupuesto.map((f) => { const k = String(f.concepto).replace(/\D/g, "").slice(0, 6); return k.startsWith("45") && k.length >= 6 && motor(k) === "gen" && !CALCULADAS.test(k) ? { ...f, monto: f.monto * (1 + L.ajGen) } : f; });
  const as = conAsesores(am, L.asesFijo ?? am.n0, filasPresupuesto), oficialesCredito = as.oficialesCredito;
  filasPresupuesto = as.filasPresupuesto;
  // cumplimiento de la meta de colocación: se mueve el parámetro del presupuesto (Cartera → Colocación → Cumplimiento)
  // en la misma proporción en los 12 meses, hasta el cumplimiento promedio pedido
  let parametrosOtrosPasivo: FilaParametroOtrosPasivo[] = ins.parametrosOtrosPasivo;
  if (Math.abs(L.cumpl - am.ref.cumpl) > 1e-9) {
    const base = cumplimientoColocacionDe(ins.parametrosOtrosPasivo), f = am.ref.cumpl > 1e-9 ? L.cumpl / am.ref.cumpl : null;
    parametrosOtrosPasivo = [
      ...ins.parametrosOtrosPasivo.filter((x) => x.concepto !== "colocacion_pct_cumplimiento"),
      ...base.map((x, i) => ({ concepto: "colocacion_pct_cumplimiento", mes: i + 1, monto: Math.max(0, f === null ? L.cumpl : x * f) })),
    ];
  }
  return [ins.saldos, paramsCaptaciones, paramsCredito, filasPresupuesto, ins.empleados, am.A.nombre, oficialesCredito, ins.metasCredito, ins.factoresDepreciacion, parametrosOtrosPasivo] as const;
}
type Motores = ReturnType<typeof construirTodosLosMotores>;
interface AjustePlan { fondeoMes: number[]; provMes: number[]; provStock: number[]; tasaInterna: number; tasaBancos: number; factorEntrada: number; liqDif: number }

/**
 * 1) Mora: los tramos de mora (flow rates) reaccionan al cobro y a la recuperación del escenario.
 *    - Entrada a la mora: factor = 1 + (efectividad presupuestada − efectividad del escenario) ÷ (1 − efectividad observada),
 *      sobre los tramos de entrada (los mismos que mueve el Optimista/Pesimista de Provisiones). Tope 0,2 – 3.
 *    - Recuperación de vencida: el paso a los tramos más profundos se multiplica por (1 − rv escenario × n) ÷ (1 − rv presupuesto × n),
 *      con n = meses de permanencia del tramo anterior (lo que se recupera antes de rodar ya no rueda).
 *    El ajuste es la diferencia de provisión con el mismo modelo y la misma cartera: con lo presupuestado es 0.
 * 2) Fondeo: la liquidez que falta (o sobra) frente al presupuesto se toma de (o se presta a) otras oficinas a la tasa
 *    interna; como el motor ya deja de ganar (o gana) el interés de bancos sobre esa liquidez, se aplica la diferencia
 *    (tasa interna − tasa de bancos), sobre la posición del mes anterior.
 */
function ajustesPlan(am: AgenciaMotor, L: Pal, args: ReturnType<typeof aplicar>, m: Motores): AjustePlan {
  const cero = () => Array(12).fill(0) as number[];
  const ti = tasaInterna(am.A.base), i51 = ingresos51De(am.ins.saldos);
  // tasaBancosPorMes está en % anual (0,35 = 0,35 %); la tasa interna, en fracción (0,08 = 8 %)
  const tb = i51?.tasaBancosPorMes?.length ? i51.tasaBancosPorMes.reduce((a, x) => a + x, 0) / i51.tasaBancosPorMes.length / 100 : 0;
  // fondeo
  const liq = m.flujoEfectivo.map((r: { saldo_final: number }) => r.saldo_final);
  const fondeoMes = cero();
  for (let t = 1; t < 12; t++) fondeoMes[t] = ((liq[t - 1] ?? 0) - (am.liqRef[t - 1] ?? 0)) * (ti - tb) / 12;
  // mora: el modelo de provisión ya reacciona a los supuestos de cartera de la versión (pase a riesgo y recuperación de
  // vencida frente a lo real de la agencia) dentro del motor del presupuesto; aquí no se ajusta nada aparte.
  const provMes = cero(), provStock = cero();
  void L; void args;
  const fe = 1;
  const liqDif = Array.from({ length: 11 }, (_, t) => (liq[t] ?? 0) - (am.liqRef[t] ?? 0)).reduce((a, x) => a + x, 0) / 11;
  return { fondeoMes, provMes, provStock, tasaInterna: ti, tasaBancos: tb, factorEntrada: fe, liqDif };
}
const sum12 = (x: number[]) => x.reduce((a, v) => a + v, 0);

/** Solo la utilidad del año (para búsquedas), con los ajustes de planificación. */
function utilidad(am: AgenciaMotor, L: Pal): number {
  const args = aplicar(am, L), m = construirTodosLosMotores(...args), aj = ajustesPlan(am, L, args, m);
  return fin(calcularEstadoResultadosMatriz(...args).resultadoDelEjercicio as Nodo) + sum12(aj.fondeoMes) - sum12(aj.provMes);
}

/** Corrida completa con el motor, en el mismo formato que usan las pantallas. */
function correrMotor(am: AgenciaMotor, L: Pal, argsDados?: ReturnType<typeof aplicar>): Corrida {
  const args = argsDados ?? aplicar(am, L);
  const m = construirTodosLosMotores(...args);
  const er = calcularEstadoResultadosMatriz(...args) as unknown as { egresos: Nodo; ingresos: Nodo; resultadoDelEjercicio: Nodo };
  const bl = calcularBalanceGeneralMatriz(...args) as unknown as { activo: Nodo; pasivo: Nodo; patrimonio: Nodo };
  const E = er.egresos, I = er.ingresos;
  const ingProd = LINEAS.map((_, i) => m.lineasCartera[i].ingresoPorInteres.reduce((a: number, x: number) => a + x, 0));
  const ingCartBase = ingProd.reduce((a, x) => a + x, 0);
  const i51 = fin(buscar(I, "51")), i5104 = fin(buscar(I, "5104")), i5190 = fin(buscar(I, "5190")), e41 = fin(buscar(E, "41"));
  const e44 = fin(buscar(E, "44")), e4402 = fin(buscar(E, "4402")) || e44, e45 = fin(buscar(E, "45")), e4501 = fin(buscar(E, "4501"));
  // interés pagado a otras oficinas (préstamos internos, 41059005)
  const e4105 = fin(buscar(E, "4105")) || fin(buscar(E, "41059005"));
  const r560410 = fin(buscar(I, "560410"));
  const det: Record<string, number> = {};
  const hojas = (n: Nodo): Nodo[] => (n.hijos?.length ? n.hijos.flatMap(hojas) : [n]);
  for (const G of buscar(E, "45")?.hijos ?? []) {
    const g = G.codigo.replace(/\D/g, "").slice(0, 4); let suma = 0;
    if (G.hijos?.length) for (const h of hojas(G)) { const d = h.codigo.replace(/\D/g, ""), k = d.length >= 6 && d.startsWith(g) ? d.slice(0, 6) : `${g}99`; det[k] = (det[k] ?? 0) + fin(h); suma += fin(h); }
    const resto = fin(G) - suma; if (Math.abs(resto) > 1) det[`${g}99`] = (det[`${g}99`] ?? 0) + resto;
  }
  const aj = ajustesPlan(am, L, args, m), fondeo = sum12(aj.fondeoMes), provMora = sum12(aj.provMes);
  const util = fin(er.resultadoDelEjercicio) + fondeo - provMora;
  const ingOtrosFin = i51 - i5104 - i5190;
  const erOut: ER = {
    ingProd: [...ingProd], ingOtros: i5104 - ingCartBase, ingLiq: ingOtrosFin, cobInt: i5190 + Math.max(0, fondeo), costo: e41 - e4105, pagInt: e4105 + Math.max(0, -fondeo), otrosGF: fin(buscar(E, "42")),
    provCart: e4402 + provMora, provOtras: e44 - e4402, personal: e4501, generales: e45 - e4501, det, otrosIng: fin(I) - i51 - r560410, reversion: r560410, ingMora: i5104 - ingCartBase,
    otrosGas: fin(E) - e41 - fin(buscar(E, "42")) - e44 - e45, ingCart: ingCartBase, ingFin: i51 + Math.max(0, fondeo), gasFin: e41 + Math.max(0, -fondeo) + fin(buscar(E, "42")), margen: i51 - e41 - fin(buscar(E, "42")) + fondeo,
    prov: e44 + provMora, util, otrosIngTot: fin(I) - i51, ajuste: 0,
    // otros ingresos y gastos (Estudio de agencia): 56 sin la recuperación y la reversión del modelo de provisión (5604)
    cta: { "52": fin(buscar(I, "52")), "54": fin(buscar(I, "54")), "56": fin(buscar(I, "56")) - fin(buscar(I, "560405")) - r560410, "5604": fin(buscar(I, "560405")) + r560410, "47": fin(buscar(E, "47")),
      "51": i51, "5101": fin(buscar(I, "5101")), "5103": fin(buscar(I, "5103")), "5104": i5104, "5190": i5190,
      // grupos del estado de resultados (Resumen del estudio)
      "41": e41, "42": fin(buscar(E, "42")), "44": e44, "45": e45, "4648": fin(E) - e41 - fin(buscar(E, "42")) - e44 - e45 - fin(buscar(E, "47")), "5256": fin(I) - i51 },
  };
  // balance a diciembre
  const lc = m.lineasCartera, pvT = (t: number) => lc.reduce((a: number, r: { porVencer: { saldoFinal: number }[] }) => a + r.porVencer[t].saldoFinal, 0), riT = (t: number) => lc.reduce((a: number, r: { enRiesgo: { saldoFinal: number }[] }) => a + r.enRiesgo[t].saldoFinal, 0);
  const A1 = bl.activo, P2 = bl.pasivo, P3 = bl.patrimonio;
  const n21 = buscar(P2, "21"), vista = (n21?.hijos ?? []).filter((h) => /vista|crecer/i.test(h.label)).reduce((a, h) => a + fin(h), 0), plazo = fin(n21?.hijos?.find((h) => /plazo/i.test(h.label)));
  const liq = fin(buscar(A1, "11")) + fin(buscar(A1, "13")), c14 = fin(buscar(A1, "14")), e1908 = fin(buscar(A1, "1908"));
  const cart = pvT(11) + riT(11), v = riT(11), dProv = aj.provStock[11];
  const bal: Balance = {
    liq: liq + fondeo, cart, pv: pvT(11), v, prov: cart - c14 + dProv, cartNeta: c14 - dProv, envia: e1908, otrosAct: fin(A1) - liq - c14 - e1908, vista, plazo, otrasCapt: fin(n21) - vista - plazo,
    capt: fin(n21), recibe: 0, otrosPas: fin(P2) - fin(n21), patrimonio: fin(P3) + fondeo - provMora, totA: fin(A1) + fondeo - dProv, totP: fin(P2) + fin(P3) + fondeo - provMora,
  };
  // indicadores
  const activoProm = v12(A1).reduce((a, x, i) => a + x - (v12(buscar(A1, "1908"))[i] ?? 0), 0) / 12;
  const n0 = args[6].filter((o) => o.activo === 1).length;
  const X = LINEAS.map((_, i) => lc[i].porVencer.reduce((a, r) => a + (r.detalle?.prestamosAConceder ?? 0), 0) / 12);
  const colMes = X.reduce((a, x) => a + x, 0);
  const crecLogrado = LINEAS.map((_, i) => { const c0 = lc[i].porVencer[0].saldoInicial + lc[i].enRiesgo[0].saldoInicial, c1 = lc[i].porVencer[11].saldoFinal + lc[i].enRiesgo[11].saldoFinal; return c0 > 0 ? (c1 / c0 - 1) * 100 : 0; });
  type Linea = (typeof lc)[number];
  const sumD = (f: (r: Linea, t: number) => number, t: number) => lc.reduce((a, r) => a + f(r, t), 0);
  const ajAcum: number[] = []; aj.fondeoMes.reduce((t, f, i) => (ajAcum[i] = t + f - aj.provMes[i]), 0);
  const resMes = v12(er.resultadoDelEjercicio).map((x, i) => x + ajAcum[i]), captMes = v12(n21);
  // castigos del año del modelo de provisión por tramos (salen del tramo E)
  const castigos = Array.from({ length: 12 }, (_, t) => Object.values((m.provisionPorLinea ?? {}) as Record<string, { castigosPorMes?: number[] }>).reduce((a, x) => a + (x.castigosPorMes?.[t] ?? 0), 0)).reduce((a, x) => a + x, 0);
  const meses = Array.from({ length: 12 }, (_, t) => {
    const cob = sumD((r, i) => -(r.porVencer[i].detalle.recuperacionPrestamos ?? 0), t), mig = sumD((r, i) => r.porVencer[i].detalle.incrementosRiesgo ?? 0, t);
    const rec = sumD((r, i) => r.enRiesgo[i].detalle.recuperacionRiesgo ?? 0, t), cas = sumD((r, i) => r.enRiesgo[i].detalle.castigos ?? 0, t);
    const c = pvT(t) + riT(t);
    return { coloc: colMes, due: cob + mig, cob, mig, rec, cas, cart: c, mora: c ? riT(t) / c : 0, capt: captMes[t], util: resMes[t] - (t ? resMes[t - 1] : 0), ut: resMes[t] };
  });
  const suma = (f: "due" | "cob" | "mig" | "rec" | "cas") => meses.reduce((a, x) => a + x[f], 0);
  const lin = lc.map((r, i) => ({ pv: r.porVencer[11].saldoFinal, r: r.enRiesgo[11].saldoFinal, ing: ingProd[i], col: X[i] * 12 }));
  const cp = m.captaciones, sf = (x: { saldoFinal: number }[]) => x[11]?.saldoFinal ?? 0;
  const capt = { vista: sf(cp.vista), crecer: sf(cp.crecer), dpf: sf(cp.dpf), i4101: fin(buscar(E, "4101")), i410115: 0, i410130: 0 };
  // ahorro (vista y Crecer): interés capitalizado; plazo: el resto de 4101
  capt.i410115 = [...cp.vista, ...cp.crecer].reduce((t, r) => t + Number(r.detalle?.capitalizacionInteres ?? 0), 0);
  capt.i410130 = capt.i4101 - capt.i410115;
  return {
    er: erOut, bal, activoProm, meses, lin, capt, castigos, internos: { pagado: e4105, cobrado: i5190 },
    ajPlan: { fondeo, provMora, tasaInterna: aj.tasaInterna, tasaBancos: aj.tasaBancos, factorEntrada: aj.factorEntrada, liqDif: aj.liqDif },
    rec: { due: suma("due"), cob: suma("cob"), mig: suma("mig"), rec: suma("rec"), cas: suma("cas"), vIni: lc.reduce((a: number, r: { enRiesgo: { saldoInicial: number }[] }) => a + r.enRiesgo[0].saldoInicial, 0), vFin: v },
    col: { X, colMes, n0, cap: am.A.mix.reduce((s, k, j) => s + k * am.A.metas[j], 0) * L.cumpl, nuevos: n0 - am.n0, holgura: 0, necesarios: n0, crecLogrado, porAsesor: n0 ? colMes / n0 : 0 },
    kpi: { util, roa: activoProm ? util / activoProm : 0, mora: cart ? v / cart : 0, efic: e45 / Math.max(1, erOut.margen + erOut.otrosIngTot), autof: cart ? fin(n21) / cart : 0, ases: n0 },
  };
}

/**
 * Corrida con parámetros de crédito y de cumplimiento propios (Estudio de agencia); lo demás, como el presupuesto.
 * La mora del escenario reacciona igual que en los escenarios: con la efectividad y la recuperación promedio.
 */
export function correrVersion(am: AgenciaMotor, cambios: { paramsCredito?: FilaParametroCredito[]; paramsCaptaciones?: FilaParametroCaptaciones[]; parametrosOtrosPasivo?: FilaParametroOtrosPasivo[]; asesores?: number; filasPresupuesto?: FilaPresupuestoDepartamental[]; empleados?: FilaEmpleadoNomina[] }): Corrida {
  const { ins, ref } = am;
  const paramsCredito = cambios.paramsCredito ?? ins.paramsCredito, paramsCaptaciones = cambios.paramsCaptaciones ?? ins.paramsCaptaciones;
  const parametrosOtrosPasivo = cambios.parametrosOtrosPasivo ?? ins.parametrosOtrosPasivo;
  const cumpl = cumplimientoColocacionDe(parametrosOtrosPasivo).reduce((a, x) => a + x, 0) / 12;
  const nAs = cambios.asesores ?? am.n0;
  const L: Pal = { crec: null, cumpl, e: promEq(paramsCredito), rv: prom(paramsCredito, (x) => x.tasa_recuperacion_vencida), k: 0, gV: ref.gV, gP: ref.gP, incSal: 0, ajGen: 0, rho: 0, ...(nAs !== am.n0 ? { asesFijo: nAs } : {}) };
  // asesores (solo simulación: el Estudio no los guarda en el presupuesto)
  const as = conAsesores(am, nAs, cambios.filasPresupuesto ?? ins.filasPresupuesto);
  const args = [ins.saldos, paramsCaptaciones, paramsCredito, as.filasPresupuesto, cambios.empleados ?? ins.empleados, am.A.nombre, as.oficialesCredito, ins.metasCredito, ins.factoresDepreciacion, parametrosOtrosPasivo] as const;
  return correrMotor(am, L, args as unknown as ReturnType<typeof aplicar>);
}

/** Las corridas de una agencia con el motor, con memoria (la misma combinación de palancas no se recalcula). */
function motorAgencia(am: AgenciaMotor): MotorAgencia {
  const memC = new Map<string, Corrida>(), memU = new Map<string, number>();
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  const clave = (L: Pal) => [L.cumpl, L.e, L.rv, L.gV, L.gP, L.ajGen].map(r).join("|") + "|" + (L.asesFijo ?? "");
  const guardar = <T,>(m: Map<string, T>, k: string, v: T) => { if (m.size > 400) m.delete(m.keys().next().value as string); m.set(k, v); return v; };
  return {
    am,
    correr: (L) => { const k = clave(L); return memC.get(k) ?? guardar(memC, k, correrMotor(am, L)); },
    util: (L) => { const k = clave(L); const c = memC.get(k); if (c) return c.kpi.util; return memU.get(k) ?? guardar(memU, k, utilidad(am, L)); },
  };
}

/** Conecta el motor del presupuesto a las agencias del mundo: desde aquí todos los escenarios corren con él. */
export function conectarMotor(M: Mundo, paquetes: Record<string, PaqueteMotor | null | undefined>) {
  const motores: Record<string, MotorAgencia> = {};
  for (const [nombre, A] of Object.entries(M.ags)) {
    const p = paquetes[nombre]; if (!p || nombre === "Consolidado") continue;
    const am = prepararAgencia(A, desempaquetar(p), M.sup.costoAsesor);
    // lo presupuestado son exactamente los parámetros cargados
    A.calib.pres = { ...A.calib.pres, e: am.ref.e, rv: am.ref.rv, gV: am.ref.gV, gP: am.ref.gP, cumpl: am.ref.cumpl, tieneParametros: true };
    const mo = motorAgencia(am); motores[nombre] = mo;
    // estructura del presupuesto (gastos por cuenta con sus nombres) para las tablas de gasto
    const P = mo.correr(escPres(M, A));
    A.pres = { gastos: { ...P.er.det }, nombres: nombresGastos(am), otrosIng: P.er.otrosIngTot, otrosGas: P.er.otrosGas, otrasProv: P.er.provOtras, captProm: 0, capt12: P.bal.capt, util: P.kpi.util };
  }
  M.motor = motores;
  return M;
}

/** Nombres de las cuentas de gasto (45) tal como están en el presupuesto. */
function nombresGastos(am: AgenciaMotor): Record<string, string> {
  const er = calcularEstadoResultadosMatriz(...aplicar(am, { crec: null, cumpl: am.ref.cumpl, e: am.ref.e, rv: am.ref.rv, k: 0, gV: am.ref.gV, gP: am.ref.gP, incSal: 0, ajGen: 0, rho: 0 })) as unknown as { egresos: Nodo };
  const r: Record<string, string> = {};
  const rec = (n: Nodo) => { const d = n.codigo.replace(/\D/g, ""); if (d.length === 6 && d.startsWith("45") && n.label) r[d] ??= n.label; (n.hijos ?? []).forEach(rec); };
  const n45 = buscar(er.egresos, "45"); if (n45) rec(n45);
  return r;
}

/** Suma de corridas de varias agencias (Consolidado); los indicadores se recalculan sobre los totales. */
export function sumarCorridas(Rs: Corrida[]): Corrida {
  const sumar = (xs: unknown[]): unknown => {
    const x0 = xs[0];
    if (typeof x0 === "number") return xs.reduce((a: number, v) => a + (Number(v) || 0), 0);
    if (Array.isArray(x0)) return x0.map((_, i) => sumar(xs.map((x) => (x as unknown[])[i])));
    if (x0 && typeof x0 === "object") {
      const claves = [...new Set(xs.flatMap((x) => Object.keys(x as object)))];
      return Object.fromEntries(claves.map((k) => [k, sumar(xs.map((x) => (x as Record<string, unknown>)[k] ?? 0))]));
    }
    return x0;
  };
  const R = sumar(Rs) as Corrida;
  const { er, bal } = R;
  R.kpi = { util: er.util, roa: R.activoProm ? er.util / R.activoProm : 0, mora: bal.cart ? bal.v / bal.cart : 0, efic: (er.personal + er.generales) / Math.max(1, er.margen + er.otrosIngTot), autof: bal.cart ? bal.capt / bal.cart : 0, ases: R.col.n0 };
  R.meses = R.meses.map((m, t) => ({ ...m, mora: m.cart ? Rs.reduce((a, x) => a + x.meses[t].mora * x.meses[t].cart, 0) / m.cart : 0 }));
  R.col.porAsesor = R.col.n0 ? R.col.colMes / R.col.n0 : 0;
  const c0 = Rs.map((x) => x.bal.cart), tc = c0.reduce((a, x) => a + x, 0);
  R.col.crecLogrado = R.col.crecLogrado.map((_, i) => (tc ? Rs.reduce((a, x, j) => a + x.col.crecLogrado[i] * c0[j], 0) / tc : 0));
  return R;
}

// ---------------------------------------------------------------------
// PROPUESTA DEL MODELO: mismo motor, pero sin lo que se escribió a mano en el presupuesto
// ---------------------------------------------------------------------
/** Cuentas escritas a mano en el presupuesto que el modelo reemplaza por lo real (los últimos 12 meses). */
const REEMPLAZA = /^(4502|4503|4504|4507|42|47|53|54|55|56)/;
const CALCULADAS = /^(450420|450421|450705|5604)/; // las calcula el motor: no se tocan

/** Lo que el modelo toma de la realidad en lugar del presupuesto. */
export interface BaseModelo {
  gastos: Record<string, { pres: number; modelo: number }>;   // cuentas reemplazadas (año)
  tasas: { prod: string; pres: number; modelo: number }[];  // crédito por línea y captaciones
}

/**
 * Insumos del modelo independiente: gastos generales, comisiones, otros ingresos y gastos según el ritmo real
 * (gastos con inflación); tasas de cartera y costo de captaciones efectivos de los últimos 12 meses.
 * Se mantiene lo que es real o se calcula: saldos, nómina, asesores y metas, depreciaciones, COSEDE, provisiones.
 */
function insumosModelo(A: Agencia, ins: InsumosMotor, infl: number): { ins: InsumosMotor; base: BaseModelo } {
  const ex = A.base.extra, ritmo: Record<string, number> = {};
  for (const [k, v] of Object.entries(ex?.gastos ?? {})) if (REEMPLAZA.test(k) && !CALCULADAS.test(k)) ritmo[k] = v * (1 + infl);
  for (const [k, v] of Object.entries(ex?.otros ?? {})) if (!CALCULADAS.test(k)) ritmo[k] = k.startsWith("4") ? v * (1 + infl) : v;
  const cod = (f: FilaPresupuestoDepartamental) => String(f.concepto).replace(/\D/g, "");
  const quitar = (f: FilaPresupuestoDepartamental) => REEMPLAZA.test(cod(f)) && !CALCULADAS.test(cod(f));
  const gastos: BaseModelo["gastos"] = {};
  for (const f of ins.filasPresupuesto) if (quitar(f)) { const k = cod(f).slice(0, 6); (gastos[k] ??= { pres: 0, modelo: 0 }).pres += f.monto; }
  for (const [k, v] of Object.entries(ritmo)) (gastos[k] ??= { pres: 0, modelo: 0 }).modelo += v;
  const filasPresupuesto: FilaPresupuestoDepartamental[] = [
    ...ins.filasPresupuesto.filter((f) => !quitar(f)),
    ...Object.entries(ritmo).flatMap(([k, v]) => Array.from({ length: 12 }, (_, i) => ({ departamento: "Modelo", concepto: k, cuenta_nombre: k, mes: i + 1, monto: v / 12 }))),
  ];
  // tasas efectivas de la cartera (intereses de 12 meses ÷ cartera por vencer promedio), por línea
  const tasas: BaseModelo["tasas"] = [];
  const paramsCredito = ins.paramsCredito.map((f) => {
    const i = LINEAS.indexOf(f.linea as (typeof LINEAS)[number]), t = i >= 0 ? A.calib.tasa[i] : 0;
    return t > 0.02 && t < 0.6 ? { ...f, tasa_interes_anual: t } : f;
  });
  LINEAS.forEach((l, i) => {
    const pr = prom(ins.paramsCredito.filter((f) => f.linea === l), (x) => x.tasa_interes_anual), t = A.calib.tasa[i];
    if (pr > 0 && A.base.productos[i].pv + A.base.productos[i].mora > 1000) tasas.push({ prod: A.base.productos[i].nombre, pres: pr, modelo: t > 0.02 && t < 0.6 ? t : pr });
  });
  // costo de captaciones: la tasa de vista y crecer se escala hasta el costo real de 2101; DPF al costo real de 2103
  const b = A.base, pc = ins.paramsCaptaciones, t0 = (p: string) => prom1(pc.filter((f) => f.producto === p).map((f) => f.tasa_interes_anual));
  const sal = (k: string) => Number(ins.saldos[k] ?? 0);
  const sV = sal("21013515"), sA = sal("21013505") + sal("21013510") + sal("21013535");
  const presVista = sA + sV > 0 ? (t0("VISTA") * sA + t0("CRECER") * sV) / (sA + sV) : t0("VISTA");
  const fV = presVista > 0 && b.tasaVista > 0 && b.tasaVista < 0.2 ? b.tasaVista / presVista : 1;
  const tP = b.tasaPlazo > 0.005 && b.tasaPlazo < 0.2 ? b.tasaPlazo : 0;
  const paramsCaptaciones = pc.map((f) => (f.producto === "DPF" ? (tP ? { ...f, tasa_interes_anual: tP } : f) : { ...f, tasa_interes_anual: (f.tasa_interes_anual ?? 0) * fV }));
  tasas.push({ prod: "Ahorro a la vista (costo)", pres: presVista, modelo: presVista * fV }, { prod: "Depósitos a plazo", pres: t0("DPF"), modelo: tP || t0("DPF") });
  return { ins: { ...ins, filasPresupuesto, paramsCredito, paramsCaptaciones }, base: { gastos, tasas } };
}
const prom1 = (v: number[]) => { const x = v.filter((n) => n > 0); return x.length ? x.reduce((a, n) => a + n, 0) / x.length : 0; };

/** Mundo de la propuesta del modelo: las mismas agencias con el motor sobre los insumos independientes. */
export function mundoModelo(M: Mundo, paquetes: Record<string, PaqueteMotor | null | undefined>): Mundo & { baseModelo: Record<string, BaseModelo> } {
  const ags: Mundo["ags"] = {}, motores: Record<string, MotorAgencia> = {}, baseModelo: Record<string, BaseModelo> = {};
  for (const [nombre, A0] of Object.entries(M.ags)) {
    // el modelo no se apoya en los parámetros del presupuesto (ni como piso del optimista)
    const A: Agencia = { ...A0, calib: { ...A0.calib, pres: { ...A0.calib.pres, tieneParametros: false } } };
    ags[nombre] = A;
    const p = paquetes[nombre]; if (!p || nombre === "Consolidado") continue;
    const im = insumosModelo(A, desempaquetar(p), M.sup.infl);
    const am = prepararAgencia(A, im.ins, M.sup.costoAsesor);
    motores[nombre] = motorAgencia(am); baseModelo[nombre] = im.base;
  }
  return { ags, sup: M.sup, motor: motores, baseModelo };
}

// ---------------------------------------------------------------------
// QUÉ CAMBIAR EN EL PRESUPUESTO para que dé el escenario (sin tocarlo)
// ---------------------------------------------------------------------
export interface CambioPresupuesto { modulo: string; parametro: string; actual: number; nuevo: number; formato: "pct" | "usd" | "num"; nota?: string }

/** Insumos del motor con las palancas del escenario aplicadas. */
export function insumosEscenario(am: AgenciaMotor, L: Pal) { return aplicar(am, L); }

/**
 * Diferencias entre los parámetros cargados en el presupuesto y los que usa el escenario (mismo motor): lo que habría
 * que modificar, pantalla por pantalla, para que el presupuesto dé ese escenario.
 */
export function cambiosPresupuesto(base: InsumosMotor, esc: ReturnType<typeof aplicar>, nombres: Record<string, string> = {}): CambioPresupuesto[] {
  const [, pcE, crE, filE, , , ofE, mtE, , opE] = esc;
  const out: CambioPresupuesto[] = [];
  const dif = (a: number, b: number, tol: number) => Math.abs(a - b) > tol;
  const NL: Record<string, string> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
  // crédito, por línea (promedio de los 12 meses)
  for (const l of LINEAS) {
    const a = base.paramsCredito.filter((f) => f.linea === l), b = crE.filter((f) => f.linea === l); if (!a.length) continue;
    const m = (x: FilaParametroCredito[], k: keyof FilaParametroCredito) => x.reduce((t, f) => t + Number(f[k] ?? 0), 0) / Math.max(1, x.length);
    for (const [k, n] of [["tasa_interes_anual", "Tasa de interés anual"], ["tasa_efectividad_recup", "Efectividad de recuperación (cuotas cobradas a tiempo)"], ["tasa_recuperacion_vencida", "Recuperación mensual de la cartera vencida"]] as const) {
      if (dif(m(a, k), m(b, k), 0.0004)) out.push({ modulo: "Cartera · Parámetros de crédito", parametro: `${NL[l]} · ${n}`, actual: m(a, k), nuevo: m(b, k), formato: "pct" });
    }
  }
  // asesores
  const cuenta = (x: FilaOficialCredito[], r: string) => x.filter((o) => o.activo === 1 && o.rango === r).length;
  for (const r of ["JUNIOR", "SENIOR", "MASTER"]) {
    const a = cuenta(base.oficialesCredito, r), b = cuenta(ofE, r);
    if (a !== b) out.push({ modulo: "Oficiales de crédito", parametro: `Asesores ${r.charAt(0) + r.slice(1).toLowerCase()} activos`, actual: a, nuevo: b, formato: "num", nota: b > a ? `Agregar ${b - a}` : `Quitar ${a - b}` });
  }
  // % de cumplimiento de la meta de colocación (promedio de los 12 meses)
  {
    const prom12 = (x: number[]) => x.reduce((a, v) => a + v, 0) / 12;
    const a = prom12(cumplimientoColocacionDe(base.parametrosOtrosPasivo)), b = prom12(cumplimientoColocacionDe(opE));
    if (dif(a, b, 0.0004)) out.push({ modulo: "Cartera · Colocación", parametro: "% de cumplimiento de la meta de colocación (Cumplimiento)", actual: a, nuevo: b, formato: "pct", nota: "Se mueve en la misma proporción en los 12 meses" });
  }
  // metas por asesor
  for (const [k, n] of [["meta_junior", "Junior"], ["meta_senior", "Senior"], ["meta_master", "Master"]] as const) {
    if (dif(base.metasCredito[k], mtE[k], 1)) out.push({ modulo: "Metas de crédito institucionales", parametro: `Meta mensual ${n}`, actual: base.metasCredito[k], nuevo: mtE[k], formato: "usd", nota: "Es la misma para todas las agencias: equivale a presupuestar ese cumplimiento de la meta" });
  }
  // captaciones, por producto (promedio de los 12 meses)
  const NP: Record<string, string> = { VISTA: "Ahorro a la vista", CRECER: "Crecer", DPF: "Depósitos a plazo" };
  for (const p of ["VISTA", "CRECER", "DPF"] as const) {
    const a = base.paramsCaptaciones.filter((f) => f.producto === p), b = pcE.filter((f) => f.producto === p); if (!a.length) continue;
    const m = (x: FilaParametroCaptaciones[], k: keyof FilaParametroCaptaciones) => x.reduce((t, f) => t + Number(f[k] ?? 0), 0) / Math.max(1, x.length);
    const campos = p === "DPF" ? [["tasa_interes_anual", "Tasa de interés anual", "pct"], ["ratio_renovaciones", "Ratio de renovaciones", "num"]] as const : [["tasa_interes_anual", "Tasa de interés anual", "pct"], ["pct_ingresos", "% de ingresos (depósitos) mensual", "pct"]] as const;
    for (const [k, n, f] of campos) if (dif(m(a, k), m(b, k), 0.00005)) out.push({ modulo: "Captaciones · Parámetros", parametro: `${NP[p]} · ${n}`, actual: m(a, k), nuevo: m(b, k), formato: f });
  }
  // presupuesto departamental: total del año por cuenta
  const anual = (x: FilaPresupuestoDepartamental[]) => { const r: Record<string, number> = {}; for (const f of x) { const k = String(f.concepto).replace(/\D/g, "").slice(0, 6); if (/^[45]/.test(k)) r[k] = (r[k] ?? 0) + f.monto; } return r; };
  const a = anual(base.filasPresupuesto), b = anual(filE);
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    if (dif(x, y, Math.max(50, Math.abs(x) * 0.005))) out.push({ modulo: "Presupuesto departamental (total del año)", parametro: `${k.slice(0, 4)}.${k.slice(4)} ${k.endsWith("99") ? "otras sin detalle" : nombreCuenta(k, nombres)}`.trim(), actual: x, nuevo: y, formato: "usd" });
  }
  return out;
}
