import { getDb } from "./turso";
import type { ParametrosInversiones, TituloInversion } from "./calc/inversiones";

/**
 * Registro de inversiones (cuenta 13) por agencia y sus parámetros.
 *  - inversiones            : una fila por título (vigente al corte o planificada)
 *  - inversiones_parametros : % de retención sobre el interés y base de días, por agencia
 * Las tablas se crean solas la primera vez.
 */
type Db = ReturnType<typeof getDb>;
let listas = false;

export async function asegurarTablasInversiones(db: Db) {
  if (listas) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS inversiones (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      agencia_id     INTEGER NOT NULL REFERENCES agencias(id),
      institucion    TEXT    NOT NULL,
      sector         TEXT    NOT NULL,
      cuenta_codigo  TEXT    NOT NULL,
      cuenta_nombre  TEXT    NOT NULL DEFAULT '',
      fecha_inicio   TEXT    NOT NULL,
      fecha_fin      TEXT    NOT NULL,
      monto          REAL    NOT NULL,
      tasa_anual     REAL    NOT NULL,       -- en %, ej. 5.25
      cancela_mes    INTEGER,                -- 1..12 del ejercicio; NULL = se renueva siempre
      actualizado_en TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS inversiones_parametros (
      agencia_id     INTEGER PRIMARY KEY REFERENCES agencias(id),
      pct_retencion  REAL    NOT NULL DEFAULT 1,     -- en %, sobre el interés
      base_dias      INTEGER NOT NULL DEFAULT 360,
      actualizado_en TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
  ], "write");
  listas = true;
}

export async function leerInversiones(db: Db, agenciaId: number): Promise<{ titulos: TituloInversion[]; parametros: ParametrosInversiones; guardados: boolean }> {
  await asegurarTablasInversiones(db);
  const [t, p] = await Promise.all([
    db.execute({ sql: `SELECT * FROM inversiones WHERE agencia_id = ? ORDER BY fecha_inicio, id`, args: [agenciaId] }),
    db.execute({ sql: `SELECT pct_retencion, base_dias FROM inversiones_parametros WHERE agencia_id = ?`, args: [agenciaId] }),
  ]);
  const titulos: TituloInversion[] = t.rows.map((r) => ({
    id: Number(r.id), institucion: String(r.institucion), sector: String(r.sector),
    cuentaCodigo: String(r.cuenta_codigo), cuentaNombre: String(r.cuenta_nombre ?? ""),
    fechaInicio: String(r.fecha_inicio), fechaFin: String(r.fecha_fin),
    monto: Number(r.monto) || 0, tasaAnual: (Number(r.tasa_anual) || 0) / 100,
    cancelaMes: r.cancela_mes === null || r.cancela_mes === undefined ? null : Number(r.cancela_mes),
  }));
  const fila = p.rows[0];
  return {
    titulos,
    parametros: { pctRetencion: fila ? Number(fila.pct_retencion) / 100 : 0.01, baseDias: fila ? Number(fila.base_dias) : 360 },
    guardados: !!fila,
  };
}