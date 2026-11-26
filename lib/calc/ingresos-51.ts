/**
 * Motor de cálculo puro - INTERESES Y DESCUENTOS GANADOS (51, sin cartera 5104)
 *
 *  5101 Depósitos (bancos)     = saldo de Bancos (1103) del mes anterior × tasa anual ÷ 12
 *                                (enero usa el 1103 del balance de partida). Se usa el mes anterior
 *                                porque el interés del mes entra al Flujo y cambia el saldo de bancos.
 *  5103 Inversiones            = sale del registro de Inversiones (lib/calc/inversiones.ts)
 *  5190 Préstamos internos     = saldo de las subcuentas de 1908 que dicen "préstamos internos" × tasa anual ÷ 12
 *                                (solo esas subcuentas, no todo el 1908; saldo del corte en los 12 meses)
 *
 * Verificación contra el balance de partida (acumulado del año al corte):
 *  tasa implícita = saldo de la cuenta de ingreso ÷ meses del corte × 12 ÷ saldo base al corte
 */

interface CuentaBase { codigo: string; nombre: string; saldo: number }

interface Verificacion {
  ingresoCorte: number | null; // 5101 / 5190 acumulado en el balance del corte (null = el balance no trae la cuenta)
  meses: number;             // meses transcurridos al corte
  baseCorte: number;         // 1103 / préstamos internos al corte
  tasaUsada: number;         // % anual del parámetro (enero)
  esperado: number;          // baseCorte × tasa × meses ÷ 12
  tasaImplicita: number | null; // % anual
}

interface Ingresos51 {
  tasaBancosPorMes: number[];          // % anual
  tasaInternosPorMes: number[];        // % anual
  tasaBancosGuardada: boolean;
  tasaInternosGuardada: boolean;
  basePorMesBancos: number[];          // 1103 del mes anterior
  i5101PorMes: number[];
  cuentasInternas: CuentaBase[];       // subcuentas de 1908 de préstamos internos detectadas
  basePorMesInternos: number[];        // préstamos internos del mes anterior
  i5190PorMes: number[];
  calcula5190: boolean;                // false si no se encontraron préstamos internos (5190 queda como en Ingresos)
  i5103PorMes: number[] | null;        // del registro de inversiones (null = sin registro → 5103 en 0)
  saldo13Corte: number;                // inversiones en el balance del corte (aviso si hay saldo y no hay registro)
  verificacion5101: Verificacion;
  verificacion5190: Verificacion | null;
  /** Lo que la agencia RECIBE de otras oficinas (2908 · préstamos) y el interés que paga por eso (41059005). */
  cuentasRecibidas?: CuentaBase[];
  i410590PorMes?: number[];
  verificacion410590?: Verificacion | null;
  corte: { anio: number; mes: number };
}

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Subcuentas de préstamos internos: bajo 1908 (lo que la agencia PRESTA) o 2908 (lo que RECIBE),
 * cuyo nombre dice "préstamo" (ej. "Préstamos Internos Agencia Balsas"). Solo esas, no todo el
 * saldo de 1908/2908 (las demás son transferencias). Se toma la de nivel más alto de cada rama.
 */
export function detectarPrestamosInternos(
  catalogo: { codigo: string; nombre: string }[],
  saldos: Record<string, number>,
  prefijo: "1908" | "2908" = "1908"
): CuentaBase[] {
  const coinciden = catalogo
    .filter((c) => c.codigo.startsWith(prefijo) && c.codigo.length > 4 && /prestamo/.test(norm(c.nombre)))
    .sort((a, b) => a.codigo.length - b.codigo.length);
  const elegidas: { codigo: string; nombre: string }[] = [];
  for (const c of coinciden) if (!elegidas.some((e) => c.codigo.startsWith(e.codigo))) elegidas.push(c);
  const claves = Object.keys(saldos);
  return elegidas.map((c) => {
    let saldo = Number(saldos[c.codigo]);
    if (!Number.isFinite(saldo)) {
      // El balance no trae ese nivel: se suman las hojas que cuelgan de él
      const hijas = claves.filter((k) => k.startsWith(c.codigo) && k !== c.codigo);
      saldo = hijas.filter((k) => !hijas.some((o) => o !== k && o.startsWith(k))).reduce((t, k) => t + (Number(saldos[k]) || 0), 0);
    }
    return { codigo: c.codigo, nombre: c.nombre, saldo };
  });
}

/** % anual por mes de un concepto guardado; si no hay filas, el valor por defecto. */
/** Tasa anual (%) de los préstamos internos entre oficinas, por defecto (se paga el interés todos los meses). */
export const TASA_PRESTAMOS_INTERNOS = 7.03;

export function tasaMensual(filas: { concepto: string; mes: number; monto: number }[], concepto: string, porDefecto: number): { valores: number[]; guardada: boolean } {
  const propias = filas.filter((f) => f.concepto === concepto);
  if (!propias.length) return { valores: Array(12).fill(porDefecto), guardada: false };
  // Un mes sin fila toma la tasa del mes guardado anterior (antes quedaba en 0 y apagaba el interés).
  const porMes: (number | null)[] = Array(12).fill(null);
  for (const f of propias) if (f.mes >= 1 && f.mes <= 12) porMes[f.mes - 1] = Number(f.monto) || 0;
  let previo = porMes.find((v) => v !== null) ?? 0;
  const valores = porMes.map((v) => (v === null ? previo : (previo = v)));
  return { valores, guardada: true };
}

export function verificar(ingresoCorte: number | null, meses: number, baseCorte: number, tasaUsada: number): Verificacion {
  const m = Math.max(1, meses);
  return {
    ingresoCorte, meses: m, baseCorte, tasaUsada,
    esperado: baseCorte * (tasaUsada / 100) * m / 12,
    tasaImplicita: ingresoCorte !== null && baseCorte > 0 ? (ingresoCorte / m * 12 / baseCorte) * 100 : null,
  };
}

/**
 * Saldo de una cuenta en el balance: el valor de ese código si el balance lo trae; si no, la suma de
 * sus subcuentas de último nivel (ej. 5190 = 519005 + 519090...). null si no aparece ninguna.
 */
export function saldoCuenta(saldos: Record<string, number>, codigo: string): number | null {
  const directo = Number(saldos[codigo]);
  if (saldos[codigo] !== undefined && Number.isFinite(directo)) return directo;
  const hijas = Object.keys(saldos).filter((k) => k.startsWith(codigo) && k !== codigo);
  if (!hijas.length) return null;
  return hijas.filter((k) => !hijas.some((o) => o !== k && o.startsWith(k))).reduce((t, k) => t + (Number(saldos[k]) || 0), 0);
}

/** Interés mensual sobre el saldo del mes anterior (enero = saldo del corte). Tasas en % anual. */
export function interesSobreSaldoAnterior(saldoCorte: number, saldoFinPorMes: number[], tasaPorMes: number[]): { base: number[]; interes: number[] } {
  const base = saldoFinPorMes.map((_, i) => (i === 0 ? saldoCorte : saldoFinPorMes[i - 1]));
  return { base, interes: base.map((b, i) => Math.max(0, b) * (tasaPorMes[i] / 100) / 12) };
}

// ── Adjunto a los saldos (mismo patrón que inversiones/provisión) para que los endpoints lo lean ──
const ADJUNTOS = new WeakMap<object, Ingresos51>();
export function adjuntarIngresos51(saldos: object, r: Ingresos51) { ADJUNTOS.set(saldos, r); }
export function ingresos51De(saldos: object): Ingresos51 | null { return ADJUNTOS.get(saldos) ?? null; }