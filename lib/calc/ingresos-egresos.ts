/**
 * Motor de calculo puro - INGRESOS Y EGRESOS (Estado de Perdidas y Ganancias)
 * Replica Agencia_Modelo filas 415-911.
 *
 * DISEÑO CLAVE (descubierto y corregido hoy): el Estado de Resultados
 * muestra ACUMULADO AÑO A LA FECHA (YTD) en cada columna mensual, no el mes
 * aislado. Casi todas las lineas usan SUM($C$fila:columnaActual) para
 * acumular un flujo mensual genuino; algunas pocas (Intereses Causados de
 * Ahorros/Creditos Externos, Comisiones Ganadas de cartera con mora) ya
 * traen su PROPIA acumulacion via rollforward (saldo_final = saldo_final
 * mes anterior + flujo del mes) — a esas NO hay que aplicarles el SUM()
 * de nuevo (se detecto y corrigio un doble-conteo real en el Excel por
 * este motivo). Esta funcion ya replica el comportamiento correcto.
 *
 * ARQUITECTURA: las partidas que se pueden derivar de otros motores ya
 * construidos (Captaciones, Cartera, Pasivo, Activo Fijo, Otros Activos)
 * se calculan aqui a partir de esas salidas. Las partidas que vienen de
 * hojas institucionales no modeladas (TH1, TH2, Gerencia, Contabilidad,
 * Administrativo, OSI, Tecnologia, SSO, Marketing, Operaciones, Credito)
 * se reciben como arrays mensuales YA RESUELTOS en $ (mismo patron usado
 * en los demas motores para "prestamosAConceder", "nuevosPagosPorMes", etc).
 * A partir de la pantalla de Presupuesto Departamental, estos arrays se
 * arman sumando por cuenta contable real desde la tabla
 * presupuesto_departamental (ver orquestador.ts: construirInputInstitucional).
 *
 * SIMPLIFICACION: "Intereses ganados por Depositos e Inversiones" (filas
 * 651/653) en el Excel real usa el saldo de Caja/Bancos PROYECTADO del mes
 * anterior (que viene del propio Flujo de Efectivo) a partir de febrero —
 * una dependencia circular de baja materialidad (montos de $1.000-$10.000
 * contra un resultado de cientos de miles). Aqui se recibe como array
 * mensual ya resuelto en $ para evitar modelar esa dependencia circular.
 */

// ---------- Helper generico: acumulacion YTD ----------

/** Convierte un array de 12 flujos MENSUALES aislados en su acumulado YTD. */
function acumularYTD(valoresPorMes: number[]): number[] {
  const acumulado: number[] = [];
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    suma += valoresPorMes[i];
    acumulado.push(suma);
  }
  return acumulado;
}

// ---------- Intereses Causados (41) ----------

interface ParametrosInteresesCausados {
  capitalizacionInteresVistaPorMes: number[]; // Captaciones: calcularCuentaAhorro(vista).detalle.capitalizacionInteres
  capitalizacionInteresCrecerPorMes: number[]; // Captaciones: calcularCuentaAhorro(crecer).detalle.capitalizacionInteres
  dpfSaldoInicialPorMes: number[]; // Captaciones: calcularDPF(...).saldoInicial
  dpfSaldoFinalPorMes: number[]; // Captaciones: calcularDPF(...).saldoFinal
  tasaDPFAnualPorMes: number[]; // Captaciones!C4 (tasa nominal DPF)
  interesesCreditosExternosPorMes: number[]; // Pasivo: promedio(saldo)*tasa/12 por cada credito, sumados (0 en Matriz)
}

