/**
 * Devuelve el activo (para prorrateo) y el % de cada agencia sobre el activo
 * total del grupo. Activo = suma de los grupos 11,13,14,16,17,18,19 (=cuenta
 * 1 ACTIVO) menos la cuenta 1908 Transferencias Internas — validado contra
 * la herramienta de indicadores ($58,975,152.30 - $9,758,550.58 =
 * $49,216,601.72 para Matriz, Dic-2025).
 *
 * Cualquier agencia con balance cargado en saldos_iniciales se calcula EN
 * VIVO con esa fórmula. Las agencias sin balance cargado todavía usan la
 * cifra de referencia guardada en activos_por_agencia (Excel), hasta que se
 * suba su balance real — momento en el que empiezan a calcularse solas sin
 * tocar código.
 *
 * CORRECCIONES (sep-2026):
 *  1. El balance se toma del MISMO corte que usa el motor: el más reciente
 *     cargado de cada agencia (saldos_cargas), igual que resolverCorteSaldos().
 *     Si una agencia no tiene cargas registradas, se usa dic-2025. Antes se
 *     sumaban todos los cortes cargados de una agencia, y si tenía más de uno
 *     su activo salía duplicado.
 *  2. Los % se calculan solo sobre las agencias de la tabla agencias. Antes,
 *     si un nombre de activos_por_agencia no coincidía exactamente (ej.
 *     "EL GUABO" vs "El Guabo"), esa agencia se contaba dos veces en el total
 *     y los % de las 10 agencias sumaban menos de 100 %.
 *  3. Devuelve también el detalle (activo, 1908, base, fuente, %), para
 *     poder revisarlo en pantalla y cuadrarlo a mano.
 *  4. (oct-2026) El % sale del balance del ÚLTIMO corte cargado de cada agencia
 *     (activo − 1908, igual que en dic-2025); el valor de activos_por_agencia
 *     (dic-2025) queda solo para una agencia sin balance cargado. Si el balance
 *     trae la cuenta 1 (ACTIVOS), se usa esa; si no, la suma de los grupos 11..19.
 *     Los % usados se guardan en la tabla porcentajes_activo (por corte).
 */
const CODIGOS_GRUPO_ACTIVO = ["11", "13", "14", "16", "17", "18", "19"];
/** Corte de respaldo si una agencia no tiene ninguna carga en saldos_cargas. */
const CORTE_RESPALDO = { anio: 2025, mes: 12 };

interface DetalleActivoAgencia {
  agencia: string;
  fuente: "balance" | "referencia" | "sin datos"; // de dónde sale la base usada
  activoGrupos: number | null; // cuenta 1, o suma 11+13+14+16+17+18+19 (solo si hay balance)
  cuenta1908: number | null;
  baseBalance: number | null;  // activo - 1908 según el balance cargado
  referencia: number | null;   // valor guardado en activos_por_agencia
  base: number;                // activo usado para el prorrateo
  porcentaje: number;          // 0..1
  corte: { anio: number; mes: number }; // corte del balance leído (el más reciente de la agencia)
}

