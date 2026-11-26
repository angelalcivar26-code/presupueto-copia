import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";

/**
 * Departamentos organizacionales reales (Gerencia, Administrativo,
 * Contabilidad...), no cuentas contables. Se usan en el selector de
 * "Departamento" de Plan de Adquisiciones y se pueden crear nuevos desde ahí.
 */
export async function GET() {
  try {
    const db = getDb();
    const res = await db.execute({ sql: `SELECT nombre FROM departamentos ORDER BY nombre` });
    return NextResponse.json({ departamentos: res.rows.map((r) => r.nombre as string) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo departamentos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { nombre } = await req.json();
    if (!nombre || !String(nombre).trim()) {
      return NextResponse.json({ error: "Falta el nombre del departamento" }, { status: 400 });
    }
    await db.execute({ sql: `INSERT OR IGNORE INTO departamentos (nombre) VALUES (?)`, args: [String(nombre).trim()] });
    return NextResponse.json({ creado: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error creando el departamento" }, { status: 500 });
  }
}