import { NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { calcularActivosYPorcentajesAgencias } from "../../../lib/prorrateo";

export async function GET() {
  try {
    const db = getDb();
    const { activos, porcentajes } = await calcularActivosYPorcentajesAgencias(db);

    const filas = Object.keys(activos)
      .map((agencia_nombre) => ({
        agencia_nombre,
        activo_dic2025: activos[agencia_nombre],
        porcentaje: porcentajes[agencia_nombre],
      }))
      .sort((a, b) => b.porcentaje - a.porcentaje);

    return NextResponse.json({ filas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error obteniendo el prorrateo de activos" }, { status: 500 });
  }
}