function calcularInteresesCausados(params: ParametrosInteresesCausados): {
  obligacionesConElPublicoAcumulado: number[]; // ya viene con rollforward propio en el Excel -> aqui se acumula una sola vez
  obligacionesFinancierasAcumulado: number[];
  totalAcumulado: number[];
} {
  const flujoMensualAhorros = params.capitalizacionInteresVistaPorMes.map(
    (v, i) => v + params.capitalizacionInteresCrecerPorMes[i]
  );
  const flujoMensualDPF = params.dpfSaldoInicialPorMes.map(
    (saldoIni, i) => ((saldoIni + params.dpfSaldoFinalPorMes[i]) / 2) * (params.tasaDPFAnualPorMes[i] / 12)
  );
  const flujoMensualObligPublico = flujoMensualAhorros.map((v, i) => v + flujoMensualDPF[i]);

  const obligacionesConElPublicoAcumulado = acumularYTD(flujoMensualObligPublico);
  const obligacionesFinancierasAcumulado = acumularYTD(params.interesesCreditosExternosPorMes);
  const totalAcumulado = obligacionesConElPublicoAcumulado.map((v, i) => v + obligacionesFinancierasAcumulado[i]);

  return { obligacionesConElPublicoAcumulado, obligacionesFinancierasAcumulado, totalAcumulado };
}

// ---------- Provision de Cartera (44) ----------

export interface ParametrosLineaProvision {
  saldoInicialDicAnterior: number; // 'Balance General'!D61/62/63/64 (negativo)
  carteraTotalPorMes: number[]; // Cartera: (porVencer[i].saldoFinal + enRiesgo[i].saldoFinal), 12 valores
  ratioProvisionPorMes: number[]; // Parametros!C4/C5/C6/C7
  /** Castigos del mes (modelo por flow rates): consumen provisión y son parte del gasto neto. */
  castigosPorMes?: number[];
  /**
   * Provisión requerida al cierre de cada mes (positiva). Si viene, manda sobre cartera × ratio:
   * con la cartera en 0 el ratio no puede expresar una provisión que se mantiene, y se inventaba una reversión.
   */
  saldoPorMes?: number[];
}

/** Saldo de provisión de la línea al cierre del mes i (positivo). */
export function saldoProvisionMes(p: ParametrosLineaProvision, i: number): number {
  return p.saldoPorMes ? p.saldoPorMes[i] ?? 0 : p.carteraTotalPorMes[i] * p.ratioProvisionPorMes[i];
}

/** Replica el rollforward de Provision (Saldo Inicial + Variacion = Saldo Final) y devuelve la Variacion acumulada YTD (el gasto que va al Estado de Resultados). */
function calcularVariacionProvisionAcumulada(params: ParametrosLineaProvision): number[] {
  const flujoMensual: number[] = [];
  let saldoAnterior = params.saldoInicialDicAnterior;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = -saldoProvisionMes(params, i);
    const variacion = saldoFinal - saldoAnterior;
    // en el Estado de Resultados la Provision se muestra como gasto positivo (*-1); el castigo consume
    // provisión sin pasar por el saldo final, así que se suma al gasto del mes
    flujoMensual.push(-variacion + (params.castigosPorMes?.[i] ?? 0));
    saldoAnterior = saldoFinal;
  }
  return acumularYTD(flujoMensual);
}

interface ParametrosProvisionCartera {
  productivo: ParametrosLineaProvision;
  consumo: ParametrosLineaProvision;
  inmobiliario: ParametrosLineaProvision;
  microcredito: ParametrosLineaProvision;
}

function calcularProvisionCarteraAcumulada(params: ParametrosProvisionCartera): number[] {
  const p = calcularVariacionProvisionAcumulada(params.productivo);
  const c = calcularVariacionProvisionAcumulada(params.consumo);
  const i2 = calcularVariacionProvisionAcumulada(params.inmobiliario);
  const m = calcularVariacionProvisionAcumulada(params.microcredito);
  return p.map((v, i) => v + c[i] + i2[i] + m[i]);
}

// ---------- Ingresos por Intereses de Cartera (51/5104) ----------

interface ParametrosIngresoCartera {
  ingresoPorInteresPorProducto: number[][]; // 4 arrays de 12 valores (Cartera: calcularLineaCartera(...).ingresoPorInteres, por producto)
  relacionMoraInteresNormal: number; // Credito!B50 (constante, ej. 0.05)
}

