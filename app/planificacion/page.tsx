"use client";

import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia } from "../../lib/seleccion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { useDatos, apiFetch } from "../../lib/useDatos";
import { C, usd, pct, Tarjeta, Indicador, FranjaIndicadores } from "../../components/ActivosComun";
import { PAGINA, PAGINA_STYLE } from "../../components/EgresosComun";
import { BotonesVista } from "../../components/PorAgencia";
import { EsqueletoTabla } from "../../components/Carga";
import { Formula } from "../../components/ProvisionFlowParametros";
import type { Diagnostico, Indicadores } from "../../lib/calc/diagnostico";
import type { Referencias } from "../../lib/calc/planificacion";
import { aExplicito, type Pal } from "../../lib/calc/plan2027";
import { mundoModelo } from "../../lib/calc/plan-motor";
import { contexto, ESTILO_IMPRESION, type DatosPlanificacion, type RealCargado } from "../../components/planificacion/Comun";
import { Examen } from "../../components/planificacion/Examen";
import { construirMundo, escenariosDe, escenariosModelo, repartoDe, metaDe, usePaquetes, paquetesActualizando, ESTILO_PLAN, ORDEN_OFICINAS, type ConfigModelo } from "../../components/planificacion/Integrado";
import { MetasAgencia } from "../../components/planificacion/MetasAgencia";
import { PlanAgencia } from "../../components/planificacion/PlanAgencia";
import { Comparacion } from "../../components/planificacion/Comparacion";
import { Simulador } from "../../components/planificacion/Simulador";
import { EstudioAgencia } from "../../components/planificacion/EstudioAgencia";
import { AnalisisAgencia } from "../../components/planificacion/AnalisisAgencia";

/**
 * PLANIFICACIÓN: qué necesita cada agencia antes de presupuestar.
 *  - Diagnóstico: indicadores reales de las 10 agencias en un mes (frente al consolidado).
 *  - Comparar agencias: un indicador, las agencias ordenadas y su evolución mes a mes.
 *  - Examen de agencia: informe para presentar (imprimible).
 *  - Metas por agencia: la meta de ROA de la cooperativa repartida según el potencial de cada agencia (o el manual).
 *  - Escenarios del presupuesto: escenarios histórico, presupuestado, propuestos por el modelo y meta asignada (imprimible).
 *  - Simulador: ajuste fino de un escenario con todo encadenado; escenarios guardados en la base (Borrador / Aprobado).
 * Datos: Carga de datos → Históricos (balances y estados de resultados mensuales por agencia).
 */
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const per = (p: string) => { const [a, m] = p.split("-"); return `${MES[Number(m) - 1]}-${a.slice(2)}`; };

