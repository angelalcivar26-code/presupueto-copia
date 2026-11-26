import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularFlujoEfectivoArbolMatriz } from "../../../lib/calc/orquestador";
import { calcularFlujoCuenta11 } from "../../../lib/calc/flujo-cuenta11";
import { conCacheGET } from "../../../lib/cache-motor";
import { conConsolidado } from "../../../lib/consolidado";
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

    const arbol = calcularFlujoEfectivoArbolMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    // Flujo de caja sobre la cuenta 11 (Detalle por cuenta y Resumen por concepto, como el flujo real)
    const cuenta11 = calcularFlujoCuenta11(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    return NextResponse.json({ filas: arbol, cuenta11 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el flujo de efectivo" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("flujo-efectivo", leerGET), (j, partes) => {
  // La diferencia de control es la mayor de las agencias (no se suma)
  const c11 = j.cuenta11 as { diferenciaMaxima?: number } | undefined;
  if (c11) c11.diferenciaMaxima = Math.max(0, ...partes.map((p) => Math.abs(Number((p.cuenta11 as { diferenciaMaxima?: number })?.diferenciaMaxima) || 0)));
  return j;
});
export const dynamic = "force-dynamic";
// El Consolidado calcula las 10 agencias: se da más tiempo a la función.
export const maxDuration = 60;
