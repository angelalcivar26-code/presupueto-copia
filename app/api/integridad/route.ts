import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { conCacheGET } from "../../../lib/cache-motor";
import { AGENCIAS_CONSOLIDADO } from "../../../lib/consolidado";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { PCT_DISTRIBUCION_DEFAULT } from "../../../lib/calc/orquestador";
import { cuentaCalculada } from "../../../lib/calc/cuentas-calculadas";
import { controlesArchivos } from "../../../lib/control-archivos";
import { GET as balanceGET } from "../balance-general/route";
import { GET as avanceGET } from "../avance/route";
import { GET as porcentajesGET } from "../porcentajes-activo/route";
import { GET as flowGET } from "../provision-flow/route";
import { GET as erGET } from "../estado-resultados/route";
import { GET as flowParGET } from "../provision-flow-parametros/route";
import { controlesProvision, type FlowAgencia } from "../../../lib/control-provision";

/**
 * Control de integridad del ejercicio: revisa de una vez que el presupuesto cuadre. Solo lee; no cambia nada.
 * Usa los cálculos ya guardados de cada agencia (balance) y se rehace solo cuando cambian los datos.
 * GET ?ejercicio=2027 → { controles: Control[] }
 */
interface Hallazgo { agencia?: string; mes?: number; periodo?: string; texto: string; diferencia?: number }
interface Control { id: string; titulo: string; descripcion: string; href: string; estado: "ok" | "error" | "aviso" | "sin-datos"; hallazgos: Hallazgo[] }
interface Nodo { codigo: string; valores: number[]; hijos?: Nodo[] }
interface Balance { activo?: Nodo; pasivo?: Nodo; patrimonio?: Nodo; error?: string }

const TOLERANCIA = 1; // dólares: diferencias menores son redondeo
const LINEAS = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as const;

function buscar(n: Nodo | undefined, c: string): Nodo | null {
  if (!n) return null;
  if (n.codigo === c) return n;
  for (const h of n.hijos ?? []) { const x = buscar(h, c); if (x) return x; }
  return null;
}
const mes12 = (n: Nodo | null | undefined) => Array.from({ length: 12 }, (_, i) => Number(n?.valores?.[i]) || 0);

/** Llama a otra ruta GET del sistema (con su memoria) como lo haría la pantalla. */
async function pedir<T>(get: (r: NextRequest) => Promise<Response>, req: NextRequest, ruta: string, params: Record<string, string>): Promise<{ ok: boolean; j: T }> {
  const url = new URL(ruta, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const r = await get(new NextRequest(url, { headers: req.headers }));
    const j = (await r.json()) as T & { error?: string };
    return { ok: r.ok && !j.error, j };
  } catch (e) {
    return { ok: false, j: { error: e instanceof Error ? e.message : "error" } as T };
  }
}

