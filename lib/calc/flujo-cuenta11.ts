/**
 * FLUJO DE CAJA sobre la CUENTA 11 (como el flujo de caja real de la cooperativa).
 *
 * Usa exactamente los mismos movimientos que el motor (construirTodosLosMotores), pero:
 *  - la base es la cuenta 11 (Fondos disponibles, con el encaje incluido), no 11 + 13;
 *  - las inversiones (13) entran como movimiento: cancelaciones (+), nuevas (−) e intereses cobrados;
 *  - la colocación de créditos va dentro de Cartera, junto con la recuperación;
 *  - cada línea lleva su cuenta contable (Detalle) y se agrupa por concepto (Resumen).
 * El saldo final de cada mes es la cuenta 11 del Balance (control incluido: diferencia = 0).
 */
import { construirTodosLosMotores, repartoLiquidez, type SaldosPorCodigo } from "./orquestador";
import { inversionesDe } from "./inversiones";

interface FilaFlujo11 {
  id: string;
  codigo: string;              // cuenta contable ("" en totales)
  label: string;
  valores: number[];
  tipo: "saldo" | "total" | "grupo" | "linea" | "variacion" | "control";
  formula?: string;            // cómo se calcula (texto general)
}

type Params = Parameters<typeof construirTodosLosMotores>;
const cero = () => Array(12).fill(0) as number[];
const m12 = (fn: (i: number) => number) => Array.from({ length: 12 }, (_, i) => fn(i));
const pos = (v: number[]) => v.map((x) => Math.max(0, x));
const neg = (v: number[]) => v.map((x) => Math.max(0, -x));
const sumar = (...a: number[][]) => m12((i) => a.reduce((t, x) => t + (x[i] || 0), 0));

