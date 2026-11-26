"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../../lib/useDatos";
import { useEstadoSincronizacion } from "../../lib/cache-sistema";
import {
  calibrar, correr, real, escHist, escPres, escProp, planMeta, distribucion, activos, tasaInterna, nombreCuenta, GRUPOS_GASTO, PROD,
  type Mundo, type Agencia, type Pal, type Corrida, type Ajustes, type ClavePal, type EntradaAgencia,
} from "../../lib/calc/plan2027";
import { conectarMotor, sumarCorridas, mundoModelo } from "../../lib/calc/plan-motor";
import type { PaqueteMotor } from "../../lib/calc/paquete-motor";
import { usd, mill, pc, per, type DatosPlanificacion } from "./Comun";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * Piezas comunes de Metas por agencia, Plan de la agencia y Simulador (modelo integrado):
 * armado del "mundo" (todas las oficinas calibradas), escenarios de una agencia y tablas compartidas.
 */
export const sgn = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
export const num1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
export const ent = (v: number) => String(Math.round(v));
export const fpts = (x: number) => num1(x * 100) + " pts";
export const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const ORDEN_OFICINAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

/** cumplMeta: cumplimiento de la meta de colocación en los escenarios propuestos (null = el observado). */
export interface ConfigModelo { metaInst: number; cumplMeta: number | null; ajustes: Record<string, Ajustes> }
export const OPCIONES_CUMPL: [number | null, string][] = [[null, "Observado"], [0.8, "80 %"], [0.9, "90 %"], [1, "100 %"]];

/** Todas las oficinas calibradas con sus históricos, asesores, metas y parámetros del presupuesto. */
export function construirMundo(d: DatosPlanificacion, paquetes: Record<string, PaqueteMotor | null> = {}): Mundo {
  const metas = d.metasAsesor ?? [110000, 125000, 135000];
  const par = d.parametros ?? {};
  const mixCons = [0, 1, 2].map((i) => Object.entries(par).reduce((t, [a, p]) => t + (a === "Consolidado" ? 0 : p.mix[i]), 0)) as [number, number, number];
  // Consolidado: parámetros promedio de las agencias
  const credCons: EntradaAgencia["credito"] = {};
  for (const p of PROD) {
    const v = Object.values(par).map((x) => x.credito[p]).filter((x): x is NonNullable<typeof x> => !!x);
    if (v.length) credCons[p] = { tasa: v.reduce((t, x) => t + x.tasa, 0) / v.length, pctRec: v.reduce((t, x) => t + x.pctRec, 0) / v.length, efect: v.reduce((t, x) => t + x.efect, 0) / v.length, recVenc: v.reduce((t, x) => t + x.recVenc, 0) / v.length, dist: v.some((x) => x.dist === null) ? null : v.reduce((t, x) => t + (x.dist ?? 0), 0) / v.length };
  }
  const ags: Record<string, Agencia> = {};
  for (const [o, base] of Object.entries(d.bases)) {
    const p = par[o], cons = o === "Consolidado";
    const A = calibrar(o, {
      base, mix: cons ? mixCons : p?.mix ?? [0, 0, 0], credito: cons ? credCons : (p?.credito ?? {}) as EntradaAgencia["credito"],
      vistaNeto: cons ? null : p?.vistaNeto ?? null, capt13: (d.trayectoria[o] ?? []).slice(-13).map((x) => x.capt),
    }, metas);
    if (A) ags[o] = A;
  }
  const M: Mundo = { ags, sup: { costoAsesor: d.config.costoAsesor ?? 16000, infl: d.config.infl ?? 0.03, incSal: d.config.incSal ?? 0.03 } };
  // todos los escenarios de cada agencia corren con el motor del presupuesto
  return conectarMotor(M, paquetes);
}

// ---------------------------------------------------------------------
// Escenarios de una agencia
// ---------------------------------------------------------------------
export type Familia = "hist" | "pres" | "prop" | "guard" | "mod";
export interface Escenario { k: string; n: string; fam: Familia; L: Pal; R: Corrida; desc: string; falta?: number; id?: number; estado?: string; autor?: string | null; replica?: number }
export const COLOR_FAM: Record<Familia, string> = { hist: "#7A847F", pres: "#2F5D8A", prop: "#005A28", guard: "#9A6A1F", mod: "#1F6F78" };
const DESC: Record<string, string> = {
  get hist() { return `El presupuesto ${ejercicioEnUso()} si todo sigue como en los últimos 12 meses (cobro, recuperación, captación y colocación reales)`; },
  pres: "Con los parámetros cargados en el presupuesto",
  cons: "Parte del presupuesto y lo acerca a medio camino de la tendencia donde la tendencia es peor",
  medio: "Parte del presupuesto y avanza un tercio hacia el optimista",
  opt: "Parte del presupuesto y llega a lo que logra el 25 % mejor de la cooperativa (nunca peor que el presupuesto)",
  meta: "Parte del presupuesto y mejora lo mínimo para cumplir la parte que le toca de la meta",
};
export function repartoDe(M: Mundo, cfg: ConfigModelo) { return distribucion(M, cfg.metaInst, cfg.ajustes, cfg.cumplMeta); }
export function metaDe(M: Mundo, cfg: ConfigModelo, ag: string, D = repartoDe(M, cfg)) { return ag === "Consolidado" ? D.metaU : D.filas.find((r) => r.a === ag)?.asign ?? 0; }

