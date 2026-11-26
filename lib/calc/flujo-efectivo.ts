/**
 * Motor de calculo puro - FLUJO DE EFECTIVO (Fuentes y Usos de Capital)
 * Replica Agencia_Modelo filas 741-776.
 *
 * A diferencia del Estado de Resultados (Ingresos/Egresos), el Flujo de
 * Efectivo usa MONTOS MENSUALES AISLADOS, no acumulado YTD — es el
 * movimiento de caja de cada mes en particular, calzado con las lineas de
 * balance y P&L de ESE mes especificamente. Compone las salidas de TODOS
 * los demas motores ya construidos.
 *
 * FUENTES (entradas de caja): Depositos brutos de Ahorro/DPF, intereses
 * ganados, aportes de socios, recuperacion de cartera EN EFECTIVO,
 * intereses+comisiones+servicios+otros ingresos, creditos externos nuevos,
 * transferencias internas recibidas.
 *
 * USOS (salidas de caja): Retiros de Ahorro/DPF/Aportes, intereses pagados,
 * gastos de personal, gastos operacionales EN EFECTIVO (excluye
 * Depreciacion/Amortizacion/Suministros por ser no-monetarios, y excluye
 * Aportes SEPS por ir a Cuentas por Pagar), adquisicion de activos fijos,
 * pago de creditos externos, cuentas por pagar, transferencias internas
 * devueltas, nuevas inversiones, pagos anticipados, adquisicion de
 * materiales, aportes al Fondo de Liquidez.
 *
 * Al final: Reservas de Liquidez requeridas (3.5% de Captaciones),
 * Disponible para colocacion de creditos, y Monto de Prestamos a Conceder
 * (la salida de caja mas grande, ya viene resuelta del motor de Cartera).
 */

interface ResultadoMesFlujoEfectivo {
  mes: number;
  saldo_inicial: number;
  fuentes_de_capital: number;
  usos_de_capital: number;
  reservas_de_liquidez_requeridas: number;
  disponible_para_creditos: number;
  monto_prestamos_a_conceder: number;
  saldo_final: number;
}

