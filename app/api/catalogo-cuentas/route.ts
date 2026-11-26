import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";

/**
 * Busca cuentas del catálogo por código (prefijo) o nombre (contiene),
 * para el autocompletado del formulario "Nuevo concepto" en Proyección de
 * Egresos. Devuelve como máximo 20 resultados, ordenados por código.
 *
 * GET /api/catalogo-cuentas?q=4502          -> por prefijo de código
 * GET /api/catalogo-cuentas?q=honorarios    -> por nombre
 * GET /api/catalogo-cuentas?codigo=45021090 -> match exacto (para autofill
 *                                              cuando ya se conoce el código)
 * &limite=300 (opcional, máx. 500) -> para la pantalla Catálogo de cuentas
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const q = req.nextUrl.searchParams.get("q");
    const codigoExacto = req.nextUrl.searchParams.get("codigo");

    if (codigoExacto) {
      const res = await db.execute({
        sql: `SELECT codigo, nombre, grupo, nivel FROM catalogo_cuentas WHERE codigo = ?`,
        args: [codigoExacto],
      });
      return NextResponse.json({ cuentas: res.rows });
    }

    if (!q || !q.trim()) {
      return NextResponse.json({ cuentas: [] });
    }

    const termino = q.trim();
    const limite = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limite") ?? 20) || 20));
    const res = await db.execute({
      sql: `SELECT codigo, nombre, grupo, nivel FROM catalogo_cuentas
            WHERE codigo LIKE ? OR nombre LIKE ?
            ORDER BY codigo LIMIT ?`,
      args: [`${termino}%`, `%${termino}%`, limite],
    });

    return NextResponse.json({ cuentas: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error buscando en el catálogo de cuentas" }, { status: 500 });
  }
}