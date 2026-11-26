import { createClient, type Client, type InStatement, type ResultSet } from "@libsql/client";
import { EJERCICIO_BASE, ejercicioDelPedido, sqlDelEjercicio, tablasAisladasDespuesEn, tablasPorEjercicioEn } from "./ejercicio-pedido";

let base: Client | null = null;
let envuelto: Client | null = null;

/**
 * Cliente unico de Turso para todo el proyecto (scripts, API routes, motor de
 * calculo). No crear clientes sueltos en cada archivo: eso fue parte del
 * problema de la herramienta anterior (logica repetida que se desincroniza).
 *
 * VELOCIDAD SIN DATOS VIEJOS (sep-2026)
 * Las lecturas (SELECT) se recuerdan mientras no cambie ningun dato: la misma consulta no
 * vuelve a la base. Asi toda la herramienta lee mucho menos de Turso sin tocar cada ruta.
 * El cliente que devuelve getDb() vigila las escrituras: cada INSERT, UPDATE,
 * DELETE o REPLACE que cambie al menos una fila sube el numero de la tabla
 * datos_version. La memoria temporal del motor (lib/cache-motor.ts) guarda
 * cada resultado junto con ese numero y solo lo reutiliza mientras no haya
 * cambiado; asi, apenas alguien guarda o carga algo, todo se recalcula con el
 * dato nuevo. Funciona aunque haya varios servidores o varios usuarios, porque
 * el numero vive en la base.
 */
function clienteBase(): Client {
  if (base) return base;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "Falta TURSO_DATABASE_URL. Copia .env.example a .env y completa las credenciales de tu base en turso.tech."
    );
  }

  base = createClient({ url, authToken });
  return base;
}

/**
 * Cliente sin memoria temporal ni control de versiones. Solo para datos que no son del
 * presupuesto (p. ej. usuarios): así un cambio de contraseña no obliga a recalcular todo.
 */
export function getDbDirecto(): Client {
  return clienteBase();
}

// ---------------------------------------------------------------------
// Numero de version de los datos
// ---------------------------------------------------------------------

let tablaLista: Promise<void> | null = null;
function asegurarTabla(c: Client): Promise<void> {
  if (!tablaLista) {
    tablaLista = c
      .execute("CREATE TABLE IF NOT EXISTS datos_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)")
      .then(() => { asegurarIndices(c); })
      .catch((e) => { tablaLista = null; throw e; });
  }
  return tablaLista;
}

// ---------------------------------------------------------------------
// Índices (oct-2026): Turso cobra por filas REVISADAS. Sin índice, cada consulta
// "WHERE agencia_id = ?" revisa la tabla completa. Con estos índices revisa solo las filas
// de la agencia / ejercicio / concepto pedidos. Solo agregan índices: no cambian ni borran datos.
// Se crean una vez por servidor ("IF NOT EXISTS"); si una tabla aún no existe, se omite.
// ---------------------------------------------------------------------
const INDICES = [
  "CREATE INDEX IF NOT EXISTS idx_pd_agencia_ejercicio ON presupuesto_departamental (agencia_id, ejercicio)",
  "CREATE INDEX IF NOT EXISTS idx_pd_depto_concepto ON presupuesto_departamental (departamento, concepto, ejercicio)",
  "CREATE INDEX IF NOT EXISTS idx_pd_concepto ON presupuesto_departamental (concepto, ejercicio)",
  "CREATE INDEX IF NOT EXISTS idx_pd_resumen ON presupuesto_departamental (resumen_id)",
  "CREATE INDEX IF NOT EXISTS idx_pr_depto ON presupuesto_resumen (departamento, ejercicio, nombre)",
  "CREATE INDEX IF NOT EXISTS idx_nomina_agencia ON nomina_empleados (agencia_id, activo)",
  "CREATE INDEX IF NOT EXISTS idx_oficiales_agencia ON oficiales_credito (agencia_id)",
  "CREATE INDEX IF NOT EXISTS idx_inversiones_agencia ON inversiones (agencia_id)",
  "CREATE INDEX IF NOT EXISTS idx_saldos_periodo ON saldos_iniciales (agencia_id, anio, mes)",
  "CREATE INDEX IF NOT EXISTS idx_hojas_grupo ON hojas_presupuesto (grupo, ejercicio)",
  "CREATE INDEX IF NOT EXISTS idx_base_hist ON base_historica_gastos (agencia_id)",
  // Históricos: las lecturas de una cuenta para todas las oficinas (4402, 5104…) y el último mes por tipo leen solo
  // esas filas del índice, no la tabla completa (crearlos lee la tabla una sola vez)
  "CREATE INDEX IF NOT EXISTS idx_hist_tipo_codigo ON historico_cuentas (tipo, codigo, periodo, oficina, valor)",
  "CREATE INDEX IF NOT EXISTS idx_hist_tipo_periodo ON historico_cuentas (tipo, periodo, oficina)",
];
let indicesListos = false;
function asegurarIndices(c: Client) {
  if (indicesListos) return;
  indicesListos = true;
  (async () => {
    for (const sql of INDICES) {
      try { await c.execute(sql); } catch { /* la tabla o la columna no existe todavía: se omite */ }
    }
  })().catch(() => undefined);
}