export function calcularFlujoEfectivoMatriz(input: {
  saldoInicialCajaEnero: number; // 'Balance General'!D13+D14+D17

  // --- FUENTES ---
  depositosAhorroVistaPorMes: number[]; // Captaciones: calcularCuentaAhorro(vista).detalle.depositos
  depositosAhorroCrecerPorMes: number[]; // Captaciones: calcularCuentaAhorro(crecer).detalle.depositos
  renovacionesDPFPorMes: number[]; // Captaciones: calcularDPF(...).detalle.renovaciones
  interesesGanadosDepInvPorMes: number[]; // = depositosEInversionesPorMes (Ingresos/Egresos, MENSUAL no acumulado)
  aportesSociosPorMes: number[]; // Patrimonio: socios_nuevos_por_mes * monto_obligatorio_aporte_por_mes
  recuperacionCarteraEfectivaPorMes: number[]; // Cartera: (-recuperacionPrestamos + recuperacionRiesgo) sumado en las 4 lineas
  interesesCarteraConMoraPorMes: number[]; // Ingresos/Egresos: ingresoPorInteres(4 productos) + mora, MENSUAL
  comisionesGanadasCarteraPorMes: number[]; // 0 en Matriz
  cuentasPorCobrarVariacionPorMes: number[]; // externo — variacion mensual (16), no cubierto por otro motor
  creditosExternosNuevosPorMes: number[]; // Pasivo: incrementosPorMes sumados de los 4 creditos (0 en Matriz)
  transferenciasInternasRecibidasPorMes: number[]; // Pasivo(2908 incrementos) + Otros Activos(1908 disminuciones)
  ingresosPorServiciosPorMes: number[]; // Ingresos/Egresos externo, MENSUAL
  otrosIngresosTotalPorMes: number[]; // Ingresos/Egresos: utilidadesFinancieras + otrosIngresosOperacionales + otrosIngresos, MENSUAL

  // --- USOS ---
  retirosAhorroVistaPorMes: number[]; // Captaciones: calcularCuentaAhorro(vista).detalle.retiros (ya negativo -> usar abs)
  retirosAhorroCrecerPorMes: number[];
  cancelacionesDPFPorMes: number[]; // Captaciones: calcularDPF(...).detalle.cancelaciones (ya negativo -> usar abs)
  retirosAporteSociosPorMes: number[]; // Patrimonio: socios_retirados_por_mes * monto_obligatorio_aporte_por_mes
  interesesPagadosDPFPorMes: number[]; // = flujo mensual DPF de Ingresos/Egresos (promedio saldo * tasa/12)
  interesesPagadosCreditosExternosPorMes: number[]; // Pasivo (0 en Matriz)
  gastosDePersonalPorMes: number[]; // Ingresos/Egresos externo, MENSUAL
  gastosOperacionalesEnEfectivoPorMes: number[]; // Honorarios + ServiciosVarios + (ImpMunicipales+COSEDE) + (Mantenimiento+OtrosInstitucional) — EXCLUYE Depreciacion/Amortizacion/Suministros/AportesSEPS
  adquisicionActivosFijosPorMes: number[]; // Activo Fijo: PLAN_ADQUISICIONES_MATRIZ sumado (todas las categorias + terrenos)
  pagoCreditosExternosPorMes: number[]; // Pasivo: pagosPorMes sumados de los 4 creditos (0 en Matriz)
  cuentasPorPagarPagosPorMes: number[]; // Pasivo: cuentasPorPagar.pagosPorMes
  transferenciasInternasDevueltasPorMes: number[]; // Pasivo(2908 disminuciones) + Otros Activos(1908 incrementos)
  nuevasInversionesPorMes: number[]; // Otros Activos: siempre 0 en Matriz (1901 sin movimiento)
  nuevosPagosAnticipadosPorMes: number[]; // Otros Activos: gastosAnticipados1904.entradasPorMes
  nuevasAdquisicionesMaterialesPorMes: number[]; // Otros Activos: materiales1906.entradasPorMes
  ajusteFondoLiquidezPorMes: number[]; // Otros Activos: calcularFondoLiquidez(...).ajuste
  otrosEgresosEnEfectivoPorMes?: number[]; // Presupuesto: aportes SEPS (450415) + comisiones causadas (42) + otros gastos y pérdidas (47) + participación e impuesto a la renta (48)

  // --- Cierre ---
  totalCaptacionesPorMes: number[]; // Captaciones: totalMensual (para Reservas de Liquidez)
  pctEncaje?: number; // % de encaje BCE en fracción (Fondos disponibles → Encaje); 0,035 si no se indica
  montoPrestamosAConcederPorMes: number[]; // Cartera: prestamosAConceder sumado de las 4 lineas
}): ResultadoMesFlujoEfectivo[] {
  const resultados: ResultadoMesFlujoEfectivo[] = [];
  let saldoInicial = input.saldoInicialCajaEnero;

  for (let i = 0; i < 12; i++) {
    const fuentes =
      input.depositosAhorroVistaPorMes[i] +
      input.depositosAhorroCrecerPorMes[i] +
      input.renovacionesDPFPorMes[i] +
      input.interesesGanadosDepInvPorMes[i] +
      input.aportesSociosPorMes[i] +
      input.recuperacionCarteraEfectivaPorMes[i] +
      input.interesesCarteraConMoraPorMes[i] +
      input.comisionesGanadasCarteraPorMes[i] +
      -input.cuentasPorCobrarVariacionPorMes[i] +
      input.creditosExternosNuevosPorMes[i] +
      input.transferenciasInternasRecibidasPorMes[i] +
      input.ingresosPorServiciosPorMes[i] +
      input.otrosIngresosTotalPorMes[i];

    const usos =
      Math.abs(input.retirosAhorroVistaPorMes[i]) +
      Math.abs(input.retirosAhorroCrecerPorMes[i]) +
      Math.abs(input.cancelacionesDPFPorMes[i]) +
      input.retirosAporteSociosPorMes[i] +
      input.interesesPagadosDPFPorMes[i] +
      input.interesesPagadosCreditosExternosPorMes[i] +
      input.gastosDePersonalPorMes[i] +
      input.gastosOperacionalesEnEfectivoPorMes[i] +
      input.adquisicionActivosFijosPorMes[i] +
      input.pagoCreditosExternosPorMes[i] +
      -input.cuentasPorPagarPagosPorMes[i] + // variación neta de la 25 (incrementos − pagos): si sube, deja caja; si baja (pagos), sale de caja
      input.transferenciasInternasDevueltasPorMes[i] +
      input.nuevasInversionesPorMes[i] +
      input.nuevosPagosAnticipadosPorMes[i] +
      input.nuevasAdquisicionesMaterialesPorMes[i] +
      input.ajusteFondoLiquidezPorMes[i] +
      (input.otrosEgresosEnEfectivoPorMes?.[i] ?? 0);

    const reservas = input.totalCaptacionesPorMes[i] * (input.pctEncaje ?? 0.035);
    const disponible = saldoInicial + fuentes - usos - reservas;
    const prestamosAConceder = input.montoPrestamosAConcederPorMes[i];
    const saldoFinal = saldoInicial + fuentes - usos - prestamosAConceder;

    resultados.push({
      mes: i + 1,
      saldo_inicial: saldoInicial,
      fuentes_de_capital: fuentes,
      usos_de_capital: usos,
      reservas_de_liquidez_requeridas: reservas,
      disponible_para_creditos: disponible,
      monto_prestamos_a_conceder: prestamosAConceder,
      saldo_final: saldoFinal,
    });

    saldoInicial = saldoFinal;
  }

  return resultados;
}

