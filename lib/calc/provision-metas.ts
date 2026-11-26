/**
 * Reglas de las metas de provisión y de cartera (funciones puras: las usan las pantallas y las pruebas automáticas).
 */

/** Meta propuesta de provisión ÷ interés: la mitad de la distancia al promedio, sin bajar la provisión más de 20 %. */
export function metaPropuesta(hoy: number, coop: number): number {
  if (!(hoy > coop + 0.005)) return hoy;
  return Math.max(hoy - (hoy - coop) / 2, hoy * 0.8);
}

/** Resultado del ejercicio: el estado de resultados viene acumulado en el año, el del año es el de diciembre. */
export function resultadoDelAnio(valores: number[] | undefined): number {
  return valores?.length ? valores[valores.length - 1] : 0;
}

export type FuenteIdoneo = "real" | "mejor" | "equilibrio" | "tope";

/**
 * Idóneo de un parámetro de cartera.
 *  - El más exigente entre su real, su mejor nivel y el punto de equilibrio.
 *  - Si la agencia tiene pérdida y el equilibrio no se alcanza (ni con 0 % o más allá de su mejor mes), se le pide su
 *    mejor mes: lo máximo que ya demostró.
 *  - Nunca más exigente que su mejor mes, y nunca peor que su real.
 * altoEsMejor: true en las recuperaciones (más alto es mejor), false en el pase a riesgo (más bajo es mejor).
 */
export function elegirIdoneo(o: {
  real: number | null; mejor: number | null; tope: number | null; eq: number | null; altoEsMejor: boolean; conPerdidaSinAlcance: boolean;
}): { valor: number | null; fuente: FuenteIdoneo | null; noAlcanza: boolean } {
  const mejorQue = (a: number, b: number) => (o.altoEsMejor ? a > b : a < b);
  const cands: [number, FuenteIdoneo][] = [];
  if (o.real !== null) cands.push([o.real, "real"]);
  if (o.mejor !== null) cands.push([o.mejor, "mejor"]);
  if (o.eq !== null) cands.push([o.eq, "equilibrio"]);
  if (!cands.length) return { valor: null, fuente: null, noAlcanza: false };
  let [valor, fuente] = cands.reduce((a, x) => (mejorQue(x[0], a[0]) ? x : a));
  let noAlcanza = o.conPerdidaSinAlcance;
  if (noAlcanza && o.tope !== null) { valor = o.tope; fuente = "tope"; }
  if (o.tope !== null && mejorQue(valor, o.tope)) {
    valor = o.tope; fuente = "tope";
    if (o.eq !== null && mejorQue(o.eq, o.tope)) noAlcanza = true;
  }
  if (o.real !== null && mejorQue(o.real, valor)) { valor = o.real; fuente = "real"; }
  return { valor, fuente, noAlcanza };
}

/**
 * ¿Hace falta meta de ritmo de atraso? Solo si las metas de cartera no bajan la provisión hasta el objetivo
 * (así la misma mejora no se cuenta dos veces). Devuelve el gasto que falta bajar con la meta de ritmo (0 = ya alcanza).
 */
export function faltaParaMeta(conCartera: number, objetivo: number): number {
  return Math.max(0, conCartera - objetivo);
}
