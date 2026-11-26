/**
 * ANÁLISIS DE AGENCIA (Planificación): el real de la agencia junto al presupuesto 2027, con las mismas cifras de base.
 *
 *  - Real: estado de resultados acumulado del último mes cargado en Históricos, llevado a 12 meses (× 12 ÷ mes);
 *    saldos promedio de diciembre anterior al mes (como el Diagnóstico).
 *  - Presupuesto: estado de resultados acumulado a diciembre 2027 y saldos promedio de enero a diciembre 2027.
 * Todo es puro: la pantalla arma las cifras con estas funciones y muestra la fórmula de cada valor.
 */
import type { Base } from "./indicadores-presupuesto";

/** Cuentas del estado de resultados que lee el análisis (Históricos guarda hasta 6 dígitos + interés interno). */
export const CODIGOS_ER_ANALISIS = [
  "41", "41059005", "42", "43", "44", "4501", "4502", "4503", "4504", "4505", "4506", "4507", "47", "48",
  "51", "5104", "51909005", "52", "53", "54", "55", "56",
];

/** Lo que devuelve /api/analisis-agencia por oficina. */
export interface RealOficina {
  periodo: string; k: number; saldosPromediados: number;
  er: Record<string, number>;
  prom: { porVencer: number; enRiesgo: number; captaciones: number; dpf: number; envia: number; recibe: number };
}

/** Cifras anuales (resultados) y saldos promedio de una agencia, en real o en presupuesto. */
export interface Cifras {
  // ingresos
  ig: number; i5104: number; cs: number; oi: number; icInt: number;
  // gastos
  ip: number; ipInt: number; pv: number; g1: number; g2: number; g3: number; g4: number; g5: number; g6: number; g7: number; og: number;
  // saldos promedio
  porVencer: number; enRiesgo: number; cap: number; dpf: number; envia: number; recibe: number;
}
type ClaveCifra = keyof Cifras;

const n = (r: Record<string, number>, c: string) => r[c] ?? 0;

export function cifrasReal(o: RealOficina): Cifras {
  const f = 12 / o.k, e = o.er;
  return {
    ig: n(e, "51") * f, i5104: n(e, "5104") * f, cs: (n(e, "52") + n(e, "53") + n(e, "54")) * f, oi: (n(e, "55") + n(e, "56")) * f,
    icInt: n(e, "51909005") * f,
    ip: n(e, "41") * f, ipInt: n(e, "41059005") * f, pv: n(e, "44") * f,
    g1: n(e, "4501") * f, g2: n(e, "4502") * f, g3: n(e, "4503") * f, g4: n(e, "4504") * f, g5: n(e, "4505") * f, g6: n(e, "4506") * f, g7: n(e, "4507") * f,
    og: (n(e, "42") + n(e, "43") + n(e, "47") + n(e, "48")) * f,
    porVencer: o.prom.porVencer, enRiesgo: o.prom.enRiesgo, cap: o.prom.captaciones, dpf: o.prom.dpf, envia: o.prom.envia, recibe: o.prom.recibe,
  };
}

const prom12 = (v: number[]) => v.reduce((s, x) => s + (x || 0), 0) / 12;
export function cifrasPresupuesto(b: Base): Cifras {
  const d = 11;
  return {
    ig: b.i51[d], i5104: b.i5104[d], cs: b.i52[d] + b.i53[d] + b.i54[d], oi: b.i55[d] + b.i56[d], icInt: b.i5190[d],
    ip: b.e41[d], ipInt: b.e41059005[d], pv: b.e44[d],
    g1: b.e4501[d], g2: b.e4502[d], g3: b.e4503[d], g4: b.e4504[d], g5: b.e4505[d], g6: b.e4506[d], g7: b.e4507[d],
    og: b.e42[d] + b.e43[d] + b.e47[d] + b.e48[d],
    porVencer: prom12(b.porVencer), enRiesgo: prom12(b.enRiesgo), cap: prom12(b.p21), dpf: prom12(b.dpf ?? []), envia: prom12(b.a1908), recibe: prom12(b.p2908 ?? []),
  };
}

export function sumarCifras(xs: Cifras[]): Cifras {
  const out = {} as Cifras;
  for (const x of xs) for (const k of Object.keys(x) as ClaveCifra[]) out[k] = (out[k] ?? 0) + x[k];
  return out;
}

// ---------- agregados ----------
export const GASTOS: { k: ClaveCifra; n: string; cuenta: string }[] = [
  { k: "ip", n: "Intereses pagados", cuenta: "41" }, { k: "pv", n: "Provisiones", cuenta: "44" },
  { k: "g1", n: "Gastos de personal", cuenta: "4501" }, { k: "g3", n: "Servicios varios", cuenta: "4503" },
  { k: "g4", n: "Impuestos y aportes", cuenta: "4504" }, { k: "g5", n: "Depreciaciones", cuenta: "4505" },
  { k: "g2", n: "Honorarios", cuenta: "4502" }, { k: "g6", n: "Amortizaciones", cuenta: "4506" },
  { k: "g7", n: "Otros gastos de operación", cuenta: "4507" }, { k: "og", n: "Otros gastos y pérdidas", cuenta: "42 + 43 + 47 + 48" },
];
export const INGRESOS: { k: ClaveCifra; n: string; cuenta: string }[] = [
  { k: "ig", n: "Intereses ganados", cuenta: "51" }, { k: "cs", n: "Comisiones y servicios", cuenta: "52 + 53 + 54" }, { k: "oi", n: "Otros ingresos", cuenta: "55 + 56" },
];
const OPERACION: ClaveCifra[] = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"];

export const ingresos = (c: Cifras) => c.ig + c.cs + c.oi;
export const gastos = (c: Cifras) => GASTOS.reduce((s, g) => s + c[g.k], 0);
export const gastosOperacion = (c: Cifras) => OPERACION.reduce((s, k) => s + c[k], 0);
export const utilidad = (c: Cifras) => ingresos(c) - gastos(c);
export const carteraBruta = (c: Cifras) => c.porVencer + c.enRiesgo;
export const consumo = (c: Cifras) => div(gastos(c), ingresos(c));
export const interesSocios = (c: Cifras) => c.ip - c.ipInt;
export const costoCaptaciones = (c: Cifras) => div(interesSocios(c), c.cap);
export const fondosSinColocar = (c: Cifras) => c.cap + c.recibe - c.envia - carteraBruta(c);
export const costoSinColocar = (c: Cifras) => Math.max(0, fondosSinColocar(c)) * (costoCaptaciones(c) ?? 0);
export function div(a: number, b: number): number | null { return Math.abs(b) > 1e-9 ? a / b : null; }

/** El gasto que más pesa (sin "otros gastos y pérdidas"). */
export function gastoPrincipal(c: Cifras) {
  return GASTOS.filter((g) => g.k !== "og").map((g) => ({ ...g, v: c[g.k] })).sort((a, b) => b.v - a.v)[0];
}
