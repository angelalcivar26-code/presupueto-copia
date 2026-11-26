import { getDb } from "./turso";

/**
 * PARÁMETROS INSTITUCIONALES POR EJERCICIO (antes fijos en el código).
 * Cada ejercicio tiene los suyos; sin valor guardado se usa el valor de siempre. Va por getDb:
 * un cambio recalcula el presupuesto y queda en la bitácora.
 */
interface DefParametro { clave: string; nombre: string; unidad: "usd" | "pct"; defecto: number; fuente: string; afecta: string; min: number; max: number }

export const PARAMETROS_INSTITUCIONALES: DefParametro[] = [
  { clave: "sbu", nombre: "Salario básico unificado", unidad: "usd", defecto: 482, fuente: "Acuerdo ministerial (Ministerio del Trabajo)", afecta: "Décimo cuarto sueldo · Nómina (4501)", min: 1, max: 5000 },
  { clave: "iess_patronal", nombre: "Aporte patronal al IESS", unidad: "pct", defecto: 0.1215, fuente: "Ley de Seguridad Social", afecta: "Nómina (4501)", min: 0, max: 0.5 },
  { clave: "fondo_reserva", nombre: "Fondo de reserva", unidad: "pct", defecto: 0.0833, fuente: "Código del Trabajo", afecta: "Nómina (4501)", min: 0, max: 0.5 },
  { clave: "fondo_liquidez_pct", nombre: "Aporte al fondo de liquidez", unidad: "pct", defecto: 0.059, fuente: "Junta de Política y Regulación Financiera", afecta: "Derechos fiduciarios (1902) · Flujo de efectivo", min: 0, max: 0.5 },
  { clave: "fondo_liquidez_meta", nombre: "Meta del fondo de liquidez", unidad: "pct", defecto: 0.075, fuente: "Política interna", afecta: "Indicador de Otros activos", min: 0, max: 0.5 },
];

let tabla: Promise<void> | null = null;
function asegurar(): Promise<void> {
  tabla ??= getDb().execute(`CREATE TABLE IF NOT EXISTS parametros_institucionales (
      ejercicio INTEGER NOT NULL, clave TEXT NOT NULL, valor REAL NOT NULL, actualizado_en TEXT,
      PRIMARY KEY (ejercicio, clave))`).then(() => undefined).catch((e) => { tabla = null; throw e; });
  return tabla;
}

/** Valores del ejercicio (los no guardados, con su valor de siempre). */
export async function leerParametrosInstitucionales(ejercicio: number): Promise<Record<string, { valor: number; guardado: boolean }>> {
  await asegurar();
  const r = await getDb().execute({ sql: `SELECT clave, valor FROM parametros_institucionales WHERE ejercicio = ?`, args: [ejercicio] });
  const g = new Map(r.rows.map((x) => [String(x.clave), Number(x.valor)]));
  return Object.fromEntries(PARAMETROS_INSTITUCIONALES.map((p) => [p.clave, { valor: g.get(p.clave) ?? p.defecto, guardado: g.has(p.clave) }]));
}

export async function guardarParametrosInstitucionales(ejercicio: number, valores: Record<string, number>): Promise<void> {
  await asegurar();
  const stmts = Object.entries(valores).map(([clave, valor]) => ({
    sql: `INSERT INTO parametros_institucionales (ejercicio, clave, valor, actualizado_en) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(ejercicio, clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    args: [ejercicio, clave, valor],
  }));
  if (stmts.length) await getDb().batch(stmts, "write");
}
