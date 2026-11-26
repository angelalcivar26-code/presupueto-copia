import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

/** GET ?agencia=Matriz -- lista los asesores activos e inactivos de esa agencia. */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    // Consolidado (solo lectura): asesores de las 10 agencias
    if (agenciaNombre === "Consolidado") {
      const r = await db.execute(`SELECT o.id, o.usuario, o.rango, o.activo, a.nombre AS agencia
                                  FROM oficiales_credito o JOIN agencias a ON a.id = o.agencia_id ORDER BY o.rango, o.usuario`);
      return NextResponse.json({ oficiales: r.rows, consolidado: true });
    }
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    const res = await db.execute({
      sql: `SELECT id, usuario, rango, activo FROM oficiales_credito WHERE agencia_id = ? ORDER BY rango, usuario`,
      args: [agenciaId],
    });

    return NextResponse.json({ oficiales: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo asesores de crédito" }, { status: 500 });
  }
}

/** POST { agencia, usuario, rango } -- crea un asesor nuevo. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agencia, usuario, rango } = body;
    if (!usuario || !rango) {
      return NextResponse.json({ error: "Faltan campos: usuario y rango son obligatorios" }, { status: 400 });
    }
    if (!["JUNIOR", "SENIOR", "MASTER"].includes(rango)) {
      return NextResponse.json({ error: "rango debe ser JUNIOR, SENIOR o MASTER" }, { status: 400 });
    }

    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(agencia));

    const res = await db.execute({
      sql: `INSERT INTO oficiales_credito (agencia_id, usuario, rango, activo) VALUES (?, ?, ?, 1)`,
      args: [agenciaId, usuario.trim(), rango],
    });

    return NextResponse.json({ id: Number(res.lastInsertRowid) });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error creando el asesor" }, { status: 500 });
  }
}

/** PATCH { id, rango?, activo? } -- cambia de rango o da de baja/reactiva. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, rango, activo } = body;
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

    const db = getDb();
    if (rango) {
      if (!["JUNIOR", "SENIOR", "MASTER"].includes(rango)) {
        return NextResponse.json({ error: "rango debe ser JUNIOR, SENIOR o MASTER" }, { status: 400 });
      }
      await db.execute({ sql: `UPDATE oficiales_credito SET rango = ? WHERE id = ?`, args: [rango, id] });
    }
    if (activo !== undefined) {
      await db.execute({ sql: `UPDATE oficiales_credito SET activo = ? WHERE id = ?`, args: [activo ? 1 : 0, id] });
    }
    return NextResponse.json({ actualizado: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error actualizando el asesor" }, { status: 500 });
  }
}

/** DELETE ?id=123 -- elimina definitivamente (no solo da de baja). */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

    const db = getDb();
    await db.execute({ sql: `DELETE FROM oficiales_credito WHERE id = ?`, args: [id] });
    return NextResponse.json({ eliminado: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error eliminando el asesor" }, { status: 500 });
  }
}