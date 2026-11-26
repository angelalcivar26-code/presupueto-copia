/**
 * Motor de cálculo puro - FONDOS DISPONIBLES (cuenta 11) por reglas.
 *
 * El TOTAL de la 11 sigue saliendo del Flujo de efectivo (así el Balance cuadra).
 * Lo que cambia es el REPARTO entre subcuentas, que ya no usa el % del corte:
 *
 *  Caja (1101)                 = saldo del corte, sin pasar el límite de la agencia
 *                                (monto máximo de cajeros + monto máximo de caja fuerte).
 *                                Si el límite no está definido, se mantiene el saldo del corte.
 *  Depósitos para encaje (1102)= captaciones proyectadas (21) × % de encaje BCE (el mismo valor
 *                                de "Reservas de liquidez requeridas" del Flujo).
 *  1104, 1105, otras           = se mantiene el saldo del corte.
 *  Bancos (1103)               = el resto: total de la 11 − todo lo anterior. Si el mes no alcanza,
 *                                Bancos sale negativo (el faltante del Flujo se ve en un solo lugar).
 *
 * Parte INFORMATIVA (no toca el Balance):
 *  Fondos requeridos = caja (límite) + encaje BCE (% de captaciones)
 *                    + bancos operativos (días hábiles de pagos) + otras subcuentas (saldo del corte).
 *  Excedente         = fondos disponibles − fondos requeridos (dinero ocioso; negativo = déficit).
 *  Costo de oportunidad = excedente × tasa promedio de las inversiones vigentes ÷ 12.
 */

interface ParametrosFondos {
  maxCajero: number;        // monto máximo de cajeros automáticos de la agencia (suma de todos)
  maxCajaFuerte: number;    // monto máximo de caja fuerte / bóveda de la agencia
  diasCobertura: number;    // días hábiles de pagos que deben quedar en bancos (institucional)
  pctEncaje: number;        // % de encaje BCE en fracción (institucional, 0,035 = 3,5 %)
  ejercicio: number;        // para contar los días hábiles de cada mes
  guardado: boolean;        // la agencia tiene límites registrados
}

export const DIAS_COBERTURA_DEFECTO = 5;
export const PCT_ENCAJE_DEFECTO = 0.035;

/** Los parámetros viajan pegados a los saldos (igual que Inversiones) para llegar al Balance sin cambiar firmas. */
const porSaldos = new WeakMap<object, ParametrosFondos>();
export function adjuntarParametrosFondos(saldos: object, p: ParametrosFondos): void { porSaldos.set(saldos, p); }
export function parametrosFondosDe(saldos: object): ParametrosFondos | null { return porSaldos.get(saldos) ?? null; }
/** % de encaje BCE (fracción) que usan el Flujo y la 1102. */
export function pctEncajeDe(saldos: object): number {
  const p = porSaldos.get(saldos)?.pctEncaje;
  return p !== undefined && Number.isFinite(p) && p >= 0 ? p : PCT_ENCAJE_DEFECTO;
}
export function pctTextoEncaje(saldos: object): string {
  return `${(pctEncajeDe(saldos) * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %`;
}

/** Límite de caja de la agencia (null si no está definido). */
export function limiteCaja(p: ParametrosFondos | null): number | null {
  if (!p || !p.guardado) return null;
  const t = (p.maxCajero || 0) + (p.maxCajaFuerte || 0);
  return t > 0 ? t : null;
}

