/**
 * Motor de calculo puro - OTROS ACTIVOS (cuenta 19)
 * Replica Agencia_Modelo filas 196-239.
 *
 * Sub-cuentas:
 * 1901 Inversiones en acciones — estatica, sin movimiento en Matriz.
 * 1902 Derechos Fiduciarios (Fondo de Liquidez) — metodologia de la Guia
 *   COSEDE (ver calcularFondoLiquidez). Base: grupo 21 proyectado de la
 *   agencia; punto de partida: saldos del corte mas reciente cargado.
 * 1904 Gastos y pagos anticipados — amortizacion fija + nuevos pagos que
 *   vienen de otras hojas institucionales (OSI/Tecnologia/Gerencia), se
 *   reciben aqui como array ya resuelto en $.
 * 1906 Materiales, mercaderias e insumos — mismo patron, nuevas
 *   adquisiciones vienen de Administrativo, ya resueltas en $.
 * 1908 Transferencias Internas — incrementos (fondos remitidos a otras
 *   agencias) vienen de Tesoreria, ya resueltos en $; disminuciones en 0
 *   para Matriz (no se han modelado devoluciones).
 * 1990 Otros — FIJADA a valor real Dic2025 (bug corregido hoy: antes tenia
 *   sumado un "4% de Captaciones" duplicado que ya vive correctamente en
 *   1902).
 * 1999 (Provision para otros activos irrecuperables) — estatica.
 */

// ---------- 1901 Inversiones en acciones ----------

export function calcularInversiones(saldoInicial: number): number[] {
  // Sin movimiento en Matriz (filas 199/200 vacias) — se mantiene flat.
  return Array(12).fill(saldoInicial);
}

// ---------- 1902 Derechos Fiduciarios (Fondo de Liquidez, metodologia COSEDE) ----------
//
// Paso 1  Promedio de Obligaciones con el Publico (grupo 21). Solo hay saldos de fin de
//         mes, asi que se aproxima con el promedio de los 2 meses anteriores: enero usa el
//         saldo del corte; febrero, corte y enero; de marzo en adelante, los 2 meses previos.
//         La base es la MISMA en todos los meses: grupo 21 proyectado (Captaciones + las
//         demas cuentas del 21 fijas en su saldo del corte).
// Paso 2  Aporte requerido = promedio x % aplicado. El % vigente es el mismo para todas las
//         COAC, sube 0,5 puntos cada enero y tiene tope en la meta (7,5 %); es editable.
// Paso 3  Ajuste = aporte requerido de este mes - aporte del mes anterior. Positivo = aporte
//         adicional (sale de caja); negativo = reintegro (entra a caja). En enero el "aporte
//         anterior" es el saldo real de la 1902 al corte (incluye rendimientos capitalizados).
// Saldo 1902 = saldo anterior + ajuste. Cada agencia paga su propio aporte.

export interface ParametrosFondoLiquidez {
  pctVigentePorMes: number[]; // 12 valores, % Aporte vigente (Paso 2 guia COSEDE)
  metaPct?: number; // tope del % (7,5 % COAC). Si falta, no se limita.
  saldoObligacionesPublicoDicAnterior: number; // grupo 21 al corte
  saldo1902DicAnterior: number; // saldo de los APORTES al fondo al corte (19028601; sin el detalle, toda la 1902)
  /** Rendimientos del fideicomiso al corte (1902 − aportes): no se mueven con el aporte ni el reintegro. */
  rendimientos1902?: number;
  /** Rendimiento de cada mes del ejercicio (se capitaliza en la 1902; ingreso 53040505, no es efectivo). */
  rendimientoPorMes?: number[];
  totalCaptacionesPorMes: number[]; // 12 valores: grupo 21 proyectado al cierre de cada mes
}

interface ResultadoMesFondoLiquidez {
  mes: number;
  promedio_obligaciones_aprox: number; // Paso 1
  pct_aplicado: number; // minimo entre % vigente y meta
  aporte_mensual_actual: number; // Paso 2
  saldo_inicial: number;
  ajuste: number; // Paso 3 (alimenta Flujo de Efectivo)
  saldo_final: number; // participacion fiduciaria (cuenta 1902)
}