type Clave = keyof Indicadores;
interface DefInd { k: Clave; label: string; fmt: (v: number) => string; mejor: 1 | -1 | 0; formula: ReactNode }
const pc1 = (v: number) => pct(v, 1), pc2 = (v: number) => pct(v, 2), pc0 = (v: number) => pct(v, 0);
const signo = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v), 1)}`;
const IND: Record<Clave, DefInd> = {
  cartera: { k: "cartera", label: "Cartera bruta", fmt: usd, mejor: 0, formula: <>Suma de la cartera por vencer, que no devenga y vencida (14, sin provisión).</> },
  morosidad: { k: "morosidad", label: "Morosidad", fmt: pc1, mejor: -1, formula: <>Cartera que no devenga intereses + vencida ÷ cartera bruta.</> },
  captaciones: { k: "captaciones", label: "Captaciones", fmt: usd, mejor: 0, formula: <>Obligaciones con el público (21).</> },
  autofinanciamiento: { k: "autofinanciamiento", label: "Captación ÷ cartera", fmt: (v) => v.toFixed(2).replace(".", ","), mejor: 1, formula: <>Captaciones ÷ cartera bruta. Menos de 1: la agencia necesita fondos de otras oficinas.</> },
  recibe: { k: "recibe", label: "Recibe de otras oficinas", fmt: usd, mejor: 0, formula: <>Saldo de la cuenta 2908 (fondos recibidos de Matriz y agencias).</> },
  envia: { k: "envia", label: "Envía a otras oficinas", fmt: usd, mejor: 0, formula: <>Saldo de la cuenta 1908 (fondos entregados a Matriz y agencias).</> },
  activo: { k: "activo", label: "Activo", fmt: usd, mejor: 0, formula: <>Activo total sin los fondos entregados a otras oficinas (1 − 1908).</> },
  rendimiento: { k: "rendimiento", label: "Rendimiento de cartera", fmt: pc1, mejor: 1, formula: <>Intereses de cartera (5104) del año, anualizados ÷ cartera bruta promedio.</> },
  costoCaptaciones: { k: "costoCaptaciones", label: "Costo de captaciones", fmt: pc1, mejor: -1, formula: <>Intereses de obligaciones con el público (4101), anualizados ÷ captaciones promedio.</> },
  tasaInterna: { k: "tasaInterna", label: "Tasa interna pagada", fmt: pc1, mejor: 0, formula: <>Interés pagado a Matriz y agencias (4.1.05.90.05), anualizado ÷ saldo promedio recibido (2908).</> },
  eficiencia: { k: "eficiencia", label: "Gasto operativo ÷ margen", fmt: pc0, mejor: -1, formula: <>Gastos de operación (45) ÷ margen bruto financiero (51 + 52 + 53 + 54 − 41 − 42 − 43).</> },
  costoRiesgo: { k: "costoRiesgo", label: "Costo de riesgo", fmt: pc1, mejor: -1, formula: <>Provisiones del año (44), anualizadas ÷ cartera bruta promedio.</> },
  roa: { k: "roa", label: "ROA", fmt: pc2, mejor: 1, formula: <>Utilidad del año, anualizada ÷ activo promedio (sin fondos entregados a otras oficinas).</> },
  utilidad: { k: "utilidad", label: "Utilidad del año", fmt: usd, mejor: 1, formula: <>Ingresos (5) − gastos (4) acumulados desde enero.</> },
  utilidadSinInternos: { k: "utilidadSinInternos", label: "Utilidad sin intereses internos", fmt: usd, mejor: 1, formula: <>Utilidad + interés interno pagado − interés interno cobrado. Permite comparar con 2024, cuando no se cobraba.</> },
  interesInternoPagado: { k: "interesInternoPagado", label: "Interés interno pagado", fmt: usd, mejor: 0, formula: <>4.1.05.90.05 acumulado del año.</> },
  interesInternoCobrado: { k: "interesInternoCobrado", label: "Interés interno cobrado", fmt: usd, mejor: 0, formula: <>5.1.90.90.05 acumulado del año.</> },
  crecimientoCartera: { k: "crecimientoCartera", label: "Crecimiento de cartera", fmt: signo, mejor: 1, formula: <>Cartera bruta del mes ÷ cartera de diciembre anterior − 1.</> },
  crecimientoCaptaciones: { k: "crecimientoCaptaciones", label: "Crecimiento de captaciones", fmt: signo, mejor: 1, formula: <>Captaciones del mes ÷ captaciones de diciembre anterior − 1.</> },
};
type Grupo = "fondeo" | "calidad" | "rentabilidad" | "resultado";
const GRUPOS: Record<Grupo, { label: string; cols: Clave[] }> = {
  fondeo: { label: "Tamaño y fondeo", cols: ["cartera", "captaciones", "autofinanciamiento", "recibe", "envia", "crecimientoCartera", "crecimientoCaptaciones"] },
  calidad: { label: "Calidad de cartera", cols: ["morosidad", "costoRiesgo", "rendimiento"] },
  rentabilidad: { label: "Rentabilidad", cols: ["rendimiento", "costoCaptaciones", "tasaInterna", "eficiencia", "roa"] },
  resultado: { label: "Resultado", cols: ["utilidad", "interesInternoPagado", "interesInternoCobrado", "utilidadSinInternos", "roa"] },
};
const CONS = "Consolidado";

function color(def: DefInd, v: number | null, ref: number | null) {
  if (def.mejor === 0 || v === null || ref === null) return undefined;
  const d = (v - ref) * def.mejor;
  return Math.abs(d) < 1e-9 ? undefined : d > 0 ? C.ok : C.alerta;
}
const val = (r: Indicadores | undefined, k: Clave) => (r ? (r[k] as number | null) : null);

// =====================================================================
// DIAGNÓSTICO
// =====================================================================
function VistaDiagnostico({ d, periodo }: { d: Diagnostico; periodo: string }) {
  const [grupo, setGrupo] = useState<Grupo>("fondeo");
  const cons = d.series[CONS]?.[periodo];
  const cols = GRUPOS[grupo].cols.map((k) => IND[k]);
  const filas = d.oficinas.filter((o) => o !== CONS);
  const TD = "px-3 text-right whitespace-nowrap tabla-cifras";
  return (
    <div className="flex flex-col gap-5">
      {cons && (
        <FranjaIndicadores>
          <Indicador titulo={`Utilidad ${periodo.slice(0, 4)}`} valor={usd(cons.utilidad)} pie={`Acumulada a ${per(periodo)}`} color={cons.utilidad < 0 ? C.alerta : undefined} />
          <Indicador titulo="ROA" valor={pc2(cons.roa)} pie="Anualizado" />
          <Indicador titulo="Morosidad" valor={pc1(cons.morosidad)} pie={`Cartera ${usd(cons.cartera)}`} />
          <Indicador titulo="Captación ÷ cartera" valor={cons.autofinanciamiento.toFixed(2).replace(".", ",")} pie={`Captaciones ${usd(cons.captaciones)}`} />
        </FranjaIndicadores>
      )}
      <Tarjeta titulo={`Agencias · ${per(periodo)}`}
        derecha={<BotonesVista etiqueta="Grupo de indicadores" valor={grupo} onChange={setGrupo} opciones={(Object.keys(GRUPOS) as Grupo[]).map((g) => ({ id: g, label: GRUPOS[g].label }))} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[760px]">
            <thead>
              <tr style={{ borderBottom: "2px solid #DDE2DF", color: C.texto2, height: 40 }}>
                <th className="pl-4 pr-2 text-left font-semibold">Agencia</th>
                {cols.map((c) => <th key={c.k} className={`${TD} font-semibold`}><span className="inline-flex items-center gap-1">{c.label}<Formula derecha>{c.formula}</Formula></span></th>)}
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => {
                const r = d.series[o]?.[periodo];
                return (
                  <tr key={o} style={{ borderTop: `1px solid ${C.beige}`, height: 38 }}>
                    <td className="pl-4 pr-2 whitespace-nowrap" style={{ color: C.texto3 }}>{o}</td>
                    {cols.map((c) => {
                      const v = val(r, c.k);
                      const col = c.k.startsWith("utilidad") ? (v !== null && v < 0 ? C.alerta : undefined) : color(c, v, val(cons, c.k));
                      return <td key={c.k} className={TD} style={{ color: col, fontWeight: col ? 600 : undefined }}>{v === null ? "—" : c.fmt(v)}</td>;
                    })}
                  </tr>
                );
              })}
              {cons && (
                <tr style={{ borderTop: "1px solid #B9C3BD", height: 40, fontWeight: 700, background: "#F7FAF8" }}>
                  <td className="pl-4 pr-2">Consolidado</td>
                  {cols.map((c) => { const v = val(cons, c.k); return <td key={c.k} className={TD}>{v === null ? "—" : c.fmt(v)}</td>; })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}

// =====================================================================
// COMPARAR AGENCIAS
// =====================================================================
const COMPARABLES: Clave[] = ["morosidad", "autofinanciamiento", "rendimiento", "costoCaptaciones", "tasaInterna", "eficiencia", "costoRiesgo", "roa", "utilidadSinInternos", "crecimientoCartera", "crecimientoCaptaciones", "cartera", "captaciones", "recibe"];

/** Línea pequeña de la evolución mensual (un solo trazo, punto final marcado). */
function Tendencia({ valores, fmt, periodos }: { valores: (number | null)[]; fmt: (v: number) => string; periodos: string[] }) {
  const W = 180, H = 30, pts = valores.map((v, i) => (v === null ? null : { i, v }));
  const ok = pts.filter((p): p is { i: number; v: number } => !!p);
  if (ok.length < 2) return <span style={{ color: C.tenue }}>—</span>;
  const min = Math.min(...ok.map((p) => p.v)), max = Math.max(...ok.map((p) => p.v)), rango = max - min || 1;
  const x = (i: number) => 2 + (i / (valores.length - 1)) * (W - 4), y = (v: number) => H - 3 - ((v - min) / rango) * (H - 6);
  const ult = ok[ok.length - 1];
  return (
    <svg width={W} height={H} role="img" aria-label="Evolución mensual">
      <title>{`${per(periodos[ok[0].i])}: ${fmt(ok[0].v)} → ${per(periodos[ult.i])}: ${fmt(ult.v)}`}</title>
      <polyline fill="none" stroke={C.acento} strokeWidth={1.6} strokeLinejoin="round" points={ok.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} />
      <circle cx={x(ult.i)} cy={y(ult.v)} r={2.6} fill={C.acento} />
    </svg>
  );
}

function VistaComparar({ d, periodo }: { d: Diagnostico; periodo: string }) {
  const [k, setK] = useState<Clave>("morosidad");
  const def = IND[k];
  const cons = val(d.series[CONS]?.[periodo], k);
  const filas = d.oficinas.filter((o) => o !== CONS).map((o) => ({ o, v: val(d.series[o]?.[periodo], k) }))
    .sort((a, b) => ((b.v ?? -Infinity) - (a.v ?? -Infinity)) * (def.mejor === -1 ? -1 : 1));
  const max = Math.max(...filas.map((f) => Math.abs(f.v ?? 0)), Math.abs(cons ?? 0), 1e-9);
  const periodosHasta = d.periodos.filter((p) => p <= periodo);
  const ventana = periodosHasta.slice(-20);
  const dic = (y: number) => `${y}-12`;
  const anio = Number(periodo.slice(0, 4));
  const TD = "px-3 text-right whitespace-nowrap tabla-cifras";
  return (
    <div className="flex flex-col gap-5">
      <Tarjeta titulo={<span className="inline-flex items-center gap-1.5">{def.label} · {per(periodo)}<Formula>{def.formula}</Formula></span>}
        derecha={
          <select value={k} onChange={(e) => setK(e.target.value as Clave)} aria-label="Indicador" className="h-8 rounded-md px-2 text-[12px] bg-white" style={{ border: "1px solid #C9D0CC" }}>
            {COMPARABLES.map((c) => <option key={c} value={c}>{IND[c].label}</option>)}
          </select>
        }>
        <div className="px-4 py-4 flex flex-col gap-2">
          {filas.map((f, i) => {
            const col = color(def, f.v, cons) ?? C.acento;
            return (
              <div key={f.o} className="grid grid-cols-[22px_130px_1fr_110px] items-center gap-3 text-[12px]" title={`${f.o}: ${f.v === null ? "—" : def.fmt(f.v)}`}>
                <span className="text-right" style={{ color: C.tenue }}>{i + 1}</span>
                <span style={{ color: C.texto3 }}>{f.o}</span>
                <div className="relative h-3 rounded-sm" style={{ background: "#F1F3F2" }}>
                  <div className="h-full rounded-r" style={{ width: `${(Math.abs(f.v ?? 0) / max) * 100}%`, background: def.mejor === 0 ? C.acento : col, opacity: 0.85 }} />
                  {cons !== null && <div className="absolute top-[-3px] bottom-[-3px] w-[2px]" style={{ left: `${(Math.abs(cons) / max) * 100}%`, background: C.texto }} />}
                </div>
                <span className="text-right font-semibold tabla-cifras">{f.v === null ? "—" : def.fmt(f.v)}</span>
              </div>
            );
          })}
          {cons !== null && (
            <div className="grid grid-cols-[22px_130px_1fr_110px] items-center gap-3 text-[12px] pt-2 mt-1" style={{ borderTop: `1px solid ${C.beige}` }}>
              <span /><b>Consolidado</b>
              <div className="relative h-3"><div className="absolute top-[-3px] bottom-[-3px] w-[2px]" style={{ left: `${(Math.abs(cons) / max) * 100}%`, background: C.texto }} /></div>
              <b className="text-right tabla-cifras">{def.fmt(cons)}</b>
            </div>
          )}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Evolución mensual">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[760px]">
            <thead>
              <tr style={{ borderBottom: "2px solid #DDE2DF", color: C.texto2, height: 38 }}>
                <th className="pl-4 pr-2 text-left font-semibold">Agencia</th>
                <th className="px-3 text-left font-semibold">{per(ventana[0])} → {per(periodo)}</th>
                {[anio - 2, anio - 1].map((y) => <th key={y} className={`${TD} font-semibold`}>{per(dic(y))}</th>)}
                <th className={`${TD} font-semibold`}>{per(periodo)}</th>
              </tr>
            </thead>
            <tbody>
              {[...d.oficinas.filter((o) => o !== CONS), CONS].map((o) => {
                const s = d.series[o] ?? {};
                const esC = o === CONS;
                return (
                  <tr key={o} style={{ borderTop: esC ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: 40, fontWeight: esC ? 700 : 400, background: esC ? "#F7FAF8" : undefined }}>
                    <td className="pl-4 pr-2 whitespace-nowrap" style={{ color: esC ? C.texto : C.texto3 }}>{o}</td>
                    <td className="px-3"><Tendencia valores={ventana.map((p) => val(s[p], k))} fmt={def.fmt} periodos={ventana} /></td>
                    {[anio - 2, anio - 1].map((y) => { const v = val(s[dic(y)], k); return <td key={y} className={TD}>{v === null ? "—" : def.fmt(v)}</td>; })}
                    <td className={TD}>{val(s[periodo], k) === null ? "—" : def.fmt(val(s[periodo], k)!)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}

// =====================================================================
// PÁGINA
// =====================================================================
type Pestana = "diagnostico" | "comparar" | "examen" | "estudio" | "analisis" | "metas" | "plan" | "modelo" | "compara" | "sim";
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: "diagnostico", label: "Diagnóstico" }, { id: "comparar", label: "Comparar agencias" }, { id: "examen", label: "Examen de agencia" }, { id: "estudio", label: "Estudio de agencia" }, { id: "analisis", label: "Análisis de agencia" },
  { id: "metas", label: "Meta de ROA" }, { id: "plan", label: "Escenarios del presupuesto" }, { id: "modelo", label: "Propuesta del modelo" }, { id: "compara", label: "Comparar escenarios" }, { id: "sim", label: "Simulador" },
];
/**
 * Pestañas que se muestran. Por ahora Estudio de agencia y Análisis de agencia (real frente al presupuesto): Diagnóstico, Comparar y Examen (situación real) pasan a la
 * sección de análisis por agencia, y los escenarios quedan ocultos. El código y los escenarios guardados en la base se
 * conservan: para volver a mostrar una pestaña basta agregarla aquí.
 */
const VISIBLES: Pestana[] = ["estudio", "analisis"];

async function postPlan(body: unknown) {
  const r = await apiFetch("/api/planificacion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
}

export default function PlanificacionPage() {
  const [pestana, setPestana] = useState<Pestana>(VISIBLES[0]);
  const usaPlan = pestana === "examen" || pestana === "estudio" || pestana === "metas" || pestana === "plan" || pestana === "modelo" || pestana === "compara" || pestana === "sim";
  const { datos: d, cargando, error } = useDatos<Diagnostico>("/api/historico", 0);
  const [verPlan, setVerPlan] = useState(0);
  const pl = useDatos<DatosPlanificacion>(usaPlan ? "/api/planificacion" : null, verPlan);
  const [elegido, setElegido] = useState<string | null>(null);
  const periodos = useMemo(() => (d ? [...d.periodos].reverse() : []), [d]);
  const periodo = elegido ?? periodos[0] ?? null;

  const agencias = useMemo(() => (pl.datos?.bases ? ORDEN_OFICINAS.filter((o) => pl.datos!.bases[o]).concat(Object.keys(pl.datos.bases).filter((o) => !ORDEN_OFICINAS.includes(o))) : []), [pl.datos]);
  // Estudio de agencia trabaja por agencia (no consolidado): al abrir, Matriz
  const [agencia, setAgencia] = useAgencia(VISIBLES.includes("diagnostico")); // compartida entre pantallas
  const opcionesAgencia = pestana === "analisis" ? ORDEN_OFICINAS : pestana === "estudio" ? agencias.filter((a) => a !== "Consolidado") : agencias;
  const ag = opcionesAgencia.includes(agencia) ? agencia : opcionesAgencia[0] ?? agencia;
  const ctx = useMemo(() => (pl.datos?.bases ? contexto(pl.datos, ag) : null), [pl.datos, ag]);

  // ---- modelo integrado: base común = presupuesto 2027 de cada agencia (Estado de resultados y Balance general)
  const enModelo = pestana === "estudio" || pestana === "metas" || pestana === "plan" || pestana === "modelo" || pestana === "compara" || pestana === "sim";
  const listaPres = useMemo(() => agencias.filter((a) => a !== "Consolidado"), [agencias]);
  const paquetes = usePaquetes(listaPres, enModelo && listaPres.length > 0, ag);
  const cargandoPres = listaPres.filter((a) => paquetes[a] === undefined).length;
  const M = useMemo(() => (pl.datos?.bases && !cargandoPres ? construirMundo(pl.datos, paquetes) : null), [pl.datos, paquetes, cargandoPres]);
  const [cfgLocal, setCfgLocal] = useState<Partial<ConfigModelo>>({});
  const cfg: ConfigModelo = useMemo(() => ({
    metaInst: pl.datos?.config.metaInst ?? 0.01, cumplMeta: pl.datos?.config.cumplMeta === undefined ? 1 : pl.datos.config.cumplMeta,
    ajustes: (pl.datos?.config.ajustes ?? {}) as ConfigModelo["ajustes"], ...cfgLocal,
  }), [pl.datos, cfgLocal]);
  const setCfg = async (c: Partial<ConfigModelo>) => { setCfgLocal((x) => ({ ...x, ...c })); await postPlan({ accion: "config", config: c }); };
  const hayAg = !!M && !!M.ags[ag];
  const reparto = useMemo(() => (M ? repartoDe(M, cfg) : null), [M, cfg]);
  const [metaVer, setMetaVer] = useState(false);
  const conEsc = pestana === "plan" || pestana === "modelo" || pestana === "compara" || pestana === "sim" || (pestana === "metas" && metaVer);
  const E = useMemo(() => (M && hayAg && reparto && conEsc ? escenariosDe(M, ag, cfg, pl.datos?.escenarios ?? [], reparto) : []), [M, hayAg, reparto, ag, cfg, pl.datos, conEsc]);
  // propuesta del modelo: independiente del presupuesto (ritmo real de gastos y tasas), con el presupuestado como referencia
  const conMod = pestana === "modelo" || pestana === "compara";
  const M2 = useMemo(() => (M && conMod ? mundoModelo(M, paquetes) : null), [M, paquetes, conMod]);
  const Emod = useMemo(() => (M2 && hayAg && conMod ? escenariosModelo(M2, ag, cfg, E.find((e) => e.k === "pres")) : []), [M2, hayAg, ag, cfg, E, conMod]);
  const [escMod, setEscMod] = useState("mmedio");
  const [escSel, setEscSel] = useState("medio");
  const [simBase, setSimBase] = useState("meta");
  const baseEsc = E.find((e) => e.k === simBase) ?? E.find((e) => e.k === "meta");
  const S0 = useMemo(() => (M && hayAg && baseEsc ? aExplicito(M, M.ags[ag], baseEsc.L) : null), [M, hayAg, ag, baseEsc]);
  const claveSim = `${ag}|${simBase}`;
  const [sim, setSim] = useState<{ clave: string; L: Pal } | null>(null);
  const L = sim && sim.clave === claveSim ? sim.L : S0;
  const setL = (X: Pal) => setSim({ clave: claveSim, L: X });
  const cambiarAgencia = (a: string) => { setAgencia(a); setEscSel("medio"); setSimBase("meta"); };

  const guardarRef = async (r: Referencias) => { await postPlan({ accion: "config", config: { referencias: r } }); setVerPlan((v) => v + 1); };
  const guardarEsc = async (nombre: string, estado: "Borrador" | "Aprobado", X: Pal) => {
    await postPlan({ accion: "escenario", escenario: { agencia: ag, nombre, palancas: X, estado, meta: M ? metaDe(M, cfg, ag) : null } });
    setVerPlan((v) => v + 1);
  };
  const aprobarEsc = async (id: number) => { await postPlan({ accion: "aprobarEscenario", id }); setVerPlan((v) => v + 1); };
  const borrarEsc = async (id: number) => { await postPlan({ accion: "borrarEscenario", id }); setEscSel("medio"); setVerPlan((v) => v + 1); };

  // Control: el Presupuestado de Planificación debe ser exactamente el resultado del Estado de resultados de la agencia
  // (se guarda junto con la agencia: así nunca se compara una agencia con el resultado de otra)
  const [erAg, setErAg] = useState<{ ag: string; res: number } | null>(null);
  const pedirER = !!M && hayAg && conEsc;
  useEffect(() => {
    if (!pedirER) return;
    let vivo = true;
    apiFetch(`/api/estado-resultados?agencia=${encodeURIComponent(ag)}`).then((r) => r.json())
      .then((j) => { const v = j?.resultadoDelEjercicio?.valores?.[11]; if (vivo && typeof v === "number") setErAg({ ag, res: v }); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [ag, pedirER]);
  const presPlan = E.find((e) => e.k === "pres")?.R.kpi.util;
  const resER = erAg && erAg.ag === ag ? erAg.res : undefined;
  const descuadrePres = presPlan !== undefined && resER !== undefined && Math.abs(presPlan - resER) >= 1 ? { presPlan, resER } : null;

  // Real de la agencia: último mes cargado en Históricos (estado de resultados acumulado y saldos de ese balance)
  const realAg: RealCargado | null = useMemo(() => {
    const serie = d?.series[ag]; if (!serie) return null;
    const p = Object.keys(serie).sort().pop(); if (!p) return null;
    const x = serie[p];
    return { periodo: p, utilidad: x.utilidad, roa: x.roa, morosidad: x.morosidad, cartera: x.cartera, captaciones: x.captaciones };
  }, [d, ag]);

  let cuerpo: ReactNode;
  if (pestana === "analisis") {
    cuerpo = <AnalisisAgencia ag={ag} />;
  } else if (usaPlan) {
    cuerpo = pl.error ? <p className="text-[13px]" style={{ color: C.alerta }}>{pl.error}</p>
      : pl.cargando && !pl.datos ? <EsqueletoTabla filas={10} />
      : !ctx ? <p className="text-[13px]" style={{ color: C.texto2 }}>Todavía no hay históricos. Se cargan en Carga de datos → Balances y Estados de resultados.</p>
      : pestana === "examen" ? <Examen key={ag} ctx={ctx} agencia={ag} trayectoria={pl.datos?.trayectoria[ag] ?? []} onVerPlan={() => setPestana("plan")} onGuardarRef={guardarRef} />
      : !M || !hayAg ? <p className="text-[13px]" style={{ color: C.texto2 }}>{cargandoPres ? `Leyendo el presupuesto de las agencias… faltan ${cargandoPres}` : "Calculando el punto de partida de las agencias…"}</p>
      : pestana === "estudio" ? <>
          {paquetesActualizando.n > 0 && <p className="text-[12px] -mb-2" style={{ color: C.texto2 }}>Actualizando el presupuesto de {paquetesActualizando.n} {paquetesActualizando.n === 1 ? "agencia" : "agencias"} con el cambio guardado…</p>}
          <EstudioAgencia key={ag} M={M} ag={ag} />
        </>
      : pestana === "metas" ? (metaVer && E.length ? (
            <PlanAgencia real={realAg} izquierda={<button type="button" onClick={() => setMetaVer(false)} className="text-[13px] font-semibold hover:underline" style={{ color: C.acento }}>← Reparto de todas las agencias</button>} key={"meta" + ag} modo="meta" M={M} ag={ag} cfg={cfg} setCfg={setCfg} E={E.filter((e) => ["hist", "pres", "meta"].includes(e.k))} escSel="meta" setEscSel={() => undefined} seleccionables={["meta"]} />
        ) : <MetasAgencia M={M} cfg={cfg} setCfg={setCfg} onVer={(a) => { cambiarAgencia(a); setMetaVer(true); }} />)
      : pestana === "compara" ? (Emod.length ? <Comparacion key={ag} ag={ag} E={E} Emod={Emod} real={realAg} /> : null)
      : pestana === "modelo" ? (M2 && Emod.length ? <PlanAgencia real={realAg} key="mod" modo="mod" M={M2} Mpres={M} seleccionables={["mcons", "mmedio", "mopt"]} ag={ag} metaU={metaDe(M, cfg, ag, reparto ?? undefined)} metaRoa={(() => { const a = reparto?.filas.find((r) => r.a === ag)?.H.activoProm; return a ? metaDe(M, cfg, ag, reparto ?? undefined) / a : undefined; })()} cfg={cfg} setCfg={setCfg} E={Emod} escSel={escMod} setEscSel={setEscMod} baseModelo={M2.baseModelo} nombres={M.ags[ag]?.pres?.nombres ?? Object.assign({}, ...Object.values(M.ags).map((x) => x.pres?.nombres ?? {}))} /> : null)
      : pestana === "plan" ? <PlanAgencia real={realAg} key="pres" modo="pres" M={M} ag={ag} cfg={cfg} setCfg={setCfg} E={E.filter((e) => e.k !== "meta")} escSel={escSel} setEscSel={setEscSel} seleccionables={["cons", "medio", "opt"]} onAprobar={aprobarEsc} onBorrar={borrarEsc} />
      : ag === "Consolidado" ? <p className="text-[13px]" style={{ color: C.texto2 }}>El simulador trabaja por agencia: elija una agencia. El Consolidado suma los escenarios de las agencias en Escenarios del presupuesto.</p>
      : S0 && L ? <Simulador M={M} ag={ag} E={E} simBase={simBase} setSimBase={setSimBase} S0={S0} L={L} setL={setL} metaU={metaDe(M, cfg, ag, reparto ?? undefined)} onGuardar={guardarEsc} />
      : null;
  } else {
    cuerpo = error ? <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      : cargando && !d ? <EsqueletoTabla filas={10} />
      : !d || !periodo ? <p className="text-[13px]" style={{ color: C.texto2 }}>Todavía no hay históricos. Se cargan en Carga de datos → Balances y Estados de resultados.</p>
      : pestana === "diagnostico" ? <VistaDiagnostico d={d} periodo={periodo} />
      : <VistaComparar d={d} periodo={periodo} />;
  }
  const porAgencia = pestana === "analisis" || pestana === "examen" || pestana === "estudio" || pestana === "plan" || pestana === "modelo" || pestana === "compara" || pestana === "sim" || (pestana === "metas" && metaVer);
  const imprimible = pestana === "examen" || pestana === "metas" || pestana === "plan" || pestana === "modelo" || pestana === "compara";
  const imprimir = () => { document.querySelectorAll<HTMLDetailsElement>(".planif details").forEach((x) => (x.open = true)); setTimeout(() => window.print(), 50); };

  const selector = "h-9 rounded-md px-2 text-[13px] bg-white";
  return (
    <div className={`${PAGINA} planif`} style={PAGINA_STYLE}>
      <style>{ESTILO_IMPRESION + ESTILO_PLAN}</style>
      <div className="no-print flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 text-[22px] font-semibold leading-tight">Planificación<AnioEjercicio /></h1>
        {porAgencia ? (
          <div className="flex items-center gap-2">
            {opcionesAgencia.length > 0 && (
              <label className="flex items-center gap-2 text-[13px]" style={{ color: C.texto2 }}>
                Agencia
                <select value={ag} onChange={(e) => cambiarAgencia(e.target.value)} className={selector} style={{ border: "1px solid #C9D0CC", color: C.texto }}>
                  {opcionesAgencia.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            )}
          </div>
        ) : pestana !== "metas" && periodo && (
          <label className="flex items-center gap-2 text-[13px]" style={{ color: C.texto2 }}>
            Mes
            <select value={periodo} onChange={(e) => setElegido(e.target.value)} className={selector} style={{ border: "1px solid #C9D0CC", color: C.texto }}>
              {periodos.map((p) => <option key={p} value={p}>{per(p)}</option>)}
            </select>
          </label>
        )}
        {imprimible && <button type="button" onClick={imprimir} className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]" style={{ color: C.acento }}><Printer size={16} />Imprimir</button>}
      </div>
      {VISIBLES.length > 1 && <div className="no-print flex flex-wrap items-end gap-4 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" className="flex flex-wrap gap-x-6 flex-1">
          {PESTANAS.filter((t) => VISIBLES.includes(t.id)).map((t) => {
            const on = t.id === pestana;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => { setPestana(t.id); if (t.id === "metas") setMetaVer(false); if (t.id === "estudio" && ag === "Consolidado") cambiarAgencia("Catamayo"); }} className="pt-2 pb-2.5 -mb-px text-[13px] whitespace-nowrap"
                      style={{ color: on ? C.acento : C.texto2, fontWeight: on ? 600 : 400, borderBottom: `2px solid ${on ? C.acento : "transparent"}` }}>{t.label}</button>
            );
          })}
        </div>
      </div>}
      {descuadrePres && (
        <div className="tarjeta px-4 py-3 text-[12px] flex flex-wrap items-center gap-3" style={{ color: C.alerta }}>
          <span className="flex-1">El Presupuestado de Planificación ({usd(descuadrePres.presPlan)}) no coincide con el Estado de resultados de {ag} ({usd(descuadrePres.resER)}). Recalcula para leer el presupuesto vigente.</span>
          <button type="button" className="h-8 px-3 rounded-md text-[12px] font-semibold text-white" style={{ background: C.acento }} onClick={() => window.location.reload()}>Recalcular</button>
        </div>
      )}
      {cuerpo}
    </div>
  );
}
