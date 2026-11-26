"use client";

import { useMemo } from "react";
import { leerNumero } from "../ActivosComun";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import {
  CUENTAS_OTROS, calcularRealidadOtros, presOtros, versionPresOtros, versionRealOtros, objetivo, ajustesOtros, filasConOtros, filasEstudioOtros, entraEn,
  type VersionOtros,
} from "../../lib/calc/estudio-otros";
import type { FilaPresupuestoDepartamental } from "../../lib/calc/orquestador";
import { E, NUM, T, p1, u, Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar } from "./EstudioComun";

/**
 * 52 · 54 · 56 · 47, cada una en su cuenta: monto del año, crecimiento frente a lo real de los últimos 12 meses,
 * peso en ingresos y en utilidad, y sus subcuentas. Supuesto propio: el crecimiento de la cuenta.
 */
export function useOtros(am: AgenciaMotor, h: HistoricoEstudio) {
  const filas = am.ins.filasPresupuesto;
  const nombres = useMemo(() => {
    const n: Record<string, string> = { ...(h.nombres ?? {}) };
    for (const f of filas) { const k = f.concepto.replace(/\D/g, "").slice(0, 6); if (!n[k] && f.cuenta_nombre) n[k] = f.cuenta_nombre; }
    return n;
  }, [filas, h]);
  const real = useMemo(() => calcularRealidadOtros(h), [h]);
  const pres = useMemo(() => presOtros(filas), [filas]);
  const vPres = useMemo(() => (real ? versionPresOtros(real, pres) : null), [real, pres]);
  const vReal = useMemo(() => (real ? versionRealOtros(real) : null), [real]);
  // un solo borrador con el crecimiento de las cuentas que se cambiaron; las demás quedan en su ritmo real
  const [propEd, setPropEd] = useBorrador<VersionOtros>(am.A.nombre, "otros", (x): x is VersionOtros =>
    !!x && typeof x === "object" && Object.values(x as object).every((v) => typeof v === "number"));
  const prop = useMemo(() => (vPres ? { ...vPres, ...(propEd ?? {}) } : null), [vPres, propEd]);
  /** cambia (o quita, con null) la propuesta de una cuenta */
  const ponerCuenta = (k: string, g: number | null) => {
    const nv: VersionOtros = { ...(propEd ?? {}) };
    if (g === null) delete nv[k]; else nv[k] = g;
    setPropEd(Object.keys(nv).length ? nv : null);
  };
  const aj = (v: VersionOtros, solo?: string) => (real ? ajustesOtros(filas, real, pres, v, solo) : {});
  /** filas (de otra cuenta del estudio, o las del presupuesto) + los ajustes de esta versión */
  const agregar = (base: FilaPresupuestoDepartamental[], v: VersionOtros | null) => (v ? filasConOtros(base, aj(v), nombres) : base);
  const correr = (v: VersionOtros | null, solo?: string) => (v && real ? correrVersion(am, { filasPresupuesto: filasConOtros(filas, aj(v, solo), nombres) }) : null);
  // cada cuenta por separado (ritmo real y propuesta)
  const efReal = useMemo(() => Object.fromEntries(CUENTAS_OTROS.map(({ c }) => [c, correr(vReal, c)])) as Record<string, Corrida | null>, [am, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const efProp = useMemo(() => Object.fromEntries(CUENTAS_OTROS.map(({ c }) => [c, correr(prop, c)])) as Record<string, Corrida | null>, [am, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  return { filas, nombres, real, pres, vPres, vReal, prop, propEd, ponerCuenta, agregar, aj, efReal, efProp };
}
type EstadoOtros = ReturnType<typeof useOtros>;

function Crec({ v, onChange, distinta }: { v: number; onChange: (x: number) => void; distinta: boolean }) {
  return (
    <input key={v} defaultValue={(v * 100).toFixed(2).replace(".", ",")} aria-label="Crecimiento propuesto"
      onBlur={(e) => { const n = leerNumero(e.target.value); if (n !== null) onChange(Math.max(-100, n) / 100); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-[84px] h-8 rounded-md px-2 text-right text-[12px] outline-none focus:ring-2 focus:ring-[#C38A03]/40"
      style={{ ...NUM, border: `1px solid ${distinta ? E.oro : E.linea}`, background: distinta ? E.oroSuave : "#fff", color: E.tinta }} />
  );
}

const d6 = (c: string) => c.replace(/\D/g, "").slice(0, 6);
const ingresosDe = (R: Corrida) => R.er.ingFin + R.er.otrosIngTot;

export function DetalleOtros({ c, Rp, ag, cuenta, enviar, guardando }: { c: EstadoOtros; Rp: Corrida; ag: string; cuenta: string; enviar: Enviar; guardando: boolean }) {
  const { filas, nombres, real, pres, vPres, vReal, prop, propEd, ponerCuenta, aj, efReal, efProp } = c;
  const def = CUENTAS_OTROS.find((x) => x.c === cuenta)!;
  const Rr = efReal[cuenta], Rx = efProp[cuenta];
  if (!real || !vPres || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene estados de resultados mensuales cargados en Históricos.</p>;
  const k = cuenta, p = pres[k], r = real.anual[k], editable = k in vReal;
  const meta = objetivo(real, prop, k, p), metaReal = objetivo(real, vReal, k, p);
  const editada = !!propEd && k in propEd;
  const s = Math.abs(p) >= 1 ? meta / p : null;
  const signo = def.gasto ? -1 : 1;
  const peso = (x: number, b: number) => (b > 0 ? x / b : null);

  const aplicar = async (v: VersionOtros, origen: string) => {
    const a = aj(v, k);
    if (!Object.keys(a).length) { window.alert("El presupuesto ya tiene este monto."); return; }
    if (await enviar({ gastos: filasEstudioOtros(filas, a, nombres) }, `${k} ${def.n}, ${origen}`, `Se guardará en el presupuesto de ${ag}: ${k} ${def.n.toLowerCase()} por ${u(objetivo(real, v, k, p))} en el año.`)) ponerCuenta(k, null);
  };

  // subcuentas: lo cargado en el presupuesto y lo real
  const presSub: Record<string, number> = {};
  for (const f of filas) if (entraEn(k, f.concepto)) presSub[d6(f.concepto)] = (presSub[d6(f.concepto)] ?? 0) + (Number(f.monto) || 0);
  const subs = [...new Set([...Object.keys(presSub), ...Object.keys(real.sub).filter((x) => x.startsWith(k) && !(k === "56" && /^5604/.test(x)))])]
    .filter((x) => Math.abs(presSub[x] ?? 0) >= 1 || Math.abs(real.sub[x] ?? 0) >= 1).sort();

  type Fila = { id: string; label: string; pres: string; real: string; prop: React.ReactNode; gris?: boolean; fuerte?: boolean };
  const filasT: Fila[] = [
    { id: "monto", label: `${def.n} del año`, pres: u(p), real: u(metaReal), prop: u(meta), fuerte: true },
    { id: "crec", label: "Crecimiento frente a los últimos 12 meses", pres: p1(r > 0.5 ? p / r - 1 : null), real: p1(editable ? 0 : null),
      prop: editable ? <Crec v={prop[k]} distinta={Math.abs(meta - p) >= 1} onChange={(x) => ponerCuenta(k, x)} /> : <span style={{ color: E.tenue }}>—</span> },
    { id: "pi", label: "Peso en los ingresos", pres: p1(peso(p, ingresosDe(Rp))), real: p1(peso(metaReal, ingresosDe(Rr))), prop: p1(peso(meta, ingresosDe(Rx))), gris: true },
    { id: "pu", label: "Peso en la utilidad", pres: p1(peso(signo * p, Rp.kpi.util)), real: p1(peso(signo * metaReal, Rr.kpi.util)), prop: p1(peso(signo * meta, Rx.kpi.util)), gris: true },
    ...subs.map((x) => ({
      id: x, label: `${x} ${nombres[x] ?? ""}`.trim(), gris: true,
      pres: u(presSub[x] ?? 0), real: u(real.sub[x] ?? null), prop: u(s !== null ? (presSub[x] ?? 0) * s : null),
    })),
    ...(k === "56" ? [{ id: "5604", label: "5604 Recuperación y reversión (modelo de provisión)", gris: true, pres: u(Rp.er.cta?.["5604"]), real: u(real.anual["5604"]), prop: u(Rx.er.cta?.["5604"]) }] : []),
    { id: "util", label: "Utilidad del año", pres: u(Rp.kpi.util), real: u(Rr.kpi.util), prop: u(Rx.kpi.util), fuerte: true },
  ];

  return (
    <div className="flex flex-col gap-4 flex-1">
      <h2 className="sr-only">{k} {def.n}</h2>
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <CabVersiones anioReal={real.anio} primera={`${k} ${def.n}`} />
          <tbody>{filasT.map((f) => (
            <tr key={f.id} style={{ ...T.fila, color: f.gris ? E.gris : E.tinta, fontWeight: f.fuerte ? 600 : 400, background: f.id === "util" ? E.fondo : undefined }}>
              <td className={`${T.tdIzq} ${/^\d/.test(f.id) ? "pl-5" : ""}`} style={{ fontFamily: "inherit" }}>{f.label}</td>
              <td className={T.td}>{f.pres}</td><td className={T.td}>{f.real}</td>
              <td className={T.td} style={{ paddingRight: f.id === "crec" ? undefined : 18, color: f.fuerte ? E.tinta : undefined }}>{f.prop}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <Acciones guardando={guardando} editada={editada} onReal={() => aplicar(vReal, "ritmo real")} onPropuesta={() => aplicar(prop, "propuesta")}>
        <BorradorLinks editada={editada} onReal={() => ponerCuenta(k, null)} />
        {editable && <button type="button" className="text-[13px] font-semibold hover:underline mr-auto" style={{ color: E.verde }} onClick={() => vReal && ponerCuenta(k, vReal[k] ?? 0)}>Partir del real</button>}
      </Acciones>
    </div>
  );
}
