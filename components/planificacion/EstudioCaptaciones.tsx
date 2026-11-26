"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Formula } from "../ProvisionFlowParametros";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import {
  calcularRealidadCapt, filasVersionCapt, versionPresCapt, versionRealCapt, NOMBRE_PRODUCTO,
  type HistoricoEstudio, type MesCapt, type VersionCapt,
} from "../../lib/calc/estudio-agencia";
import { E, NUM, T, p1, p2, u, n2, perCorto, CabeceraCuenta, Indicadores, SelectorIndicador, type Indicador, Lateral, BandaEfecto, Delta, entrada, Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar, type TipoDif } from "./EstudioComun";

/**
 * 21 · OBLIGACIONES CON EL PÚBLICO: ahorro a la vista, Crecer y depósitos a plazo.
 * Realidad (210135, 2103, 21; intereses 410115, 410130, 4101) · Supuestos (Captaciones → Parámetros) · Impacto 2027.
 */
const sal = (s: Record<string, number>, ks: string[]) => ks.reduce((t, k) => t + Number(s[k] ?? 0), 0);
const netoAhorro = (v: VersionCapt, i: number) => (1 + v.ing[i] - v.ret[i]) * (1 + v.tasa[i] / 12) - 1;
const netoPlazo = (v: VersionCapt) => v.canc * (v.ren - 1);

