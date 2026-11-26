import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../lib/turso";
import { getOrCreateMatrizId } from "../../../lib/agencias";
import { conCacheGET } from "../../../lib/cache-motor";
import { asegurarColumnasCredito, sqlGuardarCredito } from "../../../lib/parametros-credito-db";
import { ejercicioDe } from "../../../lib/ejercicio-pedido";
import { conCache } from "../../../lib/cache-motor";
import { leerConfig } from "../../../lib/provision-flow-db";
import { calcularRealidad, LINEAS_ESTUDIO, type HistoricoEstudio } from "../../../lib/calc/estudio-agencia";

/**
 * Estudio de agencia (Planificación).
 * GET ?agencia=X → históricos de cartera de la agencia (balance: 14xx y 1499; reporte de recuperación de cartera, si se cargó; estado de resultados acumulado:
 *     5104 por línea, mora, 4402 por línea y 560410), desde diciembre de hace tres años.
 * POST { accion: "aplicar", agencia, filas?, cumplimiento?, filasCaptaciones?, gastos?, incremento?, origen } → guarda una copia de los parámetros de crédito y
 *     del % de cumplimiento vigentes y los reemplaza (Cartera → Parámetros de crédito y Colocación → Cumplimiento).
 * POST { accion: "deshacer", agencia } → vuelve a la última copia guardada.
 * GET ?agencia=X&vista=respaldos → copias guardadas (fecha y origen).
 */
const BAL21 = ["21", "2101", "210135", "2103", "21013505", "21013510", "21013515", "21013535", "149905", "149910", "149915", "149920", "149980"];
// gastos de operación (45, sus grupos y subcuentas) y lo que forma el margen financiero (eficiencia)
const ER2 = ["41", "42", "45", "51", "52", "53", "54", "55", "56", "4103", "4105", "410590", "41059005", "5190", "519090", "51909005", "47", "560405", "5101", "5103", "44", "46", "48"];
// 410115 por producto: 41011505 ahorro a la vista, 41011535 Crecer, 41011540 solidaria
const ER = ["4101", "410115", "41011505", "41011535", "41011540", "410130", "5104", "510405", "510410", "510415", "510420", "510430", "510435", "510450", "4402", "440210", "440220", "440230", "440240", "560410"];

async function agenciaId(db: ReturnType<typeof getDb>, nombre: string): Promise<number> {
  if (!nombre || nombre === "Matriz") return getOrCreateMatrizId(db);
  const r = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  if (!r.rows.length) throw new Error(`La agencia "${nombre}" no existe`);
  return Number(r.rows[0].id);
}
async function tablaRespaldos(db: ReturnType<typeof getDb>) {
  await db.execute(`CREATE TABLE IF NOT EXISTS respaldos_parametros (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agencia TEXT NOT NULL, creado TEXT NOT NULL, origen TEXT, datos TEXT NOT NULL)`);
}

