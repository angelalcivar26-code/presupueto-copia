"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { apiFetch } from "../lib/useDatos";
import { C, Tarjeta, usd, pct } from "./ActivosComun";
import { Formula, type EstadoProvisionFlow } from "./ProvisionFlowParametros";
import { urlFlow, seriesEscenario, type DatosFlow } from "./ProvisionFlowVistas";
import type { HistoricoEstudio } from "../lib/calc/estudio-agencia";
import type { ConfigFlow, Producto } from "../lib/calc/provision-flow";
import { resultadoDelAnio } from "../lib/calc/provision-metas";
import { diagnosticoAgencia, puenteAgencia, lineasFicha, type Diagnostico, type SimulacionFlow } from "../lib/calc/diagnostico-provision";
import {
  mesesAtipicos, basesCandidatas, evaluarBase, recomendarBase, nombreMes, nombreVentana,
  LIMITE_CAMBIO_COOP, LIMITE_CAMBIO_AGENCIA, LIMITE_MORA_PUNTOS, LIMITE_RAZONABLE_BASE, FACTOR_ATIPICO,
  type BaseCandidata, type ResultadoBase, type MesSerie,
} from "../lib/calc/base-calibracion";

/**
 * CARTERA → PROVISIÓN → Detalle técnico → Actualizar la base.
 * Cuando se cargan cortes nuevos (noviembre, diciembre), compara el presupuesto con varias bases de meses reales,
 * marca los meses atípicos, recomienda una con límites fijos y la guarda con un clic. Nada cambia hasta "Usar esta base".
 */
const AGENCIAS: [string, string][] = [["Matriz", "MATRIZ"], ["El Guabo", "EL GUABO"], ["Piñas", "PINAS"], ["Machala II", "MACHALA II"], ["Ponce Enríquez", "PONCE ENRIQUEZ"],
  ["Balsas", "BALSAS"], ["Santa Rosa", "SANTA ROSA"], ["Las Lajas", "LAS LAJAS"], ["Naranjal", "NARANJAL"], ["Catamayo", "CATAMAYO"]];
const NOMBRE_LINEA: Record<Producto, string> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
type Flow = DatosFlow & { simulacion?: SimulacionFlow };
type RealAnio = NonNullable<EstadoProvisionFlow["realAnio"]>;

interface FilaAg {
  a: string; pres: number | null; mora: number | null; util: number | null; real: number | null; sinMejoras: number | null;
  diag: Diagnostico | null; metas: { linea: Producto; pase: number | null; paseReal: number | null; rec: number | null; recReal: number | null }[];
}
interface Escenario { c: BaseCandidata; res: ResultadoBase; filas: FilaAg[]; real: number; pase: number | null; rec: number | null; castigos: number }

const json = (u: string) => apiFetch(u).then((r) => (r.ok ? r.json() : null)).then((j) => (j && !j.error ? j : null)).catch(() => null);
const S = (xs: (number | null)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
const firmadoPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v), 1)}`);
const puntos = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(2).replace(".", ",")} pts`);

/** Avisos de metas: la meta guardada ya no exige mejora con la nueva base, o exige más que el límite. */
function avisosMetas(f: FilaAg, a: FilaAg | undefined): string[] {
  const out: string[] = [];
  for (const m of f.metas) {
    const m0 = a?.metas.find((x) => x.linea === m.linea);
    const n = NOMBRE_LINEA[m.linea];
    if (m.pase !== null && m.paseReal !== null && m0?.paseReal != null) {
      const antes = m.pase < m0.paseReal - 1e-9, ahora = m.pase < m.paseReal - 1e-9;
      if (antes && !ahora) out.push(`${n}: la meta de pase ${pct(m.pase)} ya se cumple (real ${pct(m.paseReal)})`);
    }
    if (m.rec !== null && m.recReal !== null && m.recReal > 0 && m0?.recReal != null && m0.recReal > 0) {
      const antes = m.rec > m0.recReal + 1e-9, ahora = m.rec > m.recReal + 1e-9;
      if (antes && !ahora) out.push(`${n}: la meta de recuperación ${pct(m.rec)} ya se cumple (real ${pct(m.recReal)})`);
      if (m.rec / m.recReal - 1 > LIMITE_RAZONABLE_BASE && !(m.rec / m0.recReal - 1 > LIMITE_RAZONABLE_BASE))
        out.push(`${n}: la meta de recuperación ${pct(m.rec)} exige más de ${LIMITE_RAZONABLE_BASE * 100} % sobre el real (${pct(m.recReal)})`);
    }
  }
  return out;
}

