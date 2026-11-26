"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Formula } from "../ProvisionFlowParametros";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import {
  calcularRealidadGastos, versionPresGastos, versionRealGastos, insumosGastos, ajustesGastos, filasEstudioGastos, editable,
  GRUPOS_45, DEP_ESTUDIO, type VersionGastos, type MesGasto, type FilaDep,
} from "../../lib/calc/estudio-gastos";
import { cuentaCalculada } from "../../lib/calc/cuentas-calculadas";
import {
  E, NUM, T, p1, p2, u, perCorto, CabeceraCuenta, Indicadores, SelectorIndicador, type Indicador, Lateral, BandaEfecto, Delta, entrada,
  Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar, type TipoDif,
} from "./EstudioComun";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * 45 · GASTOS DE OPERACIÓN: realidad (estado de resultados por grupo y subcuenta), supuestos (incremento salarial
 * y gasto mensual de cada subcuenta del presupuesto departamental) e impacto en 2027 con el motor del presupuesto.
 */
const vacio: FilaDep[] = [];

export function useGastos(am: AgenciaMotor, h: HistoricoEstudio) {
  const dep = h.dep ?? vacio, nombres = useMemo(() => {
    const n: Record<string, string> = { ...(h.nombres ?? {}) };
    for (const f of dep) { const k = f.concepto.replace(/\D/g, "").slice(0, 6); if (!n[k] && f.cuenta_nombre) n[k] = f.cuenta_nombre; }
    return n;
  }, [h, dep]);
  const pres = useMemo(() => versionPresGastos(dep, am.ins.empleados), [dep, am]);
  const real = useMemo(() => calcularRealidadGastos(h), [h]);
  const vReal = useMemo(() => (real ? versionRealGastos(pres, real) : null), [pres, real]);
  const [propEd, setProp] = useBorrador<VersionGastos>(am.A.nombre, "45", (x): x is VersionGastos => {
    const v = x as VersionGastos; return !!v && typeof v.inc === "number" && !!v.sub && typeof v.sub === "object";
  });
  const prop = propEd ?? pres;
  const insumos = (v: VersionGastos) => insumosGastos(am.ins.filasPresupuesto, am.ins.empleados, pres, v, nombres);
  const correr = (v: VersionGastos | null) => { if (!v) return null; const x = insumos(v); return correrVersion(am, { filasPresupuesto: x.filas, empleados: x.empleados }); };
  const Rr = useMemo(() => correr(vReal), [am, pres, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => correr(prop), [am, pres, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  return { dep, nombres, pres, real, vReal, prop, setProp, editada: propEd !== null, insumos, Rr, Rx };
}
type EstadoGastos = ReturnType<typeof useGastos>;

type Vista = "realidad" | "supuestos" | "impacto";
const CORTO: Record<string, string> = { "4501": "Personal", "4502": "Honorarios", "4503": "Servicios", "4504": "Impuestos", "4505": "Depreciaciones", "4506": "Amortizaciones", "4507": "Otros" };
const grupoDe = (R: Corrida, g: string) => (g === "4501" ? R.er.personal : Object.entries(R.er.det).reduce((t, [k, v]) => t + (k.startsWith(g) ? v : 0), 0));

export function DetalleGastos({ c, am, Rp, ag, enviar, guardando }: { c: EstadoGastos; am: AgenciaMotor; Rp: Corrida; ag: string; enviar: Enviar; guardando: boolean }) {
  const [vista, setVista] = useState<Vista>("realidad");
  const [detalle, setDetalle] = useState(false);
  const [ind, setInd] = useState("");
  const [grupo, setGrupo] = useState("4501");
  const { dep, nombres, pres, real, vReal, prop, setProp, editada, Rr, Rx } = c;
  if (!real || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene estados de resultados mensuales cargados en Históricos.</p>;
  const ms = real.ventana, n = ms.length;
  const nombre = (k: string) => nombres[k] ?? k;
  const empleados = am.ins.empleados.length;

  const editar = (f: (v: VersionGastos) => void) => { const nv: VersionGastos = { inc: prop.inc, sub: { ...prop.sub } }; f(nv); setProp(nv); };
  const aplicar = async (v: VersionGastos, origen: string) => {
    const aj = ajustesGastos(pres, v), cambiaInc = Math.abs(v.inc - pres.inc) > 1e-9;
    if (!Object.keys(aj).length && !cambiaInc) { window.alert("El presupuesto ya tiene estos supuestos."); return; }
    const gastos = filasEstudioGastos(dep, aj, nombres);
    const que = [Object.keys(aj).length ? `${Object.keys(aj).length} subcuenta(s) de gasto (como ajuste en el departamento "${DEP_ESTUDIO}"; las filas cargadas no se tocan)` : "", cambiaInc ? `el incremento salarial de los ${empleados} empleados (${p2(v.inc)})` : ""].filter(Boolean).join(" y ");
    if (await enviar({ gastos, incremento: cambiaInc ? v.inc : null }, `Gastos de operación, ${origen}`, `Se guardará en el presupuesto de ${ag}: ${que}.`)) setProp(null);
  };

  // ---- realidad
  const gen = (m: MesGasto) => m.total - m.grupos[0];
  const efi = (m: MesGasto) => (m.margen && m.margen > 0 ? m.total / m.margen : null);
  const inds: Indicador[] = [
    { id: "tot", label: "Gasto de operación", mejor: -1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.total })) },
    { id: "per", label: "Personal", mejor: -1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.grupos[0] })) },
    { id: "gen", label: "Gastos generales", mejor: -1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: gen(m) })) },
    { id: "efi", label: "Eficiencia", mejor: -1, pp: true, fmt: p1, serie: ms.map((m) => ({ p: m.p, v: efi(m) })) },
  ];
  const indSel = inds.some((x) => x.id === ind) ? ind : inds[0].id;
  const presMes = (Rp.er.personal + Rp.er.generales) / 12;
  const filasMes: { label: string; f: (m: MesGasto) => number | null; fmt: (v: number | null) => string; per: string; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    ...GRUPOS_45.map((g, i) => ({ g, i })).filter(({ i }) => ms.some((m) => Math.abs(m.grupos[i]) >= 1)).map(({ g, i }) => ({ label: `${g.k} ${g.n}`, f: (m: MesGasto) => m.grupos[i], fmt: u, per: u(ms.reduce((t, m) => t + m.grupos[i], 0)), sub: true })),
    { label: "Gasto de operación (45)", f: (m) => m.total, fmt: u, per: u(ms.reduce((t, m) => t + m.total, 0)), fuerte: true },
    { label: "Eficiencia", f: efi, fmt: p1, per: p1(real.eficiencia), formula: <>Gasto de operación ÷ (ingresos − intereses y comisiones causados, 41 y 42), como la calcula el presupuesto.</> },
  ];

  // ---- supuestos
  const gruposSup = GRUPOS_45.filter((g) => g.k === "4501" || Object.keys({ ...pres.sub, ...real.sub }).some((k) => k.startsWith(g.k)) || Math.abs(grupoDe(Rp, g.k)) > 1);
  const grupoSel = gruposSup.some((g) => g.k === grupo) ? grupo : "4501";
  const sum = (o: Record<string, number>, f: (k: string) => boolean) => Object.entries(o).reduce((t, [k, v]) => t + (f(k) ? v : 0), 0);
  type FilaSup = { k: string; label: string; pres: number | null; real: number | null; prop: ReactNode; fmt?: (v: number | null) => string; formula?: ReactNode; resultado?: boolean; gris?: boolean };
  const filasGrupo = (g: string): FilaSup[] => {
    const subs = [...new Set([...Object.keys(pres.sub), ...Object.keys(real.sub), ...Object.keys(Rp.er.det)])].filter((k) => k.startsWith(g) && k.length === 6 && !k.endsWith("99")).sort();
    const filas: FilaSup[] = [];
    if (g === "4501") {
      const manual = (k: string) => k.startsWith("4501") && k in pres.sub;
      const nomPres = Rp.er.personal / 12 - sum(pres.sub, manual), nomReal = real.grupos[0] - sum(real.sub, manual), nomProp = Rx.er.personal / 12 - sum(prop.sub, manual);
      filas.push(
        { k: "emp", label: "Empleados", pres: empleados, real: null, prop: <span style={{ color: E.gris }}>{empleados}</span>, fmt: (v) => (v === null ? "—" : String(v)), formula: <>Empleados activos de la agencia en Talento Humano (nómina).</> },
        { k: "inc", label: "Incremento salarial", pres: pres.inc, real: null, fmt: p2,
          prop: entrada(prop.inc, (x) => editar((v) => { v.inc = x; }), true, "inc", Math.abs(prop.inc - pres.inc) > 1e-9),
          formula: <>Presupuesto: promedio del incremento de los empleados (Talento Humano). La contabilidad no separa el aumento de sueldo de los cambios de personal (ingresos, salidas, horas extras, bonos), por eso no hay ritmo real: el crecimiento del gasto de personal ({p1(real.crecPersonal)} frente a los mismos meses del año anterior) se muestra en Realidad solo como referencia. Al aplicar, todos los empleados de la agencia quedan con el mismo incremento.</> },
        { k: "nom", label: "Nómina mensual (sueldos, beneficios y aportes)", pres: nomPres, real: nomReal, prop: u(nomProp), resultado: true, formula: <>Sale de Talento Humano: sueldo con el incremento, décimos, fondo de reserva e IESS patronal.</> },
      );
      for (const k of subs.filter(manual)) filas.push(filaSub(k));
    } else for (const k of subs) filas.push(filaSub(k));
    const gp = grupoDe(Rp, g) / 12, gr = real.grupos[GRUPOS_45.findIndex((x) => x.k === g)], gx = grupoDe(Rx, g) / 12;
    filas.push({ k: "tot", label: `Total ${GRUPOS_45.find((x) => x.k === g)?.n.toLowerCase()} al mes`, pres: gp, real: gr, prop: u(gx), resultado: true });
    return filas;
  };
  const filaSub = (k: string): FilaSup => {
    const calc = cuentaCalculada(k), ed = editable(k) && (k in pres.sub || !k.startsWith("4501"));
    if (!ed) return { k, label: `${k} ${nombre(k)}`, pres: (Rp.er.det[k] ?? 0) / 12, real: real.sub[k] ?? null, prop: u((Rx.er.det[k] ?? 0) / 12), resultado: true, formula: calc ? <>{calc}. No se edita aquí.</> : undefined };
    const v = prop.sub[k] ?? 0, p = pres.sub[k] ?? 0;
    return { k, label: `${k} ${nombre(k)}`, pres: p, real: real.sub[k] ?? null, prop: entrada(v, (x) => editar((nv) => { nv.sub[k] = x; }), false, `s${k}`, Math.abs(v - p) > 0.005) };
  };

  // ---- impacto
  const impacto: { label: string; f: (R: Corrida) => number; fmt: (v: number) => string; tipo: TipoDif; mejor: 1 | -1 | 0; fuerte?: boolean; sub?: boolean; formula?: ReactNode }[] = [
    { label: "Gasto de personal", f: (R) => R.er.personal, fmt: u, tipo: "usd", mejor: -1 },
    { label: "Gastos generales", f: (R) => R.er.generales, fmt: u, tipo: "usd", mejor: -1 },
    ...GRUPOS_45.slice(1).filter((g) => Math.abs(grupoDe(Rp, g.k)) > 1 || Math.abs(grupoDe(Rx, g.k)) > 1).map((g) => ({ label: g.n, f: (R: Corrida) => grupoDe(R, g.k), fmt: u, tipo: "usd" as const, mejor: -1 as const, sub: true })),
    { label: "Gasto de operación del año", f: (R) => R.er.personal + R.er.generales, fmt: u, tipo: "usd", mejor: -1, fuerte: true },
    { label: "Eficiencia", f: (R) => R.kpi.efic, fmt: p1, tipo: "pp", mejor: -1, formula: <>Gasto de operación ÷ (margen financiero + otros ingresos).</> },
    { label: "Utilidad del año", f: (R) => R.kpi.util, fmt: u, tipo: "usd", mejor: 1, fuerte: true },
    { label: "ROA", f: (R) => R.kpi.roa, fmt: p2, tipo: "pp", mejor: 1 },
  ];
  const enlace = "text-[13px] font-semibold hover:underline";
  const ult = ms[n - 1], ant = real.meses.find((m) => m.p === `${Number(ult.p.slice(0, 4)) - 1}${ult.p.slice(4)}`);

  return (
    <div className="flex flex-col gap-4 flex-1">
      <CabeceraCuenta<Vista> codigo="45" nombre="Gastos de operación" vista={vista} onVista={setVista}
        izquierda={vista === "realidad" ? <SelectorIndicador lista={inds} sel={indSel} onSel={setInd} /> : vista === "supuestos" ? <SelectorIndicador lista={gruposSup.map((g) => ({ id: g.k, label: CORTO[g.k] }))} sel={grupoSel} onSel={setGrupo} /> : null} />

      {vista === "realidad" && <>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-col" style={{ flex: "999 1 520px", minWidth: 0 }}><Indicadores lista={inds} sel={indSel} /></div>
          <Lateral items={[
            { t: "Gasto de operación mensual", v: u(real.total), sub: `Presupuesto ${ejercicioEnUso()}: ${u(presMes)} al mes` },
            { t: "Gasto de personal", v: u(real.grupos[0]), sub: real.total ? `${p1(real.grupos[0] / real.total)} del gasto de operación` : undefined },
            { t: "Crecimiento del gasto de personal", v: p1(real.crecPersonal), sub: ant ? `Frente a los mismos meses de ${Number(ult.p.slice(0, 4)) - 1}` : undefined, color: real.crecPersonal !== null && real.crecPersonal > 0.1 ? E.alerta : undefined },
            { t: "Eficiencia", v: p1(real.eficiencia), sub: `Presupuesto ${ejercicioEnUso()}: ${p1(Rp.kpi.efic)}` },
          ]} />
        </div>
        <BandaEfecto pres={Rp.kpi.util} real={Rr.kpi.util} cuenta="los gastos de operación" detalle={detalle} onDetalle={() => setDetalle((x) => !x)} />
        {detalle && <>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq} />{ms.map((m) => <th key={m.p} className={T.th}>{perCorto(m.p)}</th>)}<th className={T.th} style={{ color: E.tinta }}>Período</th></tr></thead>
              <tbody>{filasMes.map((r) => (
                <tr key={r.label} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400 }}>
                  <td className={`${T.tdIzq} min-w-[210px]`} style={{ color: r.sub ? E.gris : E.tinta, fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
                  {ms.map((m) => { const v = r.f(m); return <td key={m.p} className={T.td} style={{ color: v !== null && v < 0 ? E.alerta : E.tinta }}>{r.fmt(v)}</td>; })}
                  <td className={T.td} style={{ fontWeight: 600 }}>{r.per}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq}>Año</th>{["Meses", "Gasto de operación", "Al mes", "Personal", "Generales", "Eficiencia"].map((t) => <th key={t} className={T.th}>{t}</th>)}</tr></thead>
              <tbody>{real.anual.map((a) => (
                <tr key={a.anio} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontWeight: 600 }}>{a.anio}</td><td className={T.td}>{a.meses}</td><td className={T.td}>{u(a.total)}</td><td className={T.td}>{u(a.total / Math.max(1, a.meses))}</td>
                  <td className={T.td}>{u(a.personal)}</td><td className={T.td}>{u(a.generales)}</td><td className={T.td}>{p1(a.eficiencia)}</td>
                </tr>))}
                <tr style={T.fila}>
                  <td className={T.tdIzq} style={{ fontWeight: 600, color: E.oro }}>{ejercicioEnUso()}</td><td className={T.td} style={{ color: E.gris }}>Presupuesto</td><td className={T.td}>{u(Rp.er.personal + Rp.er.generales)}</td><td className={T.td}>{u(presMes)}</td>
                  <td className={T.td}>{u(Rp.er.personal)}</td><td className={T.td}>{u(Rp.er.generales)}</td><td className={T.td}>{p1(Rp.kpi.efic)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>}
      </>}

      {vista === "supuestos" && <>
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} primera={grupoSel === "4501" ? "Supuesto" : "Gasto mensual"} />
            <tbody>{filasGrupo(grupoSel).map((f) => {
              const fmt = f.fmt ?? u;
              return (
                <tr key={f.k} style={{ ...T.fila, color: f.resultado ? E.gris : E.tinta, fontWeight: f.k === "tot" ? 600 : 400 }}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{f.label}{f.formula && <Formula>{f.formula}</Formula>}</span></td>
                  <td className={T.td}>{fmt(f.pres)}</td>
                  <td className={T.td} style={{ color: f.gris ? E.tenue : undefined }}>{fmt(f.real)}</td>
                  <td className={T.td} style={{ paddingRight: f.resultado ? 18 : undefined }}>{f.prop}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <Acciones guardando={guardando} editada={editada} onReal={() => aplicar(vReal, "ritmo real")} onPropuesta={() => aplicar(prop, "propuesta")}>
          <BorradorLinks editada={editada} onReal={() => setProp(null)} />
          <button type="button" className={`${enlace} mr-auto`} style={{ color: E.verde }} onClick={() => vReal && setProp({ inc: vReal.inc, sub: { ...vReal.sub } })}>Partir del real</button>
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
