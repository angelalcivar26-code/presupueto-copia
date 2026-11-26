import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetalleOtrosActivosMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Otros activos (grupo 19) y cuentas por cobrar (16) proyectados mes a mes.
 *
 *  ...detalle : cada subcuenta con sus movimientos, el Fondo de Liquidez paso a paso y el resumen del 19
 *  corte      : balance usado como punto de partida (el más reciente cargado de la agencia)
 *  fuentes    : de dónde sale cada movimiento editable:
 *               "guardado"   = escrito en la herramienta para esta agencia
 *               "referencia" = valor fijo del Excel (solo Matriz, mientras no se escriba uno propio)
 *               "sin datos"  = 0 (no hay movimiento)
 */
const CONCEPTOS = [
  "gastos_anticipados_entradas", "gastos_anticipados_salidas",
  "materiales_entradas", "materiales_salidas",
  "transferencias_1908_entradas", "transferencias_1908_salidas",
] as const; // la 16 ya no tiene parámetro: sale de la relación con la cartera por vencer

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const detalle = calcularDetalleOtrosActivosMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    // Valores que usó el motor para cada concepto (para saber si la referencia trae algo distinto de 0)
    const usados: Record<(typeof CONCEPTOS)[number], number[]> = {
      gastos_anticipados_entradas: detalle.gastosAnticipados1904.map((f) => f.entradas),
      gastos_anticipados_salidas: detalle.gastosAnticipados1904.map((f) => f.salidas),
      materiales_entradas: detalle.materiales1906.map((f) => f.entradas),
      materiales_salidas: detalle.materiales1906.map((f) => f.salidas),
      transferencias_1908_entradas: detalle.transferencias1908.map((f) => f.entradas),
      transferencias_1908_salidas: detalle.transferencias1908.map((f) => f.salidas),
    };
    const fuentes = Object.fromEntries(CONCEPTOS.map((c) => [
      c,
      i.parametrosOtrosPasivo.some((f) => f.concepto === c) ? "guardado"
        : usados[c].some((v) => Math.abs(v) > 0.005) ? "referencia" : "sin datos",
    ]));

    // composición al corte de las cuentas sin movimiento (1901 acciones, 1990 otros, 1999 provisión): subcuentas de 6 dígitos
    const codigos = Object.keys(i.saldos).filter((k) => k.length === 6 && /^(1901|1990|1999)/.test(k) && Math.abs(Number(i.saldos[k]) || 0) >= 0.5).sort();
    const cat = codigos.length
      ? await getDb().execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${codigos.map(() => "?").join(",")})`, args: codigos }).catch(() => ({ rows: [] as Record<string, unknown>[] }))
      : { rows: [] as Record<string, unknown>[] };
    const nombres = Object.fromEntries(cat.rows.map((r) => [String(r.codigo), String(r.nombre)]));
    const subcuentas = codigos.map((codigo) => ({ codigo, nombre: nombres[codigo] ?? codigo, saldo: Number(i.saldos[codigo]) || 0 }));

    return NextResponse.json({ ...detalle, corte: i.corteSaldos, fuentes, subcuentas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el detalle de Otros Activos" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("otros-activos-detalle", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
