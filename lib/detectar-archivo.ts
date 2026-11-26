/**
 * ¿Qué archivo es? Cuando un archivo no corresponde a la pestaña de Carga de datos donde se subió, se reconoce por su
 * contenido (no por su nombre) para indicar en qué pestaña va. No se guarda nada: solo arma el mensaje.
 */
import * as XLSX from "xlsx";
import { parsearHistorico } from "./historico-parser";
import { parsearCalificacion } from "./provision-parsers";
import { parsearRecuperacion } from "./recuperacion-parser";
import { parsearActivosFijos } from "./activos-fijos-parser";
import { leerArchivoDiferidos } from "./calc/diferidos-archivo";

export type PestanaCarga = "Balances" | "Estados de resultados" | "Cuentas de orden" | "Activos fijos" | "Calificación de cartera" | "Recuperación de cartera" | "Activos diferidos";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const txtPer = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(0, 4)}`;

/** Primera hoja como arreglo de filas; con fechas como Date o como vienen. */
export function matrizDe(datos: ArrayBuffer, fechas = false): unknown[][] {
  const wb = XLSX.read(datos, { type: "array", cellDates: fechas });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
}

/** Descripción y pestaña del archivo, o null si no se reconoce. */
export function queArchivoEs(datos: ArrayBuffer): { pestana: PestanaCarga; detalle: string } | null {
  let crudo: unknown[][], conFechas: unknown[][];
  try { crudo = matrizDe(datos); conFechas = matrizDe(datos, true); } catch { return null; }
  const h = parsearHistorico(crudo);
  if (!("error" in h)) {
    const p: PestanaCarga = h.tipo === "BAL" ? "Balances" : h.tipo === "ER" ? "Estados de resultados" : "Cuentas de orden";
    const uno = h.tipo === "BAL" ? "un balance" : h.tipo === "ER" ? "un estado de resultados" : "el archivo de cuentas de orden";
    return { pestana: p, detalle: `${uno} de ${h.oficina} (${txtPer(h.periodo)})` };
  }
  try { const c = parsearCalificacion(conFechas as never); if (c.filas.length) return { pestana: "Calificación de cartera", detalle: `la calificación de cartera con corte ${c.corte}` }; } catch { /* no es */ }
  try { const r = parsearRecuperacion(crudo); if (r.filas.length) return { pestana: "Recuperación de cartera", detalle: "el reporte de recuperación de cartera" }; } catch { /* no es */ }
  try { const a = parsearActivosFijos(crudo); if (a.bienes.length && a.fechaCorte) return { pestana: "Activos fijos", detalle: "el reporte de depreciación de activos fijos" }; } catch { /* no es */ }
  try { const d = leerArchivoDiferidos(conFechas, "2000-01-31"); if (!d.faltan.length) return { pestana: "Activos diferidos", detalle: "el reporte de amortización de activos diferidos" }; } catch { /* no es */ }
  return null;
}

/** Mensaje para un archivo que no se pudo leer en la pestaña `aqui`. */
export function mensajeOtraPestana(nombre: string, datos: ArrayBuffer, aqui: PestanaCarga, error: string): string {
  const q = queArchivoEs(datos);
  if (q && q.pestana !== aqui) return `${nombre}: es ${q.detalle}; súbalo en la pestaña ${q.pestana}.`;
  return `${nombre}: ${error}`;
}
