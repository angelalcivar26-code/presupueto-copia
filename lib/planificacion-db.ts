import { getDb } from "./turso";
import { asegurarTablaHistorico, recalcularResumen, recalcularBases, resolverPendientes } from "./historico-db";
import { REFERENCIAS_INICIALES, PLAZOS_INICIALES, TOPES_INICIALES, VERSION_BASE, type BasePlan, type Referencias, type TopesPlan, type ProductoPlan, type Palancas } from "./calc/planificacion";

type Db = ReturnType<typeof getDb>;

/**
 * Datos de Planificación: punto de partida por oficina (calculado con los históricos), referencias y supuestos
 * institucionales, asesores por agencia (Oficiales de crédito) y escenarios guardados del simulador.
 */
let lista: Promise<void> | null = null;
async function asegurar(db: Db) {
  await asegurarTablaHistorico(db);
  if (!lista) {
    lista = (async () => {
      await db.batch([
        `CREATE TABLE IF NOT EXISTS planificacion_config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS planificacion_escenarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT, agencia TEXT NOT NULL, nombre TEXT NOT NULL, palancas TEXT NOT NULL,
          meta REAL, creado TEXT NOT NULL DEFAULT (datetime('now')), autor TEXT
        )`,
      ]);
      // estado del escenario: Borrador, Aprobado o Reemplazado
      await db.execute(`ALTER TABLE planificacion_escenarios ADD COLUMN estado TEXT NOT NULL DEFAULT 'Borrador'`).catch(() => undefined);
    })().catch((e) => { lista = null; throw e; });
  }
  return lista;
}

interface ConfigPlan {
  referencias: Referencias; plazos: Record<ProductoPlan, number>; topes: TopesPlan; costoAsesor: number;
  metaInst: number; cumplMeta: number | null;
  ajustes: Record<string, Record<string, Record<string, number>>>; // agencia → escenario → palanca → valor
  incSal: number; infl: number;
}
export async function leerConfigPlan(db: Db): Promise<ConfigPlan> {
  await asegurar(db);
  const r = await db.execute(`SELECT clave, valor FROM planificacion_config`);
  const m = new Map(r.rows.map((x) => [String(x.clave), JSON.parse(String(x.valor))]));
  return {
    referencias: { ...REFERENCIAS_INICIALES, ...(m.get("referencias") ?? {}) },
    plazos: { ...PLAZOS_INICIALES, ...(m.get("plazos") ?? {}) },
    topes: { ...TOPES_INICIALES, ...(m.get("topes") ?? {}) },
    costoAsesor: Number(m.get("costoAsesor") ?? 16000),
    metaInst: Number(m.get("metaInst") ?? 0.01), cumplMeta: m.has("cumplMeta") ? (m.get("cumplMeta") === null ? null : Number(m.get("cumplMeta"))) : 1,
    ajustes: m.get("ajustes") ?? {},
    incSal: Number(m.get("incSal") ?? 0.03), infl: Number(m.get("infl") ?? 0.03),
  };
}
export async function guardarConfigPlan(db: Db, c: Partial<ConfigPlan>) {
  await asegurar(db);
  await db.batch(Object.entries(c).map(([k, val]) => ({ sql: `INSERT OR REPLACE INTO planificacion_config (clave, valor) VALUES (?, ?)`, args: [k, JSON.stringify(val)] })));
}

/** Punto de partida de cada oficina. Si hay históricos sin base calculada, la calcula una vez. */
export async function leerBases(db: Db): Promise<Record<string, BasePlan>> {
  await asegurar(db);
  await resolverPendientes(db);
  let r = await db.execute(`SELECT oficina, datos FROM planificacion_base`);
  if (!r.rows.length && (await db.execute(`SELECT 1 FROM historico_resumen LIMIT 1`)).rows.length) {
    await recalcularResumen(db, undefined, 40000);
    r = await db.execute(`SELECT oficina, datos FROM planificacion_base`);
  }
  const bases: Record<string, BasePlan> = Object.fromEntries(r.rows.map((x) => [String(x.oficina), JSON.parse(String(x.datos))]));
  // Bases calculadas con una versión anterior: se rehacen una vez (solo el punto de partida)
  const viejas = Object.entries(bases).filter(([, b]) => (b.version ?? 1) < VERSION_BASE).map(([o]) => o);
  if (viejas.length) {
    await recalcularBases(db, viejas, 45000);
    r = await db.execute(`SELECT oficina, datos FROM planificacion_base`);
    return Object.fromEntries(r.rows.map((x) => [String(x.oficina), JSON.parse(String(x.datos))]));
  }
  return bases;
}

