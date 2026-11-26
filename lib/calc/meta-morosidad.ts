/**
 * META DE MOROSIDAD CONSOLIDADA (cartera en riesgo ÷ cartera bruta a diciembre del ejercicio).
 *
 * «Todas mejoran» (resolverTodasMejoran):
 *  1. Esfuerzo parejo: todas las agencias recorren la misma parte f del camino entre su presupuesto (f = 1) y su mejor mes
 *     real (f = 0), en pase a riesgo y en recuperación de vencida. f se busca para que la cooperativa llegue a la meta.
 *  2. Ninguna agencia se queda sin mejorar: cada una termina, como máximo, con su morosidad de hoy bajada en la misma
 *     proporción que la cooperativa (meta ÷ morosidad consolidada de hoy). La que con el esfuerzo parejo no llega hace más
 *     esfuerzo (su propio f); si ni con su mejor mes llega, sube su meta de recuperación de vencida sobre su mejor mes
 *     (hasta un máximo) y se marca. Las demás vuelven a calcular f con esas agencias ya fijas.
 * Todo con el motor del presupuesto de cada agencia (`correr`), sin repartos.
 */

export interface FinAgencia { mora: number; riesgo: number; bruta: number; util: number }
export interface AgenciaMora {
  agencia: string;
  /** Morosidad al corte (hoy) y cartera bruta al corte. */
  hoy: number | null; brutaHoy?: number;
  /** Presupuesto actual a diciembre: cartera en riesgo, cartera bruta y utilidad. */
  riesgo: number; bruta: number; util: number;
  /** Presupuesto con el esfuerzo f (1 = presupuesto, 0 = su mejor mes real). */
  correr: (f: number) => FinAgencia;
  /** Su mejor mes real (f = 0) con la recuperación de vencida s puntos sobre su mejor mes. */
  correrExtra?: (s: number) => FinAgencia;
  /** Máximo de puntos de recuperación sobre su mejor mes. */
  extraMax?: number;
}
export interface ResultadoAgenciaMora {
  agencia: string; hoy: number | null; antes: number; factor: number; extra: number;
  /** Morosidad máxima pedida a la agencia (null: sin morosidad de hoy). */
  objetivo: number | null; noAlcanza: boolean;
  mora: number; riesgo: number; bruta: number; util: number; utilAntes: number; menosRiesgo: number;
}
export interface ResultadoMeta {
  mora: number; riesgo: number; bruta: number; util: number; agencias: ResultadoAgenciaMora[];
  /** f común de las agencias que no necesitan más esfuerzo. */
  factor: number; alcanzable: boolean;
  /** Mejora mínima de cada agencia (proporción de su morosidad de hoy). */
  mejoraMinima: number;
}

const morosidad = (xs: { riesgo: number; bruta: number }[]) => {
  const b = xs.reduce((t, x) => t + x.bruta, 0);
  return b > 0 ? xs.reduce((t, x) => t + x.riesgo, 0) / b : 0;
};
const delPresupuesto = (a: AgenciaMora): FinAgencia => ({ mora: a.bruta > 0 ? a.riesgo / a.bruta : 0, riesgo: a.riesgo, bruta: a.bruta, util: a.util });
const correrF = (a: AgenciaMora, f: number) => (f >= 0.99999 ? delPresupuesto(a) : a.correr(f));

type Fija = { factor: number; extra: number; r: FinAgencia; noAlcanza: boolean };

