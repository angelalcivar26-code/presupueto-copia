import { getDbDirecto } from "./turso";

/**
 * BITÁCORA DE CAMBIOS — quién guardó qué, cuándo y dónde.
 *
 * Una fila por guardado (no por casilla): la arma el middleware con el usuario, la pantalla y la acción, y
 * se escribe solo si el guardado cambió datos (lo detecta lib/turso.ts). Va por la conexión directa, así
 * no invalida los resultados calculados. Se conserva 12 meses. No agrega lecturas al trabajo normal:
 * la tabla solo se lee en Administración → Bitácora.
 */
interface EntradaBitacora {
  id?: number; fecha?: string; usuario: string; accion: string; pantalla: string; agencia: string | null; ejercicio: number | null; detalle: string;
  instantanea_id?: number | null; restaurada_en?: string | null; restaurada_por?: string | null;
}

export const CABECERA_BITACORA = "x-bitacora";

let tabla: Promise<void> | null = null;
function asegurarTabla(): Promise<void> {
  tabla ??= (async () => {
    const db = getDbDirecto();
    await db.execute(`CREATE TABLE IF NOT EXISTS bitacora (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT (datetime('now')),
      usuario TEXT NOT NULL, accion TEXT NOT NULL, pantalla TEXT NOT NULL,
      agencia TEXT, ejercicio INTEGER, detalle TEXT NOT NULL)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora (fecha)`);
    const cols = await db.execute("PRAGMA table_info(bitacora)");
    if (!cols.rows.some((c) => String(c.name) === "instantanea_id")) {
      try { await db.execute(`ALTER TABLE bitacora ADD COLUMN instantanea_id INTEGER`); } catch { /* otro servidor la agregó */ }
    }
  })().catch((e) => { tabla = null; throw e; });
  return tabla;
}

// Un guardado puede escribir varias veces: se anota una sola vez por pedido.
const anotados = new Set<string>();
// Copia tomada antes de una eliminación grande en este pedido (lib/instantaneas.ts): queda enlazada a su fila.
const instantaneaDePedido = new Map<string, number>();

async function descripcionPedido(): Promise<(EntradaBitacora & { id_pedido: string }) | null> {
  try {
    const { headers } = await import("next/headers");
    const crudo = (await headers()).get(CABECERA_BITACORA);
    return crudo ? JSON.parse(decodeURIComponent(crudo)) : null;
  } catch { return null; }
}

/** Usuario del pedido en curso (o "sistema"). */
export async function usuarioDelPedido(): Promise<string> {
  return (await descripcionPedido())?.usuario ?? "sistema";
}

/** Enlaza la instantánea con la fila de bitácora de este pedido. */
export async function enlazarInstantanea(id: number): Promise<void> {
  const e = await descripcionPedido();
  if (!e) return;
  if (instantaneaDePedido.size > 500) instantaneaDePedido.clear();
  instantaneaDePedido.set(e.id_pedido, id);
}
let ultimaPurga = 0;

/** Anota el guardado del pedido en curso (si el middleware lo describió). Nunca hace fallar el guardado. */
export async function anotarGuardado(detalle?: string): Promise<void> {
  try {
    const e = await descripcionPedido();
    if (!e) return;
    if (anotados.has(e.id_pedido)) return;
    if (anotados.size > 2000) anotados.clear();
    anotados.add(e.id_pedido);
    await asegurarTabla();
    const db = getDbDirecto();
    await db.execute({
      sql: `INSERT INTO bitacora (usuario, accion, pantalla, agencia, ejercicio, detalle, instantanea_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [e.usuario, e.accion, e.pantalla, e.agencia, e.ejercicio, (detalle ?? e.detalle).slice(0, 300), instantaneaDePedido.get(e.id_pedido) ?? null],
    });
    // Lo de más de 12 meses se borra solo (como máximo una vez al día por servidor).
    if (Date.now() - ultimaPurga > 86_400_000) {
      ultimaPurga = Date.now();
      await db.execute(`DELETE FROM bitacora WHERE fecha < datetime('now', '-12 months')`);
      await db.execute(`DELETE FROM instantaneas WHERE fecha < datetime('now', '-12 months')`).catch(() => undefined);
    }
  } catch {
    // Fuera de un pedido (scripts) o sin bitácora: el guardado sigue igual.
  }
}

/** Consulta paginada (más reciente primero). */
export async function leerBitacora(f: { desde?: string; hasta?: string; usuario?: string; limite: number; desplazamiento: number }) {
  await asegurarTabla();
  await (await import("./instantaneas")).asegurarTablaInstantaneas();
  const cond: string[] = [], args: (string | number)[] = [];
  if (f.desde) { cond.push("fecha >= ?"); args.push(`${f.desde} 00:00:00`); }
  if (f.hasta) { cond.push("fecha <= ?"); args.push(`${f.hasta} 23:59:59`); }
  if (f.usuario) { cond.push("usuario = ?"); args.push(f.usuario); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const db = getDbDirecto();
  const [filas, total] = await Promise.all([
    db.execute({
      sql: `SELECT b.id, b.fecha, b.usuario, b.accion, b.pantalla, b.agencia, b.ejercicio, b.detalle, b.instantanea_id,
                   i.restaurada_en, i.restaurada_por
              FROM bitacora b LEFT JOIN instantaneas i ON i.id = b.instantanea_id
              ${where.replace(/fecha|usuario/g, (m) => `b.${m}`)} ORDER BY b.id DESC LIMIT ? OFFSET ?`,
      args: [...args, f.limite, f.desplazamiento],
    }),
    db.execute({ sql: `SELECT COUNT(*) AS n FROM bitacora ${where}`, args }),
  ]);
  return { filas: filas.rows.map((r) => ({ ...r })) as unknown as EntradaBitacora[], total: Number(total.rows[0]?.n ?? 0) };
}
