/**
 * Reporte "Recuperación de cartera Vigente y Vencida por Oficina" (sistema de cartera), un bloque por mes:
 *   fila "ENERO-2026 | SE DEBE RECUPERAR DENTRO DEL MES …", fila de títulos (OFICINA, N° Operaciones, SALDO PRESTAMO,
 *   CUOTAS A RECUPERAR, CAPITAL, CASTIGADO, INTERES, INTERES MORA, OTROS VALORES, Recuperado, Precancelados,
 *   Refin-Reest-Nov, Valor Neto Recuperado, % Neto Recuperado), y por oficina: total, VENCIDO y VIGENTE.
 * Se guardan las filas VENCIDO y VIGENTE de cada oficina y mes (los totales se recalculan).
 */
import { normalizarOficina, numero } from "./historico-parser";

export interface FilaRecuperacion {
  oficina: string; periodo: string; tipo: "VIGENTE" | "VENCIDO";
  operaciones: number; saldo: number; capital: number; castigado: number;
  recuperado: number; precancelados: number; refinanciado: number; neto: number;
}
export interface ResultadoRecuperacion { filas: FilaRecuperacion[]; periodos: string[]; oficinas: string[]; avisos: string[] }

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const limpio = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export function parsearRecuperacion(matriz: unknown[][]): ResultadoRecuperacion {
  const filas: FilaRecuperacion[] = [], avisos: string[] = [];
  let periodo: string | null = null, oficina: string | null = null;
  let col: Record<string, number> = {};
  for (const r of matriz) {
    if (!Array.isArray(r) || !r.length) continue;
    const a = limpio(r[0]);
    const m = a.match(/^([A-Z]+)[- ](\d{4})$/);
    if (m && MESES.includes(m[1] === "SETIEMBRE" ? "SEPTIEMBRE" : m[1])) {
      periodo = `${m[2]}-${String(MESES.indexOf(m[1] === "SETIEMBRE" ? "SEPTIEMBRE" : m[1]) + 1).padStart(2, "0")}`; oficina = null; continue;
    }
    if (a === "OFICINA") {
      col = {}; r.forEach((c, i) => { col[limpio(c)] = i; }); continue;
    }
    if (!periodo || !a || a.startsWith("TOTAL")) continue;
    if (a === "VIGENTE" || a === "VENCIDO") {
      if (!oficina) continue;
      const v = (k: string) => (col[k] === undefined ? 0 : numero(r[col[k]]));
      filas.push({
        oficina, periodo, tipo: a, operaciones: v("N° OPERACIONES") || v("N OPERACIONES"), saldo: v("SALDO PRESTAMO"), capital: v("CAPITAL"),
        castigado: v("CASTIGADO"), recuperado: v("RECUPERADO"), precancelados: v("PRECANCELADOS"), refinanciado: v("REFIN-REEST-NOV"),
        neto: v("VALOR NETO RECUPERADO"),
      });
      continue;
    }
    const of = normalizarOficina(String(r[0]));
    if (of) oficina = of; else { oficina = null; avisos.push(`Oficina no reconocida: ${String(r[0])}`); }
  }
  return { filas, periodos: [...new Set(filas.map((f) => f.periodo))].sort(), oficinas: [...new Set(filas.map((f) => f.oficina))].sort(), avisos: [...new Set(avisos)] };
}
