/**
 * Lectores de los reportes del sistema para el modelo de provisión (se usan en el navegador con XLSX,
 * pasando la hoja como matriz de celdas: XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true })).
 *
 * 1) CalificacionCartera_Report.xlsx (una hoja, sin tabla estructurada):
 *    - "Fecha Corte :" en la columna A y la fecha en la C.
 *    - "Oficina: <NOMBRE>" en la columna B abre el bloque de una agencia.
 *    - Detalle: H = calificación (A1…E, con espacios), I = saldo, L = % provisión, M = valor provisión,
 *      N = tipo (p. ej. MICROCREDITO REFINANCIADO), F/G = rango de días. Se ignoran TOTAL y encabezados.
 * 2) Estado de resultados (EstadoPerdidasGananciasReport): valores ACUMULADOS en el año.
 *    - Formato 2026: código con puntos en A (4.4.02.20), valor en I, "Fecha:" en F con la fecha en H.
 *    - Formato 2024–2025: código sin puntos en C, valor en E.
 */
import type { FilaCalificacion } from "./provision-flow-db";

type Celda = string | number | boolean | Date | null | undefined;
const texto = (v: Celda) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v));
const num = (v: Celda) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0);

/** Fecha de una celda (Date, número de serie de Excel o texto dd-mm-aaaa / dd/mm/aaaa / aaaa-mm-dd) → aaaa-mm-dd. */
function fechaDeCelda(v: Celda): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = texto(v).trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export interface ResultadoCalificacion { corte: string; periodo: string; filas: FilaCalificacion[]; oficinas: string[]; saldoTotal: number; provTotal: number }

export function parsearCalificacion(m: Celda[][]): ResultadoCalificacion {
  let corte: string | null = null;
  let oficina: string | null = null;
  const filas: FilaCalificacion[] = [];
  for (const fila of m) {
    if (!fila) continue;
    const a = texto(fila[0]).trim(), b = texto(fila[1]).trim();
    if (/^fecha\s*corte/i.test(a)) { corte = fechaDeCelda(fila[2]) ?? corte; continue; }
    if (/^oficina\s*:/i.test(b)) { oficina = b.split(":").slice(1).join(":").trim(); continue; }
    const cat = texto(fila[7]).trim().toUpperCase();
    const tipo = texto(fila[13]).trim();
    if (!oficina || !/^(A[1-3]|B[12]|C[12]|D|E)$/.test(cat) || !tipo || /^total/i.test(b)) continue;
    if (typeof fila[8] !== "number" && isNaN(Number(fila[8]))) continue;
    filas.push({
      periodo: "", corte: "", oficina, tipo, cat,
      desde: fila[5] === undefined || fila[5] === null || fila[5] === "" ? null : num(fila[5]),
      hasta: fila[6] === undefined || fila[6] === null || fila[6] === "" ? null : num(fila[6]),
      saldo: num(fila[8]), pct: fila[11] === undefined || fila[11] === null ? null : num(fila[11]), prov: num(fila[12]),
    });
  }
  if (!corte) throw new Error("No se encontró la fecha de corte (\"Fecha Corte :\" en la columna A).");
  if (!filas.length) throw new Error("No se encontraron filas de calificación (columna H con A1…E).");
  const periodo = corte.slice(0, 7);
  for (const f of filas) { f.periodo = periodo; f.corte = corte; }
  return {
    corte, periodo, filas, oficinas: [...new Set(filas.map((f) => f.oficina))],
    saldoTotal: filas.reduce((t, f) => t + f.saldo, 0), provTotal: filas.reduce((t, f) => t + f.prov, 0),
  };
}

export interface ResultadoEERR { fecha: string; periodo: string; formato: "2026" | "2024-2025"; acumulado: { g4402: number; r560410: number; r560405: number } }

/** Lee del estado de resultados los acumulados del año de 4402, 5604.10 y 5604.05. */
export function parsearEERR(m: Celda[][]): ResultadoEERR {
  let fecha: string | null = null;
  // Fecha: celda "Fecha:" y la fecha a su derecha (formato 2026: F y H)
  for (const fila of m.slice(0, 15)) {
    if (!fila) continue;
    fila.forEach((c, i) => {
      if (!fecha && /^fecha\s*:?$/i.test(texto(c).trim())) {
        for (let j = i + 1; j < fila.length; j++) { const f = fechaDeCelda(fila[j]); if (f) { fecha = f; break; } }
      }
    });
  }
  const conPuntos = m.some((f) => f && /^\d+(\.\d+)+$/.test(texto(f[0]).trim()));
  const formato: ResultadoEERR["formato"] = conPuntos ? "2026" : "2024-2025";
  const valores = new Map<string, number>();
  for (const f of m) {
    if (!f) continue;
    const cod = (conPuntos ? texto(f[0]) : texto(f[2])).trim().replace(/\./g, "");
    if (!/^\d+$/.test(cod)) continue;
    const v = conPuntos ? f[8] : f[4];
    if (v === null || v === undefined || v === "") continue;
    if (!valores.has(cod)) valores.set(cod, num(v));
  }
  if (!fecha) throw new Error("No se encontró la fecha del estado de resultados (\"Fecha:\").");
  return {
    fecha, periodo: (fecha as string).slice(0, 7), formato,
    acumulado: { g4402: valores.get("4402") ?? 0, r560410: valores.get("560410") ?? 0, r560405: valores.get("560405") ?? 0 },
  };
}
