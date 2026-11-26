/**
 * BASE HISTÓRICA DE INGRESOS Y GASTOS («Cargar histórico» y «Recalcular» en las hojas): se calcula de los
 * Históricos cargados (estado de resultados de cada mes), para cada agencia y ejercicio. No se guarda: cada mes nuevo
 * que se carga cambia la base, y cada ejercicio usa sus propios años (no toca los presupuestos anteriores).
 *
 *  - Base sugerida (base_ttm): los 12 meses hasta el último mes cargado antes del ejercicio. El estado de resultados
 *    viene acumulado en el año: 12 meses a mes M del año A = acumulado(A, M) + acumulado(A−1, dic) − acumulado(A−1, M).
 *    Si falta el año anterior, se anualiza lo acumulado (× 12 ÷ M).
 *  - Reparto mensual (pesos_mensuales): el peso de cada mes en los dos últimos años completos.
 *  - Comparación por año (stats_anuales): mínimo, máximo y promedio mensual y total de los dos años anteriores
 *    al ejercicio, y su variación.
 */
type Db = { execute: (q: string | { sql: string; args: (string | number)[] }) => Promise<{ rows: Record<string, unknown>[] }> };

export interface StatsAnio { anio: number; min: number; max: number; avg: number; total: number; completo: boolean }
export interface StatsHistorico { anios: StatsAnio[]; variacion_pct?: number }
export interface FilaBaseHistorica {
  agencia: string; codigo: string; nombre_cuenta: string; base_ttm: number; crecimiento_prom: number | null;
  /** cuenta de detalle (sin subcuentas): las que se sugieren en «Cargar histórico»; las madres sirven para «Recalcular» */
  detalle: boolean;
  pesos_mensuales: string | null; stats_anuales: string | null;
}