function calcularIngresosCarteraAcumulado(params: ParametrosIngresoCartera): number[] {
  const flujoMensualSinMora = Array.from({ length: 12 }, (_, i) =>
    params.ingresoPorInteresPorProducto.reduce((sum, arr) => sum + arr[i], 0)
  );
  const flujoMensualMora = flujoMensualSinMora.map((v) => v * params.relacionMoraInteresNormal);
  const flujoMensualTotal = flujoMensualSinMora.map((v, i) => v + flujoMensualMora[i]);
  return acumularYTD(flujoMensualTotal);
}

// ---------- Aportes COSEDE (parte de 4504 Impuestos) ----------

function calcularAportesCosedeAcumulado(totalCaptacionesPorMes: number[]): {
  primaFijaAcumulada: number[];
  primaVariableAcumulada: number[];
} {
  const primaFijaMensual = totalCaptacionesPorMes.map((v) => (0.54 * v) / 1000);
  const primaVariableMensual = totalCaptacionesPorMes.map((v) => 0.000033333 * v);
  return {
    primaFijaAcumulada: acumularYTD(primaFijaMensual),
    primaVariableAcumulada: acumularYTD(primaVariableMensual),
  };
}

// ---------- Agregado final: INGRESOS Y EGRESOS ----------

export interface InputExternoInstitucional {
  gastosPersonalPorMes: number[]; // Cuenta 4501 completa (Presupuesto Departamental: TH1/TH2)
  honorariosPorMes: number[]; // Cuenta 4502 completa (Gerencia/TH2/Contabilidad)
  serviciosVariosPorMes: number[]; // Cuenta 4503 completa (Contabilidad/Gerencia/Administrativo)
  impuestosMunicipalesYOtrosPorMes: number[]; // 450410+450430+450490 (SIN Aportes SEPS 450415 ni COSEDE 450420/450421)
  aportesSEPSPorMes: number[]; // Cuenta 450415 — mismo array usado en el motor de Pasivo
  comisionesCausadasPorMes: number[]; // Cuenta 42 completa (Comisiones Causadas, ej. servicios fiduciarios CFN)
  otrosGastosOperInstitucionalPorMes: number[]; // 450710+450715+450790 (SIN 450705 Suministros)
  otrosGastosYPerdidasPorMes: number[]; // Cuenta 47 completa
  participacionEmpleadosEImpuestoRentaPorMes: number[]; // Cuenta 48 completa (0 en Matriz)
  comisionesGanadasCarteraPorMes: number[]; // Sin cuenta identificada aun (0 en Matriz)
  utilidadesFinancierasPorMes: number[]; // Cuenta 53 completa
  ingresosPorServiciosPorMes: number[]; // Cuenta 54 completa (Operaciones)
  otrosIngresosOperacionalesPorMes: number[]; // Cuenta 55 completa (0 en Matriz)
  otrosIngresosPorMes: number[]; // Cuenta 56 completa (Credito/Operaciones)
  depositosEInversionesPorMes: number[]; // 5101+5103 (SIN 5104, que es interes de cartera y ya sale del motor de Cartera)
  /** Gastos cargados en grupos o cuentas que no tienen línea propia (ej. 43, 46, 4508): entran igual al resultado. */
  otrosEgresosAdicionalesPorMes: number[];
  /** Ingresos cargados en grupos o cuentas sin línea propia (ej. 50, 57): entran igual al resultado. */
  otrosIngresosAdicionalesPorMes: number[];
}

interface ResultadoMesIngresosEgresos {
  mes: number;
  total_ingresos_acumulado: number;
  total_egresos_acumulado: number;
  resultado_del_ejercicio_acumulado: number;
}

