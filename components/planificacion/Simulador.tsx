"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RotateCcw, Save } from "lucide-react";
import { correr, copiaL, activos, objetivo, tasaInterna, PROD, type Mundo, type Pal, type Corrida } from "../../lib/calc/plan2027";
import { usd, mill, pc, Escalones, BOTON, BOTON_STYLE } from "./Comun";
import { Dif, Semaforo, Chip, sgn, num1, ent, fpts, TablaER, TablaBalance, TablaSupuestos, LineaMora, realDe, type Escenario } from "./Integrado";

/**
 * SIMULADOR: ajuste fino de un escenario. Parte del escenario elegido (las marcas negras de cada barra) y todo se
 * recalcula al instante: asesores, provisión, fondeo, estado de resultados y balance. Cada barra dice cuánto vale
 * y avisa cuando se pide más que el escenario optimista. Se guarda como Borrador o Aprobado (no toca el presupuesto).
 */
type Clave = "cumpl" | "e" | "rv" | "k" | "gV" | "gP" | "incSal" | "ajGen";
interface DefPal { id: string; etiqueta: string; valor: number; min: number; max: number; paso: number; fmt: (v: number) => string; ref: number; aplicar: (X: Pal, v: number) => void; aviso?: { max?: number; min?: number; t: string }; vale: (X: Pal) => void; unidad: string }

function Palanca({ d, alCambiar, hint }: { d: DefPal; alCambiar: (v: number) => void; hint: ReactNode }) {
  const pos = Math.max(0, Math.min(100, (d.ref - d.min) / (d.max - d.min) * 100));
  const avisa = d.aviso && ((d.aviso.max !== undefined && d.valor > d.aviso.max + 1e-6) || (d.aviso.min !== undefined && d.valor < d.aviso.min - 1e-6));
  return (
    <div className="lev">
      <div className="fila"><span>{d.etiqueta}</span><span className={`val ${Math.abs(d.valor - d.ref) > 1e-9 ? "c" : ""}`}>{d.fmt(d.valor)}</span></div>
      <div className="pista"><input type="range" min={d.min} max={d.max} step={d.paso} value={d.valor} aria-label={d.etiqueta} onChange={(e) => alCambiar(Number(e.target.value))} /><span className="marca" style={{ left: `calc(${pos}% - 1px)` }} /></div>
      <div className="ref"><span>base {d.fmt(d.ref)}</span><span>{hint}</span></div>
      {avisa && <div style={{ marginTop: 3 }}><Chip e="avi">{d.aviso!.t}</Chip></div>}
    </div>
  );
}

