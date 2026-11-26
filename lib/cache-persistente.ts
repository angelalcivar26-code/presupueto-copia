import { createClient, type Client } from "@libsql/client";

/**
 * Resultados ya calculados, guardados en Turso (tabla cache_resultados).
 *
 * Así el cálculo pesado (orquestador con los 8 motores) se hace UNA vez por agencia y versión de datos:
 * el resto de usuarios, y el mismo servidor después de reiniciarse, leen una sola fila.
 * La versión es la de datos_version: cualquier guardado la sube y lo anterior deja de usarse.
 *
 * Usa su propia conexión, sin pasar por lib/turso.ts, para que guardar aquí NO cuente como
 * "cambio de datos" (si contara, subiría la versión y se borraría todo lo calculado).
 */
export interface RespuestaGuardada { status: number; body: string; tipo: string }

let cliente: Client | null = null;
function conexion(): Client {
  if (!cliente) {
    cliente = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return cliente;
}

let tabla: Promise<void> | null = null;
function asegurarTabla(): Promise<void> {
  tabla ??= conexion().execute(`
    CREATE TABLE IF NOT EXISTS cache_resultados (
      clave TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      estado INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      cuerpo TEXT NOT NULL,
      actualizado TEXT NOT NULL DEFAULT (datetime('now'))
    )`).then(() => undefined).catch((e) => { tabla = null; throw e; });
  return tabla;
}

/** Resultado guardado para esta dirección y versión de datos, o null si no hay. Lee 1 fila. */
export async function leerGuardado(clave: string, version: number): Promise<RespuestaGuardada | null> {
  await asegurarTabla();
  const r = await conexion().execute({
    sql: "SELECT estado, tipo, cuerpo FROM cache_resultados WHERE clave = ? AND version = ?",
    args: [clave, version],
  });
  const f = r.rows[0];
  if (!f) return null;
  return { status: Number(f.estado), tipo: String(f.tipo), body: String(f.cuerpo) };
}

/** Borra (una vez por servidor) los resultados guardados por versiones anteriores del programa. */
let limpiado = false;
export async function limpiarOtrasVersiones(prefijoActual: string): Promise<void> {
  if (limpiado) return;
  limpiado = true;
  await asegurarTabla();
  await conexion().execute({ sql: "DELETE FROM cache_resultados WHERE clave NOT LIKE ?", args: [`${prefijoActual}%`] });
}

/** Guarda (o reemplaza) el resultado de una dirección. Una fila por dirección: la tabla no crece. */
export async function guardarResultado(clave: string, version: number, r: RespuestaGuardada): Promise<void> {
  await asegurarTabla();
  await conexion().execute({
    sql: `INSERT INTO cache_resultados (clave, version, estado, tipo, cuerpo, actualizado)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(clave) DO UPDATE SET version = excluded.version, estado = excluded.estado,
            tipo = excluded.tipo, cuerpo = excluded.cuerpo, actualizado = excluded.actualizado
          WHERE excluded.version >= cache_resultados.version`,
    args: [clave, version, r.status, r.tipo, r.body],
  });
}