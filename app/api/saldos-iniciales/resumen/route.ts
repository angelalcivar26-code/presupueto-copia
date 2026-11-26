import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/turso";

/**
 * Resumen de cargas existentes en saldos_iniciales: una fila por
 * agencia+año+mes con cuántas cuentas tiene y la suma total de sus
 * montos. Usado por la pantalla de Carga de Datos para detectar:
 * - "ya existe una carga para esta agencia y período"
 * - "este archivo es idéntico a uno ya cargado en otra agencia/período"
 * sin tener que traer todos los saldos completos.
 */
export async function GET() {
  try {
    const db = getDb();
    const res = await db.execute({
      sql: `SELECT a.codigo AS agencia_codigo, si.anio AS anio, si.mes AS mes,
                   COUNT(*) AS cantidad, SUM(si.monto) AS suma
            FROM saldos_iniciales si
            JOIN agencias a ON a.id = si.agencia_id
            GROUP BY si.agencia_id, si.anio, si.mes`,
      args: [],
    });
    return NextResponse.json({ resumen: res.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo resumen de saldos" }, { status: 500 });
  }
}