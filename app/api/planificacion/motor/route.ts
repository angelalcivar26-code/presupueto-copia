import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../../lib/insumos-agencia";
import { conCacheGET } from "../../../../lib/cache-motor";
import { empaquetar } from "../../../../lib/calc/paquete-motor";
import { ejercicioDe } from "../../../../lib/ejercicio-pedido";

/**
 * Insumos del motor del presupuesto de una agencia (los mismos de Estado de resultados y Balance general),
 * para que la planificación calcule todos sus escenarios con el mismo motor en el navegador.
 * GET ?agencia=Matriz&ejercicio=2027
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const r = await cargarInsumosAgencia(agencia, ejercicio);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json(empaquetar(r.insumos));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los insumos del presupuesto" }, { status: 500 });
  }
}

export const GET = conCacheGET("planificacion-motor", leerGET);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