// ---------- Datos reales de Matriz (para validar el motor) ----------

export const INPUT_FLUJO_EFECTIVO_MATRIZ = {
  saldoInicialCajaEnero: 13195978.06, // Balance General!D13+D14+D17
  depositosAhorroVistaPorMes: [658172.14, 664754.86, 671467.9, 678314.16, 685296.52, 692417.9, 699681.32, 707089.85, 714646.62, 722354.83, 730217.69, 738238.51],
  depositosAhorroCrecerPorMes: [173855.66, 175594.22, 177350.16, 179123.66, 180914.9, 182724.05, 184551.29, 186396.8, 188260.77, 190143.38, 192044.81, 193965.26],
  renovacionesDPFPorMes: [6154358.85, 6081422.06, 6009486.42, 5938536.95, 5868559.29, 5799539.34, 5731462.96, 5664317.19, 5598089.19, 5532766.34, 5468336.13, 5404787.11],
  interesesGanadosDepInvPorMes: [9911.37, 9066.91, 8512.00, 7902.23, 7315.78, 6761.78, 6237.08, 5742.77, 5264.21, 4805.66, 4329.04, 3870.27], // fila 747 (corregida hoy: tenia un error de arrastre, quedaba congelada en el valor de enero)
  aportesSociosPorMes: Array(12).fill(1620), // 108 socios nuevos * $15
  recuperacionCarteraEfectivaPorMes: [409619.05, 415712.09, 419834.11, 424115.6, 428280.66, 432276.79, 436230.19, 440108.79, 443906.62, 447600.9, 451196.24, 454673.66],
  interesesCarteraConMoraPorMes: [406885.22, 415316.34, 423804.83, 432346.78, 440589.97, 448544.66, 456220.74, 463627.76, 470774.95, 477671.22, 484325.19, 491269.64],
  comisionesGanadasCarteraPorMes: Array(12).fill(0),
  cuentasPorCobrarVariacionPorMes: [24023.81, 23186.88, 25534.12, 24628.1, 23753.26, 22908.54, 22092.91, 21305.38, 20544.99, 19810.82, 19101.96, 23167.19],
  creditosExternosNuevosPorMes: Array(12).fill(0),
  transferenciasInternasRecibidasPorMes: Array(12).fill(400000), // Pasivo 2908 incrementos + Otros Activos 1908 disminuciones(0)
  ingresosPorServiciosPorMes: [21395, 21395, 21395, 21395, 21395, 21395, 21395, 21395, 21395, 21755, 21755, 21755],
  otrosIngresosTotalPorMes: [122161, 122161, 122161, 122288, 122288, 122288, 122288, 122288, 122288, 74788, 74788, 74788], // utilidadesFinancieras(9000) + otrosIngresos(externo)

  retirosAhorroVistaPorMes: [207460.29, 207685.10, 207910.15, 208135.45, 208360.99, 208586.77, 208812.80, 209039.08, 209265.60, 209492.36, 209719.38, 209946.63],
  retirosAhorroCrecerPorMes: [23689.84, 23800.51, 23910.51, 24021.01, 24132.03, 24243.55, 24355.60, 24468.16, 24581.24, 24694.84, 24808.97, 24923.63],
  cancelacionesDPFPorMes: [2813921.95, 2817861.44, 2821806.45, 2825756.98, 2829713.04, 2833674.63, 2837641.78, 2841614.48, 2845592.74, 2849576.57, 2853565.97, 2857560.97],
  retirosAporteSociosPorMes: Array(12).fill(525), // 35 socios retirados * $15
  interesesPagadosDPFPorMes: [258123.41, 258484.78, 258846.66, 259209.04, 259571.93, 259935.34, 260299.25, 260663.66, 261028.59, 261394.03, 261759.98, 262126.45],
  interesesPagadosCreditosExternosPorMes: Array(12).fill(0),
  gastosDePersonalPorMes: [167824.07, 162858.07, 174801.25, 161614.73, 174300.73, 172099.26, 160471.76, 162157.43, 159092.76, 160455.89, 160760.73, 173883.06],
  gastosOperacionalesEnEfectivoPorMes: [98087.47, 93228.25, 92527.36, 121626.14, 92091.22, 86337.77, 86977.84, 87614.49, 90898.25, 90046.39, 92818.23, 86729.39],
  adquisicionActivosFijosPorMes: [19845.64, 21855.18, 21318.28, 20167.78, 7665.68, 6208.38, 5364.68, 5226.62, 5732.84, 4198.84, 4597.68, 4198.84],
  pagoCreditosExternosPorMes: Array(12).fill(0),
  cuentasPorPagarPagosPorMes: Array(12).fill(10000),
  transferenciasInternasDevueltasPorMes: Array(12).fill(600000), // Otros Activos 1908 incrementos + Pasivo 2908 disminuciones(0)
  nuevasInversionesPorMes: Array(12).fill(0),
  nuevosPagosAnticipadosPorMes: [17150.12, 12578.80, 13928.72, 4417.92, 16674.58, 14235.52, 10093.72, 10707.32, 6442.80, 6841.64, 1349.92, 1165.84],
  nuevasAdquisicionesMaterialesPorMes: Array(12).fill(3863),
  ajusteFondoLiquidezPorMes: [349536.41, 535.15, 2796.00, 4525.67, 4533.63, 4541.60, 4549.60, 4557.62, 4565.65, 4573.71, 4581.78, 4589.88],

  totalCaptacionesPorMes: [52214539.62, 52291178.53, 52367952.14, 52444860.81, 52521904.84, 52599084.58, 52676400.36, 52753852.50, 52831441.34, 52909167.21, 52987030.45, 53065031.40],
  montoPrestamosAConcederPorMes: Array(12).fill(1555000).map((v, i) => (i === 11 ? 1675000 : v)),
};