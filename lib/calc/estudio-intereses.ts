/**
 * 41 · INTERESES CAUSADOS en el Estudio de agencia.
 *   4101 obligaciones con el público (sale de las captaciones: cuenta 21) · 4103 obligaciones financieras ·
 *   41059005 interés pagado a Matriz y otras agencias por los préstamos internos recibidos (2908 · préstamos).
 * El presupuesto calcula 41059005 (y su espejo 5190 en la agencia que presta) con el saldo de préstamos internos
 * del corte × la tasa interna de la agencia (Proyección de ingresos → 5190 · parámetro ingresos_tasa_prestamos_internos).
 */
import { delMes, mesAnterior, type HistoricoEstudio } from "./estudio-agencia";
import { detectarPrestamosInternos } from "./ingresos-51";

export interface MesInt { p: string; i41: number | null; i4101: number | null; i4103: number | null; interno: number | null; cobrado: number | null; recibe: number; presta: number; tasaPaga: number | null; tasaCobra: number | null }
interface RealidadIntereses { anio: number; meses: MesInt[]; ventana: MesInt[]; prom: { i41: number; i4101: number; i4103: number; interno: number; cobrado: number }; recibe: number; presta: number; tasaPaga: number | null; tasaCobra: number | null }

const pick = (h: HistoricoEstudio, p: string, ks: string[]) => { for (const k of ks) { const v = delMes(h.er, p, k); if (v !== null && h.er[p]?.[k] !== undefined) return v; } return null; };

/** Saldo de préstamos internos de un balance (subcuentas de 1908 / 2908 cuyo nombre dice "préstamo"). */
function prestamosInternos(h: HistoricoEstudio, bal: Record<string, number> | undefined, prefijo: "1908" | "2908") {
  if (!bal) return 0;
  const cat = Object.entries(h.nombres ?? {}).filter(([k]) => k.startsWith(prefijo)).map(([codigo, nombre]) => ({ codigo, nombre }));
  return Math.abs(detectarPrestamosInternos(cat, bal, prefijo).reduce((t, c) => t + c.saldo, 0));
}

export function calcularRealidadIntereses(h: HistoricoEstudio): RealidadIntereses | null {
  const periodos = Object.keys(h.er).filter((p) => h.er[p]?.["41"] !== undefined || h.er[p]?.["4101"] !== undefined).sort();
  const meses: MesInt[] = [];
  for (const p of periodos) {
    const i41 = pick(h, p, ["41"]), i4101 = pick(h, p, ["4101"]);
    if (i41 === null && i4101 === null) continue;
    const interno = pick(h, p, ["41059005", "410590"]), cobrado = pick(h, p, ["51909005", "519090"]);
    const recibe = prestamosInternos(h, h.bal[p], "2908"), presta = prestamosInternos(h, h.bal[p], "1908");
    const r0 = prestamosInternos(h, h.bal[mesAnterior(p)], "2908") || recibe, p0 = prestamosInternos(h, h.bal[mesAnterior(p)], "1908") || presta;
    meses.push({
      p, i41, i4101, i4103: pick(h, p, ["4103"]), interno, cobrado, recibe, presta,
      tasaPaga: interno !== null && (r0 + recibe) / 2 > 1000 ? (interno * 12) / ((r0 + recibe) / 2) : null,
      tasaCobra: cobrado !== null && (p0 + presta) / 2 > 1000 ? (cobrado * 12) / ((p0 + presta) / 2) : null,
    });
  }
  if (!meses.length) return null;
  const ult = meses[meses.length - 1], anio = Number(ult.p.slice(0, 4));
  let ventana = meses.filter((m) => m.p.startsWith(`${anio}-`));
  if (ventana.length < 3) ventana = meses.slice(-12);
  const n = ventana.length, S = (f: (m: MesInt) => number | null) => ventana.reduce((t, m) => t + (f(m) ?? 0), 0);
  const prom = { i41: S((m) => m.i41) / n, i4101: S((m) => m.i4101) / n, i4103: S((m) => m.i4103) / n, interno: S((m) => m.interno) / n, cobrado: S((m) => m.cobrado) / n };
  const baseR = ventana.reduce((t, m) => t + m.recibe, 0) / n, baseP = ventana.reduce((t, m) => t + m.presta, 0) / n;
  return {
    anio, meses, ventana, prom, recibe: ult.recibe, presta: ult.presta,
    tasaPaga: baseR > 1000 && prom.interno > 0 ? (prom.interno * 12) / baseR : null,
    tasaCobra: baseP > 1000 && prom.cobrado > 0 ? (prom.cobrado * 12) / baseP : null,
  };
}
