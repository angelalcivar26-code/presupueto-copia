"use client";

import { useState } from "react";
import { usd, pc, per, type RealCargado } from "./Comun";
import { Dif, ent, type Escenario } from "./Integrado";

/**
 * COMPARAR ESCENARIOS: real cargado, presupuestado y meta asignada frente a un escenario del presupuesto y uno de la
 * propuesta del modelo, elegidos por el usuario.
 */
export function Comparacion({ ag, E, Emod, real }: { ag: string; E: Escenario[]; Emod: Escenario[]; real?: RealCargado | null }) {
  const opcP = E.filter((e) => ["cons", "medio", "opt"].includes(e.k) || e.fam === "guard"), opcM = Emod.filter((e) => ["mcons", "mmedio", "mopt"].includes(e.k));
  const [kP, setKP] = useState("medio"), [kM, setKM] = useState("mmedio");
  const fijas = ["pres", "meta"].map((k) => E.find((e) => e.k === k)).filter((e): e is Escenario => !!e);
  const eP = opcP.find((e) => e.k === kP) ?? opcP[0], eM = opcM.find((e) => e.k === kM) ?? opcM[0];
  const cols = [...fijas, eP, eM].filter(Boolean) as Escenario[];
  const P = E.find((e) => e.k === "pres")!;
  const sel = (v: string, set: (k: string) => void, ops: Escenario[], t: string) => (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[10.5px] font-bold uppercase tracking-[.06em]" style={{ color: "var(--g)" }}>{t}</span>
      <select value={v} onChange={(e) => set(e.target.value)} aria-label={t} className="h-8 rounded-md px-2 text-[12.5px] font-bold bg-white" style={{ border: "1px solid #C9D0CC", color: "var(--v)" }}>
        {ops.map((e) => <option key={e.k} value={e.k}>{e.n}</option>)}
      </select>
    </div>
  );
  type Fila = [string, (e: Escenario) => number, (v: number) => string, number, number?];
  const bloques: [string, Fila[]][] = [
    ["Resultado", [
      ["Utilidad del año", (e) => e.R.kpi.util, usd, 1, real?.utilidad], ["ROA", (e) => e.R.kpi.roa, (x) => pc(x, 2), 1, real?.roa], ["Margen financiero", (e) => e.R.er.margen, usd, 1],
      ["Provisiones", (e) => e.R.er.prov, usd, -1], ["Gasto de personal", (e) => e.R.er.personal, usd, -1], ["Gastos generales", (e) => e.R.er.generales, usd, -1],
    ]],
    ["Cartera", [
      ["Colocación mensual", (e) => e.R.col.colMes, usd, 1], ["Asesores", (e) => e.R.kpi.ases, ent, 0], ["Cartera a diciembre", (e) => e.R.bal.cart, usd, 1, real?.cartera],
      ["Cartera vencida a diciembre", (e) => e.R.bal.v, usd, -1, real ? real.cartera * real.morosidad : undefined], ["Morosidad a diciembre", (e) => e.R.kpi.mora, (x) => pc(x), -1, real?.morosidad],
    ]],
    ["Captaciones", [["Captaciones a diciembre", (e) => e.R.bal.capt, usd, 1, real?.captaciones]]],
    ["Supuestos", [
      ["Recuperación de cartera por vencer", (e) => e.L.e, (x) => pc(x), 1], ["Recuperación de cartera vencida al mes", (e) => e.L.rv, (x) => pc(x, 2), 1],
      ["Cumplimiento de la meta de colocación", (e) => e.L.cumpl, (x) => pc(x, 0), 1], ["Gastos ajustables", (e) => e.L.ajGen, (x) => pc(x, 0), -1],
      ["Depósitos a plazo (crecimiento)", (e) => e.L.gP, (x) => pc(x, 0), 1],
    ]],
  ];
  const conSupuestos = ag !== "Consolidado";
  return (
    <div className="card">
      <div className="overflow-x-auto"><table>
        <thead><tr style={{ verticalAlign: "bottom" }}>
          <th>{ag === "Consolidado" ? "Cooperativa" : `Agencia ${ag}`}</th>
          <th>{real ? `Real ${per(real.periodo)}` : "Real"}</th>
          {fijas.map((e) => <th key={e.k}>{e.n}</th>)}
          {eP && <th className="col-s">{sel(kP, setKP, opcP, "Escenario del presupuesto")}</th>}
          {eM && <th className="col-s">{sel(kM, setKM, opcM, "Propuesta del modelo")}</th>}
        </tr></thead>
        <tbody>
          {bloques.filter(([t]) => t !== "Supuestos" || conSupuestos).map(([t, filas]) => [
            <tr key={t} className="grp"><td colSpan={cols.length + 2}>{t}</td></tr>,
            ...filas.map(([l, g, f, m, r]) => (
              <tr key={l}><td>{l}</td><td>{r === undefined ? "—" : f(r)}</td>{cols.map((e, i) => (
                <td key={e.k + i} className={i >= fijas.length ? "col-s" : ""}>{f(g(e))}{i >= fijas.length && e.k !== "pres" && l === "Utilidad del año" && <div style={{ fontSize: 11, fontWeight: 400 }}>vs presupuestado <Dif a={g(P)} b={g(e)} mejor={m} /></div>}</td>
              ))}</tr>
            )),
          ])}
        </tbody>
      </table></div>
    </div>
  );
}