export function escenariosDe(M: Mundo, ag: string, cfg: ConfigModelo, guardados: DatosPlanificacion["escenarios"], D = repartoDe(M, cfg)): Escenario[] {
  if (ag === "Consolidado") return escenariosConsolidado(M, cfg, D);
  const A = M.ags[ag], aj = cfg.ajustes[ag];
  const pm = planMeta(M, A, metaDe(M, cfg, ag, D), aj, cfg.cumplMeta);
  const base: Omit<Escenario, "R">[] = [
    { k: "hist", n: `Tendencia ${A.base.periodo.slice(0, 4)}`, fam: "hist", L: escHist(M, A), desc: DESC.hist },
    { k: "pres", n: "Presupuestado", fam: "pres", L: escPres(M, A), desc: DESC.pres },
    { k: "cons", n: "Conservador", fam: "prop", L: escProp(M, A, "cons", aj, cfg.cumplMeta), desc: DESC.cons },
    { k: "medio", n: "Medio", fam: "prop", L: escProp(M, A, "medio", aj, cfg.cumplMeta), desc: DESC.medio },
    { k: "opt", n: "Optimista", fam: "prop", L: escProp(M, A, "opt", aj, cfg.cumplMeta), desc: DESC.opt },
    { k: "meta", n: "Meta asignada", fam: "prop", L: pm.X, desc: DESC.meta, falta: pm.falta },
    ...guardados.filter((g) => g.agencia === ag && g.palancas && "e" in g.palancas).map((g) => ({
      k: "g" + g.id, n: g.nombre, fam: "guard" as const, L: g.palancas as unknown as Pal, desc: `Escenario guardado · ${g.estado}${g.autor ? ` · ${g.autor}` : ""}`, id: g.id, estado: g.estado, autor: g.autor,
    })),
  ];
  return base.map((e) => ({ ...e, R: correr(M, A, e.L) }));
}

// ---------------------------------------------------------------------
// Propuesta del modelo (independiente del presupuesto)
// ---------------------------------------------------------------------
type MundoModelo = ReturnType<typeof mundoModelo>;
/** Los ajustes del modelo se guardan junto a los del presupuesto, con su propia clave (mcons, mmedio, mopt). */
const ajModelo = (aj?: Ajustes): Ajustes => ({ ...(aj?.mcons ? { cons: aj.mcons } : {}), ...(aj?.mmedio ? { medio: aj.mmedio } : {}), ...(aj?.mopt ? { opt: aj.mopt } : {}) });
const NOMBRE_MOD: Record<string, string> = { tend: "Tendencia", cons: "Conservador", medio: "Medio", opt: "Optimista" };
/** Escenarios de la propuesta del modelo: tendencia (hoy, sin cambios), conservador, medio y optimista; el presupuestado como referencia. */
export function escenariosModelo(M2: MundoModelo, ag: string, cfg: ConfigModelo, pres: Escenario | undefined): Escenario[] {
  let lista: Escenario[];
  if (ag === "Consolidado") {
    const porAg = Object.keys(M2.motor ?? {}).map((a) => escenariosModelo(M2, a, cfg, undefined));
    const A = M2.ags.Consolidado;
    lista = (["tend", "cons", "medio", "opt"] as const).map((k) => ({
      k: "m" + k, n: NOMBRE_MOD[k], fam: "mod" as const, desc: "",
      L: k === "tend" ? escHist(M2, A) : escProp(M2, A, k, undefined, cfg.cumplMeta),
      R: sumarCorridas(porAg.map((E) => E.find((e) => e.k === "m" + k)!.R)),
    }));
  } else {
    const A = M2.ags[ag], aj = ajModelo(cfg.ajustes[ag]);
    lista = (["tend", "cons", "medio", "opt"] as const).map((k) => {
      const L = k === "tend" ? escHist(M2, A) : escProp(M2, A, k, aj, cfg.cumplMeta);
      return { k: "m" + k, n: NOMBRE_MOD[k], fam: "mod" as const, desc: "", L, R: correr(M2, A, L) };
    });
  }
  return pres ? [lista[0], { ...pres, n: "Presupuestado" }, ...lista.slice(1)] : lista;
}