/** El menor esfuerzo con el que la agencia termina en `obj` o menos: su propio f (≤ fMax) y, si no basta, recuperación extra. */
export function contenerAgencia(a: AgenciaMora, obj: number, fMax = 1, iter = 14): Fija {
  const enF = correrF(a, fMax);
  if (enF.mora <= obj + 1e-6) return { factor: fMax, extra: 0, r: enF, noAlcanza: false };
  const cero = a.correr(0);
  if (cero.mora <= obj + 1e-6) {
    let lo = 0, hi = fMax, r = cero;
    for (let i = 0; i < iter; i++) { const m = (lo + hi) / 2, x = a.correr(m); if (x.mora > obj) hi = m; else { lo = m; r = x; } }
    return { factor: lo, extra: 0, r, noAlcanza: false };
  }
  if (!a.correrExtra || !a.extraMax || a.extraMax <= 0) return { factor: 0, extra: 0, r: cero, noAlcanza: true };
  const tope = a.correrExtra(a.extraMax);
  if (tope.mora > obj + 1e-6) return { factor: 0, extra: a.extraMax, r: tope, noAlcanza: true };
  let lo = 0, hi = a.extraMax, r = tope;
  for (let i = 0; i < iter; i++) { const m = (lo + hi) / 2, x = a.correrExtra(m); if (x.mora > obj) lo = m; else { hi = m; r = x; } }
  return { factor: 0, extra: hi, r, noAlcanza: false };
}

export function resolverTodasMejoran(ags: AgenciaMora[], meta: number, iter = 14): ResultadoMeta {
  const hoyCoop = (() => {
    const con = ags.filter((a) => a.hoy !== null && a.hoy > 0);
    // morosidad consolidada de hoy: cartera en riesgo ÷ cartera bruta al corte (sin la bruta de hoy, la del presupuesto)
    const b = con.reduce((t, a) => t + (a.brutaHoy ?? a.bruta), 0);
    return b > 0 ? con.reduce((t, a) => t + a.hoy! * (a.brutaHoy ?? a.bruta), 0) / b : null;
  })();
  const mejoraMinima = hoyCoop && hoyCoop > meta ? 1 - meta / hoyCoop : 0;
  const objetivo = (a: AgenciaMora) => (a.hoy === null ? null : a.hoy * (1 - mejoraMinima));
  const fijas = new Map<string, Fija>();

  const en = (f: number) => ags.map((a) => fijas.get(a.agencia)?.r ?? correrF(a, f));
  const resolverF = () => {
    if (morosidad(en(1)) <= meta + 1e-9) return { f: 1, ok: true };
    if (morosidad(en(0)) > meta) return { f: 0, ok: false };
    let lo = 0, hi = 1;
    for (let i = 0; i < iter; i++) { const m = (lo + hi) / 2; if (morosidad(en(m)) > meta) hi = m; else lo = m; }
    return { f: lo, ok: true };
  };

  let { f, ok } = resolverF();
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const nuevas = ags.filter((a) => {
      if (fijas.has(a.agencia)) return false;
      const o = objetivo(a);
      return o !== null && correrF(a, f).mora > o + 1e-6;
    });
    if (!nuevas.length) break;
    for (const a of nuevas) fijas.set(a.agencia, contenerAgencia(a, objetivo(a)!, f, iter));
    ({ f, ok } = resolverF());
  }

  const agencias: ResultadoAgenciaMora[] = ags.map((a) => {
    const fx = fijas.get(a.agencia), r = fx?.r ?? correrF(a, f), antes = a.bruta > 0 ? a.riesgo / a.bruta : 0;
    return {
      agencia: a.agencia, hoy: a.hoy, antes, factor: fx?.factor ?? f, extra: fx?.extra ?? 0, objetivo: objetivo(a), noAlcanza: fx?.noAlcanza ?? false,
      mora: r.mora, riesgo: r.riesgo, bruta: r.bruta, util: r.util, utilAntes: a.util, menosRiesgo: a.riesgo - r.riesgo,
    };
  });
  return {
    mora: morosidad(agencias), riesgo: agencias.reduce((t, x) => t + x.riesgo, 0), bruta: agencias.reduce((t, x) => t + x.bruta, 0),
    util: agencias.reduce((t, x) => t + x.util, 0), agencias, factor: f, alcanzable: ok, mejoraMinima,
  };
}