async function leerGET(req: NextRequest) {
  try {
    const db = getDb();
    const EJERCICIO = await ejercicioDe(req);
    const agencia = req.nextUrl.searchParams.get("agencia") ?? "";
    if (req.nextUrl.searchParams.get("vista") === "respaldos") {
      await tablaRespaldos(db);
      const r = await db.execute({ sql: `SELECT id, creado, origen FROM respaldos_parametros WHERE agencia = ? ORDER BY id DESC LIMIT 10`, args: [agencia] });
      return NextResponse.json({ respaldos: r.rows.map((x) => ({ id: Number(x.id), creado: String(x.creado), origen: String(x.origen ?? "") })) });
    }
    const hist = await leerHistorico(db, agencia);
    if (!hist) return NextResponse.json({ agencia, bal: {}, er: {} });
    const { bal, er, rec } = hist;
    // pase a riesgo de la cooperativa (suma de las agencias) en los meses sin alivio: referencia del idóneo
    const paseCoop = await paseCooperativa(db).catch((e) => { console.error(e); return null; });
    // presupuesto departamental 2027 de la agencia en cuentas 45 y nombres de las subcuentas
    let dep: Record<string, unknown>[] = [], nombres: Record<string, string> = {};
    try {
      const id = await agenciaId(db, agencia);
      dep = (await db.execute({ sql: `SELECT departamento, concepto, cuenta_nombre, mes, monto, COALESCE(modo, 'directo') AS modo FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ? AND concepto LIKE '45%'`, args: [id, EJERCICIO] }))
        .rows.map((x) => ({ departamento: String(x.departamento), concepto: String(x.concepto), cuenta_nombre: x.cuenta_nombre === null ? null : String(x.cuenta_nombre), mes: Number(x.mes), monto: Number(x.monto) || 0, modo: String(x.modo) }));
      const nm = await db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE ((codigo LIKE '45%' OR codigo LIKE '52%' OR codigo LIKE '54%' OR codigo LIKE '56%' OR codigo LIKE '47%') AND LENGTH(codigo) <= 6) OR codigo LIKE '1908%' OR codigo LIKE '2908%'`);
      nombres = Object.fromEntries(nm.rows.map((x) => [String(x.codigo), String(x.nombre)]));
    } catch (e) { console.error(e); }
    return NextResponse.json({ agencia, bal, er, rec, dep, nombres, paseCoop });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error leyendo los históricos de la agencia" }, { status: 500 });
  }
}
/** Históricos de cartera de una oficina (balance, estado de resultados y reporte de recuperación). null sin datos. */
async function leerHistorico(db: ReturnType<typeof getDb>, agencia: string) {
    const ult = await db.execute({ sql: `SELECT MAX(periodo) AS p FROM historico_cuentas WHERE oficina = ?`, args: [agencia] });
    const p = String(ult.rows[0]?.p ?? "");
    if (!p) return null;
    const desde = `${Number(p.slice(0, 4)) - 3}-12`;
    const r = await db.execute({
      sql: `SELECT periodo, tipo, codigo, valor FROM historico_cuentas
            WHERE oficina = ? AND periodo >= ? AND (
              (tipo = 'BAL' AND (codigo IN ('1499', '1103', '13', '11', '16', '18', '19', '25', '29', '31', '33', '36') OR (codigo LIKE '14%' AND LENGTH(codigo) = 4) OR codigo LIKE '1908%' OR codigo LIKE '2908%' OR codigo IN (${BAL21.map(() => "?").join(",")}))) OR
              (tipo = 'ER' AND (codigo IN (${ER.map(() => "?").join(",")}) OR codigo LIKE '45%' OR ((codigo LIKE '52%' OR codigo LIKE '54%' OR codigo LIKE '56%' OR codigo LIKE '47%') AND LENGTH(codigo) = 6) OR codigo IN (${ER2.map(() => "?").join(",")}))))`,
      args: [agencia, desde, ...BAL21, ...ER, ...ER2],
    });
    const bal: Record<string, Record<string, number>> = {}, er: Record<string, Record<string, number>> = {};
    for (const x of r.rows) {
      const t = String(x.tipo) === "BAL" ? bal : er, per = String(x.periodo);
      (t[per] ??= {})[String(x.codigo)] = Number(x.valor) || 0;
    }
    // reporte de recuperación de cartera (Carga de datos → Recuperación de cartera); es opcional
    const rec: Record<string, Record<string, Record<string, number>>> = {};
    try {
      const rr = await db.execute({ sql: `SELECT periodo, tipo, saldo, capital, recuperado, precancelados, refinanciado, neto FROM recuperacion_cartera WHERE oficina = ?`, args: [agencia] });
      for (const x of rr.rows) (rec[String(x.periodo)] ??= {})[String(x.tipo)] = {
        saldo: Number(x.saldo) || 0, capital: Number(x.capital) || 0, recuperado: Number(x.recuperado) || 0,
        precancelados: Number(x.precancelados) || 0, refinanciado: Number(x.refinanciado) || 0, neto: Number(x.neto) || 0,
      };
    } catch { /* la tabla aún no existe */ }
    return { bal, er, rec };
}

/**
 * Pase a riesgo mensual de la cooperativa por línea (suma de lo que pasó a riesgo en las agencias ÷ suma de su cartera por
 * vencer del mes anterior), en los meses sin alivio: la referencia de lo que logran las agencias en conjunto.
 */
function paseCooperativa(db: ReturnType<typeof getDb>): Promise<(number | null)[] | null> {
  return conCache("estudio:pase-cooperativa", async () => {
    const [ofs, cfg] = await Promise.all([
      db.execute(`SELECT DISTINCT oficina FROM historico_cuentas WHERE oficina <> 'Consolidado'`),
      leerConfig(db),
    ]);
    const mig = LINEAS_ESTUDIO.map(() => 0), pv0 = LINEAS_ESTUDIO.map(() => 0);
    for (const x of ofs.rows) {
      const of = String(x.oficina);
      const h = await leerHistorico(db, of);
      if (!h) continue;
      const z = LINEAS_ESTUDIO.map(() => 0);
      const r = calcularRealidad({ agencia: of, ...h } as HistoricoEstudio, { p: LINEAS_ESTUDIO.map(() => 1 / 36), rv: z, meta: 0, desde: cfg.ventanaDesde, hasta: cfg.ventanaHasta });
      for (const m of r?.meses ?? []) {
        if (m.p < cfg.ventanaDesde || (cfg.ventanaHasta && m.p > cfg.ventanaHasta)) continue;
        LINEAS_ESTUDIO.forEach((_, i) => { mig[i] += m.mig[i]; pv0[i] += m.pv0[i]; });
      }
    }
    return mig.map((x, i) => (pv0[i] > 1000 ? Math.max(0, x / pv0[i]) : null));
  });
}

export const GET = conCacheGET("estudio-agencia", leerGET);

interface Fila {
  linea: string; mes: number; monto_promedio: number; tasa_interes_anual: number; pct_recuperacion_periodo: number;
  tasa_efectividad_recup: number; num_operaciones_conceder: number; tasa_recuperacion_vencida: number; pct_distribucion: number | null;
  pct_pase_riesgo?: number | null; pct_precancelacion?: number | null;
}
const upsertCredito = (id: number, f: Fila, modo = "CAPACIDAD_ARCHIVO") => sqlGuardarCredito(id, { ...f, modo_colocacion: modo });
interface FilaCapt { producto: string; mes: number; tasa_interes_anual: number; pct_ingresos: number | null; pct_retiros: number | null; pct_liquidez?: number | null; pct_cancelaciones: number | null; ratio_renovaciones: number | null }
const upsertCapt = (id: number, f: FilaCapt) => ({
  sql: `INSERT INTO parametros_captaciones (agencia_id, producto, mes, tasa_interes_anual, pct_ingresos, pct_retiros, pct_liquidez, pct_cancelaciones, ratio_renovaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agencia_id, producto, mes) DO UPDATE SET
          tasa_interes_anual = excluded.tasa_interes_anual, pct_ingresos = excluded.pct_ingresos, pct_retiros = excluded.pct_retiros,
          pct_liquidez = excluded.pct_liquidez, pct_cancelaciones = excluded.pct_cancelaciones, ratio_renovaciones = excluded.ratio_renovaciones`,
  args: [id, f.producto, f.mes, f.tasa_interes_anual ?? 0, f.pct_ingresos ?? null, f.pct_retiros ?? null, f.pct_liquidez ?? null, f.pct_cancelaciones ?? null, f.ratio_renovaciones ?? null],
});
// ajustes del Estudio a los gastos de operación: filas propias de la agencia (gasto directo), no tocan las cargadas
const DEP_ESTUDIO = "Estudio de agencia";
/** Sentencias del Estudio para un ejercicio (el del pedido). */
function sentencias(EJERCICIO: number) {
  const insGasto = (id: number, concepto: string, nombre: string | null, mes: number, monto: number) => ({
    sql: `INSERT INTO presupuesto_departamental (departamento, concepto, cuenta_nombre, mes, monto, nota, agencia_id, modo, resumen_id, origen, ejercicio)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'directo', NULL, 'estudio', ?)`,
    args: [DEP_ESTUDIO, concepto, nombre, mes, monto, "Ajuste del Estudio de agencia (Planificación)", id, EJERCICIO],
  });
  const sqlGastos = (id: number, g: { concepto: string; cuenta_nombre: string | null; montos: number[] | null }) => [
    { sql: `DELETE FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ? AND departamento = ? AND concepto = ?`, args: [id, EJERCICIO, DEP_ESTUDIO, String(g.concepto)] },
    ...(g.montos ?? []).map((m, i) => insGasto(id, String(g.concepto), g.cuenta_nombre ?? null, i + 1, Number(m) || 0)),
  ];
  const sqlOtro = (id: number, concepto: string, mes: number, monto: number) => ({
    sql: `INSERT INTO otros_pasivo_parametros (agencia_id, ejercicio, concepto, mes, monto) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(agencia_id, ejercicio, concepto, mes) DO UPDATE SET monto = excluded.monto`,
    args: [id, EJERCICIO, concepto, mes, monto],
  });
  const sqlCumpl = (id: number, mes: number, monto: number) => ({
    sql: `INSERT INTO otros_pasivo_parametros (agencia_id, ejercicio, concepto, mes, monto) VALUES (?, ?, 'colocacion_pct_cumplimiento', ?, ?)
          ON CONFLICT(agencia_id, ejercicio, concepto, mes) DO UPDATE SET monto = excluded.monto`,
    args: [id, EJERCICIO, mes, monto],
  });
  return { insGasto, sqlGastos, sqlOtro, sqlCumpl };
}

/** Borra las filas de la agencia y vuelve a poner las de la copia, con todas sus columnas. */
function restaurarFilas(tabla: "parametros_credito" | "parametros_captaciones", id: number, filas: Record<string, unknown>[]) {
  const out: { sql: string; args: (string | number | null)[] }[] = [{ sql: `DELETE FROM ${tabla} WHERE agencia_id = ?`, args: [id] }];
  for (const f of filas) {
    const cols = Object.keys(f).filter((c) => /^\w+$/.test(c));
    out.push({
      sql: `INSERT INTO ${tabla} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      args: cols.map((c) => (c === "agencia_id" ? id : f[c] === null || f[c] === undefined ? null : typeof f[c] === "number" ? (f[c] as number) : String(f[c]))),
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const EJERCICIO = await ejercicioDe(req, body);
    const { insGasto, sqlGastos, sqlOtro, sqlCumpl } = sentencias(EJERCICIO);
    const agencia = String(body.agencia ?? "");
    const id = await agenciaId(db, agencia);
    await tablaRespaldos(db);
    await asegurarColumnasCredito(db);
    if (body.accion === "aplicar") {
      const filas = (body.filas ?? []) as Fila[];
      const filasCapt = (body.filasCaptaciones ?? []) as FilaCapt[];
      const gastos = (body.gastos ?? []) as { concepto: string; cuenta_nombre: string | null; montos: number[] | null }[];
      const factorMora = typeof body.factorMora === "number" && isFinite(body.factorMora) && body.factorMora > 0 ? Number(body.factorMora) : null;
      // interés de mora de la agencia (% del interés de cartera)
      const interesMora = typeof body.interesMora === "number" && isFinite(body.interesMora) && body.interesMora >= 0 && body.interesMora <= 0.5 ? Number(body.interesMora) : null;
      const tasaInterna = typeof body.tasaInterna === "number" && isFinite(body.tasaInterna) ? Number(body.tasaInterna) : null;
      const tasaBancos = typeof body.tasaBancos === "number" && isFinite(body.tasaBancos) ? Number(body.tasaBancos) : null;
      // provisión: pase a riesgo por línea y recuperación de cartera vencida reales (Provisiones → Real frente al modelo)
      const pr = body.provisionReal as { pase?: Record<string, number>; rv?: number | null; q?: number | null } | undefined;
      const paseReal = Object.entries(pr?.pase ?? {}).filter(([l, v]) => ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"].includes(l) && typeof v === "number" && isFinite(v) && v >= 0);
      const rvReal = typeof pr?.rv === "number" && isFinite(pr.rv) && pr.rv >= 0 ? pr.rv : null;
      // precancelaciones con dinero reales (sin refinanciamientos), en las líneas activas
      const qReal = typeof pr?.q === "number" && isFinite(pr.q) && pr.q >= 0 && pr.q < 0.2 ? pr.q : null;
      const sqlProvReal = [
        ...paseReal.map(([l, v]) => ({ sql: `UPDATE parametros_credito SET pct_pase_riesgo = ? WHERE agencia_id = ? AND linea = ?`, args: [v, id, l] })),
        ...(rvReal !== null ? [{ sql: `UPDATE parametros_credito SET tasa_recuperacion_vencida = ? WHERE agencia_id = ? AND COALESCE(pct_recuperacion_periodo, 0) > 0`, args: [rvReal, id] }] : []),
        ...(qReal !== null ? [{ sql: `UPDATE parametros_credito SET pct_precancelacion = ? WHERE agencia_id = ? AND COALESCE(pct_recuperacion_periodo, 0) > 0`, args: [qReal, id] }] : []),
      ];
      const incremento = typeof body.incremento === "number" && isFinite(body.incremento) ? Number(body.incremento) : null;
      const cumpl = Array.isArray(body.cumplimiento) && body.cumplimiento.length === 12 ? (body.cumplimiento as number[]).map(Number) : null;
      if (!filas.length && !cumpl && !filasCapt.length && !gastos.length && incremento === null && tasaInterna === null && tasaBancos === null && factorMora === null && interesMora === null && !sqlProvReal.length) return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 });
      // copia de lo vigente (solo de lo que se va a reemplazar)
      const copia: Record<string, unknown> = {};
      if (filas.length || sqlProvReal.length) copia.credito = (await db.execute({ sql: `SELECT * FROM parametros_credito WHERE agencia_id = ?`, args: [id] })).rows.map((r) => ({ ...r }));
      if (cumpl) copia.cumplimiento = (await db.execute({ sql: `SELECT mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'colocacion_pct_cumplimiento'`, args: [id, EJERCICIO] })).rows.map((r) => ({ mes: Number(r.mes), monto: Number(r.monto) }));
      if (gastos.length) copia.gastos = { conceptos: gastos.map((g) => g.concepto), filas: (await db.execute({ sql: `SELECT departamento, concepto, cuenta_nombre, mes, monto FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ? AND departamento = ?`, args: [id, EJERCICIO, DEP_ESTUDIO] })).rows.map((r) => ({ ...r })) };
      if (factorMora !== null) copia.factorMora = (await db.execute({ sql: `SELECT mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'provision_factor_mora'`, args: [id, EJERCICIO] })).rows.map((r) => ({ mes: Number(r.mes), monto: Number(r.monto) }));
      if (interesMora !== null) copia.interesMora = (await db.execute({ sql: `SELECT mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'interes_mora_pct'`, args: [id, EJERCICIO] })).rows.map((r) => ({ mes: Number(r.mes), monto: Number(r.monto) }));
      if (tasaInterna !== null) copia.tasaInterna = (await db.execute({ sql: `SELECT mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'ingresos_tasa_prestamos_internos'`, args: [id, EJERCICIO] })).rows.map((r) => ({ mes: Number(r.mes), monto: Number(r.monto) }));
      if (tasaBancos !== null) copia.tasaBancos = (await db.execute({ sql: `SELECT mes, monto FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'ingresos_tasa_bancos'`, args: [id, EJERCICIO] })).rows.map((r) => ({ mes: Number(r.mes), monto: Number(r.monto) }));
      if (incremento !== null) copia.incremento = (await db.execute({ sql: `SELECT id, incremento_pct FROM nomina_empleados WHERE agencia_id = ? AND activo = 1`, args: [id] })).rows.map((r) => ({ id: Number(r.id), incremento_pct: Number(r.incremento_pct) }));
      if (filasCapt.length) copia.captaciones = (await db.execute({ sql: `SELECT * FROM parametros_captaciones WHERE agencia_id = ?`, args: [id] })).rows.map((r) => ({ ...r }));
      await db.batch([
        { sql: `INSERT INTO respaldos_parametros (agencia, creado, origen, datos) VALUES (?, ?, ?, ?)`, args: [agencia, new Date().toISOString(), String(body.origen ?? "Estudio de agencia"), JSON.stringify(copia)] },
        ...filas.map((f) => upsertCredito(id, f)),
        ...sqlProvReal,
        ...(cumpl ? cumpl.map((m, i) => sqlCumpl(id, i + 1, m)) : []),
        ...filasCapt.map((f) => upsertCapt(id, f)),
        ...gastos.flatMap((g) => sqlGastos(id, g)),
        ...(factorMora !== null ? Array.from({ length: 12 }, (_, i) => sqlOtro(id, "provision_factor_mora", i + 1, factorMora)) : []),
        ...(interesMora !== null ? Array.from({ length: 12 }, (_, i) => sqlOtro(id, "interes_mora_pct", i + 1, interesMora)) : []),
        ...(tasaInterna !== null ? Array.from({ length: 12 }, (_, i) => sqlOtro(id, "ingresos_tasa_prestamos_internos", i + 1, tasaInterna)) : []),
        ...(tasaBancos !== null ? Array.from({ length: 12 }, (_, i) => sqlOtro(id, "ingresos_tasa_bancos", i + 1, tasaBancos)) : []),
        ...(incremento !== null ? [{ sql: `UPDATE nomina_empleados SET incremento_pct = ? WHERE agencia_id = ? AND activo = 1`, args: [incremento, id] }] : []),
      ], "write");
      return NextResponse.json({ ok: true });
    }
    if (body.accion === "deshacer") {
      const r = await db.execute({ sql: `SELECT id, datos FROM respaldos_parametros WHERE agencia = ? ORDER BY id DESC LIMIT 1`, args: [agencia] });
      if (!r.rows.length) return NextResponse.json({ error: "No hay una copia para volver." }, { status: 400 });
      const d = JSON.parse(String(r.rows[0].datos)) as { credito?: (Fila & { modo_colocacion?: string })[]; cumplimiento?: { mes: number; monto: number }[]; captaciones?: FilaCapt[];
        gastos?: { conceptos: string[]; filas: { departamento: string; concepto: string; cuenta_nombre: string | null; mes: number; monto: number }[] }; incremento?: { id: number; incremento_pct: number }[]; tasaInterna?: { mes: number; monto: number }[]; tasaBancos?: { mes: number; monto: number }[]; factorMora?: { mes: number; monto: number }[]; interesMora?: { mes: number; monto: number }[] };
      await db.batch([
        // crédito y captaciones: la agencia queda exactamente como estaba (filas, columnas y modo), sin filas nuevas
        ...(d.credito ? restaurarFilas("parametros_credito", id, d.credito as unknown as Record<string, unknown>[]) : []),
        ...(d.cumplimiento ? [{ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'colocacion_pct_cumplimiento'`, args: [id, EJERCICIO] }] : []),
        ...(d.cumplimiento ?? []).map((c) => sqlCumpl(id, c.mes, c.monto)),
        ...(d.captaciones ? restaurarFilas("parametros_captaciones", id, d.captaciones as unknown as Record<string, unknown>[]) : []),
        // gastos: las filas del Estudio vuelven a como estaban
        ...(d.gastos ? [{ sql: `DELETE FROM presupuesto_departamental WHERE agencia_id = ? AND ejercicio = ? AND departamento = ?`, args: [id, EJERCICIO, DEP_ESTUDIO] }] : []),
        ...(d.gastos?.filas ?? []).map((f) => insGasto(id, f.concepto, f.cuenta_nombre, f.mes, f.monto)),
        ...(d.factorMora ? [{ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'provision_factor_mora'`, args: [id, EJERCICIO] }] : []),
        ...(d.factorMora ?? []).map((c) => sqlOtro(id, "provision_factor_mora", c.mes, c.monto)),
        ...(d.interesMora ? [{ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'interes_mora_pct'`, args: [id, EJERCICIO] }] : []),
        ...(d.interesMora ?? []).map((c) => sqlOtro(id, "interes_mora_pct", c.mes, c.monto)),
        ...(d.tasaInterna ? [{ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'ingresos_tasa_prestamos_internos'`, args: [id, EJERCICIO] }] : []),
        ...(d.tasaInterna ?? []).map((c) => sqlOtro(id, "ingresos_tasa_prestamos_internos", c.mes, c.monto)),
        ...(d.tasaBancos ? [{ sql: `DELETE FROM otros_pasivo_parametros WHERE agencia_id = ? AND ejercicio = ? AND concepto = 'ingresos_tasa_bancos'`, args: [id, EJERCICIO] }] : []),
        ...(d.tasaBancos ?? []).map((c) => sqlOtro(id, "ingresos_tasa_bancos", c.mes, c.monto)),
        ...(d.incremento ?? []).map((e) => ({ sql: `UPDATE nomina_empleados SET incremento_pct = ? WHERE id = ? AND agencia_id = ?`, args: [e.incremento_pct, e.id, id] })),
        { sql: `DELETE FROM respaldos_parametros WHERE id = ?`, args: [Number(r.rows[0].id)] },
      ], "write");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error guardando" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