/** Consolidado: cada escenario es la suma de los de las agencias (cada una con su motor). */
function escenariosConsolidado(M: Mundo, cfg: ConfigModelo, D: ReturnType<typeof repartoDe>): Escenario[] {
  const A = M.ags.Consolidado, ags = Object.keys(M.motor ?? {});
  const porAg = ags.map((a) => escenariosDe(M, a, cfg, [], D));
  const suma = (k: string) => sumarCorridas(porAg.map((E) => E.find((e) => e.k === k)!.R));
  const L: Record<string, Pal> = { hist: escHist(M, A), pres: escPres(M, A), cons: escProp(M, A, "cons", undefined, cfg.cumplMeta), medio: escProp(M, A, "medio", undefined, cfg.cumplMeta), opt: escProp(M, A, "opt", undefined, cfg.cumplMeta) };
  L.meta = L.opt;
  const falta = porAg.reduce((t, E) => t + (E.find((e) => e.k === "meta")?.falta ?? 0), 0);
  return (["hist", "pres", "cons", "medio", "opt", "meta"] as const).map((k) => ({
    k, n: { hist: `Tendencia ${A.base.periodo.slice(0, 4)}`, pres: "Presupuestado", cons: "Conservador", medio: "Medio", opt: "Optimista", meta: "Meta asignada" }[k],
    fam: k === "hist" ? "hist" : k === "pres" ? "pres" : "prop", L: L[k], R: suma(k), desc: DESC[k], ...(k === "meta" ? { falta } : {}),
  }));
}

// ---------------------------------------------------------------------
// Piezas visuales
// ---------------------------------------------------------------------
/** Diferencia con color: mejor = 1 subir es bueno, −1 bajar es bueno, 0 neutro. */
export function Dif({ a, b, mejor = 1, f = usd, umbral }: { a: number; b: number; mejor?: number; f?: (v: number) => string; umbral?: number }) {
  const x = b - a, u = umbral ?? (f === usd ? 0.5 : 1e-6);
  if (Math.abs(x) < u) return <span className="dim">—</span>;
  return <span className={!mejor ? "neu" : x * mejor > 0 ? "up" : "dn"}>{sgn(x)}{f(Math.abs(x))}</span>;
}
export function Chip({ e, children }: { e: "ok" | "avi" | "mal"; children: ReactNode }) { return <span className={`chip ${e}`}>{children}</span>; }
export function Semaforo({ u, meta }: { u: number; meta: number }) {
  const e = u >= meta - 1 ? "ok" : u >= meta - Math.abs(meta) * 0.25 - 20000 ? "avi" : "mal";
  return <Chip e={e}>{e === "ok" ? "cumple la meta" : e === "avi" ? "cerca de la meta" : "no llega a la meta"}</Chip>;
}
export function Pto({ fam }: { fam: Familia }) { return <i className="pto" style={{ background: COLOR_FAM[fam] }} />; }

type Fila3 = (l: string, a: number, p: number, s: number, mejor?: number, cls?: string) => ReactNode;
const fila3: Fila3 = (l, a, p, s, mejor = 1, cls = "") => (
  <tr key={l} className={cls}><td>{l}</td><td>{usd(a)}</td><td>{usd(p)}</td><td className="col-s">{usd(s)}</td><td><Dif a={p} b={s} mejor={mejor} /></td></tr>
);

