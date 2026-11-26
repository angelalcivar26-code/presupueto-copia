import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetalleIngresoCarteraMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const detalle = calcularDetalleIngresoCarteraMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    return NextResponse.json(detalle);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el detalle de ingreso por cartera" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("ingresos-cartera-detalle", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