export function Simulador({ M, ag, E, simBase, setSimBase, S0, L, setL, metaU, onGuardar }: {
  M: Mundo; ag: string; E: Escenario[]; simBase: string; setSimBase: (k: string) => void; S0: Pal; L: Pal; setL: (L: Pal) => void;
  metaU: number; onGuardar: (nombre: string, estado: "Borrador" | "Aprobado", L: Pal) => Promise<void>;
}) {
  const A = M.ags[ag], b = A.base, c = A.calib, act = activos(A), O = objetivo(M, A), n0 = A.mix[0] + A.mix[1] + A.mix[2];
  const base = E.find((e) => e.k === simBase) ?? E[0], nb = base.n;
  const P = useMemo(() => correr(M, A, S0), [M, A, S0]);
  const S = useMemo(() => correr(M, A, L), [M, A, L]);
  const R0 = useMemo(() => realDe(A), [A]);
  const cambiar = (f: (X: Pal) => void) => { const X = copiaL(L); f(X); setL(X); };
  const fCrec = (v: number) => sgn(v) + num1(Math.abs(v)) + " %", fPc = (v: number) => num1(v) + " %";
  const val = (k: Clave) => L[k] * 100, ref = (k: Clave) => S0[k] * 100;
  const pal = (k: Clave, etiqueta: string, min: number, max: number, paso: number, fmt: (v: number) => string, unidad: string, pasoVale: number, aviso?: DefPal["aviso"]): DefPal =>
    ({ id: k, etiqueta, valor: val(k), min, max, paso, fmt, ref: ref(k), aplicar: (X, v) => { X[k] = v / 100; }, aviso, vale: (X) => { X[k] += pasoVale; }, unidad });
  // colocación: asesores × meta de cada rango × cumplimiento (como en el presupuesto); los nuevos entran como Junior
  const asesDef: DefPal = { id: "ases", etiqueta: "Asesores de crédito", valor: L.asesFijo ?? n0, min: Math.max(0, n0 - 5), max: n0 + 15, paso: 1, fmt: ent, ref: S0.asesFijo ?? n0, aplicar: (X, v) => { X.asesFijo = v; }, vale: (X) => { X.asesFijo = (X.asesFijo ?? n0) + 1; }, unidad: "+1 asesor" };
  const grupos: [string, DefPal[]][] = [
    ["1 · Colocación", [asesDef, pal("cumpl", "Cumplimiento de la meta de colocación", 10, 120, 1, (v) => ent(v) + " %", "+1 pt", 0.01, { max: 100, t: "más que la meta de los asesores" })]],
    ["2 · Recuperación", [
      pal("e", "Recuperación de cartera por vencer", 40, 100, 0.5, fPc, "+1 pt", 0.01, { max: O.e * 100, t: `más que el optimista (${pc(O.e)})` }),
      pal("rv", "Recuperación mensual de la vencida", 0, 8, 0.1, fPc, "+0,1 pt", 0.001, { max: O.rv * 100, t: `más que el optimista (${pc(O.rv)})` }),
    ]],
    ["3 · Captaciones", [
      pal("gV", "Crecimiento del ahorro a la vista", -30, 40, 1, fCrec, "+1 %", 0.01, { max: 20, t: "más de 20 % al año" }),
      pal("gP", "Crecimiento de depósitos a plazo", -30, 40, 1, fCrec, "+1 %", 0.01, { max: 20, t: "más de 20 % al año" }),
    ]],
    ["4 · Gastos", [
      pal("ajGen", "Gastos ajustables", -30, 30, 1, fCrec, "+1 %", 0.01, { min: O.ajGen * 100, t: `recorte mayor que el optimista (${pc(O.ajGen, 0)})` }),
    ]],
  ];
  const hint = (d: DefPal) => { const X = copiaL(L); d.vale(X); const dd = correr(M, A, X).kpi.util - S.kpi.util; return Math.abs(dd) < 50 ? null : <>{d.unidad} ≈ <span className={dd >= 0 ? "up" : "dn"}>{sgn(dd)}{usd(Math.abs(dd)).replace(/[()]/g, "")}</span></>; };

  const K: [string, number, number, (v: number) => string, number, (v: number) => string][] = [
    [`Utilidad ${Number(b.periodo.slice(0, 4)) + 1}`, P.kpi.util, S.kpi.util, mill, 1, usd], ["ROA", P.kpi.roa, S.kpi.roa, (x) => pc(x, 2), 1, fpts],
    ["Morosidad dic", P.kpi.mora, S.kpi.mora, (x) => pc(x), -1, fpts], ["Gasto ÷ margen", P.kpi.efic, S.kpi.efic, (x) => pc(x, 0), -1, fpts],
    ["Captación ÷ cartera", P.kpi.autof, S.kpi.autof, (x) => x.toFixed(2).replace(".", ","), 1, (x) => x.toFixed(2).replace(".", ",")], ["Asesores", P.kpi.ases, S.kpi.ases, ent, 0, ent],
  ];
  const ef = (l: string, a: number, s: number, m = 1, f: (v: number) => string = usd, u?: number) => (Math.abs(s - a) < (u ?? (f === usd ? 50 : 1e-4)) ? null : <div className="ef" key={l}><span>{l}</span><Dif a={a} b={s} mejor={m} f={f} umbral={u} /></div>);
  const posA = P.bal.envia - P.bal.recibe, posS = S.bal.envia - S.bal.recibe;
  const cols: ReactNode[][] = [
    [ef("Colocación mensual", P.col.colMes, S.col.colMes, 0), ef("Asesores", P.col.necesarios, S.col.necesarios, 0, ent, 0.5), ef("Costo de asesores", Math.max(0, P.col.nuevos) * M.sup.costoAsesor, Math.max(0, S.col.nuevos) * M.sup.costoAsesor, -1), ef("Cuotas cobradas en el año", P.rec.cob, S.rec.cob), ef("Vencida recuperada en el año", P.rec.rec, S.rec.rec)],
    [ef("Cartera bruta dic", P.bal.cart, S.bal.cart, 0), ef("Cartera vencida dic", P.bal.v, S.bal.v, -1), ef("Morosidad", P.kpi.mora, S.kpi.mora, -1, fpts, 0.0005), ef("Castigos del año", P.rec.cas, S.rec.cas, -1), ef("Provisión constituida", P.er.provCart, S.er.provCart, -1)],
    [ef("Captaciones dic", P.bal.capt, S.bal.capt, 0), ef("Fondos disponibles", P.bal.liq, S.bal.liq, 0), ef("Posición con otras oficinas", posA, posS, 0), ef("Interés con otras oficinas (neto)", P.er.cobInt - P.er.pagInt, S.er.cobInt - S.er.pagInt), ef("Costo de captaciones", P.er.costo, S.er.costo, -1)],
    [ef("Intereses de cartera", P.er.ingCart, S.er.ingCart), ef("Intereses de mora cobrados", P.er.ingMora, S.er.ingMora), ef("Reversión de provisiones", P.er.reversion, S.er.reversion), ef("Gasto de personal", P.er.personal, S.er.personal, -1), ef("Gastos generales", P.er.generales, S.er.generales, -1), ef("Utilidad", P.kpi.util, S.kpi.util)],
  ].map((x) => x.filter(Boolean));
  const hay = cols.some((x) => x.length);
  const pasosPuente = ([["Intereses de cartera", S.er.ingCart + S.er.ingOtros - P.er.ingCart - P.er.ingOtros], ["Provisiones", -(S.er.prov - P.er.prov)], ["Reversión de provisiones", S.er.reversion - P.er.reversion],
    ["Captaciones", -(S.er.costo - P.er.costo) + (S.er.ingLiq - P.er.ingLiq)], ["Otras oficinas", (S.er.cobInt - S.er.pagInt) - (P.er.cobInt - P.er.pagInt)],
    ["Personal", -(S.er.personal - P.er.personal)], ["Gastos generales", -(S.er.generales - P.er.generales)]] as [string, number][]).filter(([, v]) => Math.abs(v) >= 100);

  const fila = (l: string, a: number, s: number, m = 1, f: (v: number) => string = usd, cls = "") => <tr key={l} className={cls}><td>{l}</td><td>{f(a)}</td><td className="col-s">{f(s)}</td><td><Dif a={a} b={s} mejor={m} f={f} /></td></tr>;
  const cab = (t = "Concepto") => <thead><tr><th>{t}</th><th>{nb}</th><th className="col-s">Simulado</th><th>Diferencia</th></tr></thead>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px]" style={{ color: "var(--g)" }}>
        <b style={{ color: "var(--t)" }}>Partir de</b>
        <span className="seg">{E.map((e) => <button key={e.k} type="button" className={e.k === simBase ? "on" : ""} onClick={() => setSimBase(e.k)}>{e.n}</button>)}</span>
        <span className="flex-1" />
        <button type="button" className={BOTON} style={BOTON_STYLE} onClick={() => setL(copiaL(S0))}><RotateCcw className="w-4 h-4" />Volver a la base</button>
        <Guardar onGuardar={(n, e) => onGuardar(n, e, L)} />
      </div>

      <div className="sim">
        <aside className="card pal">
          {grupos.map(([t, defs], gi) => (
            <div className="grupo" key={t}>
              <h5>{t}</h5>
              {defs.map((d) => <Palanca key={d.id} d={d} hint={hint(d)} alCambiar={(v) => cambiar((X) => d.aplicar(X, v))} />)}
              {gi === 0 && (
                <div className="derivado">
                  <div className="r" style={{ marginTop: 0 }}><span>Asesores</span><b style={{ fontSize: 15 }}>{S.col.necesarios}</b></div>
                  <div className="r"><span>Hoy {n0} ({A.mix[0]} Junior · {A.mix[1]} Senior · {A.mix[2]} Master)</span><span className={S.col.nuevos > 0 ? "up" : S.col.nuevos < 0 ? "dn" : "dim"}>{S.col.nuevos > 0 ? `+${S.col.nuevos} Junior` : S.col.nuevos < 0 ? String(S.col.nuevos) : "sin cambios"}</span></div>
                  <div className="r"><span>Colocación del mes</span><span>{usd(S.col.colMes)}</span></div>
                  {act.map((i) => <div className="r" key={i}><span>{PROD[i]} crece</span><span>{sgn(S.col.crecLogrado[i])}{num1(Math.abs(S.col.crecLogrado[i]))} %</span></div>)}
                </div>
              )}
            </div>
          ))}
          <div className="grupo"><h5>Parámetros fijos</h5>
            {act.map((i) => <div className="fijo" key={i}><span>Tasa {PROD[i]} · plazo {c.plazo[i]} meses</span><b>{pc(c.pres.tasa[i], 2)}</b></div>)}
            <div className="fijo"><span>Ahorro a la vista · plazo fijo</span><b>{pc(b.tasaVista, 2)} · {pc(b.tasaPlazo, 2)}</b></div>
            <div className="fijo"><span>Tasa con otras oficinas</span><b>{pc(tasaInterna(b), 2)}</b></div>
            <div className="fijo"><span>Meta mensual Junior · Senior · Master</span><b>{A.metas.map((m) => `$${Math.round(m / 1000)} mil`).join(" · ")}</b></div>
            <div className="fijo"><span>Costo anual por asesor</span><b>{usd(M.sup.costoAsesor)}</b></div>
          </div>
        </aside>

        <div className="flex flex-col min-w-0">
          <div className="kpis">{K.map(([t, a, s, f, m, fd]) => <div className="kp" key={t}><div className="t">{t}</div><div className="v">{f(s)}</div><div className="d">{nb.toLowerCase()} {f(a)} · <Dif a={a} b={s} mejor={m} f={fd} /></div></div>)}</div>
          <div className="card">
            <div className="ch"><h3>Qué cambia con tus decisiones</h3><span className="s">{ag === "Consolidado" ? "Meta de la cooperativa" : "Meta asignada"} {mill(metaU)} <Semaforo u={S.kpi.util} meta={metaU} /></span></div>
            {hay ? <div className="cadena">{["Gestión comercial", "Cartera y riesgo", "Fondeo y liquidez", "Resultado"].map((t, i) => <div className="eslabon" key={t}><h6>{t}</h6>{cols[i].length ? cols[i] : <span className="dim">Sin cambios</span>}</div>)}</div>
              : <div className="vacio">Sin cambios frente a {nb.toLowerCase()}.</div>}
            {hay && pasosPuente.length > 0 && <div style={{ padding: "4px 16px 10px", borderTop: "1px solid var(--b)" }}><Escalones inicio={[nb, P.kpi.util]} pasos={pasosPuente} final={["Simulado", S.kpi.util]} /></div>}
          </div>
          <Plegable t="Colocación y asesores">
            <table>{cab()}<tbody>
              <tr className="grp"><td colSpan={4}>Colocación mensual por producto</td></tr>
              {act.map((i) => fila(`${PROD[i]} · crece ${num1(S.col.crecLogrado[i])} %`, P.col.X[i], S.col.X[i], 0, usd, "sub"))}
              {fila("Colocación mensual total", P.col.colMes, S.col.colMes, 0, usd, "tot")}{fila("Colocación del año", P.col.colMes * 12, S.col.colMes * 12, 0)}
              <tr className="grp"><td colSpan={4}>Equipo comercial</td></tr>
              {fila("Meta mensual del equipo actual", P.col.cap, S.col.cap, 0)}{fila("Cumplimiento de la meta", S0.cumpl, L.cumpl, 1, (x) => pc(x, 0))}
              {fila("Asesores", P.col.necesarios, S.col.necesarios, 0, ent)}{fila("Colocación por asesor al mes", P.col.porAsesor, S.col.porAsesor)}{fila("Costo anual de asesores nuevos", Math.max(0, P.col.nuevos) * M.sup.costoAsesor, Math.max(0, S.col.nuevos) * M.sup.costoAsesor, -1)}
            </tbody></table>
          </Plegable>
          <Plegable t="Recuperación de cartera">
            <Recuperacion P={P} S={S} S0={S0} L={L} cab={cab} fila={fila} />
            <div style={{ padding: "6px 16px 12px" }}><LineaMora A={A} P={P} S={S} base={nb} /></div>
          </Plegable>
          <Plegable t={`Estado de resultados ${Number(b.periodo.slice(0, 4)) + 1}`}><TablaER A={A} Rr={R0} P={P} S={S} cols={[`Real ${b.periodo.slice(0, 4)}`, nb, "Simulado"]} /></Plegable>
          <Plegable t="Balance a diciembre"><TablaBalance Rr={R0} P={P} S={S} base={nb} /></Plegable>
          <Plegable t="Supuestos del modelo"><TablaSupuestos M={M} A={A} /></Plegable>
        </div>
      </div>
    </div>
  );
}

