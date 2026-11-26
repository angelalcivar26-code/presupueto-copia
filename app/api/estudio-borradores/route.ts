import { NextRequest, NextResponse } from "next/server";
import { getDbDirecto } from "../../../lib/turso";
import { ejercicioDe, tablaDe } from "../../../lib/ejercicio-pedido";
import { traerDelAnioBase } from "../../../lib/copia-ejercicio";

/**
 * Borradores de la Propuesta del Estudio de agencia (por agencia y cuenta), para seguir el trabajo desde cualquier equipo.
 * No son datos del presupuesto: se guardan sin tocar la versión de los datos (no obligan a recalcular nada).
 * Cada ejercicio tiene los suyos (estudio_borradores_<año>; el año base usa la tabla de siempre).
 * GET ?agencia=X → { borradores: { "14": {...}, "21": {...} } } · POST { agencia, cuenta, datos | null }
 */
type Db = ReturnType<typeof getDbDirecto>;
const listas = new Map<string, Promise<unknown>>();
/** Tabla de borradores del ejercicio (se crea la primera vez). */
async function tabla(db: Db, ejercicio: number): Promise<string> {
  const base = "estudio_borradores", nombre = tablaDe(base, ejercicio);
  if (!listas.has(nombre)) {
    const p = (async () => {
      await db.execute(`CREATE TABLE IF NOT EXISTS ${base} (
        agencia TEXT NOT NULL, cuenta TEXT NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL, PRIMARY KEY (agencia, cuenta))`);
      if (nombre !== base) {
        await traerDelAnioBase(base, ejercicio);
        await db.execute(`CREATE TABLE IF NOT EXISTS ${nombre} (
          agencia TEXT NOT NULL, cuenta TEXT NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL, PRIMARY KEY (agencia, cuenta))`);
      }
    })();
    listas.set(nombre, p);
    p.catch(() => listas.delete(nombre));
  }
  await listas.get(nombre);
  return nombre;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDbDirecto(); const t = await tabla(db, await ejercicioDe(req));
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "";
    const r = await db.execute({ sql: `SELECT cuenta, datos FROM ${t} WHERE agencia = ?`, args: [agencia] });
    const borradores: Record<string, unknown> = {};
    for (const x of r.rows) { try { borradores[String(x.cuenta)] = JSON.parse(String(x.datos)); } catch { /* dañado: se ignora */ } }
    return NextResponse.json({ borradores });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error leyendo los borradores" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const agencia = String(b.agencia ?? ""), cuenta = String(b.cuenta ?? "");
    if (!agencia || !cuenta) return NextResponse.json({ error: "Falta la agencia o la cuenta" }, { status: 400 });
    const db = getDbDirecto(); const t = await tabla(db, await ejercicioDe(req, b));
    if (b.datos === null || b.datos === undefined) await db.execute({ sql: `DELETE FROM ${t} WHERE agencia = ? AND cuenta = ?`, args: [agencia, cuenta] });
    else {
      const texto = JSON.stringify(b.datos);
      if (texto.length > 50000) return NextResponse.json({ error: "Borrador demasiado grande" }, { status: 400 });
      await db.execute({ sql: `INSERT INTO ${t} (agencia, cuenta, datos, actualizado) VALUES (?, ?, ?, ?)
        ON CONFLICT(agencia, cuenta) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado`, args: [agencia, cuenta, texto, new Date().toISOString()] });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error guardando el borrador" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