async function leerGET(req: NextRequest) {
  try {
    const ejercicio = await ejercicioDe(req);
    const ej = String(ejercicio);
    const [balances, avance, porc, dist] = await Promise.all([
      Promise.all(AGENCIAS_CONSOLIDADO.map(async (agencia) => ({ agencia, ...(await pedir<Balance>(balanceGET, req, "/api/balance-general", { agencia, ejercicio: ej })) }))),
      pedir<{ secciones?: { id: string; label: string; href: string; listas: string[]; faltan: Record<string, string> }[] }>(avanceGET, req, "/api/avance", { ejercicio: ej }),
      pedir<{ sumaPorcentajes?: number; detalle?: { agencia: string; porcentaje: number }[]; desactualizadasPorCuenta?: { departamento: string; concepto: string; cuenta: string; valores: number }[] }>(porcentajesGET, req, "/api/porcentajes-activo", { ejercicio: ej }),
      getDb().execute(`SELECT a.nombre AS agencia, pc.linea, pc.mes, pc.pct_distribucion AS pct FROM parametros_credito pc JOIN agencias a ON a.id = pc.agencia_id`).catch(() => ({ rows: [] })),
    ]);
    // cuentas de ingresos y gastos cargadas, por agencia y hoja (total del año)
    const porHoja = await getDb().execute({
      sql: `SELECT a.nombre AS agencia, p.concepto, p.departamento, SUM(p.monto) AS total FROM presupuesto_departamental p JOIN agencias a ON a.id = p.agencia_id
            WHERE p.ejercicio = ? GROUP BY a.nombre, p.concepto, p.departamento`,
      args: [ejercicio],
    }).catch(() => null);
    const conBalance = balances.filter((b) => b.ok);
    const controles: Control[] = [];

    // 1. Activo = pasivo + patrimonio, por agencia y mes
    {
      const h: Hallazgo[] = [];
      for (const b of conBalance) {
        const a = mes12(b.j.activo), p = mes12(b.j.pasivo), q = mes12(b.j.patrimonio);
        a.forEach((v, i) => { const d = v - p[i] - q[i]; if (Math.abs(d) > TOLERANCIA) h.push({ agencia: b.agencia, mes: i + 1, diferencia: d, texto: "Activo distinto de pasivo + patrimonio" }); });
      }
      controles.push({ id: "balance", titulo: "Balance cuadrado", descripcion: "Activo = pasivo + patrimonio en cada agencia y cada mes", href: "/balance-general", estado: !conBalance.length ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
    }

    // 2. Préstamos entre oficinas: lo que envían (1908) = lo que reciben (2908), en la suma de las agencias
    {
      const env = Array(12).fill(0), rec = Array(12).fill(0);
      for (const b of conBalance) {
        mes12(buscar(b.j.activo, "1908")).forEach((v, i) => (env[i] += v));
        mes12(buscar(b.j.pasivo, "2908")).forEach((v, i) => (rec[i] += v));
      }
      const h: Hallazgo[] = [];
      env.forEach((v, i) => { const d = v - rec[i]; if (Math.abs(d) > TOLERANCIA) h.push({ mes: i + 1, diferencia: d, texto: "Enviado (1908) distinto de recibido (2908)" }); });
      controles.push({ id: "interoficinas", titulo: "Préstamos entre oficinas", descripcion: "Lo que envían las oficinas (1908) es igual a lo que reciben (2908)", href: "/fondos-disponibles", estado: !conBalance.length ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
    }

    // 3. Consolidado: entran las 10 agencias
    {
      const h = balances.filter((b) => !b.ok).map((b) => ({ agencia: b.agencia, texto: `No entra al consolidado: ${(b.j as { error?: string }).error ?? "sin balance"}` }));
      controles.push({ id: "consolidado", titulo: "Consolidado", descripcion: "Es la suma de las 10 agencias: todas tienen balance y entran en la suma", href: "/carga-datos", estado: h.length ? "error" : "ok", hallazgos: h });
    }

    // 4. Prorrateo: % de activo suma 100 % y los gastos prorrateados están repartidos con los % vigentes
    {
      const h: Hallazgo[] = [];
      const suma = Number(porc.j.sumaPorcentajes ?? 0);
      if (porc.ok && Math.abs(suma - 1) > 0.0001) h.push({ texto: `Los % de activo suman ${(suma * 100).toFixed(2).replace(".", ",")} %` });
      for (const c of porc.j.desactualizadasPorCuenta ?? []) h.push({ texto: `${c.concepto} ${c.cuenta} (${c.departamento}): ${c.valores} valor${c.valores === 1 ? "" : "es"} repartido${c.valores === 1 ? "" : "s"} con % anteriores` });
      controles.push({ id: "prorrateo", titulo: "Prorrateo", descripcion: "El % de activo de las agencias suma 100 % y los gastos prorrateados usan esos %", href: "/proyeccion-egresos", estado: !porc.ok ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
    }

    // 5. Distribución de la colocación: las 4 líneas suman 100 % cada mes (igual que el cálculo: sin dato = valor por defecto)
    {
      const porAg = new Map<string, Map<string, number | null>>();
      for (const r of dist.rows as Record<string, unknown>[]) {
        const m = porAg.get(String(r.agencia)) ?? new Map(); m.set(`${r.linea}|${r.mes}`, r.pct === null || r.pct === undefined ? null : Number(r.pct)); porAg.set(String(r.agencia), m);
      }
      const h: Hallazgo[] = [];
      for (const [agencia, m] of porAg) {
        for (let mes = 1; mes <= 12; mes++) {
          const s = LINEAS.reduce((t, l) => t + (m.get(`${l}|${mes}`) ?? PCT_DISTRIBUCION_DEFAULT[l]), 0);
          if (Math.abs(s - 1) > 0.0001) h.push({ agencia, mes, texto: `Las líneas suman ${(s * 100).toFixed(2).replace(".", ",")} %` });
        }
      }
      controles.push({ id: "distribucion", titulo: "Distribución de la colocación", descripcion: "Las 4 líneas de crédito suman 100 % cada mes", href: "/cartera", estado: !porAg.size ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
    }

    // 6. Datos completos (lo mismo que Inicio)
    {
      const h: Hallazgo[] = [];
      for (const s of avance.j.secciones ?? []) for (const [agencia, motivo] of Object.entries(s.faltan ?? {})) h.push({ agencia, texto: `${s.label}: ${motivo}` });
      controles.push({ id: "completos", titulo: "Datos completos", descripcion: "Cada agencia tiene lo que el cálculo necesita en todas las secciones", href: "/inicio", estado: !avance.ok ? "sin-datos" : h.length ? "error" : "ok", hallazgos: h });
    }

    // 7. Una cuenta cargada en más de una hoja: se suma en el Estado de resultados. Puede ser correcto (cada hoja presupuesta
    // una parte) o una duplicación; se avisa para revisarlo, no se corrige solo.
    {
      const h: Hallazgo[] = [];
      const grupos = new Map<string, { agencia: string; cuenta: string; hojas: { hoja: string; total: number }[] }>();
      for (const r of porHoja?.rows ?? []) {
        const cuenta = String(r.concepto).replace(/\D/g, ""), total = Number(r.total) || 0;
        if (!cuenta || Math.abs(total) < 0.5 || cuentaCalculada(cuenta)) continue;
        const k = `${r.agencia}|${cuenta}`;
        const g = grupos.get(k) ?? { agencia: String(r.agencia), cuenta, hojas: [] };
        g.hojas.push({ hoja: String(r.departamento).replace(/^\s*\d{4,}\s*[-–·.]?\s*/, ""), total });
        grupos.set(k, g);
      }
      for (const g of grupos.values()) {
        if (g.hojas.length < 2) continue;
        const suma = g.hojas.reduce((t, x) => t + x.total, 0);
        h.push({ agencia: g.agencia, diferencia: suma, texto: `Cuenta ${g.cuenta} en ${g.hojas.length} hojas: ${g.hojas.map((x) => `${x.hoja} ${x.total.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ")}` });
      }
      h.sort((a, b) => (a.agencia ?? "").localeCompare(b.agencia ?? "") || a.texto.localeCompare(b.texto));
      controles.push({ id: "hojas", titulo: "Cuentas en varias hojas", descripcion: "Una misma cuenta cargada en más de una hoja se suma: revisar que no esté duplicada", href: "/proyeccion-egresos",
        estado: !porHoja ? "sin-datos" : h.length ? "aviso" : "ok", hallazgos: h });
    }

    // 8. Provisión de cartera: cuadre con los estados, razonable frente a lo real, mejoras y mismos meses
    try {
      const clave = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
      const [flows, ers, par] = await Promise.all([
        Promise.all(AGENCIAS_CONSOLIDADO.map((agencia) => pedir<FlowAgencia>(flowGET, req, "/api/provision-flow", { agencia, ejercicio: ej }))),
        Promise.all(AGENCIAS_CONSOLIDADO.map((agencia) => pedir<{ egresos?: Nodo; ingresos?: Nodo }>(erGET, req, "/api/estado-resultados", { agencia, ejercicio: ej }))),
        pedir<{ config?: { ventanaDesde?: string; ventanaHasta?: string; ventanaAuto?: boolean }; corte?: string | null; eerr?: { periodo: string }[]; calibracion?: { ventanaE?: string[] }; ritmos?: Record<string, { desde?: string } | null>; realAnio?: { desde: string | null; hasta?: string | null; porOficina: Record<string, { valor: number }> } }>(flowParGET, req, "/api/provision-flow-parametros", { ejercicio: ej }),
      ]);
      controles.push(...controlesProvision({
        agencias: AGENCIAS_CONSOLIDADO.map((agencia, i) => ({
          agencia, clave: clave(agencia), flow: flows[i].ok ? flows[i].j : null, er: ers[i].ok ? ers[i].j : null,
          bal: balances[i]?.ok ? (balances[i].j as { activo?: Nodo }) : null,
        })),
        ventanaDesde: par.ok ? par.j.config?.ventanaDesde ?? null : null,
        ritmoDesde: Object.fromEntries(Object.entries(par.j.ritmos ?? {}).map(([k, v]) => [k, v?.desde ?? null])),
        real: par.ok ? par.j.realAnio ?? null : null,
        ventanaHasta: par.ok ? par.j.config?.ventanaHasta ?? null : null,
        ultimoCorte: par.ok ? par.j.corte ?? null : null,
        ventanaAuto: par.ok ? par.j.config?.ventanaAuto : undefined,
        ventanaE: par.ok ? par.j.calibracion?.ventanaE ?? [] : [],
        erModeloHasta: par.ok ? par.j.eerr?.at(-1)?.periodo ?? null : null,
      }));
    } catch (e) { console.error("[integridad] provisión", e); }

    // 9. Archivos subidos en Carga de datos (todos los meses, no solo el ejercicio)
    try { controles.push(...(await controlesArchivos(getDb()))); }
    catch (e) { console.error("[integridad] archivos", e); controles.push({ id: "archivos-cuadre", titulo: "Archivos cargados", descripcion: "No se pudieron revisar los archivos subidos", href: "/carga-datos", estado: "sin-datos", hallazgos: [] }); }

    return NextResponse.json({ ejercicio, controles });
  } catch (e) {
    console.error("[integridad]", e);
    return NextResponse.json({ error: "No se pudo revisar la integridad del ejercicio" }, { status: 500 });
  }
}

export const GET = conCacheGET("integridad", leerGET);
export const dynamic = "force-dynamic";
export const maxDuration = 60;
