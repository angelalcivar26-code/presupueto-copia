import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { estadoBienEnEjercicio } from "../../../lib/calc/activo-fijo";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

/**
 * GET ?agencia=Matriz&categoria=Equipos de Computación&ejercicio=2027[&todos=1]
 * Lista bien por bien del corte más reciente, con su proyección en el año.
 * Por defecto solo los que se siguen depreciando; con todos=1 también los ya
 * depreciados.
 */
async function leerGETAgencia(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const categoria = req.nextUrl.searchParams.get("categoria") ?? "";
    const ejercicio = await ejercicioDe(req);
    const todos = req.nextUrl.searchParams.get("todos") === "1";
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    let fechaCorte: string | null = null;
    try {
      const corte = await db.execute({
        sql: `SELECT MAX(fecha_corte) AS fecha FROM activos_fijos WHERE agencia_id = ? AND ejercicio = ?`,
        args: [agenciaId, ejercicio],
      });
      fechaCorte = (corte.rows[0]?.fecha as string | null) ?? null;
    } catch {
      fechaCorte = null; // la tabla todavía no existe
    }
    if (!fechaCorte) return NextResponse.json({ fechaCorte: null, bienes: [], ocultos: 0 });

    const res = await db.execute({
      sql: `SELECT codigo_activo, descripcion, fecha_activacion, valor_contable, valor_historico, valor_residual,
                   vida_util_meses, dep_acumulada, dep_mensual, categoria
            FROM activos_fijos
            WHERE agencia_id = ? AND ejercicio = ? AND fecha_corte = ? AND categoria = ?
            ORDER BY codigo_activo`,
      args: [agenciaId, ejercicio, fechaCorte, categoria],
    });

    let ocultos = 0;
    const bienes = [];
    for (const r of res.rows) {
      const b = {
        categoria: r.categoria as string,
        valor_contable: Number(r.valor_contable) || 0,
        valor_historico: Number(r.valor_historico) || 0,
        valor_residual: Number(r.valor_residual) || 0,
        vida_util_meses: Number(r.vida_util_meses) || 0,
        dep_acumulada: Number(r.dep_acumulada) || 0,
        dep_mensual: Number(r.dep_mensual) || 0,
      };
      const e = estadoBienEnEjercicio(b, fechaCorte, ejercicio);
      if (e.depreciadoAntes && !todos) { ocultos++; continue; }
      bienes.push({
        codigo: r.codigo_activo as string,
        descripcion: (r.descripcion as string) ?? "",
        fechaActivacion: r.fecha_activacion as string,
        costo: b.valor_contable,
        cuota: Math.round(e.cuota * 100) / 100,
        cuotaCalculada: b.dep_mensual <= 0 && e.cuota > 0,
        netoInicio: e.netoInicio,
        depAnio: e.depEjercicio,
        netoFin: e.netoFin,
        termina: e.termina,
        terminaEnAnio: e.mesTerminaEjercicio !== null,
        depreciado: e.depreciadoAntes,
      });
    }
    // Primero los que terminan antes
    bienes.sort((a, b) => (a.termina ?? "9999").localeCompare(b.termina ?? "9999") || a.codigo.localeCompare(b.codigo));
    return NextResponse.json({ fechaCorte, bienes, ocultos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los bienes de activos fijos" }, { status: 500 });
  }
}

// Consolidado = suma de las 10 agencias (lib/consolidado.ts)
export const GET = conConsolidado(leerGETAgencia);
export const maxDuration = 60;
