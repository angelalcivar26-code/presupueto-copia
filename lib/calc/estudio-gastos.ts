/**
 * 45 · GASTOS DE OPERACIÓN en el Estudio de agencia.
 *
 * Realidad: estado de resultados de la agencia (acumulado → valor del mes) por grupo (4501 … 4507) y subcuenta.
 * Supuestos del presupuesto:
 *   - Incremento salarial: Talento Humano (nomina_empleados.incremento_pct de los empleados de la agencia).
 *   - Gasto mensual de cada subcuenta cargada en el presupuesto departamental (las que calcula la herramienta
 *     —depreciaciones, amortizaciones, suministros, SEPS, COSEDE— no se editan aquí).
 * Un cambio en una subcuenta no toca las filas cargadas (ni las prorrateadas): se guarda como un ajuste mensual
 * en el departamento "Estudio de agencia" (gasto directo de la agencia), igual en los 12 meses.
 */
import { cuentaCalculada } from "./cuentas-calculadas";
import { delMes, type HistoricoEstudio } from "./estudio-agencia";
import type { FilaEmpleadoNomina, FilaPresupuestoDepartamental } from "./orquestador";

export const DEP_ESTUDIO = "Estudio de agencia";
export const GRUPOS_45 = [
  { k: "4501", n: "Gastos de personal" },
  { k: "4502", n: "Honorarios" },
  { k: "4503", n: "Servicios varios" },
  { k: "4504", n: "Impuestos, contribuciones y multas" },
  { k: "4505", n: "Depreciaciones" },
  { k: "4506", n: "Amortizaciones" },
  { k: "4507", n: "Otros gastos" },
] as const;
// eficiencia como la del motor: gasto de operación ÷ (ingresos − intereses y comisiones causados)
const MARGEN_MAS = ["51", "52", "53", "54", "55", "56"], MARGEN_MENOS = ["41", "42"];

/** Filas del presupuesto departamental de la agencia (cuentas 45), con su modo (directo o prorrateado). */
export interface FilaDep { departamento: string; concepto: string; cuenta_nombre: string | null; mes: number; monto: number; modo: string }

export interface MesGasto { p: string; total: number; grupos: number[]; sub: Record<string, number>; margen: number | null }
interface AnioGasto { anio: number; meses: number; total: number; personal: number; generales: number; eficiencia: number | null }
interface RealidadGastos {
  anio: number; meses: MesGasto[]; ventana: MesGasto[]; anual: AnioGasto[];
  /** promedio mensual del período por subcuenta (6 dígitos) y por grupo */
  sub: Record<string, number>; grupos: number[]; total: number;
  /** crecimiento del gasto de personal frente a los mismos meses del año anterior */
  crecPersonal: number | null;
  eficiencia: number | null;
}

const d6 = (c: string) => c.replace(/\D/g, "").slice(0, 6);

export function calcularRealidadGastos(h: HistoricoEstudio): RealidadGastos | null {
  const periodos = Object.keys(h.er).filter((p) => (h.er[p]?.["45"] ?? 0) !== 0 || GRUPOS_45.some((g) => h.er[p]?.[g.k])).sort();
  const meses: MesGasto[] = [];
  for (const p of periodos) {
    const v = (k: string) => delMes(h.er, p, k);
    const grupos = GRUPOS_45.map((g) => v(g.k));
    if (grupos.every((x) => x === null)) continue;
    const gs = grupos.map((x) => x ?? 0);
    const tot = v("45");
    const sub: Record<string, number> = {};
    for (const k of Object.keys(h.er[p] ?? {})) if (k.length === 6 && k.startsWith("45")) sub[k] = v(k) ?? 0;
    const mas = MARGEN_MAS.map(v), menos = MARGEN_MENOS.map(v);
    const margen = mas.some((x) => x !== null) ? mas.reduce<number>((a, x) => a + (x ?? 0), 0) - menos.reduce<number>((a, x) => a + (x ?? 0), 0) : null;
    meses.push({ p, total: tot ?? gs.reduce((a, x) => a + x, 0), grupos: gs, sub, margen });
  }
  if (!meses.length) return null;
  const ult = meses[meses.length - 1], anio = Number(ult.p.slice(0, 4));
  let ventana = meses.filter((m) => m.p.startsWith(`${anio}-`));
  if (ventana.length < 3) ventana = meses.slice(-12);
  const n = ventana.length;
  const sub: Record<string, number> = {};
  for (const m of ventana) for (const [k, x] of Object.entries(m.sub)) sub[k] = (sub[k] ?? 0) + x / n;
  const grupos = GRUPOS_45.map((_, i) => ventana.reduce((t, m) => t + m.grupos[i], 0) / n);
  const total = ventana.reduce((t, m) => t + m.total, 0) / n;
  // mismos meses del año anterior
  const ant = ventana.map((m) => meses.find((x) => x.p === `${Number(m.p.slice(0, 4)) - 1}${m.p.slice(4)}`));
  const crecPersonal = ant.every((x) => x) && ant.reduce((t, x) => t + x!.grupos[0], 0) > 0
    ? ventana.reduce((t, m) => t + m.grupos[0], 0) / ant.reduce((t, x) => t + x!.grupos[0], 0) - 1 : null;
  const efi = (ms: MesGasto[]) => { const mg = ms.reduce((t, m) => t + (m.margen ?? 0), 0); return ms.some((m) => m.margen !== null) && mg > 0 ? ms.reduce((t, m) => t + m.total, 0) / mg : null; };
  const anios = [...new Set(meses.map((m) => Number(m.p.slice(0, 4))))].sort();
  const anual = anios.map((y) => {
    const ms = meses.filter((m) => m.p.startsWith(`${y}-`)), t = ms.reduce((a, m) => a + m.total, 0), pe = ms.reduce((a, m) => a + m.grupos[0], 0);
    return { anio: y, meses: ms.length, total: t, personal: pe, generales: t - pe, eficiencia: efi(ms) };
  });
  return { anio, meses, ventana, anual, sub, grupos, total, crecPersonal, eficiencia: efi(ventana) };
}

