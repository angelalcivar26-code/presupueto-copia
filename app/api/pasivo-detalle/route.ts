import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetallePasivoMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Cuentas por pagar (25), obligaciones financieras (26) y otros pasivos (29) proyectados mes a mes.
 *  ...detalle : movimiento de cada cuenta (saldo inicial, incrementos, pagos, saldo final)
 *  corte      : balance usado como punto de partida
 *  subcuentas : composición de 25, 26 y 29 al corte (subcuentas de 4 dígitos con su nombre del catálogo)
 *  fuentes    : "guardado" (escrito para la agencia) o "sin datos" (0) de cada movimiento editable
 */
const CONCEPTOS = ["cuentas_por_pagar_incrementos", "cuentas_por_pagar_pagos", "transferencias_2908_incrementos", "transferencias_2908_disminuciones"] as const;

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const detalle = calcularDetallePasivoMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    const codigos = Object.keys(i.saldos).filter((k) => k.length === 4 && /^(25|26|29)/.test(k) && Math.abs(Number(i.saldos[k]) || 0) >= 0.5).sort();
    const cat = codigos.length
      ? await getDb().execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${codigos.map(() => "?").join(",")})`, args: codigos }).catch(() => ({ rows: [] as Record<string, unknown>[] }))
      : { rows: [] as Record<string, unknown>[] };
    const nombres = Object.fromEntries(cat.rows.map((r) => [String(r.codigo), String(r.nombre)]));
    const subcuentas = codigos.map((codigo) => ({ codigo, nombre: nombres[codigo] ?? codigo, saldo: Math.abs(Number(i.saldos[codigo]) || 0) }));
    const fuentes = Object.fromEntries(CONCEPTOS.map((c) => [c, i.parametrosOtrosPasivo.some((f) => f.concepto === c) ? "guardado" : "sin datos"]));

    return NextResponse.json({ ...detalle, corte: i.corteSaldos, subcuentas, fuentes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el detalle de Pasivo" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("pasivo-detalle", leerGET), (suma, partes) => ({
  ...suma, corte: (partes[0] as { corte?: unknown }).corte, fuentes: (partes[0] as { fuentes?: unknown }).fuentes,
}));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
