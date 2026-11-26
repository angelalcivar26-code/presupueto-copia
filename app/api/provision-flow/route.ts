import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularProvisionFlowDetalle } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Provisión de cartera por flow rates (tramos de mora) de la agencia: los tres escenarios mes a mes
 * (tramos, castigos, provisión, gasto 4402 / reversión 5604.10, recuperación 5604.05, saldo E, mora),
 * la provisión del Balance (1499) del escenario activo, la provisión no explicada por tramos,
 * la morosidad contable y el resultado del ejercicio. En Consolidado se suman las 10 agencias.
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const r = await cargarInsumosAgencia(agencia, ejercicio);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const i = r.insumos;
    const d = calcularProvisionFlowDetalle(i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agencia, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo);
    return NextResponse.json({ ...d, corte: i.corteSaldos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando la provisión por tramos" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("provision-flow", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
