import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "../../../lib/autorizacion";
import { restaurarInstantanea } from "../../../lib/instantaneas";

/** POST { id } — restaura una copia tomada antes de una eliminación grande. Solo administradores. */
export async function POST(req: NextRequest) {
  const r = await exigirAdmin("restaurar copias");
  if ("error" in r) return r.error;
  const id = Number((await req.json().catch(() => ({})))?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Copia inválida." }, { status: 400 });
  try {
    const x = await restaurarInstantanea(id);
    return NextResponse.json({ ok: true, mensaje: `Restaurado: ${x.descripcion}.` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/no existe|ya se restauró/.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    console.error("[api/instantaneas]", e);
    return NextResponse.json({ error: "No se pudo restaurar la copia." }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