export function calcularFlujoCuenta11(...args: Params): { detalle: FilaFlujo11[]; resumen: FilaFlujo11[]; diferenciaMaxima: number } {
  const saldos = args[0] as SaldosPorCodigo;
  const m = construirTodosLosMotores(...args);
  const ins = m.insumosFlujoEfectivo;
  const fe = m.flujoEfectivo;
  const liq = repartoLiquidez(saldos, fe.map((f) => f.saldo_final), fe.map((f) => f.reservas_de_liquidez_requeridas));
  const inv = inversionesDe(saldos);

  // ---------- saldos de la cuenta 11 ----------
  const SF = liq.fondos;
  const SI = m12((i) => (i === 0 ? saldos["11"] ?? 0 : SF[i - 1]));

  // ---------- movimientos (todos en positivo; el signo lo da el lado) ----------
  const vigente = m12((i) => m.lineasCartera.reduce((t, r) => t - r.porVencer[i].detalle.recuperacionPrestamos, 0));
  const vencida = m12((i) => m.lineasCartera.reduce((t, r) => t + r.enRiesgo[i].detalle.recuperacionRiesgo, 0));
  const interesCartera = m12((i) => m.lineasCartera.reduce((t, r) => t + r.ingresoPorInteres[i], 0));
  const moraCartera = m12((i) => ins.interesesCarteraConMoraPorMes[i] - interesCartera[i]);
  const colocacion = fe.map((f) => f.monto_prestamos_a_conceder);

  const depAhorro = sumar(ins.depositosAhorroVistaPorMes, ins.depositosAhorroCrecerPorMes);
  const depDPF = ins.renovacionesDPFPorMes;
  const retAhorro = m12((i) => Math.abs(ins.retirosAhorroVistaPorMes[i]) + Math.abs(ins.retirosAhorroCrecerPorMes[i]));
  const retDPF = ins.cancelacionesDPFPorMes.map((v) => Math.abs(v));
  const intDPF = ins.interesesPagadosDPFPorMes;

  // Inversiones: el motor suma el interés devengado (5103) como entrada y la 11 resta lo que queda en 13 y 16.
  // En la cuenta 11 se ve como: cancelaciones (+), nuevas (−) e intereses cobrados (el resto, exacto).
  const i5103 = inv ? inv.interesDevengadoPorMes : cero();
  const i5101 = m12((i) => ins.interesesGanadosDepInvPorMes[i] - i5103[i]);
  const inv0 = saldos["13"] ?? 0;
  const deltaInv = m12((i) => liq.inversiones[i] - (i === 0 ? inv0 : liq.inversiones[i - 1]));
  const delta16 = m12((i) => liq.extra16[i] - (i === 0 ? 0 : liq.extra16[i - 1]));
  // Sin registro de títulos, la 13 sube o baja con su proporción del balance: se muestra como cancelación o compra.
  const cancelInv = inv ? inv.canceladasPorMes : neg(deltaInv);
  const nuevasInv = inv ? inv.nuevasPorMes : pos(deltaInv);
  // Lo que entra o sale por inversiones en la 11 = 5103 devengado − Δ13 − Δ16
  const netoInv = m12((i) => i5103[i] - deltaInv[i] - delta16[i]);
  const interesInvCobrado = m12((i) => netoInv[i] - cancelInv[i] + nuevasInv[i]);

  const cxc = m12((i) => -ins.cuentasPorCobrarVariacionPorMes[i]);      // + entra, − sale
  const cxp = m12((i) => ins.cuentasPorPagarPagosPorMes[i]);             // + entra, − sale (en Usos va con signo invertido)
  const fondoLiq = ins.ajusteFondoLiquidezPorMes;                         // + sale (aporte), − entra (reintegro)

  const t2908in = m.insumosPasivo.transf2908Incrementos;
  const t2908out = m.insumosPasivo.transf2908Disminuciones;
  const t1908in = m.insumosOtrosActivos.transferenciasOA1908Salidas;
  const t1908out = m.insumosOtrosActivos.transferenciasOA1908Entradas;

  type L = { codigo: string; label: string; valores: number[]; formula: string };
  const entradas: L[] = [
    { codigo: "13", label: "Cancelación de inversiones", valores: cancelInv, formula: inv ? "Capital + interés − retención de los títulos que se cancelan (registro de Inversiones)." : "Sin títulos registrados: la 13 mantiene su proporción del balance; cuando baja, la diferencia entra a la 11." },
    { codigo: "14", label: "Recuperación de cartera vigente", valores: vigente, formula: "Cuotas de capital cobradas de la cartera por vencer (Cartera de crédito, 4 líneas)." },
    { codigo: "14", label: "Recuperación de cartera vencida", valores: vencida, formula: "Capital recuperado de la cartera en riesgo (Cartera de crédito)." },
    { codigo: "16", label: "Cuentas por cobrar (disminución)", valores: pos(cxc), formula: "Disminución de cuentas por cobrar: relación del balance de partida × cartera por vencer (Cuentas por cobrar)." },
    { codigo: "1902", label: "Reintegro del Fondo de Liquidez", valores: neg(fondoLiq), formula: "Ajuste del Fondo de Liquidez cuando baja (Otros activos)." },
    { codigo: "1908", label: "Transferencias internas", valores: t1908in, formula: "Disminución de transferencias internas por cobrar (Otros activos)." },
    { codigo: "2101", label: "Depósitos de ahorro", valores: depAhorro, formula: "Depósitos de ahorro a la vista y ahorro crecer (Obligaciones con el público)." },
    { codigo: "2103", label: "Depósitos a plazo fijo", valores: depDPF, formula: "Depósitos y renovaciones de plazo fijo (Obligaciones con el público)." },
    { codigo: "25", label: "Cuentas por pagar (aumento)", valores: pos(cxp), formula: "Aumento neto de cuentas por pagar (Pasivos)." },
    { codigo: "26", label: "Obligaciones financieras recibidas", valores: ins.creditosExternosNuevosPorMes, formula: "Créditos externos nuevos (Pasivos)." },
    { codigo: "2908", label: "Transferencias internas", valores: t2908in, formula: "Aumento de transferencias internas por pagar (Pasivos)." },
    { codigo: "3103", label: "Aportes de socios", valores: ins.aportesSociosPorMes, formula: "Socios nuevos × aporte obligatorio (Patrimonio)." },
    { codigo: "34", label: "Donaciones en efectivo", valores: ins.donacionesEfectivoPorMes, formula: "Donaciones en efectivo (Patrimonio)." },
    { codigo: "5101", label: "Intereses ganados en depósitos bancarios", valores: i5101, formula: "Interés de bancos y préstamos internos (Ingresos 51)." },
    { codigo: "5103", label: "Intereses cobrados de inversiones", valores: interesInvCobrado, formula: "Interés de inversiones que entra en efectivo: devengado (5103) menos lo que se capitaliza en los títulos y lo que queda por cobrar (16)." },
    { codigo: "5104", label: "Intereses ganados de cartera", valores: interesCartera, formula: "Interés normal de la cartera (Cartera de crédito)." },
    { codigo: "5104", label: "Intereses de mora", valores: moraCartera, formula: "Interés normal × relación de mora (Cartera → Metas)." },
    { codigo: "52", label: "Comisiones ganadas", valores: ins.comisionesGanadasCarteraPorMes, formula: "Comisiones de cartera (Ingresos)." },
    { codigo: "54", label: "Ingresos por servicios", valores: ins.ingresosPorServiciosPorMes, formula: "Ingresos por servicios (Ingresos)." },
    { codigo: "56", label: "Otros ingresos (53, 55, 56)", valores: ins.otrosIngresosTotalPorMes, formula: "Utilidades financieras, otros ingresos operacionales y otros ingresos (Ingresos)." },
  ];
  const salidas: L[] = [
    { codigo: "13", label: "Nuevas inversiones", valores: nuevasInv, formula: inv ? "Títulos planificados que se compran en el año (registro de Inversiones)." : "Sin títulos registrados: la 13 mantiene su proporción del balance; cuando sube, la diferencia sale de la 11." },
    { codigo: "14", label: "Colocación de créditos", valores: colocacion, formula: "Préstamos a conceder de las 4 líneas (meta de colocación de la agencia)." },
    { codigo: "16", label: "Cuentas por cobrar (aumento)", valores: neg(cxc), formula: "Aumento de cuentas por cobrar: relación del balance de partida × cartera por vencer (Cuentas por cobrar)." },
    { codigo: "18", label: "Compra de activos fijos", valores: ins.adquisicionActivosFijosPorMes, formula: "Compras de activos fijos en efectivo (Activos fijos)." },
    { codigo: "1901", label: "Acciones y participaciones", valores: ins.nuevasInversionesPorMes, formula: "Incremento de acciones y participaciones (Otros activos)." },
    { codigo: "1902", label: "Aporte al Fondo de Liquidez", valores: pos(fondoLiq), formula: "Ajuste del Fondo de Liquidez cuando sube (Otros activos)." },
    { codigo: "1904", label: "Gastos y pagos anticipados", valores: ins.nuevosPagosAnticipadosPorMes, formula: "Nuevos pagos anticipados (Otros activos)." },
    { codigo: "1906", label: "Materiales, mercadería e insumos", valores: ins.nuevasAdquisicionesMaterialesPorMes, formula: "Compras de materiales (Otros activos)." },
    { codigo: "1908", label: "Transferencias internas", valores: t1908out, formula: "Aumento de transferencias internas por cobrar (Otros activos)." },
    { codigo: "2101", label: "Retiros de ahorro", valores: retAhorro, formula: "Retiros de ahorro a la vista y ahorro crecer (Obligaciones con el público)." },
    { codigo: "2103", label: "Cancelaciones de plazo fijo", valores: retDPF, formula: "Plazos fijos que se cancelan (Obligaciones con el público)." },
    { codigo: "25", label: "Cuentas por pagar (pagos)", valores: neg(cxp), formula: "Pagos netos de cuentas por pagar (Pasivos)." },
    { codigo: "26", label: "Pago de obligaciones financieras", valores: ins.pagoCreditosExternosPorMes, formula: "Pago de capital de créditos externos (Pasivos)." },
    { codigo: "2908", label: "Transferencias internas", valores: t2908out, formula: "Disminución de transferencias internas por pagar (Pasivos)." },
    { codigo: "3103", label: "Retiro de aportes de socios", valores: ins.retirosAporteSociosPorMes, formula: "Socios retirados × devolución promedio (Patrimonio)." },
    { codigo: "410130", label: "Intereses pagados por plazo fijo", valores: intDPF, formula: "Saldo promedio de plazo fijo × tasa ÷ 12 (Obligaciones con el público)." },
    { codigo: "4103", label: "Intereses pagados por obligaciones financieras", valores: ins.interesesPagadosCreditosExternosPorMes, formula: "Interés de créditos externos (Pasivos)." },
    { codigo: "4501", label: "Gastos de personal", valores: ins.gastosDePersonalPorMes, formula: "Nómina y beneficios (Talento humano)." },
    { codigo: "4502", label: "Honorarios", valores: ins.gastosHonorariosPorMes, formula: "Honorarios del presupuesto (4502)." },
    { codigo: "4503", label: "Servicios varios", valores: ins.gastosServiciosVariosPorMes, formula: "Servicios varios del presupuesto (4503), sin los seguros de gastos anticipados que se pagaron al contratar la póliza." },
    { codigo: "4504", label: "Impuestos, contribuciones y COSEDE", valores: ins.gastosImpuestosYCosedePorMes, formula: "Impuestos municipales y otros + prima COSEDE (fija y variable)." },
    { codigo: "4507", label: "Otros gastos", valores: ins.gastosOtrosInstitucionalPorMes, formula: "Otros gastos institucionales (4507). No incluye depreciación ni amortización, que no son salida de caja." },
    { codigo: "450415", label: "Aportes a la SEPS", valores: ins.aportesSEPSPorMes, formula: "Aportes a la Superintendencia del presupuesto (450415), pagados el mismo mes." },
    { codigo: "42", label: "Comisiones causadas", valores: ins.comisionesCausadasPorMes, formula: "Comisiones causadas del presupuesto (42), pagadas el mismo mes." },
    { codigo: "47", label: "Otros gastos y pérdidas", valores: ins.otrosGastosYPerdidasPorMes, formula: "Otros gastos y pérdidas del presupuesto (47), pagados el mismo mes." },
    { codigo: "41", label: "Otros egresos (interés de préstamos internos, 43, 46…)", valores: ins.otrosEgresosAdicionalesPorMes, formula: "Gastos del presupuesto sin otra línea: interés pagado a otras oficinas por préstamos internos (41059005), 43, 46, 4508…; se pagan el mismo mes." },
    { codigo: "48", label: "Participación de trabajadores e impuesto a la renta", valores: ins.participacionEImpuestoRentaPorMes, formula: "Participación de trabajadores e impuesto a la renta del presupuesto (48), pagados en el mes en que están presupuestados." },
  ];

  const totE = sumar(...entradas.map((e) => e.valores));
  const totS = sumar(...salidas.map((s) => s.valores));
  const SFcalc = m12((i) => SI[i] + totE[i] - totS[i]);
  const dif = m12((i) => SF[i] - SFcalc[i]);
  const diferenciaMaxima = Math.max(...dif.map(Math.abs));

  const encaje = liq.cuentas11.find((c) => c.codigo === "1102")?.valores ?? fe.map((f) => f.reservas_de_liquidez_requeridas);
  const sinEncaje = m12((i) => SF[i] - encaje[i]);

  const cierre: FilaFlujo11[] = [
    { id: "sf", codigo: "", label: "(=) Saldo final", valores: SFcalc, tipo: "saldo", formula: "Saldo inicial + entradas − salidas." },
    { id: "sb", codigo: "11", label: "Saldo balance", valores: SF, tipo: "control", formula: "Cuenta 11 (Fondos disponibles) del Balance proyectado." },
    { id: "df", codigo: "", label: "Diferencia", valores: dif, tipo: "control", formula: "Saldo balance − saldo final del flujo. Debe ser 0." },
    { id: "en", codigo: "1102", label: "Encaje bancario", valores: encaje, tipo: "control", formula: "Captaciones proyectadas × % de encaje (Fondos disponibles → Depósitos para encaje)." },
    { id: "se", codigo: "", label: "Saldo disponible sin encaje bancario", valores: sinEncaje, tipo: "saldo", formula: "Saldo final − encaje bancario. Si es negativo, la colocación y los pagos del mes no caben en la liquidez." },
  ];

  const lin = (pref: string, l: L, k: number): FilaFlujo11 => ({ id: `${pref}${k}`, codigo: l.codigo, label: l.label, valores: l.valores, tipo: "linea", formula: l.formula });
  const detalle: FilaFlujo11[] = [
    { id: "si", codigo: "", label: "(+) Saldo inicial", valores: SI, tipo: "saldo", formula: "Enero: cuenta 11 del balance de partida. Luego, saldo final del mes anterior." },
    { id: "te", codigo: "", label: "(+) Entradas de efectivo", valores: totE, tipo: "total" },
    ...entradas.map((l, k) => lin("e", l, k)),
    { id: "ts", codigo: "", label: "(−) Salidas de efectivo", valores: totS, tipo: "total" },
    ...salidas.map((l, k) => lin("s", l, k)),
    ...cierre,
  ];

  // ---------- RESUMEN por concepto (como la hoja Resumen del flujo real) ----------
  const varCapt = m12((i) => depAhorro[i] + depDPF[i] - retAhorro[i] - retDPF[i] - intDPF[i]);
  const varCart = m12((i) => vigente[i] + vencida[i] + interesCartera[i] + moraCartera[i] - colocacion[i]);
  const varInv = m12((i) => cancelInv[i] + interesInvCobrado[i] + i5101[i] - nuevasInv[i]);
  const varObl = m12((i) => ins.creditosExternosNuevosPorMes[i] - ins.pagoCreditosExternosPorMes[i] - ins.interesesPagadosCreditosExternosPorMes[i]);
  const gastosOp = sumar(ins.gastosHonorariosPorMes, ins.gastosServiciosVariosPorMes, ins.gastosImpuestosYCosedePorMes, ins.gastosOtrosInstitucionalPorMes, ins.otrosEgresosEnEfectivoPorMes);
  const excedente = m12((i) => SFcalc[i] - SI[i]);
  const varOtros = m12((i) => excedente[i] - varCapt[i] - varCart[i] - varInv[i] - varObl[i] + ins.gastosDePersonalPorMes[i] + gastosOp[i]);

  const g = (id: string, label: string): FilaFlujo11 => ({ id, codigo: "", label, valores: cero(), tipo: "grupo" });
  const l = (id: string, label: string, valores: number[], formula?: string): FilaFlujo11 => ({ id, codigo: "", label, valores, tipo: "linea", formula });
  const v = (id: string, label: string, valores: number[], formula?: string): FilaFlujo11 => ({ id, codigo: "", label, valores, tipo: "variacion", formula });

  const resumen: FilaFlujo11[] = [
    { id: "r-si", codigo: "", label: "Saldo inicial", valores: SI, tipo: "saldo" },
    { id: "r-te", codigo: "", label: "(+) Entradas de efectivo", valores: totE, tipo: "linea" },
    { id: "r-ts", codigo: "", label: "(−) Salidas de efectivo", valores: totS, tipo: "linea" },
    { id: "r-sf", codigo: "", label: "Saldo final", valores: SFcalc, tipo: "saldo" },
    { id: "r-ex", codigo: "", label: "Excedente (déficit) de caja", valores: excedente, tipo: "variacion", formula: "Saldo final − saldo inicial del mes." },
    g("g-cap", "Captación directa"),
    l("c1", "(+) Flujo de entrada de captaciones", sumar(depAhorro, depDPF), "Depósitos de ahorro + depósitos y renovaciones de plazo fijo."),
    l("c2", "(−) Flujo de salida de captaciones", sumar(retAhorro, retDPF).map((x) => -x), "Retiros de ahorro + cancelaciones de plazo fijo."),
    l("c3", "(−) Flujo de salida de interés de captaciones", intDPF.map((x) => -x), "Intereses pagados por plazo fijo."),
    v("c4", "Variación por captaciones", varCapt),
    g("g-car", "Cartera de crédito"),
    l("k1", "(+) Recuperación de cartera vigente", vigente),
    l("k2", "(+) Recuperación de cartera vencida", vencida),
    l("k3", "(+) Intereses ganados de cartera", interesCartera),
    l("k4", "(+) Intereses de mora", moraCartera),
    l("k5", "(−) Colocaciones", colocacion.map((x) => -x)),
    v("k6", "Variación por cartera", varCart),
    g("g-inv", "Inversiones y depósitos"),
    l("i1", "(+) Cancelación de inversiones", cancelInv),
    l("i2", "(+) Intereses de inversiones y depósitos", sumar(interesInvCobrado, i5101)),
    l("i3", "(−) Nuevas inversiones", nuevasInv.map((x) => -x)),
    v("i4", "Variación por inversiones", varInv),
    g("g-obl", "Obligaciones financieras"),
    l("o1", "(+) Flujo de entrada de obligaciones", ins.creditosExternosNuevosPorMes),
    l("o2", "(−) Pago de capital de obligaciones", ins.pagoCreditosExternosPorMes.map((x) => -x)),
    l("o3", "(−) Intereses de obligaciones", ins.interesesPagadosCreditosExternosPorMes.map((x) => -x)),
    v("o4", "Variación por obligaciones financieras", varObl),
    g("g-gas", "Gastos de operación"),
    l("n1", "(−) Pago de nómina (gastos de personal)", ins.gastosDePersonalPorMes.map((x) => -x)),
    l("n2", "(−) Honorarios", ins.gastosHonorariosPorMes.map((x) => -x)),
    l("n3", "(−) Servicios varios", ins.gastosServiciosVariosPorMes.map((x) => -x)),
    l("n4", "(−) Impuestos, contribuciones y COSEDE", ins.gastosImpuestosYCosedePorMes.map((x) => -x)),
    l("n5", "(−) Otros gastos", ins.gastosOtrosInstitucionalPorMes.map((x) => -x)),
    l("n7", "(−) Aportes SEPS y comisiones causadas", sumar(ins.aportesSEPSPorMes, ins.comisionesCausadasPorMes).map((x) => -x)),
    l("n8", "(−) Otros gastos y pérdidas", ins.otrosGastosYPerdidasPorMes.map((x) => -x)),
    l("n9", "(−) Participación de trabajadores e impuesto a la renta", ins.participacionEImpuestoRentaPorMes.map((x) => -x)),
    l("n10", "(−) Otros egresos (interés de préstamos internos, 43, 46…)", ins.otrosEgresosAdicionalesPorMes.map((x) => -x)),
    v("n6", "Variación por gastos de operación", sumar(ins.gastosDePersonalPorMes, gastosOp).map((x) => -x)),
    g("g-otr", "Otros flujos"),
    l("x1", "(±) Aportes de socios y donaciones (neto)", m12((i) => ins.aportesSociosPorMes[i] + ins.donacionesEfectivoPorMes[i] - ins.retirosAporteSociosPorMes[i])),
    l("x2", "(±) Cuentas por cobrar y por pagar (neto)", m12((i) => cxc[i] + cxp[i])),
    l("x3", "(±) Transferencias internas (neto)", m12((i) => t1908in[i] + t2908in[i] - t1908out[i] - t2908out[i])),
    l("x4", "(±) Fondo de Liquidez (neto)", fondoLiq.map((x) => -x)),
    l("x5", "(−) Activos fijos, pagos anticipados y materiales", m12((i) => -(ins.adquisicionActivosFijosPorMes[i] + ins.nuevasInversionesPorMes[i] + ins.nuevosPagosAnticipadosPorMes[i] + ins.nuevasAdquisicionesMaterialesPorMes[i]))),
    l("x6", "(+) Comisiones, servicios y otros ingresos", sumar(ins.comisionesGanadasCarteraPorMes, ins.ingresosPorServiciosPorMes, ins.otrosIngresosTotalPorMes)),
    v("x7", "Variación por otros flujos", varOtros),
    g("g-cie", "Liquidez"),
    { id: "r-en", codigo: "1102", label: "Encaje bancario", valores: encaje, tipo: "linea", formula: "Captaciones proyectadas × % de encaje." },
    { id: "r-se", codigo: "", label: "Saldo disponible sin encaje bancario", valores: sinEncaje, tipo: "saldo", formula: "Saldo final − encaje bancario." },
  ];

  return { detalle, resumen, diferenciaMaxima };
}
