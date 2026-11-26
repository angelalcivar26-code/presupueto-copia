import { NextRequest, NextResponse } from "next/server";
import { getDbDirecto } from "../../../lib/turso";
import { exigirAdmin } from "../../../lib/autorizacion";

/**
 * RESPALDO COMPLETO DE LA BASE (solo administradores, solo lectura).
 *
 *   GET /api/respaldo                          → lista de tablas y su estructura (lee solo sqlite_master)
 *   GET /api/respaldo?tabla=X&desde=0          → hasta LOTE filas de X a partir de ese rowid
 *
 * El navegador pide tabla por tabla y por tramos, así cada fila se lee UNA sola vez y ninguna
 * respuesta pasa el límite de tamaño del servidor. Solo consume lecturas cuando el administrador
 * pulsa «Descargar respaldo»; no se usa en el trabajo diario.
 *
 * No se incluyen: memorias de cálculo (se regeneran solas) ni contraseñas o claves temporales.
 */
const LOTE = 5000;
/** Tablas que se recalculan solas: respaldarlas solo gastaría lecturas. */
const EXCLUIDAS = new Set(["cache_resultados", "resultados_motor", "datos_version"]);
/** Columnas que nunca salen de la base. */
const OCULTAS: Record<string, string[]> = { usuarios: ["contrasena", "clave_temporal", "clave_temporal_expira"] };

async function tablas() {
  const r = await getDbDirecto().execute(
    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name`
  );
  return r.rows.map((f) => ({ nombre: String(f.name), sql: String(f.sql) })).filter((t) => !EXCLUIDAS.has(t.nombre));
}

export async function GET(req: NextRequest) {
  const permiso = await exigirAdmin();
  if ("error" in permiso) return permiso.error;
  try {
    const lista = await tablas();
    const tabla = req.nextUrl.searchParams.get("tabla");
    if (!tabla) {
      const indices = await getDbDirecto().execute(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL`
      );
      return NextResponse.json(
        { tablas: lista, indices: indices.rows.map((f) => String(f.sql)), lote: LOTE },
        { headers: { "cache-control": "no-store" } }
      );
    }
    // El nombre solo se acepta si es una tabla real de la base (nunca texto libre en la consulta)
    if (!lista.some((t) => t.nombre === tabla)) return NextResponse.json({ error: "Tabla no válida" }, { status: 400 });
    const desde = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get("desde")) || 0));
    const r = await getDbDirecto().execute({
      sql: `SELECT rowid AS _fila, * FROM "${tabla}" WHERE rowid > ? ORDER BY rowid LIMIT ${LOTE}`,
      args: [desde],
    });
    const ocultas = new Set(OCULTAS[tabla] ?? []);
    const columnas = r.columns.filter((c) => c !== "_fila" && !ocultas.has(c));
    const filas = r.rows.map((f) => columnas.map((c) => f[c] ?? null));
    const ultima = r.rows.length ? Number(r.rows[r.rows.length - 1]._fila) : desde;
    return NextResponse.json(
      { tabla, columnas, filas, siguiente: r.rows.length === LOTE ? ultima : null },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer la base para el respaldo" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
