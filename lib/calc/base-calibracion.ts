/**
 * ACTUALIZAR LA BASE DE CALIBRACIÓN (panel de diciembre)
 *
 * La base son los meses reales con los que se ajusta el modelo de provisión al gasto real (hoy jul–oct 2026).
 * Al cargar cortes nuevos (nov, dic) se comparan varias bases lado a lado con el mismo motor y se recomienda una
 * con reglas fijas, para que el presupuesto no cambie de forma brusca:
 *   · un mes es atípico si su gasto neto de provisión o sus castigos se alejan más de 1,5 veces de la mediana
 *     de los meses comparados (o el gasto es negativo); una base que suma un mes nuevo atípico no se recomienda;
 *   · una base nueva se recomienda solo si, frente a la base aprobada, el gasto de provisión de la cooperativa
 *     cambia hasta 10 %, la morosidad de diciembre hasta 1 punto y ninguna agencia más de 25 %;
 *   · entre las que cumplen, la de más meses; si ninguna cumple, se mantiene la base aprobada.
 * La decisión es del usuario: el panel muestra todas y solo guarda la que se elija.
 */

export const LIMITE_CAMBIO_COOP = 0.10;
export const LIMITE_CAMBIO_AGENCIA = 0.25;
export const LIMITE_MORA_PUNTOS = 0.01;
export const FACTOR_ATIPICO = 1.5;
/** Mismo límite que los controles de Integridad (LIMITE_RAZONABLE y LIMITE_MEJORAS de lib/control-provision.ts). */
export const LIMITE_RAZONABLE_BASE = 0.30;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;
export const nombreVentana = (desde: string, hasta: string) =>
  desde.slice(0, 4) === hasta.slice(0, 4)
    ? `${MESES[Number(desde.slice(5, 7)) - 1]}–${MESES[Number(hasta.slice(5, 7)) - 1]} ${hasta.slice(0, 4)}`
    : `${nombreMes(desde)} a ${nombreMes(hasta)}`;

const indice = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
const periodo = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const mesesEntre = (desde: string, hasta: string) => indice(hasta) - indice(desde) + 1;
export const sumarMeses = (p: string, n: number) => periodo(indice(p) + n);

export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface MesSerie { p: string; gasto: number | null; castigos: number | null }
export interface MesAtipico { p: string; motivos: string[] }

/** Meses atípicos de la serie de la cooperativa (se necesitan al menos 3 meses para comparar). */
export function mesesAtipicos(serie: MesSerie[]): MesAtipico[] {
  const out: MesAtipico[] = [];
  const revisar = (campo: "gasto" | "castigos", nombre: string) => {
    const vals = serie.map((m) => m[campo]).filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length < 3) return;
    const med = mediana(vals);
    if (med === null || med <= 0) return;
    for (const m of serie) {
      const v = m[campo];
      if (v === null || !Number.isFinite(v)) continue;
      let motivo: string | null = null;
      if (v < 0) motivo = `${nombre} negativo`;
      else if (v > med * FACTOR_ATIPICO) motivo = `${nombre} ${(v / med).toFixed(1).replace(".", ",")} veces la mediana`;
      else if (v < med / FACTOR_ATIPICO) motivo = `${nombre} muy por debajo de la mediana`;
      if (!motivo) continue;
      const x = out.find((o) => o.p === m.p) ?? (out.push({ p: m.p, motivos: [] }), out[out.length - 1]);
      x.motivos.push(motivo);
    }
  };
  revisar("gasto", "Gasto de provisión");
  revisar("castigos", "Castigos");
  return out.sort((a, b) => a.p.localeCompare(b.p));
}

export interface BaseCandidata { id: "A" | "B" | "C" | "D"; nombre: string; desde: string; hasta: string; meses: number; nuevosAtipicos: string[] }

/**
 * Bases a comparar: A la aprobada; B la aprobada más los meses nuevos; D los últimos meses (mismo número que A);
 * C la B sin el último mes cuando ese mes es atípico. Sin meses nuevos solo queda A.
 */
