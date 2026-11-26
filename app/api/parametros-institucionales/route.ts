import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin, usuarioActual } from "../../../lib/autorizacion";
import { monto, respuestaEntrada } from "../../../lib/validacion";
import { PARAMETROS_INSTITUCIONALES, guardarParametrosInstitucionales, leerParametrosInstitucionales } from "../../../lib/parametros-institucionales";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

const anioDe = async (req: NextRequest) => monto(await ejercicioDe(req), "Ejercicio", { min: 2000, max: 2100, enteros: true });

export async function GET(req: NextRequest) {
  if (!(await usuarioActual())) return NextResponse.json({ error: "Sesión expirada." }, { status: 401 });
  try {
    const ejercicio = await anioDe(req);
    return NextResponse.json({ ejercicio, definiciones: PARAMETROS_INSTITUCIONALES, valores: await leerParametrosInstitucionales(ejercicio) });
  } catch (e) {
    const r = respuestaEntrada(e); if (r) return r;
    console.error(e);
    return NextResponse.json({ error: "No se pudieron leer los parámetros." }, { status: 500 });
  }
}

/** POST { valores: { clave: número } } — solo administradores. */
export async function POST(req: NextRequest) {
  const p = await exigirAdmin("cambiar los parámetros institucionales");
  if ("error" in p) return p.error;
  try {
    const ejercicio = await anioDe(req);
    const body = await req.json();
    const valores: Record<string, number> = {};
    for (const d of PARAMETROS_INSTITUCIONALES) {
      if (body?.valores?.[d.clave] === undefined) continue;
      valores[d.clave] = monto(body.valores[d.clave], d.nombre, { min: d.min, max: d.max });
    }
    await guardarParametrosInstitucionales(ejercicio, valores);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = respuestaEntrada(e); if (r) return r;
    console.error(e);
    return NextResponse.json({ error: "No se pudieron guardar los parámetros." }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
