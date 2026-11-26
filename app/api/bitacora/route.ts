import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "../../../lib/autorizacion";
import { leerBitacora } from "../../../lib/bitacora";

/** GET ?desde=AAAA-MM-DD&hasta=…&usuario=…&pagina=1 — 50 por página. ?todo=1 para descargar (hasta 20.000). Solo administradores. */
export async function GET(req: NextRequest) {
  const r = await exigirAdmin("ver la bitácora");
  if ("error" in r) return r.error;
  const q = req.nextUrl.searchParams;
  const fecha = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(k) ?? "") ? q.get(k)! : undefined);
  const todo = q.get("todo") === "1";
  const pagina = Math.max(1, Number(q.get("pagina")) || 1);
  try {
    const d = await leerBitacora({
      desde: fecha("desde"), hasta: fecha("hasta"), usuario: q.get("usuario")?.trim() || undefined,
      limite: todo ? 20000 : 50, desplazamiento: todo ? 0 : (pagina - 1) * 50,
    });
    return NextResponse.json(d, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/bitacora]", e);
    return NextResponse.json({ error: "No se pudo leer la bitácora." }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
