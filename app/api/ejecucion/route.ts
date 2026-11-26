import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { armarFilas, codigosDeReales, enlazarCuentasReales, type FilaEjecucion, type NodoPres } from "../../../lib/ejecucion";
import { CODIGO_AF, CUENTAS_CAPTACIONES } from "../../../lib/calc/orquestador";
import { baseDe, indicadores } from "../../../lib/calc/indicadores-presupuesto";
import { indicadoresReales } from "../../../lib/calc/indicadores-reales";
import { GET as balanceGET } from "../balance-general/route";
import { GET as resultadosGET } from "../estado-resultados/route";

/**
 * GET ?agencia=Matriz&ejercicio=2027 → presupuesto frente a real de todo el año, cuenta por cuenta.
 * { meses: number[] (meses con real cargado), bal: FilaEjecucion[], er: FilaEjecucion[] }
 * Se calcula una vez por versión de datos (memoria del motor).
 */
async function pedir<T>(get: (r: NextRequest) => Promise<Response>, req: NextRequest, ruta: string, params: Record<string, string>): Promise<T> {
  const url = new URL(ruta, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await get(new NextRequest(url, { headers: req.headers }));
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error ?? "No se pudo calcular el presupuesto");
  return j;
}

async function leerGET(req: NextRequest) {
  try {
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "Matriz";
    const ejercicio = await ejercicioDe(req);
    const ej = String(ejercicio);
    const db = getDb();
    const periodos = Array.from({ length: 12 }, (_, i) => `${ej}-${String(i + 1).padStart(2, "0")}`);
    const dicAnterior = `${ejercicio - 1}-12`;

    const [bal, er, filasReales] = await Promise.all([
      pedir<{ activo?: NodoPres; pasivo?: NodoPres; patrimonio?: NodoPres; corte?: Record<string, number> }>(balanceGET, req, "/api/balance-general", { agencia, ejercicio: ej }),
      pedir<{ cuentas?: { ingresos?: NodoPres; egresos?: NodoPres }; ingresos?: NodoPres; egresos?: NodoPres; resultadoDelEjercicio?: { valores: number[] } }>(resultadosGET, req, "/api/estado-resultados", { agencia, ejercicio: ej }),
      db.execute({ sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas WHERE ((periodo >= ? AND periodo <= ?) OR periodo = ?) AND oficina = ?`, args: [periodos[0], periodos[11], dicAnterior, agencia] })
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);
    let rows = filasReales.rows as Record<string, unknown>[];
    // Consolidado sin archivo propio: suma de las agencias
    if (agencia === "Consolidado" && !rows.length) {
      rows = (await db.execute({ sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas WHERE ((periodo >= ? AND periodo <= ?) OR periodo = ?) AND oficina <> 'Consolidado'`, args: [periodos[0], periodos[11], dicAnterior] })).rows as Record<string, unknown>[];
    }
    const reales: Record<"BAL" | "ER" | "CO", Record<string, Record<string, number>>> = { BAL: {}, ER: {}, CO: {} };
    for (const r of rows) {
      const t = String(r.tipo) as "BAL" | "ER" | "CO";
      if (t !== "BAL" && t !== "ER" && t !== "CO") continue;
      const m = (reales[t][String(r.periodo)] ??= {});
      m[String(r.codigo)] = (m[String(r.codigo)] ?? 0) + (Number(r.valor) || 0);
    }
    // indicadores reales con el balance tal como viene del sistema (antes de sumar el resultado al patrimonio)
    const indReales = indicadoresReales(periodos.map((p) => reales.BAL[p]), periodos.map((p) => reales.ER[p]), reales.BAL[dicAnterior], agencia === "Consolidado", periodos.map((p) => reales.CO[p]));
    // durante el año el balance del sistema no trae el resultado del ejercicio (36): se toma del estado de resultados del mismo mes
    for (const p of periodos) {
      const b = reales.BAL[p], e = reales.ER[p];
      if (!b || !e || b["3603"] !== undefined || b["3604"] !== undefined) continue;
      const res = (e["5"] ?? 0) - (e["4"] ?? 0);
      b[res >= 0 ? "3603" : "3604"] = res; b["36"] = (b["36"] ?? 0) + res; b["3"] = (b["3"] ?? 0) + res;
    }
    // nombres de las cuentas reales (detalle)
    const cods = [...new Set([...codigosDeReales(reales.BAL), ...codigosDeReales(reales.ER)])];
    const nombres: Record<string, string> = {};
    for (let k = 0; k < cods.length; k += 400) {
      const parte = cods.slice(k, k + 400);
      const r = await db.execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${parte.map(() => "?").join(",")})`, args: parte }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      for (const x of r.rows) nombres[String(x.codigo)] = String(x.nombre ?? "");
    }

    nombres["3603"] ||= "Utilidad o excedente del ejercicio";
    nombres["3604"] ||= "(Pérdida del ejercicio)";
    enlazarCuentasReales([bal.activo, bal.pasivo, bal.patrimonio], codigosDeReales(reales.BAL), CODIGO_AF, CUENTAS_CAPTACIONES);
    const filasBal = armarFilas([bal.activo, bal.pasivo, bal.patrimonio], reales.BAL, periodos, nombres, "BAL");
    const arbolER = { ingresos: er.cuentas?.ingresos ?? er.ingresos, egresos: er.cuentas?.egresos ?? er.egresos };
    const filasER = armarFilas([arbolER.ingresos, arbolER.egresos], reales.ER, periodos, nombres, "ER");
    // resultado del ejercicio: ingresos − gastos (real) frente al resultado presupuestado
    const res: FilaEjecucion = {
      id: "resultado", codigo: "", label: "RESULTADO DEL EJERCICIO", menos: false,
      pres: (er.resultadoDelEjercicio?.valores ?? Array(12).fill(0)).slice(0, 12).map((v) => Number(v) || 0),
      real: periodos.map((p) => { const m = reales.ER[p]; return m ? (m["5"] ?? 0) - (m["4"] ?? 0) : null; }),
    };
    // indicadores: presupuesto (balance y resultados proyectados) frente a real (Históricos, con diciembre anterior)
    const baseP = baseDe(bal as never, arbolER as never);
    if (agencia === "Consolidado") baseP.consolidado = true;
    const indicadoresDatos = {
      pres: periodos.map((_, m) => indicadores(baseP, m)),
      real: indReales,
    };
    const meses = periodos.map((p, i) => (reales.BAL[p] || reales.ER[p] ? i + 1 : 0)).filter(Boolean);
    return NextResponse.json({ agencia, ejercicio, meses, bal: filasBal, er: [...filasER, res], indicadores: indicadoresDatos });
  } catch (e) {
    console.error("[ejecucion]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo armar la ejecución presupuestaria" }, { status: 500 });
  }
}

export const GET = conCacheGET("ejecucion", leerGET);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
