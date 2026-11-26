"use client";

import { useMemo, useState } from "react";
import { bench, escBase, objetivo, type Mundo } from "../../lib/calc/plan2027";
import { usd, mill, pc } from "./Comun";
import { BotonesVista } from "../PorAgencia";
import { Dif, sgn, repartoDe, OPCIONES_CUMPL, type ConfigModelo } from "./Integrado";

function Barra({ h, m, o, max }: { h: number; m: number; o: number; max: number }) {
  const W = 140, x = (v: number) => W / 2 + v / max * (W / 2 - 4), a = x(h), mm = x(m), oo = x(o);
  return (
    <svg width={W} height={16} role="img"><line x1={W / 2} x2={W / 2} y1={0} y2={16} stroke="#B9C3BD" />
      <rect x={Math.min(a, oo)} y={6} width={Math.abs(oo - a)} height={4} rx={2} fill="#DDE6E0" />
      <rect x={Math.min(a, mm)} y={5} width={Math.max(2, Math.abs(mm - a))} height={6} rx={3} fill="#005A28" />
      <circle cx={a} cy={8} r={3.5} fill="#7A847F" /></svg>
  );
}

/** Lee un porcentaje escrito con coma o punto ("0,5" o "0.5"). */
const leerPct = (t: string) => { const n = Number(t.trim().replace("%", "").replace(",", ".")); return Number.isFinite(n) && t.trim() !== "" ? n / 100 : null; };

/**
 * METAS POR AGENCIA: el ROA meta de la cooperativa (consolidado) se reparte entre agencias según su potencial
 * (optimista − presupuestado). Al final, la explicación paso a paso (plegada).
 */