/** Trayectoria mensual por oficina (desde el resumen ya calculado). */
export async function leerTrayectoria(db: Db): Promise<Record<string, { p: string; cartera: number; mora: number; capt: number; utAcum: number }[]>> {
  const r = await db.execute(`SELECT oficina, periodo, indicadores FROM historico_resumen WHERE indicadores IS NOT NULL ORDER BY periodo`);
  const out: Record<string, { p: string; cartera: number; mora: number; capt: number; utAcum: number }[]> = {};
  for (const x of r.rows) {
    const i = JSON.parse(String(x.indicadores));
    (out[String(x.oficina)] ??= []).push({ p: String(x.periodo), cartera: i.cartera, mora: i.morosidad, capt: i.captaciones, utAcum: i.utilidad });
  }
  return out;
}

/** Asesores activos por agencia (Oficiales de crédito) y plazo promedio por línea según el % de recuperación del presupuesto. */
export async function leerAsesoresYPlazos(db: Db): Promise<{ asesores: Record<string, number>; plazos: Record<string, Partial<Record<ProductoPlan, number>>> }> {
  const asesores: Record<string, number> = {}; const plazos: Record<string, Partial<Record<ProductoPlan, number>>> = {};
  try {
    const r = await db.execute(`SELECT a.nombre AS agencia, COUNT(*) AS n FROM oficiales_credito o JOIN agencias a ON a.id = o.agencia_id WHERE COALESCE(o.activo, 1) = 1 GROUP BY a.nombre`);
    for (const x of r.rows) asesores[String(x.agencia)] = Number(x.n);
  } catch { /* sin tabla de oficiales */ }
  try {
    const r = await db.execute(`SELECT a.nombre AS agencia, p.linea, AVG(p.pct_recuperacion_periodo) AS pct FROM parametros_credito p JOIN agencias a ON a.id = p.agencia_id GROUP BY a.nombre, p.linea`);
    const NOM: Record<string, ProductoPlan> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
    for (const x of r.rows) {
      let pct = Number(x.pct); if (!(pct > 0)) continue; if (pct > 1) pct /= 100;
      const meses = Math.round(1 / pct);
      if (meses >= 6 && meses <= 240) (plazos[String(x.agencia)] ??= {})[NOM[String(x.linea)]] = meses;
    }
  } catch { /* sin parámetros de crédito */ }
  return { asesores, plazos };
}

/** Asesores activos por rango, metas institucionales y parámetros del presupuesto por agencia (promedio del año). */
interface ParamAgencia {
  mix: [number, number, number];                        // Junior, Senior, Master
  credito: Partial<Record<ProductoPlan, { tasa: number; pctRec: number; efect: number; recVenc: number; dist: number | null }>>;
  vistaNeto: number | null;                             // % mensual (ingresos − retiros) del ahorro a la vista
}
export async function leerParametrosPlan(db: Db): Promise<{ porAgencia: Record<string, ParamAgencia>; metas: [number, number, number] }> {
  const porAgencia: Record<string, ParamAgencia> = {};
  const de = (a: string) => (porAgencia[a] ??= { mix: [0, 0, 0], credito: {}, vistaNeto: null });
  let metas: [number, number, number] = [110000, 125000, 135000];
  const NOM: Record<string, ProductoPlan> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
  const pct = (x: unknown) => { const n = Number(x); return n > 1 ? n / 100 : n; };
  try {
    const r = await db.execute(`SELECT a.nombre AS agencia, o.rango, COUNT(*) AS n FROM oficiales_credito o JOIN agencias a ON a.id = o.agencia_id WHERE COALESCE(o.activo, 1) = 1 GROUP BY a.nombre, o.rango`);
    for (const x of r.rows) { const i = ["JUNIOR", "SENIOR", "MASTER"].indexOf(String(x.rango)); if (i >= 0) de(String(x.agencia)).mix[i] = Number(x.n); }
  } catch { /* sin oficiales */ }
  try {
    const r = await db.execute(`SELECT meta_junior, meta_senior, meta_master FROM metas_credito_institucional WHERE id = 1`);
    if (r.rows[0]) metas = [Number(r.rows[0].meta_junior), Number(r.rows[0].meta_senior), Number(r.rows[0].meta_master)];
  } catch { /* sin metas */ }
  try {
    const r = await db.execute(`SELECT a.nombre AS agencia, p.linea, AVG(p.tasa_interes_anual) AS tasa, AVG(p.pct_recuperacion_periodo) AS rec, AVG(p.tasa_efectividad_recup) AS ef,
      AVG(p.tasa_recuperacion_vencida) AS rv, AVG(p.pct_distribucion) AS dist FROM parametros_credito p JOIN agencias a ON a.id = p.agencia_id GROUP BY a.nombre, p.linea`);
    for (const x of r.rows) {
      const n = NOM[String(x.linea)]; if (!n) continue;
      de(String(x.agencia)).credito[n] = { tasa: pct(x.tasa), pctRec: pct(x.rec), efect: pct(x.ef), recVenc: pct(x.rv), dist: x.dist === null ? null : pct(x.dist) };
    }
  } catch { /* sin parámetros de crédito (o sin pct_distribucion) */ }
  try {
    const r = await db.execute(`SELECT a.nombre AS agencia, AVG(COALESCE(p.pct_ingresos, 0) - COALESCE(p.pct_retiros, 0)) AS neto FROM parametros_captaciones p JOIN agencias a ON a.id = p.agencia_id WHERE p.producto = 'VISTA' GROUP BY a.nombre`);
    for (const x of r.rows) de(String(x.agencia)).vistaNeto = Number(x.neto);
  } catch { /* sin parámetros de captaciones */ }
  return { porAgencia, metas };
}

