import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularBalanceGeneralMatriz, cuentasNoLeidas, detallarCuentasSinMovimiento, detallarSubcuentaUnica, incorporarCuentasNoLeidas } from "../../../lib/calc/orquestador";
import { nombrarCuentas } from "../../../lib/nombres-cuentas";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { conConsolidado } from "../../../lib/consolidado";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { CODIGOS_CORTE, CODIGOS_CORTE_ORDEN } from "../../../lib/calc/indicadores-presupuesto";

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const resultado = calcularBalanceGeneralMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    // Cuentas del corte que el motor no proyecta: se mantienen con su saldo del corte (así el Balance cuadra).
    const sinLeer = cuentasNoLeidas(i.saldos);
    if (sinLeer.length) {
      const grupos = [...new Set(sinLeer.flatMap((x) => [2, 4, 6, 8, 10].filter((l) => l < x.codigo.length).map((l) => x.codigo.slice(0, l))))];
      const codigos = [...sinLeer.map((x) => x.codigo), ...grupos];
      let nombres: Record<string, string> = {};
      try {
        const cat = await getDb().execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${codigos.map(() => "?").join(",")})`, args: codigos });
        nombres = Object.fromEntries(cat.rows.map((r) => [String(r.codigo), String(r.nombre ?? "")]));
      } catch (e) { console.error("[balance] nombres del catálogo no disponibles", e); }
      incorporarCuentasNoLeidas(resultado, sinLeer, nombres, nombres);
    }
    // Cuentas que no se mueven en el año: con su detalle real hasta 8 dígitos (saldos del corte); y las que se mueven,
    // solo cuando tienen una única subcuenta (lleva los mismos valores). Después, el nombre del catálogo de cada código.
    detallarCuentasSinMovimiento(resultado, i.saldos);
    detallarSubcuentaUnica(resultado, i.saldos);
    await nombrarCuentas(getDb(), [resultado.activo, resultado.pasivo, resultado.patrimonio]);
    // saldos del balance de partida que usan los indicadores (diciembre anterior)
    const corte = Object.fromEntries(CODIGOS_CORTE.filter((k) => i.saldos[k] !== undefined).map((k) => [k, Number(i.saldos[k]) || 0]));
    // contingentes y cuentas de orden del mes de corte (Históricos), para la solvencia presupuestada
    const periodoCorte = `${i.corteSaldos.anio}-${String(i.corteSaldos.mes).padStart(2, "0")}`;
    const ord = await getDb().execute({ sql: `SELECT codigo, valor FROM historico_cuentas WHERE oficina = ? AND periodo = ? AND tipo = 'CO' AND codigo IN (${CODIGOS_CORTE_ORDEN.map(() => "?").join(",")})`, args: [agenciaNombre, periodoCorte, ...CODIGOS_CORTE_ORDEN] })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const hayOrden = await getDb().execute({ sql: `SELECT 1 FROM historico_cuentas WHERE oficina = ? AND periodo = ? AND tipo = 'CO' LIMIT 1`, args: [agenciaNombre, periodoCorte] })
      .then((r) => r.rows.length > 0).catch(() => false);
    const corteOrden = hayOrden ? Object.fromEntries(CODIGOS_CORTE_ORDEN.map((k) => [k, Number(ord.rows.find((r) => String(r.codigo) === k)?.valor) || 0])) : null;
    return NextResponse.json({ ...resultado, corte, corteOrden, resultadoCorte: i.ajusteCierre ?? 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el balance general" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
// Consolidado: las cuentas de orden del corte solo valen si todas las agencias las tienen
type N36 = { codigo: string; label: string; valores: number[]; hijos?: N36[] };
/**
 * Consolidado: la suma de las agencias trae 3601 y 3602 (unas con utilidad, otras con pérdida) y 3603 y 3604 a la vez.
 * Se netean en una sola subcuenta cada una, como el balance de la cooperativa: acumulados (3601 o 3602) y del ejercicio
 * (3603 o 3604, = el Estado de resultados consolidado), con el código según su signo.
 */
function netear36(json: Record<string, unknown>): Record<string, unknown> {
  const pat = json.patrimonio as N36 | undefined;
  const n36 = pat?.hijos?.find((h) => h.codigo === "36");
  if (!n36?.hijos?.length) return json;
  const suma = (cods: string[]) => Array.from({ length: 12 }, (_, i) => n36.hijos!.filter((h) => cods.includes(h.codigo)).reduce((t, h) => t + (h.valores[i] ?? 0), 0));
  const acum = suma(["3601", "3602"]), ejer = suma(["3603", "3604"]);
  const hijos: N36[] = [
    { codigo: acum[0] >= 0 ? "3601" : "3602", label: acum[0] >= 0 ? "Utilidades o excedentes acumulados" : "(Pérdidas acumuladas)", valores: acum },
    { codigo: ejer[11] >= 0 ? "3603" : "3604", label: ejer[11] >= 0 ? "Utilidad o excedente del ejercicio (Estado de resultados)" : "(Pérdida del ejercicio) (Estado de resultados)", valores: ejer },
  ];
  return { ...json, patrimonio: { ...pat, hijos: pat!.hijos!.map((h) => (h.codigo === "36" ? { ...h, hijos } : h)) } };
}
export const GET = conConsolidado(conCacheGET("balance-general", leerGET), (json, partes) => netear36(partes.every((x) => x.corteOrden) ? json : { ...json, corteOrden: null }));
export const dynamic = "force-dynamic";
// El Consolidado calcula las 10 agencias: se da más tiempo a la función.
export const maxDuration = 60;
