import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";

/**
 * Registro de activos fijos bien por bien (reporte "Depreciación de Activos Fijos").
 *
 *  GET                                  -> lista de cargas realizadas (por ejercicio y fecha de corte)
 *  POST { ejercicio, fechaCorte, bienes } -> reemplaza la carga de ese ejercicio + fecha de corte
 *  DELETE ?ejercicio=2027&fechaCorte=2026-08-31 -> elimina esa carga
 *
 * La tabla se crea sola la primera vez. Cada fecha de corte se guarda por separado
 * (agosto, diciembre...), así queda el historial; el motor usará el corte más reciente.
 */

type Db = ReturnType<typeof getDb>;

interface Bien {
  agencia: string; codigo_activo: string; cuenta_codigo: string; categoria: string; descripcion: string;
  fecha_adquisicion: string | null; fecha_activacion: string;
  valor_contable: number; valor_historico: number; valor_residual: number;
  vida_util_meses: number; dep_acumulada: number; dep_mensual: number;
}

async function asegurarTabla(db: Db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS activos_fijos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ejercicio          INTEGER NOT NULL,
      fecha_corte        TEXT    NOT NULL,
      agencia_id         INTEGER NOT NULL REFERENCES agencias(id),
      codigo_activo      TEXT    NOT NULL,
      cuenta_codigo      TEXT    NOT NULL,
      categoria          TEXT    NOT NULL,
      descripcion        TEXT,
      fecha_adquisicion  TEXT,
      fecha_activacion   TEXT    NOT NULL,
      valor_contable     REAL    NOT NULL,
      valor_historico    REAL    NOT NULL,
      valor_residual     REAL    NOT NULL DEFAULT 0,
      vida_util_meses    INTEGER NOT NULL DEFAULT 0,
      dep_acumulada      REAL    NOT NULL DEFAULT 0,
      dep_mensual        REAL    NOT NULL DEFAULT 0,
      cargado_en         TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ejercicio, fecha_corte, codigo_activo)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activos_fijos_agencia ON activos_fijos (ejercicio, fecha_corte, agencia_id, categoria)`,
  ], "write");
}

export async function GET() {
  try {
    const db = getDb();
    await asegurarTabla(db);
    const res = await db.execute(`
      SELECT ejercicio, fecha_corte AS fechaCorte, COUNT(*) AS bienes,
             COUNT(DISTINCT agencia_id) AS agencias,
             ROUND(SUM(valor_contable), 2) AS valorContable,
             ROUND(SUM(dep_acumulada), 2) AS depAcumulada,
             ROUND(SUM(dep_mensual), 2) AS depMensual,
             MAX(cargado_en) AS cargadoEn
      FROM activos_fijos
      GROUP BY ejercicio, fecha_corte
      ORDER BY ejercicio DESC, fecha_corte DESC`);
    return NextResponse.json({ cargas: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo las cargas de activos fijos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { ejercicio?: number; fechaCorte?: string; bienes?: Bien[] };
    const { ejercicio, fechaCorte, bienes } = body;
    if (!ejercicio || !fechaCorte || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCorte)) {
      return NextResponse.json({ error: "Faltan ejercicio y fecha de corte (AAAA-MM-DD)" }, { status: 400 });
    }
    if (!Array.isArray(bienes) || bienes.length === 0) {
      return NextResponse.json({ error: "No hay bienes para guardar" }, { status: 400 });
    }

    const db = getDb();
    await asegurarTabla(db);

    // Agencias por nombre (las 10 en una sola consulta)
    const ag = await db.execute(`SELECT id, nombre FROM agencias`);
    const idPorNombre = new Map<string, number>();
    for (const r of ag.rows) idPorNombre.set(r.nombre as string, r.id as number);
    const faltantes = [...new Set(bienes.map((b) => b.agencia))].filter((n) => !idPorNombre.has(n));
    if (faltantes.length) {
      return NextResponse.json({ error: `Estas agencias no existen en la tabla agencias: ${faltantes.join(", ")}` }, { status: 400 });
    }

    // Reemplazo completo de esa fecha de corte, en una sola transacción:
    // si algo falla, no queda una carga a medias.
    const statements: { sql: string; args: (string | number | null)[] }[] = [
      { sql: `DELETE FROM activos_fijos WHERE ejercicio = ? AND fecha_corte = ?`, args: [ejercicio, fechaCorte] },
    ];
    const COLS = `(ejercicio, fecha_corte, agencia_id, codigo_activo, cuenta_codigo, categoria, descripcion,
                   fecha_adquisicion, fecha_activacion, valor_contable, valor_historico, valor_residual,
                   vida_util_meses, dep_acumulada, dep_mensual)`;
    const LOTE = 200; // 200 bienes por INSERT
    for (let i = 0; i < bienes.length; i += LOTE) {
      const lote = bienes.slice(i, i + LOTE);
      const args: (string | number | null)[] = [];
      for (const b of lote) {
        args.push(
          ejercicio, fechaCorte, idPorNombre.get(b.agencia)!, b.codigo_activo, b.cuenta_codigo, b.categoria, b.descripcion ?? "",
          b.fecha_adquisicion, b.fecha_activacion, Number(b.valor_contable) || 0, Number(b.valor_historico) || 0,
          Number(b.valor_residual) || 0, Math.round(Number(b.vida_util_meses) || 0), Number(b.dep_acumulada) || 0, Number(b.dep_mensual) || 0,
        );
      }
      statements.push({
        sql: `INSERT INTO activos_fijos ${COLS} VALUES ${lote.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        args,
      });
    }
    await db.batch(statements, "write");

    return NextResponse.json({ ok: true, guardados: bienes.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error guardando los activos fijos" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ejercicio = Number(req.nextUrl.searchParams.get("ejercicio"));
    const fechaCorte = req.nextUrl.searchParams.get("fechaCorte");
    if (!ejercicio || !fechaCorte) {
      return NextResponse.json({ error: "Faltan ejercicio y fechaCorte" }, { status: 400 });
    }
    const db = getDb();
    await db.execute({ sql: `DELETE FROM activos_fijos WHERE ejercicio = ? AND fecha_corte = ?`, args: [ejercicio, fechaCorte] });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error eliminando la carga" }, { status: 500 });
  }
}