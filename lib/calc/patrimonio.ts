/**
 * Motor de calculo puro - PATRIMONIO (31 Capital Social, 33 Reservas,
 * 34 Otros Aportes Patrimoniales, 35 Superávit por Valuaciones, 36 Resultados)
 *
 * Replica Agencia_Modelo filas 378-413.
 *
 * La cuenta 36 "Resultados" toma el RESULTADO DEL EJERCICIO, que ya viene
 * ACUMULADO año a la fecha (el Estado de Resultados usa esa convención YTD
 * en cada columna mensual). Esta funcion NO vuelve a acumular el valor
 * recibido -- solo lo usa tal cual, mes a mes.
 *
 * ACTUALIZACION: Capital Social (31) y los saldos de 33/34/35/36 ya NO son
 * constantes fijas de Matriz -- se reciben como parametros, para que cada
 * una de las 10 agencias pueda tener su propio saldo real y sus propios
 * parametros de socios (editables desde Patrimonio -> 31 Certificados de
 * Aportacion). Las constantes MATRIZ de mas abajo quedan solo como
 * referencia/fallback cuando una agencia todavia no tiene datos propios.
 *
 * Pendiente sin resolver (no bloquea el motor): "% Cancelación de Aporte de
 * Socio" y "Dividendo anual proyectado a pagar" (filas 386-387) estan en $0
 * y no se usan en ningun lado del archivo.
 */

interface ResultadoMesCapitalSocial {
  mes: number;
  saldo_inicial: number;
  incrementos: number; // socios nuevos x monto obligatorio de aporte
  retiros: number; // socios retirados x devolución promedio por socio (ya en negativo)
  capitalizacion_dividendos: number;
  saldo_final: number;
  socios_total: number; // informativo -- N° de socios acumulado, no participa en el saldo en $
}

export interface ConfigCapitalSocial {
  saldo_inicial: number;
  socios_inicial: number;
  monto_obligatorio_aporte_por_mes: number[];
  socios_nuevos_por_mes: number[];
  socios_retirados_por_mes: number[];
  capitalizacion_dividendos_por_mes: number[];
  /**
   * Lo que se devuelve en promedio a cada socio que se retira (se lleva todo lo
   * aportado, no solo la cuota del mes). Si no viene, se usa el monto
   * obligatorio de aporte (comportamiento anterior).
   */
  devolucion_promedio_por_mes?: number[];
}

function calcularCapitalSocial(cfg: ConfigCapitalSocial): ResultadoMesCapitalSocial[] {
  const resultados: ResultadoMesCapitalSocial[] = [];
  let saldo = cfg.saldo_inicial;
  let socios = cfg.socios_inicial;
  for (let i = 0; i < 12; i++) {
    const incrementos = cfg.socios_nuevos_por_mes[i] * cfg.monto_obligatorio_aporte_por_mes[i];
    const devolucion = cfg.devolucion_promedio_por_mes?.[i] ?? cfg.monto_obligatorio_aporte_por_mes[i];
    const retiros = -cfg.socios_retirados_por_mes[i] * devolucion;
    const capDividendos = cfg.capitalizacion_dividendos_por_mes[i];
    const saldoFinal = saldo + incrementos + retiros + capDividendos;
    socios = socios + cfg.socios_nuevos_por_mes[i] - cfg.socios_retirados_por_mes[i];
    resultados.push({
      mes: i + 1, saldo_inicial: saldo, incrementos, retiros,
      capitalizacion_dividendos: capDividendos, saldo_final: saldoFinal, socios_total: socios,
    });
    saldo = saldoFinal;
  }
  return resultados;
}

// ---- Datos reales de Matriz (referencia/fallback mientras una agencia no tenga datos propios) ----

export const CONFIG_CAPITAL_SOCIAL_MATRIZ: ConfigCapitalSocial = {
  saldo_inicial: 2582700.63, // Balance General!D133
  socios_inicial: 29447, // Operaciones!C20 (aproximado, informativo)
  monto_obligatorio_aporte_por_mes: Array(12).fill(15), // Operaciones!C19:N19
  socios_nuevos_por_mes: Array(12).fill(108), // Operaciones!C21:N21
  socios_retirados_por_mes: Array(12).fill(35), // Operaciones!C22:N22
  capitalizacion_dividendos_por_mes: Array(12).fill(0), // fila 387 no conectada (ver nota arriba)
};

