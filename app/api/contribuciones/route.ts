import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { construirTodosLosMotores } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Contribuciones de la agencia (Gastos operacionales → 4504): COSEDE mensual y SEPS de abril y septiembre, con las
 * tasas usadas (guardadas, reales del histórico o de la norma) y lo real del año anterior para comparar.
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    if (agencia === "Consolidado") return NextResponse.json({ error: "Elige una agencia: las tasas se revisan por agencia." }, { status: 400 });
    const ins = await cargarInsumosAgencia(agencia, ejercicio);
    if (!ins.ok) return NextResponse.json({ error: ins.error }, { status: 400 });
    const i = ins.insumos;
    const m = construirTodosLosMotores(i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados, agencia,
      i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo);
    const c = m.contribuciones;
    const saldo21 = { corte: m.insumosOtrosActivos.saldoObligacionesPublicoDicAnterior, porMes: m.insumosOtrosActivos.totalCaptacionesPorMes };
    return NextResponse.json({ tasas: c.tasas, cosede: c.cosede, seps: c.seps, real: c.insumos, saldo21, corte: i.corteSaldos ?? null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando las contribuciones" }, { status: 500 });
  }
}

export const GET = conCacheGET("contribuciones", leerGET);
export const dynamic = "force-dynamic";
