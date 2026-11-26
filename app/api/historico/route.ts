import { NextRequest, NextResponse } from "next/server";
import { tomarInstantanea } from "../../../lib/instantaneas";
import { getDb } from "../../../lib/turso";
import { guardarHistorico, leerInventario, leerResumen, recalcularResumen } from "../../../lib/historico-db";
import { diagnosticoDesdeResumen, type Indicadores } from "../../../lib/calc/diagnostico";
import { normalizarOficina, type ArchivoHistorico } from "../../../lib/historico-parser";
import { conCacheGET } from "../../../lib/cache-motor";

/**
 * Históricos por agencia (balance mensual y estado de resultados acumulado).
 * GET ?vista=inventario → qué oficina/mes/tipo hay cargado
 * GET (por defecto)     → indicadores de diagnóstico por oficina y mes (Planificación)
 * POST { archivos: ArchivoHistorico[], recalcular? } → guarda (reemplaza cada oficina/mes/tipo); con recalcular,
 *      actualiza el resumen de esas oficinas
 * POST { accion: "recalcular", oficinas? }    → recalcula el resumen (una vez, al terminar una carga por lotes)
 * Planificación lee solo el resumen (una fila por oficina y mes), no las cuentas: casi no consume lecturas.
 */
async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    if (req.nextUrl.searchParams.get("vista") === "inventario") return NextResponse.json({ inventario: await leerInventario(db) });
    return NextResponse.json(diagnosticoDesdeResumen(await leerResumen(db) as Record<string, Record<string, Indicadores>>));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los históricos" }, { status: 500 });
  }
}
export const GET = conCacheGET("historico", leerGET);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.accion === "recalcular") {
      const r = await recalcularResumen(getDb(), Array.isArray(body.oficinas) ? body.oficinas.map(String) : undefined);
      return NextResponse.json({ ok: true, ...r });
    }
    const archivos = (body.archivos ?? []) as ArchivoHistorico[];
    if (!archivos.length) return NextResponse.json({ error: "No llegaron archivos." }, { status: 400 });
    for (const a of archivos) {
      if (!/^\d{4}-\d{2}$/.test(a.periodo) || !["BAL", "ER", "CO"].includes(a.tipo) || !normalizarOficina(a.oficina) || typeof a.cuentas !== "object") {
        return NextResponse.json({ error: `Archivo no válido: ${a.oficina} ${a.periodo}.` }, { status: 400 });
      }
    }
    const filas = await guardarHistorico(getDb(), archivos);
    if (body.recalcular) await recalcularResumen(getDb(), [...new Set(archivos.map((a) => a.oficina))]);
    return NextResponse.json({ ok: true, archivos: archivos.length, filas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando los históricos" }, { status: 500 });
  }
}

/** DELETE ?oficina=&periodo=AAAA-MM&tipo=BAL|ER|CO|ambos — un mes cargado por error. Copia restaurable en la Bitácora. */
export async function DELETE(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const oficina = normalizarOficina(q.get("oficina") ?? "");
    const periodo = q.get("periodo") ?? "";
    const tipo = q.get("tipo") ?? "ambos";
    if (!oficina || !/^\d{4}-\d{2}$/.test(periodo) || !["BAL", "ER", "CO", "ambos"].includes(tipo)) {
      return NextResponse.json({ error: "Elija la agencia, el período y qué eliminar." }, { status: 400 });
    }
    const tipos = tipo === "ambos" ? ["BAL", "ER"] : [tipo];
    const cond = `oficina = ? AND periodo = ? AND tipo IN (${tipos.map(() => "?").join(",")})`;
    const args = [oficina, periodo, ...tipos];
    const nombre = tipo === "ambos" ? "balance y estado de resultados" : tipo === "BAL" ? "balance" : tipo === "CO" ? "cuentas de orden" : "estado de resultados";
    await tomarInstantanea(`Históricos de ${oficina}, ${periodo} (${nombre})`, [{ tabla: "historico_cuentas", where: cond, args }]);
    const db = getDb();
    await db.batch([
      { sql: `DELETE FROM historico_cuentas WHERE ${cond}`, args },
      { sql: `INSERT OR IGNORE INTO historico_pendiente (oficina) VALUES (?)`, args: [oficina] },
    ], "write");
    await recalcularResumen(db, [oficina]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo eliminar el mes." }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