/** Estado de resultados: Real | Base | Escenario | Diferencia; gastos por grupo, desplegables por subcuenta. */
export function TablaER({ A, Rr, P, S, cols }: { A: Agencia; Rr: Pick<Corrida, "er">; P: Corrida; S: Corrida; cols: [string, string, string] }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const act = activos(A), sumG = (det: Record<string, number>, g: string) => Object.entries(det).filter(([k]) => k.startsWith(g)).reduce((a, [, v]) => a + v, 0);
  const a = Rr.er, p = P.er, s = S.er;
  return (
    <table>
      <thead><tr><th>Concepto</th><th>{cols[0]}</th><th>{cols[1]}</th><th className="col-s">{cols[2]}</th><th>Diferencia</th></tr></thead>
      <tbody>
        <tr className="grp"><td colSpan={5}>Ingresos financieros</td></tr>
        {act.map((i) => fila3(`Intereses · ${PROD[i]}`, a.ingProd[i], p.ingProd[i], s.ingProd[i], 1, "sub"))}
        {fila3("Intereses de mora, refinanciada y reestructurada", a.ingOtros, p.ingOtros, s.ingOtros, 1, "sub")}
        {fila3("Inversiones y fondos disponibles", a.ingLiq, p.ingLiq, s.ingLiq, 1, "sub")}
        {fila3("Interés cobrado a otras oficinas", a.cobInt, p.cobInt, s.cobInt, 1, "sub")}
        {fila3("Total ingresos financieros", a.ingFin, p.ingFin, s.ingFin, 1, "tot")}
        <tr className="grp"><td colSpan={5}>Gastos financieros</td></tr>
        {fila3("Intereses de captaciones", a.costo, p.costo, s.costo, -1, "sub")}
        {fila3("Interés pagado a otras oficinas", a.pagInt, p.pagInt, s.pagInt, -1, "sub")}
        {fila3("Otros gastos financieros", a.otrosGF, p.otrosGF, s.otrosGF, -1, "sub")}
        {fila3("Margen financiero", a.margen, p.margen, s.margen, 1, "tot")}
        <tr className="grp"><td colSpan={5}>Provisiones</td></tr>
        {fila3("Provisión de cartera", a.provCart, p.provCart, s.provCart, -1, "sub")}
        {fila3("Otras provisiones", a.provOtras, p.provOtras, s.provOtras, -1, "sub")}
        <tr className="grp"><td colSpan={5}>Gastos de operación</td></tr>
        {Object.keys(GRUPOS_GASTO).map((g) => {
          const va = sumG(a.det, g), vp = sumG(p.det, g), vs = sumG(s.det, g);
          if (Math.abs(va) + Math.abs(vp) + Math.abs(vs) < 1) return null;
          const hijos = [...new Set([...Object.keys(a.det), ...Object.keys(p.det), ...Object.keys(s.det)])].filter((k) => k.startsWith(g)).sort((x, y) => (p.det[y] ?? 0) - (p.det[x] ?? 0)), open = abiertos.has(g);
          return (
            <Fragment key={g}>
              <tr className={`sub exp ${open ? "open" : ""}`} onClick={() => setAbiertos((o) => { const n = new Set(o); if (n.has(g)) n.delete(g); else n.add(g); return n; })}>
                <td>{GRUPOS_GASTO[g]}</td><td>{usd(va)}</td><td>{usd(vp)}</td><td className="col-s">{usd(vs)}</td><td><Dif a={vp} b={vs} mejor={-1} /></td></tr>
              {open && hijos.map((k) => fila3(`${k.slice(0, 4)}.${k.slice(4)} ${nombreCuenta(k, A.pres?.nombres)}`, a.det[k] ?? 0, p.det[k] ?? 0, s.det[k] ?? 0, -1, "sub2"))}
              {g === "4501" && (p.det.nuevos || s.det.nuevos) ? fila3("Asesores nuevos", 0, p.det.nuevos ?? 0, s.det.nuevos ?? 0, -1, "sub2") : null}
            </Fragment>
          );
        })}
        {fila3("Total gastos de operación", a.personal + a.generales, p.personal + p.generales, s.personal + s.generales, -1, "tot")}
        <tr className="grp"><td colSpan={5}>Otros</td></tr>
        {fila3("Reversión de provisiones", a.reversion, p.reversion, s.reversion, 1, "sub")}
        {fila3("Otros ingresos", a.otrosIng, p.otrosIng, s.otrosIng, 1, "sub")}
        {fila3("Otros gastos", a.otrosGas, p.otrosGas, s.otrosGas, -1, "sub")}
        {Math.abs(p.ajuste) + Math.abs(s.ajuste) > 1 && fila3("Conciliación con el presupuesto", a.ajuste, p.ajuste, s.ajuste, 0, "sub")}
        {fila3("Utilidad del ejercicio", a.util, p.util, s.util, 1, "tot")}
      </tbody>
    </table>
  );
}

export function TablaBalance({ Rr, P, S, base }: { Rr: Pick<Corrida, "bal">; P: Corrida; S: Corrida; base: string }) {
  const A = Rr.bal, B = P.bal, C = S.bal;
  return (
    <table>
      <thead><tr><th>Concepto</th><th>Real al corte</th><th>{base} dic</th><th className="col-s">Simulado dic</th><th>Diferencia</th></tr></thead>
      <tbody>
        <tr className="grp"><td colSpan={5}>Activo</td></tr>
        {fila3("Fondos disponibles e inversiones", A.liq, B.liq, C.liq, 0, "sub")}
        {fila3("Cartera por vencer", A.pv, B.pv, C.pv, 1, "sub")}
        {fila3("Cartera vencida y que no devenga", A.v, B.v, C.v, -1, "sub")}
        {fila3("(−) Provisión de cartera", -A.prov, -B.prov, -C.prov, 1, "sub")}
        {fila3("Cartera neta", A.cartNeta, B.cartNeta, C.cartNeta, 1, "sub")}
        {fila3("Fondos entregados a otras oficinas", A.envia, B.envia, C.envia, 0, "sub")}
        {fila3("Otros activos", A.otrosAct, B.otrosAct, C.otrosAct, 0, "sub")}
        {fila3("Total activo", A.totA, B.totA, C.totA, 1, "tot")}
        <tr className="grp"><td colSpan={5}>Pasivo y patrimonio</td></tr>
        {fila3("Ahorro a la vista", A.vista, B.vista, C.vista, 1, "sub")}
        {fila3("Depósitos a plazo", A.plazo, B.plazo, C.plazo, 1, "sub")}
        {fila3("Fondos recibidos de otras oficinas", A.recibe, B.recibe, C.recibe, -1, "sub")}
        {fila3("Otros pasivos", A.otrosPas + A.otrasCapt, B.otrosPas + B.otrasCapt, C.otrosPas + C.otrasCapt, 0, "sub")}
        {fila3("Patrimonio (incluye resultados)", A.patrimonio, B.patrimonio, C.patrimonio, 1, "sub")}
        {fila3("Total pasivo y patrimonio", A.totP, B.totP, C.totP, 1, "tot")}
      </tbody>
    </table>
  );
}

