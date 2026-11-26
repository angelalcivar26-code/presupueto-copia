/**
 * CONTRIBUCIONES OBLIGATORIAS (4504): Seguro de Depósitos (COSEDE) y Superintendencia (SEPS).
 *
 * COSEDE (Res. 648-2021-F; Título IV del Seguro de Depósitos):
 *   cooperativas de los segmentos 1 a 3 pagan cada mes (hasta el día 8 del mes siguiente).
 *   Contribución del mes = saldo promedio de Obligaciones con el público (21) × (prima fija anual + PAR anual) ÷ 12.
 *   Prima fija → 45042010 (450420) · prima ajustada por riesgo → 45042105 (450421).
 *   Por defecto se usa la tasa real del año en curso (histórico: lo registrado en 450420 y 450421 ÷ saldo promedio de 21).
 *
 * SEPS (Res. SEPS-IGT-ITICA-IGJ-2017-124; "Contribuciones y proceso de pago de las entidades del SFPS"):
 *   - 0,45 por mil semestral del promedio de los activos totales de los últimos 6 meses
 *       abril     → segundo semestre del año anterior (jul–dic)
 *       septiembre → primer semestre del año (ene–jun)
 *   - 1 % anual sobre las utilidades y excedentes del año anterior (ingresos 51–56 − gastos 41–47, menos 15 % de
 *     participación a trabajadores), hasta el 30 de abril. Es de la cooperativa: se reparte entre agencias por su
 *     participación en el activo.
 *   Se registra en 450415 en los meses de pago (abril y septiembre), como en la contabilidad real.
 */
import type { FilaParametroOtrosPasivo } from "./orquestador";

/** Datos reales (histórico y balance de partida) que viajan pegados a los saldos de la agencia. */
export interface InsumosContribuciones {
  ejercicio: number;
  /** COSEDE real del año en curso: tasa anual = lo registrado ÷ meses × 12 ÷ saldo promedio de 21. */
  cosedeReal: { periodo: string | null; meses: number; pagadoFija: number; pagadoPar: number; base21: number; fijaAnual: number | null; parAnual: number | null };
  /** SEPS real del año en curso: lo registrado en 450415 cada mes (para comparar). */
  sepsReal: { periodo: string | null; porMes: number[] };
  /** Promedio de activos de la agencia en el segundo semestre del año anterior al ejercicio (null si no hay histórico). */
  activosSegundoSemestre: { valor: number | null; meses: string[] };
  /** Excedente del año anterior de la cooperativa (consolidado, antes del 15 %), anualizado si el corte no es diciembre. */
  excedenteAnterior: { valor: number | null; periodo: string | null };
  /** Activo de la agencia ÷ activo consolidado (reparte el 1 % sobre excedentes). */
  participacionActivo: number;
}
const porSaldos = new WeakMap<object, InsumosContribuciones>();
export function adjuntarContribuciones(saldos: object, i: InsumosContribuciones) { porSaldos.set(saldos, i); }
export function contribucionesDe(saldos: object): InsumosContribuciones | null { return porSaldos.get(saldos) ?? null; }
/** Valores de respaldo si no hay parámetro guardado ni histórico (los que usaba la herramienta antes). */
const RESPALDO = { cosedeFija: 0.00648, cosedePar: 0.0004, sepsActivos: 0.00045, sepsExcedentes: 0.01, participacionTrabajadores: 0.15 };

interface TasasContribuciones {
  cosedeFija: number; cosedePar: number; sepsActivos: number; sepsExcedentes: number;
  origen: { cosedeFija: "guardado" | "historico" | "respaldo"; cosedePar: "guardado" | "historico" | "respaldo"; sepsActivos: "guardado" | "norma"; sepsExcedentes: "guardado" | "norma" };
}

const guardado = (filas: FilaParametroOtrosPasivo[], c: string) => {
  const f = filas.filter((x) => x.concepto === c);
  return f.length ? Number(f.find((x) => x.mes === 1)?.monto ?? f[0].monto) : null;
};
const plausible = (x: number | null | undefined, max: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x < max;

export function tasasContribuciones(filas: FilaParametroOtrosPasivo[], ins: InsumosContribuciones | null): TasasContribuciones {
  const gF = guardado(filas, "cosede_prima_fija_anual"), gP = guardado(filas, "cosede_par_anual");
  const gA = guardado(filas, "seps_tasa_activos_semestral"), gE = guardado(filas, "seps_tasa_excedentes");
  const hF = ins?.cosedeReal.fijaAnual, hP = ins?.cosedeReal.parAnual;
  return {
    cosedeFija: gF ?? (plausible(hF, 0.03) ? hF : RESPALDO.cosedeFija),
    cosedePar: gP ?? (plausible(hP, 0.03) ? hP : RESPALDO.cosedePar),
    sepsActivos: gA ?? RESPALDO.sepsActivos,
    sepsExcedentes: gE ?? RESPALDO.sepsExcedentes,
    origen: {
      cosedeFija: gF !== null ? "guardado" : plausible(hF, 0.03) ? "historico" : "respaldo",
      cosedePar: gP !== null ? "guardado" : plausible(hP, 0.03) ? "historico" : "respaldo",
      sepsActivos: gA !== null ? "guardado" : "norma",
      sepsExcedentes: gE !== null ? "guardado" : "norma",
    },
  };
}

/** COSEDE mensual: saldo promedio de 21 del mes × tasa anual ÷ 12. */
export function calcularCosede(saldo21Corte: number, saldo21PorMes: number[], t: TasasContribuciones) {
  const base = saldo21PorMes.map((v, i) => ((i === 0 ? saldo21Corte : saldo21PorMes[i - 1]) + v) / 2);
  return { base, fija: base.map((b) => (b * t.cosedeFija) / 12), par: base.map((b) => (b * t.cosedePar) / 12) };
}

/**
 * SEPS: abril = 0,45‰ × activos promedio jul–dic del año anterior + 1 % × excedente del año anterior (parte de la agencia);
 * septiembre = 0,45‰ × activos promedio ene–jun del ejercicio.
 * activosPrimerSemestre: estimado = activo del balance de partida + crecimiento de las captaciones hasta junio.
 */
export function calcularSeps(args: {
  activoCorte: number; activosPrimerSemestre: number; ins: InsumosContribuciones | null; t: TasasContribuciones;
}) {
  const { activoCorte, activosPrimerSemestre, ins, t } = args;
  const activosH2 = ins?.activosSegundoSemestre.valor ?? activoCorte;
  const exc = ins?.excedenteAnterior.valor ?? 0;
  const excedenteNeto = Math.max(0, exc) * (1 - RESPALDO.participacionTrabajadores);
  const parteExcedente = excedenteNeto * t.sepsExcedentes * (ins?.participacionActivo ?? 0);
  const abrilActivos = activosH2 * t.sepsActivos, septiembre = activosPrimerSemestre * t.sepsActivos;
  const porMes = Array(12).fill(0) as number[];
  porMes[3] = abrilActivos + parteExcedente;
  porMes[8] = septiembre;
  return { porMes, detalle: { activosH2, activosH1: activosPrimerSemestre, abrilActivos, excedente: exc, excedenteNeto, participacion: ins?.participacionActivo ?? 0, parteExcedente, septiembre } };
}
