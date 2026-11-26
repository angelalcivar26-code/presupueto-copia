import { NextRequest, NextResponse } from "next/server";
import { conConsolidado } from "../../../lib/consolidado";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularDetalleCaptacionesMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Obligaciones con el público (grupo 21) proyectadas mes a mes.
 *
 *  detalle : { vista, crecer, dpf } -> 12 meses con saldos, movimientos y los parámetros usados
 *  corte   : balance usado como punto de partida (el más reciente cargado de la agencia)
 *  control : saldo del grupo 21 en ese balance vs. lo que proyecta el motor
 *            (vista 21013505+21013510+21013535, crecer 21013515, plazo fijo 2103).
 *            "otras" = cuentas del grupo 21 que el motor no proyecta.
 */
const CUENTAS = {
  vista: ["21013505", "21013510", "21013535"],
  crecer: ["21013515"],
  dpf: ["2103"],
};

async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const ins = await cargarInsumosAgencia(agencia, ejercicio);
    if (!ins.ok) return NextResponse.json({ error: ins.error }, { status: 400 });

    const { saldos, paramsCaptaciones, corteSaldos } = ins.insumos;
    const base = calcularDetalleCaptacionesMatriz(saldos, paramsCaptaciones);
    // Interés causado del mes (4101) ya calculado por agencia: en el Consolidado se suma, así cada agencia conserva su
    // propia tasa (recalcularlo con la tasa de una sola agencia sobre el saldo consolidado no cuadra con el Estado de resultados).
    type Mes = { saldoInicial: number; saldoFinal: number; capitalizacionInteres?: number; tasas: { tasaInteresAnual: number } };
    const conInteres = (rs: Mes[], dpf: boolean) => rs.map((r) => ({
      ...r, interesCausado: dpf ? ((r.saldoInicial + r.saldoFinal) / 2) * (r.tasas.tasaInteresAnual / 12) : (r.capitalizacionInteres ?? 0),
    }));
    const b = base as unknown as Record<"vista" | "crecer" | "dpf", Mes[]>;
    const detalle = { ...base, vista: conInteres(b.vista, false), crecer: conInteres(b.crecer, false), dpf: conInteres(b.dpf, true) };

    const sumar = (cs: string[]) => cs.reduce((a, c) => a + (Number(saldos[c]) || 0), 0);
    const proyectado = sumar(CUENTAS.vista) + sumar(CUENTAS.crecer) + sumar(CUENTAS.dpf);
    const grupo21 = saldos["21"] !== undefined ? Number(saldos["21"]) : null;

    return NextResponse.json({
      detalle,
      corte: corteSaldos,
      control: {
        grupo21,
        vista: sumar(CUENTAS.vista),
        crecer: sumar(CUENTAS.crecer),
        dpf: sumar(CUENTAS.dpf),
        proyectado,
        otras: grupo21 === null ? null : grupo21 - proyectado,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando las obligaciones con el público" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("captaciones", leerGET));
export const dynamic = "force-dynamic";
export const maxDuration = 60;
