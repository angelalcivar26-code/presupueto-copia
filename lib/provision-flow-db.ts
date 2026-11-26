import { getDb } from "./turso";
import { ventanaSimulada } from "./ventana-simulada";
import { conCache } from "./cache-motor";
import { ErrorEntrada } from "./validacion";
import {
  PRODUCTOS, TRAMOS, productoDe, tramoDe, castigoPorProducto, participacionE, calibrarFactorMora, calibrarRitmoAgencia, castigosImplicitos, type RepartoAgencia, type CorteAgencia,
  type ConfigFlow, type Escenario, type HistoriaTramos, type InsumosProvisionFlow, type MesEERR, type ParametrosFlow, type Producto, type SaldosTramo,
} from "./calc/provision-flow";

/**
 * Base de datos del modelo de provisión por flow rates.
 *  - provision_calificacion     : cortes de Calificación de Cartera (formato largo, igual que cartera_historica_long.csv)
 *  - provision_eerr             : 4402, 5604.10 y 5604.05 consolidados, valores del mes (para recalibrar y el backtest)
 *  - provision_flow_parametros  : n, flow rates por escenario y tasa efectiva, por producto y tramo (editables)
 *  - provision_flow_config      : castigo mensual, escenario activo, recuperación anual por escenario,
 *                                 factores Optimista/Pesimista y ventana de calibración del Base
 * La primera vez se cargan con los datos semilla (lib/provision-semilla.ts).
 */
type Db = ReturnType<typeof getDb>;

const CONFIG_DEFECTO: ConfigFlow = {
  castigoMensual: 300000, escenario: "base",
  recuperacionAnual: { optimista: 575265.07, base: 517393.21, pesimista: 384385.19 },
  factorOptimista: 0.8, factorPesimista: 1.25, ventanaDesde: "2026-06", ventanaHasta: "2026-09", ritmo: "agencia",
};

