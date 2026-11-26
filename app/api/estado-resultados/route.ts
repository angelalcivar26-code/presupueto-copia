import { NextRequest, NextResponse } from "next/server";
import { cargarInsumosAgencia } from "../../../lib/insumos-agencia";
import { calcularEstadoResultadosMatriz } from "../../../lib/calc/orquestador";
import { conCacheGET } from "../../../lib/cache-motor";
import { conConsolidado } from "../../../lib/consolidado";
import { calcularEstadoResultadosPorCuenta } from "../../../lib/calc/er-cuentas";
import { getDb } from "../../../lib/turso";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";

/** Cuentas que existen en el presupuesto del ejercicio (de cualquier agencia), para mostrarlas aunque estén en cero. */
async function cuentasDelPresupuesto(ejercicio: number): Promise<{ codigo: string; nombre: string }[]> {
  try {
    const r = await getDb().execute({ sql: `SELECT DISTINCT concepto, cuenta_nombre FROM presupuesto_departamental WHERE ejercicio = ?`, args: [ejercicio] });
    return r.rows.map((x) => ({ codigo: String(x.concepto ?? ""), nombre: String(x.cuenta_nombre ?? "") })).filter((x) => /^[45]/.test(x.codigo.replace(/\D/g, "")));
  } catch (e) {
    console.error("[estado-resultados] no se pudieron leer las cuentas del presupuesto", e);
    return [];
  }
}

/** Nombres del Catálogo de cuentas para los grupos 4 y 5 (los usa el estado de resultados por cuenta). */
async function catalogoResultados(): Promise<Record<string, string>> {
  try {
    const r = await getDb().execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo LIKE '4%' OR codigo LIKE '5%'`);
    return Object.fromEntries(r.rows.map((x) => [String(x.codigo).replace(/\D/g, ""), String(x.nombre ?? "")]));
  } catch (e) {
    console.error("[estado-resultados] no se pudo leer el catálogo", e);
    return {};
  }
}

/**
 * Cuentas de Ingresos/Egresos que calcula la herramienta a partir de otros módulos y que reemplazan lo cargado a mano en
 * las hojas: seguros de Gastos anticipados (cada póliza en su cuenta), 450705 de Materiales y 530405 del Fondo de liquidez.
 * Las hojas y el Resumen las muestran con estos valores, así cuadran con el Estado de resultados.
 * `prefijo`: lo cargado a mano en cuentas que empiezan así no se usa.
 */
type Calculada = { codigo: string; nombre: string; origen: string; prefijo: string; valores: number[] };
const ORIGENES: Record<string, { origen: string; prefijo: (c: string) => string }> = {
  "Gastos anticipados": { origen: "Gastos anticipados (Otros activos)", prefijo: (c) => c },
  "Fondo de liquidez": { origen: "Fondo de liquidez (Otros activos)", prefijo: () => "530405" },
};
function cuentasCalculadas(filas: { departamento?: string; concepto: string; cuenta_nombre?: string | null; mes: number; monto: number }[], egresos: unknown): Calculada[] {
  const porCodigo = new Map<string, Calculada>();
  for (const f of filas) {
    const o = ORIGENES[String(f.departamento ?? "")];
    if (!o) continue;
    const c = String(f.concepto).replace(/\D/g, "");
    const x = porCodigo.get(c) ?? { codigo: c, nombre: String(f.cuenta_nombre ?? ""), origen: o.origen, prefijo: o.prefijo(c), valores: Array(12).fill(0) };
    if (f.mes >= 1 && f.mes <= 12) x.valores[f.mes - 1] += Number(f.monto) || 0;
    porCodigo.set(c, x);
  }
  // 450705 Suministros: del plan de Materiales (1906); en el árbol del ER viene acumulado en el año
  type N = { codigo: string; label?: string; valores?: number[]; hijos?: N[] };
  const buscar = (n: N | undefined, c: string): N | null => !n ? null : n.codigo === c ? n : (n.hijos ?? []).reduce<N | null>((h, x) => h ?? buscar(x, c), null);
  const sum = buscar(egresos as N, "450705");
  if (sum?.valores?.length) {
    const v = sum.valores;
    porCodigo.set("450705", { codigo: "450705", nombre: sum.label ?? "Suministros diversos", origen: "Materiales (1906, Otros activos)", prefijo: "450705", valores: v.map((x, i) => (i === 0 ? x : x - v[i - 1])) });
  }
  return [...porCodigo.values()];
}

async function leerGET(req: NextRequest) {
  try {
    const agenciaNombre = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);

    const resultadoInsumos = await cargarInsumosAgencia(agenciaNombre, ejercicio);
    if (!resultadoInsumos.ok) {
      return NextResponse.json({ error: resultadoInsumos.error }, { status: 400 });
    }
    const i = resultadoInsumos.insumos;

    const resultado = calcularEstadoResultadosMatriz(
      i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
      agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo
    );

    // Misma información ordenada como el estado de resultados real (cuentas del balance cargado + catálogo).
    // Los demás módulos siguen usando egresos/ingresos del motor; la pantalla Estado de resultados usa "cuentas".
    let cuentas = null;
    try {
      // estructura real de subcuentas: el estado de resultados de la agencia en el mes del corte
      const per = `${i.corteSaldos.anio}-${String(i.corteSaldos.mes).padStart(2, "0")}`;
      const er = await getDb().execute({ sql: `SELECT codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND oficina = ? AND periodo = ?`, args: [agenciaNombre, per] })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const erReal = Object.fromEntries(er.rows.map((r) => [String(r.codigo), Number(r.valor) || 0]));
      cuentas = calcularEstadoResultadosPorCuenta(
        i.saldos, i.paramsCaptaciones, i.paramsCredito, i.filasPresupuesto, i.empleados,
        agenciaNombre, i.oficialesCredito, i.metasCredito, i.factoresDepreciacion, i.parametrosOtrosPasivo, await catalogoResultados(), resultado, await cuentasDelPresupuesto(ejercicio), erReal
      );
    } catch (e) {
      console.error("[estado-resultados] no se pudo armar el estado por cuenta", e);
    }

    let calculadas: Calculada[] = [];
    try { calculadas = cuentasCalculadas(i.filasPresupuesto as never, (resultado as { egresos?: unknown }).egresos); } catch (e) { console.error("[estado-resultados] cuentas calculadas", e); }

    return NextResponse.json({ ...resultado, cuentas, calculadas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error calculando el estado de resultados" }, { status: 500 });
  }
}

// El cálculo se hace una vez por agencia y versión de datos; los demás pedidos leen el resultado guardado.
export const GET = conConsolidado(conCacheGET("estado-resultados", leerGET));
export const dynamic = "force-dynamic";
// El Consolidado calcula las 10 agencias: se da más tiempo a la función.
export const maxDuration = 60;
