/**
 * Motor de calculo puro - PLANILLA DE EMPLEADOS (hoja TH1).
 * Replica las formulas de TH1 (columnas D-O de cada bloque de agencia).
 *
 * Por empleado (fila del Excel):
 *   basico2026   = basico2025 * (1 + incrementoPct) + basico2025   [= E*(1+D)+E, igual que "=+(E11*(D11))+E11"]
 *   sueldoAnual  = basico2026 * 12                                  [G = F*12]
 *   totalAnual   = sueldoAnual + movilizacionAnual                  [I = G+H]
 *   iessPatronalAnual   = totalAnual * IESS_PATRONAL_PCT            [J = I*D5]
 *   fondoReservaAnual   = totalAnual * FONDO_RESERVA_PCT            [K = I*8.33%]
 *   decimoTerceroAnual  = totalAnual / 12                           [L = I/12]
 *   decimoCuartoAnual   = DECIMO_CUARTO_SBU (fijo, no depende del sueldo) [M = 482]
 *   provisionesAnual    = iessPatronalAnual + fondoReservaAnual + decimoTerceroAnual + decimoCuartoAnual  [N]
 *   costoTotalAnual     = provisionesAnual + totalAnual             [O = N+I]
 *
 * NOTA IMPORTANTE: "basico2026" (columna F) es un valor MENSUAL, no anual
 * -- por eso "sueldoAnual" lo multiplica x12. La suma de basico2026 de todos
 * los empleados (F112 en el Excel) es la que alimenta directamente la linea
 * "Remuneraciones mensuales / Sueldo" del Estado de Resultados, igual todos
 * los meses (no varia mes a mes en este modelo).
 */

import { VALORES_DE_SIEMPRE, type ParametrosVigentes } from "./parametros-vigentes";

export interface Empleado {
  nombre: string;
  basico2025: number;
  incrementoPct: number;
  movilizacionAnual: number;
}

interface CalculoEmpleado {
  nombre: string;
  basico2026: number;
  sueldoAnual: number;
  totalAnual: number;
  iessPatronalAnual: number;
  fondoReservaAnual: number;
  decimoTerceroAnual: number;
  decimoCuartoAnual: number;
  provisionesAnual: number;
  costoTotalAnual: number;
}

function calcularEmpleado(e: Empleado, p: ParametrosVigentes = VALORES_DE_SIEMPRE): CalculoEmpleado {
  const basico2026 = e.basico2025 * e.incrementoPct + e.basico2025; // fiel al Excel: =+(E*D)+E
  const sueldoAnual = basico2026 * 12;
  const totalAnual = sueldoAnual + e.movilizacionAnual;
  const iessPatronalAnual = totalAnual * p.iess_patronal;
  const fondoReservaAnual = totalAnual * p.fondo_reserva;
  const decimoTerceroAnual = totalAnual / 12;
  const decimoCuartoAnual = p.sbu;
  const provisionesAnual = iessPatronalAnual + fondoReservaAnual + decimoTerceroAnual + decimoCuartoAnual;
  const costoTotalAnual = provisionesAnual + totalAnual;

  return {
    nombre: e.nombre,
    basico2026,
    sueldoAnual,
    totalAnual,
    iessPatronalAnual,
    fondoReservaAnual,
    decimoTerceroAnual,
    decimoCuartoAnual,
    provisionesAnual,
    costoTotalAnual,
  };
}

/** Totales anuales agregados de toda la planilla de una agencia (equivalente a la fila 112 "TOTAL POR RUBROS" del Excel). */
interface TotalesNominaAgencia {
  sueldoMensualPlano: number; // SUM(basico2026) -- ya es mensual, se usa igual los 12 meses
  iessPatronalAnualTotal: number; // J112
  fondoReservaAnualTotal: number; // K112
  decimoTerceroAnualTotal: number; // L112
  decimoCuartoAnualTotal: number; // M112
  costoTotalAnual: number; // O112
  numeroEmpleados: number;
}

export function calcularTotalesNomina(empleados: Empleado[], p: ParametrosVigentes = VALORES_DE_SIEMPRE): TotalesNominaAgencia {
  const calculos = empleados.map((e) => calcularEmpleado(e, p));
  return {
    sueldoMensualPlano: calculos.reduce((s, c) => s + c.basico2026, 0),
    iessPatronalAnualTotal: calculos.reduce((s, c) => s + c.iessPatronalAnual, 0),
    fondoReservaAnualTotal: calculos.reduce((s, c) => s + c.fondoReservaAnual, 0),
    decimoTerceroAnualTotal: calculos.reduce((s, c) => s + c.decimoTerceroAnual, 0),
    decimoCuartoAnualTotal: calculos.reduce((s, c) => s + c.decimoCuartoAnual, 0),
    costoTotalAnual: calculos.reduce((s, c) => s + c.costoTotalAnual, 0),
    numeroEmpleados: empleados.length,
  };
}

