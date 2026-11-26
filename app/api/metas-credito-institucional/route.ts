import { NextRequest, NextResponse } from "next/server";
import { monto as validarMonto, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";

export async function GET() {
  try {
    const db = getDb();
    const res = await db.execute({
      sql: `SELECT meta_junior, meta_senior, meta_master, minimo_operaciones, relacion_mora FROM metas_credito_institucional WHERE id = 1`,
    });
    // ejercicio nuevo sin metas todavía: se muestran en cero para ingresarlas (el cálculo avisa que faltan hasta guardarlas)
    if (res.rows.length === 0) {
      return NextResponse.json({ meta_junior: 0, meta_senior: 0, meta_master: 0, minimo_operaciones: 0, relacion_mora: 0, sinDatos: true });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo metas institucionales" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { meta_junior, meta_senior, meta_master, minimo_operaciones, relacion_mora } = body;
    if (
      meta_junior === undefined || meta_senior === undefined ||
      meta_master === undefined || minimo_operaciones === undefined ||
      relacion_mora === undefined
    ) {
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    }

    const db = getDb();
    await db.execute({
      // crea la fila si el ejercicio todavía no la tiene (ejercicio creado en blanco)
      sql: `INSERT INTO metas_credito_institucional (id, meta_junior, meta_senior, meta_master, minimo_operaciones, relacion_mora) VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET meta_junior = excluded.meta_junior, meta_senior = excluded.meta_senior, meta_master = excluded.meta_master,
              minimo_operaciones = excluded.minimo_operaciones, relacion_mora = excluded.relacion_mora`,
      args: [
        validarMonto(meta_junior, "Meta Junior", { min: 0 }), validarMonto(meta_senior, "Meta Senior", { min: 0 }),
        validarMonto(meta_master, "Meta Master", { min: 0 }), validarMonto(minimo_operaciones, "Mínimo de operaciones", { min: 0, enteros: true }),
        validarMonto(relacion_mora, "Interés de mora", { min: 0, max: 1 }),
      ],
    });
    return NextResponse.json({ actualizado: true });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando metas institucionales" }, { status: 500 });
  }
}