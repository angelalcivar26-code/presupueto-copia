import type { ResultadoMensual } from "./tipos";

/**
 * Replica exacta de las formulas de Agencia_Modelo, filas 247-306
 * (AHORROS A LA VISTA, AHORRO CRECER PROGRAMADO, DPF).
 *
 * Parametros mensuales — mismo shape para Vista/Crecer, un array de 12
 * posiciones (mes 1..12) por cada supuesto. Si un supuesto no varia en el
 * año, repetir el mismo valor 12 veces (asi vino en el Excel actual para
 * la mayoria de los casos).
 */
interface ParametrosCuentaAhorro {
  tasaInteresAnual: number[]; // 12 valores
  pctIngresosPeriodo: number[];
  pctRetirosPeriodo: number[];
}

/**
 * Ahorro a la Vista y Ahorro Crecer comparten exactamente la misma formula
 * (filas 257-262 y 277-282 del Excel son identicas salvo la cuenta de
 * saldo inicial) — una sola funcion para las dos, en vez de duplicar codigo.
 */
function calcularCuentaAhorro(
  saldoInicialEnero: number,
  params: ParametrosCuentaAhorro
): ResultadoMensual[] {
  const resultados: ResultadoMensual[] = [];
  let saldoInicial = saldoInicialEnero;

  for (let mes = 1; mes <= 12; mes++) {
    const i = mes - 1;
    const depositos = saldoInicial * params.pctIngresosPeriodo[i];
    const retiros = -saldoInicial * params.pctRetirosPeriodo[i];
    const subtotal = saldoInicial + depositos + retiros;
    const capitalizacionInteres = subtotal * (params.tasaInteresAnual[i] / 12);
    const saldoFinal = subtotal + capitalizacionInteres;

    resultados.push({
      mes,
      saldoInicial,
      saldoFinal,
      detalle: { depositos, retiros, subtotal, capitalizacionInteres },
    });

    saldoInicial = saldoFinal; // el saldo final de un mes es el inicial del siguiente (Excel: '=C262')
  }

  return resultados;
}

interface ParametrosDPF {
  pctCancelaciones: number[]; // 12 valores
  ratioRenovaciones: number[]; // 12 valores
}

/**
 * Deposito a Plazo Fijo (filas 297-301). A diferencia de Vista/Crecer, no
 * capitaliza interes dentro del saldo (la tasa solo se usa para el gasto
 * de intereses causados, en otro modulo) y su movimiento es
 * Cancelaciones/Renovaciones, no Depositos/Retiros.
 */
function calcularDPF(
  saldoInicialEnero: number,
  params: ParametrosDPF
): ResultadoMensual[] {
  const resultados: ResultadoMensual[] = [];
  let saldoInicial = saldoInicialEnero;

  for (let mes = 1; mes <= 12; mes++) {
    const i = mes - 1;
    const cancelaciones = -saldoInicial * params.pctCancelaciones[i];
    const renovaciones = -cancelaciones * params.ratioRenovaciones[i];
    const saldoFinal = saldoInicial + cancelaciones + renovaciones;

    resultados.push({
      mes,
      saldoInicial,
      saldoFinal,
      detalle: { cancelaciones, renovaciones },
    });

    saldoInicial = saldoFinal;
  }

  return resultados;
}

interface ResultadoCaptaciones {
  vista: ResultadoMensual[];
  crecer: ResultadoMensual[];
  dpf: ResultadoMensual[];
  totalMensual: number[]; // suma de las 3 lineas, mes a mes (Excel fila 308)
}

export function calcularCaptaciones(input: {
  saldoInicialVista: number;
  paramsVista: ParametrosCuentaAhorro;
  saldoInicialCrecer: number;
  paramsCrecer: ParametrosCuentaAhorro;
  saldoInicialDPF: number;
  paramsDPF: ParametrosDPF;
}): ResultadoCaptaciones {
  const vista = calcularCuentaAhorro(input.saldoInicialVista, input.paramsVista);
  const crecer = calcularCuentaAhorro(input.saldoInicialCrecer, input.paramsCrecer);
  const dpf = calcularDPF(input.saldoInicialDPF, input.paramsDPF);

  const totalMensual = vista.map(
    (_, i) => vista[i].saldoFinal + crecer[i].saldoFinal + dpf[i].saldoFinal
  );

  return { vista, crecer, dpf, totalMensual };
}
