"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Formula } from "../ProvisionFlowParametros";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import type { FilaPresupuestoDepartamental } from "../../lib/calc/orquestador";
import { ingresos51De } from "../../lib/calc/ingresos-51";
import { calcularRealidadIntereses, type MesInt } from "../../lib/calc/estudio-intereses";
import {
  E, NUM, T, p2, u, perCorto, CabeceraCuenta, Indicadores, SelectorIndicador, type Indicador, Lateral, BandaEfecto, Delta, entrada,
  Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar, type TipoDif,
} from "./EstudioComun";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * 41 · INTERESES CAUSADOS: 4101 (de las captaciones, cuenta 21), 4103 y el interés por los préstamos internos
 * (41059005 lo que paga a otras oficinas; su espejo 5190 lo que cobra). Supuesto propio: la tasa interna de la agencia.
 */
interface VersionInt { tasa: number }

/** Filas del presupuesto con otra tasa interna: 41059005 y 5190 son saldo del corte × tasa ÷ 12, se escalan por mes. */
function escalarInternos(filas: FilaPresupuestoDepartamental[], tasaMes: number[], tasa: number): FilaPresupuestoDepartamental[] {
  if (tasaMes.every((t) => Math.abs(t / 100 - tasa) < 1e-9)) return filas;
  return filas.map((f) => {
    const c = String(f.concepto).replace(/\D/g, "");
    if (c !== "41059005" && c !== "5190") return f;
    const t0 = (tasaMes[f.mes - 1] ?? 0) / 100;
    return t0 > 0 ? { ...f, monto: (f.monto * tasa) / t0 } : f;
  });
}