/** Días de lunes a viernes de cada mes del ejercicio (no descuenta feriados). */
function diasHabilesPorMes(ejercicio: number): number[] {
  return Array.from({ length: 12 }, (_, m) => {
    let n = 0;
    const dias = new Date(Date.UTC(ejercicio, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= dias; d++) {
      const s = new Date(Date.UTC(ejercicio, m, d)).getUTCDay();
      if (s !== 0 && s !== 6) n++;
    }
    return n;
  });
}

interface RepartoSubcuenta { codigo: string; saldoCorte: number; valores: number[]; regla: "caja" | "encaje" | "fija" | "resto" }

/**
 * Reparte los fondos disponibles de cada mes entre las subcuentas de la 11.
 * `subcuentas` = saldos del corte por subcuenta de 4 dígitos (la 1103 incluida).
 */
export function repartirFondosPorReglas(fondos: number[], subcuentas: { codigo: string; saldo: number }[], limite: number | null, encaje: number[]): RepartoSubcuenta[] {
  const caja = subcuentas.find((s) => s.codigo === "1101");
  const enc = subcuentas.find((s) => s.codigo === "1102");
  const fijas = subcuentas.filter((s) => !["1101", "1102", "1103"].includes(s.codigo));
  const sumaFijas = fijas.reduce((t, s) => t + s.saldo, 0);
  const valoresEncaje = fondos.map((_, i) => (enc ? encaje[i] ?? 0 : 0));
  const objetivoCaja = caja ? (limite === null ? caja.saldo : Math.min(caja.saldo, limite)) : 0;

  // La caja es una necesidad operativa: se mantiene aunque el mes no alcance; el faltante se ve en Bancos.
  const valoresCaja = fondos.map(() => objetivoCaja);
  const valoresBancos = fondos.map((f, i) => f - sumaFijas - valoresEncaje[i] - valoresCaja[i]);

  const out: RepartoSubcuenta[] = [];
  if (caja) out.push({ codigo: "1101", saldoCorte: caja.saldo, valores: valoresCaja, regla: "caja" });
  if (enc) out.push({ codigo: "1102", saldoCorte: enc.saldo, valores: valoresEncaje, regla: "encaje" });
  for (const s of fijas) out.push({ codigo: s.codigo, saldoCorte: s.saldo, valores: fondos.map(() => s.saldo), regla: "fija" });
  const b = subcuentas.find((s) => s.codigo === "1103");
  out.push({ codigo: "1103", saldoCorte: b ? b.saldo : 0, valores: valoresBancos, regla: "resto" });
  return out.sort((a, z) => a.codigo.localeCompare(z.codigo));
}

interface FondosRequeridos {
  limiteCaja: number | null;
  caja: number[];             // requerido de caja = límite (o la caja proyectada si no hay límite)
  encaje: number[];           // % de encaje × captaciones (del Flujo)
  pagosMes: number[];         // gastos de personal + gastos operativos en efectivo + intereses pagados
  diasHabiles: number[];
  pagoDiario: number[];
  bancosOperativos: number[]; // pago diario × días de cobertura
  otras: number[];            // subcuentas que mantienen el saldo del corte (1104, 1105…)
  total: number[];
  excedente: number[];        // fondos − requerido
  diasCubiertosBancos: number[]; // saldo de bancos ÷ pago diario
  diasCubiertosCorte: number | null;
  tasaInversiones: number | null; // anual, promedio ponderado de los títulos vigentes al corte
  costoOportunidad: number[]; // max(0, excedente) × tasa ÷ 12
}

export function calcularFondosRequeridos(args: {
  fondos: number[];
  reparto: RepartoSubcuenta[];
  encaje: number[];
  pagosMes: number[];
  parametros: ParametrosFondos | null;
  ejercicio: number;
  saldoBancosCorte: number;
  tasaInversiones: number | null;
}): FondosRequeridos {
  const { fondos, reparto, encaje, pagosMes, parametros, saldoBancosCorte, tasaInversiones } = args;
  const lim = limiteCaja(parametros);
  const dias = Math.max(0, parametros?.diasCobertura ?? DIAS_COBERTURA_DEFECTO);
  const diasHabiles = diasHabilesPorMes(parametros?.ejercicio ?? args.ejercicio);
  const cajaProy = reparto.find((r) => r.codigo === "1101")?.valores ?? fondos.map(() => 0);
  const bancos = reparto.find((r) => r.codigo === "1103")?.valores ?? fondos.map(() => 0);
  const caja = fondos.map((_, i) => (lim === null ? cajaProy[i] : lim));
  const pagoDiario = pagosMes.map((p, i) => (diasHabiles[i] ? p / diasHabiles[i] : 0));
  const bancosOperativos = pagoDiario.map((p) => p * dias);
  const otras = fondos.map((_, i) => reparto.filter((r) => r.regla === "fija").reduce((t, r) => t + r.valores[i], 0));
  const total = fondos.map((_, i) => caja[i] + encaje[i] + bancosOperativos[i] + otras[i]);
  const excedente = fondos.map((f, i) => f - total[i]);
  const pd0 = pagosMes[0] && diasHabiles[0] ? pagosMes[0] / diasHabiles[0] : 0;
  return {
    limiteCaja: lim,
    caja, encaje, pagosMes, diasHabiles, pagoDiario, bancosOperativos, otras, total, excedente,
    diasCubiertosBancos: bancos.map((b, i) => (pagoDiario[i] > 0 ? b / pagoDiario[i] : 0)),
    diasCubiertosCorte: pd0 > 0 ? saldoBancosCorte / pd0 : null,
    tasaInversiones,
    costoOportunidad: excedente.map((e) => (tasaInversiones ? Math.max(0, e) * tasaInversiones / 12 : 0)),
  };
}