/** Numero actual de version de los datos (0 si nunca se ha escrito nada). */
export async function versionDatos(): Promise<number> {
  const c = clienteBase();
  await asegurarTabla(c);
  const r = await c.execute("SELECT version FROM datos_version WHERE id = 1");
  return r.rows.length ? Number(r.rows[0].version) || 0 : 0;
}

/** Marca que los datos cambiaron: todo lo guardado en la memoria temporal deja de usarse. */
export async function marcarCambio(): Promise<void> {
  const c = clienteBase();
  await asegurarTabla(c);
  await c.execute("INSERT INTO datos_version (id, version) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET version = version + 1");
  lecturas.clear();
  ultimaVersion = null;
  // Bitácora: el guardado de un usuario cambió datos → una fila (una sola vez por pedido).
  await (await import("./bitacora")).anotarGuardado();
}

// Numero de version reciente: se vuelve a preguntar a la base como maximo cada 1,5 segundos.
// Las escrituras hechas en este servidor lo invalidan al instante (marcarCambio); las hechas
// desde otro servidor se notan en menos de 1,5 s.
const VIGENCIA_VERSION_MS = 1500;
let ultimaVersion: { v: number; t: number } | null = null;
let versionEnCurso: Promise<number> | null = null;
export async function versionReciente(): Promise<number> {
  if (ultimaVersion && Date.now() - ultimaVersion.t < VIGENCIA_VERSION_MS) return ultimaVersion.v;
  if (!versionEnCurso) {
    versionEnCurso = versionDatos()
      .then((v) => {
        if (ultimaVersion && ultimaVersion.v !== v) lecturas.clear();
        ultimaVersion = { v, t: Date.now() };
        return v;
      })
      .finally(() => { versionEnCurso = null; });
  }
  return versionEnCurso;
}

// Lecturas recordadas (SELECT) de la version actual: la misma consulta con los mismos
// argumentos no vuelve a ir a la base mientras no cambie ningun dato.
const MAX_LECTURAS = 3000;
const lecturas = new Map<string, Promise<ResultSet>>();

// ---------------------------------------------------------------------
// Cliente que vigila las escrituras
// ---------------------------------------------------------------------

const ESCRITURA = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const LECTURA = /^\s*(SELECT|WITH)\b/i;

function argsDe(st: unknown, resto: unknown[]): unknown {
  if (st && typeof st === "object" && !Array.isArray(st) && "args" in st) return (st as { args: unknown }).args;
  if (Array.isArray(st)) return st[1];
  return resto[0];
}

function sqlDe(st: unknown): string {
  if (typeof st === "string") return st;
  if (Array.isArray(st)) return String(st[0] ?? "");
  if (st && typeof st === "object" && "sql" in st) return String((st as { sql: unknown }).sql ?? "");
  return "";
}

/**
 * Si una tabla del ejercicio todavía no existe (p. ej. una que el año base empezó a usar después de
 * crear el ejercicio), se crea vacía con la estructura del año base y se reintenta una vez.
 */
