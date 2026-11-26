import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetallePatrimonioMatriz } from "../../../lib/calc/orquestador";
import { CONFIG_CAPITAL_SOCIAL_MATRIZ } from "../../../lib/calc/patrimonio";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Patrimonio (grupo 3) proyectado mes a mes.
 *
 *  capitalSocial31, saldoReservas33, saldoOtrosAportes34, saldoSuperavit35, resultados36PorMes : igual que antes
 *  corte             : balance usado como punto de partida (el más reciente de la agencia)
 *  ajusteCierre      : diferencia llevada a 36 cuando el corte aún no tiene el asiento de cierre (cierre simulado)
 *  saldo36Corte      : saldo de 36 en el balance (ya con el ajuste de cierre)
 *  parametrosUsados  : los parámetros de capital social que usó el motor, y de dónde salió cada uno
 *                      ("guardado" en la base de datos, "referencia" = valor de respaldo de Matriz, "sin dato" = 0,
 *                       "estimado" = devolución promedio calculada como saldo 31 ÷ socios al inicio)
 */
const CONCEPTOS = {
  capital_social_monto_aporte: CONFIG_CAPITAL_SOCIAL_MATRIZ.monto_obligatorio_aporte_por_mes,
  capital_social_socios_nuevos: CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_nuevos_por_mes,
  capital_social_socios_retirados: CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_retirados_por_mes,
  capital_social_capitalizacion_dividendos: CONFIG_CAPITAL_SOCIAL_MATRIZ.capitalizacion_dividendos_por_mes,
  capital_social_socios_inicial: Array(12).fill(CONFIG_CAPITAL_SOCIAL_MATRIZ.socios_inicial),
} as const;

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const detalle = calcularDetallePatrimonioMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    // Misma regla que el orquestador (valorPorConceptoOFijo): si el concepto tiene filas guardadas se usan;
    // si no, $0 en todas las agencias (ya no hay valores de referencia del Excel).
    const parametrosUsados: Record<string, { valores: number[]; origen: "guardado" | "referencia" | "sin dato" | "estimado" }> = {};
    for (const concepto of Object.keys(CONCEPTOS)) {
      const filas = i.parametrosOtrosPasivo.filter((f) => f.concepto === concepto);
      if (filas.length) {
        const valores = Array(12).fill(0);
        for (const f of filas) if (f.mes >= 1 && f.mes <= 12) valores[f.mes - 1] = Number(f.monto) || 0;
        parametrosUsados[concepto] = { valores, origen: "guardado" };
      } else {
        parametrosUsados[concepto] = { valores: Array(12).fill(0), origen: "sin dato" };
      }
    }

    // Devolución promedio por socio retirado: guardada, o estimada = saldo 31 ÷ socios al inicio (misma regla del motor)
    const saldo31 = Number(i.saldos["31"]) || 0;
    const sociosIni = parametrosUsados.capital_social_socios_inicial.valores[0];
    const filasDev = i.parametrosOtrosPasivo.filter((f) => f.concepto === "capital_social_devolucion_promedio");
    if (filasDev.length) {
      const valores = Array(12).fill(0);
      for (const f of filasDev) if (f.mes >= 1 && f.mes <= 12) valores[f.mes - 1] = Number(f.monto) || 0;
      parametrosUsados.capital_social_devolucion_promedio = { valores, origen: "guardado" };
    } else {
      const estimado = sociosIni > 0 && saldo31 > 0 ? saldo31 / sociosIni : null;
      parametrosUsados.capital_social_devolucion_promedio = {
        valores: estimado !== null ? Array(12).fill(estimado) : [...parametrosUsados.capital_social_monto_aporte.valores],
        origen: "estimado",
      };
    }

    return NextResponse.json({
      ...detalle,
      saldo31Corte: saldo31,
      corte: i.corteSaldos,
      ajusteCierre: i.ajusteCierre ?? 0,
      saldo36Corte: Number(i.saldos["36"]) || 0,
      parametrosUsados,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el detalle de Patrimonio" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("patrimonio-detalle", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
