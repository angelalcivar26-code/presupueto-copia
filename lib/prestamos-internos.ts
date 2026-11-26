import type { getDb } from "./turso";
import { conCache } from "./cache-motor";
import { TASA_PRESTAMOS_INTERNOS } from "./calc/ingresos-51";
import { OFICINAS, contraparteDe, esPrestamo, proyectarPrestamo, interesPrestamo, type PrestamosAgencia } from "./calc/prestamos-internos";

type Db = ReturnType<typeof getDb>;
const cero = () => Array(12).fill(0) as number[];

/** Abono mensual guardado por préstamo (tipo 'abono') y préstamos nuevos del ejercicio (tipo 'nuevo'). */
export async function asegurarTablaPrestamosInternos(db: Db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS prestamos_internos_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ejercicio INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    prestamista TEXT NOT NULL,
    deudora TEXT NOT NULL,
    mes INTEGER NOT NULL DEFAULT 0,
    monto REAL NOT NULL DEFAULT 0,
    descripcion TEXT NOT NULL DEFAULT '',
    actualizado_en TEXT
  )`);
}

interface Corriente { contraparte: string; saldo: number; cambioMensual: number | null }
interface OficinaTI {
  agencia: string; corte: { anio: number; mes: number } | null;
  corrientes: Corriente[];          // + le deben (1908) / − debe (2908), por contraparte, sin préstamos
  prestamos1908: number; prestamos2908: number;
  corrientes1908: number; corrientes2908: number;  // saldos brutos (como el balance)
}
interface PrestamoTI {
  prestamista: string; deudora: string;
  saldoPresta: number; saldoRecibe: number;   // al corte, en los libros de cada una
  abono: number; abonoGuardado: boolean; abonoHistorico: number | null;
  nuevos: { id: number; mes: number; monto: number; descripcion: string }[];
}
interface DatosTI { ejercicio: number; tasa: number; tasaGuardada: boolean; oficinas: OficinaTI[]; prestamos: PrestamoTI[] }

/**
 * Lee la 1908 y la 2908 de las 10 oficinas (subcuentas del último corte cargado de cada una) y el plan de préstamos.
 * El abono por defecto de cada préstamo es lo que bajó entre el corte y la carga anterior (libros de la que presta).
 */
export async function leerTransferenciasInternas(db: Db, ejercicio: number): Promise<DatosTI> {
  await asegurarTablaPrestamosInternos(db);
  const [ag, cat, sal, plan, tasaR] = await Promise.all([
    db.execute(`SELECT id, nombre FROM agencias`),
    db.execute(`SELECT codigo, nombre FROM catalogo_cuentas WHERE codigo LIKE '1908%' OR codigo LIKE '2908%'`).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    db.execute(`SELECT agencia_id, anio, mes, cuenta_codigo, monto FROM saldos_iniciales WHERE cuenta_codigo LIKE '1908%' OR cuenta_codigo LIKE '2908%'`),
    db.execute({ sql: `SELECT * FROM prestamos_internos_plan WHERE ejercicio = ? ORDER BY mes, id`, args: [ejercicio] }),
    db.execute({ sql: `SELECT p.monto FROM otros_pasivo_parametros p JOIN agencias a ON a.id = p.agencia_id WHERE p.ejercicio = ? AND p.concepto = 'ingresos_tasa_prestamos_internos' AND a.nombre = 'Matriz' ORDER BY p.mes LIMIT 1`, args: [ejercicio] }).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  const nombreCod = new Map(cat.rows.map((r) => [String(r.codigo), String(r.nombre ?? "")]));
  const idDe = new Map(ag.rows.map((r) => [String(r.nombre), Number(r.id)]));
  // saldos por agencia y período
  const porAg = new Map<number, Map<string, Map<string, number>>>();
  for (const r of sal.rows) {
    const id = Number(r.agencia_id), per = `${r.anio}-${String(r.mes).padStart(2, "0")}`;
    const m = porAg.get(id) ?? new Map(); porAg.set(id, m);
    const s = m.get(per) ?? new Map<string, number>(); m.set(per, s);
    s.set(String(r.cuenta_codigo), Math.abs(Number(r.monto) || 0));
  }
  // hojas de 1908/2908 con su contraparte
  const hojas = (s: Map<string, number>) => {
    const cods = [...s.keys()].filter((k) => k.length > 6);
    return cods.filter((k) => !cods.some((o) => o !== k && o.startsWith(k))).map((k) => {
      const nom = nombreCod.get(k) ?? "";
      return { codigo: k, lado: k.startsWith("1908") ? "1908" : "2908", contraparte: contraparteDe(nom), prestamo: esPrestamo(nom), saldo: s.get(k) ?? 0 };
    });
  };
  const oficinas: OficinaTI[] = [];
  const presta = new Map<string, { saldo: number; hist: number | null }>(), recibe = new Map<string, number>();
  for (const nombre of OFICINAS) {
    const id = idDe.get(nombre) ?? (nombre === "Matriz" ? idDe.get("Oficina Matriz") : undefined);
    const pers = id !== undefined ? [...(porAg.get(id)?.keys() ?? [])].sort() : [];
    if (!pers.length) { oficinas.push({ agencia: nombre, corte: null, corrientes: [], prestamos1908: 0, prestamos2908: 0, corrientes1908: 0, corrientes2908: 0 }); continue; }
    // abono por defecto: lo que bajó cada préstamo entre el corte y la carga anterior (el abono del último mes)
    const per = pers[pers.length - 1], ini = pers.length > 1 ? pers[pers.length - 2] : null;
    const meses = ini ? (Number(per.slice(0, 4)) * 12 + Number(per.slice(5))) - (Number(ini.slice(0, 4)) * 12 + Number(ini.slice(5))) : 0;
    const h = hojas(porAg.get(id!)!.get(per)!), h0 = ini ? hojas(porAg.get(id!)!.get(ini)!) : [];
    const neto = (lista: typeof h, c: string, prest: boolean) => lista.filter((x) => x.contraparte === c && x.prestamo === prest).reduce((t, x) => t + (x.lado === "1908" ? x.saldo : -x.saldo), 0);
    const contrapartes = [...new Set(h.filter((x) => !x.prestamo && x.contraparte && x.contraparte !== nombre).map((x) => x.contraparte!))];
    const corrientes = contrapartes.map((c) => {
      const v = neto(h, c, false);
      return { contraparte: c, saldo: v, cambioMensual: meses > 0 ? (v - neto(h0, c, false)) / meses : null };
    }).filter((c) => Math.abs(c.saldo) >= 0.5);
    for (const x of h.filter((y) => y.prestamo && y.contraparte && y.saldo > 0)) {
      if (x.lado === "1908") {
        const antes = h0.filter((y) => y.prestamo && y.lado === "1908" && y.contraparte === x.contraparte).reduce((t, y) => t + y.saldo, 0);
        const k = `${nombre}|${x.contraparte}`, prev = presta.get(k);
        presta.set(k, { saldo: (prev?.saldo ?? 0) + x.saldo, hist: meses > 0 && antes > 0 ? Math.max(0, (antes - x.saldo) / meses) : null });
      } else {
        const k = `${x.contraparte}|${nombre}`; recibe.set(k, (recibe.get(k) ?? 0) + x.saldo);
      }
    }
    oficinas.push({ agencia: nombre, corte: { anio: Number(per.slice(0, 4)), mes: Number(per.slice(5)) }, corrientes,
      prestamos1908: h.filter((x) => x.prestamo && x.lado === "1908").reduce((t, x) => t + x.saldo, 0),
      prestamos2908: h.filter((x) => x.prestamo && x.lado === "2908").reduce((t, x) => t + x.saldo, 0),
      corrientes1908: h.filter((x) => !x.prestamo && x.lado === "1908").reduce((t, x) => t + x.saldo, 0),
      corrientes2908: h.filter((x) => !x.prestamo && x.lado === "2908").reduce((t, x) => t + x.saldo, 0) });
  }
  const filas = plan.rows.map((r) => ({ id: Number(r.id), tipo: String(r.tipo), prestamista: String(r.prestamista), deudora: String(r.deudora), mes: Number(r.mes), monto: Number(r.monto) || 0, descripcion: String(r.descripcion ?? "") }));
  const pares = [...new Set([...presta.keys(), ...recibe.keys(), ...filas.filter((f) => f.tipo === "nuevo").map((f) => `${f.prestamista}|${f.deudora}`)])];
  const prestamos = pares.map((k) => {
    const [prestamista, deudora] = k.split("|");
    const g = filas.find((f) => f.tipo === "abono" && f.prestamista === prestamista && f.deudora === deudora);
    const hist = presta.get(k)?.hist ?? null;
    return {
      prestamista, deudora, saldoPresta: presta.get(k)?.saldo ?? 0, saldoRecibe: recibe.get(k) ?? 0,
      abono: g ? g.monto : Math.round(hist ?? 0), abonoGuardado: !!g, abonoHistorico: hist,
      nuevos: filas.filter((f) => f.tipo === "nuevo" && f.prestamista === prestamista && f.deudora === deudora).map((f) => ({ id: f.id, mes: f.mes, monto: f.monto, descripcion: f.descripcion })),
    };
  }).sort((a, b) => OFICINAS.indexOf(a.prestamista) - OFICINAS.indexOf(b.prestamista) || b.saldoPresta - a.saldoPresta);
  const tasaG = tasaR.rows[0] ? Number(tasaR.rows[0].monto) : null;
  return { ejercicio, tasa: tasaG ?? TASA_PRESTAMOS_INTERNOS, tasaGuardada: tasaG !== null, oficinas, prestamos };
}

export const transferenciasInternas = (db: Db, ejercicio: number) => conCache(`transferencias-internas-${ejercicio}`, () => leerTransferenciasInternas(db, ejercicio));

const nuevosPorMes = (p: PrestamoTI) => { const v = cero(); for (const n of p.nuevos) if (n.mes >= 1 && n.mes <= 12) v[n.mes - 1] += n.monto; return v; };
/** Proyección de un préstamo desde los libros de una de las dos oficinas. */
export function proyectarPrestamoTI(p: PrestamoTI, lado: "presta" | "recibe", tasa: number[], ejercicio: number) {
  const s0 = lado === "presta" ? p.saldoPresta : p.saldoRecibe;
  const nv = nuevosPorMes(p);
  const r = proyectarPrestamo(s0, p.abono, nv);
  return { saldoCorte: s0, ...r, nuevos: nv, ...interesPrestamo(s0, r.saldo, tasa, ejercicio) };
}

/** Lo que el motor necesita de una oficina: saldos de lo prestado y lo recibido, abonos y préstamos nuevos de cada mes. */
export async function prestamosDeAgencia(db: Db, agencia: string, ejercicio: number): Promise<PrestamosAgencia> {
  const d = await transferenciasInternas(db, ejercicio);
  const t = Array(12).fill(d.tasa);
  const suma = (lista: ReturnType<typeof proyectarPrestamoTI>[], k: "saldo" | "abonos" | "nuevos" | "interes") => Array.from({ length: 12 }, (_, i) => lista.reduce((s, x) => s + x[k][i], 0));
  const pr = d.prestamos.filter((p) => p.prestamista === agencia).map((p) => proyectarPrestamoTI(p, "presta", t, ejercicio));
  const re = d.prestamos.filter((p) => p.deudora === agencia).map((p) => proyectarPrestamoTI(p, "recibe", t, ejercicio));
  return {
    prestadoCorte: pr.reduce((s, x) => s + x.saldoCorte, 0), prestadoSaldo: suma(pr, "saldo"), cobrado: suma(pr, "abonos"), otorgado: suma(pr, "nuevos"), interesCobrado: suma(pr, "interes"),
    recibidoCorte: re.reduce((s, x) => s + x.saldoCorte, 0), recibidoSaldo: suma(re, "saldo"), pagado: suma(re, "abonos"), recibido: suma(re, "nuevos"), interesPagado: suma(re, "interes"), tasa: d.tasa,
  };
}
