"use client";

import { useMemo, useState } from "react";
import { C } from "../ActivosComun";
import { modelo, palancas0, armarPlan, colocacion, type Ctx, type Referencias } from "../../lib/calc/planificacion";
import { usd, mill, pc, num2, per, Linea, Cascada, Semaforo, FilaComp, CabeceraComp, type PuntoTray } from "./Comun";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * EXAMEN DE AGENCIA: informe para presentar (se imprime / guarda en PDF), en orden cronológico:
 * portada con veredicto → trayectoria → situación vs referencias → de dónde sale el resultado → productos →
 * qué necesita (resumen del plan) → conclusiones.
 */
type Estado = "ok" | "avi" | "mal";
function evalua(val: number, ref: number, mejor: 1 | -1): Estado {
  const d = (val - ref) * mejor;
  if (d >= 0) return "ok";
  return Math.abs(d) <= Math.abs(ref) * 0.25 ? "avi" : "mal";
}

function Sec({ n, t, lead, children }: { n: string; t: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="sec px-10 py-6" style={{ borderTop: `1px solid ${C.beige}` }}>
      <h3 className="text-[16px] font-bold flex items-baseline gap-2.5 m-0"><span className="text-[13px] font-extrabold" style={{ color: C.acento }}>{n}</span>{t}</h3>
      {lead && <p className="text-[13px] mt-1 mb-4 max-w-[760px]" style={{ color: C.texto2 }}>{lead}</p>}
      {children}
    </section>
  );
}
function Mini({ t, v, d, children }: { t: string; v: string; d: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5" style={{ border: `1px solid ${C.beige}` }}>
      <div className="text-[12px]" style={{ color: C.texto2 }}>{t}</div><div className="text-[18px] font-extrabold tabla-cifras">{v}</div>
      <div className="text-[11px] mb-1" style={{ color: C.texto2 }}>{d}</div>{children}
    </div>
  );
}

