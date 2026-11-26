import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { COOKIE_SESION, leerToken } from "../../../lib/sesion";
import { leerBases, leerTrayectoria, leerAsesoresYPlazos, leerConfigPlan, guardarConfigPlan, leerEscenarios, guardarEscenario, borrarEscenario, aprobarEscenario, leerParametrosPlan } from "../../../lib/planificacion-db";

/**
 * PLANIFICACIÓN (Examen, Plan de metas, Simulador).
 * GET  → punto de partida de cada oficina, trayectoria mensual, asesores y plazos, referencias/supuestos y escenarios
 *        guardados. El cálculo (modelo y plan) corre en el navegador: mover una palanca no consulta la base.
 * POST { accion: "config", config }              → referencias, plazos, topes, costo por asesor
 * POST { accion: "escenario", escenario }        → guarda (o actualiza) un escenario del simulador
 * POST { accion: "aprobarEscenario", id }        → queda como Aprobado; el aprobado anterior pasa a Reemplazado
 * POST { accion: "borrarEscenario", id }
 */
export async function GET() {
  try {
    const db = getDb();
    const [bases, trayectoria, ap, config, escenarios, param] = await Promise.all([leerBases(db), leerTrayectoria(db), leerAsesoresYPlazos(db), leerConfigPlan(db), leerEscenarios(db), leerParametrosPlan(db)]);
    return NextResponse.json({ bases, trayectoria, asesores: ap.asesores, plazosAgencia: ap.plazos, config, escenarios, parametros: param.porAgencia, metasAsesor: param.metas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo la planificación" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    if (body.accion === "config") { await guardarConfigPlan(db, body.config ?? {}); return NextResponse.json({ ok: true }); }
    if (body.accion === "escenario") {
      const e = body.escenario;
      if (!e?.agencia || !String(e.nombre ?? "").trim() || !e.palancas) return NextResponse.json({ error: "Falta el nombre del escenario." }, { status: 400 });
      const sesion = await leerToken(req.cookies.get(COOKIE_SESION)?.value).catch(() => null);
      const estado = ["Borrador", "Aprobado", "Reemplazado"].includes(e.estado) ? e.estado : "Borrador";
      await guardarEscenario(db, { id: e.id, agencia: String(e.agencia), nombre: String(e.nombre).trim().slice(0, 80), palancas: e.palancas, meta: e.meta ?? null, autor: sesion?.usuario ?? null, estado });
      return NextResponse.json({ ok: true });
    }
    if (body.accion === "aprobarEscenario") { await aprobarEscenario(db, Number(body.id)); return NextResponse.json({ ok: true }); }
    if (body.accion === "borrarEscenario") { await borrarEscenario(db, Number(body.id)); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando la planificación" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
