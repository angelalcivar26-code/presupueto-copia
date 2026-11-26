import { getDb } from "./turso";
import { CODIGOS_CARTERA, CODIGOS_PROVISION_CARTERA } from "./calc/orquestador";
import { generarTrayectoria, type Linea, type ParametroProvisionLinea } from "./calc/provision";

/**
 * Provisión de cartera por agencia (Cartera → Parámetros → Provisión).
 *
 * Tablas (todo vive en la base de datos):
 *  - parametros_provision      : una fila por agencia y línea con "sin reversiones",
 *                                la variación en el año y la distribución usadas
 *                                para generar la trayectoria (queda como constancia).
 *  - parametros_provision_mes  : el % de provisión de cada mes (12 filas por agencia y línea).
 *  - historico_provision       : cartera y provisión mensual de balances pasados
 *                                (solo para el histórico; no cambia el punto de partida).
 * El histórico también incluye los balances cargados en saldos_iniciales.
 */

type Db = ReturnType<typeof getDb>;
export const LINEAS_PROVISION: Linea[] = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"];

interface PuntoHistorico {
  anio: number;
  mes: number;
  fuente: "balance cargado" | "histórico";
  ratio: Record<Linea, number | null>;
}

interface ParametroLineaGuardado {
  variacionPts: number;                  // puntos en el año usados al generar
  distribucion: "parejo" | "historico";
  pctMes: number[] | null;               // 12 valores 0..1 (null = no definido: se mantiene el % actual)
}
interface ParametrosProvisionGuardados {
  sinReversiones: boolean;
  guardado: boolean;                     // hay algo guardado para esta agencia
  lineas: Record<Linea, ParametroLineaGuardado>;
}

let tablasListas = false; // se revisa una vez por proceso del servidor

export async function asegurarTablaProvision(db: Db) {
  if (tablasListas) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS parametros_provision (
      agencia_id      INTEGER NOT NULL REFERENCES agencias(id),
      linea           TEXT    NOT NULL,
      base            TEXT    NOT NULL DEFAULT 'ultimo',
      ajuste_pts      REAL    NOT NULL DEFAULT 0,
      gradual         INTEGER NOT NULL DEFAULT 1,
      sin_reversiones INTEGER NOT NULL DEFAULT 1,
      actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agencia_id, linea)
    )`,
    `CREATE TABLE IF NOT EXISTS parametros_provision_mes (
      agencia_id     INTEGER NOT NULL REFERENCES agencias(id),
      linea          TEXT    NOT NULL,
      mes            INTEGER NOT NULL,
      pct            REAL    NOT NULL,   -- en %, ej. 32.23
      actualizado_en TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agencia_id, linea, mes)
    )`,
  ], "write");
  // Columnas agregadas después de la primera versión
  for (const col of ["pct_manual REAL", "variacion_pts REAL NOT NULL DEFAULT 0", "distribucion TEXT NOT NULL DEFAULT 'parejo'"]) {
    try { await db.execute(`ALTER TABLE parametros_provision ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
  tablasListas = true;
}

function ratiosDeCodigos(m: Map<string, number>): Record<Linea, number | null> {
  const sum = (cs: string[]) => cs.reduce((a, c) => a + (m.get(c) ?? 0), 0);
  const out = {} as Record<Linea, number | null>;
  for (const l of LINEAS_PROVISION) {
    const cartera = sum(CODIGOS_CARTERA[l].porVencer) + sum(CODIGOS_CARTERA[l].enRiesgo);
    const prov = Math.abs(sum(CODIGOS_PROVISION_CARTERA[l]));
    out[l] = cartera > 0 ? prov / cartera : null;
  }
  return out;
}

