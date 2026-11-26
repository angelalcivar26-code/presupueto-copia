"use client";
/**
 * CARTERA → PROVISIÓN: la historia de la provisión para el Consejo, con los meses sin alivio (junio al último mes cargado).
 *  Resumen (el puente explicado con sus cifras) · Agencias (una tabla y la ficha de la agencia elegida) · Controles.
 * Cálculos en lib/calc/diagnostico-provision.ts; el presupuesto de cada agencia es el del modelo por tramos (/api/provision-flow).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../lib/useDatos";
import { C, Tarjeta, usd, pct } from "./ActivosComun";
import { EsqueletoTabla } from "./Carga";
import { Formula, type EstadoProvisionFlow } from "./ProvisionFlowParametros";
import { urlFlow, seriesEscenario, type DatosFlow } from "./ProvisionFlowVistas";
import type { HistoricoEstudio } from "../lib/calc/estudio-agencia";
import type { Producto } from "../lib/calc/provision-flow";
import { resultadoDelAnio } from "../lib/calc/provision-metas";
import {
  diagnosticoAgencia, puenteAgencia, sumarPuentes, minimoNorma, lineasFicha, LIMITE_POLITICA,
  type Diagnostico, type Puente, type SimulacionFlow, type LineaFicha,
} from "../lib/calc/diagnostico-provision";

export type VistaEstudio = "resumen" | "agencias" | "controles";

const AGENCIAS: [string, string][] = [["Matriz", "MATRIZ"], ["El Guabo", "EL GUABO"], ["Piñas", "PINAS"], ["Machala II", "MACHALA II"], ["Ponce Enríquez", "PONCE ENRIQUEZ"],
  ["Balsas", "BALSAS"], ["Santa Rosa", "SANTA ROSA"], ["Las Lajas", "LAS LAJAS"], ["Naranjal", "NARANJAL"], ["Catamayo", "CATAMAYO"]];
const NOMBRE_LINEA: Record<Producto, string> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesTxt = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;
const p2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : pct(v, d));
const m = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.abs(v) < 0.5 ? "—" : usd(v));
const firmado = (v: number) => (Math.abs(v) < 0.5 ? "—" : `${v > 0 ? "+" : "−"}${usd(Math.abs(v))}`);
const TD = "px-3 text-right tabla-cifras whitespace-nowrap";
const TH = "px-3 py-2 text-right font-medium whitespace-nowrap";

type Flow = DatosFlow & { simulacion?: SimulacionFlow };
interface Fila {
  a: string; diag: Diagnostico | null; realMes: number | null; ratio: number | null; flow: Flow | null;
  puente: Puente | null; presMes: number | null; dif: number | null;
  minimo: number[] | null; prov1499: number[] | null; moraPres: number | null; cobPres: number | null;
  utilPres: number | null; utilPes: number | null; lineas: LineaFicha[];
}

// ---------------------------------------------------------------------
// Datos: una sola lectura para todas las vistas
// ---------------------------------------------------------------------
const memoria = new Map<string, Promise<{ flows: Record<string, Flow | null>; hist: Record<string, HistoricoEstudio | null> }>>();
function leer(ejercicio: number, version: string) {
  const k = `${ejercicio}|${version}`;
  if (!memoria.has(k)) {
    memoria.clear();
    const json = (u: string) => apiFetch(u).then((r) => (r.ok ? r.json() : null)).then((j) => (j && !j.error ? j : null)).catch(() => null);
    memoria.set(k, Promise.all(AGENCIAS.map(async ([a]) => [a, await json(urlFlow(a, ejercicio)), await json(`/api/estudio-agencia?agencia=${encodeURIComponent(a)}`)] as const))
      .then((xs) => ({ flows: Object.fromEntries(xs.map(([a, f]) => [a, f])), hist: Object.fromEntries(xs.map(([a, , h]) => [a, h])) })));
  }
  return memoria.get(k)!;
}

function useFilas(estado: EstadoProvisionFlow, ejercicio: number, version: number) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof leer>> | null>(null);
  // se vuelve a leer cada vez que se abre la sección (el presupuesto puede haber cambiado en Planificación o en Parámetros)
  const [montaje] = useState(() => Date.now());
  useEffect(() => { let vivo = true; leer(ejercicio, `${version}|${montaje}`).then((d) => vivo && setDatos(d)); return () => { vivo = false; }; }, [ejercicio, version, montaje]);
  return useMemo(() => {
    if (!datos) return null;
    const desde = estado.config.ventanaDesde;
    const filas: Fila[] = AGENCIAS.map(([a, clave]) => {
      const h = datos.hist[a], flow = datos.flows[a];
      const diag = h ? diagnosticoAgencia(h, desde, estado.realAnio?.hasta) : null;
      const ra = estado.realAnio?.porOficina?.[clave];
      const realMes = ra ? ra.valor / 12 : null;
      let puente: Puente | null = null, presMes: number | null = null, minimo: number[] | null = null, prov1499: number[] | null = null;
      let moraPres: number | null = null, cobPres: number | null = null, utilPres: number | null = null, utilPes: number | null = null;
      if (flow?.disponible && flow.escenarios) {
        const s = seriesEscenario(flow, flow.escenario);
        const gasto = s.gastoNeto.reduce((t, x) => t + x, 0);
        presMes = gasto / 12; prov1499 = s.prov1499;
        const saldos = Object.fromEntries(Object.entries(s.porProducto).map(([p, x]) => [p, x?.saldos ?? {}])) as Partial<Record<Producto, Record<string, number[]>>>;
        minimo = minimoNorma(saldos, estado.categoriasCorte as never);
        const br = flow.carteraBruta?.[11] ?? 0, rg = flow.carteraRiesgo?.[11] ?? 0;
        moraPres = br > 0 ? rg / br : null; cobPres = rg > 0 ? s.prov1499[11] / rg : null;
        utilPres = resultadoDelAnio(flow.resultadoEjercicio);
        if (flow.simulacion && realMes !== null) {
          puente = puenteAgencia(flow.simulacion, flow.escenario, flow.mesesPuente ?? 0, gasto, realMes);
          utilPes = utilPres - (puente.sinMejorasAnual - puente.presupuestoAnual);
        }
      }
      return {
        a, diag, realMes, ratio: ra?.ratio ?? null, flow, puente, presMes, dif: presMes !== null && realMes ? presMes / realMes - 1 : null,
        minimo, prov1499, moraPres, cobPres, utilPres, utilPes,
        lineas: lineasFicha(flow?.cartera?.referencia, flow?.cartera?.supuestos, diag?.pvLinea ?? [], diag && diag.recCap > 0 ? diag.recUsd / diag.recCap : null),
      };
    });
    return filas;
  }, [datos, estado]);
}

/** Totales de la cooperativa: suma de las agencias (los % son cocientes de las sumas). */
function totales(fs: Fila[]) {
  const ds = fs.map((f) => f.diag).filter((d): d is Diagnostico => !!d);
  const S = (g: (d: Diagnostico) => number) => ds.reduce((t, d) => t + g(d), 0);
  const cartera = S((d) => d.cartera), riesgo = S((d) => d.riesgo);
  const real = fs.reduce((t, f) => t + (f.realMes ?? 0), 0);
  return {
    cartera, riesgo, mora: cartera > 0 ? riesgo / cartera : null,
    pase: S((d) => d.pasePv0) > 0 ? S((d) => d.paseUsd) / S((d) => d.pasePv0) : null, paseUsd: S((d) => d.paseUsd),
    rec: S((d) => d.recCap) > 0 ? S((d) => d.recUsd) / S((d) => d.recCap) : null, recUsd: S((d) => d.recUsd),
    castigos: fs.reduce((t, f) => t + (castigosMes(f) ?? 0), 0),
    real, provFin: S((d) => d.provFin),
    pres: fs.reduce((t, f) => t + (f.presMes ?? 0), 0),
  };
}
/** Castigos al mes de una agencia: provisión inicial + gasto neto − provisión final, entre los meses. */
const castigosMes = (f: Fila) => (f.diag && f.realMes !== null ? (f.diag.provInicio - f.diag.provFin) / f.diag.meses + f.realMes : null);

