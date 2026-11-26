import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { respuestaEntrada } from "../../../lib/validacion";
import { conVentana, ventanaDeTexto } from "../../../lib/ventana-simulada";
import { realDeLaBase, type RealOficina } from "../../../lib/calc/base-calibracion";
import {
  asegurarTablasProvisionFlow, leerParametrosFlow, guardarParametrosFlow, leerConfig, guardarConfig,
  leerHistoria, leerEERR, guardarEERR, guardarCalificacion, leerCategoriasCorte, leerDetalleCategorias, ritmosAgencias, claveOficina, type FilaCalificacion,
} from "../../../lib/provision-flow-db";
import { recalibrar, backtest, PRODUCTOS, TRAMOS, ESCENARIOS, type ConfigFlow, type ParametrosFlow, type SaldosTramo } from "../../../lib/calc/provision-flow";

/**
 * Parámetros del modelo de provisión por flow rates (institucionales, iguales para las 10 agencias).
 * GET  → parámetros, configuración, cortes de calificación y meses de ER cargados, calibración sugerida
 *        con la ventana configurada y backtest de los últimos meses cerrados.
 * POST { accion: "parametros", parametros }            → guarda FR y tasas editados
 * POST { accion: "config", config }                    → castigo, escenario activo, recuperación, factores, ventana
 * POST { accion: "recalibrar" }                        → recalcula FR y tasas con la ventana y los guarda
 * POST { accion: "calificacion", filas }               → carga un corte de Calificación de Cartera (reemplaza ese mes)
 * POST { accion: "eerr", periodo, acumulado }          → carga el ER del mes (acumulado del año; se mensualiza)
 */
