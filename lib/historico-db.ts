import { getDb } from "./turso";
import type { ArchivoHistorico, TipoHistorico } from "./historico-parser";
import { indicadoresMes } from "./calc/diagnostico";
import { basePlanificacion } from "./calc/planificacion";

type Db = ReturnType<typeof getDb>;

/**
 * Balances y estados de resultados históricos por oficina y mes (cuentas de hasta 6 dígitos más las de
 * interés interno). Alimentan Planificación (Diagnóstico y Comparar agencias). El ER se guarda tal como
 * viene: acumulado del año.
 */
let lista: Promise<void> | null = null;
export function asegurarTablaHistorico(db: Db): Promise<void> {
  if (!lista) {
    lista = (async () => {
      await db.batch([
        `CREATE TABLE IF NOT EXISTS historico_cuentas (
          oficina TEXT NOT NULL, periodo TEXT NOT NULL, tipo TEXT NOT NULL, codigo TEXT NOT NULL, valor REAL NOT NULL,
          PRIMARY KEY (oficina, periodo, tipo, codigo)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_hist_periodo ON historico_cuentas (periodo)`,
        `CREATE INDEX IF NOT EXISTS idx_hist_tipo_codigo ON historico_cuentas (tipo, codigo, periodo, oficina, valor)`,
        `CREATE INDEX IF NOT EXISTS idx_hist_tipo_periodo ON historico_cuentas (tipo, periodo, oficina)`,
        // Resumen por oficina y mes (qué hay cargado + indicadores ya calculados): Planificación lee solo esto
        `CREATE TABLE IF NOT EXISTS historico_resumen (
          oficina TEXT NOT NULL, periodo TEXT NOT NULL, bal INTEGER NOT NULL, er INTEGER NOT NULL, indicadores TEXT,
          PRIMARY KEY (oficina, periodo)
        )`,
        // Punto de partida de Planificación por oficina (último corte con balance y resultados)
        `CREATE TABLE IF NOT EXISTS planificacion_base (oficina TEXT PRIMARY KEY, periodo TEXT NOT NULL, datos TEXT NOT NULL)`,
        // Oficinas con cuentas nuevas cuyo resumen falta calcular (se resuelve en la siguiente lectura)
        `CREATE TABLE IF NOT EXISTS historico_pendiente (oficina TEXT PRIMARY KEY)`,
      ]);
      // meses con cuentas contingentes y de orden (columna agregada después)
      await db.execute(`ALTER TABLE historico_resumen ADD COLUMN co INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
    })().catch((e) => { lista = null; throw e; });
  }
  return lista;
}

/** Guarda archivos: cada (oficina, período, tipo) se reemplaza completo. */
export async function guardarHistorico(db: Db, archivos: ArchivoHistorico[]): Promise<number> {
  await asegurarTablaHistorico(db);
  type Sentencia = { sql: string; args: (string | number)[] };
  // Cada (oficina, período, tipo) va con su DELETE y sus INSERT en el mismo lote: si algo falla, ese mes queda como estaba.
  const unidades: Sentencia[][] = [];
  let filas = 0;
  for (const a of archivos) {
    const u: Sentencia[] = [{ sql: `DELETE FROM historico_cuentas WHERE oficina = ? AND periodo = ? AND tipo = ?`, args: [a.oficina, a.periodo, a.tipo] }];
    const cods = Object.entries(a.cuentas).filter(([, v]) => Number.isFinite(v));
    for (let i = 0; i < cods.length; i += 100) {
      const parte = cods.slice(i, i + 100);
      u.push({
        sql: `INSERT INTO historico_cuentas (oficina, periodo, tipo, codigo, valor) VALUES ${parte.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
        args: parte.flatMap(([c, v]) => [a.oficina, a.periodo, a.tipo, c, v]),
      });
      filas += parte.length;
    }
    unidades.push(u);
  }
  unidades.push([...new Set(archivos.map((a) => a.oficina))].map((o) => ({ sql: `INSERT OR IGNORE INTO historico_pendiente (oficina) VALUES (?)`, args: [o] })));
  // Se agrupan unidades completas en lotes de hasta ~200 sentencias (nunca se parte una unidad).
  let lote: Sentencia[] = [];
  for (const u of unidades) {
    if (lote.length && lote.length + u.length > 200) { await db.batch(lote, "write"); lote = []; }
    lote.push(...u);
  }
  if (lote.length) await db.batch(lote, "write");
  return filas;
}

interface InventarioHistorico { oficina: string; periodo: string; tipo: TipoHistorico; cuentas: number }
/** Qué oficina/mes/tipo hay cargado (desde el resumen: pocas filas). */
export async function leerInventario(db: Db): Promise<InventarioHistorico[]> {
  await resolverPendientes(db);
  await asegurarTablaHistorico(db);
  const r = await db.execute(`SELECT oficina, periodo, bal, er, co FROM historico_resumen ORDER BY periodo, oficina`);
  const out: InventarioHistorico[] = [];
  for (const x of r.rows) {
    if (Number(x.bal)) out.push({ oficina: String(x.oficina), periodo: String(x.periodo), tipo: "BAL", cuentas: Number(x.bal) });
    if (Number(x.er)) out.push({ oficina: String(x.oficina), periodo: String(x.periodo), tipo: "ER", cuentas: Number(x.er) });
    if (Number(x.co)) out.push({ oficina: String(x.oficina), periodo: String(x.periodo), tipo: "CO", cuentas: Number(x.co) });
  }
  return out;
}

/** Cuentas de las oficinas indicadas: mapa "oficina|periodo|tipo" → { codigo: valor }. */
async function leerCuentas(db: Db, oficinas: string[]): Promise<Map<string, Record<string, number>>> {
  const m = new Map<string, Record<string, number>>();
  for (const o of oficinas) {
    const r = await db.execute({ sql: `SELECT periodo, tipo, codigo, valor FROM historico_cuentas WHERE oficina = ?`, args: [o] });
    for (const x of r.rows) {
      const k = `${o}|${x.periodo}|${x.tipo}`;
      const c = m.get(k) ?? {}; c[String(x.codigo)] = Number(x.valor); m.set(k, c);
    }
  }
  return m;
}

/**
 * Recalcula el resumen (indicadores por mes) de las oficinas indicadas, o de todas las que tengan cuentas.
 * Se llama una vez al terminar de guardar, no por cada lote.
 */
export async function recalcularResumen(db: Db, oficinas?: string[], limiteMs = 40000): Promise<{ meses: number; faltan: string[] }> {
  const inicio = Date.now();
  await asegurarTablaHistorico(db);
  const lista = oficinas?.length ? oficinas
    : (await db.execute(`SELECT DISTINCT oficina FROM historico_cuentas`)).rows.map((x) => String(x.oficina));
  let n = 0;
  for (const [idx, o] of lista.entries()) {
    // Tope de tiempo por llamada (Vercel corta a los 60 s): lo que falte queda pendiente para la siguiente
    if (Date.now() - inicio > limiteMs) {
      const faltan = lista.slice(idx);
      await db.batch(faltan.map((x) => ({ sql: `INSERT OR IGNORE INTO historico_pendiente (oficina) VALUES (?)`, args: [x] })));
      return { meses: n, faltan };
    }
    const datos = await leerCuentas(db, [o]);
    const meses = new Map<string, { bal: number; er: number; co: number }>();
    for (const [k, c] of datos) {
      const [, p, t] = k.split("|");
      const a = meses.get(p) ?? { bal: 0, er: 0, co: 0 };
      if (t === "BAL") a.bal = Object.keys(c).length; else if (t === "ER") a.er = Object.keys(c).length; else if (t === "CO") a.co = Object.keys(c).length;
      meses.set(p, a);
    }
    const stmts: { sql: string; args: (string | number | null)[] }[] = [{ sql: `DELETE FROM historico_resumen WHERE oficina = ?`, args: [o] }];
    for (const [p, a] of meses) {
      const ind = indicadoresMes(datos, o, p);
      stmts.push({ sql: `INSERT INTO historico_resumen (oficina, periodo, bal, er, co, indicadores) VALUES (?, ?, ?, ?, ?, ?)`, args: [o, p, a.bal, a.er, a.co, ind ? JSON.stringify(ind) : null] });
    }
    const ultimo = [...meses.entries()].filter(([, x]) => x.bal && x.er).map(([p]) => p).sort().pop();
    const base = ultimo ? basePlanificacion(datos, o, ultimo) : null;
    stmts.push(base
      ? { sql: `INSERT OR REPLACE INTO planificacion_base (oficina, periodo, datos) VALUES (?, ?, ?)`, args: [o, ultimo!, JSON.stringify(base)] }
      : { sql: `DELETE FROM planificacion_base WHERE oficina = ?`, args: [o] });
    stmts.push({ sql: `DELETE FROM historico_pendiente WHERE oficina = ?`, args: [o] });
    await db.batch(stmts);
    n += meses.size;
  }
  return { meses: n, faltan: [] };
}

/** Recalcula solo el punto de partida de Planificación (cuando cambia lo que guarda la base). */
export async function recalcularBases(db: Db, oficinas: string[], limiteMs = 40000): Promise<string[]> {
  const inicio = Date.now();
  for (const [idx, o] of oficinas.entries()) {
    if (Date.now() - inicio > limiteMs) return oficinas.slice(idx);
    const datos = await leerCuentas(db, [o]);
    const per = new Map<string, Set<string>>();
    for (const k of datos.keys()) { const [, p, t] = k.split("|"); (per.get(p) ?? per.set(p, new Set()).get(p)!).add(t); }
    const ultimo = [...per.entries()].filter(([, t]) => t.has("BAL") && t.has("ER")).map(([p]) => p).sort().pop();
    const base = ultimo ? basePlanificacion(datos, o, ultimo) : null;
    if (base) await db.execute({ sql: `INSERT OR REPLACE INTO planificacion_base (oficina, periodo, datos) VALUES (?, ?, ?)`, args: [o, ultimo!, JSON.stringify(base)] });
  }
  return [];
}

/** Indicadores ya calculados: "oficina" → { periodo → indicadores }. */
export async function leerResumen(db: Db): Promise<Record<string, Record<string, unknown>>> {
  await resolverPendientes(db);
  const r = await db.execute(`SELECT oficina, periodo, indicadores FROM historico_resumen WHERE indicadores IS NOT NULL`);
  const out: Record<string, Record<string, unknown>> = {};
  for (const x of r.rows) (out[String(x.oficina)] ??= {})[String(x.periodo)] = JSON.parse(String(x.indicadores));
  return out;
}

/**
 * Si hay oficinas con cuentas guardadas y sin resumen calculado (por ejemplo, la carga se cortó antes del cálculo
 * final), lo calcula ahora. También cubre el caso de cuentas guardadas antes de que existiera el resumen.
 */
export async function resolverPendientes(db: Db): Promise<void> {
  await asegurarTablaHistorico(db);
  const pend = (await db.execute(`SELECT oficina FROM historico_pendiente`)).rows.map((x) => String(x.oficina));
  if (pend.length) { await recalcularResumen(db, pend, 30000); return; }
  const hayResumen = (await db.execute(`SELECT 1 FROM historico_resumen LIMIT 1`)).rows.length > 0;
  if (!hayResumen && (await db.execute(`SELECT 1 FROM historico_cuentas LIMIT 1`)).rows.length > 0) await recalcularResumen(db, undefined, 30000);
}