type EstadoEscenario = "Borrador" | "Aprobado" | "Reemplazado";
interface Escenario { id: number; agencia: string; nombre: string; palancas: Palancas | Record<string, unknown>; meta: number | null; creado: string; autor: string | null; estado: EstadoEscenario }
export async function leerEscenarios(db: Db): Promise<Escenario[]> {
  await asegurar(db);
  const r = await db.execute(`SELECT id, agencia, nombre, palancas, meta, creado, autor, estado FROM planificacion_escenarios ORDER BY creado`);
  return r.rows.map((x) => ({ id: Number(x.id), agencia: String(x.agencia), nombre: String(x.nombre), palancas: JSON.parse(String(x.palancas)), meta: x.meta === null ? null : Number(x.meta), creado: String(x.creado), autor: x.autor ? String(x.autor) : null, estado: (String(x.estado ?? "Borrador") as EstadoEscenario) }));
}
/** Guarda un escenario; si queda Aprobado, el aprobado anterior de esa agencia pasa a Reemplazado (no se borra). */
export async function guardarEscenario(db: Db, e: { id?: number; agencia: string; nombre: string; palancas: Palancas | Record<string, unknown>; meta: number | null; autor?: string | null; estado?: EstadoEscenario }) {
  await asegurar(db);
  const estado = e.estado ?? "Borrador";
  const previo = estado === "Aprobado" ? [{ sql: `UPDATE planificacion_escenarios SET estado = 'Reemplazado' WHERE agencia = ? AND estado = 'Aprobado'`, args: [e.agencia] }] : [];
  const fila = e.id
    ? { sql: `UPDATE planificacion_escenarios SET nombre = ?, palancas = ?, meta = ?, estado = ? WHERE id = ?`, args: [e.nombre, JSON.stringify(e.palancas), e.meta, estado, e.id] }
    : { sql: `INSERT INTO planificacion_escenarios (agencia, nombre, palancas, meta, autor, estado) VALUES (?, ?, ?, ?, ?, ?)`, args: [e.agencia, e.nombre, JSON.stringify(e.palancas), e.meta, e.autor ?? null, estado] };
  await db.batch([...previo, fila]);
}
export async function aprobarEscenario(db: Db, id: number) {
  await asegurar(db);
  const r = await db.execute({ sql: `SELECT agencia FROM planificacion_escenarios WHERE id = ?`, args: [id] });
  if (!r.rows[0]) return;
  await db.batch([
    { sql: `UPDATE planificacion_escenarios SET estado = 'Reemplazado' WHERE agencia = ? AND estado = 'Aprobado'`, args: [String(r.rows[0].agencia)] },
    { sql: `UPDATE planificacion_escenarios SET estado = 'Aprobado' WHERE id = ?`, args: [id] },
  ]);
}
export async function borrarEscenario(db: Db, id: number) {
  await asegurar(db);
  await db.execute({ sql: `DELETE FROM planificacion_escenarios WHERE id = ?`, args: [id] });
}
