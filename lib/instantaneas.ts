import { getDb, getDbDirecto } from "./turso";
import { anotarGuardado, enlazarInstantanea, usuarioDelPedido } from "./bitacora";

/**
 * INSTANTÁNEAS ANTES DE ELIMINACIONES GRANDES.
 *
 * Antes de eliminar una hoja (10 agencias), un ejercicio o un corte de saldos se guarda una copia de
 * las filas que se van a borrar. Desde la Bitácora, el administrador puede restaurarlas tal como
 * estaban (mismos identificadores). Solo lee al eliminar; nunca en el trabajo diario. Se conservan
 * 12 meses, como la bitácora. Si la copia no se puede tomar, la eliminación no se hace.
 */
const TABLAS_RESTAURABLES = new Set([
  "presupuesto_resumen", "presupuesto_departamental", "hojas_presupuesto", "ejercicios", "saldos_iniciales", "saldos_cargas",
  "historico_cuentas",
]);

type Valor = string | number | null;
interface Copia { tabla: string; filas: Record<string, Valor>[] }

let tabla: Promise<void> | null = null;
export function asegurarTablaInstantaneas(): Promise<void> {
  tabla ??= getDbDirecto().execute(`CREATE TABLE IF NOT EXISTS instantaneas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT (datetime('now')),
      usuario TEXT NOT NULL, descripcion TEXT NOT NULL, datos TEXT NOT NULL,
      restaurada_en TEXT, restaurada_por TEXT)`).then(() => undefined).catch((e) => { tabla = null; throw e; });
  return tabla;
}

/** Copia las filas que devuelven las consultas (SELECT * … de cada tabla) y la enlaza con la bitácora. */
export async function tomarInstantanea(descripcion: string, consultas: { tabla: string; where: string; args: Valor[] }[]): Promise<number> {
  await asegurarTablaInstantaneas();
  const db = getDbDirecto();
  const copias: Copia[] = [];
  for (const c of consultas) {
    if (!TABLAS_RESTAURABLES.has(c.tabla)) throw new Error(`Tabla no restaurable: ${c.tabla}`);
    const r = await db.execute({ sql: `SELECT * FROM ${c.tabla} WHERE ${c.where}`, args: c.args });
    copias.push({ tabla: c.tabla, filas: r.rows.map((f) => Object.fromEntries(r.columns.map((k) => [k, (f[k] ?? null) as Valor]))) });
  }
  const ins = await db.execute({
    sql: `INSERT INTO instantaneas (usuario, descripcion, datos) VALUES (?, ?, ?)`,
    args: [await usuarioDelPedido(), descripcion.slice(0, 300), JSON.stringify(copias)],
  });
  const id = Number(ins.lastInsertRowid);
  await enlazarInstantanea(id);
  return id;
}

/** Devuelve las filas copiadas a sus tablas (las que ya existan con el mismo id se reemplazan). */
export async function restaurarInstantanea(id: number): Promise<{ descripcion: string; filas: number }> {
  await asegurarTablaInstantaneas();
  const r = await getDbDirecto().execute({ sql: `SELECT descripcion, datos, restaurada_en FROM instantaneas WHERE id = ?`, args: [id] });
  const fila = r.rows[0];
  if (!fila) throw new Error("La copia no existe (pudo vencer: se conservan 12 meses).");
  if (fila.restaurada_en) {
    const f = new Date(String(fila.restaurada_en).replace(" ", "T") + "Z").toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" });
    throw new Error(`Esta copia ya se restauró el ${f}.`);
  }
  const copias = JSON.parse(String(fila.datos)) as Copia[];
  // Orden: primero lo que otros referencian (ejercicio, hojas, valores institucionales), luego las cuentas.
  const orden = ["ejercicios", "hojas_presupuesto", "presupuesto_resumen", "presupuesto_departamental", "saldos_cargas", "saldos_iniciales", "historico_cuentas"];
  copias.sort((a, b) => orden.indexOf(a.tabla) - orden.indexOf(b.tabla));
  const stmts: { sql: string; args: Valor[] }[] = [];
  let total = 0;
  for (const c of copias) {
    if (!TABLAS_RESTAURABLES.has(c.tabla) || !c.filas.length) continue;
    const cols = Object.keys(c.filas[0]);
    for (let i = 0; i < c.filas.length; i += 50) {
      const parte = c.filas.slice(i, i + 50);
      stmts.push({
        sql: `INSERT OR REPLACE INTO ${c.tabla} (${cols.join(", ")}) VALUES ${parte.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ")}`,
        args: parte.flatMap((f) => cols.map((k) => f[k] ?? null)),
      });
      total += parte.length;
    }
  }
  // Históricos restaurados: su resumen (indicadores, planificación) se vuelve a calcular en la siguiente lectura
  for (const c of copias) if (c.tabla === "historico_cuentas") {
    for (const o of new Set(c.filas.map((f) => String(f.oficina)))) stmts.push({ sql: `INSERT OR IGNORE INTO historico_pendiente (oficina) VALUES (?)`, args: [o] });
  }
  // Bitácora con el detalle de lo restaurado (antes del lote, que la anotaría con un texto genérico).
  await anotarGuardado(`${String(fila.descripcion)} (${total.toLocaleString("es-EC")} filas)`);
  // Un solo lote: se restaura todo o nada. Pasa por getDb para que los cálculos se actualicen.
  if (stmts.length) await getDb().batch(stmts, "write");
  await getDbDirecto().execute({
    sql: `UPDATE instantaneas SET restaurada_en = datetime('now'), restaurada_por = ? WHERE id = ?`,
    args: [await usuarioDelPedido(), id],
  });
  return { descripcion: String(fila.descripcion), filas: total };
}