export function basesCandidatas(base: { desde: string; hasta: string }, ultimo: string | null, atipicos: string[]): BaseCandidata[] {
  const at = new Set(atipicos);
  const nuevosAt = (desde: string, hasta: string) => {
    const r: string[] = [];
    for (let i = indice(desde); i <= indice(hasta); i++) { const p = periodo(i); if (p > base.hasta && at.has(p)) r.push(p); }
    return r;
  };
  const mk = (id: BaseCandidata["id"], nombre: string, desde: string, hasta: string): BaseCandidata =>
    ({ id, nombre, desde, hasta, meses: mesesEntre(desde, hasta), nuevosAtipicos: nuevosAt(desde, hasta) });
  const out = [mk("A", "Base aprobada", base.desde, base.hasta)];
  if (!ultimo || ultimo <= base.hasta) return out;
  out.push(mk("B", "Con los meses nuevos", base.desde, ultimo));
  const n = mesesEntre(base.desde, base.hasta), dDesde = sumarMeses(ultimo, -(n - 1));
  if (dDesde > base.desde) out.push(mk("D", `Últimos ${n} meses`, dDesde, ultimo));
  const sinUltimo = sumarMeses(ultimo, -1);
  if (at.has(ultimo) && sinUltimo > base.hasta) out.push(mk("C", "Sin el último mes", base.desde, sinUltimo));
  return out;
}

export interface ResultadoBase {
  id: BaseCandidata["id"];
  /** Gasto neto de provisión presupuestado al mes (cooperativa). */
  pres: number; mora: number | null; util: number;
  /** Por agencia, al mes: presupuesto, gasto real de la base y gasto sin las mejoras (comportamiento real). */
  agencias: { a: string; pres: number | null; real?: number | null; sinMejoras?: number | null }[];
}
export interface Evaluacion { cambio: number | null; cambioMora: number | null; agenciasFuera: string[]; fueraControles: string[]; dentro: boolean; motivos: string[] }

/**
 * Agencias que con esta base quedarían fuera de los controles de Integridad (los mismos límites):
 * presupuesto a más de ±30 % del real de la base, o metas que bajan la provisión más de 30 %.
 */
export function fueraDeControles(r: ResultadoBase): string[] {
  return r.agencias.filter((x) => {
    if (x.pres === null) return false;
    const raz = x.real ? Math.abs(x.pres / x.real - 1) > LIMITE_RAZONABLE_BASE : false;
    const mej = x.sinMejoras && x.sinMejoras > 0 ? 1 - x.pres / x.sinMejoras > LIMITE_RAZONABLE_BASE : false;
    return raz || mej;
  }).map((x) => x.a);
}

/** Cambio de una base frente a la aprobada y si queda dentro de los límites. */
export function evaluarBase(r: ResultadoBase, aprobada: ResultadoBase, c: BaseCandidata): Evaluacion {
  const cambio = aprobada.pres ? r.pres / aprobada.pres - 1 : null;
  const cambioMora = r.mora !== null && aprobada.mora !== null ? r.mora - aprobada.mora : null;
  const agenciasFuera = r.agencias.filter((x) => {
    const a = aprobada.agencias.find((y) => y.a === x.a)?.pres;
    return x.pres !== null && a ? Math.abs(x.pres / a - 1) > LIMITE_CAMBIO_AGENCIA : false;
  }).map((x) => x.a);
  // solo las que salen de los controles por la nueva base (las que ya estaban fuera con la aprobada se ven en Integridad)
  const yaFuera = new Set(fueraDeControles(aprobada));
  const fueraControles = fueraDeControles(r).filter((a) => !yaFuera.has(a));
  const motivos: string[] = [];
  if (cambio !== null && Math.abs(cambio) > LIMITE_CAMBIO_COOP) motivos.push(`la provisión de la cooperativa cambia más de ${LIMITE_CAMBIO_COOP * 100} %`);
  if (cambioMora !== null && Math.abs(cambioMora) > LIMITE_MORA_PUNTOS) motivos.push(`la morosidad de diciembre cambia más de ${LIMITE_MORA_PUNTOS * 100} punto`);
  if (agenciasFuera.length) motivos.push(`${agenciasFuera.join(", ")} cambia${agenciasFuera.length > 1 ? "n" : ""} más de ${LIMITE_CAMBIO_AGENCIA * 100} %`);
  if (fueraControles.length) motivos.push(`${fueraControles.join(", ")} quedaría${fueraControles.length > 1 ? "n" : ""} fuera de los controles de provisión`);
  if (c.nuevosAtipicos.length) motivos.push(`incluye ${c.nuevosAtipicos.map(nombreMes).join(", ")} (atípico)`);
  return { cambio, cambioMora, agenciasFuera, fueraControles, dentro: !motivos.length, motivos };
}

