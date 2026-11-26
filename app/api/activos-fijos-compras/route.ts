import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * Lista las compras (Plan de Adquisiciones) de una categoría de activo fijo
 * (identificada por su código de cuenta real, ej. "1802" Edificios).
 *
 * Cada compra vive como una línea identificada por su descripción única
 * (para que dos compras nunca choquen entre sí, aunque las haya pedido el
 * mismo departamento real). Puede estar en dos modos:
 *  - "prorrateado": el monto salió de presupuesto_resumen y se repartió
 *    entre las 10 agencias por su % de Activo -- se suman las 10 filas de
 *    cada mes para mostrar el monto total de esa compra.
 *  - "directo": el monto completo se guardó en UNA sola agencia (compra
 *    exclusiva de esa sucursal, ej. un terreno para El Guabo) -- no se
 *    reparte nada.
 */
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const concepto = req.nextUrl.searchParams.get("concepto");
    const ejercicio = await ejercicioDe(req);
    if (!concepto) {
      return NextResponse.json({ error: "Falta el parámetro concepto" }, { status: 400 });
    }

    // Una sola lectura para todas las compras de la categoría (antes: una lectura por compra).
    // En las compras prorrateadas el departamento quedó en la nota de la línea institucional
    // (presupuesto_resumen); se toma de ahí cuando la fila por agencia no la tiene.
    const filasRes = await db.execute({
      sql: `SELECT pd.id, pd.departamento, pd.mes, pd.monto, COALESCE(NULLIF(pd.nota, ''), pr.nota) AS nota, pd.modo, a.nombre AS agencia
            FROM presupuesto_departamental pd
            JOIN agencias a ON a.id = pd.agencia_id
            LEFT JOIN presupuesto_resumen pr ON pr.id = pd.resumen_id
            WHERE pd.concepto = ? AND pd.ejercicio = ?
            ORDER BY pd.departamento, pd.mes`,
      args: [concepto, ejercicio],
    });
    const porDescripcion = new Map<string, typeof filasRes.rows>();
    for (const r of filasRes.rows) {
      const d = r.departamento as string;
      if (!porDescripcion.has(d)) porDescripcion.set(d, []);
      porDescripcion.get(d)!.push(r);
    }

    const compras = [];
    for (const [descripcion, filas] of porDescripcion) {
      if (filas.length === 0) continue;

      const modo = (filas[0].modo as string) ?? "directo";
      const montosPorMes = Array(12).fill(0);
      const idsPorMes: (number | null)[] = Array(12).fill(null);

      if (modo === "prorrateado") {
        // El mismo mes se repite 10 veces (una fila por agencia) -- se suman
        // para mostrar el monto total real de la compra ese mes.
        for (const r of filas) {
          montosPorMes[(r.mes as number) - 1] += r.monto as number;
          idsPorMes[(r.mes as number) - 1] = r.id as number;
        }
      } else {
        // Directo: una sola agencia, sin repartir.
        for (const r of filas) {
          montosPorMes[(r.mes as number) - 1] = r.monto as number;
          idsPorMes[(r.mes as number) - 1] = r.id as number;
        }
      }

      compras.push({
        descripcion,
        departamentoReal: (filas[0].nota as string) ?? "",
        modo,
        agencia: modo === "directo" ? (filas[0].agencia as string) : "Toda la cooperativa",
        montosPorMes,
        idsPorMes,
      });
    }

    return NextResponse.json({ compras });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo las compras" }, { status: 500 });
  }
}