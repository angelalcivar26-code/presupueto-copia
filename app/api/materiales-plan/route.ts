import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { AGENCIAS_CONSOLIDADO } from "../../../lib/consolidado";
import { planMaterialesAgencia, movimientosMateriales } from "../../../lib/activos-diferidos";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * Materiales (1906): pedidos (incremento) y gastos 450705 (disminución) registrados por agencia; compras y entregas de Matriz.
 * GET ?agencia=X (Consolidado = las 10) → { agencias: [{ agencia, ...PlanMateriales, registros }] }
 * Se registran con /api/activos-diferidos (partidas del grupo 1906, movimiento 'pedido' o 'gasto').
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const lista = agencia === "Consolidado" ? AGENCIAS_CONSOLIDADO : [agencia];
    const ids = await db.execute(`SELECT id, nombre FROM agencias`);
    const id = (n: string) => Number(ids.rows.find((r) => String(r.nombre) === n)?.id ?? 0);
    const agencias = await Promise.all(lista.map(async (a) => ({
      agencia: a, ...(await planMaterialesAgencia(db, a, ejercicio)),
      registros: id(a) ? await movimientosMateriales(db, id(a), ejercicio) : [],
    })));
    return NextResponse.json({ agencias });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los pedidos de materiales" }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
