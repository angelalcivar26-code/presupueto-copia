import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import {
  calcularDetalleActivoFijoMatriz,
  type FilaPresupuestoDepartamental,
  type FilaParametroOtrosPasivo,
  type SaldosPorCodigo,
} from "../../../lib/calc/orquestador";
import {
  adjuntarDepreciacionRegistro,
  depreciacionRegistroPorCategoria,
  estadoBienEnEjercicio,
} from "../../../lib/calc/activo-fijo";
import { cargarRegistroActivosFijos, resolverCorteSaldos } from "../../../lib/insumos-agencia";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

/**
 * GET ?agencia=Matriz&ejercicio=2027
 *  - categorias / terrenos: detalle mes a mes (igual que antes). Si la agencia
 *    tiene cargado el registro de activos fijos, la depreciación ya sale bien
 *    por bien -- es exactamente lo que usan Balance, ER y Flujo.
 *  - registro: resumen del registro usado (bienes, ya depreciados, los que
 *    terminan en el año...) o null si la agencia no lo tiene cargado.
 *  - comparacion: depreciación del año con el cálculo anterior (costo × factor
 *    ÷ 12) y con el registro, por categoría. null si no hay registro.
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);
    const corte = await resolverCorteSaldos(db, agenciaId);

    const [saldosRes, presupuestoRes, factoresRes] = await Promise.all([
      db.execute({ sql: `SELECT cuenta_codigo, monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ?`, args: [agenciaId, corte.anio, corte.mes] }),
      db.execute({
        sql: `SELECT departamento, concepto, cuenta_nombre, mes, monto FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ?`,
        args: [agenciaId, ejercicio],
      }),
      db.execute({ sql: `SELECT categoria, factor_anual FROM factores_depreciacion` }),
    ]);
    // revalúos de terrenos y edificios (Patrimonio → Otras cuentas): el Balance los suma al costo; aquí también
    const revRes = await db.execute({ sql: `SELECT concepto, mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto IN ('patrimonio_revaluo_terrenos', 'patrimonio_revaluo_edificios')`, args: [agenciaId, ejercicio] }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const revaluos = revRes.rows.map((r) => ({ concepto: String(r.concepto), mes: Number(r.mes), monto: Number(r.monto) || 0 })) as FilaParametroOtrosPasivo[];

    const saldos: SaldosPorCodigo = {};
    for (const row of saldosRes.rows) saldos[row.cuenta_codigo as string] = row.monto as number;

    if (Object.keys(saldos).length === 0) {
      return NextResponse.json({ error: `No hay saldos iniciales cargados para ${agenciaNombre}.` }, { status: 400 });
    }

    const factores: Record<string, number> = {};
    for (const row of factoresRes.rows) factores[row.categoria as string] = row.factor_anual as number;
    const presupuesto = presupuestoRes.rows as unknown as FilaPresupuestoDepartamental[];

    // Cálculo anterior (sin registro): se guarda solo para la comparación.
    const sinRegistro = calcularDetalleActivoFijoMatriz(saldos, [], [], presupuesto, [], agenciaNombre, [], undefined, { ...factores }, revaluos);

    const registro = await cargarRegistroActivosFijos(db, agenciaId, ejercicio);
    if (!registro) {
      return NextResponse.json({ ...sinRegistro, corteSaldos: corte, registro: null, comparacion: null });
    }

    adjuntarDepreciacionRegistro(factores, depreciacionRegistroPorCategoria(registro.bienes, registro.fechaCorte, ejercicio));
    const detalle = calcularDetalleActivoFijoMatriz(saldos, [], [], presupuesto, [], agenciaNombre, [], undefined, factores, revaluos);

    // Resumen del registro por categoría
    const porCategoria: Record<string, { bienes: number; depreciados: number; siguen: number; terminanEnAnio: number }> = {};
    const terminanPorMes = Array(12).fill(0) as number[];
    for (const b of registro.bienes) {
      const e = estadoBienEnEjercicio(b, registro.fechaCorte, ejercicio);
      const c = (porCategoria[b.categoria] ??= { bienes: 0, depreciados: 0, siguen: 0, terminanEnAnio: 0 });
      c.bienes++;
      if (e.depreciadoAntes) c.depreciados++;
      else if (e.cuota > 0) c.siguen++;
      if (e.mesTerminaEjercicio !== null) { c.terminanEnAnio++; terminanPorMes[e.mesTerminaEjercicio]++; }
    }

    const depAnio = (cats: Record<string, { depreciacionDelMes: number }[]>) =>
      Object.fromEntries(Object.entries(cats).map(([k, f]) => [k, f.reduce((a, x) => a + Math.abs(x.depreciacionDelMes), 0)]));

    return NextResponse.json({
      ...detalle,
      corteSaldos: corte,
      registro: { fechaCorte: registro.fechaCorte, bienes: registro.bienes.length, porCategoria, terminanPorMes },
      comparacion: { antes: depAnio(sinRegistro.categorias), ahora: depAnio(detalle.categorias) },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el detalle de activos fijos" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("activos-fijos", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
