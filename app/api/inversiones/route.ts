import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, respuestaEntrada } from "../../../lib/validacion";
import { conConsolidado } from "../../../lib/consolidado";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId, resolverCorteSaldos } from "../../../lib/insumos-agencia";
import { proyectarInversiones } from "../../../lib/calc/inversiones";
import { asegurarTablasInversiones, leerInversiones } from "../../../lib/inversiones";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 *   titulos, parametros, proyeccion (lib/calc/inversiones.ts), corte, saldo13Corte,
 *   cuentas13 (subcuentas de la 13 del catálogo). Fondos disponibles (11) tiene su propia pantalla.
 * POST { accion: "guardar", agencia, titulo }            -> crea o actualiza un título (id opcional)
 * POST { accion: "eliminar", agencia, id }               -> borra un título
 * POST { accion: "parametros", agencia, pctRetencion, baseDias }
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const agenciaId = await resolverAgenciaId(db, agencia);
    const corte = await resolverCorteSaldos(db, agenciaId);
    const fechaCorte = new Date(Date.UTC(corte.anio, corte.mes, 0)).toISOString().slice(0, 10); // último día del mes del corte
    const { titulos, parametros, guardados } = await leerInversiones(db, agenciaId);
    const proyeccion = proyectarInversiones(titulos, parametros, ejercicio, fechaCorte);

    const [s13, cat] = await Promise.all([
      db.execute({ sql: `SELECT cuenta_codigo, monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ? AND cuenta_codigo LIKE '13%'`, args: [agenciaId, corte.anio, corte.mes] }),
      db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo LIKE '13%' AND length(codigo) >= 4 ORDER BY codigo`).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);
    const saldosCorte = Object.fromEntries(s13.rows.map((r) => [String(r.cuenta_codigo), Number(r.monto) || 0]));
    const cuentas13 = cat.rows.map((r) => ({ codigo: String(r.codigo), nombre: String(r.nombre), saldoCorte: saldosCorte[String(r.codigo)] ?? null }));

    // Cada título lleva su agencia: en el Consolidado se agrupan y filtran por agencia
    return NextResponse.json({
      titulos: titulos.map((t) => ({ ...t, agencia })), parametros, parametrosGuardados: guardados,
      proyeccion: { ...proyeccion, titulos: proyeccion.titulos.map((t) => ({ ...t, agencia })) }, corte, fechaCorte,
      saldo13Corte: saldosCorte["13"] ?? null, saldosCorte, cuentas13,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo las inversiones" }, { status: 500 });
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    await asegurarTablasInversiones(db);
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(body.agencia));

    if (body.accion === "eliminar") {
      await db.execute({ sql: `DELETE FROM inversiones WHERE id = ? AND agencia_id = ?`, args: [Number(body.id), agenciaId] });
      return NextResponse.json({ ok: true });
    }

    if (body.accion === "parametros") {
      const pct = Number(body.pctRetencion), base = Number(body.baseDias);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return NextResponse.json({ error: "La retención debe estar entre 0 % y 100 %" }, { status: 400 });
      if (base !== 360 && base !== 365) return NextResponse.json({ error: "La base debe ser 360 o 365 días" }, { status: 400 });
      await db.execute({
        sql: `INSERT INTO inversiones_parametros (agencia_id, pct_retencion, base_dias, actualizado_en) VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(agencia_id) DO UPDATE SET pct_retencion = excluded.pct_retencion, base_dias = excluded.base_dias, actualizado_en = excluded.actualizado_en`,
        args: [agenciaId, pct, base],
      });
      return NextResponse.json({ ok: true });
    }

    if (body.accion === "guardar") {
      const t = body.titulo ?? {};
      const errores: string[] = [];
      if (!String(t.institucion ?? "").trim()) errores.push("la institución");
      if (!String(t.cuentaCodigo ?? "").startsWith("13")) errores.push("una cuenta contable del grupo 13");
      if (!FECHA.test(String(t.fechaInicio)) || !FECHA.test(String(t.fechaFin)) || String(t.fechaFin) <= String(t.fechaInicio)) errores.push("fechas válidas (fin después de inicio)");
      if (!(Number(t.monto) > 0)) errores.push("un monto mayor a 0");
      if (!(Number(t.tasaAnual) >= 0 && Number(t.tasaAnual) <= 100)) errores.push("una tasa entre 0 % y 100 %");
      const cancela = t.cancelaMes === null || t.cancelaMes === "" || t.cancelaMes === undefined ? null : Number(t.cancelaMes);
      if (cancela !== null && !(cancela >= 1 && cancela <= 12)) errores.push("un mes de cancelación entre 1 y 12");
      if (errores.length) return NextResponse.json({ error: `Falta ${errores.join(", ")}.` }, { status: 400 });

      const args = [String(t.institucion).trim(), String(t.sector ?? ""), String(t.cuentaCodigo), String(t.cuentaNombre ?? ""),
        String(t.fechaInicio), String(t.fechaFin), Number(t.monto), Number(t.tasaAnual), cancela];
      if (t.id) {
        await db.execute({
          sql: `UPDATE inversiones SET institucion = ?, sector = ?, cuenta_codigo = ?, cuenta_nombre = ?, fecha_inicio = ?, fecha_fin = ?,
                monto = ?, tasa_anual = ?, cancela_mes = ?, actualizado_en = datetime('now') WHERE id = ? AND agencia_id = ?`,
          args: [...args, Number(t.id), agenciaId],
        });
      } else {
        await db.execute({
          sql: `INSERT INTO inversiones (institucion, sector, cuenta_codigo, cuenta_nombre, fecha_inicio, fecha_fin, monto, tasa_anual, cancela_mes, agencia_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [...args, agenciaId],
        });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando la inversión" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("inversiones", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