/**
 * Décimo tercero, fondo de reserva e IESS patronal sobre los valores variables de Talento Humano, que se presupuestan
 * por mes (no por empleado), según un histórico:
 *   base del mes      = horas extras (45019005) + comisiones (45019010) + subrogaciones (45019095)
 *                       [+ otros gastos del personal (45019090) solo si OTROS_GASTOS_PERSONAL_ES_REMUNERACION]
 *   décimo tercero    = base ÷ 12                       (Código del Trabajo: 1/12 de lo ganado)
 *   fondo de reserva  = base × fondo de reserva (8,33 %, Parámetros institucionales)
 *   IESS patronal     = base × aporte patronal (12,15 %, Parámetros institucionales)
 *   décimo cuarto     = no aplica (es un SBU fijo por empleado)
 * Sueldo y décimo cuarto de la nómina no dependen de estos valores.
 */
/** 45019090 «Otros gastos del personal»: no es remuneración (uniformes, alimentación, capacitación…) mientras la
 *  contadora no confirme lo contrario; si lo fuera, se cambia a true y entra en la base de décimos, fondo e IESS. */
export const OTROS_GASTOS_PERSONAL_ES_REMUNERACION = false;

export interface ExtrasNominaMes { base: number[]; decimoTercero: number[]; fondoReserva: number[]; iessPatronal: number[] }
export function extrasNominaPorMes(extras: ExtrasTH2ParaNomina, p: ParametrosVigentes = VALORES_DE_SIEMPRE): ExtrasNominaMes {
  const base = Array.from({ length: 12 }, (_, i) =>
    (extras.horasExtrasPorMes[i] || 0) + (extras.comisionesPorMes[i] || 0) + (extras.subrogacionesPorMes[i] || 0)
    + (OTROS_GASTOS_PERSONAL_ES_REMUNERACION ? extras.otrosGastosPersonalPorMes[i] || 0 : 0));
  return {
    base,
    decimoTercero: base.map((b) => b / 12),
    fondoReserva: base.map((b) => b * p.fondo_reserva),
    iessPatronal: base.map((b) => b * p.iess_patronal),
  };
}

/**
 * Líneas mensuales de la nómina para el Estado de resultados:
 *   sueldo          = suma del básico proyectado (igual los 12 meses)
 *   décimo tercero  = (suma del total anual ÷ 12) ÷ 12 + décimo tercero de los valores variables
 *   décimo cuarto   = SBU × empleados ÷ 12
 *   fondo de reserva= (total anual × 8,33 %) ÷ 12 + fondo de los valores variables
 *   IESS patronal   = (total anual × 12,15 %) ÷ 12 + IESS de los valores variables
 */
interface ExtrasTH2ParaNomina {
  horasExtrasPorMes: number[]; // TH2 45019005
  comisionesPorMes: number[]; // TH2 45019010
  otrosGastosPersonalPorMes: number[]; // TH2 45019090
  subrogacionesPorMes: number[]; // TH2 45019095
}

export function calcularLineasProvisionMensuales(
  totales: TotalesNominaAgencia,
  extras: ExtrasTH2ParaNomina,
  p: ParametrosVigentes = VALORES_DE_SIEMPRE
): {
  decimoTerceroPorMes: number[];
  fondoReservaPorMes: number[];
  iessPatronalPorMes: number[];
  decimoCuartoPorMes: number[];
  sueldoPorMes: number[];
} {
  const x = extrasNominaPorMes(extras, p);
  const doce = Array.from({ length: 12 }, (_, i) => i);
  return {
    sueldoPorMes: doce.map(() => totales.sueldoMensualPlano),
    decimoCuartoPorMes: doce.map(() => totales.decimoCuartoAnualTotal / 12),
    decimoTerceroPorMes: doce.map((i) => totales.decimoTerceroAnualTotal / 12 + x.decimoTercero[i]),
    fondoReservaPorMes: doce.map((i) => totales.fondoReservaAnualTotal / 12 + x.fondoReserva[i]),
    iessPatronalPorMes: doce.map((i) => totales.iessPatronalAnualTotal / 12 + x.iessPatronal[i]),
  };
}
