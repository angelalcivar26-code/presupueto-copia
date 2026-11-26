import { NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";

/**
 * GET /api/esquema — solo lectura. Devuelve la estructura real de la base (tablas e índices),
 * como texto para copiar. Sirve para mantener db/schema.sql al día. No muestra datos.
 */
export async function GET() {
  try {
    const db = getDb();
    const r = await db.execute(
      `SELECT type, name, sql FROM sqlite_master
       WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`
    );
    const texto = r.rows.map((f) => `${String(f.sql).trim()};`).join("\n\n");
    return new NextResponse(texto, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer la estructura de la base" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