/** Semáforo frente a la cooperativa: igual o mejor, hasta 25 % peor, más de 25 % peor. */
function color(v: number | null, ref: number | null, mejorAlto = false) {
  if (v === null || ref === null || !ref) return C.texto3;
  const peor = mejorAlto ? (ref - v) / ref : (v - ref) / ref;
  return peor <= 0 ? C.ok : peor <= 0.25 ? C.aviso : C.alerta;
}
const Valor = ({ v, c, sub }: { v: string; c?: string; sub?: string }) => (
  <span className="inline-flex flex-col items-end">
    <span className="inline-flex items-center gap-1.5" style={{ color: c ?? C.texto3, fontWeight: c && c !== C.texto3 ? 600 : 400 }}>
      {c && c !== C.texto3 && <span aria-hidden className="w-[7px] h-[7px] rounded-full" style={{ background: c }} />}{v}
    </span>
    {sub && <span className="text-[11px]" style={{ color: C.tenue }}>{sub}</span>}
  </span>
);
const Cab = ({ t, children }: { t: string; children?: ReactNode }) => (
  <span className="inline-flex items-center justify-end gap-0.5">{t}{children && <Formula info derecha>{children}</Formula>}</span>
);

function SelectorAgencia({ valor, onChange, consolidado }: { valor: string; onChange: (a: string) => void; consolidado?: boolean }) {
  return (
    <select aria-label="Agencia" value={valor} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md px-2 text-[13px] bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>
      {consolidado && <option value="Consolidado">Consolidado</option>}
      {AGENCIAS.map(([a]) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}

// =====================================================================
export function ProvisionEstudio({ vista, agencia, ejercicio, estado, version }: {
  vista: VistaEstudio; agencia: string; ejercicio: number; estado: EstadoProvisionFlow; version: number;
}) {
  const filas = useFilas(estado, ejercicio, version);
  const [ag, setAg] = useState(agencia === "Consolidado" ? "Matriz" : agencia);
  const [agP, setAgP] = useState(agencia);
  const ra = estado.realAnio;
  const periodo = ra?.desde && ra?.hasta ? `${MES[Number(ra.desde.slice(5, 7)) - 1]}–${MES[Number(ra.hasta.slice(5, 7)) - 1]} ${ra.anio}` : "";
  if (!filas) return <EsqueletoTabla filas={10} indicadores={false} />;
  const T = totales(filas);
  if (vista === "resumen") return <VResumen filas={filas} ag={agP} setAg={setAgP} periodo={periodo} ejercicio={ejercicio} />;
  if (vista === "agencias") return <VAgencias filas={filas} T={T} ag={ag} setAg={setAg} periodo={periodo} ejercicio={ejercicio} coopP100={ra?.ratioCooperativa ?? null} />;
  return <VControles filas={filas} ejercicio={ejercicio} validacion={estado.validacion} periodo={periodo} />;
}

/** Datos con que se explica cada paso del puente (de la agencia o de la cooperativa). */
function datosPuente(fs: Fila[]) {
  const S = (g: (f: Fila) => number | null | undefined) => fs.reduce((t, f) => t + (g(f) ?? 0), 0);
  const brutaHoy = S((f) => f.diag?.cartera), brutaDic = S((f) => f.flow?.carteraBruta?.[11]);
  // pase: cuánto menos entra a riesgo al mes, por línea (real − presupuesto) × cartera por vencer de la línea
  const lineas = new Map<Producto, { real: number[]; pres: number[]; menos: number }>();
  for (const f of fs) for (const l of f.lineas) {
    const x = lineas.get(l.linea) ?? { real: [], pres: [], menos: 0 }; lineas.set(l.linea, x);
    if (l.paseReal !== null) x.real.push(l.paseReal); if (l.pase !== null) x.pres.push(l.pase); x.menos += l.menosRiesgo ?? 0;
  }
  // recuperación de vencida: lo real (neto ÷ capital vencido) y la del presupuesto de la línea con más cartera
  const rec = fs.map((f) => {
    const d = f.diag; if (!d || d.recCap <= 0) return null;
    const i = d.pvLinea.indexOf(Math.max(...d.pvLinea)), l = f.lineas.find((x) => x.linea === (["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"] as Producto[])[i]) ?? f.lineas[0];
    const r0 = d.recUsd / d.recCap, r1 = l?.rec ?? r0;
    return { a: f.a, r0, r1, cap: d.recCap, mas: (r1 - r0) * d.recCap };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const porAg = fs.map((f) => ({ a: f.a, menos: f.lineas.reduce((t, l) => t + Math.max(0, l.menosRiesgo ?? 0), 0) })).sort((p, q) => q.menos - p.menos);
  const castigosMes = S((f) => (f.flow?.disponible && f.flow.escenarios ? seriesEscenario(f.flow, f.flow.escenario).castigos.reduce((t, x) => t + x, 0) / 12 : 0));
  return { brutaHoy, brutaDic, lineas, rec, porAg, castigosMes, menosTotal: porAg.reduce((t, x) => t + x.menos, 0), masRec: rec.reduce((t, x) => t + x.mas, 0) };
}

// =====================================================================
// 1. RESUMEN: el puente y su explicación con cifras
// =====================================================================
function VResumen({ filas, ag, setAg, periodo, ejercicio }: { filas: Fila[]; ag: string; setAg: (a: string) => void; periodo: string; ejercicio: number }) {
  const fs = ag === "Consolidado" ? filas : filas.filter((f) => f.a === ag);
  const ps = fs.map((f) => f.puente).filter((p): p is Puente => !!p);
  const p = ps.length ? sumarPuentes(ps) : null;
  const pasos: { k: string; v: number; total?: boolean }[] = p ? [
    { k: `Gasto real · ${periodo}`, v: p.real, total: true },
    { k: `Crecimiento de la cartera ${ejercicio}`, v: p.cartera },
    { k: "Menos pase a riesgo", v: p.pase },
    { k: "Más recuperación de vencida", v: p.recuperacion },
    ...(Math.abs(p.meta) >= 0.5 ? [{ k: "Meta de provisión", v: p.meta }] : []),
    { k: `Presupuesto ${ejercicio}`, v: p.presupuesto, total: true },
  ] : [];
  const maxV = Math.max(1, ...pasos.reduce<number[]>((acc, s) => { const prev = acc.length ? acc[acc.length - 1] : 0; acc.push(s.total ? s.v : prev + s.v); return acc; }, [])) * 1.05;
  let acum = 0;
  const pes = fs.reduce((t, f) => t + (f.puente ? f.puente.sinMejorasAnual / 12 : 0), 0), uPes = fs.reduce((t, f) => t + (f.utilPes ?? 0), 0), uPres = fs.reduce((t, f) => t + (f.utilPres ?? 0), 0);
  return (
    <Tarjeta titulo="Del gasto real al presupuesto" sub="Gasto neto de provisión al mes (4402 − 5604.10)" derecha={<span className="inline-flex items-center gap-3">
      <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: C.texto2 }}>Cómo se calcula<Formula info derecha>
        Norma SEPS: cada crédito se califica por sus días de atraso (A1 al día; A2–A3 hasta 30 días; B 31–60; C 61–90; D 91–120; E más de 120 en consumo y microcrédito) y se provisiona un % por calificación (A1 1–2 %, A2–A3 2–6 %, B 6–20 %, C 20–60 %, D 60–100 %, E 100 %).
        El gasto (4402) es la provisión que falta cuando un crédito empeora de calificación; cuando se cobra o se pone al día, su provisión se libera (5604.10).
        El castigo se hace contra la provisión ya constituida (E al 100 %): no es gasto. Lo que se cobra de lo castigado es ingreso (5604.05).
        Por eso la provisión baja con: menos cartera que pasa a riesgo (cobranza temprana), más recuperación de la cartera vencida y castigo de la cartera E.
      </Formula></span>
      <SelectorAgencia valor={ag} onChange={setAg} consolidado />
    </span>}>
      {!p ? <p className="px-4 py-3 text-[12px]" style={{ color: C.texto2 }}>Sin datos para el puente.</p> : (
        <div className="px-4 py-3 flex flex-col">
          {pasos.map((s) => {
            let left: number, width: number, col: string;
            if (s.total) { left = 0; width = (s.v / maxV) * 100; col = C.acento; acum = s.v; }
            else { const a = acum, b = acum + s.v; left = (Math.min(a, b) / maxV) * 100; width = Math.abs(s.v) < 0.5 ? 0 : Math.max(0.5, (Math.abs(s.v) / maxV) * 100); col = s.v < 0 ? "#3D9A66" : "#D9822B"; acum = b; }
            return (
              <div key={s.k} className="grid items-center gap-3 py-2" style={{ gridTemplateColumns: "minmax(180px, 260px) minmax(0, 1fr) 120px", borderBottom: `1px solid ${C.beige}` }}>
                <span className="text-[13px]" style={{ fontWeight: s.total ? 600 : 400, color: C.texto }}>{s.k}</span>
                <div className="relative h-[22px] rounded" style={{ background: C.crema }}>
                  <div className="absolute top-[3px] bottom-[3px] rounded-sm" style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%`, background: col }} />
                </div>
                <span className="text-right text-[13px] tabla-cifras" style={{ fontWeight: s.total ? 600 : 500, color: s.total ? C.texto : s.v < -0.5 ? C.ok : s.v > 0.5 ? "#8A4B0F" : C.tenue }}>{s.total ? usd(s.v) : firmado(s.v)}</span>
              </div>
            );
          })}
          <Lectura p={p} fs={fs} ag={ag} periodo={periodo} ejercicio={ejercicio} />
          <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div className="rounded-lg px-3 py-2" style={{ background: C.crema }}>
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: C.texto2 }}>Si no se logra la mejora (sin el idóneo)<Formula info>La cartera {ejercicio} con el pase a riesgo y la recuperación de hoy: es el escenario pesimista.</Formula></span>
              <b className="block text-[15px] tabla-cifras">{usd(pes)} al mes · utilidad {usd(uPes)}</b>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: C.crema }}>
              <span className="text-[11px]" style={{ color: C.texto2 }}>Presupuesto {ejercicio}</span>
              <b className="block text-[15px] tabla-cifras" style={{ color: C.acento }}>{usd(p.presupuesto)} al mes · utilidad {usd(uPres)}</b>
            </div>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

/** El puente en palabras, con los datos de cada paso. */
function Lectura({ p, fs, ag, periodo, ejercicio }: { p: Puente; fs: Fila[]; ag: string; periodo: string; ejercicio: number }) {
  const d = datosPuente(fs), quien = ag === "Consolidado" ? "La cooperativa" : ag;
  const dif = p.presupuesto - p.real, b = (v: number) => <b style={{ color: C.texto }}>{usd(Math.abs(v))}</b>;
  const mm = (v: number) => (v < 0 ? "menos" : "más");
  const lineas = [...d.lineas.entries()].filter(([, x]) => Math.abs(x.menos) >= 0.5).sort((q, r) => r[1].menos - q[1].menos);
  const prom = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
  const unaAg = ag !== "Consolidado";
  const r = unaAg ? d.rec[0] : null;
  return (
    <div className="mt-4 rounded-lg px-4 py-3 text-[13px] leading-relaxed flex flex-col gap-2.5" style={{ background: C.crema, color: C.texto2 }}>
      <p className="m-0">{quien} provisiona hoy {b(p.real)} al mes ({periodo}). Para {ejercicio} se presupuesta {b(p.presupuesto)}: {b(dif)} {mm(dif)} ({p2(p.real ? dif / p.real : null, 1)}). Cada paso cambia una sola cosa con el mismo modelo:</p>
      <div>
        <b style={{ color: C.texto }}>1. Crecimiento de la cartera: {firmado(p.cartera)}</b>
        <p className="m-0">La cartera bruta pasa de {b(d.brutaHoy)} (hoy) a {b(d.brutaDic)} (dic-{String(ejercicio).slice(2)}), {p2(d.brutaHoy ? d.brutaDic / d.brutaHoy - 1 : null, 1)}. Con el mismo comportamiento de hoy, {d.brutaDic >= d.brutaHoy ? "la cartera adicional necesita" : "con menos cartera se necesita"} {b(p.cartera)} {mm(p.cartera)} de provisión al mes.</p>
      </div>
      <div>
        <b style={{ color: C.texto }}>2. Menos pase a riesgo: {firmado(p.pase)}</b>
        <p className="m-0">Se pide que entre menos cartera a no devenga o vencida (idóneo de cada agencia):</p>
        <ul className="m-0 pl-5 list-disc">
          {lineas.map(([l, x]) => <li key={l}>{NOMBRE_LINEA[l]}: {fs.length === 1 ? <>el pase baja de {p2(prom(x.real))} a {p2(prom(x.pres))} al mes de la cartera por vencer → </> : null}{b(x.menos)} {x.menos >= 0 ? "menos" : "más"} a riesgo al mes.</li>)}
        </ul>
        <p className="m-0">En total entran {b(d.menosTotal)} menos a riesgo al mes{fs.length > 1 ? <> (las que más aportan: {d.porAg.slice(0, 3).filter((x) => x.menos > 0.5).map((x, i) => <span key={x.a}>{i ? ", " : ""}{x.a} {usd(x.menos)}</span>)})</> : null}. Esa cartera ya no llega a los tramos con atraso, que son los que más se provisionan: {b(p.pase)} {mm(p.pase)} al mes.</p>
      </div>
      <div>
        <b style={{ color: C.texto }}>3. Más recuperación de vencida: {firmado(p.recuperacion)}</b>
        <p className="m-0">{r ? <>La recuperación de la cartera vencida pasa de {p2(r.r0)} a {p2(r.r1)} al mes sobre {b(r.cap)} de capital vencido: se recuperan {b(r.mas)} {r.mas >= 0 ? "más" : "menos"} al mes.</> : <>Las agencias recuperan {b(d.masRec)} más de cartera vencida al mes.</>} Lo que se cobra de la cartera vencida sale de ella y libera su provisión (reversión): {b(p.recuperacion)} {mm(p.recuperacion)} al mes.</p>
      </div>
      {Math.abs(p.meta) >= 0.5 && <p className="m-0"><b style={{ color: C.texto }}>4. Meta de provisión: {firmado(p.meta)}</b></p>}
      <p className="m-0"><b style={{ color: C.texto }}>Castigos: </b>{b(d.castigosMes)} al mes, repartidos según la cartera calificada E de cada agencia. Salen de la cartera en riesgo y de la provisión: bajan la morosidad sin gasto, porque esa cartera ya está provisionada al 100 %.</p>
      <p className="m-0 text-[12px]" style={{ color: C.tenue }}>El modelo está ajustado para que, con la cartera de hoy y sin mejoras, dé el gasto real de cada agencia; por eso el punto de partida es el real.</p>
    </div>
  );
}

// =====================================================================
// 2. AGENCIAS: una tabla y la ficha de la agencia elegida
// =====================================================================
function VAgencias({ filas, T, ag, setAg, periodo, ejercicio, coopP100 }: { filas: Fila[]; T: ReturnType<typeof totales>; ag: string; setAg: (a: string) => void; periodo: string; ejercicio: number; coopP100: number | null }) {
  const [detalle, setDetalle] = useState(false);
  const f = filas.find((x) => x.a === ag) ?? filas[0];
  const cob = (x: Fila) => (x.diag && x.diag.riesgo > 0 ? x.diag.provFin / x.diag.riesgo : null);
  const S = (g: (x: Fila) => number | null | undefined) => filas.reduce((t, x) => t + (g(x) ?? 0), 0);
  const brT = S((x) => x.flow?.carteraBruta?.[11]), rgT = S((x) => x.flow?.carteraRiesgo?.[11]), pvT = S((x) => x.prov1499?.[11]);
  const tot = { real: S((x) => x.realMes), pres: S((x) => x.presMes), moraDic: brT ? rgT / brT : null, cobDic: rgT ? pvT / rgT : null };
  const pase = (x: Fila) => (x.diag && x.diag.pasePv0 > 0 ? x.diag.paseUsd / x.diag.pasePv0 : null);
  // costo de riesgo: gasto de provisión del año ÷ cartera bruta (real con la de hoy, presupuesto con la de diciembre)
  const costo = (x: Fila) => {
    const br = x.flow?.carteraBruta?.[11] ?? 0;
    return { real: x.realMes !== null && x.diag && x.diag.cartera > 0 ? (x.realMes * 12) / x.diag.cartera : null, pres: x.presMes !== null && br > 0 ? (x.presMes * 12) / br : null };
  };
  const orden = filas.filter((x) => pase(x) !== null).sort((a, b) => pase(a)! - pase(b)!);
  return (
    <div className="flex flex-col gap-5">
      <Tarjeta titulo="Provisión por agencia" sub={`Real ${periodo} → presupuesto ${ejercicio}, al mes · pulse una agencia para ver su ficha`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[1060px]">
            <thead><tr style={{ color: C.texto2, borderBottom: `1px solid ${C.beige}` }}>
              <th className={TH} style={{ textAlign: "left" }}>Agencia</th>
              <th className={TH}><Cab t="Real al mes">Gasto neto de provisión al mes (4402 − 5604.10) de {periodo}.</Cab></th>
              <th className={TH}>Presupuesto al mes</th><th className={TH}>Cambio</th>
              <th className={TH}><Cab t="Menos en el año">(Real al mes − presupuesto al mes) × 12: cuánto deja de provisionar la agencia en {ejercicio}.</Cab></th>
              <th className={TH}><Cab t="% de la cartera">Gasto de provisión del año ÷ cartera bruta (costo de riesgo): real con la cartera de hoy → presupuesto con la cartera de diciembre {ejercicio}.</Cab></th>
              <th className={TH}><Cab t="Morosidad">Cartera en riesgo ÷ cartera bruta: hoy → diciembre {ejercicio}.</Cab></th>
              <th className={TH}><Cab t="Cobertura">Provisión 1499 ÷ cartera en riesgo: hoy → diciembre {ejercicio}.</Cab></th>
              <th className={TH}><Cab t="Por cada $100 de interés">Provisión 4402 ÷ interés de cartera 5104 × 100, real. Color frente a la cooperativa.</Cab></th>
            </tr></thead>
            <tbody>
              {filas.map((x) => {
                const sel = x.a === f.a, fuera = x.dif !== null && x.dif < -LIMITE_POLITICA - 1e-9, sube = x.diag?.mora !== null && x.diag?.mora !== undefined && x.moraPres !== null && x.moraPres > x.diag.mora + 0.0005;
                return (
                  <tr key={x.a} onClick={() => setAg(x.a)} className="cursor-pointer hover:bg-[#F7FAF8]" style={{ borderTop: `1px solid ${C.beige}`, height: 42, background: sel ? "#EEF5F0" : undefined }}>
                    <td className="px-3 font-medium" style={{ color: sel ? C.acento : C.texto }}>{x.a}</td>
                    <td className={TD}>{m(x.realMes)}</td>
                    <td className={TD} style={{ fontWeight: 600 }}>{m(x.presMes)}</td>
                    <td className={TD} style={{ color: fuera ? C.alerta : x.dif !== null && x.dif < -0.005 ? C.ok : C.texto3 }}>{p2(x.dif, 1)}</td>
                    <td className={TD}>{x.realMes !== null && x.presMes !== null ? m((x.realMes - x.presMes) * 12) : "—"}</td>
                    <td className={TD}>{p2(costo(x).real, 1)} → {p2(costo(x).pres, 1)}</td>
                    <td className={TD}>{p2(x.diag?.mora, 1)} → <span style={{ color: sube ? C.alerta : C.ok, fontWeight: 600 }}>{p2(x.moraPres, 1)}</span></td>
                    <td className={TD}>{p2(cob(x), 0)} → {p2(x.cobPres, 0)}</td>
                    <td className={TD}><Valor v={x.ratio === null ? "—" : `$${(x.ratio * 100).toFixed(1).replace(".", ",")}`} c={color(x.ratio, coopP100)} /></td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.borde}`, background: C.crema, height: 42, fontWeight: 600 }}>
                <td className="px-3">Cooperativa</td><td className={TD}>{m(tot.real)}</td><td className={TD}>{m(tot.pres)}</td><td className={TD}>{p2(tot.real ? tot.pres / tot.real - 1 : null, 1)}</td>
                <td className={TD}>{m((tot.real - tot.pres) * 12)}</td>
                <td className={TD}>{p2(T.cartera > 0 ? (tot.real * 12) / T.cartera : null, 1)} → {p2(brT > 0 ? (tot.pres * 12) / brT : null, 1)}</td>
                <td className={TD}>{p2(T.mora, 1)} → {p2(tot.moraDic, 1)}</td><td className={TD}>{p2(T.riesgo > 0 ? T.provFin / T.riesgo : null, 0)} → {p2(tot.cobDic, 0)}</td>
                <td className={TD}>{coopP100 === null ? "—" : `$${(coopP100 * 100).toFixed(1).replace(".", ",")}`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta titulo={f.a} sub="Qué debe lograr en el año" derecha={<div className="flex items-center gap-3">
        {f.dif !== null && <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={f.dif >= -LIMITE_POLITICA - 1e-9 ? { background: C.acentoSuave, color: C.ok } : { background: "#FBE9E7", color: C.alerta }}>{f.dif >= -LIMITE_POLITICA - 1e-9 ? "Dentro de la política" : "Fuera de la política"}</span>}
        {orden.findIndex((x) => x.a === f.a) >= 0 && <span className="text-[12px]" style={{ color: C.texto2 }}>Pase a riesgo: puesto {orden.findIndex((x) => x.a === f.a) + 1} de {orden.length}</span>}
      </div>}>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse min-w-[680px]">
              <thead><tr style={{ color: C.texto2, borderBottom: `1px solid ${C.beige}` }}>
                <th className={TH} style={{ textAlign: "left" }}>Línea</th>
                <th className={TH}>Pase a riesgo real</th><th className={TH}>Pase {ejercicio}</th>
                <th className={TH}><Cab t="Menos en riesgo al mes">(Pase real − pase {ejercicio}) × cartera por vencer de la línea al último mes. Entre paréntesis: entraría más a riesgo que en lo real.</Cab></th>
                <th className={TH}>Recuperación real</th><th className={TH}>Recuperación {ejercicio}</th>
              </tr></thead>
              <tbody>
                {f.lineas.map((l) => (
                  <tr key={l.linea} style={{ borderTop: `1px solid ${C.beige}`, height: 38 }}>
                    <td className="px-3 font-medium">{NOMBRE_LINEA[l.linea]}</td>
                    <td className={TD}>{p2(l.paseReal)}</td><td className={TD} style={{ color: C.acento, fontWeight: 600 }}>{p2(l.pase)}</td>
                    <td className={TD} style={{ color: (l.menosRiesgo ?? 0) > 0.5 ? C.ok : (l.menosRiesgo ?? 0) < -0.5 ? C.alerta : C.texto3 }}>{m(l.menosRiesgo)}</td>
                    <td className={TD}>{p2(l.recReal)}</td><td className={TD} style={{ color: C.acento, fontWeight: 600 }}>{p2(l.rec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]" style={{ color: C.texto2 }}>
            <span>Mínimo de la norma dic-{String(ejercicio).slice(2)}: <b style={{ color: C.texto }}>{m(f.minimo?.[11])}</b> · provisión <b style={{ color: (f.prov1499?.[11] ?? 0) < (f.minimo?.[11] ?? 0) ? C.alerta : C.acento }}>{m(f.prov1499?.[11])}</b></span>
            <button type="button" onClick={() => setDetalle(!detalle)} className="font-semibold hover:underline" style={{ color: C.acento }}>{detalle ? "Ocultar detalle" : "Ver detalle real mes a mes"}</button>
          </div>
          {detalle && f.diag && <DetalleReal f={f} periodo={periodo} />}
        </div>
      </Tarjeta>
    </div>
  );
}

/** Cómo se formó la provisión real de la agencia y sus indicadores mes a mes. */
function DetalleReal({ f, periodo }: { f: Fila; periodo: string }) {
  const d = f.diag!, g = f.realMes !== null ? f.realMes * d.meses : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12px]" style={{ color: C.texto2 }}>Cómo se formó ({periodo}): provisión al inicio <b>{m(d.provInicio)}</b> + gasto neto <b>{m(g)}</b> − castigos <b>{g !== null ? m(d.provInicio + g - d.provFin) : "—"}</b> = provisión al cierre <b>{m(d.provFin)}</b>.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse min-w-[640px]">
          <thead><tr style={{ color: C.texto2, borderBottom: `1px solid ${C.beige}` }}>
            <th className={TH} style={{ textAlign: "left" }}><Cab t="Indicador">En rojo: el mes se aleja más de 25 % del promedio de la agencia (mes atípico).</Cab></th>
            {d.porMes.map((x) => <th key={x.p} className={TH}>{mesTxt(x.p)}</th>)}<th className={TH}>Promedio</th>
          </tr></thead>
          <tbody>
            {([["Pase a riesgo", (x) => x.pase, p2], ["Recuperación de vencida", (x) => x.rec, p2], ["Gasto neto de provisión", (x) => x.gasto, m], ["Castigos", (x) => x.castigos, m]] as
              [string, (x: Diagnostico["porMes"][number]) => number | null, (v: number | null) => string][]).map(([label, gf, fmt]) => {
              const vs = d.porMes.map(gf), ok = vs.filter((v): v is number => v !== null), prom = ok.length ? ok.reduce((t, v) => t + v, 0) / ok.length : null;
              return (
                <tr key={label} style={{ borderTop: `1px solid ${C.beige}`, height: 36 }}>
                  <td className="px-3 font-medium">{label}</td>
                  {vs.map((v, i) => <td key={i} className={TD} style={{ color: v !== null && prom && Math.abs(v / prom - 1) > 0.25 ? C.alerta : undefined }}>{fmt(v)}</td>)}
                  <td className={TD} style={{ fontWeight: 600 }}>{fmt(prom)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// 3. CONTROLES: las reglas y si se cumplen
// =====================================================================
function VControles({ filas, ejercicio, validacion, periodo }: { filas: Fila[]; ejercicio: number; validacion: EstadoProvisionFlow["validacion"]; periodo: string }) {
  const cobHoy = (x: Fila) => (x.diag && x.diag.riesgo > 0 ? x.diag.provFin / x.diag.riesgo : null);
  const fueraPol = filas.filter((f) => f.dif !== null && f.dif < -LIMITE_POLITICA - 1e-9);
  const bajoMin = filas.filter((f) => f.minimo && f.prov1499 && f.prov1499.some((p, i) => p < f.minimo![i] - 1));
  const caeCob = filas.filter((f) => { const h = cobHoy(f); return h !== null && f.cobPres !== null && f.cobPres < h - 0.1; });
  const sinAjuste = filas.filter((f) => f.puente && f.realMes && Math.abs(f.puente.modelo) > 0.05 * f.realMes);
  const conMeta = filas.filter((f) => f.puente && Math.abs(f.puente.meta) > 0.5);
  const ctr: { t: string; d: string; ok: boolean; det: string }[] = [
    { t: "Parte del gasto real", d: `Con la cartera de hoy y sin mejoras, el modelo de cada agencia da su gasto real de ${periodo} (±5 %).`, ok: !sinAjuste.length, det: sinAjuste.map((f) => `${f.a} ${firmado(f.puente!.modelo)} al mes`).join(" · ") },
    { t: "Mejora razonable", d: `El gasto de provisión del presupuesto no baja más de ${LIMITE_POLITICA * 100} % frente al real de la agencia.`, ok: !fueraPol.length, det: fueraPol.map((f) => `${f.a} ${p2(f.dif, 1)}`).join(" · ") },
    { t: "Mínimo de la norma", d: `La provisión de cada mes de ${ejercicio} cubre el mínimo de la norma según la calificación de la cartera.`, ok: !bajoMin.length, det: bajoMin.map((f) => f.a).join(" · ") },
    { t: "La provisión acompaña a la morosidad", d: "La cobertura (provisión ÷ cartera en riesgo) a diciembre no cae más de 10 puntos frente a hoy.", ok: !caeCob.length, det: caeCob.map((f) => `${f.a}: ${p2(cobHoy(f), 0)} → ${p2(f.cobPres, 0)}`).join(" · ") },
    { t: "Sin metas de provisión", d: "La mejora viene solo de la cartera (pase a riesgo y recuperación); no hay metas de provisión guardadas.", ok: !conMeta.length, det: conMeta.map((f) => `${f.a} ${firmado(f.puente!.meta)} al mes`).join(" · ") },
  ];
  const val = AGENCIAS.map(([a, k]) => ({ a, v: validacion?.[k] })).filter((x) => x.v && x.v.real);
  const dif = (mo: number | null | undefined, r: number) => (mo === null || mo === undefined || !r ? null : mo / r - 1);
  return (
    <div className="flex flex-col gap-5">
      <section className="tarjeta flex flex-col">
        {ctr.map((c) => (
          <div key={c.t} className="flex items-start gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
            <span aria-hidden className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={c.ok ? { background: C.acentoSuave, color: C.ok } : { background: C.avisoSuave, color: C.aviso }}>{c.ok ? "✓" : "!"}</span>
            <div className="flex-1 flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold" style={{ color: C.texto }}>{c.t}</span>
              <span className="text-[12px]" style={{ color: C.texto2 }}>{c.d}</span>
              {!c.ok && c.det && <span className="text-[12px]" style={{ color: C.aviso }}>{c.det}</span>}
            </div>
            <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: c.ok ? C.ok : C.aviso }}>{c.ok ? "Cumple" : "Revisar"}</span>
          </div>
        ))}
      </section>
      {val.length > 0 && (
        <details className="tarjeta">
          <summary className="px-4 py-3 text-[13px] font-semibold cursor-pointer" style={{ color: C.texto }}>Validación del modelo con los meses reales</summary>
          <div className="overflow-x-auto px-1 pb-2">
            <p className="px-3 mt-0 text-[12px]" style={{ color: C.texto2 }}>El modelo, partiendo de la calificación real de cada mes de {periodo}, con el ritmo de atraso de la agencia y con el de la cooperativa, frente al gasto real. Sirve para elegir el ritmo; el presupuesto además se ajusta al real (última columna).</p>
            <table className="w-full text-[12px] border-collapse min-w-[760px]">
              <thead><tr style={{ color: C.texto2, borderBottom: `1px solid ${C.beige}` }}>
                <th className={TH} style={{ textAlign: "left" }}>Agencia</th><th className={TH}>Real al mes</th><th className={TH}>Con su ritmo</th><th className={TH}>Diferencia</th><th className={TH}>Con el de la cooperativa</th><th className={TH}>Diferencia</th><th className={TH}>Ajuste al real</th>
              </tr></thead>
              <tbody>
                {val.map(({ a, v }) => {
                  const n = v!.meses.length || 1, dp = dif(v!.propio, v!.real), dc = dif(v!.cooperativa, v!.real), k = filas.find((f) => f.a === a)?.flow?.ajuste?.factor;
                  return (
                    <tr key={a} style={{ borderTop: `1px solid ${C.beige}`, height: 36 }}>
                      <td className="px-3 font-medium">{a}</td><td className={TD}>{m(v!.real / n)}</td>
                      <td className={TD}>{v!.propio === null ? "—" : m(v!.propio / n)}</td><td className={TD}>{p2(dp, 0)}</td>
                      <td className={TD}>{m(v!.cooperativa / n)}</td><td className={TD}>{p2(dc, 0)}</td>
                      <td className={TD}>{k === null || k === undefined ? "—" : `× ${k.toFixed(2).replace(".", ",")}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