const per = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Base de las agencias indicadas («Consolidado» = suma de las agencias) para un grupo de cuentas (p. ej. 45, 4503). */
export async function baseHistorica(db: Db, ejercicio: number, grupo: string, agencias: string[]): Promise<FilaBaseHistorica[]> {
  const desde = per(ejercicio - 3, 1), hasta = per(ejercicio - 1, 12);
  const [cuentas, cargados] = await Promise.all([
    // códigos del grupo por rango (usa el índice tipo+código; LIKE no lo usa y leería toda la tabla)
    db.execute({ sql: `SELECT oficina, periodo, codigo, valor FROM historico_cuentas WHERE tipo = 'ER' AND codigo >= ? AND codigo < ? AND periodo >= ? AND periodo <= ?`, args: [grupo, `${grupo}:`, desde, hasta] }),
    db.execute({ sql: `SELECT oficina, periodo FROM historico_resumen WHERE er > 0 AND periodo >= ? AND periodo <= ?`, args: [desde, hasta] }),
  ]);
  const nombres = new Map<string, string>();
  const codigosTodos = [...new Set(cuentas.rows.map((r) => String(r.codigo)))];
  for (let k = 0; k < codigosTodos.length; k += 400) {
    const parte = codigosTodos.slice(k, k + 400);
    const n = await db.execute({ sql: `SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo IN (${parte.map(() => "?").join(",")})`, args: parte }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    for (const x of n.rows) nombres.set(String(x.codigo), String(x.nombre ?? ""));
  }

  const out: FilaBaseHistorica[] = [];
  for (const agencia of agencias) {
    const consolidado = agencia === "Consolidado";
    // si hay archivo propio del Consolidado se usa; si no, la suma de las agencias
    const propio = cargados.rows.some((r) => String(r.oficina) === "Consolidado");
    const de = (oficina: string) => (consolidado ? (propio ? oficina === "Consolidado" : oficina !== "Consolidado") : oficina === agencia);
    const meses = new Set(cargados.rows.filter((r) => de(String(r.oficina))).map((r) => String(r.periodo)));
    if (!meses.size) continue;
    const v = new Map<string, Map<string, number>>(); // código → período → acumulado
    for (const r of cuentas.rows) {
      if (!de(String(r.oficina))) continue;
      const m = v.get(String(r.codigo)) ?? new Map<string, number>();
      m.set(String(r.periodo), (m.get(String(r.periodo)) ?? 0) + (Number(r.valor) || 0));
      v.set(String(r.codigo), m);
    }
    const codigos = [...v.keys()].filter((c) => c.length >= 6);
    // ¿el mes trae subcuentas de esa cuenta? (los archivos de 8 dígitos sí; los de 6, no)
    const porMes = new Map<string, string[]>();
    for (const [c, m] of v) for (const p of m.keys()) (porMes.get(p) ?? porMes.set(p, []).get(p)!).push(c);
    const conSubcuentas = (p: string, madre: string) => (porMes.get(p) ?? []).some((c) => c.length > madre.length && c.startsWith(madre));
    // de detalle = sin subcuentas: «Cargar histórico» sugiere solo esas (una cuenta y su madre no se cargan las dos)
    const esDetalle = (c: string) => !codigos.some((o) => o !== c && o.startsWith(c));
    const ultimo = [...meses].sort().pop()!;
    const [ua, um] = ultimo.split("-").map(Number);

    for (const codigo of codigos) {
      const s = v.get(codigo)!;
      // un mes cargado con menos dígitos (p. ej. 2025 a 6 dígitos y 2026 a 8) no dice nada de la subcuenta: se toma como
      // sin dato (no como cero), así la base no se queda con solo los meses que sí traen la subcuenta
      const sinDetalle = (p: string) => codigo.length > 6 && !s.has(p) && !conSubcuentas(p, codigo.slice(0, codigo.length - 2));
      const acum = (a: number, m: number): number | null => (meses.has(per(a, m)) && !sinDetalle(per(a, m)) ? s.get(per(a, m)) ?? 0 : null);
      const mov = (a: number, m: number): number | null => {
        const c = acum(a, m); if (c === null) return null;
        if (m === 1) return c;
        const p = acum(a, m - 1); return p === null ? null : c - p;
      };
      // base de los últimos 12 meses
      const ytd = acum(ua, um) ?? 0;
      const dicAnt = acum(ua - 1, 12), mAnt = um === 12 ? 0 : acum(ua - 1, um);
      const base = um === 12 ? ytd : dicAnt !== null && mAnt !== null ? ytd + dicAnt - mAnt : (ytd * 12) / um;

      // años anteriores al ejercicio: el más reciente primero
      const anios: StatsAnio[] = [];
      for (const a of [ejercicio - 1, ejercicio - 2]) {
        const ms = Array.from({ length: 12 }, (_, i) => mov(a, i + 1)).filter((x): x is number => x !== null);
        if (!ms.length) continue;
        anios.push({ anio: a, min: r2(Math.min(...ms)), max: r2(Math.max(...ms)), avg: r2(ms.reduce((t, x) => t + x, 0) / ms.length), total: r2(acum(a, 12) ?? ms.reduce((t, x) => t + x, 0)), completo: ms.length === 12 });
      }
      // estacionalidad: los dos últimos años completos (los 12 meses cargados)
      const completos = [ua, ua - 1, ua - 2].filter((a) => a < ejercicio && Array.from({ length: 12 }, (_, i) => mov(a, i + 1)).every((x) => x !== null)).slice(0, 2);
      let pesos: number[] | null = null;
      if (completos.length) {
        const porMes = Array.from({ length: 12 }, (_, i) => completos.reduce((t, a) => t + (mov(a, i + 1) ?? 0), 0));
        const total = porMes.reduce((t, x) => t + x, 0);
        if (total > 0 && porMes.every((x) => x >= 0)) pesos = porMes.map((x) => Math.round((x / total) * 1e6) / 1e6);
      }
      const [rec, ant] = anios;
      const variacion = rec?.completo && ant?.completo && ant.total ? Math.round((rec.total / ant.total - 1) * 1000) / 10 : undefined;
      if (Math.abs(base) < 0.005 && !anios.some((x) => Math.abs(x.total) >= 0.005)) continue;
      const stats: StatsHistorico = { anios, ...(variacion !== undefined ? { variacion_pct: variacion } : {}) };
      out.push({
        agencia, codigo, detalle: esDetalle(codigo), nombre_cuenta: nombres.get(codigo) ?? codigo, base_ttm: r2(base), crecimiento_prom: variacion ?? null,
        pesos_mensuales: pesos ? JSON.stringify(pesos) : null, stats_anuales: JSON.stringify(stats),
      });
    }
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Años de la comparación (el más reciente primero), con el formato nuevo o el anterior ({"2025": …, "2024": …}). */
export function aniosDeStats(json: string | null): { anios: StatsAnio[]; variacion_pct?: number } | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json);
    if (Array.isArray(s.anios)) return s;
    const anios = Object.keys(s).filter((k) => /^\d{4}$/.test(k)).sort().reverse().map((k) => ({ anio: Number(k), ...s[k], completo: true }));
    return { anios, variacion_pct: s.variacion_pct };
  } catch { return null; }
}