export function TablaSupuestos({ M, A }: { M: Mundo; A: Agencia }) {
  const c = A.calib, b = A.base, act = activos(A), pr = c.pres;
  const br = (a: number, o: number, tol: number) => Math.abs(a - o) > tol;
  const f = (l: string, p: string, o: string, fuente: string, alerta = false) => (
    <tr key={l}><td>{l}</td><td>{p}</td><td>{o}</td><td>{alerta ? <Chip e="avi">brecha</Chip> : null}</td><td style={{ textAlign: "left", color: "var(--g2)" }}>{fuente}</td></tr>
  );
  return (
    <table className="tsup">
      <thead><tr><th>Supuesto</th><th>Presupuesto</th><th>Observado 12 meses</th><th /><th style={{ textAlign: "left" }}>De dónde sale</th></tr></thead>
      <tbody>
        {f("Recuperación de cartera por vencer (efectividad)", pc(pr.e), pc(c.eObs), "Parámetros de cartera · observado con la provisión constituida (4402) y la vencida", br(pr.e, c.eObs, 0.02))}
        {f("Recuperación mensual de la vencida", pc(pr.rv, 2), pc(c.rvObs, 2), "Parámetros de cartera · referencia", br(pr.rv, c.rvObs, 0.003))}
        {f("Castigo mensual de la vencida", pc(c.k, 2), pc(c.k, 2), "Provisión de cartera (1499) y castigos de 12 meses")}
        {f("Provisión por cada $ que pasa a vencida", pc(c.pi, 0), pc(c.pi, 0), "4402 de los últimos 12 meses")}
        {f("Reversión por cada $ recuperado", pc(c.rhoObs, 1), pc(c.rhoObs, 1), "5.6.04.10 de los últimos 12 meses")}
        {f("Interés de mora por cada $ recuperado", pc(c.ingMoraRatio, 1), pc(c.ingMoraRatio, 1), "5.1.04.50 de los últimos 12 meses")}
        {f("Cumplimiento de la meta de colocación", pc(pr.cumpl, 0), pc(c.cumplObs, 0), "Metas de asesores · colocación estimada con la cartera y los plazos", br(pr.cumpl, c.cumplObs, 0.03))}
        {f("Crecimiento del ahorro a la vista", sgn(pr.gV) + pc(Math.abs(pr.gV)), sgn(c.gObs) + pc(Math.abs(c.gObs)), "Parámetros de captaciones · históricos", br(pr.gV, c.gObs, 0.03))}
        {f("Incremento salarial · inflación de gastos", `${pc(M.sup.incSal)} · ${pc(M.sup.infl)}`, "—", "Supuesto institucional")}
        {act.map((i) => f(`Tasa activa ${PROD[i]} · plazo ${c.plazo[i]} meses`, pc(pr.tasa[i], 2), pc(c.tasa[i], 2), "Parámetros de cartera · rendimiento real del año"))}
        {f("Tasas pasivas vista · plazo", `${pc(b.tasaVista, 2)} · ${pc(b.tasaPlazo, 2)}`, `${pc(b.tasaVista, 2)} · ${pc(b.tasaPlazo, 2)}`, "Costo real del año")}
        {f("Tasa con otras oficinas", pc(tasaInterna(b), 2), pc(tasaInterna(b), 2), "Interés interno del año")}
        {f("Asesores Junior · Senior · Master", A.mix.join(" · "), "—", "Oficiales de crédito activos")}
      </tbody>
    </table>
  );
}

