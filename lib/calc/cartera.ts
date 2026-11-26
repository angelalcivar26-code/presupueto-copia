import type { ResultadoMensual } from "./tipos";

/**
 * Replica de las formulas de Agencia_Modelo para Consumo (filas 47-75) y
 * Microcredito (filas 105-133) — ambas lineas comparten exactamente la
 * misma estructura de rollforward (Por Vencer + En Riesgo), asi que una
 * sola funcion sirve para las dos en vez de duplicar el bloque.
 *
 * Productivo e Inmobiliario usan la MISMA estructura de rollforward, pero
 * el monto a conceder no pasa por Meta/Distribucion (ver
 * decidirMontoAConceder mas abajo) — igual pueden usar esta funcion.
 */
export interface ParametrosLineaCartera {
  tasaInteresAnual: number[]; // informativo (ingreso por interes), 12 valores
  pctRecuperacionPeriodo: number[]; // 12 valores
  tasaEfectividadRecuperacion: number[]; // 12 valores
  tasaRecuperacionCarteraVencida: number[]; // 12 valores
  prestamosAConceder: number[]; // $ ya resuelto segun modo de colocacion (ver decidirMontoAConceder), 12 valores
  /** % mensual de la cartera por vencer que pasa a riesgo (null = (1 − efectividad) × % de recuperación del período). */
  pctPaseRiesgo?: (number | null)[];
  /** % mensual de la cartera por vencer que se precancela con dinero (sin refinanciamientos, reestructurados ni novaciones:
   *  esos cancelan y vuelven a colocar el mismo saldo, no bajan la cartera ni entran a caja). */
  pctPrecancelacion?: number[];
  /** % mensual del saldo en riesgo que se precancela con dinero (ritmo real × el mismo margen de la cartera por vencer). */
  pctPrecancelacionVencida?: number[];
}

interface ResultadoLineaCartera {
  porVencer: ResultadoMensual[];
  enRiesgo: ResultadoMensual[];
  ingresoPorInteres: number[]; // informativo, fila "Ingresos por intereses"
}

export function calcularLineaCartera(
  saldoInicialPorVencerEnero: number,
  saldoInicialEnRiesgoEnero: number,
  params: ParametrosLineaCartera
): ResultadoLineaCartera {
  const porVencer: ResultadoMensual[] = [];
  const enRiesgo: ResultadoMensual[] = [];
  const ingresoPorInteres: number[] = [];

  let saldoIniPorVencer = saldoInicialPorVencerEnero;
  let saldoIniRiesgo = saldoInicialEnRiesgoEnero;

  for (let mes = 1; mes <= 12; mes++) {
    const i = mes - 1;

    // Cobro de cuotas (recuperación neta) y, aparte, precancelaciones con dinero. El pase a riesgo es el % propio del
    // saldo si está cargado (en la contabilidad pasa a no devenga todo el saldo de la operación, no solo la cuota impaga);
    // si no, la parte de las cuotas que no se cobra, como antes.
    const pase = params.pctPaseRiesgo?.[i];
    const cuotasCobradas = -saldoIniPorVencer * params.pctRecuperacionPeriodo[i] * params.tasaEfectividadRecuperacion[i];
    const precancelaciones = -saldoIniPorVencer * (params.pctPrecancelacion?.[i] ?? 0);
    const recuperacionPrestamos = cuotasCobradas + precancelaciones;
    const incrementosRiesgo = pase !== null && pase !== undefined
      ? saldoIniPorVencer * pase
      : saldoIniPorVencer * params.pctRecuperacionPeriodo[i] * (1 - params.tasaEfectividadRecuperacion[i]);
    const recuperacionNetaRiesgo = saldoIniRiesgo * params.tasaRecuperacionCarteraVencida[i];
    const precancelacionesRiesgo = saldoIniRiesgo * (params.pctPrecancelacionVencida?.[i] ?? 0);
    const recuperacionRiesgo = recuperacionNetaRiesgo + precancelacionesRiesgo;

    const saldoFinalPorVencer =
      saldoIniPorVencer + params.prestamosAConceder[i] + recuperacionPrestamos - incrementosRiesgo;
    const saldoFinalRiesgo = saldoIniRiesgo + incrementosRiesgo - recuperacionRiesgo;

    porVencer.push({
      mes,
      saldoInicial: saldoIniPorVencer,
      saldoFinal: saldoFinalPorVencer,
      detalle: { prestamosAConceder: params.prestamosAConceder[i], recuperacionPrestamos, cuotasCobradas, precancelaciones, incrementosRiesgo },
    });

    enRiesgo.push({
      mes,
      saldoInicial: saldoIniRiesgo,
      saldoFinal: saldoFinalRiesgo,
      detalle: { incrementosRiesgo, recuperacionRiesgo, recuperacionNeta: recuperacionNetaRiesgo, precancelaciones: precancelacionesRiesgo },
    });

    // Excel: "Ingresos por intereses" = AVERAGE(saldoInicial, saldoFinal) * (tasaAnual/12)
    ingresoPorInteres.push(
      ((saldoIniPorVencer + saldoFinalPorVencer) / 2) * (params.tasaInteresAnual[i] / 12)
    );

    saldoIniPorVencer = saldoFinalPorVencer;
    saldoIniRiesgo = saldoFinalRiesgo;
  }

  return { porVencer, enRiesgo, ingresoPorInteres };
}
