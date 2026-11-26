"use client";
/**
 * PLANIFICACIÓN → 14 · CARTERA: vistas «Crecimiento» y «Morosidad» de las 10 agencias.
 *  - Crecimiento: cartera bruta de hoy (balance de partida) → cierre de diciembre del presupuesto, por agencia, y la meta de
 *    crecimiento de la cartera bruta consolidada. Modo «cada agencia» (cada una con su cumplimiento hasta crecer la meta) o
 *    «mismo cumplimiento» (todas por el mismo factor). Sin pasar de 100 % de la meta de los asesores (sus metas no cambian).
 *  - Morosidad: morosidad de hoy y del presupuesto por agencia, y la meta consolidada («todas mejoran», lib/calc/meta-morosidad):
 *    esfuerzo parejo hacia su mejor mes real (pase a riesgo y recuperación de vencida) y ninguna agencia sin mejorar; la que
 *    no llega con su mejor mes sube su meta de recuperación de vencida (se marca).
 * Todo con el motor del presupuesto; «Aplicar» guarda en los supuestos de cartera de cada agencia (los mismos de Cartera →
 * Tasas y recuperación / Colocación), con copia para deshacer: cartera, intereses, provisión, ER y balance se recalculan.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/useDatos";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import { CODIGOS_CARTERA } from "../../lib/calc/orquestador";
import { resolverTodasMejoran, type AgenciaMora, type ResultadoMeta } from "../../lib/calc/meta-morosidad";
import { NOMBRE_LINEA, type HistoricoEstudio, type VersionCartera } from "../../lib/calc/estudio-agencia";
import { versionPres, insumosCartera, correrCartera, idoneoAgencia, realidadCartera } from "./EstudioCartera";
import { ORDEN_OFICINAS } from "./Integrado";
import { E, NUM, T, u } from "./EstudioComun";
import { Formula } from "../ProvisionFlowParametros";
import { ejercicioEnUso } from "../../lib/seleccion";

type Motor = Record<string, { am?: unknown }>;
const AGENCIAS = ORDEN_OFICINAS.filter((a) => a !== "Consolidado");
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d).replace(".", ",")} %`);
const leerPct = (t: string) => { const n = Number(t.replace("%", "").replace(",", ".").trim()); return Number.isFinite(n) ? n / 100 : null; };
const pausa = () => new Promise((r) => setTimeout(r, 0));
const suma = (ks: string[], s: Record<string, unknown>) => ks.reduce((t, k) => t + Math.abs(Number(s[k]) || 0), 0);
const L = Object.values(CODIGOS_CARTERA);
/** Cartera bruta y en riesgo del balance de partida (hoy). */
function deHoy(am: AgenciaMotor) {
  const s = am.ins.saldos as unknown as Record<string, unknown>;
  const r = suma(L.flatMap((l) => l.enRiesgo), s), b = r + suma(L.flatMap((l) => l.porVencer), s);
  return { bruta: b, riesgo: r, mora: b > 0 ? r / b : null };
}
const finDe = (c: Corrida) => { const m = c.meses[11]; return { bruta: m.cart, riesgo: m.mora * m.cart, mora: m.mora, util: c.kpi.util, col: c.meses.reduce((t, x) => t + x.coloc, 0) }; };
type Fin = ReturnType<typeof finDe>;

async function guardar(ag: string, am: AgenciaMotor, v: VersionCartera, origen: string) {
  const pres = versionPres(am), ins = insumosCartera(am, pres, v);
  const r = await apiFetch("/api/estudio-agencia", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agencia: ag, accion: "aplicar", origen, filas: ins.filas, cumplimiento: ins.cumplimiento, factorMora: ins.factorMora, interesMora: ins.interesMora }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
}

function Kpi({ t, v, s, c }: { t: string; v: string; s?: string; c?: string }) {
  return (
    <div className="rounded-lg px-4 py-3 flex flex-col gap-0.5" style={{ border: `1px solid ${E.linea}`, background: "#fff" }}>
      <span className="text-[12px]" style={{ color: E.gris }}>{t}</span>
      <b className="text-[20px]" style={NUM}>{v}</b>
      {s && <span className="text-[12px]" style={{ color: c ?? E.tenue }}>{s}</span>}
    </div>
  );
}
function Barra({ p }: { p: number }) {
  const w = Math.min(100, (Math.abs(p) / 0.25) * 100), col = p < 0 ? E.alerta : p > 0.08 ? E.oro : E.verde;
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="relative inline-block w-[80px] h-[7px] rounded" style={{ background: E.fondo }}>
        <span className="absolute top-0 bottom-0 rounded" style={{ background: col, ...(p < 0 ? { right: "50%", width: `${w / 2}%` } : { left: 0, width: `${w}%` }) }} />
      </span>
      <b className="w-[52px] text-right" style={{ color: col }}>{pc(p)}</b>
    </span>
  );
}
function Barra2({ txt, valor, onValor, onCalcular, corriendo, extra }: { txt: string; valor: string; onValor: (s: string) => void; onCalcular: () => void; corriendo: string | null; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-2 text-[13px]">{txt}
        <input value={valor} onChange={(e) => onValor(e.target.value)} inputMode="decimal" aria-label={txt}
          className="h-8 w-[64px] rounded-md px-2 text-right bg-white" style={{ border: "1px solid #BFD6C8" }} /> %</label>
      {extra}
      <button type="button" disabled={!!corriendo} onClick={onCalcular} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-60" style={{ background: E.verde }}>{corriendo ?? "Calcular"}</button>
    </div>
  );
}

