/**
 * Motor de cálculo puro - PROVISIÓN DE CARTERA (cuenta 1499 / gasto 44)
 *
 * % de provisión de una línea = provisión ÷ cartera bruta (por vencer + en
 * riesgo), igual que en el Excel de proyección financiera.
 *
 *  - % inicial: el real del balance cargado (el corte más reciente).
 *  - % de cada mes del ejercicio: lo define el usuario en Cartera →
 *    Parámetros → Provisión (12 valores por línea, que puede generar con una
 *    variación en el año, pareja o según el histórico, y ajustar a mano).
 *  - Sin reversiones: la provisión requerida nunca baja de la del mes
 *    anterior, así el gasto del mes (44) nunca es negativo.
 *
 * Provisión requerida del mes = cartera bruta del mes × % del mes
 * Gasto del mes (44)          = requerida − provisión del mes anterior
 */

export type Linea = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";

export interface ParametroProvisionLinea {
  pctPorMes: number[];      // 12 valores 0..1: % de provisión de cada mes del ejercicio (Cartera → Parámetros → Provisión)
  sinReversiones: boolean;
}

export interface ResultadoProvisionLinea {
  pctInicial: number;            // % real del balance cargado
  sinReversiones: boolean;
  saldoInicial: number;          // provisión al corte (positivo)
  pctObjetivoPorMes: number[];   // % definido para cada mes
  pctAplicadoPorMes: number[];   // % efectivo (con el tope de "sin reversiones")
  requeridaPorMes: number[];     // provisión al cierre de cada mes (positivo)
  gastoPorMes: number[];         // gasto 44 de cada mes (positivo = gasto)
}

/**
 * Provisión requerida del mes = cartera bruta del mes × % del mes.
 * Gasto del mes (44) = requerida − provisión del mes anterior.
 * Sin reversiones: la requerida nunca baja de la del mes anterior.
 * Sin parámetro guardado: se mantiene el % real del corte los 12 meses.
 */
export function calcularProvisionLinea(params: {
  saldoInicial: number;          // provisión al corte (positivo)
  carteraInicial: number;        // cartera bruta al corte
  carteraPorMes: number[];       // cartera bruta al cierre de cada mes
  parametro: ParametroProvisionLinea | null;
  pctRespaldo: number;           // si no hay cartera al corte
}): ResultadoProvisionLinea {
  const { saldoInicial, carteraInicial, carteraPorMes } = params;
  const pctInicial = carteraInicial > 0 ? saldoInicial / carteraInicial : params.pctRespaldo;
  const pctPorMes = params.parametro?.pctPorMes?.length === 12 ? params.parametro.pctPorMes : Array(12).fill(pctInicial);
  const sinReversiones = params.parametro ? params.parametro.sinReversiones : true;

  const pctAplicadoPorMes: number[] = [];
  const requeridaPorMes: number[] = [];
  const gastoPorMes: number[] = [];
  let anterior = saldoInicial;
  for (let i = 0; i < 12; i++) {
    const cartera = carteraPorMes[i] ?? 0;
    let requerida = cartera * pctPorMes[i];
    if (sinReversiones && requerida < anterior) requerida = anterior;
    pctAplicadoPorMes.push(cartera > 0 ? requerida / cartera : pctPorMes[i]);
    requeridaPorMes.push(requerida);
    gastoPorMes.push(requerida - anterior);
    anterior = requerida;
  }
  return { pctInicial, sinReversiones, saldoInicial, pctObjetivoPorMes: [...pctPorMes], pctAplicadoPorMes, requeridaPorMes, gastoPorMes };
}

/**
 * Trayectoria de 12 meses a partir del % actual y una variación en el año
 * (en puntos). "parejo": el mismo cambio cada mes. "historico": el cambio de
 * cada mes pesa según cuánto se movió el % en ese mes en el histórico
 * (pesos = |variación mensual| por mes calendario; los meses sin dato usan el
 * promedio). En los dos casos diciembre llega a % actual + variación.
 */
export function generarTrayectoria(pctActual: number, variacionPts: number, distribucion: "parejo" | "historico", pesosHistoricos: number[] | null): number[] {
  const pesos = distribucion === "historico" && pesosHistoricos && pesosHistoricos.some((p) => p > 0) ? pesosHistoricos : Array(12).fill(1);
  const total = pesos.reduce((a, b) => a + b, 0);
  let acum = 0;
  return pesos.map((p) => {
    acum += p;
    return Math.max(0, pctActual + (variacionPts / 100) * (acum / total));
  });
}

/**
 * Los parámetros de provisión viajan pegados al objeto de saldos (el mismo
 * que ya reciben todos los cálculos), así llegan al orquestador sin cambiar
 * la firma de ninguna función ni ningún route.ts. WeakMap: nada global.
 */
const parametrosPorSaldos = new WeakMap<object, Partial<Record<Linea, ParametroProvisionLinea>>>();

export function adjuntarParametrosProvision(saldos: object, p: Partial<Record<Linea, ParametroProvisionLinea>>): void {
  parametrosPorSaldos.set(saldos, p);
}

export function parametrosProvisionDe(saldos: object): Partial<Record<Linea, ParametroProvisionLinea>> {
  return parametrosPorSaldos.get(saldos) ?? {};
}