function Recuperacion({ P, S, S0, L, cab, fila }: { P: Corrida; S: Corrida; S0: Pal; L: Pal; cab: (t?: string) => ReactNode; fila: (l: string, a: number, s: number, m?: number, f?: (v: number) => string, cls?: string) => ReactNode }) {
  return (
    <div className="dos">
      <div><div className="sub-h">Cartera por vencer: cuotas del año</div><table>{cab("")}<tbody>
        {fila("Cuotas que vencen", P.rec.due, S.rec.due, 0)}{fila("Cobradas a tiempo", P.rec.cob, S.rec.cob)}{fila("Pasan a vencida", P.rec.mig, S.rec.mig, -1)}
        {fila("Cobradas al mes", P.rec.cob / 12, S.rec.cob / 12, 1, usd, "tot")}{fila("Efectividad", S0.e, L.e, 1, (x) => pc(x))}</tbody></table></div>
      <div><div className="sub-h">Cartera vencida: movimiento del año</div><table>{cab("")}<tbody>
        {fila("Saldo al inicio", P.rec.vIni, S.rec.vIni, 0)}{fila("+ Entra desde por vencer", P.rec.mig, S.rec.mig, -1)}{fila("− Recuperada", P.rec.rec, S.rec.rec)}{fila("− Castigada", P.rec.cas, S.rec.cas, -1)}
        {fila("Saldo a diciembre", P.rec.vFin, S.rec.vFin, -1, usd, "tot")}{fila("Recuperada al mes", P.rec.rec / 12, S.rec.rec / 12)}{fila("Morosidad a diciembre", P.kpi.mora, S.kpi.mora, -1, (x) => pc(x))}</tbody></table></div>
    </div>
  );
}

