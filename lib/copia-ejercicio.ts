import { getDbDirecto } from "./turso";
import { EJERCICIO_BASE, TABLAS_AISLADAS_DESPUES, TABLAS_POR_EJERCICIO, tablaDe } from "./ejercicio-pedido";

type Sentencia = { sql: string; args: (string | number)[] };

/**
 * Al crear un ejercicio: sus propias tablas de parámetros (lib/ejercicio-pedido.ts), con la misma
 * estructura, índices y restricciones que las del año de origen. Con origen, se copian sus datos;
 * en blanco, quedan vacías. También copia los parámetros guardados por año (otros_pasivo_parametros).
 * Todo en un solo lote: o queda completo o no queda nada.
 */
export async function crearDatosDelEjercicio(anio: number, origen: number | null): Promise<void> {
  if (anio === EJERCICIO_BASE) return; // el año base usa las tablas de siempre
  const db = getDbDirecto();
  const desde = origen ?? EJERCICIO_BASE;
  // Si el año de origen todavía usaba la tabla compartida de alguna tabla aislada después, primero recibe su copia
  if (origen !== null && origen !== EJERCICIO_BASE) for (const t of TABLAS_AISLADAS_DESPUES) await traerDelAnioBase(t, origen);
  const nombres = TABLAS_POR_EJERCICIO.flatMap((t) => [tablaDe(t, desde), t]);
  const esquema = await db.execute({
    sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN (${nombres.map(() => "?").join(",")})`,
    args: nombres,
  });
  const stmts: Sentencia[] = [];
  for (const t of TABLAS_POR_EJERCICIO) {
    const destino = tablaDe(t, anio);
    // estructura del año de origen; si ese año aún no tenía la tabla, la del año base
    let fuente = tablaDe(t, desde);
    let tabla = esquema.rows.find((r) => r.type === "table" && r.name === fuente);
    if (!tabla) { fuente = t; tabla = esquema.rows.find((r) => r.type === "table" && r.name === t); }
    if (!tabla) continue; // la tabla todavía no se usa: se creará sola cuando haga falta
    const copiarDatos = origen !== null && fuente === tablaDe(t, desde);
    stmts.push({ sql: `DROP TABLE IF EXISTS ${destino}`, args: [] });
    stmts.push({ sql: String(tabla.sql).replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(["`[]?)\w+(["`\]]?)/i, `$1${destino}`), args: [] });
    for (const ix of esquema.rows.filter((r) => r.type === "index" && r.tbl_name === fuente)) {
      stmts.push({
        sql: String(ix.sql).replace(/^(CREATE (?:UNIQUE )?INDEX\s+(?:IF NOT EXISTS\s+)?)(["`[]?)(\w+)(["`\]]?)(\s+ON\s+)(["`[]?)\w+(["`\]]?)/i,
          (_m, a, _q1, nombre, _q2, on) => `${a}${nombre}_${anio}${on}${destino}`),
        args: [],
      });
    }
    if (copiarDatos) stmts.push({ sql: `INSERT INTO ${destino} SELECT * FROM ${fuente}`, args: [] });
  }
  // Parámetros que ya se guardan por año en la misma tabla (tasas, cumplimiento, fondo de liquidez…)
  if (origen !== null) {
    const cols = await db.execute(`PRAGMA table_info(otros_pasivo_parametros)`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const lista = cols.rows.map((c) => String(c.name)).filter((c) => c !== "id");
    if (lista.includes("ejercicio")) {
      const otras = lista.filter((c) => c !== "ejercicio");
      stmts.push({ sql: `DELETE FROM otros_pasivo_parametros WHERE ejercicio = ?`, args: [anio] });
      stmts.push({
        sql: `INSERT INTO otros_pasivo_parametros (${otras.join(", ")}, ejercicio) SELECT ${otras.join(", ")}, ? FROM otros_pasivo_parametros WHERE ejercicio = ?`,
        args: [anio, origen],
      });
    }
  }
  // Parámetros institucionales (salario básico, IESS, fondo de reserva, fondo de liquidez)
  if (origen !== null) {
    const hay = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'parametros_institucionales'`);
    if (hay.rows.length) {
      stmts.push({ sql: `DELETE FROM parametros_institucionales WHERE ejercicio = ?`, args: [anio] });
      stmts.push({
        sql: `INSERT INTO parametros_institucionales (ejercicio, clave, valor, actualizado_en) SELECT ?, clave, valor, datetime('now') FROM parametros_institucionales WHERE ejercicio = ?`,
        args: [anio, origen],
      });
    }
  }
  if (stmts.length) await db.batch(stmts, "write");
}

/** Crea vacía la tabla de un ejercicio que aún no la tiene, con la estructura de la del año base. */
export async function crearTablaFaltante(tabla: string, anio: number): Promise<boolean> {
  if (!TABLAS_POR_EJERCICIO.includes(tabla) || anio === EJERCICIO_BASE) return false;
  const db = getDbDirecto();
  const esquema = await db.execute({ sql: `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name = ?`, args: [tabla] });
  const t = esquema.rows.find((r) => r.type === "table");
  if (!t) return false;
  const destino = tablaDe(tabla, anio);
  const stmts: Sentencia[] = [{ sql: String(t.sql).replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(["`[]?)\w+(["`\]]?)/i, `$1IF NOT EXISTS ${destino}`), args: [] }];
  for (const ix of esquema.rows.filter((r) => r.type === "index")) {
    stmts.push({
      sql: String(ix.sql).replace(/^(CREATE (?:UNIQUE )?INDEX\s+)(?:IF NOT EXISTS\s+)?(["`[]?)(\w+)(["`\]]?)(\s+ON\s+)(["`[]?)\w+(["`\]]?)/i,
        (_m, a, _q1, nombre, _q2, on) => `${a}IF NOT EXISTS ${nombre}_${anio}${on}${destino}`),
      args: [],
    });
  }
  await db.batch(stmts, "write");
  return true;
}

const yaRevisadas = new Set<string>();
/**
 * Tablas aisladas después (lib/ejercicio-pedido.ts): si el ejercicio todavía no tiene la suya, se crea con la
 * estructura y los datos del año base, que es lo que ese ejercicio usaba hasta entonces. Se revisa una vez por
 * tabla y año en cada servidor. No hace nada si el año base tampoco la tiene (se creará vacía al usarse).
 */
export async function traerDelAnioBase(tabla: string, anio: number): Promise<void> {
  if (!TABLAS_AISLADAS_DESPUES.has(tabla) || anio === EJERCICIO_BASE) return;
  const destino = tablaDe(tabla, anio);
  if (yaRevisadas.has(destino)) return;
  const db = getDbDirecto();
  const esquema = await db.execute({ sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN (?, ?)`, args: [tabla, destino] });
  if (esquema.rows.some((r) => r.type === "table" && r.name === destino)) { yaRevisadas.add(destino); return; }
  const t = esquema.rows.find((r) => r.type === "table" && r.name === tabla);
  if (!t) return; // tampoco existe en el año base: la crea vacía el propio módulo
  const stmts: Sentencia[] = [{ sql: String(t.sql).replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(["`[]?)\w+(["`\]]?)/i, `$1IF NOT EXISTS ${destino}`), args: [] }];
  for (const ix of esquema.rows.filter((r) => r.type === "index" && r.tbl_name === tabla)) {
    stmts.push({
      sql: String(ix.sql).replace(/^(CREATE (?:UNIQUE )?INDEX\s+)(?:IF NOT EXISTS\s+)?(["`[]?)(\w+)(["`\]]?)(\s+ON\s+)(["`[]?)\w+(["`\]]?)/i,
        (_m, a, _q1, nombre, _q2, on) => `${a}IF NOT EXISTS ${nombre}_${anio}${on}${destino}`),
      args: [],
    });
  }
  stmts.push({ sql: `INSERT INTO ${destino} SELECT * FROM ${tabla}`, args: [] });
  await db.batch(stmts, "write");
  yaRevisadas.add(destino);
}

/**
 * Columnas agregadas después (ALTER TABLE ... ADD COLUMN) quedan solo en la tabla del año en que se usó primero.
 * Esto pone en todas las versiones de la tabla (año base y cada ejercicio) las columnas que tenga cualquiera de
 * ellas, sin tocar datos. Devuelve true si agregó alguna.
 */
export async function igualarColumnas(tabla: string): Promise<boolean> {
  if (!TABLAS_POR_EJERCICIO.includes(tabla)) return false;
  const db = getDbDirecto();
  const nombres = (await db.execute({ sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND (name = ? OR name GLOB ?)`, args: [tabla, `${tabla}_[0-9][0-9][0-9][0-9]`] }))
    .rows.map((r) => String(r.name));
  type Col = { name: string; type: string; dflt: unknown };
  const cols = new Map<string, Col[]>();
  for (const n of nombres) cols.set(n, (await db.execute(`PRAGMA table_info(${n})`)).rows.map((c) => ({ name: String(c.name), type: String(c.type ?? ""), dflt: c.dflt_value })));
  const todas = new Map<string, Col>();
  for (const lista of cols.values()) for (const c of lista) if (!todas.has(c.name)) todas.set(c.name, c);
  const stmts: Sentencia[] = [];
  for (const [n, lista] of cols) {
    const tiene = new Set(lista.map((c) => c.name));
    for (const c of todas.values()) {
      if (tiene.has(c.name) || !/^\w+$/.test(c.name)) continue;
      const def = c.dflt === null || c.dflt === undefined ? "" : ` DEFAULT ${String(c.dflt)}`;
      stmts.push({ sql: `ALTER TABLE ${n} ADD COLUMN ${c.name} ${/^[\w() ,]*$/.test(c.type) ? c.type : ""}${def}`, args: [] });
    }
  }
  if (!stmts.length) return false;
  await db.batch(stmts, "write");
  return true;
}
