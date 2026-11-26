/**
 * 51 · INTERESES Y DESCUENTOS GANADOS en el Estudio de agencia.
 *   5101 depósitos (saldo de bancos 1103 del mes anterior × tasa de bancos ÷ 12) — supuesto propio: la tasa de bancos.
 *   5103 inversiones (registro de Inversiones) · 5104 cartera (cuenta 14) · 5190 préstamos internos (tasa interna, cuenta 41).
 */
import { delMes, mesAnterior, type HistoricoEstudio } from "./estudio-agencia";
import type { FilaPresupuestoDepartamental } from "./orquestador";

export interface Mes51 {
  p: string; i51: number | null; i5101: number | null; i5103: number | null; i5104: number | null; i5190: number | null; otros: number | null;
  bancos: number; inversiones: number; tasaBancos: number | null; rendInv: number | null;
}
interface Realidad51 {
  anio: number; meses: Mes51[]; ventana: Mes51[];
  prom: { i51: number; i5101: number; i5103: number; i5104: number; i5190: number; otros: number };
  bancos: number; inversiones: number; tasaBancos: number | null; rendInv: number | null;
}

const v = (h: HistoricoEstudio, p: string, k: string) => (h.er[p]?.[k] !== undefined ? delMes(h.er, p, k) : null);
const saldo = (h: HistoricoEstudio, p: string, k: string) => Math.abs(h.bal[p]?.[k] ?? 0);

export function calcularRealidad51(h: HistoricoEstudio): Realidad51 | null {
  const periodos = Object.keys(h.er).filter((p) => h.er[p]?.["51"] !== undefined).sort();
  const meses: Mes51[] = [];
  for (const p of periodos) {
    const i51 = v(h, p, "51");
    if (i51 === null) continue;
    const i5101 = v(h, p, "5101"), i5103 = v(h, p, "5103"), i5104 = v(h, p, "5104"), i5190 = v(h, p, "5190");
    const bancos = saldo(h, p, "1103"), inversiones = saldo(h, p, "13");
    const b0 = h.bal[mesAnterior(p)] ? saldo(h, mesAnterior(p), "1103") : bancos, n0 = h.bal[mesAnterior(p)] ? saldo(h, mesAnterior(p), "13") : inversiones;
    const bb = (b0 + bancos) / 2, bi = (n0 + inversiones) / 2;
    meses.push({
      p, i51, i5101, i5103, i5104, i5190, otros: i51 - (i5101 ?? 0) - (i5103 ?? 0) - (i5104 ?? 0) - (i5190 ?? 0), bancos, inversiones,
      tasaBancos: i5101 !== null && bb > 1000 ? (i5101 * 12) / bb : null,
      rendInv: i5103 !== null && bi > 1000 ? (i5103 * 12) / bi : null,
    });
  }
  if (!meses.length) return null;
  const ult = meses[meses.length - 1], anio = Number(ult.p.slice(0, 4));
  let ventana = meses.filter((m) => m.p.startsWith(`${anio}-`));
  if (ventana.length < 3) ventana = meses.slice(-12);
  const n = ventana.length, S = (f: (m: Mes51) => number | null) => ventana.reduce((t, m) => t + (f(m) ?? 0), 0) / n;
  const prom = { i51: S((m) => m.i51), i5101: S((m) => m.i5101), i5103: S((m) => m.i5103), i5104: S((m) => m.i5104), i5190: S((m) => m.i5190), otros: S((m) => m.otros) };
  const bB = S((m) => m.bancos), bI = S((m) => m.inversiones);
  return {
    anio, meses, ventana, prom, bancos: ult.bancos, inversiones: ult.inversiones,
    tasaBancos: bB > 1000 && prom.i5101 > 0 ? (prom.i5101 * 12) / bB : null,
    rendInv: bI > 1000 && prom.i5103 > 0 ? (prom.i5103 * 12) / bI : null,
  };
}

/** Filas del presupuesto con otra tasa de bancos: 5101 = saldo de bancos del mes anterior × tasa ÷ 12, se escala por mes. */
export function escalarBancos(filas: FilaPresupuestoDepartamental[], tasaMes: number[], tasa: number): FilaPresupuestoDepartamental[] {
  if (tasaMes.every((t) => Math.abs(t / 100 - tasa) < 1e-9)) return filas;
  return filas.map((f) => {
    if (String(f.concepto).replace(/\D/g, "") !== "5101") return f;
    const t0 = (tasaMes[f.mes - 1] ?? 0) / 100;
    return t0 > 0 ? { ...f, monto: (f.monto * tasa) / t0 } : f;
  });
}
