"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Formula } from "../ProvisionFlowParametros";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import type { FilaPresupuestoDepartamental } from "../../lib/calc/orquestador";
import { ingresos51De } from "../../lib/calc/ingresos-51";
import { calcularRealidad51, escalarBancos, type Mes51 } from "../../lib/calc/estudio-ingresos51";
import {
  E, NUM, T, p2, u, perCorto, CabeceraCuenta, Indicadores, SelectorIndicador, type Indicador, Lateral, BandaEfecto, Delta, entrada,
  Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar, type TipoDif,
} from "./EstudioComun";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * 51 · INTERESES Y DESCUENTOS GANADOS: 5101 depósitos en bancos (supuesto propio: la tasa de bancos), 5103 inversiones
 * (registro de Inversiones), 5104 cartera (cuenta 14) y 5190 préstamos internos (tasa interna, cuenta 41).
 */
interface Version51 { tasa: number }

export function useIngresos51(am: AgenciaMotor, h: HistoricoEstudio) {
  const i51 = useMemo(() => ingresos51De(am.ins.saldos), [am]);
  const tasaMes = useMemo(() => i51?.tasaBancosPorMes ?? Array(12).fill(0.35), [i51]);
  const pres: Version51 = useMemo(() => ({ tasa: tasaMes.reduce((a, x) => a + x, 0) / 12 / 100 }), [tasaMes]);
  const real = useMemo(() => calcularRealidad51(h), [h]);
  const vReal: Version51 | null = useMemo(() => (real ? { tasa: real.tasaBancos ?? pres.tasa } : null), [real, pres]);
  const [propEd, setProp] = useBorrador<Version51>(am.A.nombre, "51", (x): x is Version51 => !!x && typeof (x as Version51).tasa === "number");
  const prop = propEd ?? pres;
  const escalar = (filas: FilaPresupuestoDepartamental[], v: Version51) => escalarBancos(filas, tasaMes, v.tasa);
  const correr = (v: Version51 | null) => (v ? correrVersion(am, { filasPresupuesto: escalar(am.ins.filasPresupuesto, v) }) : null);
  const Rr = useMemo(() => correr(vReal), [am, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => correr(prop), [am, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  return { i51, pres, real, vReal, prop, setProp, editada: propEd !== null, escalar, Rr, Rx };
}
type Estado51 = ReturnType<typeof useIngresos51>;

type Vista = "realidad" | "supuestos" | "impacto";
const cta = (R: Corrida, k: string) => R.er.cta?.[k] ?? 0;

export function DetalleIngresos51({ c, Rp, ag, enviar, guardando }: { c: Estado51; Rp: Corrida; ag: string; enviar: Enviar; guardando: boolean }) {
  const [vista, setVista] = useState<Vista>("realidad");
  const [detalle, setDetalle] = useState(false);
  const [ind, setInd] = useState("");
  const { i51, pres, real, vReal, prop, setProp, editada, Rr, Rx } = c;
  if (!real || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene estados de resultados mensuales cargados en Históricos.</p>;
  const ms = real.ventana, ult = ms[ms.length - 1];
  const basePres = i51 ? i51.basePorMesBancos.reduce((a, x) => a + x, 0) / 12 : null;
  const tasaInt = i51 ? i51.tasaInternosPorMes.reduce((a, x) => a + x, 0) / 12 / 100 : null;

  const aplicar = async (v: Version51, origen: string) => {
    if (Math.abs(v.tasa - pres.tasa) < 1e-9) { window.alert("El presupuesto ya tiene esta tasa de bancos."); return; }
    if (await enviar({ tasaBancos: Math.round(v.tasa * 1e6) / 1e4 }, `Intereses ganados, ${origen}`, `Se reemplazará la tasa de los depósitos en bancos de ${ag} por ${p2(v.tasa)} en los 12 meses (interés 5101).`)) setProp(null);
  };

  const inds: Indicador[] = [
    { id: "51", label: "Intereses ganados", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.i51 })) },
    { id: "5104", label: "Cartera", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.i5104 })) },
    { id: "5101", label: "Bancos", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.i5101 })) },
    { id: "tas", label: "Tasa de bancos", mejor: 1, pp: true, fmt: p2, serie: ms.map((m) => ({ p: m.p, v: m.tasaBancos })) },
  ];
  const indSel = inds.some((x) => x.id === ind) ? ind : inds[0].id;
  const S = (f: (m: Mes51) => number | null) => u(ms.reduce((t, m) => t + (f(m) ?? 0), 0));
  const filasMes: { label: string; f: (m: Mes51) => number | null; fmt: (v: number | null) => string; per: string; fuerte?: boolean; sub?: boolean }[] = [
    { label: "5101 Depósitos", f: (m) => m.i5101, fmt: u, per: S((m) => m.i5101), sub: true },
    { label: "5103 Inversiones", f: (m) => m.i5103, fmt: u, per: S((m) => m.i5103), sub: true },
    { label: "5104 Cartera de créditos", f: (m) => m.i5104, fmt: u, per: S((m) => m.i5104), sub: true },
    { label: "5190 Préstamos internos", f: (m) => m.i5190, fmt: u, per: S((m) => m.i5190), sub: true },
    ...(ms.some((m) => Math.abs(m.otros ?? 0) >= 1) ? [{ label: "Otros", f: (m: Mes51) => m.otros, fmt: u, per: S((m) => m.otros), sub: true }] : []),
    { label: "Intereses ganados (51)", f: (m) => m.i51, fmt: u, per: S((m) => m.i51), fuerte: true },
    { label: "Bancos (1103)", f: (m) => m.bancos, fmt: u, per: u(ult.bancos) },
    { label: "Tasa de bancos", f: (m) => m.tasaBancos, fmt: p2, per: p2(real.tasaBancos) },
    { label: "Inversiones (13)", f: (m) => m.inversiones, fmt: u, per: u(ult.inversiones) },
    { label: "Rendimiento de inversiones", f: (m) => m.rendInv, fmt: p2, per: p2(real.rendInv) },
  ];

  type FilaSup = { k: string; label: string; pres: string; real: string; prop: ReactNode; formula?: ReactNode; resultado?: boolean };
  const k = prop.tasa / Math.max(1e-9, pres.tasa);
  const m12 = (R: Corrida, c: string) => cta(R, c) / 12;
  const sup: FilaSup[] = [
    { k: "ban", label: "Saldo en bancos (1103)", pres: u(basePres), real: u(real.bancos), prop: u(basePres), resultado: true,
      formula: <>Presupuesto: saldo de bancos del mes anterior según el flujo, promedio del año.</> },
    { k: "tas", label: "Tasa de depósitos en bancos anual", pres: p2(pres.tasa), real: p2(real.tasaBancos), prop: entrada(prop.tasa, (x) => setProp({ tasa: x }), true, "tas", Math.abs(prop.tasa - pres.tasa) > 1e-9),
      formula: <>Ritmo real: interés 5101 × 12 ÷ saldo promedio de bancos (1103). Se guarda en Proyección de ingresos → 5101.</> },
    { k: "5101", label: "Interés de depósitos al mes (5101)", pres: u(m12(Rp, "5101")), real: u(real.prom.i5101), prop: u(m12(Rp, "5101") * k), resultado: true },
    { k: "5103", label: "Interés de inversiones al mes (5103)", pres: u(m12(Rp, "5103")), real: u(real.prom.i5103), prop: u(m12(Rp, "5103")), resultado: true,
      formula: <>Sale del registro de Inversiones (títulos, tasa y vencimiento).</> },
    { k: "5104", label: "Intereses de cartera al mes (5104)", pres: u(m12(Rp, "5104")), real: u(real.prom.i5104), prop: u(m12(Rp, "5104")), resultado: true,
      formula: <>Sale de la cartera: tasas y saldos se estudian en la cuenta 14.</> },
    { k: "5190", label: "Interés de préstamos internos al mes (5190)", pres: u(m12(Rp, "5190")), real: u(real.prom.i5190), prop: u(m12(Rp, "5190")), resultado: true,
      formula: <>Préstamos a otras oficinas × tasa interna ({p2(tasaInt)}); la tasa se estudia en la cuenta 41.</> },
    { k: "51", label: "Intereses ganados al mes (51)", pres: u(m12(Rp, "51")), real: u(real.prom.i51), prop: u(m12(Rp, "51") + m12(Rp, "5101") * (k - 1)), resultado: true },
  ];
  const impacto: { label: string; f: (R: Corrida) => number; fmt: (v: number) => string; tipo: TipoDif; mejor: 1 | -1 | 0; fuerte?: boolean; sub?: boolean }[] = [
    { label: "Depósitos en bancos (5101)", f: (R) => cta(R, "5101"), fmt: u, tipo: "usd", mejor: 1, sub: true },
    { label: "Inversiones (5103)", f: (R) => cta(R, "5103"), fmt: u, tipo: "usd", mejor: 1, sub: true },
    { label: "Cartera de créditos (5104)", f: (R) => cta(R, "5104"), fmt: u, tipo: "usd", mejor: 1, sub: true },
    { label: "Préstamos internos (5190)", f: (R) => cta(R, "5190"), fmt: u, tipo: "usd", mejor: 1, sub: true },
    { label: "Intereses ganados del año", f: (R) => cta(R, "51"), fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "Utilidad del año", f: (R) => R.kpi.util, fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "ROA", f: (R) => R.kpi.roa, fmt: p2, tipo: "pp", mejor: 1 },
  ];
  const presMes = m12(Rp, "51");

  return (
    <div className="flex flex-col gap-4 flex-1">
      <CabeceraCuenta<Vista> codigo="51" nombre="Intereses y descuentos ganados" vista={vista} onVista={setVista} izquierda={vista === "realidad" ? <SelectorIndicador lista={inds} sel={indSel} onSel={setInd} /> : null} />

      {vista === "realidad" && <>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-col" style={{ flex: "999 1 520px", minWidth: 0 }}><Indicadores lista={inds} sel={indSel} /></div>
          <Lateral items={[
            { t: "Intereses ganados al mes", v: u(real.prom.i51), sub: `Presupuesto ${ejercicioEnUso()}: ${u(presMes)} al mes` },
            { t: "Intereses de cartera", v: u(real.prom.i5104), sub: real.prom.i51 ? `${Math.round((real.prom.i5104 / real.prom.i51) * 100)} % de los intereses ganados` : undefined },
            { t: "Saldo en bancos", v: u(real.bancos), sub: `al cierre de ${perCorto(ult.p)}` },
            { t: "Tasa de bancos", v: p2(real.tasaBancos), sub: `Presupuesto ${ejercicioEnUso()}: ${p2(pres.tasa)}` },
          ]} />
        </div>
        <BandaEfecto pres={Rp.kpi.util} real={Rr.kpi.util} cuenta="la tasa de bancos" detalle={detalle} onDetalle={() => setDetalle((x) => !x)} />
        {detalle && (
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq} />{ms.map((m) => <th key={m.p} className={T.th}>{perCorto(m.p)}</th>)}<th className={T.th} style={{ color: E.tinta }}>Período</th></tr></thead>
              <tbody>{filasMes.map((r) => (
                <tr key={r.label} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400 }}>
                  <td className={`${T.tdIzq} min-w-[210px]`} style={{ color: r.sub ? E.gris : E.tinta, fontFamily: "inherit" }}>{r.label}</td>
                  {ms.map((m) => { const x = r.f(m); return <td key={m.p} className={T.td} style={{ color: x !== null && x < 0 ? E.alerta : E.tinta }}>{r.fmt(x)}</td>; })}
                  <td className={T.td} style={{ fontWeight: 600 }}>{r.per}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </>}

      {vista === "supuestos" && <>
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} primera="Supuesto" />
            <tbody>{sup.map((f) => (
              <tr key={f.k} style={{ ...T.fila, color: f.resultado ? E.gris : E.tinta, fontWeight: f.k === "51" ? 600 : 400 }}>
                <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{f.label}{f.formula && <Formula>{f.formula}</Formula>}</span></td>
                <td className={T.td}>{f.pres}</td><td className={T.td}>{f.real}</td><td className={T.td} style={{ paddingRight: f.resultado ? 18 : undefined }}>{f.prop}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <Acciones guardando={guardando} editada={editada} onReal={() => aplicar(vReal, "ritmo real")} onPropuesta={() => aplicar(prop, "propuesta")}>
          <BorradorLinks editada={editada} onReal={() => setProp(null)} />
          <button type="button" className="text-[13px] font-semibold hover:underline mr-auto" style={{ color: E.verde }} onClick={() => vReal && setProp({ ...vReal })}>Partir del real</button>
        </Acciones>
      </>}

      {vista === "impacto" && (
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} extra="Propuesta vs presupuesto" />
            <tbody>{impacto.map((r, i) => (
              <tr key={i} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400, background: r.label === "Utilidad del año" ? E.fondo : undefined }}>
                <td className={`${T.tdIzq} ${r.sub ? "pl-5" : ""}`} style={{ fontFamily: "inherit", color: r.sub ? E.gris : E.tinta }}>{r.label}</td>
                <td className={T.td}>{r.fmt(r.f(Rp))}</td><td className={T.td}>{r.fmt(r.f(Rr))}</td>
                <td className={T.td} style={{ color: E.tinta, fontWeight: 600 }}>{r.fmt(r.f(Rx))}</td>
                <td className={T.td}><Delta d={r.f(Rx) - r.f(Rp)} tipo={r.tipo} mejor={r.mejor} /></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
