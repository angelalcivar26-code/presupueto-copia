import { getDb } from "./turso";
import { listarAgencias } from "./agencias";
import { DIAS_COBERTURA_DEFECTO, PCT_ENCAJE_DEFECTO } from "./calc/fondos";

/**
 * Parámetros de Fondos disponibles (todo vive en la base de datos):
 *  - parametros_fondos_agencia      : por agencia, monto máximo de cajeros y de caja fuerte.
 *  - parametros_fondos_institucional: días hábiles de pagos que deben quedar en bancos y % de encaje BCE
 *                                     (en %, ej. 3.5; lo usan el Flujo y la 1102).
 */
type Db = ReturnType<typeof getDb>;

let tablasListas = false;
async function asegurarTablasFondos(db: Db) {
  if (tablasListas) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS parametros_fondos_agencia (
      agencia_id      INTEGER PRIMARY KEY REFERENCES agencias(id),
      max_cajero      REAL    NOT NULL DEFAULT 0,
      max_caja_fuerte REAL    NOT NULL DEFAULT 0,
      actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS parametros_fondos_institucional (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      dias_cobertura  REAL    NOT NULL DEFAULT ${DIAS_COBERTURA_DEFECTO},
      actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
  ], "write");
  try { await db.execute(`ALTER TABLE parametros_fondos_institucional ADD COLUMN pct_encaje REAL NOT NULL DEFAULT ${PCT_ENCAJE_DEFECTO * 100}`); } catch { /* ya existe */ }
  tablasListas = true;
}

const pctEncajeFila = (r: Record<string, unknown> | undefined) => {
  const v = r ? Number(r.pct_encaje) : NaN;
  return Number.isFinite(v) && v >= 0 ? v / 100 : PCT_ENCAJE_DEFECTO;
};

export async function leerParametrosFondosAgencia(db: Db, agenciaId: number): Promise<{ maxCajero: number; maxCajaFuerte: number; diasCobertura: number; pctEncaje: number; guardado: boolean }> {
  await asegurarTablasFondos(db);
  const [a, i] = await Promise.all([
    db.execute({ sql: `SELECT max_cajero, max_caja_fuerte FROM parametros_fondos_agencia WHERE agencia_id = ?`, args: [agenciaId] }),
    db.execute(`SELECT dias_cobertura, pct_encaje FROM parametros_fondos_institucional WHERE id = 1`),
  ]);
  const r = a.rows[0];
  return {
    maxCajero: r ? Number(r.max_cajero) || 0 : 0,
    maxCajaFuerte: r ? Number(r.max_caja_fuerte) || 0 : 0,
    diasCobertura: i.rows[0] ? Number(i.rows[0].dias_cobertura) : DIAS_COBERTURA_DEFECTO,
    pctEncaje: pctEncajeFila(i.rows[0] as Record<string, unknown> | undefined),
    guardado: !!r,
  };
}

interface FilaParametrosFondos {
  agenciaId: number; agencia: string;
  maxCajero: number; maxCajaFuerte: number; guardado: boolean;
  cajaCorte: number | null; corte: { anio: number; mes: number } | null;
}

/** Las 10 agencias con sus límites y la caja (1101) de su balance más reciente. */
export async function listarParametrosFondos(db: Db): Promise<{ agencias: FilaParametrosFondos[]; diasCobertura: number; pctEncaje: number }> {
  await asegurarTablasFondos(db);
  const agencias = await listarAgencias(db);
  const [params, inst, cajas] = await Promise.all([
    db.execute(`SELECT agencia_id, max_cajero, max_caja_fuerte FROM parametros_fondos_agencia`),
    db.execute(`SELECT dias_cobertura, pct_encaje FROM parametros_fondos_institucional WHERE id = 1`),
    db.execute(`SELECT c.agencia_id, c.anio, c.mes, COALESCE(s.monto, 0) AS caja
                FROM saldos_cargas c
                LEFT JOIN saldos_iniciales s ON s.agencia_id = c.agencia_id AND s.anio = c.anio AND s.mes = c.mes AND s.cuenta_codigo = '1101'
                WHERE NOT EXISTS (SELECT 1 FROM saldos_cargas c2 WHERE c2.agencia_id = c.agencia_id AND (c2.anio > c.anio OR (c2.anio = c.anio AND c2.mes > c.mes)))`),
  ]);
  const porAg = new Map(params.rows.map((r) => [Number(r.agencia_id), r]));
  const cajaPorAg = new Map(cajas.rows.map((r) => [Number(r.agencia_id), r]));
  return {
    diasCobertura: inst.rows[0] ? Number(inst.rows[0].dias_cobertura) : DIAS_COBERTURA_DEFECTO,
    pctEncaje: pctEncajeFila(inst.rows[0] as Record<string, unknown> | undefined) * 100,
    agencias: agencias.map((a) => {
      const p = porAg.get(Number(a.id));
      const c = cajaPorAg.get(Number(a.id));
      return {
        agenciaId: Number(a.id), agencia: String(a.nombre),
        maxCajero: p ? Number(p.max_cajero) || 0 : 0,
        maxCajaFuerte: p ? Number(p.max_caja_fuerte) || 0 : 0,
        guardado: !!p,
        cajaCorte: c ? Number(c.caja) || 0 : null,
        corte: c ? { anio: Number(c.anio), mes: Number(c.mes) } : null,
      };
    }),
  };
}

export async function guardarParametrosFondos(db: Db, entrada: { agencias: { agenciaId: number; maxCajero: number; maxCajaFuerte: number }[]; diasCobertura: number; pctEncaje: number }) {
  await asegurarTablasFondos(db);
  const stmts: { sql: string; args: (number | string)[] }[] = entrada.agencias.map((a) => ({
    sql: `INSERT INTO parametros_fondos_agencia (agencia_id, max_cajero, max_caja_fuerte, actualizado_en) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(agencia_id) DO UPDATE SET max_cajero = excluded.max_cajero, max_caja_fuerte = excluded.max_caja_fuerte, actualizado_en = excluded.actualizado_en`,
    args: [a.agenciaId, a.maxCajero, a.maxCajaFuerte],
  }));
  stmts.push({
    sql: `INSERT INTO parametros_fondos_institucional (id, dias_cobertura, pct_encaje, actualizado_en) VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET dias_cobertura = excluded.dias_cobertura, pct_encaje = excluded.pct_encaje, actualizado_en = excluded.actualizado_en`,
    args: [entrada.diasCobertura, entrada.pctEncaje],
  });
  await db.batch(stmts, "write");
}
