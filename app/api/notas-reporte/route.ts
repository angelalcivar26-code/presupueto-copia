import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { resolverAgenciaId } from "../../../lib/insumos-agencia";

/**
 * Notas del analista de los documentos impresos (una por agencia, reporte y sección).
 * GET  ?agencia=Matriz&reporte=cartera          -> { notas: { [seccion]: texto } }
 * POST { agencia, reporte, seccion, texto }     -> guarda (texto vacío = borra)
 */
type Db = ReturnType<typeof getDb>;
let tablaLista = false;
async function asegurarTabla(db: Db) {
  if (tablaLista) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS notas_reporte (
    agencia_id     INTEGER NOT NULL REFERENCES agencias(id),
    reporte        TEXT    NOT NULL,
    seccion        TEXT    NOT NULL,
    texto          TEXT    NOT NULL,
    actualizado_en TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agencia_id, reporte, seccion)
  )`);
  tablaLista = true;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    await asegurarTabla(db);
    const agenciaId = await resolverAgenciaId(db, req.nextUrl.searchParams.get("agencia") ?? "Matriz");
    const reporte = req.nextUrl.searchParams.get("reporte") ?? "";
    const res = await db.execute({ sql: `SELECT seccion, texto FROM notas_reporte WHERE agencia_id = ? AND reporte = ?`, args: [agenciaId, reporte] });
    return NextResponse.json({ notas: Object.fromEntries(res.rows.map((r) => [r.seccion as string, r.texto as string])) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo las notas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { agencia, reporte, seccion, texto } = (await req.json()) as { agencia?: string; reporte?: string; seccion?: string; texto?: string };
    if (!reporte || !seccion) return NextResponse.json({ error: "Faltan reporte y sección" }, { status: 400 });
    const db = getDb();
    await asegurarTabla(db);
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(agencia));
    const limpio = (texto ?? "").trim().slice(0, 2000);
    if (!limpio) {
      await db.execute({ sql: `DELETE FROM notas_reporte WHERE agencia_id = ? AND reporte = ? AND seccion = ?`, args: [agenciaId, reporte, seccion] });
    } else {
      await db.execute({
        sql: `INSERT INTO notas_reporte (agencia_id, reporte, seccion, texto, actualizado_en) VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(agencia_id, reporte, seccion) DO UPDATE SET texto = excluded.texto, actualizado_en = excluded.actualizado_en`,
        args: [agenciaId, reporte, seccion, limpio],
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando la nota" }, { status: 500 });
  }
}