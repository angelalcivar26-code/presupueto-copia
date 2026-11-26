import { NextRequest, NextResponse } from "next/server";
import { agenciaParaGuardar, mes as mesValido, monto as validarMonto, montoOpcional, respuestaEntrada } from "../../../lib/validacion";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { asegurarColumnasCredito, sqlGuardarCredito } from "../../../lib/parametros-credito-db";
import { leerRealParametrosCredito } from "../../../lib/referencia-cartera-db";
import type { FilaParametroCredito } from "../../../lib/calc/orquestador";

type Linea = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";

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
    await asegurarColumnasCredito(db);

    const res = await db.execute({
      sql: `SELECT linea, mes, modo_colocacion, monto_promedio, tasa_interes_anual,
                   pct_recuperacion_periodo, tasa_efectividad_recup, num_operaciones_conceder,
                   tasa_recuperacion_vencida, pct_distribucion, pct_pase_riesgo, pct_precancelacion, pct_precancelacion_vencida
            FROM parametros_credito WHERE agencia_id = ? ORDER BY linea, mes`,
      args: [agenciaId],
    });

    // valores reales de la agencia (Históricos y reporte de recuperación) para comparar en Tasas y recuperación
    const real = await leerRealParametrosCredito(db, agenciaNombre, res.rows as unknown as FilaParametroCredito[]).catch((e) => { console.error("[parametros-credito] real", e); return null; });
    return NextResponse.json({ filas: res.rows, real });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo parámetros de crédito" }, { status: 500 });
  }
}

interface FilaEntrada {
  linea: Linea;
  mes: number;
  monto_promedio: number;
  tasa_interes_anual: number;
  pct_recuperacion_periodo: number;
  tasa_efectividad_recup: number;
  num_operaciones_conceder: number;
  tasa_recuperacion_vencida: number;
  pct_distribucion: number | null;
  pct_pase_riesgo?: number | null;
  pct_precancelacion?: number | null;
  pct_precancelacion_vencida?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { filas: FilaEntrada[]; agencia?: string };
    if (!Array.isArray(body.filas)) {
      return NextResponse.json({ error: "Se esperaba { filas: [...] }" }, { status: 400 });
    }

    // Todo se revisa antes de grabar: tasas y porcentajes entre 0 y 1 (0 % y 100 %), montos sin negativos
    const filas = body.filas.map((f) => {
      const m = `mes ${f.mes}`;
      return {
        ...f,
        mes: mesValido(f.mes),
        monto_promedio: validarMonto(f.monto_promedio, `Monto promedio (${m})`, { min: 0, vacioCero: true }),
        tasa_interes_anual: validarMonto(f.tasa_interes_anual, `Tasa de interés (${m})`, { min: 0, max: 1, vacioCero: true }),
        pct_recuperacion_periodo: validarMonto(f.pct_recuperacion_periodo, `% de recuperación (${m})`, { min: 0, max: 1, vacioCero: true }),
        tasa_efectividad_recup: validarMonto(f.tasa_efectividad_recup, `Efectividad de la recuperación (${m})`, { min: 0, max: 1, vacioCero: true }),
        num_operaciones_conceder: validarMonto(f.num_operaciones_conceder, `Operaciones (${m})`, { min: 0, vacioCero: true }),
        tasa_recuperacion_vencida: validarMonto(f.tasa_recuperacion_vencida, `Recuperación de vencida (${m})`, { min: 0, max: 1, vacioCero: true }),
        pct_distribucion: montoOpcional(f.pct_distribucion, `% de distribución (${m})`, { min: 0, max: 1 }),
        pct_pase_riesgo: montoOpcional(f.pct_pase_riesgo, `% de pase a riesgo (${m})`, { min: 0, max: 1 }),
        pct_precancelacion: montoOpcional(f.pct_precancelacion, `% de precancelación (${m})`, { min: 0, max: 1 }),
        ...("pct_precancelacion_vencida" in f ? { pct_precancelacion_vencida: montoOpcional(f.pct_precancelacion_vencida, `% de precancelación de cartera en riesgo (${m})`, { min: 0, max: 1 }) } : {}),
      };
    });
    const db = getDb();
    const agenciaId = await resolverAgenciaId(db, agenciaParaGuardar(body.agencia));

    await asegurarColumnasCredito(db);
    const statements = filas.map((f) => sqlGuardarCredito(agenciaId, f));

    await db.batch(statements, "write");

    return NextResponse.json({ ok: true, guardadas: body.filas.length });
  } catch (err) {
    const entrada = respuestaEntrada(err);
    if (entrada) return entrada;
    console.error(err);
    return NextResponse.json({ error: "Error guardando parámetros de crédito" }, { status: 500 });
  }
}