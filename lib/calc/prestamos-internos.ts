/**
 * TRANSFERENCIAS INTERNAS (1908 / 2908) entre oficinas.
 *
 * En cada oficina la 1908 es lo que otras le deben y la 2908 lo que ella debe a otras. Hay dos clases de subcuentas:
 *  - Transaccionalidad ("Agencia Machala II", "Oficina matriz"): operaciones entre agencias, sin interés. En el
 *    presupuesto se mantiene el saldo del corte.
 *  - Préstamos internos ("Préstamos internos Agencia Balsas"): la oficina que presta los tiene en 1908 y la que recibe en
 *    2908. Cada mes se abona capital y se paga interés sobre el saldo del mes anterior (tasa anual ÷ 12): la que paga lo
 *    registra en 41059005 y la que cobra en 51909005. El abono sale de caja de la que debe y entra a la que presta.
 *    Un préstamo nuevo sube la 1908 de la que presta (sale de su caja) y la 2908 de la que recibe (entra a su caja).
 */

export const OFICINAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo"];

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Oficina a la que se refiere el nombre de una subcuenta («Agencia guabo», «Préstamos Internos Oficina Matriz»). */
export function contraparteDe(nombre: string): string | null {
  const n = sinTildes(nombre);
  const claves: [string, string][] = [["matriz", "Matriz"], ["guabo", "El Guabo"], ["pinas", "Piñas"], ["machala", "Machala II"], ["ponce", "Ponce Enríquez"],
    ["balsas", "Balsas"], ["santa rosa", "Santa Rosa"], ["lajas", "Las Lajas"], ["naranjal", "Naranjal"], ["catamayo", "Catamayo"]];
  return claves.find(([k]) => n.includes(k))?.[1] ?? null;
}
export const esPrestamo = (nombre: string) => /prestamo/.test(sinTildes(nombre));

/** Saldo de cada mes de un préstamo: entra lo nuevo del mes y se abona hasta dejarlo en cero. */
export function proyectarPrestamo(saldoCorte: number, abono: number, nuevos: number[]): { saldo: number[]; abonos: number[] } {
  let s = saldoCorte;
  const saldo: number[] = [], abonos: number[] = [];
  for (let m = 0; m < 12; m++) {
    s += nuevos[m] ?? 0;
    const a = Math.min(Math.max(0, abono), s);
    s -= a; abonos.push(a); saldo.push(s);
  }
  return { saldo, abonos };
}
/** Día del mes en que se abona capital y día en que se pagan los intereses (como lo calcula contabilidad). */
const DIA_ABONO = 4, DIA_PAGO = 25;
/**
 * Interés de cada mes, como contabilidad: período del 25 del mes anterior al 25 del mes, base 360 días.
 * Del 25 al día del abono corre sobre el saldo antes del abono; desde el abono hasta el 25, sobre el saldo después.
 * (Machala II, sep-26: 355.000 × 7,03 % × 10/360 + 325.000 × 7,03 % × 21/360 = 2.026,01.)
 */
export function interesPrestamo(saldoCorte: number, saldo: number[], tasaPct: number[], ejercicio: number): { interes: number[]; diasAntes: number[]; diasDespues: number[] } {
  const diasAntes: number[] = [], diasDespues: number[] = [], interes: number[] = [];
  saldo.forEach((despues, m) => {
    const antes = m === 0 ? saldoCorte : saldo[m - 1];
    const diasPeriodo = new Date(Date.UTC(ejercicio, m, 0)).getUTCDate(); // días del mes anterior (25 → 25)
    const a = diasPeriodo - DIA_PAGO + DIA_ABONO, b = DIA_PAGO - DIA_ABONO;
    const t = (tasaPct[m] ?? 0) / 100 / 360;
    diasAntes.push(a); diasDespues.push(b);
    interes.push(Math.max(0, antes) * t * a + Math.max(0, despues) * t * b);
  });
  return { interes, diasAntes, diasDespues };
}
/** Primer mes (desde enero del ejercicio) en que el saldo llega a cero con el abono dado; null si no hay abono. */
export function mesTermina(saldoCorte: number, abono: number, ejercicio: number, nuevos: number[] = []): string | null {
  const totalNuevo = nuevos.reduce((t, v) => t + v, 0);
  if (!(abono > 0)) return null;
  const n = Math.ceil((saldoCorte + totalNuevo) / abono - 1e-9);
  if (n <= 0) return null;
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${MES[(n - 1) % 12]}-${String(ejercicio + Math.floor((n - 1) / 12)).slice(2)}`;
}

/** Préstamos internos de una oficina en el ejercicio (lo que presta y lo que recibe), para el motor. */
export interface PrestamosAgencia {
  prestadoCorte: number; prestadoSaldo: number[]; cobrado: number[]; otorgado: number[]; interesCobrado: number[];
  recibidoCorte: number; recibidoSaldo: number[]; pagado: number[]; recibido: number[]; interesPagado: number[];
  /** Tasa anual (%) de los préstamos internos: la misma para todas las oficinas (Transferencias internas). */
  tasa: number;
}
const ADJ = new WeakMap<object, PrestamosAgencia>();
export function adjuntarPrestamosInternos(saldos: object, p: PrestamosAgencia) { ADJ.set(saldos, p); }
export function prestamosInternosDe(saldos: object): PrestamosAgencia | null { return ADJ.get(saldos) ?? null; }
