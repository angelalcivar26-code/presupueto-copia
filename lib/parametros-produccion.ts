import { getDb } from "./turso";

/**
 * Datos de producción que no salen del balance (Cartera → Metas → Producción):
 *  - operaciones_iniciales : N° de créditos vigentes de la línea al corte (reporte del sistema)
 *  - creditos_por_oficial  : cuántos créditos administra un oficial en esa línea
 * Una fila por agencia y línea.
 */
type Db = ReturnType<typeof getDb>;
export type LineaProduccion = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";
export const LINEAS_PRODUCCION: LineaProduccion[] = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"];
interface ParametroProduccion { operacionesIniciales: number; creditosPorOficial: number }

let tablaLista = false;
export async function asegurarTablaProduccion(db: Db) {
  if (tablaLista) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS parametros_produccion (
    agencia_id            INTEGER NOT NULL REFERENCES agencias(id),
    linea                 TEXT    NOT NULL,
    operaciones_iniciales REAL    NOT NULL DEFAULT 0,
    creditos_por_oficial  REAL    NOT NULL DEFAULT 0,
    actualizado_en        TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agencia_id, linea)
  )`);
  tablaLista = true;
}

export async function leerParametrosProduccion(db: Db, agenciaId: number): Promise<Record<LineaProduccion, ParametroProduccion>> {
  const out = Object.fromEntries(LINEAS_PRODUCCION.map((l) => [l, { operacionesIniciales: 0, creditosPorOficial: 0 }])) as Record<LineaProduccion, ParametroProduccion>;
  await asegurarTablaProduccion(db);
  const res = await db.execute({ sql: `SELECT linea, operaciones_iniciales, creditos_por_oficial FROM parametros_produccion WHERE agencia_id = ?`, args: [agenciaId] });
  for (const r of res.rows) {
    const l = r.linea as LineaProduccion;
    if (out[l]) out[l] = { operacionesIniciales: Number(r.operaciones_iniciales) || 0, creditosPorOficial: Number(r.creditos_por_oficial) || 0 };
  }
  return out;
}