async function estado() {
  const db = getDb();
  await asegurarTablasProvisionFlow(db);
  const [parametros, config, historia, eerr] = await Promise.all([leerParametrosFlow(db), leerConfig(db), leerHistoria(db), leerEERR(db)]);
  const cal = recalibrar({ historia, eerr, ventanaDesde: config.ventanaDesde, ventanaHasta: config.ventanaHasta,
    factorOptimista: config.factorOptimista, factorPesimista: config.factorPesimista, parametrosActuales: parametros });
  // Backtest: últimos 5 meses con ER y calificación, dentro de la ventana (sin alivio)
  const conER = historia.periodos.map((p) => p.periodo).filter((p) => p >= config.ventanaDesde && eerr.some((e) => e.periodo === p));
  const btMeses = conER.slice(-5);
  const bt = btMeses.length ? backtest({ historia, eerr, parametros, escenario: "base", desde: btMeses[0], hasta: btMeses[btMeses.length - 1] }) : null;
  const ultimo = historia.periodos[historia.periodos.length - 1]?.periodo ?? null;
  // oficinas de cada corte cargado: al subir un corte que ya existe, se avisa si el archivo trae menos oficinas
  const ofs = await db.execute(`SELECT DISTINCT periodo, oficina FROM provision_calificacion`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const oficinasPorCorte: Record<string, string[]> = {};
  for (const r of ofs.rows) (oficinasPorCorte[String(r.periodo)] ??= []).push(String(r.oficina));
  const [categoriasCorte, detalleCategorias] = ultimo ? await Promise.all([leerCategoriasCorte(db, ultimo), leerDetalleCategorias(db, ultimo)]) : [{}, {}];
  // ritmo de atraso propio de cada agencia (Metodología → Por agencia)
  const rs = await ritmosAgencias(db, parametros, config).catch(() => null);
  const ritmos = Object.fromEntries([...(rs ?? new Map()).entries()].map(([of, r]) => [of, r.calibrado?.ritmo ?? null]));
  // Validación por agencia: los mismos meses de la prueba de la cooperativa, con la calificación y el ER de cada agencia,
  // con su ritmo propio y con el de la cooperativa (cuál reproduce mejor su gasto real)
  const validacion: Record<string, { real: number; propio: number | null; cooperativa: number; meses: { periodo: string; real: number; propio: number | null; cooperativa: number }[] }> = {};
  if (btMeses.length) for (const [of, r] of rs ?? new Map()) {
    const h = { saldo: {} as Record<string, SaldosTramo>, prov: {} as Record<string, SaldosTramo> };
    for (const c of r.historia) { h.saldo[c.periodo] = c.saldo; if (c.prov) h.prov[c.periodo] = c.prov; }
    const er = Object.entries(r.erMes as Record<string, { g4402: number; r560410: number }>).map(([periodo, v]) => ({ periodo, g4402: v.g4402, r560410: v.r560410, r560405: 0 }));
    const args = { historia: h, eerr: er, escenario: "base" as const, desde: btMeses[0], hasta: btMeses[btMeses.length - 1] };
    const co = backtest({ ...args, parametros });
    if (!co.meses.length) continue;
    const pr = r.calibrado ? backtest({ ...args, parametros: r.calibrado.parametros }) : null;
    validacion[of] = { real: co.real, propio: pr ? pr.modelo : null, cooperativa: co.modelo,
      meses: co.meses.map((m, i) => ({ periodo: m.periodo, real: m.real, propio: pr?.meses[i]?.modelo ?? null, cooperativa: m.modelo })) };
  }
  // gasto neto real (4402 − 5604.10) desde el inicio de la ventana (cartera sin alivio) hasta el último mes con estado de
  // resultados, llevado a 12 meses: es lo comparable con el presupuesto, que usa el ritmo de esos mismos meses
  // (solo los meses de la base: con la base fija, los meses cargados después no cambian el real; una base que cruza de año suma ambos)
  // además, provisión 4402 ÷ interés de cartera 5104 de esos meses (cuánto del interés se va en provisión), por agencia y de la cooperativa
  const realAnio: {
    anio: string | null; desde: string | null; hasta: string | null; ratioCooperativa: number | null;
    porOficina: Record<string, RealOficina>;
  } = { anio: null, desde: null, hasta: null, ratioCooperativa: null, porOficina: {} };
  if (ultimo) {
    const er = await db.execute({ sql: `SELECT oficina, periodo, codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND codigo IN ('4402', '560410', '5104') AND periodo >= ? AND periodo <= ?`,
      args: [`${config.ventanaDesde.slice(0, 4)}-01`, config.ventanaHasta] }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const r = realDeLaBase(er.rows.map((x) => ({ oficina: claveOficina(String(x.oficina)), periodo: String(x.periodo), codigo: String(x.codigo), valor: Number(x.valor) || 0 })),
      config.ventanaDesde, config.ventanaHasta);
    realAnio.porOficina = r.porOficina;
    realAnio.desde = config.ventanaDesde; realAnio.hasta = r.hasta; realAnio.anio = r.hasta ? r.hasta.slice(0, 4) : null;
    const ags = Object.entries(realAnio.porOficina).filter(([of]) => of !== "CONSOLIDADO").map(([, v]) => v);
    const sg = ags.reduce((t, v) => t + v.g4402, 0), si = ags.reduce((t, v) => t + v.i5104, 0);
    realAnio.ratioCooperativa = si > 0 ? sg / si : null;
  }
  return {
    categoriasCorte, ritmos, realAnio, detalleCategorias, oficinasPorCorte, validacion,
    parametros, config, periodos: historia.periodos, eerr,
    // Estado inicial consolidado (último corte): ejemplo de la metodología e indicadores
    // Historia consolidada por producto y tramo: ejemplos de la metodología (cómo salen los %)
    historia: { saldo: historia.saldo, prov: historia.prov },
    corte: ultimo, inicial: ultimo ? historia.saldo[ultimo] : null, provisionCorte: ultimo ? historia.prov[ultimo] : null,
    // Cartera total de cada corte (para la lista de cortes cargados)
    carteraPorCorte: Object.fromEntries(historia.periodos.map((p) => [p.periodo,
      Object.values(historia.saldo[p.periodo] ?? {}).reduce((t, x) => t + Object.values(x).reduce((a, b) => a + b, 0), 0)])),
    calibracion: { parametros: cal.parametros, frEBruto: cal.frEBruto, ventanaE: cal.ventanaE, castigoMensualSugerido: cal.castigoMensualSugerido, tasaCastigo: cal.tasaCastigo, periodosTasas: cal.periodosTasas },
    backtest: bt,
  };
}

export async function GET(req: NextRequest) {
  try {
    // ?ventana=AAAA-MM_AAAA-MM: calibración y gasto real con otra base, sin guardarla (panel "Actualizar la base")
    return NextResponse.json(await conVentana(ventanaDeTexto(req.nextUrl.searchParams.get("ventana")), estado));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los parámetros del modelo de provisión" }, { status: 500 });
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    await asegurarTablasProvisionFlow(db);

    if (body.accion === "parametros") {
      const p = body.parametros as ParametrosFlow;
      for (const prod of PRODUCTOS) for (const t of TRAMOS[prod]) {
        const v = p?.[prod]?.[t];
        if (!v) return NextResponse.json({ error: `Faltan los parámetros de ${prod} ${t}.` }, { status: 400 });
        if (!(num(v.n) >= 1)) return NextResponse.json({ error: `n de ${prod} ${t} debe ser 1 o más.` }, { status: 400 });
        for (const e of ESCENARIOS) if (!(num(v.fr[e]) >= 0 && num(v.fr[e]) <= 1)) return NextResponse.json({ error: `El flow rate de ${prod} ${t} debe estar entre 0 y 1.` }, { status: 400 });
        if (!(num(v.tasa) >= 0 && num(v.tasa) <= 1)) return NextResponse.json({ error: `La tasa de provisión de ${prod} ${t} debe estar entre 0 % y 100 %.` }, { status: 400 });
      }
      await guardarParametrosFlow(db, p);
      return NextResponse.json({ ok: true });
    }

    if (body.accion === "config") {
      const c = body.config as ConfigFlow;
      const uc = await db.execute(`SELECT MAX(periodo) AS p FROM provision_calificacion`);
      const ultimoCorte = uc.rows[0]?.p ? String(uc.rows[0].p) : null;
      if (!(num(c.castigoMensual) >= 0)) return NextResponse.json({ error: "El castigo mensual no puede ser negativo." }, { status: 400 });
      if (!ESCENARIOS.includes(c.escenario)) return NextResponse.json({ error: "Escenario no reconocido." }, { status: 400 });
      if (!/^\d{4}-\d{2}$/.test(c.ventanaDesde) || !/^\d{4}-\d{2}$/.test(c.ventanaHasta) || c.ventanaDesde > c.ventanaHasta) {
        return NextResponse.json({ error: "La ventana de calibración debe ser AAAA-MM a AAAA-MM." }, { status: 400 });
      }
      await guardarConfig(db, {
        castigoMensual: num(c.castigoMensual), escenario: c.escenario,
        recuperacionAnual: { optimista: num(c.recuperacionAnual.optimista) || 0, base: num(c.recuperacionAnual.base) || 0, pesimista: num(c.recuperacionAnual.pesimista) || 0 },
        factorOptimista: num(c.factorOptimista) || 0, factorPesimista: num(c.factorPesimista) || 0,
        ventanaDesde: c.ventanaDesde, ventanaHasta: c.ventanaHasta, ritmo: c.ritmo === "cooperativa" ? "cooperativa" : "agencia",
        // base fija (ventanaAuto = false, decisión explícita): los cortes nuevos solo cambian los saldos de partida.
        // Sin decisión explícita: hasta el último corte cargado sigue sola a los cortes nuevos; un mes anterior la deja fija
        ventanaAuto: c.ventanaAuto === false ? false : c.ventanaAuto === true ? true : !ultimoCorte || c.ventanaHasta >= ultimoCorte,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.accion === "recalibrar") {
      const e = await estado();
      await guardarParametrosFlow(db, e.calibracion.parametros);
      return NextResponse.json({ ok: true, calibracion: e.calibracion });
    }

    if (body.accion === "calificacion") {
      const filas = (body.filas ?? []) as FilaCalificacion[];
      if (!filas.length) return NextResponse.json({ error: "El archivo no trae filas de calificación." }, { status: 400 });
      if (filas.some((f) => !/^\d{4}-\d{2}$/.test(f.periodo))) return NextResponse.json({ error: "Falta la fecha de corte." }, { status: 400 });
      const periodos = await guardarCalificacion(db, filas);
      return NextResponse.json({ ok: true, periodos });
    }

    if (body.accion === "eerr") {
      const periodo = String(body.periodo ?? "");
      if (!/^\d{4}-\d{2}$/.test(periodo)) return NextResponse.json({ error: "Falta la fecha del estado de resultados." }, { status: 400 });
      const ac = body.acumulado as { g4402: number; r560410: number; r560405: number };
      const [anio, mes] = periodo.split("-").map(Number);
      // El ER viene acumulado en el año: enero tal cual; los demás meses = acumulado − suma de los meses anteriores
      const previos = (await leerEERR(db)).filter((x) => x.periodo.startsWith(`${anio}-`) && x.periodo < periodo);
      if (mes > 1 && previos.length < mes - 1) {
        const faltan = Array.from({ length: mes - 1 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`).filter((p) => !previos.some((x) => x.periodo === p));
        return NextResponse.json({ error: `Para mensualizar ${periodo} faltan los meses anteriores del año: ${faltan.join(", ")}.` }, { status: 400 });
      }
      const s = (k: "g4402" | "r560410" | "r560405") => previos.reduce((t, x) => t + x[k], 0);
      const mesVal = { periodo, g4402: num(ac.g4402) - s("g4402"), r560410: num(ac.r560410) - s("r560410"), r560405: num(ac.r560405) - s("r560405") };
      await guardarEERR(db, [mesVal]);
      return NextResponse.json({ ok: true, mes: mesVal });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    const r = respuestaEntrada(err); if (r) return r;
    console.error(err);
    return NextResponse.json({ error: "Error guardando el modelo de provisión" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
