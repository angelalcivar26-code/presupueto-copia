/**
 * Lectura de balances y estados de resultados históricos por agencia (archivos mensuales del sistema contable).
 *
 * Dos formatos:
 *  - Nuevo (2026): encabezado "COAC. ONCE DE JUNIO LTDA", fila "Oficina: X  Fecha: dd-mm-aaaa" y columnas
 *    Código (1.1.01.05) | Cuenta | Saldo. El tipo sale del título (situación financiera / resultados).
 *  - Antiguo (2023–2025): filas AGENCIA | FECHA (serial Excel) | CODIGO | CUENTA COMPLETA | SALDO, con o sin
 *    fila de encabezado. Algunos archivos traen el código corrido una fila: se usa el número del inicio del
 *    nombre ("4101 Obligaciones…") cuando existe.
 *
 * El período y la oficina se toman del CONTENIDO, no del nombre del archivo. Los totales 4 y 5 (y 1, 2, 3) se
 * recalculan desde sus cuentas de 2 dígitos, porque algunos archivos traen el total mal.
 * Se guardan todas las cuentas con todos sus dígitos. También se leen las cuentas contingentes y de orden (6 y 7),
 * que vienen en un reporte aparte del sistema.
 */
import { completarPadres } from "./cuentas-niveles";
export type TipoHistorico = "BAL" | "ER" | "CO";
export interface ArchivoHistorico { oficina: string; periodo: string; tipo: TipoHistorico; cuentas: Record<string, number> }

/** Nombre de la oficina tal como se usa en la herramienta. */
const OFICINAS: Record<string, string> = {
  MATRIZ: "Matriz", MATRI: "Matriz", "EL GUABO": "El Guabo", GUABO: "El Guabo", PINAS: "Piñas",
  "MACHALA II": "Machala II", "PONCE ENRIQUEZ": "Ponce Enríquez", BALSAS: "Balsas", "SANTA ROSA": "Santa Rosa",
  "LAS LAJAS": "Las Lajas", NARANJAL: "Naranjal", CATAMAYO: "Catamayo", CONSOLIDADO: "Consolidado",
};
export function normalizarOficina(nombre: string): string | null {
  const k = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Ñ|ñ/g, "N").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  return OFICINAS[k] ?? null;
}


export function numero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim(); if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\s$-]/g, "");
  // 15.087.344,24 → 15087344.24 ; 1234.5 → 1234.5
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

function fechaDe(v: unknown): { y: number; m: number } | null {
  if (v instanceof Date && !isNaN(v.getTime())) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1 };
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return { y: Number(m[3]), m: Number(m[2]) };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return { y: Number(m[1]), m: Number(m[2]) };
  return null;
}
const periodoDe = (f: { y: number; m: number }) => `${f.y}-${String(f.m).padStart(2, "0")}`;

/** Se guardan todas las cuentas del archivo, con todos sus dígitos (hasta 8 en el plan de cuentas actual). */
function guardable(codigo: string) { return codigo.length >= 1 && codigo.length <= 12; }

/** Recalcula 1..5 desde sus cuentas de 2 dígitos (cuando las hay). */
function corregirTotales(c: Record<string, number>) {
  for (const top of ["1", "2", "3", "4", "5", "6", "7"]) {
    const hijos = Object.keys(c).filter((k) => k.length === 2 && k[0] === top);
    if (hijos.length) c[top] = hijos.reduce((t, k) => t + c[k], 0);
  }
}