export function MetasAgencia({ M, cfg, setCfg, onVer }: {
  M: Mundo; cfg: ConfigModelo; setCfg: (c: Partial<ConfigModelo>) => Promise<void>; onVer: (ag: string) => void;
}) {
  const D = useMemo(() => repartoDe(M, cfg), [M, cfg]);
  const [texto, setTexto] = useState<string | null>(null), [estado, setEstado] = useState<"" | "guardando" | "ok" | "error">("");
  const valor = texto ?? String(Math.round(cfg.metaInst * 10000) / 100).replace(".", ",");
  const aplicar = async () => {
    const v = leerPct(valor); if (v === null || v < -0.2 || v > 0.2) { setEstado("error"); return; }
    setEstado("guardando");
    try { await setCfg({ metaInst: v }); setTexto(null); setEstado("ok"); setTimeout(() => setEstado(""), 2000); } catch { setEstado("error"); }
  };
  const presDe = (a: string) => D.filas.find((r) => r.a === a)?.Pp.kpi.util ?? 0;
  const presTot = D.filas.reduce((t, r) => t + presDe(r.a), 0), sumAsign = D.filas.reduce((a, r) => a + r.asign, 0);
  const B = bench(M), y = Number(Object.values(M.ags)[0]?.base.periodo.slice(0, 4) ?? 2026) + 1;
  const max = Math.max(1, ...D.filas.map((r) => Math.max(Math.abs(r.B.kpi.util), Math.abs(r.O.kpi.util), Math.abs(r.asign))));
  const uso = D.sPot ? Math.min(1, D.brecha / D.sPot) : 0;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", marginBottom: 0 }}>
        <div className="kp"><div className="t">Presupuestado</div><div className="v">{mill(presTot)}</div></div>
        <div className="kp"><div className="t">Meta {y}</div><div className="v">{mill(D.metaU)}</div><div className="d">ROA {pc(cfg.metaInst, 2)}</div></div>
        <div className="kp"><div className="t">Brecha a cubrir</div><div className="v">{mill(D.brecha)}</div></div>
        <div className="kp"><div className="t">Optimista</div><div className="v">{mill(D.opt)}</div><div className="d">{D.falta > 0 ? <span className="dn">faltan {mill(D.falta)}</span> : <span className="up">alcanza la meta</span>}</div></div>
      </div>
      {D.falta > 0 && <div className="alerta">La meta pide más que el optimista de todas las agencias juntas (faltan {mill(D.falta)}): cada agencia queda en su optimista y la meta asignada no cambia aunque subas el ROA. Con un ROA de hasta {pc(D.activo ? D.opt / D.activo : 0, 2)} la meta se reparte.</div>}

      <div className="card">
        <div className="barra-meta">
          <div className="campo">
            <span className="et">ROA meta de la cooperativa</span>
            <div className="flex items-center gap-2">
              <input type="text" inputMode="decimal" className="num" value={valor} aria-label="ROA meta de la cooperativa" onChange={(e) => { setTexto(e.target.value); setEstado(""); }} onKeyDown={(e) => { if (e.key === "Enter") aplicar(); }} />
              <span>%</span>
              <button type="button" className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--v)" }} onClick={aplicar} disabled={estado === "guardando"}>{estado === "guardando" ? "Guardando…" : "Aplicar"}</button>
              {estado === "ok" && <span className="up">Guardado</span>}{estado === "error" && <span className="dn">Revisa el porcentaje</span>}
              <span className="ml-1">= utilidad de <b style={{ color: "var(--t)" }}>{mill(D.metaU)}</b> en {y}</span>
            </div>
          </div>
          <span className="flex-1" />
          <div className="campo">
            <span className="et">Cumplimiento de la meta de colocación</span>
            <BotonesVista etiqueta="Cumplimiento de la meta de colocación" valor={String(cfg.cumplMeta)} onChange={(v) => setCfg({ cumplMeta: v === "null" ? null : Number(v) })} opciones={OPCIONES_CUMPL.map(([v, l]) => ({ id: String(v), label: l }))} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>Agencia</th><th>Presupuestado</th><th>Optimista</th><th className="col-s">Meta asignada</th><th>ROA meta</th><th>Mejora exigida</th><th style={{ textAlign: "center" }}>presupuestado · meta · optimista</th><th /></tr></thead>
            <tbody>
              {D.filas.map((r) => (
                <tr key={r.a}>
                  <td>{r.a}</td><td>{usd(presDe(r.a))}</td><td>{usd(r.O.kpi.util)}</td>
                  <td className="col-s">{usd(r.asign)}</td><td>{pc(r.activo ? r.asign / r.activo : 0, 2)}</td><td><Dif a={r.B.kpi.util} b={r.asign} /></td>
                  <td style={{ textAlign: "center" }}><Barra h={r.B.kpi.util} m={r.asign} o={r.O.kpi.util} max={max} /></td>
                  <td><button type="button" className="h-7 px-2.5 rounded-md text-[12px] font-semibold bg-white" style={{ border: "1px solid #C9D0CC" }} onClick={() => onVer(r.a)}>Ver plan de la meta</button></td>
                </tr>
              ))}
              <tr className="tot"><td>Cooperativa</td><td>{usd(presTot)}</td><td>{usd(D.opt)}</td><td className="col-s">{usd(sumAsign)}</td><td>{pc(D.activo ? sumAsign / D.activo : 0, 2)}</td><td><Dif a={D.base} b={sumAsign} /></td><td /><td /></tr>
            </tbody>
          </table>
        </div>
      </div>

      <details className="card">
        <summary className="ch"><h3>Cómo se calcula, paso a paso</h3></summary>
        <div className="px-4 py-3.5 text-[13px] leading-relaxed" style={{ color: "var(--g)", maxWidth: 1000 }}>
          <p className="m-0 mb-2"><b>0 · Mismo cálculo que el presupuesto.</b> Todos los escenarios se calculan con el motor del presupuesto, con los saldos de cada cuenta, los parámetros y los gastos cargados. El presupuestado es exactamente el presupuesto; los demás escenarios solo cambian la gestión: cumplimiento de la meta de colocación, cobro de cuotas, recuperación de la vencida, captación y gastos ajustables. Planificación agrega dos efectos que el presupuesto no calcula, medidos frente a lo presupuestado (con lo presupuestado valen 0): <b>provisión por mora</b> (cobrar o recuperar peor hace entrar más cartera a los tramos de mora del modelo de flow rates, y mejor la reduce) y <b>fondeo con otras oficinas</b> (la liquidez que falta o sobra se paga o se cobra a la tasa interna, menos lo que ya rinde en bancos).</p>
          <p className="m-0 mb-2"><b>1 · Meta de la cooperativa.</b> ROA {pc(cfg.metaInst, 2)} × activo promedio de las agencias {mill(D.activo)} = utilidad de <b>{mill(D.metaU)}</b>. Es la meta consolidada: la suma de las agencias (los intereses entre oficinas se anulan).</p>
          <p className="m-0 mb-2"><b>2 · Brecha.</b> Con lo presupuestado, las agencias suman {mill(D.base)}. Falta cubrir {mill(D.metaU)} − ({mill(D.base)}) = <b>{mill(D.brecha)}</b>. Si el presupuesto ya cumple la meta, no se exige mejora.</p>
          <p className="m-0 mb-2"><b>3 · Potencial de cada agencia.</b> Optimista − presupuestado, corriendo el modelo completo; el optimista nunca es peor que el presupuesto. Las agencias suman <b>{mill(D.sPot)}</b> de potencial.</p>
          <p className="m-0 mb-3"><b>4 · Reparto.</b> La brecha es el {pc(uso, 1)} del potencial total ({mill(D.brecha)} ÷ {mill(D.sPot)}). Cada agencia debe lograr ese mismo porcentaje de su potencial: meta = presupuestado + potencial × {pc(uso, 1)}. Ninguna palanca queda por debajo de lo presupuestado.</p>
          <table>
            <thead><tr><th>Agencia</th><th>Presupuestado</th><th>Optimista</th><th>Potencial</th><th>Parte del potencial total</th><th>Mejora asignada</th><th className="col-s">Meta</th></tr></thead>
            <tbody>
              {D.filas.map((r) => <tr key={r.a}><td>{r.a}</td><td>{usd(r.B.kpi.util)}</td><td>{usd(r.O.kpi.util)}</td><td>{usd(r.pot)}</td><td>{pc(D.sPot ? r.pot / D.sPot : 0)}</td><td>{usd(r.asign - r.B.kpi.util)}</td><td className="col-s">{usd(r.asign)}</td></tr>)}
              <tr className="tot"><td>Total</td><td>{usd(D.base)}</td><td>{usd(D.opt)}</td><td>{usd(D.sPot)}</td><td>100 %</td><td>{usd(sumAsign - D.base)}</td><td className="col-s">{usd(sumAsign)}</td></tr>
            </tbody>
          </table>
          <p className="m-0 mt-4 mb-1.5"><b>Cómo se arma el optimista de cada agencia</b></p>
          <ul className="m-0 mb-2.5 pl-5 list-disc">
            <li><b>Colocación:</b> los asesores cumplen {cfg.cumplMeta === null ? "lo mismo que en los últimos 12 meses (lo observado)" : `el ${pc(cfg.cumplMeta, 0)} de su meta`} (lo eliges arriba).</li>
            <li><b>Punto de partida:</b> lo presupuestado. Ninguna palanca del optimista queda por debajo del presupuesto.</li>
            <li><b>Cobro a tiempo:</b> sube hasta lo que logra el 25 % mejor de las agencias ({pc(B.e)}), con un mínimo de +3 y un máximo de +15 puntos en el año; tope 97 %.</li>
            <li><b>Recuperación de vencida:</b> al menos 2,5 % al mes.</li>
            <li><b>Gastos ajustables:</b> baja lo que gasta por encima de la cooperativa por cada dólar de activo, entre 5 % y 15 %. Los gastos fijos no se tocan.</li>
            <li><b>Depósitos a plazo:</b> +8 % solo si la agencia recibe fondos de otras oficinas y captar le cuesta menos que la tasa interna.</li>
            <li>Cada palanca se usa solo si suma utilidad en esa agencia.</li>
          </ul>
          <table>
            <thead><tr><th>Agencia</th><th>Cobro a tiempo (presupuesto → optimista)</th><th>Recuperación al mes</th><th>Gastos ajustables</th><th>Depósitos a plazo</th></tr></thead>
            <tbody>
              {D.filas.map((r) => {
                const A = M.ags[r.a], H = escBase(M, A), O = { ...objetivo(M, A), ...(cfg.ajustes[r.a]?.opt ?? {}) };
                return <tr key={r.a}><td>{r.a}</td><td>{pc(H.e)} → <b>{pc(O.e)}</b></td><td>{pc(H.rv, 2)} → <b>{pc(O.rv, 2)}</b></td><td>0 % → <b>{pc(O.ajGen, 0)}</b></td><td>{sgn(H.gP)}{pc(Math.abs(H.gP), 0)} → <b>{sgn(O.gP)}{pc(Math.abs(O.gP), 0)}</b></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