/** Base recomendada: la de más meses que cumple los límites; si ninguna, la aprobada. */
export function recomendarBase(cands: BaseCandidata[], res: ResultadoBase[]): { id: BaseCandidata["id"]; motivo: string } {
  const aprobada = res.find((r) => r.id === "A");
  if (!aprobada || cands.length < 2) return { id: "A", motivo: "No hay meses nuevos después de la base aprobada." };
  const ok = cands.filter((c) => c.id !== "A").map((c) => ({ c, r: res.find((r) => r.id === c.id) }))
    .filter((x): x is { c: BaseCandidata; r: ResultadoBase } => !!x.r)
    .map((x) => ({ ...x, e: evaluarBase(x.r, aprobada, x.c) }));
  const elegible = ok.filter((x) => x.e.dentro).sort((a, b) => b.c.meses - a.c.meses || b.c.hasta.localeCompare(a.c.hasta))[0];
  if (elegible) return { id: elegible.c.id, motivo: `${elegible.c.nombre} (${nombreVentana(elegible.c.desde, elegible.c.hasta)}): usa más meses reales y el cambio queda dentro de los límites.` };
  return { id: "A", motivo: "Mantener la base aprobada: ninguna base nueva queda dentro de todos los límites (observaciones arriba). Si se decide cambiar, revise primero las agencias marcadas." };
}

// ---------------------------------------------------------------------
// Gasto neto real de la base (estado de resultados acumulado por año)
// ---------------------------------------------------------------------
export interface FilaER { oficina: string; periodo: string; codigo: string; valor: number }
export interface RealOficina { valor: number; mes: number; meses: number; g4402: number; i5104: number; ratio: number | null }

/**
 * Gasto neto de provisión real (4402 − 5604.10) de cada oficina en los meses de la base, llevado a 12 meses,
 * y la provisión 4402 frente al interés de cartera 5104. El estado de resultados viene acumulado desde enero,
 * así que cada año se mide como (acumulado al último mes − acumulado al mes anterior al primero); una base que
 * cruza de año (oct-26 a ene-27) suma los dos tramos. Llega hasta el último mes cargado dentro de la base.
 */
export function realDeLaBase(filas: FilaER[], desde: string, hasta: string): { porOficina: Record<string, RealOficina>; hasta: string | null } {
  const ac = new Map<string, Map<string, { g: number; r: number; i: number }>>();
  for (const x of filas) {
    const m = ac.get(x.oficina) ?? new Map(); ac.set(x.oficina, m);
    const v = m.get(x.periodo) ?? { g: 0, r: 0, i: 0 }; m.set(x.periodo, v);
    if (x.codigo === "4402") v.g = x.valor; else if (x.codigo === "5104") v.i = x.valor; else if (x.codigo === "560410") v.r = x.valor;
  }
  const porOficina: Record<string, RealOficina> = {};
  let hastaMax: string | null = null;
  for (const [of, m] of ac) {
    const fin = [...m.keys()].filter((p) => p >= desde && p <= hasta).sort().pop();
    if (!fin) continue;
    let g = 0, r = 0, i = 0, ok = true;
    for (let y = Number(desde.slice(0, 4)); y <= Number(fin.slice(0, 4)) && ok; y++) {
      const ini = y === Number(desde.slice(0, 4)) ? Number(desde.slice(5, 7)) : 1;
      const fp = y === Number(fin.slice(0, 4)) ? fin : `${y}-12`;
      const f = m.get(fp), b = ini > 1 ? m.get(`${y}-${String(ini - 1).padStart(2, "0")}`) : { g: 0, r: 0, i: 0 };
      if (!f || !b) { ok = false; break; }
      g += f.g - b.g; r += f.r - b.r; i += f.i - b.i;
    }
    if (!ok) continue;
    const n = mesesEntre(desde, fin);
    porOficina[of] = { valor: (g - r) * 12 / n, mes: Number(fin.slice(5, 7)), meses: n, g4402: g, i5104: i, ratio: i > 0 ? g / i : null };
    if (!hastaMax || fin > hastaMax) hastaMax = fin;
  }
  return { porOficina, hasta: hastaMax };
}
