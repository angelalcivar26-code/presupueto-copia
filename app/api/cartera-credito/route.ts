import { factorVencidaDe, precancelacionRealDe } from "../../../lib/calc/provision-flow";
import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { cargarInsumosAgencia, resolverAgenciaId } from "../../../lib/insumos-agencia";
import { calcularDetalleCarteraMatriz, RELACION_MORA_INTERES_NORMAL, interesMoraDe } from "../../../lib/calc/orquestador";
import { calcularProduccionLinea } from "../../../lib/calc/produccion";
import { LINEAS_PRODUCCION, leerParametrosProduccion } from "../../../lib/parametros-produccion";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 *  detalle    : cartera por línea y mes (igual que antes)
 *  produccion : por línea, 12 meses de N° de operaciones (informativo, ver lib/calc/produccion.ts)
 *  entradasProduccion : asesores activos, mínimo de operaciones y los datos editables usados
 *  corte      : balance usado como punto de partida (el más reciente de la agencia)
 * Todo se recalcula en cada llamada: al guardar metas, asesores, tasas o producción, la pantalla vuelve a pedirlo.
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const ins = await cargarInsumosAgencia(agencia, ejercicio);
    if (!ins.ok) return NextResponse.json({ error: ins.error }, { status: 400 });
    const i = ins.insumos;

    const detalle = calcularDetalleCarteraMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados, agencia, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, agencia);
    const params = await leerParametrosProduccion(db, agenciaId);
    const asesoresActivos = i.oficialesCredito.filter((o) => Number(o.activo) === 1).length;
    const minimoOperaciones = Number(i.metasCredito?.minimo_operaciones) || 0;

    const produccion = Object.fromEntries(LINEAS_PRODUCCION.map((l) => {
      const f = detalle[l];
      return [l, calcularProduccionLinea({
        asesoresActivos,
        minimoOperacionesPorAsesor: minimoOperaciones,
        pctDistribucionPorMes: f.map((x) => x.tasas.pctDistribucion),
        pctRecuperacionPorMes: f.map((x) => x.tasas.pctRecuperacionPeriodo),
        prestamosAConcederPorMes: f.map((x) => x.porVencer.prestamosAConceder),
        saldoFinalPorVencerPorMes: f.map((x) => x.porVencer.saldoFinal),
        saldoInicialPorVencerEnero: f[0].porVencer.saldoInicial,
        operacionesIniciales: params[l].operacionesIniciales,
        creditosPorOficial: params[l].creditosPorOficial,
      })];
    }));

    return NextResponse.json({
      detalle,
      produccion,
      entradasProduccion: { asesoresActivos, minimoOperaciones, parametros: params },
      corte: i.corteSaldos,
      // Interés de mora = interés normal × % de la agencia (Planificación → Supuestos; sin dato, el institucional de antes)
      relacionMora: interesMoraDe(i.parametrosOtrosPasivo) ?? Number(i.metasCredito?.relacion_mora ?? RELACION_MORA_INTERES_NORMAL),
      // valor de cada mes (en el Consolidado se suma el de cada agencia, cada una con su %)
      interesMoraPorMes: Array.from({ length: 12 }, (_, m) => (Object.values(detalle) as { ingresoPorInteres: number }[][]).reduce((t, f) => t + (f[m]?.ingresoPorInteres ?? 0), 0)
        * (interesMoraDe(i.parametrosOtrosPasivo) ?? Number(i.metasCredito?.relacion_mora ?? RELACION_MORA_INTERES_NORMAL))),
      // Tasas y recuperación: lo que el motor aplica sobre lo cargado (recuperación de vencida × factor; precancelación en riesgo vacía)
      factorVencida: factorVencidaDe(i.saldos),
      precancelacionReal: precancelacionRealDe(i.saldos),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando la cartera de crédito" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("cartera-credito", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
