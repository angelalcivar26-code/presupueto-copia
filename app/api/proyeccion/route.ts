import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularProyeccionMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027 -> { meses: ResultadoMesResumen[] }
 * Usa la misma carga que el resto de pantallas (lib/insumos-agencia.ts): el balance de corte
 * más reciente, el cierre simulado, las inversiones y los intereses 5101/5103/5190 calculados.
 */
async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const r = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!r.ok) {
      return NextResponse.json({ error: `${r.error} Ve a Carga de datos primero.` }, { status: 400 });
    }
    const i = r.insumos;
    const resultado = calcularProyeccionMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados, agenciaNombre,
      i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );
    return NextResponse.json({ meses: resultado });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando la proyección" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("proyeccion", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
