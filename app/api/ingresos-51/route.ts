import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { ingresos51De } from "../../../lib/calc/ingresos-51";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Intereses ganados de la cuenta 51 (sin cartera 5104) que usa el motor, con su base,
 * tasas y la verificación contra el balance de partida:
 *   5101 depósitos (bancos 1103 × tasa ÷ 12), 5103 inversiones (registro), 5190 préstamos internos (1908 × tasa ÷ 12)
 * Toda la 51 sale calculada (5104 viene de Cartera); lo escrito antes a mano bajo la 51 ya no se usa.
 * Las tasas se guardan con /api/otros-pasivo-parametros
 *   (conceptos "ingresos_tasa_bancos" e "ingresos_tasa_prestamos_internos", % anual por mes).
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const r = await cargarInsumosAgencia(agencia, ejercicio);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const i51 = ingresos51De(r.insumos.saldos);
    if (!i51) return NextResponse.json({ error: "No se pudieron calcular los intereses de la cuenta 51." }, { status: 500 });

    return NextResponse.json({ ...i51, ajusteCierre: r.insumos.ajusteCierre ?? 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando los intereses de la cuenta 51" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("ingresos-51", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
