import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { guardarParametrosFondos, listarParametrosFondos } from "../../../lib/parametros-fondos";

/**
 * GET  -> { diasCobertura, pctEncaje (en %), agencias: [{ agenciaId, agencia, maxCajero, maxCajaFuerte, guardado, cajaCorte, corte }] }
 * POST { diasCobertura, pctEncaje (en %), agencias: [{ agenciaId, maxCajero, maxCajaFuerte }] }
 *   Límites de caja por agencia (cajeros + caja fuerte) y días hábiles de pagos que deben quedar en bancos.
 */
export async function GET() {
  try {
    return NextResponse.json(await listarParametrosFondos(getDb()));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los parámetros de fondos disponibles" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { diasCobertura?: number; pctEncaje?: number; agencias?: { agenciaId?: number; maxCajero?: number; maxCajaFuerte?: number }[] };
    const dias = Number(body.diasCobertura);
    if (!Number.isFinite(dias) || dias < 0 || dias > 60) {
      return NextResponse.json({ error: "Los días de cobertura deben estar entre 0 y 60." }, { status: 400 });
    }
    const pctEncaje = Number(body.pctEncaje);
    if (!Number.isFinite(pctEncaje) || pctEncaje < 0 || pctEncaje > 100) {
      return NextResponse.json({ error: "El % de encaje debe estar entre 0 y 100." }, { status: 400 });
    }
    const agencias = (body.agencias ?? []).map((a) => ({
      agenciaId: Number(a.agenciaId), maxCajero: Number(a.maxCajero), maxCajaFuerte: Number(a.maxCajaFuerte),
    }));
    if (agencias.some((a) => !Number.isInteger(a.agenciaId) || !Number.isFinite(a.maxCajero) || !Number.isFinite(a.maxCajaFuerte) || a.maxCajero < 0 || a.maxCajaFuerte < 0)) {
      return NextResponse.json({ error: "Los montos máximos deben ser números sin negativos." }, { status: 400 });
    }
    await guardarParametrosFondos(getDb(), { agencias, diasCobertura: dias, pctEncaje });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando los parámetros de fondos disponibles" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