/** Nombre de agencia del reporte (BALSAS, PINAS…) → clave comparable con los nombres de la herramienta. */
export function claveOficina(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

let listas: Promise<void> | null = null;
export function asegurarTablasProvisionFlow(db: Db): Promise<void> {
  if (!listas) {
    listas = (async () => {
      await db.batch([
        `CREATE TABLE IF NOT EXISTS provision_calificacion (
          periodo TEXT NOT NULL, corte TEXT NOT NULL, oficina TEXT NOT NULL, tipo TEXT NOT NULL, producto TEXT NOT NULL,
          cat TEXT NOT NULL, desde INTEGER, hasta INTEGER, saldo REAL NOT NULL, pct REAL, prov REAL NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_prov_calif_periodo ON provision_calificacion (periodo)`,
        // Única por fila del reporte: si dos servidores siembran a la vez, no se duplica nada (INSERT OR IGNORE)
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_prov_calif ON provision_calificacion (periodo, oficina, tipo, cat, desde, hasta)`,
        `CREATE TABLE IF NOT EXISTS provision_eerr (
          periodo TEXT PRIMARY KEY, g4402 REAL NOT NULL DEFAULT 0, r560410 REAL NOT NULL DEFAULT 0, r560405 REAL NOT NULL DEFAULT 0,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE TABLE IF NOT EXISTS provision_flow_parametros (
          producto TEXT NOT NULL, tramo TEXT NOT NULL, n REAL NOT NULL DEFAULT 1,
          fr_optimista REAL NOT NULL DEFAULT 0, fr_base REAL NOT NULL DEFAULT 0, fr_pesimista REAL NOT NULL DEFAULT 0,
          tasa REAL NOT NULL DEFAULT 0, actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (producto, tramo)
        )`,
        `CREATE TABLE IF NOT EXISTS provision_flow_config (
          id INTEGER PRIMARY KEY CHECK (id = 1), castigo_mensual REAL NOT NULL, escenario TEXT NOT NULL,
          rec_optimista REAL NOT NULL, rec_base REAL NOT NULL, rec_pesimista REAL NOT NULL,
          factor_optimista REAL NOT NULL, factor_pesimista REAL NOT NULL, ventana_desde TEXT NOT NULL, ventana_hasta TEXT NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      ], "write");
      // ritmo de atraso: "agencia" (cada agencia el suyo) o "cooperativa" (metodología anterior, el mismo para todas)
      await db.execute(`ALTER TABLE provision_flow_config ADD COLUMN ritmo TEXT NOT NULL DEFAULT 'agencia'`).catch(() => undefined);
      // ventana hasta el último corte cargado (1): al cargar un mes nuevo de calificación, la ventana lo incluye sola
      await db.execute(`ALTER TABLE provision_flow_config ADD COLUMN ventana_auto INTEGER NOT NULL DEFAULT 1`).catch(() => undefined);
      await sembrarSiVacio(db);
    })().catch((e) => { listas = null; throw e; });
  }
  return listas;
}

async function sembrarSiVacio(db: Db) {
  const [p, c, e, k] = await Promise.all([
    db.execute(`SELECT COUNT(*) AS n FROM provision_flow_parametros`),
    db.execute(`SELECT COUNT(*) AS n FROM provision_calificacion`),
    db.execute(`SELECT COUNT(*) AS n FROM provision_eerr`),
    db.execute(`SELECT COUNT(*) AS n FROM provision_flow_config`),
  ]);
  const vacio = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.n ?? 0) === 0;
  if (!vacio(p) && !vacio(c) && !vacio(e) && !vacio(k)) return;
  const s = await import("./provision-semilla");
  if (vacio(p)) {
    await db.batch(s.SEMILLA_PARAMETROS.map(([producto, tramo, n, o, b, pe, tasa]) => ({
      sql: `INSERT OR IGNORE INTO provision_flow_parametros (producto, tramo, n, fr_optimista, fr_base, fr_pesimista, tasa) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [producto, tramo, n, o, b, pe, tasa],
    })), "write");
  }
  if (vacio(k)) await guardarConfig(db, CONFIG_DEFECTO);
  if (vacio(e)) {
    await db.batch(s.SEMILLA_EERR.map(([periodo, g, r10, r05]) => ({
      sql: `INSERT OR IGNORE INTO provision_eerr (periodo, g4402, r560410, r560405) VALUES (?, ?, ?, ?)`, args: [periodo, g, r10, r05],
    })), "write");
  }
  if (vacio(c)) {
    await insertarCalificacion(db, s.SEMILLA_CALIFICACION.map(([periodo, corte, oficina, tipo, cat, desde, hasta, saldo, pct, prov]) =>
      ({ periodo, corte, oficina, tipo, cat, desde, hasta, saldo, pct, prov })));
  }
}

export interface FilaCalificacion {
  periodo: string; corte: string; oficina: string; tipo: string; cat: string;
  desde: number | null; hasta: number | null; saldo: number; pct: number | null; prov: number;
}

/** Sentencias INSERT (en lotes de 200 filas) para las filas de calificación. */
function sentenciasCalificacion(filasEntrada: FilaCalificacion[]) {
  // Filas repetidas del mismo corte, agencia, tipo, calificación y rango se suman (la clave es única)
  const unicas = new Map<string, FilaCalificacion>();
  for (const f of filasEntrada) {
    const k = [f.periodo, claveOficina(f.oficina), f.tipo.trim(), f.cat.trim(), f.desde, f.hasta].join("|");
    const a = unicas.get(k);
    if (a) { a.saldo += f.saldo; a.prov += f.prov; } else unicas.set(k, { ...f });
  }
  const filas = [...unicas.values()];
  const LOTE = 200;
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE).filter((f) => productoDe(f.tipo));
    if (!lote.length) continue;
    stmts.push({
      sql: `INSERT OR IGNORE INTO provision_calificacion (periodo, corte, oficina, tipo, producto, cat, desde, hasta, saldo, pct, prov) VALUES `
        + lote.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", "),
      args: lote.flatMap((f) => [f.periodo, f.corte, claveOficina(f.oficina), f.tipo.trim(), productoDe(f.tipo)!, f.cat.trim(), f.desde, f.hasta, f.saldo, f.pct, f.prov]),
    });
  }
  return stmts;
}

async function insertarCalificacion(db: Db, filasEntrada: FilaCalificacion[]) {
  const stmts = sentenciasCalificacion(filasEntrada);
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20), "write");
}

/** Revisa las filas antes de tocar la base: un corte se reemplaza solo si todo lo que trae es válido. */
function validarCalificacion(filas: FilaCalificacion[]) {
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  filas.forEach((f, i) => {
    const fila = `Fila ${i + 1}`;
    if (typeof f.periodo !== "string" || !/^\d{4}-\d{2}$/.test(f.periodo)) throw new ErrorEntrada(`${fila}: periodo «${String(f.periodo)}» no válido (se espera AAAA-MM).`);
    if (!f.oficina || !f.tipo || !f.cat) throw new ErrorEntrada(`${fila}: falta oficina, tipo o calificación.`);
    if (!num(f.saldo) || !num(f.prov)) throw new ErrorEntrada(`${fila}: saldo o provisión no es un número.`);
    if ((f.pct !== null && !num(f.pct)) || (f.desde !== null && !num(f.desde)) || (f.hasta !== null && !num(f.hasta))) throw new ErrorEntrada(`${fila}: porcentaje o rango de días no es un número.`);
  });
}

/** Reemplaza los cortes que traen las filas (un periodo se carga completo), en un solo lote: o todo o nada. */
export async function guardarCalificacion(db: Db, filas: FilaCalificacion[]) {
  validarCalificacion(filas);
  await asegurarTablasProvisionFlow(db);
  const periodos = [...new Set(filas.map((f) => f.periodo))];
  await db.batch([
    ...periodos.map((p) => ({ sql: `DELETE FROM provision_calificacion WHERE periodo = ?`, args: [p] })),
    ...sentenciasCalificacion(filas),
  ], "write");
  return periodos;
}

export async function guardarEERR(db: Db, meses: MesEERR[]) {
  await asegurarTablasProvisionFlow(db);
  if (!meses.length) return;
  await db.batch(meses.map((m) => ({
    sql: `INSERT INTO provision_eerr (periodo, g4402, r560410, r560405, actualizado_en) VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(periodo) DO UPDATE SET g4402 = excluded.g4402, r560410 = excluded.r560410, r560405 = excluded.r560405, actualizado_en = excluded.actualizado_en`,
    args: [m.periodo, m.g4402, m.r560410, m.r560405],
  })), "write");
}

/**
 * ER del modelo de provisión (4402, 5604.10, 5604.05 de la cooperativa, valores del mes).
 * Fuente principal: los Estados de resultados cargados en Históricos (Consolidado; si no está, la suma de las 10 agencias
 * cuando están todas). Así, al subir un mes nuevo (octubre, diciembre…) entra solo, sin depender de otra carga.
 * La tabla provision_eerr queda para los meses que no están en Históricos (semilla 2024–2025).
 */
export async function leerEERR(db: Db): Promise<MesEERR[]> {
  await asegurarTablasProvisionFlow(db);
  const [r, h] = await Promise.all([
    db.execute(`SELECT periodo, g4402, r560410, r560405 FROM provision_eerr ORDER BY periodo`),
    eerrDeHistoricos(db),
  ]);
  const out = new Map<string, MesEERR>();
  for (const x of r.rows) out.set(String(x.periodo), { periodo: String(x.periodo), g4402: Number(x.g4402) || 0, r560410: Number(x.r560410) || 0, r560405: Number(x.r560405) || 0 });
  for (const m of h) out.set(m.periodo, m);
  return [...out.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

type AcumER = { g4402: number; r560410: number; r560405: number };
/** Meses del ER de la cooperativa desde Históricos (acumulado en el año → valor del mes). */
export function eerrDeHistoricos(db: Db): Promise<MesEERR[]> {
  // una sola lectura por versión de los datos (la usan las 10 agencias y varias pantallas)
  return conCache("hist:eerr", () => eerrDeHistoricosLeer(db));
}
async function eerrDeHistoricosLeer(db: Db): Promise<MesEERR[]> {
  const r = await db.execute(`SELECT oficina, periodo, codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND codigo IN ('4402', '560410', '560405')`)
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const cons = new Map<string, AcumER>(), suma = new Map<string, AcumER>(), conGasto = new Map<string, Set<string>>();
  const campo = (c: string) => (c === "4402" ? "g4402" : c === "560410" ? "r560410" : "r560405") as keyof AcumER;
  for (const x of r.rows) {
    const of = claveOficina(String(x.oficina)), per = String(x.periodo), c = String(x.codigo), v = Number(x.valor) || 0;
    const m = of === "CONSOLIDADO" ? cons : suma;
    const a = m.get(per) ?? { g4402: 0, r560410: 0, r560405: 0 }; m.set(per, a);
    a[campo(c)] += v;
    if (of !== "CONSOLIDADO" && c === "4402") { const s = conGasto.get(per) ?? new Set(); s.add(of); conGasto.set(per, s); }
  }
  // acumulado de la cooperativa por mes: el Consolidado; si no está, la suma de las agencias solo si están las 10
  const acum = new Map<string, AcumER>();
  for (const per of new Set([...cons.keys(), ...suma.keys()])) {
    if (cons.has(per)) acum.set(per, cons.get(per)!);
    else if ((conGasto.get(per)?.size ?? 0) >= 10) acum.set(per, suma.get(per)!);
  }
  const out: MesEERR[] = [];
  for (const [per, a] of acum) {
    const [y, mm] = per.split("-").map(Number);
    if (mm === 1) { out.push({ periodo: per, ...a }); continue; }
    const b = acum.get(`${y}-${String(mm - 1).padStart(2, "0")}`);
    if (!b) continue; // sin el mes anterior no se puede mensualizar
    out.push({ periodo: per, g4402: a.g4402 - b.g4402, r560410: a.r560410 - b.r560410, r560405: a.r560405 - b.r560405 });
  }
  return out.sort((a, b) => a.periodo.localeCompare(b.periodo));
}

export async function leerParametrosFlow(db: Db): Promise<ParametrosFlow> {
  await asegurarTablasProvisionFlow(db);
  const r = await db.execute(`SELECT producto, tramo, n, fr_optimista, fr_base, fr_pesimista, tasa FROM provision_flow_parametros`);
  const out = Object.fromEntries(PRODUCTOS.map((p) => [p, {}])) as ParametrosFlow;
  for (const x of r.rows) {
    const p = String(x.producto) as Producto;
    if (!out[p]) continue;
    out[p][String(x.tramo)] = {
      n: Number(x.n) || 1, tasa: Number(x.tasa) || 0,
      fr: { optimista: Number(x.fr_optimista) || 0, base: Number(x.fr_base) || 0, pesimista: Number(x.fr_pesimista) || 0 },
    };
  }
  return out;
}

export async function guardarParametrosFlow(db: Db, par: ParametrosFlow) {
  await asegurarTablasProvisionFlow(db);
  const stmts = [];
  for (const p of PRODUCTOS) for (const t of TRAMOS[p]) {
    const v = par[p]?.[t];
    if (!v) continue;
    stmts.push({
      sql: `INSERT INTO provision_flow_parametros (producto, tramo, n, fr_optimista, fr_base, fr_pesimista, tasa, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(producto, tramo) DO UPDATE SET n = excluded.n, fr_optimista = excluded.fr_optimista, fr_base = excluded.fr_base,
              fr_pesimista = excluded.fr_pesimista, tasa = excluded.tasa, actualizado_en = excluded.actualizado_en`,
      args: [p, t, v.n, v.fr.optimista, v.fr.base, v.fr.pesimista, v.tasa],
    });
  }
  await db.batch(stmts, "write");
}

export async function leerConfig(db: Db): Promise<ConfigFlow> {
  const c = await leerConfigGuardada(db);
  // base simulada (panel "Actualizar la base"): solo cambia los meses, nada se guarda
  const v = ventanaSimulada();
  return v ? { ...c, ventanaDesde: v.desde, ventanaHasta: v.hasta, ventanaAuto: false } : c;
}

async function leerConfigGuardada(db: Db): Promise<ConfigFlow> {
  await asegurarTablasProvisionFlow(db);
  const [cfg, ult] = await Promise.all([
    db.execute(`SELECT * FROM provision_flow_config WHERE id = 1`),
    db.execute(`SELECT MAX(periodo) AS p FROM provision_calificacion`),
  ]);
  const r = cfg.rows[0];
  const ultimoCorte = ult.rows[0]?.p ? String(ult.rows[0].p) : null;
  if (!r) return { ...CONFIG_DEFECTO, recuperacionAnual: { ...CONFIG_DEFECTO.recuperacionAnual }, ventanaHasta: ultimoCorte ?? CONFIG_DEFECTO.ventanaHasta, ventanaAuto: true };
  const auto = r.ventana_auto === undefined || r.ventana_auto === null || Number(r.ventana_auto) === 1;
  const esc = String(r.escenario) as Escenario;
  return {
    castigoMensual: Number(r.castigo_mensual) || 0,
    escenario: (["optimista", "base", "pesimista"] as const).includes(esc) ? esc : "base",
    recuperacionAnual: { optimista: Number(r.rec_optimista) || 0, base: Number(r.rec_base) || 0, pesimista: Number(r.rec_pesimista) || 0 },
    factorOptimista: Number(r.factor_optimista) || 0, factorPesimista: Number(r.factor_pesimista) || 0,
    ventanaDesde: String(r.ventana_desde),
    ventanaHasta: auto && ultimoCorte && ultimoCorte >= String(r.ventana_desde) ? ultimoCorte : String(r.ventana_hasta),
    ventanaAuto: auto,
    ritmo: r.ritmo === "cooperativa" ? "cooperativa" : "agencia",
  };
}

export async function guardarConfig(db: Db, c: ConfigFlow) {
  await db.execute({
    sql: `INSERT INTO provision_flow_config (id, castigo_mensual, escenario, rec_optimista, rec_base, rec_pesimista, factor_optimista, factor_pesimista, ventana_desde, ventana_hasta, ritmo, ventana_auto, actualizado_en)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET castigo_mensual = excluded.castigo_mensual, escenario = excluded.escenario,
            rec_optimista = excluded.rec_optimista, rec_base = excluded.rec_base, rec_pesimista = excluded.rec_pesimista,
            factor_optimista = excluded.factor_optimista, factor_pesimista = excluded.factor_pesimista,
            ventana_desde = excluded.ventana_desde, ventana_hasta = excluded.ventana_hasta, ritmo = excluded.ritmo, ventana_auto = excluded.ventana_auto, actualizado_en = excluded.actualizado_en`,
    args: [c.castigoMensual, c.escenario, c.recuperacionAnual.optimista, c.recuperacionAnual.base, c.recuperacionAnual.pesimista,
      c.factorOptimista, c.factorPesimista, c.ventanaDesde, c.ventanaHasta, c.ritmo === "cooperativa" ? "cooperativa" : "agencia", c.ventanaAuto === false ? 0 : 1],
  });
}

const vacioTramos = (): SaldosTramo => Object.fromEntries(PRODUCTOS.map((p) => [p, {}])) as SaldosTramo;

/** Historia consolidada por producto y tramo (saldo y provisión) de todos los cortes cargados. */
export async function leerHistoria(db: Db): Promise<HistoriaTramos & { periodos: { periodo: string; corte: string; filas: number }[] }> {
  await asegurarTablasProvisionFlow(db);
  const r = await db.execute(`SELECT periodo, MAX(corte) AS corte, producto, cat, SUM(saldo) AS saldo, SUM(prov) AS prov, COUNT(*) AS filas
                              FROM provision_calificacion GROUP BY periodo, producto, cat`);
  const h: HistoriaTramos = { saldo: {}, prov: {} };
  const per = new Map<string, { corte: string; filas: number }>();
  for (const x of r.rows) {
    const periodo = String(x.periodo); const p = String(x.producto) as Producto;
    const t = tramoDe(p, String(x.cat)); if (!t) continue;
    const s = (h.saldo[periodo] ??= vacioTramos()); s[p][t] = (s[p][t] ?? 0) + (Number(x.saldo) || 0);
    const v = (h.prov[periodo] ??= vacioTramos()); v[p][t] = (v[p][t] ?? 0) + (Number(x.prov) || 0);
    const a = per.get(periodo) ?? { corte: String(x.corte), filas: 0 }; a.filas += Number(x.filas) || 0; per.set(periodo, a);
  }
  return { ...h, periodos: [...per.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([periodo, v]) => ({ periodo, ...v })) };
}

/** Saldo por producto, tramo y calificación de un corte (pesos para el rango de la norma en tramos agrupados). */
export async function leerCategoriasCorte(db: Db, periodo: string): Promise<Record<string, Record<string, Record<string, number>>>> {
  const r = await db.execute({ sql: `SELECT producto, cat, SUM(saldo) AS saldo FROM provision_calificacion WHERE periodo = ? GROUP BY producto, cat`, args: [periodo] });
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const x of r.rows) {
    const p = String(x.producto) as Producto; const c = String(x.cat).trim().toUpperCase(); const t = tramoDe(p, c); if (!t) continue;
    ((out[p] ??= {})[t] ??= {})[c] = (out[p][t][c] ?? 0) + (Number(x.saldo) || 0);
  }
  return out;
}

/** Saldo, provisión y días de cada calificación de un corte, por producto (tasa aplicada por calificación). */
export async function leerDetalleCategorias(db: Db, periodo: string): Promise<Record<string, Record<string, { saldo: number; prov: number; desde: number; hasta: number }>>> {
  const r = await db.execute({ sql: `SELECT producto, cat, SUM(saldo) AS saldo, SUM(prov) AS prov, MIN(desde) AS desde, MAX(hasta) AS hasta FROM provision_calificacion WHERE periodo = ? GROUP BY producto, cat`, args: [periodo] });
  const out: Record<string, Record<string, { saldo: number; prov: number; desde: number; hasta: number }>> = {};
  for (const x of r.rows) {
    const p = String(x.producto); const c = String(x.cat).trim().toUpperCase();
    const a = ((out[p] ??= {})[c] ??= { saldo: 0, prov: 0, desde: Number(x.desde) || 0, hasta: Number(x.hasta) || 0 });
    a.saldo += Number(x.saldo) || 0; a.prov += Number(x.prov) || 0;
  }
  return out;
}

/** Saldos y provisión por agencia de un corte. */
async function corteAgencias(db: Db, periodo: string): Promise<Map<string, { saldo: SaldosTramo; prov: SaldosTramo }>> {
  const r = await db.execute({ sql: `SELECT oficina, producto, cat, SUM(saldo) AS saldo, SUM(prov) AS prov FROM provision_calificacion WHERE periodo = ? GROUP BY oficina, producto, cat`, args: [periodo] });
  const m = new Map<string, { saldo: SaldosTramo; prov: SaldosTramo }>();
  for (const x of r.rows) {
    const p = String(x.producto) as Producto; const t = tramoDe(p, String(x.cat)); if (!t) continue;
    const of = String(x.oficina);
    const a = m.get(of) ?? { saldo: vacioTramos(), prov: vacioTramos() };
    a.saldo[p][t] = (a.saldo[p][t] ?? 0) + (Number(x.saldo) || 0);
    a.prov[p][t] = (a.prov[p][t] ?? 0) + (Number(x.prov) || 0);
    m.set(of, a);
  }
  return m;
}

async function ultimoPeriodo(db: Db): Promise<string | null> {
  await asegurarTablasProvisionFlow(db);
  const r = await db.execute(`SELECT MAX(periodo) AS p FROM provision_calificacion`);
  return r.rows[0]?.p ? String(r.rows[0].p) : null;
}

/**
 * Castigos y recuperación de castigada REALES de cada agencia en los meses de la ventana (desde su primer mes hasta el
 * último estado de resultados; sin ventana, los últimos 12 meses):
 *   recuperación = Σ 5604.05 del período · castigos = provisión 1499 al inicio + Σ 4402 − Σ 5604.10 − provisión 1499 al final
 * (lo que salió de la provisión sin ser reversión: los créditos dados de baja). Negativos cuentan como 0.
 * Con esto se reparten el castigo mensual y la recuperación anual de la cooperativa (Provisiones → Escenarios).
 */
type RealCastigos = { desde: string; hasta: string; porAgencia: Map<string, { castigos: number; recuperacion: number; gasto: number; reversion: number }> } | null;
function realCastigosRecuperacion(db: Db, ventanaDesde?: string): Promise<RealCastigos> {
  return conCache(`hist:castigos:${ventanaDesde ?? ""}`, () => realCastigosRecuperacionLeer(db, ventanaDesde));
}
async function realCastigosRecuperacionLeer(db: Db, ventanaDesde?: string): Promise<RealCastigos> {
  // último mes con el estado de resultados de todas las agencias
  const u = await db.execute(`SELECT MAX(periodo) AS p FROM (SELECT periodo FROM historico_cuentas WHERE tipo = 'ER' AND codigo = '4402' AND oficina <> 'Consolidado'
                              GROUP BY periodo HAVING COUNT(DISTINCT oficina) >= 10)`);
  const hasta = String(u.rows[0]?.p ?? "");
  if (!hasta) return null;
  const [y, m] = hasta.split("-").map(Number);
  const antes = (p: string) => { const [a, b] = p.split("-").map(Number); return b === 1 ? `${a - 1}-12` : `${a}-${String(b - 1).padStart(2, "0")}`; };
  // base = mes anterior al primero del período
  const base = ventanaDesde && ventanaDesde <= hasta && ventanaDesde > `${y - 2}-12` ? antes(ventanaDesde) : `${y - 1}-${String(m).padStart(2, "0")}`;
  const [yb] = base.split("-").map(Number);
  const dicBase = `${yb}-12`;
  const r = await db.execute({
    sql: `SELECT oficina, periodo, tipo, codigo, valor FROM historico_cuentas
          WHERE periodo IN (?, ?, ?) AND ((tipo = 'ER' AND codigo IN ('4402', '560410', '560405')) OR (tipo = 'BAL' AND codigo = '1499'))`,
    args: [hasta, base, dicBase],
  });
  const v = new Map<string, number>();
  for (const x of r.rows) v.set(`${claveOficina(String(x.oficina))}|${x.tipo}|${x.periodo}|${x.codigo}`, Number(x.valor) || 0);
  const oficinas = new Set(r.rows.map((x) => claveOficina(String(x.oficina))));
  const porAgencia = new Map<string, { castigos: number; recuperacion: number; gasto: number; reversion: number }>();
  for (const of of oficinas) {
    if (of === "CONSOLIDADO") continue;
    const g = (t: string, p: string, c: string) => v.get(`${of}|${t}|${p}|${c}`);
    // estado de resultados del período (viene acumulado en el año): mismo año = hasta − base; otro año = hasta + (dic − base)
    const erRango = (c: string) => {
      const a = g("ER", hasta, c), b = g("ER", base, c), d = g("ER", dicBase, c);
      if (a === undefined) return null;
      if (base.endsWith("-12")) return yb === y - 1 ? a : null;
      if (yb === y) return b === undefined ? null : a - b;
      return d === undefined || b === undefined ? null : a + d - b;
    };
    const p0 = g("BAL", base, "1499"), p1 = g("BAL", hasta, "1499");
    const g4402 = erRango("4402"), rv = erRango("560410"), rec = erRango("560405");
    if (rec === null && g4402 === null) continue;
    const castigos = p0 !== undefined && p1 !== undefined && g4402 !== null ? Math.max(0, Math.abs(p0) + g4402 - (rv ?? 0) - Math.abs(p1)) : null;
    porAgencia.set(of, { castigos: castigos ?? 0, recuperacion: Math.max(0, rec ?? 0), gasto: Math.max(0, g4402 ?? 0), reversion: Math.max(0, rv ?? 0) });
  }
  const mes = (p: string) => { const [a, b] = p.split("-").map(Number); return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, "0")}`; };
  return porAgencia.size ? { desde: mes(base), hasta, porAgencia } : null;
}

/** Historia de calificación de cada agencia por mes (saldo y provisión por producto y tramo), por clave de oficina. */
export function historiaPorAgencia(db: Db): Promise<Map<string, CorteAgencia[]>> {
  return conCache("hist:calificacion", () => historiaPorAgenciaLeer(db));
}
async function historiaPorAgenciaLeer(db: Db): Promise<Map<string, CorteAgencia[]>> {
  const r = await db.execute(`SELECT periodo, oficina, producto, cat, SUM(saldo) AS saldo, SUM(prov) AS prov FROM provision_calificacion GROUP BY periodo, oficina, producto, cat`);
  const m = new Map<string, Map<string, CorteAgencia>>();
  for (const x of r.rows) {
    const p = String(x.producto) as Producto; const t = tramoDe(p, String(x.cat)); if (!t) continue;
    const of = claveOficina(String(x.oficina)), per = String(x.periodo);
    const porPer = m.get(of) ?? new Map<string, CorteAgencia>(); m.set(of, porPer);
    const c = porPer.get(per) ?? { periodo: per, saldo: vacioTramos(), prov: vacioTramos() }; porPer.set(per, c);
    c.saldo[p][t] = (c.saldo[p][t] ?? 0) + (Number(x.saldo) || 0);
    c.prov![p][t] = (c.prov![p][t] ?? 0) + (Number(x.prov) || 0);
  }
  return new Map([...m.entries()].map(([of, v]) => [of, [...v.values()]]));
}

/** Gasto 4402 y reversión 5604.10 de cada mes por agencia (Históricos; el estado de resultados viene acumulado en el año). */
export function erMesPorAgencia(db: Db): Promise<Map<string, Record<string, { g4402: number; r560410: number }>>> {
  return conCache("hist:erMes", () => erMesPorAgenciaLeer(db));
}
async function erMesPorAgenciaLeer(db: Db): Promise<Map<string, Record<string, { g4402: number; r560410: number }>>> {
  const r = await db.execute(`SELECT oficina, periodo, codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND codigo IN ('4402', '560410')`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const acum = new Map<string, Map<string, { g4402?: number; r560410?: number }>>();
  for (const x of r.rows) {
    const of = claveOficina(String(x.oficina));
    const porPer = acum.get(of) ?? new Map(); acum.set(of, porPer);
    const v = porPer.get(String(x.periodo)) ?? {}; porPer.set(String(x.periodo), v);
    if (String(x.codigo) === "4402") v.g4402 = Number(x.valor) || 0; else v.r560410 = Number(x.valor) || 0;
  }
  const out = new Map<string, Record<string, { g4402: number; r560410: number }>>();
  for (const [of, porPer] of acum) {
    const meses: Record<string, { g4402: number; r560410: number }> = {};
    for (const [per, v] of porPer) {
      if (v.g4402 === undefined) continue;
      const [a, mm] = per.split("-").map(Number);
      if (mm === 1) { meses[per] = { g4402: v.g4402, r560410: v.r560410 ?? 0 }; continue; }
      const ant = porPer.get(`${a}-${String(mm - 1).padStart(2, "0")}`);
      if (!ant || ant.g4402 === undefined) continue;
      meses[per] = { g4402: v.g4402 - ant.g4402, r560410: (v.r560410 ?? 0) - (ant.r560410 ?? 0) };
    }
    out.set(of, meses);
  }
  return out;
}

/** Ritmo de atraso propio de cada agencia (con los parámetros de la cooperativa como respaldo). */
export async function ritmosAgencias(db: Db, parametros: ParametrosFlow, config: ConfigFlow) {
  // mismos meses que la calibración de la cooperativa (Validación → ventana)
  const [a0, m0] = config.ventanaDesde.split("-").map(Number), [a1, m1] = config.ventanaHasta.split("-").map(Number);
  const hasta = config.ventanaHasta, meses = Math.max(1, (a1 - a0) * 12 + (m1 - m0) + 1);
  const [historias, ers] = await Promise.all([historiaPorAgencia(db), erMesPorAgencia(db)]);
  const out = new Map<string, { historia: CorteAgencia[]; erMes: Record<string, { g4402: number; r560410: number }>; castigos: Record<string, number>; calibrado: ReturnType<typeof calibrarRitmoAgencia> }>();
  for (const [of, historia] of historias) {
    const erMes = ers.get(of) ?? {};
    const castigos = castigosImplicitos(historia, erMes);
    out.set(of, { historia, erMes, castigos, calibrado: calibrarRitmoAgencia({ cooperativa: parametros, historia, castigos, factorOptimista: config.factorOptimista, factorPesimista: config.factorPesimista, hasta, meses }) });
  }
  return out;
}

/** Insumos del modelo para una agencia (estado inicial = último corte de calificación cargado). null si no hay datos. */
export async function leerInsumosProvisionFlow(db: Db, agenciaNombre: string, ejercicio: number): Promise<InsumosProvisionFlow | null> {
  const periodo = await ultimoPeriodo(db);
  if (!periodo) return null;
  const [parametros, config, agencias] = await Promise.all([leerParametrosFlow(db), leerConfig(db), corteAgencias(db, periodo)]);
  // reparto de castigos y recuperación entre agencias: con los mismos meses de la ventana (cartera sin alivio)
  const real = await realCastigosRecuperacion(db, config.ventanaDesde).catch(() => null);
  const cons = vacioTramos();
  for (const a of agencias.values()) for (const p of PRODUCTOS) for (const [t, v] of Object.entries(a.saldo[p])) cons[p][t] = (cons[p][t] ?? 0) + v;
  const propia = agencias.get(claveOficina(agenciaNombre));
  if (!propia) return null;
  const parteE = participacionE(propia.saldo, cons);
  // Reparto entre agencias: por lo que cada una castigó y recuperó de verdad en los últimos 12 meses; si no hay
  // históricos (o la cooperativa no registra castigos o recuperación), por su saldo en calificación E como antes.
  const clave = claveOficina(agenciaNombre);
  const conCorte = [...agencias.keys()];
  const tot = (k: "castigos" | "recuperacion") => conCorte.reduce((t, of) => t + (real?.porAgencia.get(of)?.[k] ?? 0), 0);
  const propiaReal = real?.porAgencia.get(clave) ?? null;
  const totCas = tot("castigos"), totRec = tot("recuperacion");
  const usaReal = !!real && !!propiaReal && totCas > 0 && totRec > 0;
  // castigos: según la cartera calificada E de cada agencia (ya provisionada al 100 %): castiga quien tiene E, así ninguna
  // acumula cartera E sin castigar; la recuperación de castigados, según lo que cada una recuperó de verdad
  const parteCas = parteE, parteRec = usaReal ? (propiaReal!.recuperacion / totRec) : parteE;
  const reparto: RepartoAgencia = {
    criterio: usaReal ? "real" : "saldoE", desde: usaReal ? real!.desde : null, hasta: usaReal ? real!.hasta : null, parteE,
    castigos: { parte: parteCas, agencia: propiaReal?.castigos ?? null, cooperativa: real ? totCas : null },
    recuperacion: { parte: parteRec, agencia: propiaReal?.recuperacion ?? null, cooperativa: real ? totRec : null },
  };
  // ritmo de atraso propio de la agencia (sus % de migración); el factor de mora real se mide contra ese ritmo
  const propioR = (await ritmosAgencias(db, parametros, config).catch(() => null))?.get(clave) ?? null;
  // metodología anterior (config.ritmo = "cooperativa"): todas las agencias con el ritmo de la cooperativa
  const parametrosAg = config.ritmo === "cooperativa" ? parametros : propioR?.calibrado?.parametros ?? parametros;
  const factorMoraReal = calibrarFactorMora(parametrosAg, propioR?.historia ?? []);
  // reversión real de la agencia: 5604.10 ÷ 4402 de los últimos 12 meses (la contabilidad registra el gasto bruto y libera
  // provisiones de los créditos que mejoran o se cancelan; el modelo por tramos da el neto)
  // si la de la agencia es atípica (más de 30 % del gasto, p. ej. una reversión puntual grande) se usa la de la cooperativa
  const totRv = [...(real?.porAgencia.values() ?? [])].reduce((t, x) => t + x.reversion, 0), totG = [...(real?.porAgencia.values() ?? [])].reduce((t, x) => t + x.gasto, 0);
  const rCoop = totG > 0 ? totRv / totG : 0;
  const rPropia = propiaReal && propiaReal.gasto > 0 ? propiaReal.reversion / propiaReal.gasto : rCoop;
  const tasaReversion = Math.max(0, Math.min(0.3, rPropia > 0.3 ? rCoop : rPropia));
  // gasto neto real al mes de la agencia en la ventana sin alivio (el modelo se ajusta para reproducirlo)
  const mesesV = Object.entries(propioR?.erMes ?? {}).filter(([p]) => p >= config.ventanaDesde && p <= config.ventanaHasta);
  const gastoRealMes = mesesV.length ? mesesV.reduce((t, [, v]) => t + v.g4402 - v.r560410, 0) / mesesV.length : null;
  return {
    factorMoraReal, tasaReversion, gastoRealMes, ritmo: config.ritmo === "cooperativa" ? null : propioR?.calibrado?.ritmo ?? null,
    parametros: parametrosAg, config, periodoCorte: periodo, inicial: propia.saldo, provisionReporte: propia.prov,
    castigoPorProducto: castigoPorProducto(config.castigoMensual, propia.saldo, cons),
    participacionE: parteRec, reparto, ejercicio,
  };
}