/** Morosidad mes a mes: real (últimos 12 meses), base y simulado. */
export function LineaMora({ A, P, S, base }: { A: Agencia; P: Corrida; S: Corrida; base: string }) {
  const serie = (A.base.extra?.serie ?? []).slice(-12), W = 960, H = 150, pad = 30;
  const realv = serie.map((s) => (s.pv + s.v ? s.v / (s.pv + s.v) : 0)), proy = P.meses.map((m) => m.mora), sim = S.meses.map((m) => m.mora);
  if (!realv.length) return null;
  const todos = [...realv, ...proy, ...sim], mn = Math.min(...todos) * 0.95, mx = Math.max(...todos) * 1.05;
  const n = realv.length + 12, x = (i: number) => pad + i / (n - 1) * (W - 2 * pad), y = (v: number) => 12 + (mx - v) / (mx - mn || 1) * (H - 36);
  const ult = realv.length - 1, yy = String(Number(A.base.periodo.slice(0, 4)) + 1).slice(2);
  const linea = (vals: number[], off: number, color: string, dash?: boolean) => <polyline fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash ? "5 4" : undefined} points={vals.map((v, i) => `${x(i + off)},${y(v)}`).join(" ")} />;
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--g2)", display: "flex", gap: 16 }}><b style={{ color: "var(--t)" }}>Morosidad mes a mes</b><span>— real</span><span>- - {base.toLowerCase()}</span><span style={{ color: "var(--v)" }}>— simulado</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <line x1={x(ult)} x2={x(ult)} y1={8} y2={H - 22} stroke="#E6E2D8" />
        {linea(realv, 0, "#7A847F")}{linea([realv[ult], ...proy], ult, "#7A847F", true)}{linea([realv[ult], ...sim], ult, "#005A28")}
        {serie.map((s, i) => (i % 3 === 0 ? <text key={s.p} x={x(i)} y={H - 6} fontSize={10} textAnchor="middle" fill="#7A847F">{per(s.p)}</text> : null))}
        {[0, 3, 6, 9].map((i) => <text key={i} x={x(realv.length + i)} y={H - 6} fontSize={10} textAnchor="middle" fill="#7A847F">{MES[i]}-{yy}</text>)}
        <text x={x(n - 1)} y={y(sim[11]) - 6} fontSize={11} textAnchor="end" fontWeight={700} fill="#005A28">{pc(sim[11])}</text>
        <text x={x(n - 1)} y={y(proy[11]) + 14} fontSize={11} textAnchor="end" fill="#5F6B65">{pc(proy[11])}</text>
      </svg>
    </div>
  );
}

export const realDe = real;
export const FMT_PAL: Record<ClavePal, (v: number) => string> = {
  e: (v) => pc(v), rv: (v) => pc(v, 2) + " al mes", ajGen: (v) => sgn(v) + pc(Math.abs(v), 0) + " gastos ajustables", cumpl: (v) => pc(v, 0) + " de la meta", gP: (v) => sgn(v) + pc(Math.abs(v), 0) + " depósitos a plazo",
};
export { mill };