export function Examen({ ctx, agencia, trayectoria, onVerPlan, onGuardarRef }: {
  ctx: Ctx; agencia: string; trayectoria: PuntoTray[]; onVerPlan: () => void; onGuardarRef: (r: Referencias) => Promise<void>;
}) {
  const [editRef, setEditRef] = useState(false);
  const R = ctx.ref, b = ctx.base;
  const m = useMemo(() => modelo(ctx, palancas0()), [ctx]);
  const P = useMemo(() => armarPlan(ctx, R.roa, m.roa >= R.roa ? "potencial" : "meta"), [ctx, R.roa, m.roa]);
  const c0 = colocacion(ctx, null), c1 = colocacion(ctx, P.L);
  const serie = trayectoria.filter((s) => s.p >= "2024-01").map((s, i, arr) => ({ ...s, utMes: s.p.endsWith("-01") || i === 0 ? s.utAcum : s.utAcum - arr[i - 1].utAcum }));
  const punto = (p: string) => trayectoria.find((s) => s.p === p);
  const ult = trayectoria[trayectoria.length - 1];
  const y = Number(b.periodo.slice(0, 4));
  const dicA = punto(`${y - 2}-12`), dicB = punto(`${y - 1}-12`);
  const C0 = b.productos.reduce((a, p) => a + p.pv + p.mora, 0);
  const inds = [
    { n: "ROA", v: m.roa, ref: R.roa, mejor: 1 as const, f: (x: number) => pc(x, 2), max: 0.04, min: -0.06, txt: "Utilidad anualizada ÷ activo" },
    { n: "Morosidad", v: m.mora, ref: R.mora, mejor: -1 as const, f: (x: number) => pc(x), max: 0.3, min: 0, txt: "No devenga + vencida ÷ cartera" },
    { n: "Gasto ÷ margen", v: m.eficiencia, ref: R.eficiencia, mejor: -1 as const, f: (x: number) => pc(x, 0), max: 1.4, min: 0, txt: "Personal y generales ÷ margen" },
    { n: "Captación ÷ cartera", v: m.autof, ref: R.autof, mejor: 1 as const, f: num2, max: 3, min: 0, txt: "1 o más: se financia sola" },
    { n: "Crecimiento de cartera", v: b.crecimientoActual, ref: R.crec, mejor: 1 as const, f: (x: number) => pc(x), max: 0.3, min: -0.2, txt: `Anualizado a ${per(b.periodo)}` },
    { n: "Costo de riesgo", v: C0 ? m.prov / C0 : 0, ref: R.riesgo, mejor: -1 as const, f: (x: number) => pc(x), max: 0.15, min: 0, txt: "Provisiones ÷ cartera" },
  ].map((i) => ({ ...i, e: evalua(i.v, i.ref, i.mejor) }));
  const malos = inds.filter((i) => i.e === "mal").length, cumple = inds.filter((i) => i.e === "ok").length, cerca = inds.length - cumple - malos;
  const nota = Math.round((cumple * 10 + cerca * 6) / inds.length * 10) / 10;
  const veredicto = m.utilidad < 0 ? `A este ritmo, perdería ${mill(-m.utilidad)} en el año.`
    : m.roa < R.roa ? `Gana ${mill(m.utilidad)} al año, pero su ROA (${pc(m.roa, 2)}) no llega al ${pc(R.roa, 1)} esperado.`
    : `Genera ${mill(m.utilidad)} al año con ROA de ${pc(m.roa, 2)}: cumple la referencia.`;

  const prods = m.det.map((p, i) => { const pr = b.productos[i], tot = pr.pv + pr.mora; return { ...p, mora: tot ? pr.mora / tot : 0, rendTotal: tot ? pr.ingreso / tot : 0, margen: tot ? (pr.ingreso - pr.provision) / tot : 0 }; }).filter((p) => p.c0 > 1000);
  const totProd = prods.reduce((a, x) => a + x.c0, 0);
  const mejorProd = [...prods].sort((x, z) => z.margen - x.margen)[0];
  const conclusiones: React.ReactNode[] = [];
  if (m.mora > R.mora) conclusiones.push(<><b>La prioridad es la recuperación.</b> Con morosidad de {pc(m.mora)}, {mill(m.mora * m.cartera)} de cartera no genera intereses y obliga a provisionar {mill(m.prov)} al año.</>);
  if (m.eficiencia > R.eficiencia) conclusiones.push(<><b>El gasto operativo absorbe {pc(m.eficiencia, 0)} del margen.</b> Personal y gastos generales suman {mill(m.personal + m.generales)} al año.</>);
  if (m.autof < R.autof) conclusiones.push(<><b>No se financia sola:</b> capta {num2(m.autof)} por cada dólar de cartera y depende de {mill(b.recibe)} de otras oficinas.</>);
  else conclusiones.push(<><b>Tiene excedente de fondos:</b> capta {num2(m.autof)} por cada dólar de cartera y entrega {mill(b.envia)} a otras oficinas; la oportunidad es colocar más.</>);
  if (mejorProd) conclusiones.push(<><b>El producto que más deja es {mejorProd.nombre}:</b> de cada $100 de su cartera quedan {pc(mejorProd.margen)} al año después de provisiones. Conviene priorizarlo en la colocación.</>);
  if (m.roa >= R.roa) conclusiones.push(<><b>Puede rendir más:</b> aprovechando su potencial, la utilidad pasaría de {mill(m.utilidad)} a {mill(P.M.utilidad)} en {ejercicioEnUso()}.</>);
  else if (!P.alcanzada) conclusiones.push(<><b>Las acciones del plan no alcanzan:</b> faltarían {mill(P.falta)} de utilidad para el ROA meta. Requiere decisiones de fondo (estructura de gasto, productos, tasas).</>);

  return (
    <article className="informe max-w-[1060px] mx-auto bg-white rounded-[14px] overflow-hidden" style={{ border: `1px solid ${C.beige}` }}>
      <header className="px-10 pt-8 pb-7 text-white" style={{ background: "linear-gradient(135deg,#00461F,#005A28 55%,#2E7D4F)" }}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[11px] tracking-[.12em] uppercase opacity-80">Informe de diagnóstico · Planificación {y + 1}</div>
            <h2 className="text-[34px] font-extrabold my-1.5 leading-tight">{agencia === "Consolidado" ? "Cooperativa (consolidado)" : `Agencia ${agencia}`}</h2>
            <div className="opacity-85 text-[13px]">Corte {per(b.periodo)} · Datos reales {serie[0] ? per(serie[0].p) : ""} a {per(b.periodo)} · Proyección con el ritmo actual</div>
          </div>
          <button type="button" onClick={() => setEditRef((v) => !v)} className="no-print h-8 px-3 rounded-md text-[12px] font-semibold" style={{ background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.3)" }}>Referencias</button>
        </div>
        <div className="mt-5 grid grid-cols-[auto_1fr] gap-4 items-center rounded-xl px-4 py-3.5" style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.22)" }}>
          <div className="w-16 h-16 rounded-full bg-white flex flex-col items-center justify-center leading-none" style={{ color: C.acento }}>
            <span className="text-[24px] font-extrabold">{nota.toFixed(1).replace(".", ",")}</span><span className="text-[10px] font-semibold mt-0.5" style={{ color: C.texto2 }}>de 10</span>
          </div>
          <div><b className="text-[16px]">{veredicto}</b><p className="m-0 mt-0.5 opacity-90 text-[13px]">{cumple} indicadores cumplen, {cerca} están cerca y {malos} no cumplen la referencia.</p></div>
        </div>
      </header>

      {editRef && <EditorReferencias r={R} onGuardar={async (r) => { await onGuardarRef(r); setEditRef(false); }} />}

      <Sec n="1" t={`Trayectoria ${serie[0]?.p.slice(0, 4) ?? ""} – ${y}`} lead="Cómo llegó hasta aquí: saldos a fin de cada mes y resultado de cada mes.">
        <div className="grid grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-3">
          <Mini t="Cartera bruta" v={mill(ult?.cartera ?? 0)} d={`${dicA ? `${per(dicA.p)} ${mill(dicA.cartera)} · ` : ""}${dicB ? `${per(dicB.p)} ${mill(dicB.cartera)}` : ""}`}><Linea serie={serie} campo="cartera" fmt={mill} /></Mini>
          <Mini t="Captaciones" v={mill(ult?.capt ?? 0)} d={`${dicA ? `${per(dicA.p)} ${mill(dicA.capt)} · ` : ""}${dicB ? `${per(dicB.p)} ${mill(dicB.capt)}` : ""}`}><Linea serie={serie} campo="capt" fmt={mill} /></Mini>
          <Mini t="Morosidad" v={pc(ult?.mora ?? 0)} d={`${dicA ? `${per(dicA.p)} ${pc(dicA.mora)} · ` : ""}${dicB ? `${per(dicB.p)} ${pc(dicB.mora)}` : ""}`}><Linea serie={serie} campo="mora" fmt={(x) => pc(x)} referencia={R.mora} /></Mini>
          <Mini t="Resultado del mes" v={mill(ult ? (serie[serie.length - 1]?.utMes ?? 0) : 0)} d={`${dicA ? `${dicA.p.slice(0, 4)} ${mill(dicA.utAcum)} · ` : ""}${dicB ? `${dicB.p.slice(0, 4)} ${mill(dicB.utAcum)}` : ""}`}><Linea serie={serie} campo="utMes" fmt={usd} barras /></Mini>
        </div>
      </Sec>

      <Sec n="2" t="Situación actual frente a las referencias" lead="Cada indicador con su referencia (línea negra).">
        {inds.map((i) => {
          const w = (x: number) => Math.max(0, Math.min(100, (x - i.min) / (i.max - i.min) * 100));
          const col = i.e === "ok" ? "#1E6B3A" : i.e === "avi" ? "#B7791F" : "#B42318";
          return (
            <div key={i.n} className="grid grid-cols-[200px_1fr_90px_110px] gap-3.5 items-center py-2.5" style={{ borderTop: "1px solid #F0EEE8" }}>
              <div><b className="text-[13px]">{i.n}</b><div className="text-[11px]" style={{ color: C.texto2 }}>{i.txt}</div></div>
              <div className="relative h-2 rounded-full" style={{ background: "#EEF1EF" }}>
                <i className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${w(i.v)}%`, background: col }} />
                <span className="absolute -top-1 -bottom-1 w-[2px]" style={{ left: `${w(i.ref)}%`, background: C.texto }} />
              </div>
              <div className="text-right"><b className="tabla-cifras">{i.f(i.v)}</b><div className="text-[11px]" style={{ color: C.texto2 }}>ref. {i.f(i.ref)}</div></div>
              <div className="text-right"><Semaforo e={i.e} /></div>
            </div>
          );
        })}
      </Sec>

      <Sec n="3" t="De dónde sale el resultado" lead={`Estado de resultados anualizado con el ritmo a ${per(b.periodo)}: qué suma y qué resta hasta llegar a la utilidad.`}>
        <Cascada m={m} />
      </Sec>

      <Sec n="4" t="Cartera por producto" lead="Dónde gana y dónde pierde la agencia: rendimiento, morosidad y lo que queda después de provisiones.">
        <table className="w-full text-[12px] border-collapse">
          <thead><tr style={{ color: C.texto2, borderBottom: "2px solid #DDE2DF" }}>
            {["Producto", "Cartera", "Participación", "Tasa (cartera que paga)", "Morosidad", "Rinde sobre toda su cartera", "Queda después de provisiones"].map((h, i) => <th key={h} className={`${i ? "text-right" : "text-left"} px-2.5 py-2 font-semibold align-bottom`}>{h}</th>)}
          </tr></thead>
          <tbody>{prods.map((p) => (
            <tr key={p.nombre} style={{ borderTop: "1px solid #F0EEE8", height: 34 }}>
              <td className="px-2.5">{p.nombre}{p === mejorProd && <span className="ml-1.5"><Semaforo e="ok" /></span>}</td>
              <td className="px-2.5 text-right tabla-cifras">{usd(p.c0)}</td><td className="px-2.5 text-right tabla-cifras">{pc(totProd ? p.c0 / totProd : 0)}</td>
              <td className="px-2.5 text-right tabla-cifras">{pc(p.tasa)}</td>
              <td className="px-2.5 text-right tabla-cifras font-bold" style={{ color: p.mora > R.mora ? C.alerta : C.ok }}>{pc(p.mora)}</td>
              <td className="px-2.5 text-right tabla-cifras">{pc(p.rendTotal)}</td><td className="px-2.5 text-right tabla-cifras font-bold">{pc(p.margen)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Sec>

      <Sec n="5" t={`Qué necesita: metas para ${y + 1}`} lead={m.roa >= R.roa ? "Ya cumple la referencia. Esto es lo que puede lograr si aprovecha todo su potencial." : `Lo mínimo que debe lograr, combinando acciones en orden de prioridad, para llegar a un ROA de ${pc(R.roa, 1)}.`}>
        <table className="w-full text-[12px] border-collapse">
          <CabeceraComp a={`Hoy (ritmo ${y})`} b={`Plan ${y + 1}`} />
          <tbody>
            <FilaComp l="Colocación mensual" a={c0.total / 12} m={c1.total / 12} />
            <FilaComp l="Cartera bruta a diciembre" a={P.A.cartera} m={P.M.cartera} />
            <FilaComp l="Cartera vencida a recuperar en el año" a={0} m={Math.max(0, (P.A.mora - P.M.mora) * P.A.cartera)} />
            <FilaComp l="Morosidad al cierre" a={P.A.mora} m={P.M.mora} fmt={(x) => pc(x)} mejor={-1} />
            <FilaComp l="Captaciones a diciembre" a={P.A.capt} m={P.M.capt} />
            <FilaComp l="Asesores de crédito" a={ctx.asesores} m={P.M.asesores} fmt={(x) => String(Math.round(x))} mejor={0} />
            <FilaComp l="Gasto operativo del año" a={P.A.personal + P.A.generales} m={P.M.personal + P.M.generales} mejor={-1} />
            <FilaComp l={`Utilidad ${y + 1}`} a={P.A.utilidad} m={P.M.utilidad} tipo="tot" />
            <FilaComp l="ROA" a={P.A.roa} m={P.M.roa} fmt={(x) => pc(x, 2)} />
          </tbody>
        </table>
        <button type="button" onClick={onVerPlan} className="no-print mt-3 h-9 px-3.5 rounded-md text-white text-[12px] font-semibold" style={{ background: C.acento }}>Ver el plan completo, mes a mes →</button>
      </Sec>

      <Sec n="6" t="Conclusiones">
        <ol className="m-0 pl-5 text-[13px] leading-relaxed flex flex-col gap-1.5">{conclusiones.map((c, i) => <li key={i}>{c}</li>)}</ol>
      </Sec>
      <footer className="px-10 py-3.5 flex justify-between text-[11px]" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2 }}>
        <span>COAC Once de Junio · Planificación</span><span>Datos reales al corte {per(b.periodo)}</span>
      </footer>
    </article>
  );
}

function EditorReferencias({ r, onGuardar }: { r: Referencias; onGuardar: (r: Referencias) => Promise<void> }) {
  const [x, setX] = useState(r);
  const [guardando, setGuardando] = useState(false);
  const campos: [keyof Referencias, string, number][] = [["roa", "ROA mínimo (%)", 100], ["mora", "Morosidad máxima (%)", 100], ["eficiencia", "Gasto ÷ margen máximo (%)", 100], ["autof", "Captación ÷ cartera mínima", 1], ["crec", "Crecimiento de cartera (%)", 100], ["riesgo", "Costo de riesgo máximo (%)", 100]];
  return (
    <div className="no-print px-10 py-4 flex flex-wrap items-end gap-4" style={{ background: "#F7FAF8", borderTop: `1px solid ${C.beige}` }}>
      {campos.map(([k, l, f]) => (
        <label key={k} className="flex flex-col gap-1 text-[12px]" style={{ color: C.texto2 }}>{l}
          <input type="number" step="0.1" defaultValue={+(x[k] * f).toFixed(2)} onChange={(e) => setX({ ...x, [k]: Number(e.target.value) / f })}
                 className="h-8 w-28 rounded-md px-2 text-right bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }} />
        </label>
      ))}
      <button type="button" disabled={guardando} onClick={async () => { setGuardando(true); await onGuardar(x); setGuardando(false); }}
              className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-60" style={{ background: C.acento }}>{guardando ? "Guardando…" : "Guardar referencias"}</button>
    </div>
  );
}