export function calcularIngresosEgresosMatriz(input: {
  interesesCausados: ParametrosInteresesCausados;
  provisionCartera: ParametrosProvisionCartera;
  ingresoCartera: ParametrosIngresoCartera;
  totalCaptacionesPorMes: number[]; // para Aportes COSEDE (si no llega cosedeMensual)
  /** COSEDE ya calculado (lib/calc/contribuciones): prima fija y PAR del mes. */
  cosedeMensual?: { fija: number[]; par: number[] };
  depreciacionMensualPorMes: number[]; // suma de las 7 categorias del motor Activo Fijo, ya con tope aplicado
  amortizacionGastosAnticipadosPorMes: number[]; // Otros Activos: gastosAnticipados1904.salidasPorMes
  amortizacionMaterialesPorMes: number[]; // Otros Activos: materiales1906.salidasPorMes (= "Suministros diversos")
  externo: InputExternoInstitucional;
}): ResultadoMesIngresosEgresos[] {
  const intCausados = calcularInteresesCausados(input.interesesCausados);
  const provisionAcum = calcularProvisionCarteraAcumulada(input.provisionCartera);
  const ingresoCarteraAcum = calcularIngresosCarteraAcumulado(input.ingresoCartera);
  const cosede = input.cosedeMensual
    ? { primaFijaAcumulada: acumularYTD(input.cosedeMensual.fija), primaVariableAcumulada: acumularYTD(input.cosedeMensual.par) }
    : calcularAportesCosedeAcumulado(input.totalCaptacionesPorMes);

  const depreciacionAcum = acumularYTD(input.depreciacionMensualPorMes.map((v) => -v)); // gasto positivo
  const amortizacionAcum = acumularYTD(
    input.amortizacionGastosAnticipadosPorMes.map((v, i) => v) // ya son montos positivos de amortizacion
  );
  const suministrosAcum = acumularYTD(input.amortizacionMaterialesPorMes);

  const gastosPersonalAcum = acumularYTD(input.externo.gastosPersonalPorMes);
  const honorariosAcum = acumularYTD(input.externo.honorariosPorMes);
  const serviciosVariosAcum = acumularYTD(input.externo.serviciosVariosPorMes);
  const impuestosMunicipalesYOtrosAcum = acumularYTD(input.externo.impuestosMunicipalesYOtrosPorMes);
  const aportesSEPSAcum = acumularYTD(input.externo.aportesSEPSPorMes);
  const comisionesCausadasAcum = acumularYTD(input.externo.comisionesCausadasPorMes);
  const otrosGastosOperInstitucionalAcum = acumularYTD(input.externo.otrosGastosOperInstitucionalPorMes);
  const otrosGastosYPerdidasAcum = acumularYTD(input.externo.otrosGastosYPerdidasPorMes);
  const participacionEImpuestoRentaAcum = acumularYTD(input.externo.participacionEmpleadosEImpuestoRentaPorMes);
  const comisionesGanadasCarteraAcum = acumularYTD(input.externo.comisionesGanadasCarteraPorMes);
  const utilidadesFinancierasAcum = acumularYTD(input.externo.utilidadesFinancierasPorMes);
  const ingresosPorServiciosAcum = acumularYTD(input.externo.ingresosPorServiciosPorMes);
  const otrosIngresosOperacionalesAcum = acumularYTD(input.externo.otrosIngresosOperacionalesPorMes);
  const otrosIngresosAcum = acumularYTD(input.externo.otrosIngresosPorMes);
  const depositosEInversionesAcum = acumularYTD(input.externo.depositosEInversionesPorMes);
  const otrosEgresosAdicionalesAcum = acumularYTD(input.externo.otrosEgresosAdicionalesPorMes ?? Array(12).fill(0));
  const otrosIngresosAdicionalesAcum = acumularYTD(input.externo.otrosIngresosAdicionalesPorMes ?? Array(12).fill(0));

  const resultados: ResultadoMesIngresosEgresos[] = [];
  for (let i = 0; i < 12; i++) {
    // 45 Gastos de Operacion = Personal + Honorarios + Servicios Varios + Impuestos(municipales+otros+SEPS+COSEDE) + Depreciaciones + Amortizaciones + Otros Gastos(suministros+institucional)
    const impuestosTotal =
      impuestosMunicipalesYOtrosAcum[i] + aportesSEPSAcum[i] + cosede.primaFijaAcumulada[i] + cosede.primaVariableAcumulada[i];
    const otrosGastosTotal = suministrosAcum[i] + otrosGastosOperInstitucionalAcum[i];
    const gastosOperacion =
      gastosPersonalAcum[i] + honorariosAcum[i] + serviciosVariosAcum[i] + impuestosTotal + depreciacionAcum[i] + amortizacionAcum[i] + otrosGastosTotal;

    const totalEgresos =
      intCausados.totalAcumulado[i] +
      comisionesCausadasAcum[i] +
      provisionAcum[i] +
      gastosOperacion +
      otrosGastosYPerdidasAcum[i] +
      participacionEImpuestoRentaAcum[i] +
      otrosEgresosAdicionalesAcum[i];

    const totalIngresos =
      depositosEInversionesAcum[i] +
      ingresoCarteraAcum[i] +
      comisionesGanadasCarteraAcum[i] +
      utilidadesFinancierasAcum[i] +
      ingresosPorServiciosAcum[i] +
      otrosIngresosOperacionalesAcum[i] +
      otrosIngresosAcum[i] +
      otrosIngresosAdicionalesAcum[i];

    resultados.push({
      mes: i + 1,
      total_ingresos_acumulado: totalIngresos,
      total_egresos_acumulado: totalEgresos,
      resultado_del_ejercicio_acumulado: totalIngresos - totalEgresos,
    });
  }
  return resultados;
}