/** Gasto neto de provisión y castigos de la cooperativa, mes a mes (suma de las agencias). */
function serieCooperativa(hist: Record<string, HistoricoEstudio | null>, desde: string, hasta: string): MesSerie[] {
  const m = new Map<string, { gasto: number | null; castigos: number | null }>();
  for (const [a] of AGENCIAS) {
    const d = hist[a] ? diagnosticoAgencia(hist[a]!, desde, hasta) : null;
    for (const x of d?.porMes ?? []) {
      const v = m.get(x.p) ?? { gasto: 0, castigos: 0 };
      v.gasto = x.gasto === null || v.gasto === null ? null : v.gasto + x.gasto;
      v.castigos = x.castigos === null || v.castigos === null ? null : v.castigos + x.castigos;
      m.set(x.p, v);
    }
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, v]) => ({ p, ...v }));
}

export function ActualizarBase({ estado, ejercicio, onGuardar }: { estado: EstadoProvisionFlow; ejercicio: number; onGuardar: (c: ConfigFlow) => Promise<boolean> }) {
  const cfg = estado.config;
  const conER = new Set(estado.eerr.map((e) => e.periodo));
  const cortes = estado.periodos.map((p) => p.periodo).sort();
  // último mes con calificación y estado de resultados: el último que puede entrar en una base
  const ultimo = [...cortes].reverse().find((p) => conER.has(p)) ?? null;
  const sinER = cortes.filter((p) => p > cfg.ventanaHasta && !conER.has(p));
  const nuevos = cortes.filter((p) => p > cfg.ventanaHasta && conER.has(p));

  const [hist, setHist] = useState<Record<string, HistoricoEstudio | null> | null>(null);
  const [escs, setEscs] = useState<Escenario[] | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ver, setVer] = useState<BaseCandidata["id"] | null>(null);
  const [confirmar, setConfirmar] = useState<BaseCandidata["id"] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // serie mensual de la cooperativa (gasto neto y castigos) desde el inicio de la base hasta el último mes cargado
  const serie: MesSerie[] = hist && ultimo ? serieCooperativa(hist, cfg.ventanaDesde, ultimo) : [];
  const atipicos = mesesAtipicos(serie);
  const cands = basesCandidatas({ desde: cfg.ventanaDesde, hasta: cfg.ventanaHasta }, ultimo, atipicos.map((x) => x.p));

  async function calcular() {
    setError(null); setMsg(null); setEscs(null);
    try {
      setProgreso("Leyendo la historia de las agencias…");
      const hs: Record<string, HistoricoEstudio | null> = Object.fromEntries(await Promise.all(AGENCIAS.map(async ([a]) => [a, await json(`/api/estudio-agencia?agencia=${encodeURIComponent(a)}`)] as const)));
      setHist(hs);
      // las bases dependen de los meses atípicos, que salen de la historia: se recalculan aquí con los mismos datos
      const ser = ultimo ? serieCooperativa(hs, cfg.ventanaDesde, ultimo) : [];
      const cs = basesCandidatas({ desde: cfg.ventanaDesde, hasta: cfg.ventanaHasta }, ultimo, mesesAtipicos(ser).map((x) => x.p));
      const out: Escenario[] = [];
      for (let k = 0; k < cs.length; k++) {
        const c = cs[k];
        setProgreso(`Calculando ${c.nombre.toLowerCase()} (${nombreVentana(c.desde, c.hasta)}), ${k + 1} de ${cs.length}…`);
        const q = c.id === "A" ? "" : `&ventana=${c.desde}_${c.hasta}`;
        const [par, ...flows] = await Promise.all([
          json(`/api/provision-flow-parametros${c.id === "A" ? "" : `?ventana=${c.desde}_${c.hasta}`}`) as Promise<{ realAnio?: RealAnio } | null>,
          ...AGENCIAS.map(([a]) => json(urlFlow(a, ejercicio) + q) as Promise<Flow | null>),
        ]);
        if (!par || flows.some((f) => !f?.disponible)) throw new Error(`No se pudo calcular ${c.nombre.toLowerCase()}.`);
        const filas: FilaAg[] = AGENCIAS.map(([a, clave], i) => {
          const flow = flows[i]!;
          const s = seriesEscenario(flow, flow.escenario);
          const gasto = s.gastoNeto.reduce((t, x) => t + x, 0);
          const br = flow.carteraBruta?.[11] ?? 0, rg = flow.carteraRiesgo?.[11] ?? 0;
          const ra = par.realAnio?.porOficina?.[clave];
          const real = ra ? ra.valor / 12 : null;
          const sim = flow.simulacion && real !== null ? puenteAgencia(flow.simulacion, flow.escenario, flow.mesesPuente ?? 0, gasto, real) : null;
          const diag = hs[a] ? diagnosticoAgencia(hs[a]!, c.desde, c.hasta) : null;
          const lineas = lineasFicha(flow.cartera?.referencia, flow.cartera?.supuestos, diag?.pvLinea ?? [], diag && diag.recCap > 0 ? diag.recUsd / diag.recCap : null);
          return { a, pres: gasto / 12, mora: br > 0 ? rg / br : null, util: resultadoDelAnio(flow.resultadoEjercicio), real,
            sinMejoras: sim ? sim.sinMejorasAnual / 12 : null, diag,
            metas: lineas.map((l) => ({ linea: l.linea, pase: l.pase, paseReal: l.paseReal, rec: l.rec, recReal: l.recReal })) };
        });
        const bruta = S(flows.map((f) => f!.carteraBruta?.[11] ?? 0)), riesgo = S(flows.map((f) => f!.carteraRiesgo?.[11] ?? 0));
        const ds = filas.map((f) => f.diag).filter((d): d is Diagnostico => !!d);
        const D = (g: (d: Diagnostico) => number) => ds.reduce((t, d) => t + g(d), 0);
        out.push({
          c, filas,
          res: { id: c.id, pres: S(filas.map((f) => f.pres)), mora: bruta > 0 ? riesgo / bruta : null, util: S(filas.map((f) => f.util)),
            agencias: filas.map((f) => ({ a: f.a, pres: f.pres, real: f.real, sinMejoras: f.sinMejoras })) },
          real: S(filas.map((f) => f.real)),
          pase: D((d) => d.pasePv0) > 0 ? D((d) => d.paseUsd) / D((d) => d.pasePv0) : null,
          rec: D((d) => d.recCap) > 0 ? D((d) => d.recUsd) / D((d) => d.recCap) : null,
          castigos: ds.reduce((t, d) => t + d.porMes.reduce((u, m) => u + (m.castigos ?? 0), 0) / Math.max(1, d.porMes.length), 0),
        });
        setEscs([...out]);
      }
      setProgreso(null);
    } catch (e) {
      setProgreso(null); setError(e instanceof Error ? e.message : "No se pudo calcular.");
    }
  }

  const reco = escs && escs.length === cands.length ? recomendarBase(cands, escs.map((e) => e.res)) : null;
  const A = escs?.find((e) => e.c.id === "A");
  // detalle por agencia: la base elegida en la tabla, la recomendada o, si se mantiene la aprobada, la primera alternativa
  const elegido = escs?.find((e) => e.c.id === ver) ?? escs?.find((e) => e.c.id === reco?.id && e.c.id !== "A") ?? escs?.find((e) => e.c.id !== "A") ?? null;

  async function usar(c: BaseCandidata) {
    const ok = await onGuardar({ ...cfg, ventanaDesde: c.desde, ventanaHasta: c.hasta, ventanaAuto: false });
    setConfirmar(null);
    if (ok) { setMsg(`La base ahora es ${nombreVentana(c.desde, c.hasta)}. Revise Integridad y el Resumen.`); setEscs(null); }
  }

  const TH = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const TD = "px-3 py-1.5 text-right tabla-cifras whitespace-nowrap";
  const reglas = (
    <>
      <p>Cada base usa el mismo modelo; solo cambian los meses reales con los que se ajusta al gasto real.</p>
      <p className="mt-1">Mes atípico: su gasto de provisión o sus castigos son más de {String(FACTOR_ATIPICO).replace(".", ",")} veces la mediana (o menos de la mediana ÷ {String(FACTOR_ATIPICO).replace(".", ",")}), o el gasto es negativo.</p>
      <p className="mt-1">Se recomienda una base nueva solo si, frente a la aprobada: la provisión de la cooperativa cambia hasta {LIMITE_CAMBIO_COOP * 100} %, la morosidad de diciembre hasta {LIMITE_MORA_PUNTOS * 100} punto, ninguna agencia más de {LIMITE_CAMBIO_AGENCIA * 100} %, todas quedan dentro de los controles de provisión (±{LIMITE_RAZONABLE_BASE * 100} %) y no suma un mes nuevo atípico. Entre las que cumplen, la de más meses; si ninguna cumple, se mantiene la aprobada.</p>
      <p className="mt-1">Las metas de pase y recuperación guardadas no cambian; el panel avisa cuáles quedan más fáciles o más exigentes con la nueva base.</p>
    </>
  );

  return (
    <Tarjeta titulo={<span className="inline-flex items-center gap-1">Actualizar la base<Formula info>{reglas}</Formula></span>}
      sub={`Base aprobada: ${nombreVentana(cfg.ventanaDesde, cfg.ventanaHasta)}${cfg.ventanaAuto === false ? " (fija)" : ""}`}
      derecha={<button type="button" onClick={calcular} disabled={!!progreso}
        className="h-8 px-3 rounded-md text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: C.acento }}>
        {escs ? "Volver a calcular" : "Comparar bases"}</button>}>
      <div className="flex flex-col gap-4 px-4 py-4 text-[13px]" style={{ color: C.texto2 }}>
        {!nuevos.length && (
          <p>No hay meses nuevos después de la base. Al cargar la calificación y el estado de resultados de noviembre o diciembre, aquí se comparan las bases y se elige una.</p>
        )}
        {nuevos.length > 0 && <p>Meses nuevos fuera de la base: <b>{nuevos.map(nombreMes).join(" · ")}</b>. Hasta elegir, el presupuesto sigue con la base aprobada.</p>}
        {sinER.length > 0 && <p style={{ color: C.aviso }}>Falta el estado de resultados de {sinER.map(nombreMes).join(", ")}: esos meses no entran en ninguna base hasta cargarlo (Carga de datos).</p>}
        {progreso && <p style={{ color: C.tenue }}>{progreso}</p>}
        {error && <p style={{ color: C.alerta }}>{error}</p>}
        {msg && <p style={{ color: C.ok }}>{msg}</p>}

        {serie.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-[12px] min-w-full">
              <thead><tr style={{ color: C.tenue }}>
                <th className="px-3 py-2 text-left font-medium">Mes</th><th className={TH}>Gasto neto de provisión</th><th className={TH}>Castigos</th>
                <th className={TH}>En la base aprobada</th><th className="px-3 py-2 text-left font-medium">Revisión</th>
              </tr></thead>
              <tbody>{serie.map((m) => {
                const at = atipicos.find((x) => x.p === m.p);
                return (
                  <tr key={m.p} style={{ borderTop: `1px solid ${C.borde}` }}>
                    <td className="px-3 py-1.5">{nombreMes(m.p)}</td>
                    <td className={TD}>{m.gasto === null ? "—" : usd(m.gasto)}</td>
                    <td className={TD}>{m.castigos === null ? "—" : usd(m.castigos)}</td>
                    <td className={TD}>{m.p >= cfg.ventanaDesde && m.p <= cfg.ventanaHasta ? <Check size={14} className="inline" style={{ color: C.ok }} /> : "—"}</td>
                    <td className="px-3 py-1.5" style={{ color: at ? C.alerta : C.ok }}>{at ? `Atípico: ${at.motivos.join("; ")}` : "Normal"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}

        {escs && escs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-[12px] min-w-full">
              <thead><tr style={{ color: C.tenue }}>
                <th className="px-3 py-2 text-left font-medium">Cooperativa</th>
                {escs.map((e) => (
                  <th key={e.c.id} className={TH}>
                    <button type="button" onClick={() => setVer(e.c.id)} className="inline-flex flex-col items-end"
                      style={{ color: (elegido?.c.id === e.c.id) ? C.acento : C.texto2, fontWeight: elegido?.c.id === e.c.id ? 700 : 500 }}>
                      <span>{e.c.nombre}{reco?.id === e.c.id && <span className="ml-1.5 px-1.5 rounded text-[10px]" style={{ background: C.acentoSuave, color: C.acento }}>Recomendada</span>}</span>
                      <span className="text-[11px]" style={{ color: C.tenue }}>{nombreVentana(e.c.desde, e.c.hasta)} · {e.c.meses} meses</span>
                    </button>
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {([
                  ["Gasto real al mes (base)", (e: Escenario) => usd(e.real)],
                  ["Pase a riesgo real", (e: Escenario) => (e.pase === null ? "—" : pct(e.pase))],
                  ["Recuperación de vencida real", (e: Escenario) => (e.rec === null ? "—" : pct(e.rec))],
                  ["Castigos reales al mes", (e: Escenario) => usd(e.castigos)],
                  ["Provisión presupuestada al mes", (e: Escenario) => <b>{usd(e.res.pres)}</b>],
                  ["Cambio frente a la aprobada", (e: Escenario) => (A ? firmadoPct(e.res.pres / A.res.pres - 1) : "—")],
                  ["Morosidad dic-" + String(ejercicio).slice(2), (e: Escenario) => (e.res.mora === null ? "—" : pct(e.res.mora))],
                  ["Cambio de morosidad", (e: Escenario) => (A && e.res.mora !== null && A.res.mora !== null ? puntos(e.res.mora - A.res.mora) : "—")],
                  ["Utilidad dic-" + String(ejercicio).slice(2), (e: Escenario) => usd(e.res.util)],
                  ["Revisión", (e: Escenario) => {
                    if (!A || e.c.id === "A") return <span style={{ color: C.ok }}>En uso</span>;
                    const ev = evaluarBase(e.res, A.res, e.c);
                    return <span style={{ color: ev.dentro ? C.ok : C.alerta }} title={ev.motivos.join("; ")}>{ev.dentro ? "Dentro de los límites" : `${ev.motivos.length} ${ev.motivos.length > 1 ? "observaciones" : "observación"}`}</span>;
                  }],
                ] as [string, (e: Escenario) => ReactNode][]).map(([t, f]) => (
                  <tr key={t} style={{ borderTop: `1px solid ${C.borde}` }}>
                    <td className="px-3 py-1.5">{t}</td>
                    {escs.map((e) => <td key={e.c.id} className={TD}>{f(e)}</td>)}
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${C.borde}` }}>
                  <td className="px-3 py-2" />
                  {escs.map((e) => (
                    <td key={e.c.id} className="px-3 py-2 text-right">
                      {e.c.desde === cfg.ventanaDesde && e.c.hasta === cfg.ventanaHasta ? <span style={{ color: C.tenue }}>Base actual</span>
                        : confirmar === e.c.id ? (
                          <span className="inline-flex gap-1.5">
                            <button type="button" onClick={() => setConfirmar(null)} className="h-7 px-2 rounded-md text-[12px]" style={{ border: `1px solid ${C.borde}` }}>Cancelar</button>
                            <button type="button" onClick={() => usar(e.c)} className="h-7 px-2 rounded-md text-[12px] font-semibold text-white" style={{ background: C.acento }}>Confirmar</button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmar(e.c.id)} className="h-7 px-2 rounded-md text-[12px] font-semibold"
                            style={{ border: `1px solid ${C.acento}`, color: C.acento }}>Usar esta base</button>
                        )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {escs && A && escs.some((e) => e.c.id !== "A") && (
          <ul className="flex flex-col gap-1 text-[12px]">
            {escs.filter((e) => e.c.id !== "A").map((e) => {
              const ev = evaluarBase(e.res, A.res, e.c);
              return <li key={e.c.id}><b>{e.c.nombre}:</b> <span style={{ color: ev.dentro ? C.ok : C.alerta }}>{ev.dentro ? "dentro de todos los límites" : ev.motivos.join("; ")}</span></li>;
            })}
          </ul>
        )}
        {reco && (
          <div className="rounded-lg px-4 py-3" style={{ background: reco.id === "A" ? C.avisoSuave : C.acentoSuave, color: C.texto2 }}>
            <b>Recomendación:</b> {reco.motivo}
          </div>
        )}

        {elegido && A && elegido.c.id !== "A" && (
          <div className="overflow-x-auto">
            <p className="mb-2 font-semibold" style={{ color: C.texto }}>Por agencia: {elegido.c.nombre.toLowerCase()} ({nombreVentana(elegido.c.desde, elegido.c.hasta)}) frente a la aprobada</p>
            <table className="text-[12px] min-w-full">
              <thead><tr style={{ color: C.tenue }}>
                <th className="px-3 py-2 text-left font-medium">Agencia</th>
                <th className={TH}>Provisión aprobada</th><th className={TH}>Con esta base</th><th className={TH}>Cambio</th>
                <th className={TH}>Morosidad dic</th><th className={TH}>Frente al real</th>
                <th className="px-3 py-2 text-left font-medium">Metas a revisar</th>
              </tr></thead>
              <tbody>{elegido.filas.map((f) => {
                const a = A.filas.find((x) => x.a === f.a);
                const cambio = f.pres !== null && a?.pres ? f.pres / a.pres - 1 : null;
                const fr = f.pres !== null && f.real ? f.pres / f.real - 1 : null;
                const av = avisosMetas(f, a);
                return (
                  <tr key={f.a} style={{ borderTop: `1px solid ${C.borde}` }}>
                    <td className="px-3 py-1.5">{f.a}</td>
                    <td className={TD}>{a?.pres == null ? "—" : usd(a.pres)}</td>
                    <td className={TD}>{f.pres === null ? "—" : usd(f.pres)}</td>
                    <td className={TD} style={{ color: cambio !== null && Math.abs(cambio) > LIMITE_CAMBIO_AGENCIA ? C.alerta : undefined }}>{firmadoPct(cambio)}</td>
                    <td className={TD}>{f.mora === null ? "—" : pct(f.mora)}</td>
                    <td className={TD} style={{ color: fr !== null && Math.abs(fr) > LIMITE_RAZONABLE_BASE ? C.alerta : undefined }}>{firmadoPct(fr)}</td>
                    <td className="px-3 py-1.5" style={{ color: av.length ? C.aviso : C.tenue }}>{av.length ? av.join(" · ") : "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