/** "EL GUABO", "El Guabo", "Ag. El Guabo" -> "el guabo" */
function normalizar(nombre: string): string {
  return nombre
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(ag\.?|agencia)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function calcularActivosYPorcentajesAgencias(
  db: ReturnType<typeof import("./turso").getDb>
): Promise<{ activos: Record<string, number>; porcentajes: Record<string, number>; detalle: DetalleActivoAgencia[] }> {
  const [agenciasRes, refRes, cargasRes] = await Promise.all([
    db.execute({ sql: `SELECT id, nombre FROM agencias` }),
    db.execute({ sql: `SELECT agencia_nombre, activo_dic2025 FROM activos_por_agencia` }),
    db.execute({ sql: `SELECT agencia_id, MAX(anio * 100 + mes) AS periodo FROM saldos_cargas GROUP BY agencia_id` }),
  ]);

  // Corte más reciente de cada agencia (mismo criterio que el motor)
  const cortePorAgencia = new Map<number, { anio: number; mes: number }>();
  for (const r of cargasRes.rows) {
    const p = Number(r.periodo);
    if (p) cortePorAgencia.set(Number(r.agencia_id), { anio: Math.floor(p / 100), mes: p % 100 });
  }
  const corteDe = (id: number) => cortePorAgencia.get(id) ?? CORTE_RESPALDO;

  // Saldos del grupo 1 de cada agencia en SU corte
  const saldosPorAgencia = await Promise.all(agenciasRes.rows.map((a) => {
    const id = Number(a.id);
    const c = corteDe(id);
    return db.execute({
      sql: `SELECT agencia_id, cuenta_codigo, monto FROM saldos_iniciales
            WHERE agencia_id = ? AND anio = ? AND mes = ? AND cuenta_codigo IN ('1','11','13','14','16','17','18','19','1908')`,
      args: [id, c.anio, c.mes],
    });
  }));
  const saldosRes = { rows: saldosPorAgencia.flatMap((r) => r.rows) };

  // Referencia (Excel) por nombre normalizado
  const referencia = new Map<string, number>();
  for (const r of refRes.rows) referencia.set(normalizar(r.agencia_nombre as string), Number(r.activo_dic2025) || 0);

  // Balance real por agencia (su corte más reciente)
  const porAgencia = new Map<number, { grupos: number; cuenta1: number | null; c1908: number; hay: boolean }>();
  for (const r of saldosRes.rows) {
    const id = r.agencia_id as number;
    const acc = porAgencia.get(id) ?? { grupos: 0, cuenta1: null, c1908: 0, hay: false };
    const codigo = r.cuenta_codigo as string;
    const monto = Number(r.monto) || 0;
    if (codigo === "1") { acc.cuenta1 = (acc.cuenta1 ?? 0) + monto; acc.hay = true; }
    if (CODIGOS_GRUPO_ACTIVO.includes(codigo)) { acc.grupos += monto; acc.hay = true; }
    if (codigo === "1908") acc.c1908 += monto;
    porAgencia.set(id, acc);
  }

  const detalle: DetalleActivoAgencia[] = agenciasRes.rows.map((a) => {
    const nombre = a.nombre as string;
    const bal = porAgencia.get(a.id as number);
    const ref = referencia.get(normalizar(nombre)) ?? null;
    const activo = bal && bal.hay ? bal.cuenta1 ?? bal.grupos : null;
    const baseBalance = activo !== null && bal ? activo - bal.c1908 : null;
    // Con balance cargado se usa el del último corte (activo − 1908); la referencia de dic-2025 solo si no hay balance
    const fuente: DetalleActivoAgencia["fuente"] = baseBalance !== null ? "balance" : ref !== null ? "referencia" : "sin datos";
    return {
      agencia: nombre, fuente, activoGrupos: activo, cuenta1908: bal && bal.hay ? bal.c1908 : null,
      baseBalance, referencia: ref, base: baseBalance ?? ref ?? 0, porcentaje: 0,
      corte: corteDe(a.id as number),
    };
  });

  // % sobre el total de las agencias (una sola vez cada una)
  const total = detalle.reduce((s, d) => s + d.base, 0);
  for (const d of detalle) d.porcentaje = total > 0 ? d.base / total : 0;

  const activos: Record<string, number> = {};
  const porcentajes: Record<string, number> = {};
  for (const d of detalle) { activos[d.agencia] = d.base; porcentajes[d.agencia] = d.porcentaje; }
  return { activos, porcentajes, detalle };
}
/** Guarda los % de activo usados (por agencia y corte) en porcentajes_activo. No cambia la versión de los datos. */
export async function guardarPorcentajesActivo(db: ReturnType<typeof import("./turso").getDb>, detalle: DetalleActivoAgencia[]): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS porcentajes_activo (
    agencia TEXT NOT NULL, corte_anio INTEGER NOT NULL, corte_mes INTEGER NOT NULL,
    activo REAL, cuenta_1908 REAL, base REAL NOT NULL, porcentaje REAL NOT NULL, fuente TEXT, actualizado_en TEXT,
    PRIMARY KEY (agencia, corte_anio, corte_mes))`);
  await db.batch(detalle.map((d) => ({
    sql: `INSERT INTO porcentajes_activo (agencia, corte_anio, corte_mes, activo, cuenta_1908, base, porcentaje, fuente, actualizado_en)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(agencia, corte_anio, corte_mes) DO UPDATE SET activo = excluded.activo, cuenta_1908 = excluded.cuenta_1908, base = excluded.base,
            porcentaje = excluded.porcentaje, fuente = excluded.fuente, actualizado_en = excluded.actualizado_en`,
    args: [d.agencia, d.corte.anio, d.corte.mes, d.activoGrupos, d.cuenta1908, d.base, d.porcentaje, d.fuente],
  })), "write");
}