export function parsearHistorico(filas: unknown[][], nombreArchivo = ""): ArchivoHistorico | { error: string } {
  const limpias = filas.map((f) => (Array.isArray(f) ? f : []));
  const texto = (f: unknown[]) => f.map((c) => String(c ?? "")).join(" ").toUpperCase();
  const cabecera = limpias.slice(0, 12).map(texto).join(" ");

  // ---------- Formato nuevo ----------
  if (cabecera.includes("COAC") && cabecera.includes("OFICINA")) {
    let tipo: TipoHistorico | null = /CUENTAS DE ORDEN|CONTINGENTE/.test(cabecera) ? "CO"
      : /SITUACI[OÓ]N FINANCIERA|BALANCE/.test(cabecera) ? "BAL" : /RESULTADOS|P[EÉ]RDIDAS/.test(cabecera) ? "ER" : null;
    let oficina: string | null = null; let fecha: { y: number; m: number } | null = null;
    const cuentas: Record<string, number> = {};
    for (const f of limpias) {
      const celdas = f.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
      if (!celdas.length) continue;
      if (String(celdas[0]).trim().toUpperCase().startsWith("OFICINA:")) {
        oficina = normalizarOficina(String(celdas[1] ?? ""));
        const j = celdas.findIndex((c) => String(c).trim().toUpperCase().startsWith("FECHA"));
        if (j >= 0) fecha = fechaDe(celdas[j + 1]);
        continue;
      }
      const cod = String(celdas[0]).trim();
      if (!/^\d+(\.\d+)*$/.test(cod) || celdas.length < 3) continue;
      const codigo = cod.replace(/\./g, "");
      if (guardable(codigo)) cuentas[codigo] = numero(celdas[celdas.length - 1]);
    }
    // un archivo con solo cuentas 6 y 7 es de cuentas contingentes y de orden, diga lo que diga el título
    const primerosN = new Set(Object.keys(cuentas).map((k) => k[0]));
    if (primerosN.size && [...primerosN].every((d) => d === "6" || d === "7")) tipo = "CO";
    if (!tipo) return { error: `${nombreArchivo}: no se reconoce si es balance, estado de resultados o cuentas de orden.` };
    if (!oficina) return { error: `${nombreArchivo}: oficina no reconocida.` };
    if (!fecha) return { error: `${nombreArchivo}: no trae la fecha.` };
    corregirTotales(cuentas);
    return { oficina, periodo: periodoDe(fecha), tipo, cuentas: completarPadres(cuentas).cuentas };
  }

  // ---------- Formato antiguo ----------
  let oficina: string | null = null; let fecha: { y: number; m: number } | null = null;
  const cuentas: Record<string, number> = {};
  for (const f of limpias) {
    if (f.length < 5) continue;
    const fe = fechaDe(f[1]); if (!fe) continue; // encabezado u otras filas
    const of = normalizarOficina(String(f[0] ?? "")); if (!of) continue;
    oficina = of; fecha = fe;
    const nombre = String(f[3] ?? "");
    const m = nombre.match(/^\s*(\d+)\s/);
    const crudo = String(f[2] ?? "").trim();
    const codigo = m ? m[1] : /^\d+$/.test(crudo) ? crudo : ""; // "5-4" (utilidad) y otras filas de texto se omiten
    if (!codigo || !guardable(codigo)) continue;
    cuentas[codigo] = numero(f[4]);
  }
  if (!oficina || !fecha) return { error: `${nombreArchivo}: formato no reconocido.` };
  const primeros = new Set(Object.keys(cuentas).map((k) => k[0]));
  const tipo: TipoHistorico = [...primeros].every((d) => d === "6" || d === "7") ? "CO" : primeros.has("4") || primeros.has("5") ? "ER" : "BAL";
  corregirTotales(cuentas);
  return { oficina, periodo: periodoDe(fecha), tipo, cuentas: completarPadres(cuentas).cuentas };
}

/**
 * Lo que se sube en Carga de datos → Balance general (saldos iniciales) también queda como histórico de ese mes:
 * las cuentas 1–3 como balance y, si el archivo las trae, las 4–5 como estado de resultados.
 */
export function historicoDesdeFilas(oficina: string, anio: number, mes: number, filas: { codigo: string; saldo: number }[]): ArchivoHistorico[] {
  const periodo = `${anio}-${String(mes).padStart(2, "0")}`;
  const bal: Record<string, number> = {}; const er: Record<string, number> = {};
  for (const f of filas) {
    const codigo = String(f.codigo).replace(/\D/g, "");
    if (!codigo || !guardable(codigo) || !Number.isFinite(f.saldo)) continue;
    if (/^[123]/.test(codigo)) bal[codigo] = f.saldo; else if (/^[45]/.test(codigo)) er[codigo] = f.saldo;
  }
  const out: ArchivoHistorico[] = [];
  if (Object.keys(bal).length) { corregirTotales(bal); out.push({ oficina, periodo, tipo: "BAL", cuentas: completarPadres(bal).cuentas }); }
  if (Object.keys(er).length) { corregirTotales(er); out.push({ oficina, periodo, tipo: "ER", cuentas: completarPadres(er).cuentas }); }
  return out;
}