function Plegable({ t, s, children }: { t: string; s?: string; children: ReactNode }) {
  return <details className="card"><summary className="ch"><h3>{t}</h3>{s && <span className="s">{s}</span>}</summary><div className="overflow-x-auto">{children}</div></details>;
}

function Guardar({ onGuardar }: { onGuardar: (nombre: string, estado: "Borrador" | "Aprobado") => Promise<void> }) {
  const [nombre, setNombre] = useState(""), [estado, setEstado] = useState<"Borrador" | "Aprobado">("Borrador");
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null), [ocupado, setOcupado] = useState(false);
  const guardar = async () => {
    if (!nombre.trim()) return;
    setOcupado(true); setMsg(null);
    try { await onGuardar(nombre.trim(), estado); setMsg({ t: `Guardado: ${nombre.trim()} · ${estado}` }); setNombre(""); }
    catch { setMsg({ t: "No se pudo guardar", e: true }); } finally { setOcupado(false); }
  };
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guardar(); }} placeholder="Nombre del escenario" maxLength={80}
             className="h-8 w-52 rounded-md px-2 text-[12px] bg-white" style={{ border: "1px solid #C9D0CC" }} />
      <span className="seg">{(["Borrador", "Aprobado"] as const).map((x) => <button key={x} type="button" className={estado === x ? "on" : ""} onClick={() => setEstado(x)}>{x}</button>)}</span>
      <button type="button" disabled={ocupado || !nombre.trim()} onClick={guardar} className={`${BOTON} text-white disabled:opacity-60`} style={{ background: "var(--v)" }}><Save className="w-4 h-4" />{ocupado ? "Guardando…" : "Guardar escenario"}</button>
      {msg && <span className="text-[12px]" style={{ color: msg.e ? "var(--al)" : "var(--v2)" }}>{msg.t}</span>}
    </span>
  );
}
