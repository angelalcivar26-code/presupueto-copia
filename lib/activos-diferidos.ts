import type { getDb } from "./turso";
import { calcularActivosYPorcentajesAgencias } from "./prorrateo";
import { mesesPedido, type GrupoDiferido, type PartidaDiferida, type PlanMateriales } from "./calc/activos-diferidos";
import { AGENCIAS_CONSOLIDADO } from "./consolidado";

type Db = ReturnType<typeof getDb>;

/**
 * Registro de gastos anticipados (1904), gastos diferidos (1905) y materiales (1906).
 * Una partida es de una agencia (agencia_id) o de toda la cooperativa (agencia_id NULL, alcance 'cooperativa'):
 * esas se reparten entre las agencias según su % de activo (el mismo del presupuesto departamental).
 */
export async function asegurarTablaDiferidos(db: Db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS activos_diferidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    proveedor TEXT,
    cuenta_activo TEXT,
    cuenta_gasto TEXT,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    monto REAL NOT NULL,
    alcance TEXT NOT NULL DEFAULT 'agencia',
    agencia_id INTEGER,
    renueva INTEGER NOT NULL DEFAULT 0,
    incremento_pct REAL NOT NULL DEFAULT 0,
    actualizado_en TEXT
  )`);
  // % de activo con que se reparte el período vigente: 'corte' (último corte) o 'anterior' (dic-2025)
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN pct_base TEXT NOT NULL DEFAULT 'corte'`).catch(() => {});
  // cuotas mensuales en que se paga cada período (1 = de contado)
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN cuotas_pago INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  // meses del año en que se paga (1–12, separados por coma); vacío = de contado
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN meses_pago TEXT NOT NULL DEFAULT ''`).catch(() => {});
  // descripción completa de contabilidad y origen ('archivo' = reporte de amortización cargado; 'manual')
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN detalle TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual'`).catch(() => {});
  // alcance 'reparto': cantidad de cada agencia en JSON ({"Matriz": 10, "Balsas": 2})
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN reparto TEXT NOT NULL DEFAULT ''`).catch(() => {});
  // 1906: 'pedido' (incremento de la 1906; en Matriz, compra de proveeduría) o 'gasto' (disminución contra 450705)
  await db.execute(`ALTER TABLE activos_diferidos ADD COLUMN movimiento TEXT NOT NULL DEFAULT 'pedido'`).catch(() => {});
}

/** Cuenta de gasto por defecto de cada grupo. */
export const GASTO_POR_DEFECTO: Record<GrupoDiferido, string> = { "1904": "", "1905": "", "1906": "450705" };

/** Partidas que tocan a una agencia: las suyas (parte 1), las de toda la cooperativa (parte = su % de activo) y las
 *  repartidas por cantidades (parte = su cantidad ÷ el total). */
export async function leerDiferidos(db: Db, agenciaId: number, agenciaNombre: string): Promise<(PartidaDiferida & { parte: number; parteRenov: number })[]> {
  await asegurarTablaDiferidos(db);
  const r = await db.execute({
    sql: `SELECT d.*, a.nombre AS agencia_nombre FROM activos_diferidos d LEFT JOIN agencias a ON a.id = d.agencia_id
          WHERE d.agencia_id = ? OR d.alcance IN ('cooperativa', 'reparto') ORDER BY d.grupo, d.fecha_inicio, d.id`,
    args: [agenciaId],
  });
  const hayCoop = r.rows.some((x) => String(x.alcance) === "cooperativa");
  const lista = hayCoop ? await porcentajesActivoCorte(db) : [];
  const pct = Object.fromEntries(lista.map((x) => [x.agencia, x.pct]));
  const pctAnt = Object.fromEntries(lista.map((x) => [x.agencia, x.pctAnterior ?? x.pct]));
  return r.rows.flatMap((x) => {
    const coop = String(x.alcance) === "cooperativa";
    const rep = String(x.alcance) === "reparto";
    const reparto = rep ? leerReparto(x.reparto) : undefined;
    const totalRep = reparto ? Object.values(reparto).reduce((t, v) => t + v, 0) : 0;
    const parteRep = reparto && totalRep > 0 ? (reparto[agenciaNombre] ?? 0) / totalRep : 0;
    if (rep && parteRep <= 0) return []; // repartida, pero esta agencia no tiene cantidad
    return [{
      id: Number(x.id), grupo: String(x.grupo) as GrupoDiferido, descripcion: String(x.descripcion ?? ""), proveedor: String(x.proveedor ?? ""),
      cuentaActivo: String(x.cuenta_activo ?? ""), cuentaGasto: String(x.cuenta_gasto ?? ""),
      fechaInicio: String(x.fecha_inicio), fechaFin: String(x.fecha_fin), monto: Number(x.monto) || 0,
      alcance: coop ? "cooperativa" : rep ? "reparto" : "agencia", agencia: coop || rep ? null : String(x.agencia_nombre ?? agenciaNombre), ...(reparto ? { reparto } : {}),
      renueva: Number(x.renueva) === 1, incremento: (Number(x.incremento_pct) || 0) / 100,
      pctBase: String(x.pct_base ?? "corte") === "anterior" ? "anterior" : "corte",
      cuotasPago: Math.max(1, Number(x.cuotas_pago) || 1),
      mesesPago: String(x.meses_pago ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 12),
      detalle: String(x.detalle ?? ""), origen: String(x.origen ?? "manual") === "archivo" ? "archivo" : "manual",
      parte: coop ? (String(x.pct_base) === "anterior" ? pctAnt[agenciaNombre] : pct[agenciaNombre]) ?? 0 : rep ? parteRep : 1,
      parteRenov: coop ? pct[agenciaNombre] ?? 0 : rep ? parteRep : 1,
    } as PartidaDiferida & { parte: number; parteRenov: number }];
  });
}

/**
 * Promedio mensual de materiales del año del último estado de resultados cargado (histórico):
 *  consumo = 450705 acumulado ÷ meses; compras = (saldo de proveeduría al último mes − el de diciembre anterior + consumo) ÷ meses.
 *  Proveeduría = 190615 si el balance la trae (sin las tarjetas de débito 190610, que no pasan por la 450705); si no, toda la 1906.
 */
async function promedioMateriales(db: Db, oficina: string): Promise<{ promedioCompras: number; promedioConsumo: number; meses: number; periodo: string | null }> {
  const u = await db.execute({ sql: `SELECT MAX(periodo) AS p FROM historico_cuentas WHERE oficina = ? AND tipo = 'ER' AND codigo = '450705'`, args: [oficina] }).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const per = u.rows[0]?.p ? String(u.rows[0].p) : null;
  if (!per) return { promedioCompras: 0, promedioConsumo: 0, meses: 0, periodo: null };
  const anio = Number(per.slice(0, 4)), meses = Number(per.slice(5, 7));
  const r = await db.execute({
    sql: `SELECT periodo, tipo, codigo, valor FROM historico_cuentas WHERE oficina = ? AND periodo IN (?, ?) AND ((tipo = 'ER' AND codigo = '450705') OR (tipo = 'BAL' AND codigo IN ('1906', '190615')))`,
    args: [oficina, per, `${anio - 1}-12`],
  });
  const v = (p: string, t: string, c: string) => { const x = r.rows.find((y) => String(y.periodo) === p && String(y.tipo) === t && String(y.codigo) === c); return x ? Math.abs(Number(x.valor) || 0) : null; };
  const consumoAnio = v(per, "ER", "450705") ?? 0;
  const conProv = v(per, "BAL", "190615") !== null || v(`${anio - 1}-12`, "BAL", "190615") !== null;
  const cod = conProv ? "190615" : "1906";
  const fin = v(per, "BAL", cod), ini = v(`${anio - 1}-12`, "BAL", cod);
  const promedioConsumo = meses ? consumoAnio / meses : 0;
  const promedioCompras = meses && (conProv || (fin !== null && ini !== null)) ? Math.max(0, ((fin ?? 0) - (ini ?? 0) + consumoAnio) / meses) : promedioConsumo;
  return { promedioCompras, promedioConsumo, meses, periodo: per };
}

type Param = { concepto: string; mes: number | string; monto: number | string };
interface MovMateriales { id: number; movimiento: "pedido" | "gasto"; descripcion: string; fechaInicio: string; fechaFin: string; monto: number; porMes: number[] }
async function datosAgencia(db: Db, nombre: string, ejercicio: number) {
  const idr = await db.execute({ sql: `SELECT id FROM agencias WHERE nombre = ?`, args: [nombre] });
  const id = idr.rows[0] ? Number(idr.rows[0].id) : null;
  if (id === null) return { saldo: 0, movs: [] as MovMateriales[] };
  const [corte, movs] = await Promise.all([
    db.execute({ sql: `SELECT anio, mes FROM saldos_cargas WHERE agencia_id = ? ORDER BY anio DESC, mes DESC LIMIT 1`, args: [id] }),
    movimientosMateriales(db, id, ejercicio),
  ]);
  const c = corte.rows[0] ? { anio: Number(corte.rows[0].anio), mes: Number(corte.rows[0].mes) } : { anio: 2025, mes: 12 };
  const sal = await db.execute({ sql: `SELECT monto FROM saldos_iniciales WHERE agencia_id = ? AND anio = ? AND mes = ? AND cuenta_codigo = '1906'`, args: [id, c.anio, c.mes] });
  return { saldo: Math.abs(Number(sal.rows[0]?.monto) || 0), movs };
}
/** Pedidos y gastos de materiales registrados por la agencia (partidas del grupo 1906) que tocan el ejercicio. */
export async function movimientosMateriales(db: Db, agenciaId: number, ejercicio: number): Promise<MovMateriales[]> {
  await asegurarTablaDiferidos(db);
  const r = await db.execute({ sql: `SELECT id, movimiento, descripcion, fecha_inicio, fecha_fin, monto FROM activos_diferidos WHERE grupo = '1906' AND agencia_id = ? ORDER BY movimiento DESC, fecha_inicio, id`, args: [agenciaId] });
  return r.rows.map((x) => {
    const p = { id: Number(x.id), movimiento: (String(x.movimiento ?? "") === "gasto" ? "gasto" : "pedido") as "pedido" | "gasto", descripcion: String(x.descripcion ?? ""), fechaInicio: String(x.fecha_inicio), fechaFin: String(x.fecha_fin), monto: Number(x.monto) || 0 };
    return { ...p, porMes: mesesPedido(p.fechaInicio, p.fechaFin, p.monto, ejercicio) };
  }).filter((p) => p.porMes.some((v) => v > 0));
}
const porMes = (lista: MovMateriales[], m: "pedido" | "gasto") => Array.from({ length: 12 }, (_, i) => lista.filter((p) => p.movimiento === m).reduce((t, p) => t + p.porMes[i], 0));
const cero12 = () => Array(12).fill(0) as number[];
/** Agencia (no Matriz): pedidos a Matriz (incremento) y gasto 450705 (disminución) registrados. */
async function planAgencia(db: Db, nombre: string, ejercicio: number, saldo?: number): Promise<PlanMateriales> {
  const [d, prom] = await Promise.all([datosAgencia(db, nombre, ejercicio), promedioMateriales(db, nombre)]);
  const s0 = saldo ?? d.saldo;
  const pedidos = porMes(d.movs, "pedido"), consumo = porMes(d.movs, "gasto");
  let s = s0;
  return { esBodega: false, compras: cero12(), pedidos, entregas: cero12(), consumo, saldoCorte: s0, saldoPorMes: pedidos.map((p, i) => (s = s + p - consumo[i])),
    promedioPedido: prom.promedioCompras, promedioGasto: prom.promedioConsumo, periodo: prom.periodo };
}
/**
 * Plan de materiales de una agencia para el ejercicio. Matriz (bodega): compras de proveeduría registradas (efectivo),
 * entregas a las agencias (lo que ellas registran como pedido) y su propio gasto.
 */
export async function planMaterialesAgencia(db: Db, nombre: string, ejercicio: number, _parametros?: Param[], saldo?: number): Promise<PlanMateriales> {
  if (nombre !== "Matriz") return planAgencia(db, nombre, ejercicio, saldo);
  const [d, prom, otras] = await Promise.all([
    datosAgencia(db, nombre, ejercicio),
    promedioMateriales(db, nombre),
    Promise.all(AGENCIAS_CONSOLIDADO.filter((a) => a !== "Matriz").map((a) => planAgencia(db, a, ejercicio).catch(() => null))),
  ]);
  const s0 = saldo ?? d.saldo;
  const entregas = Array.from({ length: 12 }, (_, i) => otras.reduce((t, p) => t + (p?.pedidos[i] ?? 0), 0));
  const compras = porMes(d.movs, "pedido"), consumo = porMes(d.movs, "gasto");
  let s = s0;
  const saldoPorMes = compras.map((c, i) => (s = s + c - entregas[i] - consumo[i]));
  // compra mensual de referencia: lo que entró a la bodega neto de entregas + lo que pidieron las agencias
  const promedioPedido = prom.promedioCompras + otras.reduce((t, p) => t + (p?.promedioPedido ?? 0), 0);
  return { esBodega: true, compras, pedidos: cero12(), entregas, consumo, saldoCorte: s0, saldoPorMes, promedioPedido, promedioGasto: prom.promedioConsumo, periodo: prom.periodo };
}

/** {"Matriz": 10, "Balsas": 2} (solo cantidades positivas). */
export function leerReparto(v: unknown): Record<string, number> {
  try {
    const o = typeof v === "string" ? JSON.parse(v || "{}") : v;
    return Object.fromEntries(Object.entries(o ?? {}).map(([k, n]) => [k, Number(n)]).filter(([, n]) => (n as number) > 0)) as Record<string, number>;
  } catch { return {}; }
}

/** Nombres del catálogo de las cuentas de gasto (4503, 4506, 4507). */
export async function nombresCuentasGasto(db: Db): Promise<Record<string, string>> {
  const r = await db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE (codigo LIKE '4503%' OR codigo LIKE '4506%' OR codigo LIKE '4507%') AND length(codigo) >= 6`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  return Object.fromEntries(r.rows.map((x) => [String(x.codigo), String(x.nombre)]));
}

/**
 * % de activo de cada agencia para repartir las partidas de toda la cooperativa: el mismo del presupuesto departamental
 * (balance del último corte cargado, activo − 1908).
 */
export async function porcentajesActivoCorte(db: Db): Promise<{ agencia: string; pct: number; pctAnterior: number | null; base: number; corte: { anio: number; mes: number }; fuente: string }[]> {
  const { detalle } = await calcularActivosYPorcentajesAgencias(db);
  // % anterior: el de la referencia de dic-2025 (activo − 1908), con el que se contrataron las pólizas vigentes
  const totRef = detalle.reduce((t, d) => t + (d.referencia ?? 0), 0);
  return detalle.map((d) => ({ agencia: d.agencia, pct: d.porcentaje, pctAnterior: totRef > 0 && d.referencia !== null ? d.referencia / totRef : null, base: d.base, corte: d.corte, fuente: d.fuente }));
}
