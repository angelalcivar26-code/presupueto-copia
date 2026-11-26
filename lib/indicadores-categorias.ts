/**
 * Indicadores del presupuesto agrupados por tipo, como en la herramienta de indicadores. Los comparten la pantalla
 * de Indicadores y su exportación a Excel. Las fórmulas están en lib/calc/indicadores-presupuesto.ts.
 */
import { LINEAS, type Base, type Indicadores } from "./calc/indicadores-presupuesto";

export const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const CONSOLIDADO = "Consolidado";

/** Los 12 meses de indicadores de una agencia y su base. */
export interface Serie { base: Base; ind: Indicadores[] }

export interface Ind {
  id: string; label: string; formula: string; formato: "pct" | "usd";
  valor: (x: Indicadores, b: Base, m: number, cons?: Indicadores) => number | null;
  /** solo tiene sentido frente a las demás agencias (p. ej. el aporte a la utilidad) */
  soloComparar?: boolean;
  /** un valor menor es favorable (morosidad, gastos…) */
  menor?: boolean;
  /** solo tiene valor real (el presupuesto no proyecta las cuentas que necesita) */
  soloReal?: boolean;
}
export interface Categoria { id: "rentabilidad" | "calidad" | "eficiencia" | "liquidez" | "crecimiento" | "solvencia"; label: string; indicadores: Ind[] }