const SALDO_RESERVAS_MATRIZ = 1647762.34; // Balance General!D134, referencia
const SALDO_OTROS_APORTES_MATRIZ = 0; // Balance General!D135, referencia
const SALDO_SUPERAVIT_MATRIZ = 126522.62; // Balance General!D136, referencia
const RESULTADOS_ACUMULADOS_INICIALES_MATRIZ = 0; // Balance General!D137, referencia

interface ResultadoMesPatrimonio {
  mes: number;
  capital_social: number;
  reservas: number;
  otros_aportes_patrimoniales: number;
  superavit_por_valuaciones: number;
  resultados: number; // acumulados iniciales + resultado del ejercicio ACUMULADO
  /** 3601/3602: resultados acumulados (años anteriores y el año del corte, cerrado); fijos en el ejercicio. */
  resultados_acumulados: number;
  /** 3603/3604: resultado del ejercicio acumulado (el mismo del Estado de resultados); pasa a 3601/3602 en el cierre. */
  resultado_ejercicio: number;
  total_patrimonio: number;
}

interface ConfigPatrimonio {
  capitalSocial: ConfigCapitalSocial;
  saldoReservas33: number;
  saldoOtrosAportes34: number;
  saldoSuperavit35: number;
  resultadosAcumuladosIniciales36: number;
  /** Movimientos del mes (opcionales): 34 donaciones / aportes no reembolsables, 35 revalúos (+) o desvalorizaciones (−). */
  movimientos34PorMes?: number[];
  movimientos35PorMes?: number[];
}

/**
 * @param resultadoDelEjercicioAcumuladoPorMes Resultado del Ejercicio ACUMULADO
 * (Ingresos - Egresos, acumulado desde enero) para cada uno de los 12 meses.
 * Debe venir del motor de Ingresos/Egresos.
 * @param config Capital Social y saldos de 33/34/35/36 de la agencia. Si se
 * omite, usa la referencia de Matriz (comportamiento anterior).
 */
export function calcularPatrimonioMatriz(
  resultadoDelEjercicioAcumuladoPorMes: number[],
  config: ConfigPatrimonio = {
    capitalSocial: CONFIG_CAPITAL_SOCIAL_MATRIZ,
    saldoReservas33: SALDO_RESERVAS_MATRIZ,
    saldoOtrosAportes34: SALDO_OTROS_APORTES_MATRIZ,
    saldoSuperavit35: SALDO_SUPERAVIT_MATRIZ,
    resultadosAcumuladosIniciales36: RESULTADOS_ACUMULADOS_INICIALES_MATRIZ,
  }
): ResultadoMesPatrimonio[] {
  if (resultadoDelEjercicioAcumuladoPorMes.length !== 12) {
    throw new Error("resultadoDelEjercicioAcumuladoPorMes debe tener 12 valores");
  }
  const capitalSocial = calcularCapitalSocial(config.capitalSocial);

  const resultados: ResultadoMesPatrimonio[] = [];
  let saldo34 = config.saldoOtrosAportes34;
  let saldo35 = config.saldoSuperavit35;
  for (let i = 0; i < 12; i++) {
    saldo34 += config.movimientos34PorMes?.[i] ?? 0;
    saldo35 += config.movimientos35PorMes?.[i] ?? 0;
    const resultadosCuenta36 = config.resultadosAcumuladosIniciales36 + resultadoDelEjercicioAcumuladoPorMes[i];
    const total =
      capitalSocial[i].saldo_final + config.saldoReservas33 + saldo34 + saldo35 + resultadosCuenta36;
    resultados.push({
      mes: i + 1,
      capital_social: capitalSocial[i].saldo_final,
      reservas: config.saldoReservas33,
      otros_aportes_patrimoniales: saldo34,
      superavit_por_valuaciones: saldo35,
      resultados: resultadosCuenta36,
      resultados_acumulados: config.resultadosAcumuladosIniciales36,
      resultado_ejercicio: resultadoDelEjercicioAcumuladoPorMes[i],
      total_patrimonio: total,
    });
  }
  return resultados;
}

/** Detalle completo de Capital Social, mes a mes (para la pantalla de Patrimonio -> 31). */
export function calcularDetalleCapitalSocial(config: ConfigCapitalSocial): ResultadoMesCapitalSocial[] {
  return calcularCapitalSocial(config);
}