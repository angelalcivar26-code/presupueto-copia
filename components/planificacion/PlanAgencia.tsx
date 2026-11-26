"use client";

import { useState, type ReactNode } from "react";
import { ListChecks } from "lucide-react";
import { VentanaCambios } from "./Cambios";
import {
  objetivo, correr, copiaL, activos, nombreCuenta, PALANCAS, NOMBRE_PAL, PROD, TOPE_MAX,
  type Mundo, type ClavePal, type Ajustes,
} from "../../lib/calc/plan2027";
import type { BaseModelo } from "../../lib/calc/plan-motor";
import { usd, mill, pc, per, type RealCargado } from "./Comun";
import { Dif, Chip, Semaforo, sgn, ent, fpts, MES, FMT_PAL, COLOR_FAM, OPCIONES_CUMPL, metaDe, realDe, type ConfigModelo, type Escenario } from "./Integrado";
import { BotonesVista } from "../PorAgencia";
import { BotonesSeccion, C } from "../ActivosComun";

/**
 * PLAN DE LA AGENCIA (escenarios sobre el presupuesto) y PROPUESTA DEL MODELO (escenarios independientes del
 * presupuesto, con el ritmo real de gastos y tasas). Una sola vista: primero el resumen y
 * debajo las secciones desplegables (supuestos, frente al presupuesto, colocación, palancas, metas y ruta mensual).
 */
const PASO: Record<ClavePal, number> = { e: 0.01, rv: 0.005, ajGen: -0.01, cumpl: 0.01, gP: 0.01 };
const PASO_T: Record<ClavePal, string> = { e: "+1 pt de cobro a tiempo", rv: "+0,5 pt de recuperación al mes", ajGen: "−1 % de gastos ajustables", cumpl: "+1 pt de cumplimiento de meta", gP: "+1 % de depósitos a plazo" };
const CAMPOS: [ClavePal, string, number][] = [["e", "Recuperación de cartera por vencer", 1], ["rv", "Recuperación de cartera vencida al mes", 2], ["ajGen", "Gastos ajustables", 1], ["gP", "Depósitos a plazo (crecimiento)", 1]];
const NIVELES = ["cons", "medio", "opt"] as const;
type Nivel = (typeof NIVELES)[number];