const A = "anualizado";
export const CATEGORIAS: Categoria[] = [
  { id: "rentabilidad", label: "Rentabilidad", indicadores: [
    { id: "roa", label: "ROA", formula: `Utilidad ${A} ÷ activo real promedio (1 − 1908)`, formato: "pct", valor: (x) => x.roa },
    { id: "roe", label: "ROE", formula: `Utilidad ${A} ÷ patrimonio promedio`, formato: "pct", valor: (x) => x.roe },
    { id: "utilidad", label: "Utilidad del ejercicio", formula: "Ingresos (5) − gastos (4), acumulado", formato: "usd", valor: (x) => x.utilidad },
    { id: "margen", label: "Margen de utilidad neta", formula: "Utilidad ÷ ingresos (5)", formato: "pct", valor: (x) => x.margenUtilidad },
    { id: "mni", label: "Margen neto de intereses", formula: "(51 − 41) ÷ 51", formato: "pct", valor: (x) => x.mni },
    { id: "mfb", label: "Margen financiero bruto", formula: "(51 − 41 + 52 + 54 − 42 + 53 − 43) ÷ (51 + 52 + 53 + 54)", formato: "pct", valor: (x) => x.mfb },
    { id: "mfn", label: "Margen financiero neto", formula: "(51 + 52 − 41 − 42 − 44) ÷ (51 + 52)", formato: "pct", valor: (x) => x.mfn },
    { id: "mop", label: "Margen operacional", formula: "(51 + 52 − 41 − 42 − 44 − 45 − 47) ÷ (51 + 52)", formato: "pct", valor: (x) => x.mop },
    { id: "rend", label: "Rendimiento de cartera", formula: `Intereses de cartera (5104) ${A} ÷ cartera (14)`, formato: "pct", valor: (x) => x.rendimiento },
    { id: "spread", label: "Spread", formula: `Rendimiento de cartera − intereses causados (41) ${A} ÷ captaciones (21)`, formato: "pct", valor: (x) => x.spread },
    { id: "sinInternos", label: "Utilidad sin intereses internos", formula: "Utilidad + interés pagado a otras oficinas (41059005) − interés cobrado (5190)", formato: "usd", valor: (x) => x.utilidadSinInternos },
    { id: "aporte", label: "Aporte a la utilidad", formula: "Utilidad de la agencia ÷ utilidad del Consolidado", formato: "pct", soloComparar: true,
      valor: (x, _b, _m, cons) => (cons && Math.abs(cons.utilidad) > 0.5 ? x.utilidad / cons.utilidad : null) },
  ] },
  { id: "calidad", label: "Calidad de activos", indicadores: [
    { id: "morosidad", menor: true, label: "Morosidad", formula: "(Cartera que no devenga + vencida) ÷ cartera bruta", formato: "pct", valor: (x) => x.morosidad },
    { id: "cobertura", label: "Cobertura", formula: "Provisión de cartera (1499) ÷ cartera improductiva", formato: "pct", valor: (x) => x.cobertura },
    { id: "prod", label: "Activos productivos", formula: "(1103 + 12 + 13 + cartera por vencer + 1901 + 1902 productiva) ÷ activo real", formato: "pct", valor: (x) => x.activosProductivos },
    { id: "improd", menor: true, label: "Activos improductivos", formula: "(11 − 1103 + cartera improductiva + 1499 + 16 + 17 + 18 + 19 − menor entre 1908 y 2908 − 1901 − 1902 productiva) ÷ activo real", formato: "pct", valor: (x) => x.activosImproductivos },
    ...LINEAS.map(({ k, n }): Ind => ({ id: `mor-${k}`, menor: true, label: `Morosidad ${n.toLowerCase()}`, formula: `(No devenga + vencida) ÷ cartera bruta de ${n.toLowerCase()}`, formato: "pct", valor: (x) => x.morosidadLinea[k] })),
    { id: "costoRiesgo", menor: true, label: "Costo de riesgo", formula: `Provisiones (44) ${A} ÷ cartera bruta promedio`, formato: "pct", valor: (x) => x.costoRiesgo },
    { id: "cartera", label: "Cartera bruta", formula: "Cartera por vencer + que no devenga + vencida", formato: "usd", valor: (x) => x.cartera },
    { id: "riesgo", menor: true, label: "Cartera improductiva", formula: "Cartera que no devenga + vencida", formato: "usd", valor: (x) => x.carteraRiesgo },
    { id: "provision", menor: true, label: "Provisiones del año", formula: "Gasto de provisiones (44), acumulado", formato: "usd", valor: (x) => x.provisionAnio },
  ] },
  { id: "eficiencia", label: "Eficiencia", indicadores: [
    { id: "absorcion", menor: true, label: "Grado de absorción", formula: "Gastos de operación (45) ÷ margen financiero neto", formato: "pct", valor: (x) => x.absorcion },
    { id: "goActivo", menor: true, label: "Gastos operativos ÷ activo", formula: `Gastos de operación (45) ${A} ÷ activo real promedio`, formato: "pct", valor: (x) => x.goActivo },
    { id: "gpActivo", menor: true, label: "Gastos de personal ÷ activo", formula: `Gastos de personal (4501) ${A} ÷ activo real promedio`, formato: "pct", valor: (x) => x.gpActivo },
    { id: "gpCartera", menor: true, label: "Gastos de personal ÷ cartera", formula: `Gastos de personal (4501) ${A} ÷ cartera (14) promedio`, formato: "pct", valor: (x) => x.gpCartera },
    { id: "goCartera", menor: true, label: "Gastos operativos ÷ cartera", formula: `Gastos de operación (45) ${A} ÷ cartera (14) promedio`, formato: "pct", valor: (x) => x.goCartera },
    { id: "goIngresos", menor: true, label: "Gastos operativos ÷ ingresos", formula: "Gastos de operación (45) ÷ ingresos (5)", formato: "pct", valor: (x) => x.goIngresos },
    { id: "gpIngresos", menor: true, label: "Gastos de personal ÷ ingresos", formula: "Gastos de personal (4501) ÷ ingresos (5)", formato: "pct", valor: (x) => x.gpIngresos },
    { id: "go", menor: true, label: "Gastos de operación", formula: "Cuenta 45, acumulado", formato: "usd", valor: (x) => x.gastosOperacion },
  ] },
  { id: "liquidez", label: "Liquidez", indicadores: [
    { id: "fondosActivo", label: "Fondos disponibles ÷ activo", formula: "Fondos disponibles (11) ÷ activo real", formato: "pct", valor: (x) => x.fondosActivo },
    { id: "fondosDep", label: "Fondos disponibles ÷ depósitos", formula: "Fondos disponibles (11) ÷ (depósitos a la vista 2101 + a plazo 2103)", formato: "pct", valor: (x) => x.fondosDepositos },
    { id: "fondeo", label: "Captaciones ÷ cartera", formula: "Obligaciones con el público (21) ÷ cartera (14)", formato: "pct", valor: (x) => x.fondeo },
    { id: "fondos", label: "Fondos disponibles", formula: "Cuenta 11", formato: "usd", valor: (_x, b, m) => b.a11[m] },
    { id: "captaciones", label: "Captaciones", formula: "Obligaciones con el público (21)", formato: "usd", valor: (x) => x.captaciones },
  ] },
  { id: "crecimiento", label: "Crecimiento", indicadores: [
    { id: "crecCartera", label: "Crecimiento de cartera", formula: "Cartera bruta del mes ÷ cartera de enero − 1", formato: "pct", valor: (x) => x.crecCartera },
    { id: "crecCapt", label: "Crecimiento de captaciones", formula: "Captaciones del mes ÷ captaciones de enero − 1", formato: "pct", valor: (x) => x.crecCaptaciones },
    { id: "crecActivo", label: "Crecimiento del activo", formula: "Activo del mes ÷ activo de enero − 1", formato: "pct", valor: (x) => x.crecActivo },
    { id: "crecPat", label: "Crecimiento del patrimonio", formula: "Patrimonio del mes ÷ patrimonio de enero − 1", formato: "pct", valor: (x) => x.crecPatrimonio },
    { id: "activo", label: "Activo", formula: "Activo total (1)", formato: "usd", valor: (x) => x.activo },
    { id: "carteraB", label: "Cartera bruta", formula: "Cartera por vencer + que no devenga + vencida", formato: "usd", valor: (x) => x.cartera },
    { id: "captacionesC", label: "Captaciones", formula: "Obligaciones con el público (21)", formato: "usd", valor: (x) => x.captaciones },
    { id: "patrimonio", label: "Patrimonio", formula: "Patrimonio (3)", formato: "usd", valor: (x) => x.patrimonio },
  ] },
  // necesitan las cuentas contingentes y de orden (Carga de datos → Históricos)
  { id: "solvencia", label: "Solvencia", indicadores: [
    { id: "solvencia", label: "Solvencia", formula: "Patrimonio técnico constituido (primario + secundario) ÷ activos y contingentes ponderados por riesgo. Usa las cuentas contingentes y de orden; en el presupuesto, con su saldo del corte", formato: "pct", valor: (x) => x.solvencia },
    { id: "ptc", label: "Patrimonio técnico constituido", formula: "Primario + secundario", formato: "usd", valor: (x) => x.patrimonioTecnico },
    { id: "apr", label: "Activos y contingentes ponderados", formula: "Saldos ponderados al 0 %, 20 %, 50 % y 100 %", formato: "usd", valor: (x) => x.ponderados },
    ...LINEAS.map(({ k, n }): Ind => ({ id: `cob-${k}`, soloReal: true, label: `Cobertura ${n.toLowerCase()}`, formula: `Provisión de ${n.toLowerCase()} (1499 de la línea + cuentas de orden 7414) ÷ cartera improductiva de ${n.toLowerCase()}`, formato: "pct", valor: (x) => x.coberturaLinea[k] })),
  ] },
];

/** Valor de un indicador en el mes m de una serie (cons: la serie del Consolidado, para el aporte). */
export function valorDe(ind: Ind, serie: Serie, m: number, cons?: Serie): number | null {
  const v = ind.valor(serie.ind[m], serie.base, m, cons?.ind[m]);
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

// ---------- formatos (Ecuador): dólares completos con negativos entre paréntesis; porcentajes con signo ----------
export const usd = (v: number | null) => (v === null ? "—" : `${v < 0 && Math.round(v) !== 0 ? "(" : ""}$${Math.abs(Math.round(v)).toLocaleString("es-EC")}${v < 0 && Math.round(v) !== 0 ? ")" : ""}`);
export const pct = (v: number | null) => {
  if (v === null || !Number.isFinite(v)) return "—";
  const t = `${Math.abs(v * 100).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  return v < 0 && Math.abs(v * 100) >= 0.005 ? `−${t}` : t;
};

/** Categorías para las pantallas del presupuesto: sin los indicadores que solo tienen valor real. */
export const CATEGORIAS_PRESUPUESTO: Categoria[] = CATEGORIAS.map((c) => ({ ...c, indicadores: c.indicadores.filter((i) => !i.soloReal) }));