export function calcularFondoLiquidez(params: ParametrosFondoLiquidez): ResultadoMesFondoLiquidez[] {
  const resultados: ResultadoMesFondoLiquidez[] = [];
  const oblig = params.totalCaptacionesPorMes;
  const corte = params.saldoObligacionesPublicoDicAnterior;

  let aporteMesAnterior = params.saldo1902DicAnterior;
  let saldoAnterior = params.saldo1902DicAnterior;

  for (let i = 0; i < 12; i++) {
    const promedio = i === 0 ? corte : i === 1 ? (corte + oblig[0]) / 2 : (oblig[i - 2] + oblig[i - 1]) / 2;
    const vigente = params.pctVigentePorMes[i] ?? 0;
    const pctAplicado = params.metaPct !== undefined ? Math.min(vigente, params.metaPct) : vigente;
    const aporteActual = promedio * pctAplicado;
    const ajuste = aporteActual - aporteMesAnterior;
    const saldoFinal = saldoAnterior + ajuste;

    resultados.push({
      mes: i + 1,
      promedio_obligaciones_aprox: promedio,
      pct_aplicado: pctAplicado,
      aporte_mensual_actual: aporteActual,
      saldo_inicial: saldoAnterior,
      ajuste,
      saldo_final: saldoFinal,
    });

    aporteMesAnterior = aporteActual;
    saldoAnterior = saldoFinal;
  }
  return resultados;
}

// ---------- 1904 Gastos y pagos anticipados / 1906 Materiales / 1908 Transferencias ----------
// Las 3 comparten el mismo patron de rollforward simple (saldo +/- movimientos ya resueltos en $).

interface ParametrosRollforwardSimple {
  saldoInicialEnero: number;
  entradasPorMes: number[]; // 12 valores, ya resueltos en $ (nuevos pagos / nuevas adquisiciones / incrementos)
  salidasPorMes: number[]; // 12 valores, ya resueltos en $ (amortizacion / disminuciones)
}

interface ResultadoMesGenerico {
  mes: number;
  saldo_inicial: number;
  saldo_final: number;
}

export function calcularRollforwardSimple(params: ParametrosRollforwardSimple): ResultadoMesGenerico[] {
  const resultados: ResultadoMesGenerico[] = [];
  let saldo = params.saldoInicialEnero;
  for (let i = 0; i < 12; i++) {
    const saldoFinal = saldo - params.salidasPorMes[i] + params.entradasPorMes[i];
    resultados.push({ mes: i + 1, saldo_inicial: saldo, saldo_final: saldoFinal });
    saldo = saldoFinal;
  }
  return resultados;
}

// ---------- Agregado: OTROS ACTIVOS total ----------

interface ResultadoMesOtrosActivos {
  mes: number;
  inversiones_1901: number;
  derechos_fiduciarios_1902: number;
  gastos_anticipados_1904: number;
  materiales_1906: number;
  transferencias_internas_1908: number;
  otros_1990: number;
  provision_1999: number; // negativo
  total: number;
  ajuste_fondo_liquidez: number; // alimenta la fila "Aportes al Fondo de Liquidez" del Flujo de Efectivo
}

export function calcularOtrosActivosMatriz(input: {
  saldoInicialInversiones1901: number;
  fondoLiquidez: ParametrosFondoLiquidez;
  gastosAnticipados1904: ParametrosRollforwardSimple;
  materiales1906: ParametrosRollforwardSimple;
  transferenciasInternas1908: ParametrosRollforwardSimple;
  otrosFijo1990: number; // 'Balance General'!$D$108, constante
  provisionFija1999: number; // 'Balance General'!$D$109, constante (negativo)
}): ResultadoMesOtrosActivos[] {
  const inversiones = calcularInversiones(input.saldoInicialInversiones1901);
  const fondoLiquidez = calcularFondoLiquidez(input.fondoLiquidez);
  const gastosAnticipados = calcularRollforwardSimple(input.gastosAnticipados1904);
  const materiales = calcularRollforwardSimple(input.materiales1906);
  const transferenciasInternas = calcularRollforwardSimple(input.transferenciasInternas1908);

  const resultados: ResultadoMesOtrosActivos[] = [];
  // rendimientos del fideicomiso: los del corte + los del año, acumulados
  let rendAcum = input.fondoLiquidez.rendimientos1902 ?? 0;
  for (let i = 0; i < 12; i++) {
    rendAcum += input.fondoLiquidez.rendimientoPorMes?.[i] ?? 0;
    const total =
      inversiones[i] +
      fondoLiquidez[i].saldo_final + rendAcum +
      gastosAnticipados[i].saldo_final +
      materiales[i].saldo_final +
      transferenciasInternas[i].saldo_final +
      input.otrosFijo1990 +
      input.provisionFija1999;

    resultados.push({
      mes: i + 1,
      inversiones_1901: inversiones[i],
      derechos_fiduciarios_1902: fondoLiquidez[i].saldo_final + rendAcum,
      gastos_anticipados_1904: gastosAnticipados[i].saldo_final,
      materiales_1906: materiales[i].saldo_final,
      transferencias_internas_1908: transferenciasInternas[i].saldo_final,
      otros_1990: input.otrosFijo1990,
      provision_1999: input.provisionFija1999,
      total,
      ajuste_fondo_liquidez: fondoLiquidez[i].ajuste,
    });
  }
  return resultados;
}