export function useCaptaciones(am: AgenciaMotor, h: HistoricoEstudio) {
  const pres = useMemo(() => versionPresCapt(am.ins.paramsCaptaciones), [am]);
  const real = useMemo(() => calcularRealidadCapt(h), [h]);
  const ini = useMemo(() => ({ vista: sal(am.ins.saldos, ["21013505", "21013510", "21013535"]), crecer: sal(am.ins.saldos, ["21013515"]) }), [am]);
  const vReal = useMemo(() => (real ? versionRealCapt(pres, real, ini) : null), [pres, real, ini]);
  const [propEd, setProp] = useBorrador<VersionCapt>(am.A.nombre, "21", (x): x is VersionCapt => {
    const v = x as VersionCapt, w = vReal as VersionCapt | null;
    return !!v && !!w && Object.keys(w).every((k) => k in v && Array.isArray((w as unknown as Record<string, unknown>)[k]) === Array.isArray((v as unknown as Record<string, unknown>)[k]));
  });
  const prop = propEd ?? pres;
  const filas = (v: VersionCapt) => filasVersionCapt(am.ins.paramsCaptaciones, pres, v);
  const Rr = useMemo(() => (vReal ? correrVersion(am, { paramsCaptaciones: filas(vReal) }) : null), [am, pres, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => (prop ? correrVersion(am, { paramsCaptaciones: filas(prop) }) : null), [am, pres, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  const conCrecer = ini.crecer > 0 || am.ins.paramsCaptaciones.some((f) => f.producto === "CRECER" && (f.tasa_interes_anual > 0 || (f.pct_ingresos ?? 0) > 0));
  return { pres, real, vReal, prop, setProp, editada: propEd !== null, filas, Rr, Rx, conCrecer };
}
type EstadoCaptaciones = ReturnType<typeof useCaptaciones>;

type Vista = "realidad" | "supuestos" | "impacto";

export function DetalleCaptaciones({ c, am, Rp, ag, enviar, guardando }: { c: EstadoCaptaciones; am: AgenciaMotor; Rp: Corrida; ag: string; enviar: Enviar; guardando: boolean }) {
  const [vista, setVista] = useState<Vista>("realidad");
  const [detalle, setDetalle] = useState(false);
  const [ind, setInd] = useState("");
  const [grupo, setGrupo] = useState("0");
  const { pres, real, vReal, prop, setProp, editada, filas, Rr, Rx, conCrecer } = c;
  if (!real || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene balances mensuales cargados en Históricos.</p>;
  const ms = real.ventana, ult = ms[ms.length - 1];
  const productos = [0, ...(conCrecer ? [1] : []), 2];

  const editar = (f: (v: VersionCapt) => void) => { const nv: VersionCapt = { tasa: [...prop.tasa], ing: [...prop.ing], ret: [...prop.ret], canc: prop.canc, ren: prop.ren }; f(nv); setProp(nv); };
  const aplicar = async (v: VersionCapt, origen: string) => {
    const f = filas(v);
    if (!f.some((x, i) => JSON.stringify(x) !== JSON.stringify(am.ins.paramsCaptaciones[i]))) { window.alert("El presupuesto ya tiene estos supuestos."); return; }
    if (await enviar({ filasCaptaciones: f }, `Captaciones, ${origen}`, `Se reemplazarán los parámetros de captaciones de ${ag} por los del ${origen}.`)) setProp(null);
  };
  const abs = (x: number | null) => (x === null ? null : Math.abs(x));
  const sumaAbs = (f: (m: MesCapt) => number | null) => ms.reduce((t, m) => t + Math.abs(f(m) ?? 0), 0);
  const costoMes = (m: MesCapt) => (m.int41 === null || m.a0 + m.d0 + m.a + m.d < 2000 ? null : Math.abs(m.int41) * 12 / ((m.a0 + m.d0 + m.a + m.d) / 2));

  const filasMes: { label: string; f: (m: MesCapt) => number | null; fmt: (v: number | null) => string; per: string; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    { label: "Ahorro a la vista y Crecer", f: (m) => m.a, fmt: u, per: u(ult.a), fuerte: true },
    ...(real.separado ? [
      { label: "Ahorro a la vista", f: (m: MesCapt) => m.v, fmt: u, per: u(ult.v), sub: true },
      { label: "Ahorro Crecer", f: (m: MesCapt) => m.c, fmt: u, per: u(ult.c), sub: true },
    ] : []),
    { label: "Crecimiento del mes", f: (m) => m.gA, fmt: p2, per: p2(real.gA), sub: true, formula: <>Saldo del mes ÷ saldo del mes anterior − 1. Período: promedio geométrico.</> },
    { label: "Interés pagado", f: (m) => abs(m.intA), fmt: u, per: u(sumaAbs((m) => m.intA)), sub: true },
    { label: "Tasa efectiva", f: (m) => m.tasaA, fmt: p2, per: p2(real.tasaA), sub: true, formula: <>Interés del mes (410115) × 12 ÷ saldo promedio del mes.</> },
    { label: "Depósitos a plazo", f: (m) => m.d, fmt: u, per: u(ult.d), fuerte: true },
    { label: "Crecimiento del mes", f: (m) => m.gD, fmt: p2, per: p2(real.gD), sub: true },
    { label: "Interés pagado", f: (m) => abs(m.intD), fmt: u, per: u(sumaAbs((m) => m.intD)), sub: true },
    { label: "Tasa efectiva", f: (m) => m.tasaD, fmt: p2, per: p2(real.tasaD), sub: true, formula: <>Interés del mes (410130) × 12 ÷ saldo promedio del mes.</> },
    { label: "Obligaciones con el público", f: (m) => m.total, fmt: u, per: u(ult.total), fuerte: true },
    { label: "Intereses causados", f: (m) => abs(m.int41), fmt: u, per: u(sumaAbs((m) => m.int41)) },
    { label: "Costo promedio", f: costoMes, fmt: p2, per: p2(real.costo), formula: <>Intereses 4101 × 12 ÷ (ahorro + plazo) promedio del mes.</> },
  ];

  type FilaSup = { label: string; pres: string; real: ReactNode; prop: ReactNode; formula?: ReactNode; resultado?: boolean };
  const dif = (a: number, b: number) => Math.abs(a - b) > 1e-9;
  const supuestos = (i: number): FilaSup[] => i < 2 ? [
    { label: "Tasa de interés anual", pres: p2(pres.tasa[i]), real: p2(vReal.tasa[i]), prop: entrada(prop.tasa[i], (x) => editar((v) => { v.tasa[i] = x; }), true, `t${i}`, dif(prop.tasa[i], pres.tasa[i])),
      formula: real.separado ? <>Ritmo real = interés 410115 ÷ saldo promedio.</> : <>El histórico no separa vista y Crecer: las dos tasas del presupuesto se escalan en la misma proporción hasta la tasa efectiva real del ahorro ({p2(real.tasaA)}).</> },
    { label: "Depósitos del mes", pres: p2(pres.ing[i]), real: p2(vReal.ing[i]), prop: entrada(prop.ing[i], (x) => editar((v) => { v.ing[i] = x; }), true, `i${i}`, dif(prop.ing[i], pres.ing[i])),
      formula: <>Ritmo real = retiros del presupuesto + crecimiento neto real. La contabilidad solo muestra el neto (depósitos − retiros).</> },
    { label: "Retiros del mes", pres: p2(pres.ret[i]), real: <span style={{ color: E.tenue }}>{p2(vReal.ret[i])}</span>, prop: entrada(prop.ret[i], (x) => editar((v) => { v.ret[i] = x; }), true, `r${i}`, dif(prop.ret[i], pres.ret[i])) },
    { label: "Crecimiento mensual que resulta", pres: p2(netoAhorro(pres, i)), real: p2(netoAhorro(vReal, i)), prop: p2(netoAhorro(prop, i)), resultado: true, formula: <>(1 + depósitos − retiros) × (1 + tasa ÷ 12) − 1, como lo calcula el motor.</> },
  ] : [
    { label: "Tasa de interés anual", pres: p2(pres.tasa[2]), real: p2(vReal.tasa[2]), prop: entrada(prop.tasa[2], (x) => editar((v) => { v.tasa[2] = x; }), true, "t2", dif(prop.tasa[2], pres.tasa[2])), formula: <>Ritmo real = interés 410130 ÷ saldo promedio.</> },
    { label: "Cancelaciones del mes", pres: p2(pres.canc), real: <span style={{ color: E.tenue }}>{p2(vReal.canc)}</span>, prop: entrada(prop.canc, (x) => editar((v) => { v.canc = x; }), true, "c", dif(prop.canc, pres.canc)) },
    { label: "Renovaciones por cada cancelación", pres: n2(pres.ren), real: n2(vReal.ren), prop: entrada(prop.ren, (x) => editar((v) => { v.ren = x; }), false, "rn", dif(prop.ren, pres.ren)),
      formula: <>Ritmo real = 1 + crecimiento real del mes ÷ cancelaciones del presupuesto. Más de 1: entran depósitos nuevos.</> },
    { label: "Crecimiento mensual que resulta", pres: p2(netoPlazo(pres)), real: p2(netoPlazo(vReal)), prop: p2(netoPlazo(prop)), resultado: true, formula: <>Cancelaciones × (renovaciones − 1), como lo calcula el motor.</> },
  ];

  const impacto: { label: string; f: (R: Corrida) => number; fmt: (v: number) => string; tipo: TipoDif; mejor: 1 | -1 | 0; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    { label: "Obligaciones con el público a diciembre", f: (R) => R.bal.capt, fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "Ahorro a la vista", f: (R) => R.capt?.vista ?? 0, fmt: u, tipo: "usd", mejor: 1, sub: true },
    ...(conCrecer ? [{ label: "Ahorro Crecer", f: (R: Corrida) => R.capt?.crecer ?? 0, fmt: u, tipo: "usd" as const, mejor: 1 as const, sub: true }] : []),
    { label: "Depósitos a plazo", f: (R) => R.capt?.dpf ?? 0, fmt: u, tipo: "usd", mejor: 1, sub: true },
    { label: "Intereses causados", f: (R) => R.capt?.i4101 ?? 0, fmt: u, tipo: "usd", mejor: -1 },
    { label: "Ahorro (410115)", f: (R) => R.capt?.i410115 ?? 0, fmt: u, tipo: "usd", mejor: -1, sub: true },
    { label: "Depósitos a plazo (410130)", f: (R) => R.capt?.i410130 ?? 0, fmt: u, tipo: "usd", mejor: -1, sub: true },
    { label: "Liquidez a diciembre", f: (R) => R.bal.liq, fmt: u, tipo: "usd", mejor: 1 },
    { label: "Captación por cada dólar de cartera", f: (R) => R.kpi.autof, fmt: n2, tipo: "num", mejor: 1 },
    { label: "Fondeo con otras oficinas", f: (R) => R.ajPlan?.fondeo ?? 0, fmt: u, tipo: "usd", mejor: 1, formula: <>Liquidez que falta o sobra frente al presupuesto × (tasa interna − tasa de bancos) ÷ 12. Si capta más, la agencia presta a otras oficinas y gana; si capta menos, paga.</> },
    { label: "Utilidad del año", f: (R) => R.kpi.util, fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "ROA", f: (R) => R.kpi.roa, fmt: p2, tipo: "pp", mejor: 1 },
  ];

  const grupoSel = productos.map(String).includes(grupo) ? grupo : "0";
  const inds: Indicador[] = [
              { id: "tot", label: "Obligaciones", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.total })) },
              { id: "aho", label: "Ahorro", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.a })) },
              { id: "pla", label: "Depósitos a plazo", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.d })) },
              { id: "cos", label: "Costo", mejor: -1, pp: true, fmt: p2, serie: ms.map((m) => ({ p: m.p, v: costoMes(m) })) },
            ];
  const indSel = inds.some((x) => x.id === ind) ? ind : inds[0].id;
  const enlace = "text-[13px] font-semibold hover:underline";
  return (
    <div className="flex flex-col gap-4 flex-1">
      <CabeceraCuenta<Vista> codigo="21" nombre="Obligaciones con el público" vista={vista} onVista={setVista} izquierda={vista === "realidad" ? <SelectorIndicador lista={inds} sel={indSel} onSel={setInd} /> : vista === "supuestos" ? <SelectorIndicador lista={productos.map((k) => ({ id: String(k), label: NOMBRE_PRODUCTO[k] }))} sel={grupoSel} onSel={setGrupo} /> : null} />

      {vista === "realidad" && <>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-col" style={{ flex: "999 1 520px", minWidth: 0 }}>
            <Indicadores lista={inds} sel={indSel} />
          </div>
          <Lateral items={[
            { t: "Obligaciones con el público", v: u(ult.total), sub: `${ult.total >= ms[0].total ? "Sube" : "Baja"} ${u(Math.abs(ult.total - ms[0].total))} desde ${perCorto(ms[0].p)}`, subColor: ult.total >= ms[0].total ? E.verde : E.alerta },
            { t: "Crecimiento mensual del ahorro", v: p2(real.gA), color: real.gA < 0 ? E.alerta : undefined },
            { t: "Crecimiento mensual de plazo", v: p2(real.gD), color: real.gD < 0 ? E.alerta : undefined },
            { t: "Costo de captaciones", v: p2(real.costo), sub: `Ahorro ${p2(real.tasaA)}, plazo ${p2(real.tasaD)}` },
          ]} />
        </div>
        <BandaEfecto pres={Rp.kpi.util} real={Rr.kpi.util} cuenta="las captaciones" detalle={detalle} onDetalle={() => setDetalle((x) => !x)} />
        {detalle && <>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq} />{ms.map((m) => <th key={m.p} className={T.th}>{perCorto(m.p)}</th>)}<th className={T.th} style={{ color: E.tinta }}>Período</th></tr></thead>
              <tbody>{filasMes.map((r, k) => (
                <tr key={k} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400 }}>
                  <td className={`${T.tdIzq} min-w-[170px] ${r.sub ? "pl-4" : ""}`} style={{ color: r.sub ? E.gris : E.tinta, fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
                  {ms.map((m) => { const v = r.f(m); return <td key={m.p} className={T.td} style={{ color: v !== null && v < 0 ? E.alerta : E.tinta }}>{r.fmt(v)}</td>; })}
                  <td className={T.td} style={{ fontWeight: 600 }}>{r.per}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}>
                <th className={T.thIzq}>Año</th>
                {["Meses", "Ahorro al cierre", "Plazo al cierre", "Obligaciones", "Crecimiento del ahorro", "Crecimiento de plazo", "Tasa ahorro", "Tasa plazo", "Costo"].map((t) => <th key={t} className={T.th}>{t}</th>)}
              </tr></thead>
              <tbody>{real.anual.map((a) => (
                <tr key={a.anio} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontWeight: 600 }}>{a.anio}</td><td className={T.td}>{a.meses}</td><td className={T.td}>{u(a.ahorro)}</td><td className={T.td}>{u(a.plazo)}</td><td className={T.td}>{u(a.total)}</td>
                  <td className={T.td}>{p1(a.gAhorro)}</td><td className={T.td}>{p1(a.gPlazo)}</td><td className={T.td}>{p2(a.tasaA)}</td><td className={T.td}>{p2(a.tasaD)}</td><td className={T.td}>{p2(a.costo)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </>}
      </>}

      {vista === "supuestos" && <>
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} primera="Supuesto" />
            <tbody>{supuestos(Number(grupoSel)).map((f) => (
                <tr key={f.label} style={{ ...T.fila, color: f.resultado ? E.gris : E.tinta }}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{f.label}{f.formula && <Formula>{f.formula}</Formula>}</span></td>
                  <td className={T.td}>{f.pres}</td><td className={T.td}>{f.real}</td><td className={T.td} style={{ paddingRight: f.resultado ? 18 : undefined }}>{f.prop}</td>
                </tr>
              ))}</tbody>
          </table>
        </div>
        <Acciones guardando={guardando} editada={editada} onReal={() => aplicar(vReal, "ritmo real")} onPropuesta={() => aplicar(prop, "propuesta")}>
          <BorradorLinks editada={editada} onReal={() => setProp(null)} />
          <button type="button" className={`${enlace} mr-auto`} style={{ color: E.verde }} onClick={() => vReal && setProp({ tasa: [...vReal.tasa], ing: [...vReal.ing], ret: [...vReal.ret], canc: vReal.canc, ren: vReal.ren })}>Partir del real</button>
        </Acciones>
      </>}

      {vista === "impacto" && (
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} extra="Propuesta vs presupuesto" />
            <tbody>{impacto.map((r, k) => (
              <tr key={k} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400, background: r.label === "Utilidad del año" ? E.fondo : undefined }}>
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
