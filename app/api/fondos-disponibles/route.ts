import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularFondosDisponiblesMatriz } from "../../../lib/calc/orquestador";
import { calcularFlujoCuenta11 } from "../../../lib/calc/flujo-cuenta11";
import { conCacheGET } from "../../../lib/cache-motor";
import { conConsolidado } from "../../../lib/consolidado";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/**
 * GET ?agencia=Matriz&ejercicio=2027
 * Fondos disponibles (11) por subcuenta: saldo inicial del balance de partida y, de enero a
 * diciembre, el saldo final del Flujo de efectivo menos inversiones (13) y el interés por cobrar
 * de inversiones generado en el año (16). Mismo reparto que el Balance (repartoLiquidez).
 */
async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const r = await cargarInsumosAgencia(agencia, ejercicio);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const i = r.insumos;
    const f = calcularFondosDisponiblesMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agencia, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );
    // Entradas y salidas del flujo de caja (cuenta 11): el Resumen arranca desde el flujo
    const c11 = calcularFlujoCuenta11(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agencia, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );
    const fila = (id: string) => c11.resumen.find((r) => r.id === id)?.valores ?? Array(12).fill(0);
    const flujo = { saldoInicial: fila("r-si"), entradas: fila("r-te"), salidas: fila("r-ts"), saldoFinal: fila("r-sf"), diferenciaMaxima: c11.diferenciaMaxima };
    return NextResponse.json({ ...f, flujo, corteFecha: i.corteSaldos ?? null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando los fondos disponibles" }, { status: 500 });
  }
}

export const GET = conConsolidado(conCacheGET("fondos-disponibles", leerGET), (j, partes) => {
  // Lo que no se suma se recalcula con los totales: días de pagos que cubren los bancos y tasa de inversiones
  type R = { pagoDiario: number[]; diasCubiertosBancos: number[]; diasCubiertosCorte: number | null; tasaInversiones: number | null };
  const r = j.requeridos as R;
  const cuentas = j.cuentas11 as { codigo: string; saldoCorte: number; valores: number[] }[];
  const bancos = cuentas.find((c) => c.codigo === "1103");
  if (r && bancos) {
    r.diasCubiertosBancos = bancos.valores.map((b, i) => (r.pagoDiario[i] > 0 ? b / r.pagoDiario[i] : 0));
    r.diasCubiertosCorte = r.pagoDiario[0] > 0 ? bancos.saldoCorte / r.pagoDiario[0] : null;
  }
  let peso = 0, suma = 0;
  for (const p of partes) {
    const t = (p.requeridos as R | undefined)?.tasaInversiones, w = Number(p.titulosAlCorte) || 0;
    if (t !== null && t !== undefined && w > 0) { peso += w; suma += t * w; }
  }
  if (r) r.tasaInversiones = peso > 0 ? suma / peso : null;
  return j;
});
export const dynamic = "force-dynamic";

// El Consolidado calcula las 10 agencias: se da más tiempo a la función.
export const maxDuration = 60;