// ---------- Datos reales de Matriz (para validar el motor) ----------

export const INPUT_OTROS_ACTIVOS_MATRIZ = {
  saldoInicialInversiones1901: 214923.48, // Balance General!D102
  fondoLiquidez: {
    pctVigentePorMes: Array(12).fill(0.059), // Parametros!C44:N44 (editable, confirmar % oficial con contadora)
    saldoObligacionesPublicoDicAnterior: 52196398.94, // Balance General!D111
    saldo1902DicAnterior: 2730051.13, // Balance General!D103
    totalCaptacionesPorMes: [
      52214539.62, 52291178.53, 52367952.14, 52444860.81, 52521904.84, 52599084.58,
      52676400.36, 52753852.50, 52831441.34, 52909167.21, 52987030.45, 53065031.40,
    ], // SALIDA real del motor de Captaciones (calcularCaptaciones().totalMensual)
  },
  gastosAnticipados1904: {
    saldoInicialEnero: 151388.90, // Balance General!D104+D105
    salidasPorMes: Array(12).fill(9825), // Contabilidad!C35:C39 sumado
    entradasPorMes: [17150.12, 12578.80, 13928.72, 4417.92, 16674.58, 14235.52, 10093.72, 10707.32, 6442.80, 6841.64, 1349.92, 1165.84],
  },
  materiales1906: {
    saldoInicialEnero: 46233.37, // Balance General!D106
    salidasPorMes: Array(12).fill(4641.60),
    entradasPorMes: Array(12).fill(3863),
  },
  transferenciasInternas1908: {
    saldoInicialEnero: 9758550.58, // Balance General!D107
    entradasPorMes: Array(12).fill(600000), // Tesoreria!C13:N13
    salidasPorMes: Array(12).fill(0),
  },
  otrosFijo1990: 37097.56, // Balance General!D108 (bug del 4% corregido hoy — ahora es fijo, sin crecimiento)
  provisionFija1999: -8552.49, // Balance General!D109
};
// ---------- Rendimiento del Fondo de liquidez (53040505, no es efectivo) ----------
// El BCE informa cada mes el rendimiento acumulado del fideicomiso; contabilidad lo registra como ingreso (53040505) contra la
// 1902 (rendimientos). En el presupuesto: rendimiento del mes = valor del fondo (1902) × tasa anual ÷ 12, capitalizado.
export const CONCEPTO_RENDIMIENTO_FL = "fondo_liquidez_tasa_rendimiento";
interface RendimientoFondoLiquidez {
  tasa: number;            // anual (fracción) usada
  real: number | null;     // la del año en curso: 530405 acumulado del corte ÷ meses × 12 ÷ saldo 1902
  guardada: boolean;       // escrita para la agencia
  acumuladoCorte?: number | null; // 530405 acumulado del año al corte (lo que reporta el BCE)
  base1902?: number;       // saldo 1902 con el que se calcula la tasa real
  porMes: number[];        // rendimiento de cada mes del ejercicio
}
const ADJ_RFL = new WeakMap<object, RendimientoFondoLiquidez>();
export function adjuntarRendimientoFL(saldos: object, r: RendimientoFondoLiquidez) { ADJ_RFL.set(saldos, r); }
export function rendimientoFLDe(saldos: object): RendimientoFondoLiquidez | null { return ADJ_RFL.get(saldos) ?? null; }
/** Rendimiento mensual capitalizado sobre el valor del fondo al corte. */
export function proyectarRendimientoFL(valorCorte: number, tasa: number): number[] {
  let v = valorCorte;
  return Array.from({ length: 12 }, () => { const r = v * tasa / 12; v += r; return r; });
}
