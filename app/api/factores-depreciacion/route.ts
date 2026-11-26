import { NextRequest, NextResponse } from "next/server";
import { monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";

export async function GET() {
  try {
    const db = getDb();
    const res = await db.execute({ sql: `SELECT categoria, factor_anual FROM factores_depreciacion` });
    const factores: Record<string, number> = {};
    for (const row of res.rows) factores[row.categoria as string] = row.factor_anual as number;
    return NextResponse.json({ factores });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo factores de depreciación" }, { status: 500 });
  }
}

/** POST { categoria, factor_anual } -- actualiza una sola categoría (0.05 = 5%). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { categoria, factor_anual } = body;
    if (!categoria || factor_anual === undefined) {
      return NextResponse.json({ error: "Faltan campos: categoria y factor_anual" }, { status: 400 });
    }

    const db = getDb();
    await db.execute({
      sql: `INSERT INTO factores_depreciacion (categoria, factor_anual) VALUES (?, ?)
            ON CONFLICT(categoria) DO UPDATE SET factor_anual = excluded.factor_anual`,
      args: [categoria, validarMonto(factor_anual, "Factor de depreciación anual", { min: 0, max: 1 })],
    });

    return NextResponse.json({ actualizado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el factor de depreciación" }, { status: 500 });
  }
}