import { NextResponse } from "next/server";
import { AGENCIAS_CONSOLIDADO } from "./consolidado";

/**
 * VALIDACIÓN DE LO QUE LLEGA A LAS RUTAS DE GUARDADO.
 *
 * Segunda barrera, aunque la pantalla ya valide: un monto que no es número, una agencia que falta
 * o «Consolidado» se rechazan con 400 y un mensaje claro, en lugar de guardarse como 0, ir a Matriz
 * o terminar en un error 500. No consulta la base (no consume lecturas).
 *
 *   try { const ag = agenciaParaGuardar(body.agencia); const v = monto(body.monto, "Monto"); … }
 *   catch (e) { const r = respuestaEntrada(e); if (r) return r; … }
 */
export class ErrorEntrada extends Error {}

/** Si el error es de datos de entrada, la respuesta 400 con su mensaje; si no, null. */
export function respuestaEntrada(e: unknown): NextResponse | null {
  return e instanceof ErrorEntrada ? NextResponse.json({ error: e.message }, { status: 400 }) : null;
}

/** La agencia de un guardado: obligatoria, una de las 10 (nunca Consolidado, que es solo lectura). */
export function agenciaParaGuardar(nombre: unknown): string {
  const n = typeof nombre === "string" ? nombre.trim() : "";
  if (!n) throw new ErrorEntrada("Falta la agencia: elija una agencia antes de guardar.");
  if (n === "Consolidado") throw new ErrorEntrada("El Consolidado es solo de consulta: elija una agencia para guardar.");
  if (!AGENCIAS_CONSOLIDADO.includes(n)) throw new ErrorEntrada(`La agencia «${n}» no existe.`);
  return n;
}

interface Rango { min?: number; max?: number; enteros?: boolean; vacioCero?: boolean }

/** Un monto numérico finito dentro del rango; texto, NaN o Infinity se rechazan. */
export function monto(v: unknown, campo: string, r: Rango = {}): number {
  if ((v === null || v === undefined || v === "") && r.vacioCero) return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ErrorEntrada(`${campo}: el valor «${String(v)}» no es un número.`);
  if (r.enteros && !Number.isInteger(n)) throw new ErrorEntrada(`${campo}: debe ser un número entero.`);
  if (r.min !== undefined && n < r.min) throw new ErrorEntrada(`${campo}: no puede ser menor que ${r.min.toLocaleString("es-EC")}.`);
  if (r.max !== undefined && n > r.max) throw new ErrorEntrada(`${campo}: no puede ser mayor que ${r.max.toLocaleString("es-EC")}.`);
  return n;
}

const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Los 12 meses (null = mes sin dato, se respeta); cada valor con las mismas reglas de monto(). */
export function meses(v: unknown, campo: string, r: Rango = {}, permitirNulos = false): (number | null)[] {
  if (!Array.isArray(v)) throw new ErrorEntrada(`${campo}: faltan los montos por mes.`);
  if (v.length > 12) throw new ErrorEntrada(`${campo}: hay más de 12 meses.`);
  return v.map((x, i) => (permitirNulos && (x === null || x === undefined) ? null : monto(x, `${campo} (${MES[i] ?? `mes ${i + 1}`})`, r)));
}

/** Mes 1..12. */
export function mes(v: unknown): number {
  return monto(v, "Mes", { min: 1, max: 12, enteros: true });
}

/** Igual que monto(), pero null/undefined se respetan como «sin dato». */
export function montoOpcional(v: unknown, campo: string, r: Rango = {}): number | null {
  return v === null || v === undefined ? null : monto(v, campo, r);
}
