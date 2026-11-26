"use client";
/**
 * Ejecución presupuestaria · Indicadores: cada indicador presupuestado frente al real del mes (Históricos), agrupado
 * por tipo. La diferencia va en puntos porcentuales y se pinta según convenga (en morosidad o gastos, menor es mejor).
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { BotonF } from "../ActivosComun";
import { MESES, MESES_LARGO, pct, type Ind } from "../../lib/indicadores-categorias";
import { GRUPOS, TODOS, compararInd as comparar, pp, principalesIndicadores, fraseIndicador, type Comp, type DatosIndicadores } from "../../lib/indicadores-ejecucion";
export type { DatosIndicadores };

const VERDE = "#2E8B57", ROJO = "#C0392B", TEXTO = "#111418", T2 = "#4A554F", T3 = "#6B7570", BORDE = "#E3E6E4";
const NUM: React.CSSProperties = { fontFamily: "Tahoma, Verdana, sans-serif", fontVariantNumeric: "tabular-nums" };
const TARJETAS = ["roa", "roe", "morosidad", "absorcion"];

export default function IndicadoresEjecucion({ datos, mes, meses }: { datos: DatosIndicadores; mes: number; meses: number[] }) {
  const [vista, setVista] = useState<"mes" | "anio">("mes");
  const [abierta, setAbierta] = useState<string | null>(null);
  // grupos abiertos: el primero (Rentabilidad) al entrar; los demás se abren con un clic
  const [grupos, setGrupos] = useState<Set<string>>(() => new Set([GRUPOS[0].id]));
  const alternarGrupo = (id: string) => setGrupos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const i = mes - 1;
  const sinReal = !datos.real[i];
  const max = useMemo(() => Math.max(0.001, ...TODOS.map((ind) => Math.abs(comparar(ind, datos, i).dif ?? 0))), [datos, i]);
  const top = useMemo(() => principalesIndicadores(datos, i), [datos, i]);
  const tabCls = (on: boolean) => `h-9 px-3.5 rounded-lg text-[13px] font-semibold ${on ? "bg-[#E3EEE7] text-[#005A28]" : "text-[#4A554F] hover:bg-[#F3F5F4]"}`;

  return (
    <>
      {sinReal && meses.length > 0 && <p className="text-[13px] mb-3" style={{ color: T2 }}>Para los indicadores reales de {MESES_LARGO[i]} se necesitan los balances y estados de resultados {i === 0 ? "de enero" : `de enero a ${MESES_LARGO[i]}`} y el balance de diciembre del año anterior (Carga de datos).</p>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {TARJETAS.map((id) => {
          const ind = TODOS.find((x) => x.id === id)!, c = comparar(ind, datos, i);
          const col = c.favorable === null ? T3 : c.favorable ? VERDE : ROJO;
          return (
            <div key={id} className="bg-white rounded-2xl px-4 py-3.5" style={{ border: `1px solid ${BORDE}` }}>
              <div className="text-[12px]" style={{ color: T2 }}>{ind.label}</div>
              <div className="text-[20px] font-bold my-0.5" style={{ ...NUM, color: c.real !== null && c.real < 0 ? ROJO : TEXTO }}>{pct(c.real)}</div>
              <div className="text-[12px]" style={{ ...NUM, color: T3 }}>Presupuesto {pct(c.pres)} · <span className="font-bold" style={{ color: col }}>{pp(c.dif)}</span></div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: vista === "mes" ? "minmax(0,1fr) 320px" : "minmax(0,1fr)" }}>
        <section className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${BORDE}` }}>
          <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDE}` }}>
            <button type="button" className={tabCls(vista === "mes")} onClick={() => setVista("mes")}>{MESES_LARGO[i][0].toUpperCase() + MESES_LARGO[i].slice(1)}</button>
            <button type="button" className={tabCls(vista === "anio")} onClick={() => setVista("anio")}>Año · diferencia</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse" style={{ minWidth: vista === "mes" ? 760 : 1100 }}>
              <colgroup>
                <col style={{ width: 250 }} />
                {vista === "mes" ? <><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col /></> : MESES.map((m) => <col key={m} />)}
                <col style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr className="text-[11px] font-bold" style={{ color: T2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                  <th className="pl-4 text-left">Indicador</th>
                  {vista === "mes" ? <><th className="px-2 text-right">Presupuesto</th><th className="px-2 text-right">Real</th><th className="text-center">Diferencia</th></>
                    : MESES.map((m, k) => <th key={m} className="text-center" style={{ color: meses.includes(k + 1) ? T2 : "#B9C1BD" }}>{m}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {GRUPOS.map((g) => (
                  <GrupoFilas key={g.id} titulo={g.label} inds={g.indicadores} datos={datos} i={i} max={max} vista={vista} meses={meses} abierta={abierta} onFormula={(id) => setAbierta(abierta === id ? null : id)}
                    abierto={grupos.has(g.id)} onAlternar={() => alternarGrupo(g.id)} />
                ))}
              </tbody>
            </table>
          </div>
          {(() => {
            const sel = TODOS.find((x) => x.id === abierta);
            return sel ? (
              <div className="flex items-baseline gap-3 px-4 py-3" style={{ borderTop: `1px solid ${BORDE}`, background: "#FAFBFA" }}>
                <span className="font-mono text-[12px]" style={{ color: T2 }}>ƒ</span>
                <b className="text-[12.5px]" style={{ color: TEXTO }}>{sel.label}</b>
                <span className="text-[12.5px]" style={{ color: T3 }}>{sel.formula}</span>
              </div>
            ) : null;
          })()}
        </section>
        {vista === "mes" && (
          <aside className="bg-white rounded-2xl self-start" style={{ border: `1px solid ${BORDE}` }}>
            <h3 className="m-0 px-4 pt-3.5 pb-2 text-[13px] font-semibold text-[#005A28]">Principales desvíos</h3>
            {top.length ? top.map(({ ind, c }) => (
              <p key={ind.id} className="m-0 px-4 py-2.5 text-[12.5px] leading-[1.45]" style={{ borderTop: "1px solid #F1F3F2", color: TEXTO }}>
                <span style={{ color: c.favorable ? VERDE : ROJO }}>●</span> {fraseIndicador(ind, c)}
              </p>
            )) : <p className="m-0 px-4 pb-4 text-[12.5px]" style={{ color: T3 }}>Sin desvíos para mostrar.</p>}
          </aside>
        )}
      </div>
    </>
  );
}

function GrupoFilas({ titulo, inds, datos, i, max, vista, meses, abierta, onFormula, abierto, onAlternar }: { titulo: string; inds: Ind[]; datos: DatosIndicadores; i: number; max: number; vista: "mes" | "anio"; meses: number[]; abierta: string | null; onFormula: (id: string) => void; abierto: boolean; onAlternar: () => void }) {
  const Flecha = abierto ? ChevronDown : ChevronRight;
  return (
    <>
      <tr onClick={onAlternar} className="cursor-pointer hover:bg-[#F3F5F4]" style={{ background: "#FAFBFA", height: 34, borderBottom: "1px solid #F1F3F2" }}>
        <td colSpan={vista === "mes" ? 5 : 14} className="pl-3">
          <button type="button" aria-expanded={abierto} className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide" style={{ color: "#005A28" }}>
            <Flecha size={15} />{titulo}<span className="normal-case font-normal tracking-normal" style={{ color: T3 }}>· {inds.length} indicadores</span>
          </button>
        </td>
      </tr>
      {abierto && inds.map((ind) => {
        const c = comparar(ind, datos, i);
        return (
          <tr key={ind.id} style={{ borderBottom: "1px solid #F1F3F2", height: 32 }}>
            <td className="pl-6 pr-2 text-[12.5px]" style={{ color: TEXTO }}>{ind.label}</td>
            {vista === "mes" ? (<>
              <td className="px-2 text-right text-[11.5px]" style={{ ...NUM, color: c.pres !== null && c.pres < 0 ? ROJO : TEXTO }}>{pct(c.pres)}</td>
              <td className="px-2 text-right text-[11.5px] font-semibold" style={{ ...NUM, color: c.real !== null && c.real < 0 ? ROJO : TEXTO }}>{pct(c.real)}</td>
              <td className="px-2"><Barra c={c} max={max} /></td>
            </>) : MESES.map((_, k) => {
              const x = comparar(ind, datos, k), con = meses.includes(k + 1) && x.dif !== null;
              return (
                <td key={k} className="px-1 text-center text-[11px]" style={NUM}>
                  {con ? <span className="inline-block w-full rounded py-0.5 font-semibold" style={{ background: x.favorable ? "#E3EEE7" : "#FBE9E9", color: x.favorable ? "#0B5A2A" : "#9B1C1C" }}>{pp(x.dif)}</span>
                    : <span style={{ color: "#C9CFCC" }}>·</span>}
                </td>
              );
            })}
            <td className="text-center"><BotonF abierto={abierta === ind.id} onClick={() => onFormula(ind.id)} titulo={`Fórmula de ${ind.label}`} /></td>
          </tr>
        );
      })}
    </>
  );
}

/** Barra de la diferencia (estilo Zebra BI): a la derecha si el real supera al presupuesto; verde si es favorable. */
function Barra({ c, max }: { c: Comp; max: number }) {
  if (c.dif === null) return <span className="block text-center" style={{ color: T3 }}>—</span>;
  const w = Math.max(2, Math.min(70, (Math.abs(c.dif) / max) * 70));
  const col = c.favorable ? VERDE : ROJO, izq = c.dif < 0;
  return (
    <div className="relative" style={{ height: 16, width: "100%" }}>
      <div className="absolute" style={{ left: "50%", top: -4, bottom: -4, borderLeft: "1px solid #9AA5A0" }} />
      <div className="absolute rounded-sm" style={{ top: 2, height: 12, width: w, background: col, ...(izq ? { right: "50%" } : { left: "50%" }) }} />
      <span className="absolute text-[11px] leading-4 whitespace-nowrap font-semibold" style={{ ...NUM, color: col, ...(izq ? { left: "calc(50% + 6px)" } : { right: "calc(50% + 6px)" }) }}>{pp(c.dif)}</span>
    </div>
  );
}