function Tile({ t, a, m, f, mejor, fd, base }: { t: string; a: number; m: number; f: (v: number) => string; mejor: number; fd?: (v: number) => string; base: string }) {
  return <div className="kp"><div className="t">{t}</div><div className="v">{f(m)}</div><div className="d">{base} {f(a)} · <Dif a={a} b={m} mejor={mejor} f={fd ?? (f === mill ? usd : f)} /></div></div>;
}
const pct1 = (x: number, d = 1) => (Math.round(x * 100 * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",");
const leer = (t: string) => { const v = Number(t.trim().replace(/\s|%/g, "").replace(",", ".")); return Number.isFinite(v) ? v / 100 : NaN; };

export function PlanAgencia({ modo, M, Mpres, ag, cfg, setCfg, E, escSel, setEscSel, seleccionables, onAprobar, onBorrar, baseModelo, nombres, metaU: metaDada, metaRoa, izquierda, real }: {
  modo: "pres" | "mod" | "meta"; M: Mundo; Mpres?: Mundo; seleccionables?: string[]; ag: string; cfg: ConfigModelo; setCfg: (c: Partial<ConfigModelo>) => void | Promise<void>; E: Escenario[]; escSel: string; setEscSel: (k: string) => void;
  onAprobar?: (id: number) => Promise<void>; onBorrar?: (id: number) => Promise<void>;
  baseModelo?: Record<string, BaseModelo>; nombres?: Record<string, string>; metaU?: number; metaRoa?: number; izquierda?: ReactNode;
  real?: RealCargado | null;
}) {
  const esMod = modo === "mod";
  const [verCambios, setVerCambios] = useState(false);
  const A = M.ags[ag], b = A.base, act = activos(A), y = Number(b.periodo.slice(0, 4)) + 1;
  // escenario de comparación: el presupuestado (de ahí parten los escenarios del presupuesto y la meta)
  const kBase = "pres", nBase = "presupuestado";
  const kHoy = esMod ? "mtend" : "pres";
  const visibles = seleccionables ? E.filter((e) => seleccionables.includes(e.k) || e.fam === "guard") : E.filter((e) => e.k !== "mtend");
  const sel = E.find((e) => e.k === escSel) ?? visibles[visibles.length - 1];
  const B = E.find((e) => e.k === kBase)!.R, Hoy = E.find((e) => e.k === kHoy)!, Mx = sel.R;
  const metaU = metaDada ?? metaDe(M, cfg, ag), R0 = realDe(A);
  const conMotor = !!M.motor?.[ag];
  const HL = Hoy.L, O = { ...objetivo(M, A), ...((esMod ? cfg.ajustes[ag]?.mopt : cfg.ajustes[ag]?.opt) ?? {}) };
  const ap = !conMotor || sel.fam === "pres" ? [] : PALANCAS.map((k) => { const Y = copiaL(HL); Y[k] = sel.L[k]; return { k, de: HL[k], a: sel.L[k], aporte: correr(M, A, Y).kpi.util - Hoy.R.kpi.util }; })
    .filter((x) => Math.abs(x.a - x.de) > 1e-6 && x.aporte > 100).sort((p, q) => q.aporte - p.aporte);
  const veredicto = sel.k === kBase ? `El presupuesto da ${mill(B.kpi.util)} en ${y}.`
    : `La utilidad pasa de ${mill(B.kpi.util)} (${nBase}) a ${mill(Mx.kpi.util)}.`;
  const metaTxt = ag === "Consolidado" ? `Meta de la cooperativa: ${mill(metaU)}.` : `Meta asignada: ${mill(metaU)} (ROA ${pc(metaRoa ?? (B.activoProm ? metaU / B.activoProm : 0), 2)}).`;
  const fam = sel.fam;
  const sens = !conMotor ? [] : PALANCAS.map((k) => { const Y = copiaL(HL); Y[k] += PASO[k]; const Z = copiaL(HL); Z[k] = O[k]; return { k, d: correr(M, A, Y).kpi.util - Hoy.R.kpi.util, dO: correr(M, A, Z).kpi.util - Hoy.R.kpi.util }; }).sort((p, q) => q.d - p.d);
  // la Tendencia (presupuesto con el comportamiento de los últimos 12 meses) no se muestra: nunca existió en la realidad
  const cols = E.filter((e) => e.k !== "hist" && e.k !== "mtend");
  // Real: último estado de resultados cargado (acumulado del año) y saldos de ese balance
  const realCol = real ? { util: real.utilidad, roa: real.roa, mora: real.morosidad, cart: real.cartera, capt: real.captaciones, ases: R0.kpi.ases } : null;
  const nReal = real ? `Real ${per(real.periodo)}` : "Real";
  const filaE = (l: string, f: (v: number) => string, g: (e: Escenario) => number, r?: number) => <tr key={l}><td>{l}</td><td style={{ color: "#3D4843" }}>{r === undefined ? "—" : f(r)}</td>{cols.map((e) => <td key={e.k} className={e.k === sel.k ? "col-s" : ""}>{f(g(e))}</td>)}</tr>;
  const filaM = (l: string, a: number | null, p: number, m: number, mejor = 1, f: (v: number) => string = usd, cls = "", fd?: (v: number) => string) => (
    <tr key={l} className={cls}><td>{l}</td><td>{a === null ? <span className="dim">—</span> : f(a)}</td><td>{f(p)}</td><td className="col-s">{f(m)}</td><td><Dif a={p} b={m} mejor={mejor} f={fd ?? f} /></td></tr>
  );
  const niveles: [number, string][] = [[A.calib.cumplObs, `Observado (${pc(A.calib.cumplObs, 0)})`], [0.8, "80 %"], [0.9, "90 %"], [1, "100 %"]];
  const porCumpl = conMotor && A.mix.some((n) => n > 0) ? niveles.map(([c, l]) => { const X = copiaL(sel.L); X.asesFijo = null; X.cumpl = c; return { l, c, R: correr(M, A, X) }; }) : [];
  const nombreCol = (e: Escenario) => (e.k === "mtend" ? "Hoy (tendencia)" : e.n);

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-wrap items-center gap-3 min-h-9">
        {izquierda}
        {visibles.length > 1 && <BotonesVista etiqueta="Escenario" valor={sel.k} onChange={setEscSel} opciones={visibles.map((e) => ({ id: e.k, label: e.n }))} />}
        <span className="flex-1" />
        {conMotor && sel.k !== "pres" && <button type="button" onClick={() => setVerCambios(true)} className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]" style={{ color: C.acento }}><ListChecks size={16} />Qué cambiar en el presupuesto</button>}
      </div>
      {verCambios && <VentanaCambios Mpres={Mpres ?? M} Mesc={M} ag={ag} esc={sel} nombres={nombres ?? A.pres?.nombres} onCerrar={() => setVerCambios(false)} />}
      <article className="doc informe">
        <header className="portada" style={{ borderLeftColor: COLOR_FAM[fam] }}>
          <div className="k" style={{ color: COLOR_FAM[fam] }}>{esMod ? "Propuesta del modelo" : modo === "meta" ? "Meta de ROA" : "Escenarios del presupuesto"} {y} · {sel.n}{sel.estado ? ` · ${sel.estado}` : ""}</div>
          <h2>{ag === "Consolidado" ? "Cooperativa (consolidado)" : `Agencia ${ag}`}</h2>
          <p>{veredicto} {metaTxt} <Semaforo u={Mx.kpi.util} meta={metaU} /></p>
        </header>

          <section className="sec">
            <h4>Resumen para gerencia</h4>
            <div className="kpis" style={{ gridTemplateColumns: "repeat(5,minmax(0,1fr))", marginBottom: 12 }}>
              <Tile base={nBase} t={`Utilidad ${y}`} a={B.kpi.util} m={Mx.kpi.util} f={mill} mejor={1} />
              <Tile base={nBase} t="ROA" a={B.kpi.roa} m={Mx.kpi.roa} f={(x) => pc(x, 2)} mejor={1} fd={fpts} />
              <Tile base={nBase} t="Morosidad dic" a={B.kpi.mora} m={Mx.kpi.mora} f={(x) => pc(x)} mejor={-1} fd={fpts} />
              <Tile base={nBase} t="Colocación mensual" a={B.col.colMes} m={Mx.col.colMes} f={usd} mejor={0} />
              <Tile base={nBase} t="Asesores" a={B.kpi.ases} m={Mx.kpi.ases} f={ent} mejor={0} />
            </div>
            {ap.length > 0 && (
              <table><thead><tr><th>Acciones clave</th><th>Hoy</th><th className="col-s">{sel.n}</th><th>Aporte a la utilidad</th></tr></thead>
                <tbody>{ap.slice(0, 4).map((x) => <tr key={x.k}><td><b>{NOMBRE_PAL[x.k]}</b></td><td>{FMT_PAL[x.k](x.de)}</td><td className="col-s">{FMT_PAL[x.k](x.a)}</td><td><Dif a={0} b={x.aporte} /></td></tr>)}</tbody></table>
            )}
            {sel.falta !== undefined && sel.falta > 1 && <div className="alerta" style={{ marginTop: 10 }}>Aun con todas las acciones al nivel optimista faltan {mill(sel.falta)}.</div>}
            {fam === "guard" && sel.id && onAprobar && onBorrar && (
              <div className="no-print flex items-center gap-2 mt-2.5">
                {sel.estado !== "Aprobado" ? <>
                  <button type="button" className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold" style={{ background: C.acento }} onClick={() => onAprobar(sel.id!)}>Marcar como aprobado</button>
                  <button type="button" className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC", color: C.texto }} onClick={() => { if (confirm(`¿Eliminar el escenario «${sel.n}»?`)) onBorrar(sel.id!); }}>Eliminar</button>
                </> : <Chip e="ok">Aprobado</Chip>}
              </div>
            )}
          </section>
          <section className="sec">
            <h4>Escenarios comparados</h4>
            <div className="overflow-x-auto"><table>
              <thead><tr><th>Indicador</th><th>{nReal}</th>{cols.map((e) => <th key={e.k} className={e.k === sel.k ? "col-s" : ""}>{nombreCol(e)}{e.estado && <><br /><Chip e={e.estado === "Aprobado" ? "ok" : "avi"}>{e.estado}</Chip></>}</th>)}</tr></thead>
              <tbody>
                {filaE("Utilidad del año", usd, (e) => e.R.kpi.util, realCol?.util)}{filaE("ROA", (x) => pc(x, 2), (e) => e.R.kpi.roa, realCol?.roa)}{filaE("Morosidad a diciembre", (x) => pc(x), (e) => e.R.kpi.mora, realCol?.mora)}
                {filaE("Colocación mensual", usd, (e) => e.R.col.colMes)}{filaE("Asesores", ent, (e) => e.R.kpi.ases, realCol?.ases)}{filaE("Cartera a diciembre", usd, (e) => e.R.bal.cart, realCol?.cart)}
                {filaE("Captaciones a diciembre", usd, (e) => e.R.bal.capt, realCol?.capt)}{filaE("Gasto de operación", usd, (e) => e.R.er.personal + e.R.er.generales)}
              </tbody>
            </table></div>
          </section>

        {<TablaSupuestosEditable modo={modo} M={M} ag={ag} E={E} sel={sel} cfg={cfg} setCfg={setCfg} conMotor={conMotor && modo !== "meta"} />}

        {esMod && <Plegable t="Frente al presupuesto"><FrentePresupuesto ag={ag} E={E} sel={sel} baseModelo={baseModelo} nombres={nombres} /></Plegable>}

          {porCumpl.length > 0 && <Plegable t={<>Colocación según el cumplimiento de la meta · {sel.n}</>}>
            <table><thead><tr><th>Cumplimiento</th><th>Colocación mensual</th><th>Colocación por asesor</th><th>Cartera a diciembre</th><th>Intereses de cartera</th><th>Provisión de cartera</th><th>Morosidad dic</th><th>Utilidad</th><th>ROA</th></tr></thead>
              <tbody>{porCumpl.map((x) => <tr key={x.l} className={Math.abs(x.c - sel.L.cumpl) < 1e-6 ? "tot" : ""}><td>{x.l}</td><td>{usd(x.R.col.colMes)}</td><td>{usd(x.R.col.porAsesor)}</td><td>{usd(x.R.bal.cart)}</td><td>{usd(x.R.er.ingCart)}</td><td>{usd(x.R.er.provCart)}</td><td>{pc(x.R.kpi.mora)}</td><td>{usd(x.R.kpi.util)}</td><td>{pc(x.R.kpi.roa, 2)}</td></tr>)}</tbody></table>
          </Plegable>}
          {sens.length > 0 && <Plegable t={<>Qué palanca rinde más</>}>
            <table><thead><tr><th>Palanca</th><th>Hoy</th><th>Cambio</th><th>Aporte</th><th>Optimista</th><th>Aporte al optimista</th></tr></thead>
              <tbody>{sens.map((s) => <tr key={s.k}><td>{NOMBRE_PAL[s.k]}</td><td>{FMT_PAL[s.k](HL[s.k])}</td><td>{PASO_T[s.k]}</td><td><Dif a={0} b={s.d} /></td><td>{FMT_PAL[s.k](O[s.k])}</td><td><Dif a={0} b={s.dO} /></td></tr>)}</tbody></table>
          </Plegable>}
          <Plegable t={<>Metas detalladas · {sel.n}</>}>
            <table><thead><tr><th>Concepto</th><th>{nReal}</th><th>Presupuestado {y}</th><th className="col-s">{sel.n}</th><th>Cambio</th></tr></thead>
              <tbody>
                <tr className="grp"><td colSpan={5}>Colocación y equipo comercial</td></tr>
                {act.map((i) => filaM(`Colocación mensual · ${PROD[i]}`, null, B.col.X[i], Mx.col.X[i], 1, usd, "sub"))}
                {filaM("Colocación mensual total", null, B.col.colMes, Mx.col.colMes, 1, usd, "tot")}
                {filaM("Asesores", R0.kpi.ases, B.col.necesarios, Mx.col.necesarios, 0, ent)}{filaM("Colocación por asesor al mes", null, B.col.porAsesor, Mx.col.porAsesor)}
                <tr className="grp"><td colSpan={5}>Cartera y recuperación</td></tr>
                {act.map((i) => filaM(`${PROD[i]} · crecimiento`, null, B.col.crecLogrado[i] / 100, Mx.col.crecLogrado[i] / 100, 1, (x) => sgn(x) + pc(Math.abs(x)), "sub", fpts))}
                {filaM("Cartera bruta a diciembre", real ? real.cartera : null, B.bal.cart, Mx.bal.cart)}
                {filaM("Cuotas cobradas al mes", null, B.rec.cob / 12, Mx.rec.cob / 12)}{filaM("Cuotas que pasan a vencida al mes", null, B.rec.mig / 12, Mx.rec.mig / 12, -1)}
                {filaM("Vencida recuperada al mes", null, B.rec.rec / 12, Mx.rec.rec / 12)}{filaM("Castigos del año", null, B.rec.cas, Mx.rec.cas, -1)}
                {filaM("Cartera vencida a diciembre", real ? real.cartera * real.morosidad : null, B.bal.v, Mx.bal.v, -1)}{filaM("Morosidad a diciembre", real ? real.morosidad : null, B.kpi.mora, Mx.kpi.mora, -1, (x) => pc(x))}
                <tr className="grp"><td colSpan={5}>Captación y fondeo</td></tr>
                {filaM("Captaciones a diciembre", real ? real.captaciones : null, B.bal.capt, Mx.bal.capt)}
                <tr className="grp"><td colSpan={5}>Gasto</td></tr>
                {filaM("Gasto de personal", null, B.er.personal, Mx.er.personal, -1)}{filaM("Otros gastos de operación", null, B.er.generales, Mx.er.generales, -1)}{filaM("Provisión de cartera", null, B.er.provCart, Mx.er.provCart, -1)}
                <tr className="grp"><td colSpan={5}>Resultado</td></tr>
                {filaM("Margen financiero", null, B.er.margen, Mx.er.margen)}{filaM("Utilidad del ejercicio", real ? real.utilidad : null, B.er.util, Mx.er.util, 1, usd, "tot")}
              </tbody></table>
          </Plegable>
          <Plegable t={<>Ruta mensual {y} · {sel.n}</>}>
            <div className="overflow-x-auto"><table><thead><tr><th>Mes</th><th>Colocación</th><th>Cuotas cobradas</th><th>Vencida recuperada</th><th>Castigos</th><th>Cartera bruta</th><th>Morosidad</th><th>Captaciones</th><th>Utilidad del mes</th><th>Acumulada</th></tr></thead>
              <tbody>{Mx.meses.map((m, i) => <tr key={i}><td>{MES[i]}-{String(y).slice(2)}</td><td>{usd(m.coloc)}</td><td>{usd(m.cob)}</td><td>{usd(m.rec)}</td><td>{usd(m.cas)}</td><td>{usd(m.cart)}</td><td>{pc(m.mora)}</td><td>{usd(m.capt)}</td><td>{usd(m.util)}</td><td><b>{usd(m.ut)}</b></td></tr>)}</tbody></table></div>
          </Plegable>
        <footer className="pie"><span>COAC Once de Junio · Planificación</span><span>Datos reales al corte {per(b.periodo)}</span></footer>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------
// Supuestos de cada escenario (editables en los propuestos, sin cruzarse con el escenario vecino)
// ---------------------------------------------------------------------
function TablaSupuestosEditable({ modo, M, ag, E, sel, cfg, setCfg, conMotor }: {
  modo: "pres" | "mod" | "meta"; M: Mundo; ag: string; E: Escenario[]; sel: Escenario; cfg: ConfigModelo; setCfg: (c: Partial<ConfigModelo>) => void | Promise<void>; conMotor: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const esMod = modo === "mod", pre = esMod ? "m" : "";
  const hoy = E.find((e) => e.k === (esMod ? "mtend" : "hist"))!;
  const prop = (n: Nivel) => E.find((e) => e.k === pre + n)!;
  const clave = (n: Nivel, k: ClavePal) => `${n}|${k}`;
  // valor vigente en la edición (lo escrito o lo del escenario)
  const valor = (n: Nivel, k: ClavePal) => { const t = txt[clave(n, k)]; const v = t === undefined ? NaN : leer(t); return Number.isFinite(v) ? v : prop(n).L[k]; };
  const rango = (n: Nivel, k: ClavePal): [number, number] => {
    const i = NIVELES.indexOf(n), a = i === 0 ? hoy.L[k] : valor(NIVELES[i - 1], k), b = i === 2 ? TOPE_MAX[k] : valor(NIVELES[i + 1], k);
    return [Math.min(a, b), Math.max(a, b)];
  };
  const errores = Object.keys(txt).filter((c) => { const [n, k] = c.split("|") as [Nivel, ClavePal]; const v = leer(txt[c]), [mn, mx] = rango(n, k); return !Number.isFinite(v) || v < mn - 1e-6 || v > mx + 1e-6; });
  const cambios = Object.keys(txt).filter((c) => { const [n, k] = c.split("|") as [Nivel, ClavePal]; return Math.abs(leer(txt[c]) - prop(n).L[k]) > 1e-6; }).length;
  const ajAg = cfg.ajustes[ag] ?? {};
  const hayAjustes = NIVELES.some((n) => ajAg[pre + n] && Object.keys(ajAg[pre + n]).length);
  const guardar = async () => {
    if (errores.length) return;
    const nuevo: Ajustes = { ...ajAg };
    for (const c of Object.keys(txt)) {
      const [n, k] = c.split("|") as [Nivel, ClavePal], v = leer(txt[c]);
      if (Math.abs(v - prop(n).L[k]) > 1e-6) nuevo[pre + n] = { ...(nuevo[pre + n] ?? {}), [k]: v };
    }
    setGuardando(true);
    try { await setCfg({ ajustes: { ...cfg.ajustes, [ag]: nuevo } }); setTxt({}); setEditando(false); } finally { setGuardando(false); }
  };
  const restablecer = async () => {
    const nuevo: Ajustes = { ...ajAg }; for (const n of NIVELES) delete nuevo[pre + n];
    await setCfg({ ajustes: { ...cfg.ajustes, [ag]: nuevo } }); setTxt({}); setEditando(false);
  };
  const cols = E.filter((e) => e.fam !== "guard");
  const editable = (e: Escenario) => editando && conMotor && NIVELES.some((n) => e.k === pre + n);

  return (
    <Plegable t="Supuestos de cada escenario">
      <div className="flex items-center gap-3 mb-2 no-print">
        <span className="flex-1" />
        {conMotor && hayAjustes && !editando && <button type="button" className="no-print text-[12px] font-semibold hover:underline" style={{ color: C.acento }} onClick={restablecer}>Volver a lo propuesto</button>}
        {conMotor && <span className="no-print"><BotonesSeccion editando={editando} cambios={errores.length ? 0 : cambios} guardando={guardando} onEditar={() => setEditando(true)} onCancelar={() => { setTxt({}); setEditando(false); }} onGuardar={guardar} /></span>}
      </div>
      <div className="overflow-x-auto"><table>
        <thead><tr><th>Supuesto</th>{cols.map((e) => <th key={e.k} className={e.k === sel.k ? "col-s" : ""}>{e.k === "mtend" ? "Hoy (tendencia)" : e.n}</th>)}</tr></thead>
        <tbody>
          {CAMPOS.map(([k, l, d]) => (
            <tr key={k}><td>{l}</td>{cols.map((e) => {
              if (!editable(e)) return <td key={e.k} className={e.k === sel.k ? "col-s" : ""}>{k === "ajGen" || k === "gP" ? sgn(e.L[k]) + pct1(Math.abs(e.L[k]), 0) : pct1(e.L[k], d)} %</td>;
              const n = e.k.slice(pre.length) as Nivel, c = clave(n, k), [mn, mx] = rango(n, k), mal = errores.includes(c), fijo = mx - mn < 0.0005;
              return (
                <td key={e.k} className={e.k === sel.k ? "col-s" : ""}>
                  <input className="num" disabled={fijo} aria-label={`${l} · ${e.n}`} value={txt[c] ?? pct1(e.L[k], d)} onChange={(ev) => setTxt({ ...txt, [c]: ev.target.value })}
                         style={mal ? { borderColor: "#B42318", background: "#FEF3F2" } : undefined} /> %
                  <div style={{ fontSize: 10.5, color: mal ? "#B42318" : "var(--g2)", marginTop: 2 }}>{fijo ? "igual a los vecinos" : `${pct1(mn, d)} a ${pct1(mx, d)} %`}</div>
                </td>
              );
            })}</tr>
          ))}
          <tr><td>Cumplimiento de la meta de colocación</td>{cols.map((e) => <td key={e.k} className={e.k === sel.k ? "col-s" : ""}>{pct1(e.L.cumpl, 0)} %</td>)}</tr>
        </tbody>
      </table></div>
      {editando && errores.length > 0 && <div className="alerta no-print" style={{ marginTop: 8 }}>Cada escenario debe quedar entre el anterior y el siguiente: corrige los valores marcados.</div>}
      {conMotor && A_tieneAsesores(M, ag) && (
        <div className="no-print flex flex-wrap items-center gap-3 mt-3">
          <b className="text-[13px]">Cumplimiento de la meta de colocación en los escenarios propuestos</b>
          <BotonesVista etiqueta="Cumplimiento" valor={String(cfg.cumplMeta)} onChange={(v) => setCfg({ cumplMeta: v === "null" ? null : Number(v) })} opciones={OPCIONES_CUMPL.map(([v, l]) => ({ id: String(v), label: l }))} />
        </div>
      )}
    </Plegable>
  );
}
const A_tieneAsesores = (M: Mundo, ag: string) => M.ags[ag]?.mix.some((n) => n > 0) ?? false;

// ---------------------------------------------------------------------
// Propuesta del modelo frente al presupuesto: dónde difieren (para revisar el presupuesto)
// ---------------------------------------------------------------------
function FrentePresupuesto({ ag, E, sel, baseModelo, nombres }: { ag: string; E: Escenario[]; sel: Escenario; baseModelo?: Record<string, BaseModelo>; nombres?: Record<string, string> }) {
  const P = E.find((e) => e.k === "pres")!, Mo = sel.k === "pres" ? E.find((e) => e.k === "mtend")! : sel, T = E.find((e) => e.k === "mtend")!;
  const revisar = (p: number, m: number) => Math.abs(m - p) >= Math.max(5000, Math.abs(p) * 0.1);
  const marca = (p: number, m: number) => (revisar(p, m) ? <Chip e="avi">revisar</Chip> : null);
  const lineas: [string, (e: Escenario) => number, number][] = [
    ["Intereses de cartera", (e) => e.R.er.ingCart + e.R.er.ingOtros, 1], ["Otros ingresos financieros", (e) => e.R.er.ingLiq + e.R.er.cobInt, 1],
    ["Intereses y gastos financieros", (e) => e.R.er.costo + e.R.er.pagInt + e.R.er.otrosGF, -1], ["Provisiones", (e) => e.R.er.prov, -1],
    ["Gasto de personal", (e) => e.R.er.personal, -1], ["Gastos generales", (e) => e.R.er.generales, -1],
    ["Otros ingresos", (e) => e.R.er.otrosIng + e.R.er.reversion, 1], ["Otros egresos", (e) => e.R.er.otrosGas, -1],
  ];
  // gastos y otras cuentas: presupuesto frente al ritmo real (Consolidado = suma de las agencias)
  const bases = ag === "Consolidado" ? Object.values(baseModelo ?? {}) : baseModelo?.[ag] ? [baseModelo[ag]] : [];
  const cuentas: Record<string, { pres: number; modelo: number }> = {};
  for (const bm of bases) for (const [k, v] of Object.entries(bm.gastos)) { const c = (cuentas[k] ??= { pres: 0, modelo: 0 }); c.pres += v.pres; c.modelo += v.modelo; }
  const filasC = Object.entries(cuentas).filter(([, v]) => Math.abs(v.pres) + Math.abs(v.modelo) > 500).sort((a, b) => Math.abs(b[1].modelo - b[1].pres) - Math.abs(a[1].modelo - a[1].pres));
  const nRev = filasC.filter(([, v]) => revisar(v.pres, v.modelo)).length;
  const tasas = ag === "Consolidado" ? [] : bases[0]?.tasas ?? [];
  const gest: [string, ClavePal | "gV", number][] = [["Recuperación de cartera por vencer", "e", 1], ["Recuperación de cartera vencida al mes", "rv", 2], ["Crecimiento del ahorro a la vista", "gV", 1], ["Crecimiento de depósitos a plazo", "gP", 1], ["Cumplimiento de la meta de colocación", "cumpl", 0]];
  const nombre = (k: string) => (k.endsWith("99") ? `${k.slice(0, 4)} · otras` : nombreCuenta(k, nombres));
  return (<>
    <div className="subsec">
      <h5>Estado de resultados · presupuesto frente a {Mo.k === "mtend" ? "la tendencia real" : `el escenario ${Mo.n.toLowerCase()}`}</h5>
      <table><thead><tr><th>Concepto</th><th>Presupuesto</th><th className="col-s">{Mo.k === "mtend" ? "Tendencia real" : Mo.n}</th><th>Diferencia</th><th /></tr></thead>
        <tbody>{lineas.map(([l, f, m]) => <tr key={l}><td>{l}</td><td>{usd(f(P))}</td><td className="col-s">{usd(f(Mo))}</td><td><Dif a={f(P)} b={f(Mo)} mejor={m} /></td><td>{marca(f(P), f(Mo))}</td></tr>)}
          <tr className="tot"><td>Utilidad</td><td>{usd(P.R.kpi.util)}</td><td className="col-s">{usd(Mo.R.kpi.util)}</td><td><Dif a={P.R.kpi.util} b={Mo.R.kpi.util} /></td><td /></tr></tbody></table>
    </div>
    {tasas.length > 0 && <div className="subsec">
      <h5>Tasas · presupuesto frente a lo real de los últimos 12 meses</h5>
      <table><thead><tr><th>Producto</th><th>Presupuesto</th><th className="col-s">Real</th><th>Diferencia</th></tr></thead>
        <tbody>{tasas.map((t) => <tr key={t.prod}><td>{t.prod}</td><td>{pc(t.pres, 2)}</td><td className="col-s">{pc(t.modelo, 2)}</td><td><Dif a={t.pres} b={t.modelo} mejor={0} f={fpts} umbral={0.0001} /></td></tr>)}</tbody></table>
    </div>}
    <div className="subsec">
      <h5>Gestión · presupuesto frente a lo real</h5>
      <table><thead><tr><th>Supuesto</th><th>Presupuesto</th><th className="col-s">Real (hoy)</th><th>Diferencia</th></tr></thead>
        <tbody>{gest.map(([l, k, d]) => <tr key={l}><td>{l}</td><td>{pct1(P.L[k], d)} %</td><td className="col-s">{pct1(T.L[k], d)} %</td><td><Dif a={P.L[k]} b={T.L[k]} mejor={0} f={fpts} umbral={0.0005} /></td></tr>)}</tbody></table>
    </div>
    {filasC.length > 0 && <div className="subsec">
      <h5>Gastos y otras cuentas · presupuesto frente al ritmo real{nRev ? ` · ${nRev} por revisar` : ""}</h5>
      <table><thead><tr><th>Cuenta</th><th>Presupuesto</th><th className="col-s">Ritmo real</th><th>Diferencia</th><th>%</th><th /></tr></thead>
        <tbody>{filasC.slice(0, 30).map(([k, v]) => <tr key={k}><td>{k.slice(0, 4)}.{k.slice(4)} {nombre(k)}</td><td>{usd(v.pres)}</td><td className="col-s">{usd(v.modelo)}</td><td><Dif a={v.pres} b={v.modelo} mejor={0} /></td><td>{v.pres ? pc((v.modelo - v.pres) / Math.abs(v.pres), 0) : "—"}</td><td>{marca(v.pres, v.modelo)}</td></tr>)}
          <tr className="tot"><td>Total</td><td>{usd(filasC.reduce((t, [, v]) => t + v.pres, 0))}</td><td className="col-s">{usd(filasC.reduce((t, [, v]) => t + v.modelo, 0))}</td><td><Dif a={filasC.reduce((t, [, v]) => t + v.pres, 0)} b={filasC.reduce((t, [, v]) => t + v.modelo, 0)} mejor={0} /></td><td /><td /></tr></tbody></table>
    </div>}
  </>);
}

/** Sección desplegable del informe (se abre toda al imprimir). */
function Plegable({ t, children, abierto }: { t: ReactNode; children: ReactNode; abierto?: boolean }) {
  return <section className="sec"><details open={abierto}><summary><h4 style={{ display: "inline-flex" }}>{t}</h4></summary><div style={{ marginTop: 10 }}>{children}</div></details></section>;
}
