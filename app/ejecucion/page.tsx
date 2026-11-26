"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download } from "lucide-react";
import { useDatos } from "../../lib/useDatos";
import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { AGENCIAS } from "../../components/ActivosComun";
import AnioEjercicio from "../../components/AnioEjercicio";
import type { FilaEjecucion } from "../../lib/ejecucion";
import IndicadoresEjecucion, { type DatosIndicadores } from "../../components/ejecucion/IndicadoresEjecucion";
import { MESES, MESES_LARGO, buscar, comparar, frase, pctTxt, principales, usd, type Base, type Comparacion } from "../../lib/ejecucion-calc";

interface Datos { agencia: string; ejercicio: number; meses: number[]; bal: FilaEjecucion[]; er: FilaEjecucion[]; indicadores?: DatosIndicadores }

const VERDE = "#2E8B57", ROJO = "#C0392B", TEXTO = "#111418", T2 = "#4A554F", T3 = "#6B7570", BORDE = "#E3E6E4";
const NUM: React.CSSProperties = { fontFamily: "Tahoma, Verdana, sans-serif", fontVariantNumeric: "tabular-nums" };
const chip = (c: number | null) => (c === null ? { bg: "#EEF1EF", fg: T3 } : c >= 1 ? { bg: "#E3EEE7", fg: "#0B5A2A" } : c >= 0.9 ? { bg: "#FBF0D9", fg: "#8A5A12" } : { bg: "#FBE9E9", fg: "#9B1C1C" });
const millones = (v: number | null) => (v === null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v / 1e6).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`);

function Barra({ c, max }: { c: Comparacion; max: number }) {
  if (c.dif === null) return <span style={{ color: T3 }}>—</span>;
  const w = max ? Math.max(2, Math.min(56, (Math.abs(c.dif) / max) * 56)) : 2;
  const col = c.favorable ? VERDE : ROJO, izq = c.dif < 0;
  return (
    <div className="relative" style={{ height: 16, width: "100%" }}>
      <div className="absolute" style={{ left: "50%", top: -4, bottom: -4, borderLeft: "1px solid #9AA5A0" }} />
      <div className="absolute rounded-sm" style={{ top: 2, height: 12, width: w, background: col, ...(izq ? { right: "50%" } : { left: "50%" }) }} />
      <span className="absolute text-[11px] leading-4 whitespace-nowrap" style={{ ...NUM, color: col, ...(izq ? { left: "calc(50% + 6px)" } : { right: "calc(50% + 6px)" }) }}>{usd(c.dif)}</span>
    </div>
  );
}
function Aguja({ c }: { c: Comparacion }) {
  if (c.pct === null) return <span style={{ color: T3 }}>—</span>;
  const col = c.favorable ? VERDE : ROJO, w = Math.min((Math.abs(c.pct) / 0.25) * 38, 38), neg = c.pct < 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="relative shrink-0" style={{ height: 16, width: 88 }}>
        <div className="absolute" style={{ left: "50%", top: -4, bottom: -4, borderLeft: "1px solid #9AA5A0" }} />
        <div className="absolute" style={{ top: 7, height: 2, width: w, background: col, ...(neg ? { right: "50%" } : { left: "50%" }) }} />
        <div className="absolute rounded-full" style={{ top: 3, width: 10, height: 10, background: col, left: `calc(50% ${neg ? "-" : "+"} ${w}px - 5px)` }} />
      </div>
      <span className="font-bold text-right whitespace-nowrap" style={{ ...NUM, color: col, width: 64 }}>{pctTxt(c.pct)}</span>
    </div>
  );
}

function Filas({ filas, nivel, mes, er, base, max, abiertos, alternar, vista, meses }: {
  filas: FilaEjecucion[]; nivel: number; mes: number; er: boolean; base: Base; max: number;
  abiertos: Set<string>; alternar: (id: string) => void; vista: "mes" | "anio"; meses: number[];
}) {
  return (<>{filas.map((f) => {
    const c = comparar(f, mes, er, base), abierto = abiertos.has(f.id), tiene = !!f.hijos?.length;
    const raiz = nivel === 0, detalle = !f.pres;
    return (
      <Fragment key={f.id}>
        <tr style={{ borderBottom: "1px solid #F1F3F2", background: raiz ? "#FAFBFA" : undefined, height: 30 }}>
          <td className="pl-4 pr-1 text-[11px]" style={{ ...NUM, color: raiz ? "#005A28" : T3, fontWeight: raiz ? 700 : 400 }}>{/^\d+$/.test(f.codigo) ? f.codigo : ""}</td>
          <td className="pr-2 text-[12px] truncate" style={{ paddingLeft: 4 + nivel * 16, color: raiz ? "#005A28" : detalle ? T2 : TEXTO, fontWeight: raiz || (tiene && abierto) ? 700 : 400 }} title={f.label}>
            {tiene ? <button type="button" onClick={() => alternar(f.id)} className="inline-flex items-center gap-1 hover:underline" aria-expanded={abierto}>
              {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{f.label}</button> : <span className="pl-[17px]">{f.label}</span>}
          </td>
          {vista === "mes" ? (<>
            <td className="px-2 text-right text-[11.5px]" style={{ ...NUM, fontWeight: raiz ? 700 : 400 }}>{detalle ? "" : usd(c.pres)}</td>
            <td className="px-2 text-right text-[11.5px]" style={{ ...NUM, fontWeight: raiz ? 700 : 400 }}>{usd(c.real)}</td>
            <td className="px-2">{detalle ? null : <Barra c={c} max={max} />}</td>
            <td className="pl-2 pr-4">{detalle ? null : <Aguja c={c} />}</td>
          </>) : MESES.map((_, i) => {
            const k = comparar(f, i, er, base), con = meses.includes(i + 1) && !detalle, ch = chip(con ? k.cumpl : null);
            return <td key={i} className="px-1 text-center text-[11px]" style={{ ...NUM }}>
              {con && k.cumpl !== null ? <span className="inline-block w-full rounded py-0.5 font-semibold" style={{ background: ch.bg, color: ch.fg }}>{pctTxt(k.cumpl, false)}</span> : <span style={{ color: "#C9CFCC" }}>·</span>}
            </td>;
          })}
        </tr>
        {tiene && abierto && <Filas filas={f.hijos!} nivel={nivel + 1} mes={mes} er={er} base={base} max={max} abiertos={abiertos} alternar={alternar} vista={vista} meses={meses} />}
      </Fragment>
    );
  })}</>);
}

const todosLosIds = (fs: FilaEjecucion[]): string[] => fs.flatMap((f) => (f.hijos?.length ? [f.id, ...todosLosIds(f.hijos)] : []));

/** Ejecución presupuestaria: presupuesto frente a lo real, cuenta por cuenta (estilo Zebra BI). */
export default function EjecucionPage() {
  const [agencia, setAgencia] = useAgencia(true);
  const [ejercicio] = useEjercicio();
  const { datos, error } = useDatos<Datos>(`/api/ejecucion?agencia=${encodeURIComponent(agencia)}`);
  const [tab, setTab] = useState<"bal" | "er" | "ind">("bal");
  const [base, setBase] = useState<Base>("acumulado");
  const [vista, setVista] = useState<"mes" | "anio">("mes");
  const [mesElegido, setMes] = useState<number | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [exportando, setExportando] = useState<string | null>(null);
  const [errExp, setErrExp] = useState<string | null>(null);
  const refMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => { if (!refMenu.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [menu]);

  const meses = datos?.meses ?? [];
  const mes = mesElegido !== null && meses.includes(mesElegido) ? mesElegido : meses[meses.length - 1] ?? 1;
  const i = mes - 1, er = tab === "er";
  const filas = useMemo(() => (datos ? (er ? datos.er : datos.bal) : []), [datos, er]);
  const raices = useMemo(() => new Set(filas.map((f) => f.id)), [filas]);
  const abiertosVis = useMemo(() => new Set([...raices, ...abiertos]), [raices, abiertos]);
  const todos = useMemo(() => todosLosIds(filas), [filas]);
  const expandido = todos.length > 0 && todos.every((id) => abiertosVis.has(id));
  const max = useMemo(() => Math.max(1, ...filas.flatMap((f) => [f, ...(f.hijos ?? [])]).map((f) => Math.abs(comparar(f, i, er, base).dif ?? 0))), [filas, i, er, base]);
  const tarjetas = useMemo(() => {
    if (!datos) return [];
    const de = (pred: (f: FilaEjecucion) => boolean, t: string) => { const f = buscar(filas, pred); return f ? { t, c: comparar(f, i, er, base), menos: f.menos } : null; };
    const sufijo = er ? (base === "acumulado" ? ` a ${MESES_LARGO[i]}` : ` de ${MESES_LARGO[i]}`) : "";
    return (er
      ? [de((f) => f.codigo === "5", `Ingresos${sufijo}`), de((f) => f.codigo === "4", `Gastos${sufijo}`), de((f) => f.codigo === "44", `Provisiones${sufijo}`), de((f) => f.id === "resultado", `Resultado${sufijo}`)]
      : [de((f) => f.codigo === "1", "Activo total"), de((f) => f.codigo === "14", "Cartera de créditos"), de((f) => f.codigo === "21", "Captaciones"), de((f) => f.codigo === "3", "Patrimonio")]
    ).filter(Boolean) as { t: string; c: Comparacion }[];
  }, [datos, filas, i, er, base]);
  const top = useMemo(() => principales(filas, i, er, base), [filas, i, er, base]);

  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function exportar(tipo: "excel" | "word") {
    if (!datos) return;
    setMenu(false); setErrExp(null); setExportando(tipo === "excel" ? "Generando Excel…" : "Generando informe…");
    try {
      const m = await import("../../lib/ejecucion-export");
      const opc = { agencia, ejercicio, mes, base, datos };
      if (tipo === "excel") await m.exportarExcelEjecucion(opc); else await m.exportarWordEjecucion(opc);
    } catch (e) { console.error(e); setErrExp("No se pudo generar el archivo."); }
    finally { setExportando(null); }
  }

  const sel = "h-9 px-3 rounded-lg border border-[#D5DAD7] bg-white text-[13px] outline-none focus:border-[#005A28]";
  const tabCls = (on: boolean) => `h-9 px-3.5 rounded-lg text-[13px] font-semibold ${on ? "bg-[#E3EEE7] text-[#005A28]" : "text-[#4A554F] hover:bg-[#F3F5F4]"}`;

  return (
    <div className="px-8 py-7" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <h1 className="text-[22px] font-semibold text-[#111418] mb-4">Ejecución presupuestaria<AnioEjercicio /></h1>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1.5 flex-1">
          <button type="button" className={tabCls(tab === "bal")} onClick={() => setTab("bal")}>Balance general</button>
          <button type="button" className={tabCls(tab === "er")} onClick={() => setTab("er")}>Estado de resultados</button>
          <button type="button" className={tabCls(tab === "ind")} onClick={() => setTab("ind")}>Indicadores</button>
        </div>
        <select className={sel} value={agencia} onChange={(e) => setAgencia(e.target.value)} aria-label="Agencia">
          {[...AGENCIAS, "Consolidado"].map((a) => <option key={a}>{a}</option>)}
        </select>
        <select className={sel} value={mes} onChange={(e) => setMes(Number(e.target.value))} aria-label="Mes" disabled={!meses.length}>
          {(meses.length ? meses : [mes]).map((m) => <option key={m} value={m}>{MESES_LARGO[m - 1][0].toUpperCase() + MESES_LARGO[m - 1].slice(1)}</option>)}
        </select>
        {er && <select className={sel} value={base} onChange={(e) => setBase(e.target.value as Base)} aria-label="Base">
          <option value="acumulado">Acumulado del año</option><option value="mes">Solo el mes</option>
        </select>}
        <div className="relative" ref={refMenu}>
          <button type="button" className="h-9 px-3.5 rounded-lg bg-[#005A28] text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                  onClick={() => setMenu((x) => !x)} disabled={!datos || !!exportando} aria-haspopup="menu" aria-expanded={menu}>
            <Download size={14} /> {exportando ?? "Exportar"} <ChevronDown size={14} />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 mt-1 w-[200px] rounded-lg bg-white shadow-lg z-20 py-1" style={{ border: `1px solid ${BORDE}` }}>
              <button role="menuitem" type="button" className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F3F5F4]" onClick={() => exportar("excel")}>Excel (.xlsx)</button>
              <button role="menuitem" type="button" className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F3F5F4]" onClick={() => exportar("word")}>Informe Word (.docx)</button>
            </div>
          )}
        </div>
      </div>

      {(error || errExp) && <p role="alert" className="text-[13px] text-[#9B1C1C] mb-3">{error ?? errExp}</p>}
      {datos && !meses.length && <p className="text-[13px] mb-3" style={{ color: T2 }}>Todavía no hay meses de {ejercicio} cargados en Carga de datos → Balances y Estados de resultados para {agencia}.</p>}

      {tab === "ind" ? (datos?.indicadores ? <IndicadoresEjecucion datos={datos.indicadores} mes={mes} meses={meses} /> : null) : (<>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {tarjetas.map(({ t, c }) => { const ch = chip(c.cumpl); return (
          <div key={t} className="bg-white rounded-2xl px-4 py-3.5" style={{ border: `1px solid ${BORDE}` }}>
            <div className="text-[12px]" style={{ color: T2 }}>{t}</div>
            <div className="text-[20px] font-bold my-0.5" style={NUM}>{millones(c.real)}</div>
            <div className="text-[12px]" style={{ ...NUM, color: T3 }}>Presupuesto {millones(c.pres)} · <span className="px-2 py-px rounded-full font-bold" style={{ background: ch.bg, color: ch.fg }}>{c.cumpl === null ? "—" : pctTxt(c.cumpl, false)}</span></div>
          </div>); })}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: vista === "mes" ? "minmax(0,1fr) 320px" : "minmax(0,1fr)" }}>
        <section className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${BORDE}` }}>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDE}` }}>
            <div className="flex gap-1 flex-1">
              <button type="button" className={tabCls(vista === "mes")} onClick={() => setVista("mes")}>{MESES_LARGO[i][0].toUpperCase() + MESES_LARGO[i].slice(1)}</button>
              <button type="button" className={tabCls(vista === "anio")} onClick={() => setVista("anio")}>Año · cumplimiento</button>
            </div>
            <button type="button" onClick={() => setAbiertos(expandido ? new Set() : new Set(todos))} aria-pressed={expandido}
                    className="h-8 px-3 rounded-lg bg-white hover:bg-[#F3F5F4] text-[12.5px] flex items-center gap-1.5" style={{ border: "1px solid #E1E5E3", color: T2 }}>
              {expandido ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandido ? "Contraer" : "Expandir"}</button>
          </div>
          <div className="tabla-fija fija-2" style={{ "--col1": "82px" } as React.CSSProperties}>
            <table className="w-full table-fixed border-collapse" style={{ minWidth: vista === "mes" ? 900 : 1100 }}>
              <colgroup>
                <col style={{ width: 82 }} /><col style={{ width: 230 }} />
                {vista === "mes" ? <><col style={{ width: 112 }} /><col style={{ width: 112 }} /><col /><col style={{ width: 160 }} /></> : MESES.map((m) => <col key={m} />)}
              </colgroup>
              <thead>
                <tr className="text-[11px] font-bold" style={{ color: T2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                  <th className="pl-4 text-left">Código</th><th className="text-left">Cuenta</th>
                  {vista === "mes" ? <><th className="px-2 text-right">Presupuesto</th><th className="px-2 text-right">Real</th><th className="text-center">Variación</th><th className="pr-4 text-right">Var. %</th></>
                    : MESES.map((m, k) => <th key={m} className="text-center" style={{ color: meses.includes(k + 1) ? T2 : "#B9C1BD" }}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                <Filas filas={filas} nivel={0} mes={i} er={er} base={base} max={max} abiertos={abiertosVis} alternar={alternar} vista={vista} meses={meses} />
              </tbody>
            </table>
          </div>
        </section>

        {vista === "mes" && (
          <aside className="bg-white rounded-2xl self-start" style={{ border: `1px solid ${BORDE}` }}>
            <h3 className="m-0 px-4 pt-3.5 pb-2 text-[13px] font-semibold text-[#005A28]">Principales variaciones</h3>
            {top.length ? top.map(({ f, c }) => (
              <p key={f.id} className="m-0 px-4 py-2.5 text-[12.5px] leading-[1.45]" style={{ borderTop: "1px solid #F1F3F2", color: TEXTO }}>
                <span style={{ color: c.favorable ? VERDE : ROJO }}>●</span> {frase(f, c)}
              </p>
            )) : <p className="m-0 px-4 pb-4 text-[12.5px]" style={{ color: T3 }}>Sin variaciones para mostrar.</p>}
          </aside>
        )}
      </div>
      </>)}
    </div>
  );
}