export function useIntereses(am: AgenciaMotor, h: HistoricoEstudio) {
  const i51 = useMemo(() => ingresos51De(am.ins.saldos), [am]);
  const tasaMes = useMemo(() => i51?.tasaInternosPorMes ?? Array(12).fill(8), [i51]);
  const pres: VersionInt = useMemo(() => ({ tasa: tasaMes.reduce((a, x) => a + x, 0) / 12 / 100 }), [tasaMes]);
  const real = useMemo(() => calcularRealidadIntereses(h), [h]);
  const tReal = real ? (real.recibe > real.presta ? real.tasaPaga ?? real.tasaCobra : real.tasaCobra ?? real.tasaPaga) : null;
  const vReal: VersionInt | null = useMemo(() => (real ? { tasa: tReal ?? pres.tasa } : null), [real, tReal, pres]);
  const [propEd, setProp] = useBorrador<VersionInt>(am.A.nombre, "41", (x): x is VersionInt => !!x && typeof (x as VersionInt).tasa === "number");
  const prop = propEd ?? pres;
  const escalar = (filas: FilaPresupuestoDepartamental[], v: VersionInt) => escalarInternos(filas, tasaMes, v.tasa);
  const correr = (v: VersionInt | null) => (v ? correrVersion(am, { filasPresupuesto: escalar(am.ins.filasPresupuesto, v) }) : null);
  const Rr = useMemo(() => correr(vReal), [am, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => correr(prop), [am, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  return { i51, tasaMes, pres, real, tReal, vReal, prop, setProp, editada: propEd !== null, escalar, Rr, Rx };
}
type EstadoIntereses = ReturnType<typeof useIntereses>;

type Vista = "realidad" | "supuestos" | "impacto";

export function DetalleIntereses({ c, Rp, ag, enviar, guardando }: { c: EstadoIntereses; Rp: Corrida; ag: string; enviar: Enviar; guardando: boolean }) {
  const [vista, setVista] = useState<Vista>("realidad");
  const [detalle, setDetalle] = useState(false);
  const [ind, setInd] = useState("");
  const { i51, pres, real, tReal, vReal, prop, setProp, editada, Rr, Rx } = c;
  if (!real || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene estados de resultados mensuales cargados en Históricos.</p>;
  const ms = real.ventana, ult = ms[ms.length - 1];
  const recibePres = Math.abs((i51?.cuentasRecibidas ?? []).reduce((t, x) => t + x.saldo, 0));
  const prestaPres = Math.abs((i51?.cuentasInternas ?? []).reduce((t, x) => t + x.saldo, 0));
  const pagaPres = (Rp.internos?.pagado ?? 0) / 12, cobraPres = (Rp.internos?.cobrado ?? 0) / 12;
  const deudora = recibePres > prestaPres || real.recibe > real.presta;

  const aplicar = async (v: VersionInt, origen: string) => {
    if (Math.abs(v.tasa - pres.tasa) < 1e-9) { window.alert("El presupuesto ya tiene esta tasa interna."); return; }
    if (await enviar({ tasaInterna: Math.round(v.tasa * 1e6) / 1e4 }, `Intereses, ${origen}`, `Se reemplazará la tasa interna de ${ag} (préstamos entre oficinas) por ${p2(v.tasa)} en los 12 meses. Cambia el interés que paga (41059005) y el que cobra (5190) la agencia.`)) setProp(null);
  };

  const inds: Indicador[] = [
    { id: "41", label: "Intereses causados", mejor: -1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.i41 })) },
    { id: "int", label: "Interés a otras oficinas", mejor: -1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.interno })) },
    { id: "deu", label: deudora ? "Deuda con otras oficinas" : "Préstamos a otras oficinas", mejor: deudora ? -1 : 0, fmt: u, serie: ms.map((m) => ({ p: m.p, v: deudora ? m.recibe : m.presta })) },
    { id: "tas", label: "Tasa interna", mejor: 0, pp: true, fmt: p2, serie: ms.map((m) => ({ p: m.p, v: deudora ? m.tasaPaga : m.tasaCobra })) },
  ];
  const indSel = inds.some((x) => x.id === ind) ? ind : inds[0].id;
  const filasMes: { label: string; f: (m: MesInt) => number | null; fmt: (v: number | null) => string; per: string; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    { label: "4101 Obligaciones con el público", f: (m) => m.i4101, fmt: u, per: u(ms.reduce((t, m) => t + (m.i4101 ?? 0), 0)), sub: true },
    { label: "4103 Obligaciones financieras", f: (m) => m.i4103, fmt: u, per: u(ms.reduce((t, m) => t + (m.i4103 ?? 0), 0)), sub: true },
    { label: "41059005 Interés pagado a otras oficinas", f: (m) => m.interno, fmt: u, per: u(ms.reduce((t, m) => t + (m.interno ?? 0), 0)), sub: true },
    { label: "Intereses causados (41)", f: (m) => m.i41, fmt: u, per: u(ms.reduce((t, m) => t + (m.i41 ?? 0), 0)), fuerte: true },
    { label: "Préstamos recibidos de otras oficinas (2908)", f: (m) => m.recibe, fmt: u, per: u(ult.recibe), formula: <>Subcuentas de 2908 cuyo nombre dice «préstamo» (las demás son transferencias).</> },
    { label: "Tasa que paga", f: (m) => m.tasaPaga, fmt: p2, per: p2(real.tasaPaga), formula: <>41059005 × 12 ÷ saldo promedio de préstamos recibidos.</> },
    { label: "Préstamos a otras oficinas (1908)", f: (m) => m.presta, fmt: u, per: u(ult.presta) },
    { label: "5190 Interés cobrado a otras oficinas", f: (m) => m.cobrado, fmt: u, per: u(ms.reduce((t, m) => t + (m.cobrado ?? 0), 0)) },
    { label: "Tasa que cobra", f: (m) => m.tasaCobra, fmt: p2, per: p2(real.tasaCobra) },
  ];

  type FilaSup = { k: string; label: string; pres: string; real: string; prop: ReactNode; formula?: ReactNode; resultado?: boolean };
  const k = prop.tasa / Math.max(1e-9, pres.tasa);
  const sup: FilaSup[] = [
    { k: "rec", label: "Préstamos recibidos de otras oficinas (2908)", pres: u(recibePres), real: u(real.recibe), prop: u(recibePres), resultado: true,
      formula: <>Saldo de préstamos internos del balance de corte; el presupuesto lo mantiene los 12 meses. Para cambiarlo: Pasivo → 2908 (transferencias).</> },
    { k: "pre", label: "Préstamos a otras oficinas (1908)", pres: u(prestaPres), real: u(real.presta), prop: u(prestaPres), resultado: true },
    { k: "tas", label: "Tasa interna anual", pres: p2(pres.tasa), real: p2(tReal), prop: entrada(prop.tasa, (x) => setProp({ tasa: x }), true, "tas", Math.abs(prop.tasa - pres.tasa) > 1e-9),
      formula: <>La misma tasa para lo que la agencia paga (41059005) y lo que cobra (5190). Se guarda en Proyección de ingresos → 5190 (tasa de préstamos internos). Ritmo real = interés del período × 12 ÷ saldo promedio de préstamos internos.</> },
    { k: "pag", label: "Interés pagado a otras oficinas al mes (41059005)", pres: u(pagaPres), real: u(real.prom.interno), prop: u(pagaPres * k), resultado: true },
    { k: "cob", label: "Interés cobrado a otras oficinas al mes (5190)", pres: u(cobraPres), real: u(real.prom.cobrado), prop: u(cobraPres * k), resultado: true },
  ];
  const impacto: { label: string; f: (R: Corrida) => number; fmt: (v: number) => string; tipo: TipoDif; mejor: 1 | -1 | 0; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    { label: "Obligaciones con el público (4101)", f: (R) => R.capt?.i4101 ?? 0, fmt: u, tipo: "usd", mejor: -1, formula: <>Sale de las captaciones: sus tasas y saldos se estudian en la cuenta 21.</> },
    { label: "Ahorro (410115)", f: (R) => R.capt?.i410115 ?? 0, fmt: u, tipo: "usd", mejor: -1, sub: true },
    { label: "Depósitos a plazo (410130)", f: (R) => R.capt?.i410130 ?? 0, fmt: u, tipo: "usd", mejor: -1, sub: true },
    { label: "Interés pagado a otras oficinas (41059005)", f: (R) => R.internos?.pagado ?? 0, fmt: u, tipo: "usd", mejor: -1 },
    { label: "Interés cobrado a otras oficinas (5190)", f: (R) => R.internos?.cobrado ?? 0, fmt: u, tipo: "usd", mejor: 1 },
    { label: "Utilidad del año", f: (R) => R.kpi.util, fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "ROA", f: (R) => R.kpi.roa, fmt: p2, tipo: "pp", mejor: 1 },
  ];

  return (
    <div className="flex flex-col gap-4 flex-1">
      <CabeceraCuenta<Vista> codigo="41" nombre="Intereses causados" vista={vista} onVista={setVista} izquierda={vista === "realidad" ? <SelectorIndicador lista={inds} sel={indSel} onSel={setInd} /> : null} />

      {vista === "realidad" && <>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-col" style={{ flex: "999 1 520px", minWidth: 0 }}><Indicadores lista={inds} sel={indSel} /></div>
          <Lateral items={[
            { t: "Intereses causados al mes", v: u(real.prom.i41), sub: real.prom.i41 ? `${Math.round((real.prom.i4101 / real.prom.i41) * 100)} % por captaciones (cuenta 21)` : undefined },
            { t: "Interés pagado a otras oficinas", v: u(real.prom.interno), sub: `Presupuesto ${ejercicioEnUso()}: ${u(pagaPres)} al mes` },
            { t: deudora ? "Deuda con otras oficinas" : "Préstamos a otras oficinas", v: u(deudora ? real.recibe : real.presta), sub: `al cierre de ${perCorto(ult.p)}` },
            { t: "Tasa interna", v: p2(tReal), sub: `Presupuesto ${ejercicioEnUso()}: ${p2(pres.tasa)}` },
          ]} />
        </div>
        <BandaEfecto pres={Rp.kpi.util} real={Rr.kpi.util} cuenta="la tasa interna" detalle={detalle} onDetalle={() => setDetalle((x) => !x)} />
        {detalle && (
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq} />{ms.map((m) => <th key={m.p} className={T.th}>{perCorto(m.p)}</th>)}<th className={T.th} style={{ color: E.tinta }}>Período</th></tr></thead>
              <tbody>{filasMes.map((r) => (
                <tr key={r.label} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400 }}>
                  <td className={`${T.tdIzq} min-w-[230px]`} style={{ color: r.sub ? E.gris : E.tinta, fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
                  {ms.map((m) => { const v = r.f(m); return <td key={m.p} className={T.td} style={{ color: v !== null && v < 0 ? E.alerta : E.tinta }}>{r.fmt(v)}</td>; })}
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
            <CabVersiones anioReal={real.anio} primera="Préstamos entre oficinas" />
            <tbody>{sup.map((f) => (
              <tr key={f.k} style={{ ...T.fila, color: f.resultado ? E.gris : E.tinta }}>
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
                <td className={`${T.tdIzq} ${r.sub ? "pl-5" : ""}`} style={{ fontFamily: "inherit", color: r.sub ? E.gris : E.tinta }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
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