async function conTablaDelEjercicio<T>(hacer: () => Promise<T>, sqls: () => string[] = () => []): Promise<T> {
  try {
    return await hacer();
  } catch (e) {
    const msj = e instanceof Error ? e.message : String(e);
    const m = /no such table: (?:main\.)?(\w+)_(\d{4})\b/.exec(msj);
    if (m) {
      const { crearTablaFaltante } = await import("./copia-ejercicio");
      if (!(await crearTablaFaltante(m[1], Number(m[2])))) throw e;
      return hacer();
    }
    // Una columna agregada después (ALTER TABLE) que falta en la tabla de algún año: se igualan las columnas y se reintenta
    if (/no such column|has no column named/i.test(msj)) {
      const tablas = new Set(sqls().flatMap((q) => tablasPorEjercicioEn(q)));
      if (tablas.size) {
        const { igualarColumnas } = await import("./copia-ejercicio");
        let cambio = false;
        for (const t of tablas) cambio = (await igualarColumnas(t)) || cambio;
        if (cambio) return hacer();
      }
    }
    throw e;
  }
}

/** Antes de usar una tabla aislada después en otro ejercicio, ese ejercicio recibe su copia (lib/copia-ejercicio.ts). */
async function prepararTablasAisladas(sts: unknown[], ejercicio: number | null): Promise<void> {
  if (!ejercicio || ejercicio === EJERCICIO_BASE) return;
  const tablas = new Set(sts.flatMap((st) => tablasAisladasDespuesEn(sqlDe(st))));
  if (!tablas.size) return;
  const { traerDelAnioBase } = await import("./copia-ejercicio");
  for (const t of tablas) await traerDelAnioBase(t, ejercicio);
}

/** La sentencia con las tablas del ejercicio del pedido (ver lib/ejercicio-pedido.ts). */
function conEjercicio(st: unknown, ejercicio: number | null): unknown {
  if (!ejercicio) return st;
  if (typeof st === "string") return sqlDelEjercicio(st, ejercicio);
  if (Array.isArray(st)) return [sqlDelEjercicio(String(st[0] ?? ""), ejercicio), ...st.slice(1)];
  if (st && typeof st === "object" && "sql" in st) return { ...(st as object), sql: sqlDelEjercicio(String((st as { sql: unknown }).sql ?? ""), ejercicio) };
  return st;
}

export function getDb(): Client {
  if (envuelto) return envuelto;
  const c = clienteBase();

  envuelto = new Proxy(c, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return async (...args: unknown[]) => {
          const ejPedido = await ejercicioDelPedido();
          await prepararTablasAisladas([args[0]], ejPedido);
          args[0] = conEjercicio(args[0], ejPedido);
          const sql = sqlDe(args[0]);
          if (LECTURA.test(sql) && !/datos_version/i.test(sql)) {
            let version: number | null = null;
            try { version = await versionReciente(); } catch { version = null; }
            if (version !== null) {
              const clave = `${version}|${sql}|${JSON.stringify(argsDe(args[0], args.slice(1)) ?? null)}`;
              const guardada = lecturas.get(clave);
              if (guardada) return guardada;
              const p = conTablaDelEjercicio(() => (target.execute as (...a: unknown[]) => Promise<ResultSet>)(...args), () => [sqlDe(args[0])]);
              if (lecturas.size >= MAX_LECTURAS) lecturas.clear();
              lecturas.set(clave, p);
              p.catch(() => { if (lecturas.get(clave) === p) lecturas.delete(clave); });
              return p;
            }
          }
          const r = await conTablaDelEjercicio(() => (target.execute as (...a: unknown[]) => Promise<ResultSet>)(...args), () => [sqlDe(args[0])]);
          if (ESCRITURA.test(sqlDe(args[0])) && r.rowsAffected > 0) await marcarCambio();
          return r;
        };
      }
      if (prop === "batch") {
        return async (stmts: InStatement[], ...resto: unknown[]) => {
          const ej = await ejercicioDelPedido();
          await prepararTablasAisladas(stmts, ej);
          stmts = stmts.map((st) => conEjercicio(st, ej) as InStatement);
          const rs = await conTablaDelEjercicio(() => (target.batch as (s: InStatement[], ...a: unknown[]) => Promise<ResultSet[]>)(stmts, ...resto), () => stmts.map(sqlDe));
          const cambio = stmts.some((s, i) => ESCRITURA.test(sqlDe(s)) && (rs[i]?.rowsAffected ?? 0) > 0);
          if (cambio) await marcarCambio();
          return rs;
        };
      }
      if (prop === "executeMultiple") {
        return async (sql: string) => {
          const ejM = await ejercicioDelPedido();
          await prepararTablasAisladas([sql], ejM);
          sql = sqlDelEjercicio(sql, ejM);
          await target.executeMultiple(sql);
          if (/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) await marcarCambio();
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return envuelto;
}