/** Las agencias con su motor y su corrida del presupuesto (se recalcula cuando cambia el presupuesto). */
function useBase(motor: Motor) {
  const listos = AGENCIAS.every((a) => motor[a]?.am);
  return useMemo(() => {
    if (!listos) return null;
    return AGENCIAS.map((a) => {
      const am = motor[a].am as AgenciaMotor;
      if (!am.ins.paramsCredito.length) return null;
      return { a, am, pres: versionPres(am), hoy: deHoy(am), base: finDe(correrVersion(am, {})) };
    }).filter((x): x is NonNullable<typeof x> => !!x);
  }, [motor, listos]);
}

// =====================================================================
// CRECIMIENTO
// =====================================================================
type ModoCrec = "agencia" | "parejo";
export function CrecimientoPanel({ motor }: { motor: Motor }) {
  const ags = useBase(motor);
  const ej = ejercicioEnUso();
  const [txt, setTxt] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoCrec>("agencia");
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [prop0, setProp] = useState<{ de: unknown; meta: number; modo: ModoCrec; filas: { a: string; cumpl: number; fin: Fin; alcanza: boolean }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // la propuesta es del presupuesto con que se calculó: si el presupuesto cambia, se descarta
  const prop = prop0 && prop0.de === ags ? prop0 : null;
  if (!ags) return <p className="text-[13px] py-4" style={{ color: E.gris }}>Leyendo el presupuesto de las agencias…</p>;
  const hoyT = ags.reduce((t, x) => t + x.hoy.bruta, 0), finT = ags.reduce((t, x) => t + x.base.bruta, 0), colT = ags.reduce((t, x) => t + x.base.col, 0);
  const actual = hoyT ? finT / hoyT - 1 : 0;
  const metaTxt = txt ?? (actual * 100).toFixed(1).replace(".", ",");

  const calcular = async () => {
    const meta = leerPct(metaTxt);
    if (meta === null) return;
    setMsg(null);
    const correr = new Map<string, (c: number) => Fin>();
    for (const x of ags) { const mem = new Map<number, Fin>(); correr.set(x.a, (c) => { const k = Math.round(c * 1e4); if (!mem.has(k)) mem.set(k, Math.abs(c - x.pres.cumpl) < 1e-6 ? x.base : finDe(correrCartera(x.am, x.pres, { ...x.pres, cumpl: c })!)); return mem.get(k)!; }); }
    const filas: { a: string; cumpl: number; fin: Fin; alcanza: boolean }[] = [];
    if (modo === "agencia") {
      for (const x of ags) {
        setCorriendo(`Calculando… ${x.a}`); await pausa();
        const f = correr.get(x.a)!, obj = x.hoy.bruta * (1 + meta);
        let lo = 0, hi = 1;
        const alcanza = f(1).bruta >= obj;
        if (!alcanza) lo = 1; else if (f(0).bruta > obj) hi = 0;
        else for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (f(m).bruta < obj) lo = m; else hi = m; }
        const c = (lo + hi) / 2; filas.push({ a: x.a, cumpl: c, fin: f(c), alcanza });
      }
    } else {
      setCorriendo("Calculando…"); await pausa();
      const cumplK = (x: NonNullable<typeof ags>[number], k: number) => Math.min(1, x.pres.cumpl * k);
      const total = (k: number) => ags.reduce((t, x) => t + correr.get(x.a)!(cumplK(x, k)).bruta, 0), obj = hoyT * (1 + meta);
      let lo = 0, hi = Math.max(1, ...ags.map((x) => (x.pres.cumpl > 0 ? 1 / x.pres.cumpl : 1)));
      const alcanza = total(hi) >= obj;
      if (!alcanza) lo = hi; else for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (total(m) < obj) lo = m; else hi = m; }
      const k = (lo + hi) / 2;
      for (const x of ags) filas.push({ a: x.a, cumpl: cumplK(x, k), fin: correr.get(x.a)!(cumplK(x, k)), alcanza });
    }
    setProp({ de: ags, meta, modo, filas }); setCorriendo(null);
  };
  const aplicar = async () => {
    if (!prop) return;
    const cambian = prop.filas.filter((f) => Math.abs(f.cumpl - (ags.find((x) => x.a === f.a)?.pres.cumpl ?? f.cumpl)) > 1e-4);
    if (!cambian.length || !window.confirm(`Se guardará el cumplimiento de la colocación en ${cambian.length} agencias. Cada una guarda una copia para deshacer. ¿Continuar?`)) return;
    const err: string[] = [];
    for (const f of cambian) {
      setCorriendo(`Aplicando… ${f.a}`);
      const x = ags.find((y) => y.a === f.a)!;
      try { await guardar(f.a, x.am, { ...x.pres, cumpl: f.cumpl }, `Cartera, crecimiento de cartera bruta ${pc(prop.meta)} (${prop.modo === "agencia" ? "cada agencia" : "mismo cumplimiento"})`); }
      catch (e) { err.push(`${f.a}: ${e instanceof Error ? e.message : "error"}`); }
    }
    setCorriendo(null); setMsg(err.length ? `No se pudo guardar en: ${err.join("; ")}` : "Guardado. El presupuesto se recalcula en unos segundos.");
  };
  const conP = prop ? new Map(prop.filas.map((f) => [f.a, f])) : null;
  const finP = prop ? prop.filas.reduce((t, f) => t + f.fin.bruta, 0) : null, colP = prop ? prop.filas.reduce((t, f) => t + f.fin.col, 0) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Kpi t="Cartera bruta hoy" v={u(hoyT)} s="Balance de partida" />
        <Kpi t={`Cierre dic-${ej}`} v={u(finP ?? finT)} s={`${pc(finP !== null && hoyT ? finP / hoyT - 1 : actual)} en el año${prop ? " · propuesta" : ""}`} c={E.verde} />
        <Kpi t="Colocación del año" v={u(colP ?? colT)} s={`${u((colP ?? colT) / 12)} al mes`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <b className="text-[14px] flex-1">Cuánto crece cada agencia</b>
        <Barra2 txt="Meta de crecimiento" valor={metaTxt} onValor={(s) => { setTxt(s); setProp(null); }} onCalcular={() => void calcular()} corriendo={corriendo}
          extra={<select aria-label="Cómo se reparte" value={modo} onChange={(e) => { setModo(e.target.value as ModoCrec); setProp(null); }} className="h-8 rounded-md px-2 text-[12px] bg-white" style={{ border: `1px solid ${E.linea}` }}>
            <option value="agencia">Cada agencia crece la meta</option><option value="parejo">Mismo cumplimiento para todas</option></select>} />
        <Formula info derecha>Las metas de los asesores no cambian: se ajusta el % de cumplimiento de la colocación, sin pasar de 100 %. «Cada agencia crece la meta»: cada una con su propio cumplimiento. «Mismo cumplimiento»: todas por el mismo factor (las grandes pueden crecer menos y las pequeñas más).</Formula>
      </div>
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <thead><tr style={T.cab}>
            <th className={T.thIzq}>Agencia</th><th className={T.th}>Cartera bruta hoy</th><th className={T.th}>Cierre dic-{ej}</th><th className={T.th}>Crece</th>
            <th className={T.th}>%</th><th className={T.th}>Colocación del año</th><th className={T.th}>Cumplimiento</th>
          </tr></thead>
          <tbody>
            {ags.map((x) => {
              const p = conP?.get(x.a), fin = p?.fin ?? x.base, cr = x.hoy.bruta ? fin.bruta / x.hoy.bruta - 1 : 0;
              return (
                <tr key={x.a} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>{x.a}{p && !p.alcanza && <span className="block text-[11px]" style={{ color: E.oro }}>Con 100 % de su meta no llega</span>}</td>
                  <td className={T.td}>{u(x.hoy.bruta)}</td><td className={T.td} style={{ fontWeight: 600 }}>{u(fin.bruta)}</td>
                  <td className={T.td} style={{ color: fin.bruta < x.hoy.bruta ? E.alerta : undefined }}>{u(fin.bruta - x.hoy.bruta)}</td>
                  <td className={T.td}><Barra p={cr} /></td><td className={T.td}>{u(fin.col)}</td>
                  <td className={T.td}>{p ? <>{pc(x.pres.cumpl, 0)} → <b style={{ color: E.verde }}>{pc(p.cumpl, 0)}</b></> : pc(x.pres.cumpl, 0)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `1px solid ${E.tenue}`, fontWeight: 700, background: E.fondo }}>
              <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>Cooperativa</td><td className={T.td}>{u(hoyT)}</td><td className={T.td}>{u(finP ?? finT)}</td>
              <td className={T.td}>{u((finP ?? finT) - hoyT)}</td><td className={T.td}><Barra p={hoyT ? (finP ?? finT) / hoyT - 1 : 0} /></td><td className={T.td}>{u(colP ?? colT)}</td><td className={T.td} />
            </tr>
          </tbody>
        </table>
      </div>
      {(prop || msg) && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[12px]" style={{ color: msg ? E.verde : E.gris }}>{msg ?? "Propuesta calculada: todavía no se guardó nada."}</span>
          {prop && !msg && <button type="button" onClick={() => setProp(null)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${E.linea}`, color: E.gris }}>Descartar</button>}
          {prop && !msg && <button type="button" disabled={!!corriendo} onClick={() => void aplicar()} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-60" style={{ background: E.verde }}>{corriendo ?? "Aplicar al presupuesto"}</button>}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// MOROSIDAD
// =====================================================================
type VersionMora = { pase: number[]; rv: number[] };
export function MorosidadPanel({ motor }: { motor: Motor }) {
  const ags = useBase(motor);
  const ej = ejercicioEnUso();
  const [txt, setTxt] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [calc0, setCalc] = useState<{ de: unknown; meta: number; res: ResultadoMeta; version: Record<string, VersionMora> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const calc = calc0 && calc0.de === ags ? calc0 : null;
  if (!ags) return <p className="text-[13px] py-4" style={{ color: E.gris }}>Leyendo el presupuesto de las agencias…</p>;
  const S = (f: (x: NonNullable<typeof ags>[number]) => number) => ags.reduce((t, x) => t + f(x), 0);
  const moraHoy = S((x) => x.hoy.riesgo) / Math.max(1, S((x) => x.hoy.bruta)), moraPres = S((x) => x.base.riesgo) / Math.max(1, S((x) => x.base.bruta));
  // meta institucional del presupuesto: 14,5 % (se puede cambiar)
  const metaTxt = txt ?? "14,5";

  const calcular = async () => {
    const meta = leerPct(metaTxt);
    if (meta === null) return;
    setMsg(null);
    const lista: AgenciaMora[] = [];
    const caminos: Record<string, { f: (f: number) => VersionMora; s: (s: number) => VersionMora }> = {};
    for (const x of ags) {
      setCorriendo(`Leyendo… ${x.a}`); await pausa();
      const h = await apiFetch(`/api/estudio-agencia?agencia=${encodeURIComponent(x.a)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as (HistoricoEstudio & { error?: string }) | null;
      const ci = h && !h.error ? idoneoAgencia(x.am, h).calc : null;
      // f = 1: el presupuesto; f = 0: su mejor mes real (pase más bajo, recuperación de vencida más alta); en medio, la misma parte del camino
      const piso = x.pres.pase.map((p, i) => { const t = ci?.pase.find((q) => q.i === i)?.tope; return t === null || t === undefined ? p : Math.min(p, t); });
      const tRv = ci?.filas.find((q) => q.clave === "cv")?.tope ?? null;
      const paseF = (f: number) => x.pres.pase.map((p, i) => piso[i] + f * (p - piso[i]));
      const rvF = (f: number) => x.pres.rv.map((r) => (tRv !== null && tRv > r ? tRv - f * (tRv - r) : r));
      // sobre su mejor mes: s puntos más de recuperación de vencida, como máximo el doble de su mejor mes
      const rv0 = rvF(0), extraMax = Math.max(...rv0, 0);
      caminos[x.a] = { f: (f) => ({ pase: paseF(f), rv: rvF(f) }), s: (s) => ({ pase: paseF(0), rv: rv0.map((r) => r + s) }) };
      const memF = new Map<number, Fin>(), memS = new Map<number, Fin>();
      const correr = (v: VersionMora) => finDe(correrCartera(x.am, x.pres, { ...x.pres, ...v })!);
      lista.push({ agencia: x.a, hoy: x.hoy.mora, brutaHoy: x.hoy.bruta, riesgo: x.base.riesgo, bruta: x.base.bruta, util: x.base.util, extraMax,
        correr: (f) => { const k = Math.round(f * 1e4); if (!memF.has(k)) memF.set(k, correr(caminos[x.a].f(f))); return memF.get(k)!; },
        correrExtra: (s) => { const k = Math.round(s * 1e5); if (!memS.has(k)) memS.set(k, correr(caminos[x.a].s(s))); return memS.get(k)!; } });
    }
    setCorriendo("Calculando…"); await pausa();
    const res = resolverTodasMejoran(lista, meta);
    const version = Object.fromEntries(res.agencias.map((r) => [r.agencia, r.extra > 0 ? caminos[r.agencia].s(r.extra) : caminos[r.agencia].f(r.factor)]));
    setCalc({ de: ags, meta, res, version }); setCorriendo(null);
  };
  const aplicar = async () => {
    if (!calc) return;
    const cambian = calc.res.agencias.filter((x) => Math.abs(x.menosRiesgo) > 0.5);
    if (!cambian.length || !window.confirm(`Se guardará el pase a riesgo y la recuperación de vencida en ${cambian.length} agencias. Cada una guarda una copia para deshacer. ¿Continuar?`)) return;
    const err: string[] = [];
    for (const r of cambian) {
      setCorriendo(`Aplicando… ${r.agencia}`);
      const x = ags.find((y) => y.a === r.agencia)!;
      try { await guardar(r.agencia, x.am, { ...x.pres, ...calc.version[r.agencia] }, `Cartera, meta de morosidad ${pc(calc.res.mora)}`); }
      catch (e) { err.push(`${r.agencia}: ${e instanceof Error ? e.message : "error"}`); }
    }
    setCorriendo(null); setMsg(err.length ? `No se pudo guardar en: ${err.join("; ")}` : "Guardado. El presupuesto se recalcula en unos segundos.");
  };
  const porAg = calc ? new Map(calc.res.agencias.map((r) => [r.agencia, r])) : null;
  const conExtra = calc ? calc.res.agencias.filter((r) => r.extra > 0 && !r.noAlcanza) : [];
  const sinAlcance = calc ? calc.res.agencias.filter((r) => r.noAlcanza) : [];
  // línea de referencia: hoy, presupuesto y meta
  const marcas = [
    { t: "Hoy", v: moraHoy, c: E.gris }, { t: "Presupuesto", v: moraPres, c: E.alerta },
    ...(calc ? [{ t: calc.res.alcanzable ? "Con la meta" : "Lo máximo", v: calc.res.mora, c: E.verde }] : []),
  ];
  // marcas con el mismo valor se juntan en una sola (p. ej. «Presupuesto · Con la meta»)
  const juntas = marcas.reduce<{ t: string; v: number; c: string }[]>((acc, m) => { const x = acc.find((y) => Math.abs(y.v - m.v) < 0.0005); if (x) { x.t = `${x.t} · ${m.t}`; x.c = m.c; } else acc.push({ ...m }); return acc; }, []);
  const vs = juntas.map((m) => m.v), lo = Math.min(...vs) - 0.005, hi = Math.max(...vs) + 0.005;
  const texto = (() => {
    if (msg) return msg;
    if (!calc) return null;
    const partes = [calc.res.alcanzable ? `Cada agencia baja al menos ${pc(calc.res.mejoraMinima, 1)} su morosidad de hoy.` : `La meta de ${pc(calc.meta)} no se alcanza: con el mayor esfuerzo la cooperativa llega a ${pc(calc.res.mora, 2)}.`];
    if (conExtra.length) partes.push(`${conExtra.map((r) => r.agencia).join(", ")}: recuperación sobre su mejor mes.`);
    if (sinAlcance.length) partes.push(`${sinAlcance.map((r) => r.agencia).join(", ")}: no llega${sinAlcance.length > 1 ? "n" : ""} a su objetivo ni con el doble de su mejor mes de recuperación.`);
    return `${partes.join(" ")} Todavía no se guardó nada.`;
  })();
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg px-4 py-3 flex flex-col gap-2" style={{ border: `1px solid ${E.linea}`, background: "#fff" }}>
        <div className="flex flex-wrap items-center gap-3">
          <b className="text-[14px] flex-1">Morosidad consolidada a diciembre {ej}</b>
          <Barra2 txt="Meta" valor={metaTxt} onValor={(s) => { setTxt(s); setCalc(null); }} onCalcular={() => void calcular()} corriendo={corriendo} />
          <Formula info derecha>Todas mejoran: cada agencia termina, como máximo, con su morosidad de hoy bajada en la misma proporción que la cooperativa (meta ÷ morosidad consolidada de hoy). Primero el mismo esfuerzo en todas hacia su mejor mes real sin alivio (pase a riesgo baja, recuperación de vencida sube). La agencia que no llega hace más esfuerzo; si ni con su mejor mes llega, sube su meta de recuperación de vencida sobre su mejor mes (como máximo el doble) y se marca en dorado.</Formula>
        </div>
        <div className="relative h-[58px] mx-2 mt-1">
          <div className="absolute left-0 right-0 top-[24px] h-[6px] rounded" style={{ background: E.fondo }} />
          {juntas.sort((p, q) => p.v - q.v).map((m, i) => {
            const x = ((m.v - lo) / (hi - lo)) * 100;
            return (
              <div key={m.t} className="absolute flex flex-col items-center" style={{ left: `${x}%`, transform: "translateX(-50%)", top: 0 }}>
                <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: m.c, position: "absolute", top: i % 2 ? 40 : 0 }}>{m.t} {pc(m.v, 2)}</span>
                <span className="w-3 h-3 rounded-full" style={{ background: m.c, marginTop: 21, border: "2px solid #fff", boxShadow: `0 0 0 1px ${m.c}` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <thead><tr style={T.cab}>
            <th className={T.thIzq}>Agencia</th><th className={T.th}>Hoy</th><th className={T.th}>Presupuesto</th>
            {calc && <><th className={T.th} style={{ background: E.fondo }}>Con la meta</th><th className={T.th}>Pase a riesgo</th><th className={T.th}>Recuperación vencida</th><th className={T.th}>Menos en riesgo</th></>}
            <th className={T.th}>Cartera en riesgo dic</th>
          </tr></thead>
          <tbody>
            {ags.map((x) => {
              const r = porAg?.get(x.a), sube = x.hoy.mora !== null && x.base.mora > x.hoy.mora + 0.0005;
              const v = calc?.version[x.a];
              const p0 = x.pres.pase.reduce((t, y) => t + y, 0), p1 = v ? v.pase.reduce((t, y) => t + y, 0) : p0;
              const r0 = x.pres.rv[0], r1 = v ? v.rv[0] : r0;
              const mejora = r && r.hoy !== null ? r.mora < r.hoy - 0.0005 : false;
              return (
                <tr key={x.a} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>{x.a}</td>
                  <td className={T.td}>{pc(x.hoy.mora, 2)}</td>
                  <td className={T.td} style={{ color: sube ? E.alerta : undefined }}>{pc(x.base.mora, 2)}</td>
                  {calc && <>
                    <td className={T.td} style={{ background: E.fondo, fontWeight: 600, color: r?.noAlcanza ? E.alerta : mejora ? E.verde : E.gris }}>{pc(r?.mora, 2)}</td>
                    <td className={T.td}>{p0 > 0 && p1 < p0 - 1e-9 ? `−${pc(1 - p1 / p0, 0)}` : "—"}</td>
                    <td className={T.td} style={r && r.extra > 0 ? { color: E.oro, fontWeight: 600 } : undefined}
                      title={r && r.extra > 0 ? `Sobre su mejor mes: +${pc(r.extra, 2)}` : undefined}>{Math.abs(r1 - r0) > 1e-9 ? `${pc(r0, 2)} → ${pc(r1, 2)}` : "—"}</td>
                    <td className={T.td}>{r && Math.abs(r.menosRiesgo) > 0.5 ? u(r.menosRiesgo) : "—"}</td>
                  </>}
                  <td className={T.td}>{u(r?.riesgo ?? x.base.riesgo)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `1px solid ${E.tenue}`, fontWeight: 700, background: E.fondo }}>
              <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>Cooperativa</td><td className={T.td}>{pc(moraHoy, 2)}</td><td className={T.td}>{pc(moraPres, 2)}</td>
              {calc && <><td className={T.td}>{pc(calc.res.mora, 2)}</td><td className={T.td} /><td className={T.td} /><td className={T.td}>{u(S((x) => x.base.riesgo) - calc.res.riesgo)}</td></>}
              <td className={T.td}>{u(calc?.res.riesgo ?? S((x) => x.base.riesgo))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {texto && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[12px]" style={{ color: msg ? E.verde : calc && (!calc.res.alcanzable || sinAlcance.length) ? E.oro : E.gris }}>{texto}</span>
          {calc && !msg && <button type="button" onClick={() => setCalc(null)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${E.linea}`, color: E.gris }}>Descartar</button>}
          {calc && !msg && calc.res.agencias.some((r) => Math.abs(r.menosRiesgo) > 0.5) && <button type="button" disabled={!!corriendo} onClick={() => void aplicar()} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-60" style={{ background: E.verde }}>{corriendo ?? "Aplicar al presupuesto"}</button>}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// EXIGIR A LAS AGENCIAS: meta por agencia de pase a riesgo (por producto) o de recuperación de vencida
// =====================================================================
/** Lo real de cada agencia (jul–oct): pase y cartera por vencer por línea, recuperación de vencida (% del reporte) y su base. */
type RealAg = { pase: (number | null)[]; pv: number[]; cv: number | null; capVen: number };
export function PasePanel({ motor }: { motor: Motor }) {
  const ags = useBase(motor);
  const [tipo, setTipo] = useState<"rec" | "pase">("rec");
  const [linea, setLinea] = useState(3);
  const [reales, setReales] = useState<{ de: unknown; r: Record<string, RealAg> } | null>(null);
  const pedido = useRef<unknown>(null);
  const [metas, setMetas] = useState<Record<string, string>>({});
  const [ajuste, setAjuste] = useState("1");
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [calc0, setCalc] = useState<{ de: unknown; clave: string; filas: Record<string, { base: Fin; fin: Fin }> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // lo real de cada agencia se lee una vez por presupuesto (sin estado síncrono en el efecto)
  useEffect(() => {
    if (!ags || pedido.current === ags) return;
    pedido.current = ags;
    void (async () => {
      const r: Record<string, RealAg> = {};
      for (const x of ags) {
        const h = await apiFetch(`/api/estudio-agencia?agencia=${encodeURIComponent(x.a)}`).then((q) => (q.ok ? q.json() : null)).catch(() => null) as (HistoricoEstudio & { error?: string }) | null;
        const re = h && !h.error ? realidadCartera(x.am, h, x.pres).real : null;
        const conRep = (re?.base ?? []).filter((m) => m.rep);
        r[x.a] = {
          pase: re ? re.lineas.map((l) => l.pase) : [], pv: re ? re.lineas.map((l) => l.pvFin) : [],
          cv: re?.rep?.cv ?? null, capVen: conRep.length ? conRep.reduce((t, m) => t + (m.rep?.capVen ?? 0), 0) / conRep.length : 0,
        };
      }
      setReales({ de: ags, r });
    })();
  }, [ags]);
  if (!ags) return null;
  const R = reales && reales.de === ags ? reales.r : null;
  const clave = `${tipo}:${linea}:${JSON.stringify(metas)}`;
  const calc = calc0 && calc0.de === ags && calc0.clave === clave ? calc0 : null;


  // valores por agencia: real, presupuesto y meta (lo escrito; vacío = sin cambio)
  const filas = ags.map((x) => {
    const re = R?.[x.a];
    const real = tipo === "rec" ? re?.cv ?? null : re?.pase[linea] ?? null;
    const pres = tipo === "rec" ? Math.max(...x.pres.rv) : x.pres.pase[linea];
    const base = tipo === "rec" ? re?.capVen ?? 0 : re?.pv[linea] ?? 0;   // $ sobre los que se aplica el %
    const t = metas[x.a];
    const meta = t !== undefined && t.trim() !== "" ? leerPct(t) : null;
    return { x, real, pres, base, meta };
  }).filter((f) => tipo === "rec" || f.pres > 0 || (f.real ?? 0) > 0);
  const version = (f: (typeof filas)[number]) => tipo === "rec"
    ? { ...f.x.pres, rv: f.x.pres.rv.map(() => f.meta!) }
    : { ...f.x.pres, pase: f.x.pres.pase.map((v, i) => (i === linea ? f.meta! : v)) };
  const conMeta = filas.filter((f) => f.meta !== null && Math.abs(f.meta - f.pres) > 1e-7);

  const llenar = () => {
    const n = leerPct(ajuste);
    if (n === null) return;
    const m: Record<string, string> = {};
    for (const f of filas) {
      if (f.real === null) continue;
      // recuperación: puntos sobre el real (2 % → 3 % con +1); pase: % menos que el real
      // nunca menos exigente que lo que ya pide el presupuesto
      const v = tipo === "rec" ? Math.max(f.real + n, f.pres) : Math.min(f.real * (1 - n), f.pres);
      m[f.x.a] = (Math.max(0, v) * 100).toFixed(2).replace(".", ",");
    }
    setMetas(m); setMsg(null);
  };
  const calcular = async () => {
    const r: Record<string, { base: Fin; fin: Fin }> = {};
    for (const f of conMeta) {
      setCorriendo(`Calculando… ${f.x.a}`); await pausa();
      r[f.x.a] = { base: f.x.base, fin: finDe(correrCartera(f.x.am, f.x.pres, version(f))!) };
    }
    setCalc({ de: ags, clave, filas: r }); setCorriendo(null); setMsg(null);
  };
  const aplicar = async () => {
    if (!calc || !conMeta.length) return;
    const que = tipo === "rec" ? "la recuperación de vencida" : `el pase a riesgo de ${NOMBRE_LINEA[linea]}`;
    if (!window.confirm(`Se guardará ${que} en ${conMeta.length} agencias. Cada una guarda una copia para deshacer. ¿Continuar?`)) return;
    const err: string[] = [];
    for (const f of conMeta) {
      setCorriendo(`Aplicando… ${f.x.a}`);
      try { await guardar(f.x.a, f.x.am, version(f), tipo === "rec" ? `Cartera, recuperación de vencida ${pc(f.meta, 2)}` : `Cartera, pase a riesgo ${NOMBRE_LINEA[linea]} ${pc(f.meta, 2)}`); }
      catch (e) { err.push(`${f.x.a}: ${e instanceof Error ? e.message : "error"}`); }
    }
    setCorriendo(null); setMsg(err.length ? `No se pudo guardar en: ${err.join("; ")}` : "Guardado. El presupuesto se recalcula en unos segundos.");
  };
  const usd = (r: number | null, b: number) => (r === null ? null : r * b);
  const S = (g: (f: (typeof filas)[number]) => number | null) => filas.reduce((t, f) => t + (g(f) ?? 0), 0);
  const tit = tipo === "rec" ? "Recuperación de vencida al mes" : `Pase a riesgo ${NOMBRE_LINEA[linea]} al mes`;
  const unidad = tipo === "rec" ? "recuperado" : "pasa a riesgo";
  const inp = "h-7 w-[70px] rounded-md px-2 text-right bg-white text-[12px]";
  return (
    <div className="rounded-lg px-4 py-3 flex flex-col gap-3" style={{ border: `1px solid ${E.linea}`, background: "#fff" }}>
      <div className="flex flex-wrap items-center gap-3">
        <b className="text-[14px] flex-1">Exigir a las agencias</b>
        <select aria-label="Qué exigir" value={tipo} onChange={(e) => { setTipo(e.target.value as "rec" | "pase"); setMetas({}); setAjuste(e.target.value === "rec" ? "1" : "10"); }} className="h-8 rounded-md px-2 bg-white text-[13px]" style={{ border: "1px solid #BFD6C8" }}>
          <option value="rec">Más recuperación de vencida</option><option value="pase">Menos pase a riesgo</option>
        </select>
        {tipo === "pase" && <select aria-label="Producto" value={linea} onChange={(e) => { setLinea(Number(e.target.value)); setMetas({}); }} className="h-8 rounded-md px-2 bg-white text-[13px]" style={{ border: "1px solid #BFD6C8" }}>
          {NOMBRE_LINEA.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>}
        <label className="inline-flex items-center gap-2 text-[13px]">{tipo === "rec" ? "Real +" : "Real −"}
          <input value={ajuste} onChange={(e) => setAjuste(e.target.value)} inputMode="decimal" aria-label="Ajuste para todas" className="h-8 w-[56px] rounded-md px-2 text-right bg-white" style={{ border: "1px solid #BFD6C8" }} />
          {tipo === "rec" ? "puntos" : "%"}</label>
        <button type="button" onClick={llenar} disabled={!R} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${E.linea}`, color: E.verde }}>Llenar todas</button>
        <button type="button" disabled={!!corriendo || !conMeta.length} onClick={() => void calcular()} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: E.verde }}>{corriendo ?? "Calcular"}</button>
        <Formula info derecha>{tipo === "rec"
          ? "Recuperación de vencida: % neto recuperado ÷ capital vencido por cobrar del mes, la misma medida del reporte de recuperación. Escriba la meta de cada agencia (p. ej. si recupera 2 %, exigir 3 %) o use «Real + puntos» para llenarlas todas. Los dólares son el % × el capital vencido por cobrar promedio de jul–oct. Lo cobrado de más sale de la cartera en riesgo y libera su provisión."
          : "Pase a riesgo: cartera del producto que pasa cada mes a no devenga y vencida ÷ cartera por vencer. Escriba la meta de cada agencia o use «Real − %». Los dólares son el % × la cartera por vencer del producto al último mes."}
          {" "}Al aplicar se guarda en los parámetros de cartera de cada agencia y se recalculan provisión, morosidad, estado de resultados, balance e indicadores.</Formula>
      </div>
      {!R ? <p className="text-[12px] m-0" style={{ color: E.gris }}>Leyendo lo real de las agencias…</p> : (
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <thead><tr style={T.cab}>
              <th className={T.thIzq}>Agencia</th>
              <th className={T.th}>Real jul–oct</th><th className={T.th}>Presupuesto</th><th className={T.th} style={{ background: E.fondo }}>Meta</th>
              <th className={T.th}>$ {unidad} real</th><th className={T.th}>$ con la meta</th><th className={T.th}>{tipo === "rec" ? "Más al mes" : "Menos al mes"}</th>
              {calc && <><th className={T.th}>Morosidad dic</th><th className={T.th}>Utilidad</th></>}
            </tr></thead>
            <tbody>
              {filas.map((f) => {
                const r$ = usd(f.real, f.base), m$ = usd(f.meta ?? f.pres, f.base), c = calc?.filas[f.x.a];
                const dif = r$ !== null && m$ !== null ? (tipo === "rec" ? m$ - r$ : r$ - m$) : null;
                return (
                  <tr key={f.x.a} style={T.fila}>
                    <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>{f.x.a}</td>
                    <td className={T.td}>{pc(f.real, 2)}</td><td className={T.td}>{pc(f.pres, 2)}</td>
                    <td className={T.td} style={{ background: E.fondo }}>
                      <input value={metas[f.x.a] ?? ""} placeholder={(f.pres * 100).toFixed(2).replace(".", ",")} aria-label={`Meta ${f.x.a}`} inputMode="decimal"
                        onChange={(e) => { setMetas({ ...metas, [f.x.a]: e.target.value }); setMsg(null); }} className={inp} style={{ border: "1px solid #BFD6C8" }} /> %
                    </td>
                    <td className={T.td}>{r$ === null ? "—" : u(r$)}</td><td className={T.td}>{m$ === null ? "—" : u(m$)}</td>
                    <td className={T.td} style={{ color: dif !== null && dif > 0.5 ? E.verde : undefined, fontWeight: 600 }}>{dif === null ? "—" : u(dif)}</td>
                    {calc && <><td className={T.td}>{c ? <>{pc(c.base.mora, 2)} → <b>{pc(c.fin.mora, 2)}</b></> : "—"}</td><td className={T.td}>{c ? <>{u(c.base.util)} → <b>{u(c.fin.util)}</b></> : "—"}</td></>}
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${E.tenue}`, fontWeight: 700, background: E.fondo }}>
                <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>Cooperativa</td>
                <td className={T.td} /><td className={T.td} /><td className={T.td} />
                <td className={T.td}>{u(S((f) => usd(f.real, f.base)))}</td><td className={T.td}>{u(S((f) => usd(f.meta ?? f.pres, f.base)))}</td>
                <td className={T.td}>{u(S((f) => { const a = usd(f.real, f.base), b = usd(f.meta ?? f.pres, f.base); return a === null || b === null ? null : tipo === "rec" ? b - a : a - b; }))}</td>
                {calc && <><td className={T.td} /><td className={T.td}>{u(Object.values(calc.filas).reduce((t, c) => t + c.base.util, 0))} → {u(Object.values(calc.filas).reduce((t, c) => t + c.fin.util, 0))}</td></>}
              </tr>
            </tbody>
          </table>
          <p className="text-[11.5px] mt-2 mb-0" style={{ color: E.gris }}>{tit}. Meta vacía = se queda con el presupuesto.</p>
        </div>
      )}
      {(calc || msg) && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[12px]" style={{ color: msg ? E.verde : E.gris }}>{msg ?? "Todavía no se guardó nada."}</span>
          {calc && !msg && <button type="button" onClick={() => setCalc(null)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${E.linea}`, color: E.gris }}>Descartar</button>}
          {calc && !msg && conMeta.length > 0 && <button type="button" disabled={!!corriendo} onClick={() => void aplicar()} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-60" style={{ background: E.verde }}>{corriendo ?? "Aplicar al presupuesto"}</button>}
        </div>
      )}
    </div>
  );
}
