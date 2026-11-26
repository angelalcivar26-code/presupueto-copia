import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId, resolverCorteSaldos, cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetalleCarteraMatriz } from "../../../lib/calc/orquestador";
import {
  LINEAS_PROVISION, asegurarTablaProvision, historicoProvision, leerParametrosProvision, pctActualDe, pesosHistoricos,
} from "../../../lib/parametros-provision";
import type { Linea } from "../../../lib/calc/provision";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 *   corte       : balance usado como punto de partida
 *   pctActual   : % de provisión real de cada línea en ese balance
 *   historico   : % de provisión por línea en cada mes con datos (balances cargados + historico_provision)
 *   pesos       : peso de cada mes calendario para "distribuir como el histórico"
 *   parametros  : sin reversiones + por línea: variación, distribución y los 12 % del ejercicio
 *   proyeccion  : por línea y mes -> cartera bruta, % aplicado, provisión requerida, anterior y gasto 44
 * POST { agencia, sinReversiones, lineas: { LINEA: { variacionPts, distribucion, pctMes: [12 valores en %] } } }
 *   Guarda en parametros_provision (cabecera) y parametros_provision_mes (12 meses), en una sola transacción.
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);
    const corte = await resolverCorteSaldos(db, agenciaId);

    const historico = await historicoProvision(db, agenciaId, agenciaNombre);
    const pctActual = pctActualDe(historico, corte);
    const guardados = await leerParametrosProvision(db, agenciaId, pctActual);
    const pesos = Object.fromEntries(LINEAS_PROVISION.map((l) => [l, pesosHistoricos(historico, l)]));
    const parametros = {
      sinReversiones: guardados.sinReversiones,
      guardado: guardados.guardado,
      lineas: Object.fromEntries(LINEAS_PROVISION.map((l) => {
        const g = guardados.lineas[l];
        return [l, { variacionPts: g.variacionPts, distribucion: g.distribucion, pctMes: g.pctMes ?? (pctActual[l] !== null ? Array(12).fill(pctActual[l]) : Array(12).fill(0)) }];
      })),
    };

    const ins = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    let proyeccion: Record<string, unknown> | null = null;
    if (ins.ok) {
      const i = ins.insumos;
      const detalle = calcularDetalleCarteraMatriz(
        i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados, agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
      );
      proyeccion = Object.fromEntries(LINEAS_PROVISION.map((l) => {
        const f = detalle[l];
        return [l, {
          pctInicial: f[0].tasas.pctProvisionInicial,
          cartera: f.map((x) => x.porVencer.saldoFinal + x.enRiesgo.saldoFinal),
          pctObjetivo: f.map((x) => x.tasas.pctProvisionObjetivo),
          pctAplicado: f.map((x) => x.tasas.ratioProvision),
          requerida: f.map((x) => Math.abs(x.provision)),
          anterior: f.map((x) => x.tasas.provisionAnterior),
          gasto: f.map((x) => Math.abs(x.provision) - x.tasas.provisionAnterior),
        }];
      }));
    }

    return NextResponse.json({ corte, pctActual, historico, pesos, parametros, proyeccion, error: ins.ok ? undefined : ins.error });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los parámetros de provisión" }, { status: 500 });
  }
}

interface LineaEntrada { variacionPts?: number; distribucion?: string; pctMes?: number[] }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { agencia?: string; sinReversiones?: boolean; lineas?: Partial<Record<Linea, LineaEntrada>> };
    if (!body.lineas) return NextResponse.json({ error: "Faltan las líneas" }, { status: 400 });
    const db = getDb();
    await asegurarTablaProvision(db);
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(body.agencia));
    const sinRev = body.sinReversiones === false ? 0 : 1;

    const statements: { sql: string; args: (string | number)[] }[] = [];
    for (const l of LINEAS_PROVISION) {
      const e = body.lineas[l];
      if (!e) continue;
      const pct = e.pctMes ?? [];
      if (pct.length !== 12 || pct.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100)) {
        return NextResponse.json({ error: `Los 12 % de ${l} deben estar entre 0 y 100` }, { status: 400 });
      }
      const variacion = Number(e.variacionPts) || 0;
      statements.push({
        sql: `INSERT INTO parametros_provision (agencia_id, linea, base, ajuste_pts, gradual, sin_reversiones, variacion_pts, distribucion, actualizado_en)
              VALUES (?, ?, 'mes_a_mes', 0, 0, ?, ?, ?, datetime('now'))
              ON CONFLICT(agencia_id, linea) DO UPDATE SET
                base = 'mes_a_mes', ajuste_pts = 0, gradual = 0, sin_reversiones = excluded.sin_reversiones,
                variacion_pts = excluded.variacion_pts, distribucion = excluded.distribucion, actualizado_en = excluded.actualizado_en`,
        args: [agenciaId, l, sinRev, variacion, e.distribucion === "historico" ? "historico" : "parejo"],
      });
      pct.forEach((v, i) => statements.push({
        sql: `INSERT INTO parametros_provision_mes (agencia_id, linea, mes, pct, actualizado_en) VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(agencia_id, linea, mes) DO UPDATE SET pct = excluded.pct, actualizado_en = excluded.actualizado_en`,
        args: [agenciaId, l, i + 1, Math.round(Number(v) * 10000) / 10000],
      }));
    }
    if (statements.length) await db.batch(statements, "write");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando los parámetros de provisión" }, { status: 500 });
  }
}

export const GET = conCacheGET("parametros-provision", leerGET);
export const dynamic = "force-dynamic";