/** Estilos de las tres pestañas (tablas, tarjetas, palancas). Se aplican dentro de .planif. */
export const ESTILO_PLAN = `
.planif{--v:#005A28;--v2:#1E6B3A;--b:#E6E2D8;--l:#DDE2DF;--g:#3D4843;--g2:#5F6B65;--t:#111418;--al:#B42318;--alS:#FBE4E1;--av:#8A5A12;--avS:#FBF1DC;--okS:#E6F1EA}
.planif table{width:100%;border-collapse:collapse;font-size:12px}
.planif th{color:var(--g);font-weight:600;text-align:right;padding:8px 12px;border-bottom:2px solid var(--l);vertical-align:bottom;white-space:nowrap}
.planif td{padding:7px 12px;text-align:right;border-top:1px solid #F0EEE8;white-space:nowrap}
.planif th:first-child,.planif td:first-child{text-align:left;white-space:normal}
.planif tr.tot td{font-weight:800;border-top:1px solid #B9C3BD}
.planif tr.sub td:first-child{padding-left:26px;color:var(--g2)}
.planif tr.sub2 td:first-child{padding-left:40px;color:var(--g2)}.planif tr.sub2 td{font-size:11.5px;color:var(--g2)}
.planif tr.grp td{font-weight:700;color:var(--v);background:#FAFBFA}
.planif tr.exp td:first-child{cursor:pointer}.planif tr.exp td:first-child:before{content:"▸ ";color:var(--g2)}.planif tr.exp.open td:first-child:before{content:"▾ "}
.planif td.col-s,.planif th.col-s{background:#F8FBF9}.planif td.col-s{font-weight:700}.planif th.col-s{color:var(--v)}
.planif .up{color:var(--v2);font-weight:700}.planif .dn{color:var(--al);font-weight:700}.planif .neu{color:var(--g)}.planif .dim{color:#9AA39E}
.planif .chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
.planif .chip.ok{background:var(--okS);color:var(--v2)}.planif .chip.avi{background:var(--avS);color:var(--av)}.planif .chip.mal{background:var(--alS);color:var(--al)}
.planif .card{background:#fff;border:1px solid var(--b);border-radius:12px;margin-bottom:14px;overflow:hidden}
.planif .ch{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--b)}.planif .ch h3{margin:0;font-size:14px;font-weight:600;flex:1}.planif .ch .s{color:var(--g2);font-size:12px}
.planif details.card>summary{list-style:none;cursor:pointer}.planif details>summary::-webkit-details-marker{display:none}
.planif details.card>summary.ch h3:before{content:"▸ ";color:var(--g2)}.planif details.card[open]>summary.ch h3:before{content:"▾ "}.planif details.card:not([open])>summary.ch{border-bottom:0}
.planif .seg{display:inline-flex;gap:3px;padding:3px;border-radius:9px;background:#E6EAE8;flex-wrap:wrap}
.planif .seg button{height:28px;padding:0 12px;border-radius:7px;border:0;background:none;font-size:12px;color:var(--g);cursor:pointer;white-space:nowrap}
.planif .seg button.on{background:#fff;color:var(--v);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.08)}.planif .seg2{background:#EEF3F0}
.planif .pto{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.planif .kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:14px}
.planif .kp{background:#fff;border:1px solid var(--b);border-radius:12px;padding:10px 12px}.planif .kp .t{font-size:11.5px;color:var(--g2)}.planif .kp .v{font-size:19px;font-weight:800;margin-top:2px}.planif .kp .d{font-size:11.5px;margin-top:1px;color:var(--g2)}
.planif .cadena{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.planif .eslabon{padding:12px 14px;border-left:1px solid var(--b);position:relative}.planif .eslabon:first-child{border-left:0}
.planif .eslabon h6{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--g2)}
.planif .eslabon:not(:last-child):after{content:"→";position:absolute;right:-9px;top:10px;background:#fff;color:var(--v);font-weight:800;padding:0 2px}
.planif .ef{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px dashed #EEF0EE;font-size:12px}.planif .ef:first-of-type{border-top:0}.planif .ef span:first-child{color:var(--g)}
.planif .vacio{padding:16px;color:var(--g2)}
.planif .dos{display:grid;grid-template-columns:1fr 1fr}.planif .dos>div{border-left:1px solid var(--b)}.planif .dos>div:first-child{border-left:0}
.planif .sub-h{padding:8px 12px;font-size:12px;font-weight:700;color:var(--v);background:#FAFBFA;border-bottom:1px solid var(--b)}
.planif .alerta{display:flex;gap:8px;padding:10px 14px;background:var(--avS);color:var(--av);font-size:12px;border:1px solid #F1E2BF;border-radius:10px}
.planif .sim{display:grid;grid-template-columns:330px minmax(0,1fr);gap:16px;align-items:start}
.planif .pal{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto}
.planif .grupo{padding:12px 16px;border-top:1px solid var(--b)}.planif .grupo:first-child{border-top:0}
.planif .grupo h5{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--v)}
.planif .lev{margin:10px 0 12px}.planif .lev .fila{display:flex;justify-content:space-between;gap:8px;font-size:12px}.planif .lev .val{font-weight:700}.planif .lev .val.c{color:var(--v)}
.planif .lev .pista{position:relative;margin-top:4px}.planif .lev input[type=range]{width:100%;accent-color:#005A28;margin:0}
.planif .lev .marca{position:absolute;top:-3px;width:2px;height:18px;background:#111418;opacity:.55;pointer-events:none}
.planif .lev .ref{font-size:11px;color:var(--g2);display:flex;justify-content:space-between}
.planif .derivado{margin:6px 0 2px;padding:10px 12px;border-radius:10px;background:#F5FAF7;border:1px solid #D5E5DA;font-size:12px}
.planif .derivado .r{display:flex;justify-content:space-between;gap:8px;margin-top:3px;color:var(--g)}
.planif .fijo{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--g);padding:3px 0}.planif .fijo b{color:var(--t)}
.planif .doc{background:#fff;border:1px solid var(--b);border-radius:14px;overflow:hidden}
.planif .portada{padding:20px 32px 18px;background:#F6F8F7;border-left:6px solid #005A28;border-bottom:1px solid var(--b)}
.planif .portada .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700}.planif .portada h2{font-size:26px;font-weight:800;margin:4px 0 6px}.planif .portada p{margin:0;font-size:14px;color:var(--g)}
.planif .sec{padding:20px 32px;border-top:1px solid var(--b)}
.planif .sec h4{margin:0 0 4px;font-size:15px;font-weight:700;display:flex;gap:10px;align-items:baseline}.planif .sec h4 .n{color:var(--v);font-size:13px;font-weight:800}
.planif .sec .lead{color:var(--g);margin:0 0 12px;max-width:860px;font-size:13px}
.planif .sec details>summary{list-style:none;cursor:pointer}.planif .sec details>summary h4:before{content:"▸";color:var(--g2);margin-right:4px}.planif .sec details[open]>summary h4:before{content:"▾"}
.planif .editor{margin-top:14px;border:1px solid var(--b);border-radius:10px;padding:12px 14px;background:#FBFCFB}
.planif .ed-g{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.planif .ed-g label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--g)}
.planif .ed-g input,.planif input.num{height:30px;width:90px;border:1px solid #C9D0CC;border-radius:6px;padding:0 6px;text-align:right;background:#fff}
.planif .ed-g small{color:var(--g2)}.planif .ed-g em{color:var(--al);font-style:normal;font-size:11px;font-weight:700}
.planif .barh{display:inline-block;height:8px;border-radius:4px;background:#8FAE9B;vertical-align:middle}
.planif .pie{padding:12px 32px;color:var(--g2);font-size:11px;border-top:1px solid var(--b);display:flex;justify-content:space-between}
@media (max-width:1100px){.planif .sim{grid-template-columns:1fr}.planif .pal{position:static;max-height:none}.planif .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.planif .cadena{grid-template-columns:repeat(2,minmax(0,1fr))}.planif .ed-g{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media print{.planif .doc{border:0}.planif .sec{break-inside:avoid}.planif .solo-print{display:block!important}}
.planif .solo-print{display:none}
.planif .barra-meta{display:flex;flex-wrap:wrap;align-items:flex-end;gap:16px 24px;padding:14px 18px;border-bottom:1px solid var(--b);font-size:13px;color:var(--g)}
.planif .barra-meta .campo{display:flex;flex-direction:column;gap:6px}.planif .barra-meta .et{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t)}
.planif .subsec+.subsec{margin-top:22px}.planif .subsec h5{margin:0 0 8px;font-size:13px;font-weight:700;color:var(--t)}
`;

