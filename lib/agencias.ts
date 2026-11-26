import type { Client } from "@libsql/client";

/**
 * Las 10 agencias reales de COAC Once de Junio para el Presupuesto 2027.
 * NO incluye "Consolidado" — ese es un cálculo (suma de estas 10), no una
 * agencia con archivo propio que se pueda subir.
 */
const AGENCIAS_INICIALES: { codigo: string; nombre: string; esMatriz: boolean }[] = [
  { codigo: "AG01", nombre: "Matriz", esMatriz: true },
  { codigo: "AG02", nombre: "El Guabo", esMatriz: false },
  { codigo: "AG03", nombre: "Piñas", esMatriz: false },
  { codigo: "AG04", nombre: "Machala II", esMatriz: false },
  { codigo: "AG05", nombre: "Ponce Enríquez", esMatriz: false },
  { codigo: "AG06", nombre: "Balsas", esMatriz: false },
  { codigo: "AG07", nombre: "Santa Rosa", esMatriz: false },
  { codigo: "AG08", nombre: "Las Lajas", esMatriz: false },
  { codigo: "AG09", nombre: "Naranjal", esMatriz: false },
  { codigo: "AG10", nombre: "Catamayo", esMatriz: false },
];

/**
 * Crea las 10 agencias si no existen todavía (idempotente — no falla ni
 * duplica si ya están creadas). Se llama automáticamente desde cualquier
 * API route que necesite la lista, así no hace falta correr un script de
 * seed aparte.
 */
async function ensureAgenciasSeed(db: Client): Promise<void> {
  for (const ag of AGENCIAS_INICIALES) {
    await db.execute({
      sql: `INSERT INTO agencias (codigo, nombre, es_matriz) VALUES (?, ?, ?)
            ON CONFLICT(codigo) DO NOTHING`,
      args: [ag.codigo, ag.nombre, ag.esMatriz ? 1 : 0],
    });
  }
}

interface AgenciaFila {
  id: number;
  codigo: string;
  nombre: string;
}

export async function listarAgencias(db: Client): Promise<AgenciaFila[]> {
  await ensureAgenciasSeed(db);
  const res = await db.execute({
    sql: `SELECT id, codigo, nombre FROM agencias ORDER BY codigo`,
    args: [],
  });
  return res.rows as unknown as AgenciaFila[];
}

async function getAgenciaIdByCodigo(db: Client, codigo: string): Promise<number | null> {
  await ensureAgenciasSeed(db);
  const res = await db.execute({
    sql: `SELECT id FROM agencias WHERE codigo = ?`,
    args: [codigo],
  });
  if (res.rows.length === 0) return null;
  return res.rows[0].id as number;
}

/** Mantiene compatibilidad con el código ya escrito para Parámetros de Captaciones. */
export async function getOrCreateMatrizId(db: Client): Promise<number> {
  const id = await getAgenciaIdByCodigo(db, "AG01");
  return id as number;
}