import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, mes as mesValido, monto as validarMonto, montoOpcional, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";

async function resolverAgenciaId(db: ReturnType<typeof getDb>, nombre: string | null): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const res = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (res.rows.length === 0) throw new Error(`Agencia "${nombre}" no existe en la tabla agencias`);
  return res.rows[0].id as number;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const agenciaId = await resolverAgenciaId(db, agenciaNombre);

    const res = await db.execute({
      sql: `SELECT producto, mes, tasa_interes_anual, pct_ingresos, pct_retiros, pct_liquidez,
                   pct_cancelaciones, ratio_renovaciones
            FROM parametros_captaciones WHERE agencia_id = ?`,
      args: [agenciaId],
    });

    return NextResponse.json({ filas: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo parámetros de captaciones" }, { status: 500 });
  }
}

interface FilaEntrada {
  producto: "VISTA" | "CRECER" | "DPF";
  mes: number;
  tasa_interes_anual: number;
  pct_ingresos: number | null;
  pct_retiros: number | null;
  pct_liquidez: number;
  pct_cancelaciones: number | null;
  ratio_renovaciones: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { filas: FilaEntrada[]; agencia?: string };
    if (!Array.isArray(body.filas)) {
      return NextResponse.json({ error: "Se esperaba { filas: [...] }" }, { status: 400 });
    }

    // Todo se revisa antes de grabar: % entre 0 y 1; la relación de renovaciones entre 0 y 5 (500 %)
    const filas = body.filas.map((f) => {
      const m = `${f.producto} mes ${f.mes}`;
      return {
        ...f,
        mes: mesValido(f.mes),
        tasa_interes_anual: validarMonto(f.tasa_interes_anual, `Tasa (${m})`, { min: 0, max: 1, vacioCero: true }),
        pct_ingresos: montoOpcional(f.pct_ingresos, `% de depósitos (${m})`, { min: 0, max: 1 }),
        pct_retiros: montoOpcional(f.pct_retiros, `% de retiros (${m})`, { min: 0, max: 1 }),
        pct_liquidez: montoOpcional(f.pct_liquidez, `% de liquidez (${m})`, { min: 0, max: 1 }),
        pct_cancelaciones: montoOpcional(f.pct_cancelaciones, `% de cancelaciones (${m})`, { min: 0, max: 1 }),
        ratio_renovaciones: montoOpcional(f.ratio_renovaciones, `Renovaciones (${m})`, { min: 0, max: 5 }),
      };
    });
    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(body.agencia));

    const statements = filas.map((fila) => ({
      sql: `INSERT INTO parametros_captaciones
              (agencia_id, producto, mes, tasa_interes_anual, pct_ingresos, pct_retiros, pct_liquidez,
               pct_cancelaciones, ratio_renovaciones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(agencia_id, producto, mes) DO UPDATE SET
              tasa_interes_anual = excluded.tasa_interes_anual,
              pct_ingresos = excluded.pct_ingresos,
              pct_retiros = excluded.pct_retiros,
              pct_liquidez = excluded.pct_liquidez,
              pct_cancelaciones = excluded.pct_cancelaciones,
              ratio_renovaciones = excluded.ratio_renovaciones`,
      args: [
        agenciaId, fila.producto, fila.mes, fila.tasa_interes_anual, fila.pct_ingresos, fila.pct_retiros,
        fila.pct_liquidez, fila.pct_cancelaciones, fila.ratio_renovaciones,
      ],
    }));

    await db.batch(statements, "write");

    return NextResponse.json({ ok: true, guardadas: body.filas.length });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando parámetros de captaciones" }, { status: 500 });
  }
}