/** Insumos del motor del presupuesto por agencia (los mismos de Estado de resultados y Balance general). */
/**
 * Presupuesto de cada agencia ya leído, guardado mientras la herramienta esté abierta (clave: versión de datos + agencia).
 * Al volver a Planificación o cambiar de pestaña aparece al instante; cuando se guarda cualquier cambio sube la versión
 * de datos y se vuelve a leer.
 */
const memoriaPaquetes = new Map<string, PaqueteMotor | null>();
/** Último paquete leído de cada agencia (de cualquier versión): se muestra mientras se lee el nuevo. */
const ultimoPaquete = new Map<string, PaqueteMotor | null>();
/** Agencias que se están releyendo después de un cambio (se muestran con su paquete anterior). */
export const paquetesActualizando = { n: 0 };

/**
 * Paquetes del motor de cada agencia. Después de guardar un cambio no se vuelve a la pantalla de carga: cada agencia
 * se sigue mostrando con su paquete anterior mientras se lee el nuevo, y la agencia en pantalla (prioridad) se lee primero.
 */
export function usePaquetes(agencias: string[], activo: boolean, prioridad?: string): Record<string, PaqueteMotor | null> {
  const { versionDatos } = useEstadoSincronizacion();
  const ver = String(versionDatos ?? "s");
  const k = (a: string) => `${ver}|${a}`;
  const [tick, setTick] = useState(0);
  const lista = agencias.join("|");
  const clave = activo ? `${lista}#${ver}` : "";
  useEffect(() => {
    if (!clave) return;
    // lo de versiones anteriores ya no sirve (queda el último de cada agencia para mostrar mientras se lee)
    for (const x of [...memoriaPaquetes.keys()]) if (!x.startsWith(`${ver}|`)) memoriaPaquetes.delete(x);
    const faltan = lista.split("|").filter((a) => a && !memoriaPaquetes.has(`${ver}|${a}`))
      .sort((a, b) => (a === prioridad ? -1 : b === prioridad ? 1 : 0));
    if (!faltan.length) { paquetesActualizando.n = 0; return; }
    let vivo = true;
    paquetesActualizando.n = faltan.filter((a) => ultimoPaquete.has(a)).length;
    (async () => {
      // de a tres por vez (la agencia en pantalla sola, primero): el primer cálculo de cada agencia es pesado
      const grupos = faltan[0] === prioridad ? [[faltan[0]], ...Array.from({ length: Math.ceil((faltan.length - 1) / 3) }, (_, g) => faltan.slice(1 + g * 3, 4 + g * 3))] : Array.from({ length: Math.ceil(faltan.length / 3) }, (_, g) => faltan.slice(g * 3, g * 3 + 3));
      for (const grupo of grupos) {
        if (!vivo) break;
        await Promise.all(grupo.map(async (a) => {
          try {
            const r = await apiFetch(`/api/planificacion/motor?agencia=${encodeURIComponent(a)}`);
            const j = r.ok ? await r.json() : null;
            memoriaPaquetes.set(`${ver}|${a}`, j?.ins?.saldos ? j : null);
          } catch { memoriaPaquetes.set(`${ver}|${a}`, null); }
          ultimoPaquete.set(a, memoriaPaquetes.get(`${ver}|${a}`) ?? null);
        }));
        paquetesActualizando.n = lista.split("|").filter((a) => a && !memoriaPaquetes.has(`${ver}|${a}`) && ultimoPaquete.has(a)).length;
        if (vivo) setTick((t) => t + 1);
      }
    })();
    return () => { vivo = false; };
  }, [clave, lista, ver, prioridad]);
  return useMemo(() => Object.fromEntries(lista.split("|").filter((a) => a && (memoriaPaquetes.has(k(a)) || ultimoPaquete.has(a)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    .map((a) => [a, memoriaPaquetes.has(k(a)) ? memoriaPaquetes.get(k(a))! : ultimoPaquete.get(a)!])), [lista, ver, tick]);
}