// ---------- Datos de referencia (validos SOLO como respaldo antes de que la ----------
// ---------- pantalla de Presupuesto Departamental tenga datos cargados) ----------

export const INPUT_INGRESOS_EGRESOS_MATRIZ_EXTERNO: InputExternoInstitucional = {
  gastosPersonalPorMes: [167824.07, 162858.07, 174801.25, 161614.73, 174300.73, 172099.26, 160471.76, 162157.43, 159092.76, 160455.89, 160760.73, 173883.06],
  honorariosPorMes: [7932.00, 10112.04, 9099.60, 7962.68, 11554.00, 6982.68, 6952.00, 8024.04, 9099.60, 6982.68, 6952.00, 6982.68],
  serviciosVariosPorMes: [43925.71, 35550.71, 38625.27, 44229.42, 36303.22, 35045.34, 35236.31, 34839.97, 36862.35, 38569.02, 41574.18, 34407.95],
  impuestosMunicipalesYOtrosPorMes: [2112.50, 112.50, 112.50, 25112.50, 112.50, 112.50, 112.50, 112.50, 112.50, 112.50, 112.50, 112.50],
  aportesSEPSPorMes: [0, 0, 0, 25000, 0, 0, 0, 0, 24000, 0, 0, 0],
  comisionesCausadasPorMes: Array(12).fill(0),
  otrosGastosOperInstitucionalPorMes: [14180.95, 17472.73, 14665.72, 14253.17, 14008.96, 14040.46, 14475.91, 14392.46, 14533.80, 14047.62, 13800.34, 14802.33],
  otrosGastosYPerdidasPorMes: Array(12).fill(3550),
  participacionEmpleadosEImpuestoRentaPorMes: Array(12).fill(0),
  comisionesGanadasCarteraPorMes: Array(12).fill(0),
  utilidadesFinancierasPorMes: Array(12).fill(9000),
  ingresosPorServiciosPorMes: [21395, 21395, 21395, 21395, 21395, 21395, 21395, 21395, 21395, 21755, 21755, 21755],
  otrosIngresosOperacionalesPorMes: Array(12).fill(0),
  otrosIngresosPorMes: [113161, 113161, 113161, 113288, 113288, 113288, 113288, 113288, 113288, 65788, 65788, 65788],
  depositosEInversionesPorMes: [9911.37, 9066.91, 8512.63, 7903.91, 7318.97, 6766.92, 6244.59, 5753.04, 5277.61, 4822.55, 4349.76, 3895.19],
  otrosEgresosAdicionalesPorMes: Array(12).fill(0),
  otrosIngresosAdicionalesPorMes: Array(12).fill(0),
};