/**
 * Motor de calculo puro - PASIVO
 * Replica Agencia_Modelo filas 327-372.
 *
 * 25 Cuentas por Pagar — saldo inicial + incrementos (vienen del gasto
 *   "Aportes a la SEPS", Contabilidad!C57 — se recibe aqui ya resuelto en
 *   $) - pagos fijos mensuales.
 * 26 Créditos Externos — 4 creditos, todos en $0 en Matriz (sin
 *   incrementos ni pagos programados). Se deja la estructura generica por
 *   si en el futuro se activa alguno.
 * 29 Otros Pasivos — 2908 Transferencias Internas Recibidas (incremento
 *   fijo mensual, viene de Tesoreria) + 2990 Otros (saldo estatico, sin
 *   movimiento despues de enero).
 */

interface ResultadoMesGenerico {
  mes: number;
  saldo_inicial: number;
  saldo_final: number;
}

// ---------- 25 Cuentas por Pagar ----------

interface ParametrosCuentasPorPagar {
  saldoInicialEnero: number; // 'Balance General'!D123
  incrementosPorMes: number[]; // 12 valores, ya resueltos en $ (Contabilidad!C57, "Aportes a la SEPS" devengados)
  pagosPorMes: number[]; // 12 valores, ya resueltos en $ (Contabilidad!C22)
}

export function calcularCuentasPorPagar(params: ParametrosCuentasPorPagar): ResultadoMesGenerico[] {
  const resultados: ResultadoMesGenerico[] = [];
  let saldo = params.saldoInicialEnero;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = saldo + params.incrementosPorMes[i] - params.pagosPorMes[i];
    resultados.push({ mes: i + 1, saldo_inicial: saldo, saldo_final: saldoFinal });
    saldo = saldoFinal;
  }
  return resultados;
}

// ---------- 26 Créditos Externos (4 lineas, genericas) ----------

interface ParametrosCreditoExterno {
  saldoInicialEnero: number;
  incrementosPorMes: number[]; // 12 valores, ya resueltos en $ (0 en Matriz)
  pagosPorMes: number[]; // 12 valores, ya resueltos en $ (0 en Matriz)
}

export function calcularCreditoExterno(params: ParametrosCreditoExterno): ResultadoMesGenerico[] {
  const resultados: ResultadoMesGenerico[] = [];
  let saldo = params.saldoInicialEnero;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = saldo + params.incrementosPorMes[i] - params.pagosPorMes[i];
    resultados.push({ mes: i + 1, saldo_inicial: saldo, saldo_final: saldoFinal });
    saldo = saldoFinal;
  }
  return resultados;
}

function calcularTotalCreditosExternos(creditos: ParametrosCreditoExterno[]): number[] {
  const resultadosPorCredito = creditos.map(calcularCreditoExterno);
  return Array.from({ length: 12 }, (_, i) => resultadosPorCredito.reduce((sum, r) => sum + r[i].saldo_final, 0));
}

// ---------- 29 Otros Pasivos ----------

interface ParametrosTransferenciasInternasRecibidas {
  saldoInicialEnero: number; // 'Balance General'!D130
  incrementosPorMes: number[]; // 12 valores, ya resueltos en $ (Tesoreria!C9:N9)
  disminucionesPorMes: number[]; // 12 valores, ya resueltos en $ (0 en Matriz)
}

export function calcularTransferenciasInternasRecibidas(
  params: ParametrosTransferenciasInternasRecibidas
): ResultadoMesGenerico[] {
  const resultados: ResultadoMesGenerico[] = [];
  let saldo = params.saldoInicialEnero;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = saldo + params.incrementosPorMes[i] - params.disminucionesPorMes[i];
    resultados.push({ mes: i + 1, saldo_inicial: saldo, saldo_final: saldoFinal });
    saldo = saldoFinal;
  }
  return resultados;
}

// ---------- Agregado: PASIVO total ----------

interface ResultadoMesPasivo {
  mes: number;
  cuentas_por_pagar_25: number;
  creditos_externos_26: number;
  transferencias_internas_recibidas_2908: number;
  otros_2990: number;
  total: number;
}

export function calcularPasivoMatriz(input: {
  cuentasPorPagar: ParametrosCuentasPorPagar;
  creditosExternos: ParametrosCreditoExterno[]; // 4 elementos
  transferenciasInternasRecibidas: ParametrosTransferenciasInternasRecibidas;
  otrosFijo2990: number; // 'Balance General'!D131, estatico (sin movimiento tras enero)
}): ResultadoMesPasivo[] {
  const cxp = calcularCuentasPorPagar(input.cuentasPorPagar);
  const totalCreditos = calcularTotalCreditosExternos(input.creditosExternos);
  const transf = calcularTransferenciasInternasRecibidas(input.transferenciasInternasRecibidas);

  const resultados: ResultadoMesPasivo[] = [];
  for (let i = 0; i < 12; i++) {
    const total = cxp[i].saldo_final + totalCreditos[i] + transf[i].saldo_final + input.otrosFijo2990;
    resultados.push({
      mes: i + 1,
      cuentas_por_pagar_25: cxp[i].saldo_final,
      creditos_externos_26: totalCreditos[i],
      transferencias_internas_recibidas_2908: transf[i].saldo_final,
      otros_2990: input.otrosFijo2990,
      total,
    });
  }
  return resultados;
}

// ---------- Datos reales de Matriz (para validar el motor) ----------

export const INPUT_PASIVO_MATRIZ = {
  cuentasPorPagar: {
    saldoInicialEnero: 1666857, // Balance General!D123
    incrementosPorMes: [0, 0, 0, 25000, 0, 0, 0, 0, 24000, 0, 0, 0], // Contabilidad!C57 (Aportes a la SEPS devengados)
    pagosPorMes: Array(12).fill(10000), // Contabilidad!C22
  },
  creditosExternos: [
    { saldoInicialEnero: 0, incrementosPorMes: Array(12).fill(0), pagosPorMes: Array(12).fill(0) }, // Credito 1 Conafips
    { saldoInicialEnero: 0, incrementosPorMes: Array(12).fill(0), pagosPorMes: Array(12).fill(0) }, // Credito 2
    { saldoInicialEnero: 0, incrementosPorMes: Array(12).fill(0), pagosPorMes: Array(12).fill(0) }, // Credito 3
    { saldoInicialEnero: 0, incrementosPorMes: Array(12).fill(0), pagosPorMes: Array(12).fill(0) }, // Credito 4
  ],
  transferenciasInternasRecibidas: {
    saldoInicialEnero: 717750.25, // Balance General!D130
    incrementosPorMes: Array(12).fill(400000), // Tesoreria!C9:N9
    disminucionesPorMes: Array(12).fill(0),
  },
  otrosFijo2990: 3842.94, // Balance General!D131 — estatico, se mantiene igual todo el año
};