/** % de provisión por línea en cada mes con datos: balances cargados + tabla historico_provision. */
export async function historicoProvision(db: Db, agenciaId: number, agenciaNombre: string): Promise<PuntoHistorico[]> {
  const puntos = new Map<string, PuntoHistorico>();

  // 1. Tabla historico_provision (si existe)
  try {
    const h = await db.execute({
      sql: `SELECT anio, mes, linea, cartera, provision FROM historico_provision WHERE agencia = ?`,
      args: [agenciaNombre],
    });
    for (const r of h.rows) {
      const k = `${r.anio}-${r.mes}`;
      const p = puntos.get(k) ?? { anio: Number(r.anio), mes: Number(r.mes), fuente: "histórico" as const, ratio: { PRODUCTIVO: null, CONSUMO: null, INMOBILIARIO: null, MICROCREDITO: null } };
      const c = Number(r.cartera) || 0;
      p.ratio[r.linea as Linea] = c > 0 ? (Number(r.provision) || 0) / c : null;
      puntos.set(k, p);
    }
  } catch { /* la tabla todavía no existe */ }

  // 2. Balances cargados (tienen prioridad: son la fuente del punto de partida)
  const codigos = new Set<string>();
  for (const l of LINEAS_PROVISION) [...CODIGOS_CARTERA[l].porVencer, ...CODIGOS_CARTERA[l].enRiesgo, ...CODIGOS_PROVISION_CARTERA[l]].forEach((c) => codigos.add(c));
  const lista = [...codigos];
  const res = await db.execute({
    sql: `SELECT s.anio, s.mes, s.cuenta_codigo, s.monto
          FROM saldos_iniciales s
          JOIN saldos_cargas c ON c.agencia_id = s.agencia_id AND c.anio = s.anio AND c.mes = s.mes
          WHERE s.agencia_id = ? AND s.cuenta_codigo IN (${lista.map(() => "?").join(",")})`,
    args: [agenciaId, ...lista],
  });
  const porCorte = new Map<string, Map<string, number>>();
  for (const r of res.rows) {
    const k = `${r.anio}-${r.mes}`;
    const m = porCorte.get(k) ?? new Map<string, number>();
    m.set(r.cuenta_codigo as string, (m.get(r.cuenta_codigo as string) ?? 0) + (Number(r.monto) || 0));
    porCorte.set(k, m);
  }
  for (const [k, m] of porCorte) {
    const [anio, mes] = k.split("-").map(Number);
    puntos.set(k, { anio, mes, fuente: "balance cargado", ratio: ratiosDeCodigos(m) });
  }
  return [...puntos.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
}

/** Peso de cada mes calendario = cuánto se movió el % (en valor absoluto) en ese mes en el histórico. */
export function pesosHistoricos(historico: PuntoHistorico[], linea: Linea): number[] | null {
  const suma = Array(12).fill(0) as number[], n = Array(12).fill(0) as number[];
  for (let i = 1; i < historico.length; i++) {
    const a = historico[i - 1], b = historico[i];
    const consecutivo = (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes) === 1;
    const ra = a.ratio[linea], rb = b.ratio[linea];
    if (!consecutivo || ra === null || rb === null) continue;
    suma[b.mes - 1] += Math.abs(rb - ra);
    n[b.mes - 1]++;
  }
  const conDato = n.map((c, i) => (c ? suma[i] / c : null));
  const valores = conDato.filter((v): v is number => v !== null);
  if (!valores.length) return null;
  const prom = valores.reduce((x, y) => x + y, 0) / valores.length;
  return conDato.map((v) => (v === null ? prom : v));
}

export async function leerParametrosProvision(db: Db, agenciaId: number, pctActual: Record<Linea, number | null>): Promise<ParametrosProvisionGuardados> {
  const lineas = Object.fromEntries(LINEAS_PROVISION.map((l) => [l, { variacionPts: 0, distribucion: "parejo", pctMes: null }])) as Record<Linea, ParametroLineaGuardado>;
  let sinReversiones = true;
  let guardado = false;
  try {
    await asegurarTablaProvision(db);
    const [cab, mes] = await Promise.all([
      db.execute({ sql: `SELECT * FROM parametros_provision WHERE agencia_id = ?`, args: [agenciaId] }),
      db.execute({ sql: `SELECT linea, mes, pct FROM parametros_provision_mes WHERE agencia_id = ? ORDER BY linea, mes`, args: [agenciaId] }),
    ]);
    for (const r of cab.rows) {
      const l = r.linea as Linea;
      if (!lineas[l]) continue;
      guardado = true;
      sinReversiones = Number(r.sin_reversiones) === 1;
      lineas[l].variacionPts = Number(r.variacion_pts) || 0;
      lineas[l].distribucion = r.distribucion === "historico" ? "historico" : "parejo";
      // Filas de la versión anterior (base/ajuste/manual): se convierten a 12 meses
      const actual = pctActual[l];
      if (actual !== null && (r.base === "manual" || Number(r.ajuste_pts) !== 0 || r.base === "promedio")) {
        const final = r.base === "manual" && r.pct_manual !== null ? Number(r.pct_manual) / 100 : actual + (Number(r.ajuste_pts) || 0) / 100;
        lineas[l].pctMes = Number(r.gradual) === 1
          ? generarTrayectoria(actual, (final - actual) * 100, "parejo", null)
          : Array(12).fill(Math.max(0, final));
      }
    }
    const porLinea = new Map<Linea, number[]>();
    for (const r of mes.rows) {
      const l = r.linea as Linea;
      const arr = porLinea.get(l) ?? Array(12).fill(NaN);
      arr[Number(r.mes) - 1] = Number(r.pct) / 100;
      porLinea.set(l, arr);
    }
    for (const [l, arr] of porLinea) if (lineas[l] && arr.every((v) => Number.isFinite(v))) { lineas[l].pctMes = arr; guardado = true; }
  } catch (e) {
    console.error("[provisión] no se pudieron leer los parámetros", e);
  }
  return { sinReversiones, guardado, lineas };
}

/** Lo que usa el motor: 12 % por línea (o el % actual si no hay nada definido) y "sin reversiones". */
export function resolverParametrosMotor(
  guardados: ParametrosProvisionGuardados,
  pctActual: Record<Linea, number | null>
): Partial<Record<Linea, ParametroProvisionLinea>> {
  const out: Partial<Record<Linea, ParametroProvisionLinea>> = {};
  for (const l of LINEAS_PROVISION) {
    const pctMes = guardados.lineas[l].pctMes ?? (pctActual[l] !== null ? Array(12).fill(pctActual[l]) : null);
    if (pctMes) out[l] = { pctPorMes: pctMes, sinReversiones: guardados.sinReversiones };
  }
  return out;
}

/** % actual (del corte en uso) por línea. */
export function pctActualDe(historico: PuntoHistorico[], corte: { anio: number; mes: number }): Record<Linea, number | null> {
  const p = historico.find((h) => h.anio === corte.anio && h.mes === corte.mes && h.fuente === "balance cargado");
  return Object.fromEntries(LINEAS_PROVISION.map((l) => [l, p?.ratio[l] ?? null])) as Record<Linea, number | null>;
}