/** Supuestos de una versión: incremento salarial y gasto mensual de cada subcuenta editable. */
export interface VersionGastos { inc: number; sub: Record<string, number> }

/** Subcuentas que se pueden ajustar: no las calcula la herramienta. */
export const editable = (k: string) => k.startsWith("45") && !cuentaCalculada(k);

export function versionPresGastos(dep: FilaDep[], empleados: FilaEmpleadoNomina[]): VersionGastos {
  const sub: Record<string, number> = {};
  for (const f of dep) { const k = d6(f.concepto); if (k.length === 6 && editable(k)) sub[k] = (sub[k] ?? 0) + (Number(f.monto) || 0) / 12; }
  const inc = empleados.length ? empleados.reduce((t, e) => t + (Number(e.incremento_pct) || 0), 0) / empleados.length : 0;
  return { inc, sub };
}

/** Ritmo real: el gasto mensual promedio del período en cada subcuenta; el incremento salarial, el del presupuesto. */
export function versionRealGastos(pres: VersionGastos, real: RealidadGastos): VersionGastos {
  const sub: Record<string, number> = { ...pres.sub };
  for (const k of Object.keys(real.sub)) if (editable(k) && !k.startsWith("4501")) sub[k] = Math.max(0, real.sub[k]);
  // personal: solo las subcuentas que el presupuesto carga a mano (horas extras, capacitación…); la nómina sale de Talento Humano
  for (const k of Object.keys(pres.sub)) if (k.startsWith("4501") && real.sub[k] !== undefined) sub[k] = Math.max(0, real.sub[k]);
  return { inc: pres.inc, sub };
}

/** Ajuste mensual de cada subcuenta que cambia (lo nuevo − lo del presupuesto), igual en los 12 meses. */
export function ajustesGastos(pres: VersionGastos, v: VersionGastos): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(pres.sub), ...Object.keys(v.sub)])) {
    const d = (v.sub[k] ?? 0) - (pres.sub[k] ?? 0);
    if (Math.abs(d) > 0.005) out[k] = d;
  }
  return out;
}

/** Insumos del motor con la versión: filas del presupuesto + ajustes, y el incremento salarial en la nómina. */
export function insumosGastos(filas: FilaPresupuestoDepartamental[], empleados: FilaEmpleadoNomina[], pres: VersionGastos, v: VersionGastos, nombres: Record<string, string>) {
  const aj = ajustesGastos(pres, v);
  const filasN = Object.keys(aj).length
    ? [...filas, ...Object.entries(aj).flatMap(([k, d]) => Array.from({ length: 12 }, (_, i) => ({ departamento: DEP_ESTUDIO, concepto: k, cuenta_nombre: nombres[k] ?? null, mes: i + 1, monto: d })))]
    : filas;
  const cambiaInc = Math.abs(v.inc - pres.inc) > 1e-9;
  const empleadosN = cambiaInc ? empleados.map((e) => ({ ...e, incremento_pct: v.inc })) : empleados;
  return { filas: filasN, empleados: empleadosN, aj, cambiaInc };
}

/**
 * Filas a guardar en el departamento "Estudio de agencia": el ajuste que ya tenía la agencia + el nuevo, por mes.
 * Una subcuenta que vuelve a su valor original queda sin filas.
 */
export function filasEstudioGastos(dep: FilaDep[], aj: Record<string, number>, nombres: Record<string, string>) {
  const previo: Record<string, number[]> = {};
  for (const f of dep) if (f.departamento === DEP_ESTUDIO) { const k = d6(f.concepto); (previo[k] ??= Array(12).fill(0))[f.mes - 1] += Number(f.monto) || 0; }
  return Object.entries(aj).map(([k, d]) => {
    const montos = (previo[k] ?? Array(12).fill(0)).map((x) => Math.round((x + d) * 100) / 100);
    return { concepto: k, cuenta_nombre: nombres[k] ?? null, montos: montos.every((x) => Math.abs(x) < 0.005) ? null : montos };
  });
}
