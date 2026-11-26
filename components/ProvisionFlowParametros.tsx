"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Info, RefreshCw, Sigma } from "lucide-react";
import { apiFetch } from "../lib/useDatos";
import { C, BORDE_EDICION, Tarjeta, BotonesSeccion, Indicador, FranjaIndicadores, usd, pct, leerNumero } from "./ActivosComun";
import { BotonesVista } from "./PorAgencia";
import { EsqueletoTabla } from "./Carga";
import { useDatos } from "../lib/useDatos";
import { urlFlow, type DatosFlow } from "./ProvisionFlowVistas";
import {
  PRODUCTOS, TRAMOS, ETIQUETA_TRAMO, ESCENARIOS, NOMBRE_ESCENARIO, TRAMOS_ENTRADA, CUENTA_4402,
  proyectarProvisionFlow, castigoPorProducto, rangoNormaTramo, categoriasDe, RANGO_NORMA,
  type ConfigFlow, type Escenario, type ParametrosFlow, type Producto, type SaldosTramo, type RitmoAgencia,
} from "../lib/calc/provision-flow";
import { ejercicioEnUso } from "../lib/seleccion";
import { nombreVentana } from "../lib/calc/base-calibracion";
import { ActualizarBase } from "./ActualizarBase";
import { ProvisionEstudio, type VistaEstudio } from "./ProvisionEstudio";

/**
 * CARTERA → PROVISIÓN: supuestos del modelo por flow rates (institucionales, iguales para las 10 agencias).
 * Tarjetas arriba; una tarjeta con tres vistas (Escenarios | Migración y provisión | Validación) y la metodología.
 * Los archivos (Calificación de Cartera y estado de resultados) se cargan en Carga de datos.
 */
export interface EstadoProvisionFlow {
  parametros: ParametrosFlow; config: ConfigFlow;
  periodos: { periodo: string; corte: string; filas: number }[];
  oficinasPorCorte?: Record<string, string[]>;
  eerr: { periodo: string; g4402: number; r560410: number; r560405: number }[];
  corte: string | null; inicial: SaldosTramo | null; provisionCorte: SaldosTramo | null;
  historia?: { saldo: Record<string, SaldosTramo>; prov: Record<string, SaldosTramo> };
  carteraPorCorte: Record<string, number>;
  categoriasCorte?: Record<string, Record<string, Record<string, number>>>;
  detalleCategorias?: Record<string, Record<string, { saldo: number; prov: number; desde: number; hasta: number }>>;
  calibracion: { parametros: ParametrosFlow; frEBruto: number | null; ventanaE: string[]; castigoMensualSugerido: number | null; tasaCastigo: number | null; periodosTasas: string[] };
  backtest: { meses: { periodo: string; modelo: number; real: number }[]; modelo: number; real: number } | null;
  /** Ritmo de atraso propio de cada agencia (clave del reporte: MATRIZ, PINAS…); null = usa el de la cooperativa. */
  ritmos?: Record<string, RitmoAgencia | null>;
  /** Gasto neto real (4402 − 5604.10) del año del último corte por agencia, llevado a 12 meses. */
  /** Validación por agencia (mismos meses de la prueba): gasto neto real y del modelo con el ritmo propio y con el de la cooperativa. */
  validacion?: Record<string, { real: number; propio: number | null; cooperativa: number; meses: { periodo: string; real: number; propio: number | null; cooperativa: number }[] }>;
  realAnio?: { anio: string | null; desde?: string | null; hasta?: string | null; ratioCooperativa?: number | null; porOficina: Record<string, { valor: number; mes: number; meses?: number; g4402?: number; i5104?: number; ratio?: number | null }> };
}
/** Oficinas en el orden de la herramienta, con su clave del reporte de calificación. */
const OFICINAS_RITMO: [string, string][] = [["MATRIZ", "Matriz"], ["EL GUABO", "El Guabo"], ["PINAS", "Piñas"], ["MACHALA II", "Machala II"], ["PONCE ENRIQUEZ", "Ponce Enríquez"],
  ["BALSAS", "Balsas"], ["SANTA ROSA", "Santa Rosa"], ["LAS LAJAS", "Las Lajas"], ["NARANJAL", "Naranjal"], ["CATAMAYO", "Catamayo"]];
const NOMBRE_PRODUCTO: Record<Producto, string> = { CONSUMO: "Consumo", MICROCREDITO: "Microcrédito", INMOBILIARIO: "Inmobiliario", PRODUCTIVO: "Productivo" };
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const per = (p: string) => { const [a, m] = p.split("-"); return `${MES[Number(m) - 1]}-${a.slice(2)}`; };
const sig = (p: string) => { const [a, m] = p.split("-").map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; };
const pctTxt = (v: number, d = 2) => `${(v * 100).toFixed(d).replace(".", ",")} %`;
/** Días de atraso de una calificación según el reporte: 0 → "Al día", último tramo → "Más de N". */
function diasCategoria(cat: string, det?: { desde: number; hasta: number }): string | null {
  if (!det) return null;
  if (det.hasta <= 0) return "Al día";
  if (cat === "E" || det.hasta >= 9999) return `Más de ${det.desde - 1}`;
  return `${det.desde}–${det.hasta}`;
}
/** "1–30 días (A2+A3)" → { dias: "1–30", calificacion: "A2 · A3" }; "Vigente (A1)" → "Al día". */
function partesTramo(producto: Producto, k: string) {
  const m = ETIQUETA_TRAMO[producto][k].match(/^(.*?)\s*\((.*)\)$/);
  const d = (m?.[1] ?? ETIQUETA_TRAMO[producto][k]).replace(/\s*días$/, "");
  return { dias: d === "Vigente" ? "Al día" : d.startsWith(">") ? `Más de ${d.slice(1)}` : d, calificacion: (m?.[2] ?? "").replace(/\+/g, " · ") };
}
const campo = "h-8 rounded-md px-2 text-right text-[12px] bg-white";
type Vista = "escenarios" | "flujos" | "calibracion" | "metodologia";

export function ProvisionFlowParametros({ agencia, ejercicio = ejercicioEnUso(), onGuardado }: { agencia: string; ejercicio?: number; onGuardado: () => void }) {
  const [d, setD] = useState<EstadoProvisionFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [vista, setVista] = useState<Vista>("escenarios");
  // tres secciones: Resumen (el puente), Agencias (cómo está cada una y qué debe lograr) y Detalle técnico
  const [seccion, setSeccion] = useState<"resumen" | "agencias" | "tecnico">("resumen");
  const [tec, setTec] = useState<"controles" | "modelo" | "base">("controles");
  const vistaEstudio: VistaEstudio | null = seccion === "resumen" ? "resumen" : seccion === "agencias" ? "agencias" : tec === "controles" ? "controles" : null;
  const calculo = seccion === "tecnico" && tec === "modelo" ? "supuestos" : null;
  const [slot, setSlot] = useState<HTMLElement | null>(null); // acciones de la vista (Editar) en el encabezado de la tarjeta
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/provision-flow-parametros").then((r) => r.json()).then((j) => { if (!vivo) return; if (j.error) setError(j.error); else setD(j); })
      .catch(() => vivo && setError("Error de conexión."));
    return () => { vivo = false; };
  }, [version]);

  async function post(body: object, ok: string) {
    setMsg(null);
    const r = await apiFetch("/api/provision-flow-parametros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || j.error) { setMsg({ t: j.error ?? `Error ${r.status}`, e: true }); return false; }
    setMsg({ t: ok }); setVersion((v) => v + 1); onGuardado(); return true;
  }

  if (error) return <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>;
  if (!d) return <EsqueletoTabla filas={8} />;
  const guardarConfig = (c: ConfigFlow) => post({ accion: "config", config: c }, "Guardado.");
  // meses con calificación y estado de resultados después de la base (en diciembre: nov y dic)
  const conER = new Set(d.eerr.map((e) => e.periodo));
  const mesesNuevos = d.periodos.map((p) => p.periodo).filter((p) => p > d.config.ventanaHasta && conER.has(p)).sort();
  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <BotonesVista etiqueta="Sección de la provisión" valor={seccion} onChange={setSeccion}
          opciones={[{ id: "resumen", label: "Resumen" }, { id: "agencias", label: "Agencias" }, { id: "tecnico", label: "Detalle técnico" }]} />
        {d.realAnio?.desde && d.realAnio?.hasta && (
          <span className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full text-[12px] font-semibold" style={{ background: C.acentoSuave, color: C.acento }}>
            {nombreVentana(d.realAnio.desde, d.realAnio.hasta)}
            <Formula info derecha>No se consideran los meses anteriores porque tenían alivio.</Formula>
          </span>
        )}
        {seccion === "tecnico" && <span className="ml-auto"><BotonesVista etiqueta="Detalle técnico" valor={tec} onChange={setTec}
          opciones={[{ id: "controles", label: "Controles" }, { id: "modelo", label: "Modelo y castigos" }, { id: "base", label: "Actualizar la base" }]} /></span>}
      </div>
      {mesesNuevos.length > 0 && !(seccion === "tecnico" && tec === "base") && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg px-4 py-2.5 text-[13px]" style={{ background: C.avisoSuave, color: C.texto2 }}>
          <span>Hay meses cargados fuera de la base ({mesesNuevos.map((p) => per(p)).join(" · ")}). El presupuesto sigue con {nombreVentana(d.config.ventanaDesde, d.config.ventanaHasta)} hasta que se elija.</span>
          <button type="button" onClick={() => { setSeccion("tecnico"); setTec("base"); }} className="h-7 px-3 rounded-md text-[12px] font-semibold text-white" style={{ background: C.acento }}>Comparar bases</button>
        </div>
      )}
      {seccion === "tecnico" && tec === "base" && <ActualizarBase estado={d} ejercicio={ejercicio} onGuardar={guardarConfig} />}
      {vistaEstudio && <ProvisionEstudio key={agencia} vista={vistaEstudio} agencia={agencia} ejercicio={ejercicio} estado={d} version={version} />}
      {calculo === "supuestos" && msg && <p className="text-[12px] -my-2" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</p>}
      {calculo === "supuestos" && (
      <Tarjeta titulo="Supuestos del modelo"
        derecha={<div className="flex flex-wrap items-center gap-2">
          <BotonesVista etiqueta="Vista" valor={vista} onChange={setVista}
            opciones={[{ id: "escenarios", label: "Escenarios" }, { id: "flujos", label: "Migración y provisión" }, { id: "calibracion", label: "Validación" }, { id: "metodologia", label: "Metodología" }]} />
          <span ref={setSlot} className="flex items-center gap-2 empty:hidden" />
        </div>}>
        {vista === "metodologia" && <Metodologia d={d} onGuardar={guardarConfig} />}
        {vista === "escenarios" && <VistaEscenarios config={d.config} onGuardar={guardarConfig} slot={slot} />}
        {vista === "escenarios" && agencia !== "Consolidado" && <Panorama agencia={agencia} ejercicio={ejercicio} config={d.config} parametros={d.parametros} />}
        {vista === "flujos" && <VistaFlujos d={d} onGuardar={(p, ok) => post({ accion: "parametros", parametros: p }, ok)} />}
        {vista === "calibracion" && <VistaCalibracion d={d} onGuardar={guardarConfig} />}
      </Tarjeta>
      )}
    </div>
  );
}


// =====================================================================
// ESCENARIOS: una columna por escenario
// =====================================================================
function VistaEscenarios({ config, onGuardar, slot }: { config: ConfigFlow; onGuardar: (c: ConfigFlow) => Promise<boolean>; slot: HTMLElement | null }) {
  const [editando, setEditando] = useState(false);
  const [b, setB] = useState<ConfigFlow>(config);
  const [guardando, setGuardando] = useState(false);
  // al pulsar Editar se copia lo guardado (onEditar); fuera de edición se muestra lo guardado
  const v = editando ? b : config;
  const factor = (e: Escenario) => (e === "optimista" ? v.factorOptimista : e === "pesimista" ? v.factorPesimista : 1);
  const num = (valor: number, set: (n: number) => void, decimales = 0, ancho = 110) => (
    <input key={`${valor}`} defaultValue={valor.toFixed(decimales).replace(".", ",")} inputMode="decimal" className={campo} style={{ width: ancho, border: `1px solid ${BORDE_EDICION}` }}
           onBlur={(e) => { const n = leerNumero(e.target.value); if (n !== null && n >= 0) set(n); }} />
  );
  const TD = "px-4 text-right whitespace-nowrap";
  const fila = (label: ReactNode, celda: (e: Escenario) => ReactNode, clave = false) => (
    <tr style={{ borderTop: `1px solid ${C.beige}`, height: 44, fontWeight: clave ? 600 : 400 }}>
      <td className="pl-4" style={{ color: C.texto3 }}>{label}</td>
      {ESCENARIOS.map((e) => <td key={e} className={TD} style={e === v.escenario ? { background: "#F7FAF8" } : undefined}>{celda(e)}</td>)}
    </tr>
  );
  return (
    <div>
      {slot && createPortal(
        <BotonesSeccion editando={editando} cambios={JSON.stringify(b) !== JSON.stringify(config) ? 1 : 0} guardando={guardando}
          onEditar={() => { setB(config); setEditando(true); }} onCancelar={() => setEditando(false)}
          onGuardar={async () => { setGuardando(true); const ok = await onGuardar(b); setGuardando(false); if (ok) setEditando(false); }} />, slot)}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[12px] border-collapse min-w-[640px]">
          <colgroup><col style={{ width: "40%" }} /><col /><col /><col /></colgroup>
          <thead>
            <tr style={{ borderBottom: "2px solid #DDE2DF", color: C.texto2, height: 40 }}>
              <th className="pl-4 text-left font-semibold">Supuesto</th>
              {ESCENARIOS.map((e) => (
                <th key={e} className={`${TD} font-semibold`} style={e === v.escenario ? { background: "#F7FAF8", color: C.acento } : undefined}>
                  {editando ? (
                    <button type="button" onClick={() => setB({ ...b, escenario: e })} className="inline-flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center" style={{ border: `1.5px solid ${e === b.escenario ? C.acento : "#B9C3BD"}` }}>
                        {e === b.escenario && <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.acento }} />}
                      </span>
                      {NOMBRE_ESCENARIO[e]}
                    </button>
                  ) : <>{NOMBRE_ESCENARIO[e]}{e === v.escenario && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.acentoSuave }}>activo</span>}</>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fila(<Supuesto titulo="Ritmo de atraso de la cartera hasta 60 días" />, (e) => (editando && e !== "base"
              ? num(factor(e), (n) => setB(e === "optimista" ? { ...b, factorOptimista: n } : { ...b, factorPesimista: n }), 2, 70)
              : `×${factor(e).toFixed(2).replace(".", ",")}`))}
            {fila(<Supuesto titulo="Recuperación de cartera castigada en el año" />, (e) => (editando
              ? num(v.recuperacionAnual[e], (n) => setB({ ...b, recuperacionAnual: { ...b.recuperacionAnual, [e]: n } }))
              : usd(v.recuperacionAnual[e])))}
            {/* El castigo es uno solo para los tres escenarios */}
            <tr style={{ borderTop: `1px solid ${C.beige}`, height: 44 }}>
              <td className="pl-4" style={{ color: C.texto3 }}><Supuesto titulo="Castigo mensual de cartera de crédito" /></td>
              <td colSpan={3} className="px-4 text-center whitespace-nowrap">
                {editando ? num(v.castigoMensual, (n) => setB({ ...b, castigoMensual: n })) : usd(v.castigoMensual)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// FLOW RATES Y TASAS: por producto; Recalibrar muestra la vista previa antes de guardar
// =====================================================================
function VistaFlujos({ d, onGuardar }: { d: EstadoProvisionFlow; onGuardar: (p: ParametrosFlow, ok: string) => Promise<boolean> }) {
  const [producto, setProducto] = useState<Producto>("CONSUMO");
  const [editando, setEditando] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [b, setB] = useState<ParametrosFlow>(d.parametros);
  const [guardando, setGuardando] = useState(false);
  // al pulsar Editar se copia lo guardado (onEditar); fuera de edición se muestra lo guardado
  const actual = editando ? b : d.parametros;
  const sug = d.calibracion.parametros;
  const cambios = editando ? PRODUCTOS.reduce((t, p) => t + TRAMOS[p].filter((k) => JSON.stringify(b[p][k]) !== JSON.stringify(d.parametros[p][k])).length, 0) : 0;
  const cambiosPrevia = PRODUCTOS.reduce((t, p) => t + TRAMOS[p].filter((k) => Math.abs((sug[p]?.[k]?.fr.base ?? 0) - d.parametros[p][k].fr.base) > 1e-6 || Math.abs((sug[p]?.[k]?.tasa ?? 0) - d.parametros[p][k].tasa) > 1e-6).length, 0);
  const set = (k: string, f: (x: ParametrosFlow[Producto][string]) => ParametrosFlow[Producto][string]) =>
    setB((prev) => ({ ...prev, [producto]: { ...prev[producto], [k]: f(prev[producto][k]) } }));
  const pctInput = (key: string, valor: number, cambiar: (n: number) => void) => (
    <input key={key + valor} defaultValue={(valor * 100).toFixed(2).replace(".", ",")} inputMode="decimal" className={campo} style={{ width: 76, border: `1px solid ${BORDE_EDICION}` }}
           onBlur={(e) => { const n = leerNumero(e.target.value); if (n !== null) cambiar(Math.max(0, Math.min(100, n)) / 100); }} />
  );
  const TH = "px-3 py-2 text-right font-semibold whitespace-nowrap";
  const TD = "px-3 text-right whitespace-nowrap";
  const rango = (k: string) => rangoNormaTramo(producto, k, d.categoriasCorte?.[producto]?.[k]);
  const fueraNorma = (k: string, t: number) => { const [a, z] = rango(k); return t < a - 5e-5 || t > z + 5e-5; };
  const delta = (a: number, s: number) => {
    const dif = s - a;
    if (Math.abs(dif) < 5e-5) return <span style={{ color: C.tenue }}>{pctTxt(s)}</span>;
    return <span style={{ color: C.texto, fontWeight: 600 }}>{pctTxt(s)} <span className="text-[10px]" style={{ color: dif > 0 ? C.alerta : C.ok }}>{dif > 0 ? "▲" : "▼"}</span></span>;
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <BotonesVista etiqueta="Producto" valor={producto} onChange={setProducto} opciones={PRODUCTOS.map((p) => ({ id: p, label: NOMBRE_PRODUCTO[p] }))} />
        <span className="flex-1" />
        {previa ? (
          <>
            <button type="button" onClick={() => setPrevia(false)} className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC", color: C.texto }}>Descartar</button>
            <button type="button" disabled={guardando} onClick={async () => { setGuardando(true); const ok = await onGuardar(sug, "Recalibración aplicada."); setGuardando(false); if (ok) setPrevia(false); }}
                    className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.acento }}>
              <Check size={14} /> Aplicar recalibración{cambiosPrevia ? ` (${cambiosPrevia})` : ""}
            </button>
          </>
        ) : !editando && (
          <button type="button" onClick={() => setPrevia(true)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F3F5F4]" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            <RefreshCw size={13} /> Recalibrar
          </button>
        )}
        {!previa && <BotonesSeccion editando={editando} cambios={cambios} guardando={guardando}
          onEditar={() => { setB(d.parametros); setEditando(true); }} onCancelar={() => setEditando(false)}
          onGuardar={async () => { setGuardando(true); const ok = await onGuardar(b, "Parámetros guardados."); setGuardando(false); if (ok) setEditando(false); }} />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse min-w-[760px]">
          <thead>
            <tr style={{ borderBottom: "2px solid #DDE2DF", color: C.texto2 }}>
              <th className="pl-4 pr-2 py-2 text-left font-semibold">Días de atraso</th>
              <th className="px-3 py-2 text-left font-semibold">Calificación</th>
              <th className={TH}>Meses en el tramo</th>
              {previa ? <>
                <th className={TH}>Migración Base actual</th><th className={TH} style={{ color: C.acento }}>Migración Base recalibrada</th>
                <th className={TH}>Tasa actual</th><th className={`${TH} pr-4`} style={{ color: C.acento }}>Tasa recalibrada</th>
              </> : <>
                {ESCENARIOS.map((e) => <th key={e} className={TH} style={e === d.config.escenario ? { color: C.acento } : undefined}>Migración {NOMBRE_ESCENARIO[e]}</th>)}
                <th className={TH}><span className="inline-flex items-center gap-1">Tasa del modelo<Formula derecha>Provisión ÷ saldo del tramo en los últimos 3 cortes. Si el tramo agrupa dos calificaciones, es una sola tasa para las dos.</Formula></span></th>
                <th className={TH}><span className="inline-flex items-center gap-1">Tasa aplicada {d.corte ? per(d.corte) : ""}<Formula derecha>Provisión ÷ saldo de cada calificación en el último corte de Calificación de Cartera.</Formula></span></th>
                <th className={`${TH} pr-4`}><span className="inline-flex items-center gap-1">Rango de la norma<Formula derecha>Mínimo y máximo por calificación (Codificación JPRF, Art. 59). En ámbar: tasa fuera del rango; debajo del mínimo ocurre con garantía hipotecaria.</Formula></span></th>
              </>}
            </tr>
          </thead>
          <tbody>
            {TRAMOS[producto].map((k, idx) => {
              const x = actual[producto][k]; const s = sug[producto]?.[k];
              const esV = idx === 0;
              const cats = previa ? [null] : categoriasDe(producto, k);
              const n = cats.length;
              return cats.map((cat, j) => {
                const det = cat ? d.detalleCategorias?.[producto]?.[cat] : undefined;
                const aplicada = det && det.saldo ? det.prov / det.saldo : null;
                const rg = cat ? RANGO_NORMA[cat] : null;
                const fuera = aplicada !== null && rg ? aplicada < rg[0] - 5e-5 || aplicada > rg[1] + 5e-5 : false;
                return (
                  <tr key={`${k}-${cat ?? ""}`} style={{ borderTop: j === 0 ? `1px solid ${C.beige}` : "none", height: 34 }}>
                    <td className="pl-4 pr-2 whitespace-nowrap" style={{ color: C.texto }}>{cat ? diasCategoria(cat, det) ?? partesTramo(producto, k).dias : partesTramo(producto, k).dias}</td>
                    <td className="px-3 whitespace-nowrap" style={{ color: C.texto2 }}>{cat ?? partesTramo(producto, k).calificacion}</td>
                    {j === 0 && <>
                      <td rowSpan={n} className={TD}>{editando && !esV
                        ? <input key={`${producto}-${k}-n-${x.n}`} defaultValue={String(x.n)} inputMode="numeric" className={campo} style={{ width: 52, border: `1px solid ${BORDE_EDICION}` }}
                                 onBlur={(e) => { const v = leerNumero(e.target.value); if (v !== null && v >= 1) set(k, (y) => ({ ...y, n: v })); }} />
                        : x.n}</td>
                      {previa ? <>
                        <td className={TD} style={{ color: C.texto2 }}>{esV ? "—" : pctTxt(x.fr.base)}</td>
                        <td className={TD}>{esV || !s ? "—" : delta(x.fr.base, s.fr.base)}</td>
                        <td className={TD} style={{ color: C.texto2 }}>{pctTxt(x.tasa)}</td>
                        <td className={`${TD} pr-4`}>{s ? delta(x.tasa, s.tasa) : "—"}</td>
                      </> : <>
                        {ESCENARIOS.map((e) => <td key={e} rowSpan={n} className={TD} style={{ color: esV ? C.tenue : C.texto }}>
                          {esV ? "—" : editando ? pctInput(`${producto}-${k}-${e}`, x.fr[e], (v) => set(k, (y) => ({ ...y, fr: { ...y.fr, [e]: v } }))) : pctTxt(x.fr[e])}
                        </td>)}
                        <td rowSpan={n} className={TD} style={{ color: fueraNorma(k, x.tasa) ? C.aviso : undefined, fontWeight: fueraNorma(k, x.tasa) ? 600 : undefined }}>{editando ? pctInput(`${producto}-${k}-t`, x.tasa, (v) => set(k, (y) => ({ ...y, tasa: v }))) : pctTxt(x.tasa)}</td>
                      </>}
                    </>}
                    {!previa && <>
                      <td className={TD} style={{ color: fuera ? C.aviso : C.texto2, fontWeight: fuera ? 600 : undefined }}>{aplicada === null ? "—" : pctTxt(aplicada)}</td>
                      <td className={`${TD} pr-4`} style={{ color: C.texto2 }}>{rg ? (rg[0] === rg[1] ? pctTxt(rg[0]) : `${(rg[0] * 100).toFixed(2).replace(".", ",")} – ${pctTxt(rg[1])}`) : "—"}</td>
                    </>}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      {!previa && !editando && <ComparaNorma d={d} parametros={d.parametros} />}
    </div>
  );
}

/** Provisión requerida al último corte con la tasa actual y con el mínimo y máximo de la norma, por producto. */
function ComparaNorma({ d, parametros }: { d: EstadoProvisionFlow; parametros: ParametrosFlow }) {
  const [abierto, setAbierto] = useState(false);
  if (!d.inicial || !d.corte) return null;
  const req = (p: Producto, f: (k: string) => number) => TRAMOS[p].reduce((t, k) => t + (d.inicial![p]?.[k] ?? 0) * f(k), 0);
  const rg = (p: Producto, k: string, i: 0 | 1) => rangoNormaTramo(p, k, d.categoriasCorte?.[p]?.[k])[i];
  const filas: { label: string; v: (p: Producto) => number; fuerte?: boolean }[] = [
    { label: "Mínimo de la norma", v: (p) => req(p, (k) => rg(p, k, 0)) },
    { label: "Con la tasa actual", v: (p) => req(p, (k) => parametros[p][k].tasa), fuerte: true },
    { label: "Máximo de la norma", v: (p) => req(p, (k) => rg(p, k, 1)) },
    { label: "Provisión real del corte", v: (p) => TRAMOS[p].reduce((t, k) => t + (d.provisionCorte?.[p]?.[k] ?? 0), 0) },
  ];
  const TD = "px-3 text-right whitespace-nowrap tabla-cifras";
  return (
    <div style={{ borderTop: `1px solid ${C.beige}` }}>
      <div className="flex items-center gap-1.5 px-4 py-3">
        <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
                className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5"
                style={abierto ? { background: C.acentoSuave, color: C.acento, border: `1px solid ${BORDE_EDICION}` } : { background: "#FFFFFF", color: C.acento, border: "1px solid #C9D0CC" }}>
          Provisión requerida frente a la norma · {per(d.corte)} <span aria-hidden>{abierto ? "▴" : "▾"}</span>
        </button>
        {abierto && <Formula>Saldo de cada tramo en el corte × tasa. El mínimo y el máximo usan el rango de la norma de cada calificación.</Formula>}
      </div>
      {abierto && <div className="overflow-x-auto pb-1">
        <table className="w-full text-[12px] border-collapse min-w-[760px]">
          <thead>
            <tr style={{ borderBottom: "2px solid #DDE2DF", color: C.texto2, height: 36 }}>
              <th className="pl-4 pr-2 text-left font-semibold" />
              {PRODUCTOS.map((p) => <th key={p} className={`${TD} font-semibold`}>{NOMBRE_PRODUCTO[p]}</th>)}
              <th className={`${TD} pr-4 font-semibold`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const tot = PRODUCTOS.reduce((t, p) => t + f.v(p), 0);
              return (
                <tr key={f.label} style={{ borderTop: `1px solid ${C.beige}`, height: 36, fontWeight: f.fuerte ? 700 : 400, background: f.fuerte ? "#F7FAF8" : undefined }}>
                  <td className="pl-4 pr-2 whitespace-nowrap" style={{ color: C.texto3 }}>{f.label}</td>
                  {PRODUCTOS.map((p) => <td key={p} className={TD}>{usd(f.v(p))}</td>)}
                  <td className={`${TD} pr-4`}>{usd(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

// =====================================================================
// FÓRMULA: ícono Σ que muestra cómo se obtiene un valor (al hacer clic; se cierra con otro clic, Esc o al desplazarse)
// =====================================================================
export function Formula({ children, derecha, info }: { children: ReactNode; derecha?: boolean; info?: boolean }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const cerrar = () => setPos(null);
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("mousedown", cerrar); window.addEventListener("scroll", cerrar, true); window.addEventListener("resize", cerrar); window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("mousedown", cerrar); window.removeEventListener("scroll", cerrar, true); window.removeEventListener("resize", cerrar); window.removeEventListener("keydown", tecla); };
  }, [pos]);
  const abrir = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = e.currentTarget.getBoundingClientRect(), W = 300, vw = window.innerWidth;
    let left = derecha ? r.right - W : r.left;
    left = Math.max(8, Math.min(left, vw - W - 8));
    setPos({ top: r.bottom + 4, left });
  };
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label={info ? "Qué significa" : "Ver fórmula"} aria-expanded={!!pos} onMouseDown={(e) => e.stopPropagation()} onClick={abrir}
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#E3EEE7] outline-none" style={{ background: pos ? "#E3EEE7" : undefined }}>
        {info ? <Info size={13} color={C.acento} /> : <Sigma size={12} color={C.acento} />}
      </button>
      {pos && typeof document !== "undefined" && createPortal(
        <span role="tooltip" onMouseDown={(e) => e.stopPropagation()} className="fixed z-[60] w-[300px] rounded-lg bg-white px-3 py-2.5 text-left text-[12px] font-normal leading-relaxed whitespace-normal shadow-lg"
              style={{ top: pos.top, left: pos.left, border: `1px solid ${C.beige}`, color: C.texto3 }}>
          {children}
        </span>, document.body)}
    </span>
  );
}


// =====================================================================
// VALIDACIÓN: ¿el modelo acierta? (backtest) y ¿de qué meses salen los porcentajes?
// =====================================================================
const mesesEntre = (desde: string, hasta: string) => { const out: string[] = []; for (let p = desde; p <= hasta; p = sig(p)) out.push(p); return out; };
const rango = (ms: string[]) => (ms.length ? (ms.length === 1 ? per(ms[0]) : `${per(ms[0])} a ${per(ms[ms.length - 1])}`) : "—");

function VistaCalibracion({ d, onGuardar }: { d: EstadoProvisionFlow; onGuardar: (c: ConfigFlow) => Promise<boolean> }) {
  const [editando, setEditando] = useState(false);
  const [b, setB] = useState<ConfigFlow>(d.config);
  const [guardando, setGuardando] = useState(false);
  // al pulsar Editar se copia lo guardado (onEditar); fuera de edición se muestra lo guardado
  const cal = d.calibracion;
  const bt = d.backtest;
  const primero = d.periodos[0]?.periodo, ultimo = d.periodos[d.periodos.length - 1]?.periodo;
  const meses = bt?.meses ?? [];
  const maxBar = Math.max(1, ...meses.flatMap((m) => [m.modelo, m.real]));
  const acierto = bt && bt.real ? bt.modelo / bt.real : null;
  const dif = bt ? bt.modelo - bt.real : 0;
  const migracion = mesesEntre(d.config.ventanaDesde, d.config.ventanaHasta);
  const usos: { nombre: string; meses: string[]; formula: ReactNode; editable?: boolean }[] = [
    { nombre: "% de migración", meses: migracion, editable: true,
      formula: <>Suma de lo que llegó a cada tramo ÷ suma de lo que había en el tramo anterior el mes previo.</> },
    { nombre: "% de provisión", meses: cal.periodosTasas,
      formula: <>Provisión ÷ saldo de cada tramo, últimos 3 cortes.</> },
    { nombre: "Tramo E y castigos", meses: cal.ventanaE,
      formula: <>Se cruza la Calificación de Cartera con el gasto 4402 y la reversión 5604.10 del estado de resultados.</> },
  ];
  const TDc = "px-4 whitespace-nowrap";

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-4 pb-5" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div className="flex items-center gap-1.5">
          <b className="text-[14px]">¿El modelo acierta?</b>
          <Formula>Se corre el modelo sobre meses que ya pasaron y se compara con el gasto real: 4402 − 5604.10.</Formula>
        </div>
        {!bt || !meses.length ? (
          <p className="text-[12px] mt-2" style={{ color: C.texto2 }}>Sin meses para comparar.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 mt-3">
            <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: C.acentoSuave }}>
              <span className="text-[12px]" style={{ color: C.acento }}>Acierto {rango(meses.map((m) => m.periodo))}</span>
              <span className="text-[32px] font-extrabold leading-none tabla-cifras" style={{ color: C.acento }}>{acierto !== null ? pct(acierto, 0) : "—"}</span>
              <div className="flex flex-col gap-1 mt-1 text-[12px]">
                {[["Modelo", bt.modelo], ["Real", bt.real], ["Diferencia", dif]].map(([k, v]) => (
                  <span key={k as string} className="flex justify-between" style={{ color: C.texto3, fontWeight: k === "Diferencia" ? 700 : 400 }}>
                    <span>{k}</span><span className="tabla-cifras">{(v as number) < 0 ? `−${usd(-(v as number))}` : usd(v as number)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col justify-center gap-2">
              {meses.map((m) => {
                const desv = m.real ? m.modelo / m.real - 1 : 0;
                return (
                  <div key={m.periodo} className="grid grid-cols-[52px_1fr_56px] items-center gap-3">
                    <span className="text-[12px] font-semibold" style={{ color: C.texto3 }}>{per(m.periodo)}</span>
                    <div className="flex flex-col gap-0.5">
                      <BarraVal etiqueta="Modelo" valor={m.modelo} max={maxBar} color={C.acento} />
                      <BarraVal etiqueta="Real" valor={m.real} max={maxBar} color="#9AA5A0" />
                    </div>
                    <span className="text-right text-[12px] font-semibold tabla-cifras" style={{ color: Math.abs(desv) <= 0.15 ? C.ok : C.aviso }}>
                      {m.real ? `${desv > 0 ? "+" : desv < 0 ? "−" : ""}${Math.abs(Math.round(desv * 100))} %` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="pt-4 pb-2">
        <div className="flex flex-wrap items-center gap-3 px-5 mb-2">
          <b className="text-[14px] flex-1">¿De qué meses salen los porcentajes?</b>
          <BotonesSeccion editando={editando} cambios={b.ventanaDesde !== d.config.ventanaDesde || b.ventanaHasta !== d.config.ventanaHasta || (b.ventanaAuto !== false) !== (d.config.ventanaAuto !== false) ? 1 : 0} guardando={guardando}
            onEditar={() => { setB(d.config); setEditando(true); }} onCancelar={() => setEditando(false)}
            onGuardar={async () => { setGuardando(true); const ok = await onGuardar(b); setGuardando(false); if (ok) setEditando(false); }} />
        </div>
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
              <th className={`${TDc} text-left font-semibold`}>Cálculo</th>
              <th className={`${TDc} text-left font-semibold`}>Meses</th>
              <th className={`${TDc} text-right font-semibold`}>N° de meses</th>
            </tr>
          </thead>
          <tbody>
            {usos.map((u) => (
              <tr key={u.nombre} style={{ borderTop: `1px solid ${C.beige}`, height: 42 }}>
                <td className={TDc} style={{ color: C.texto }}><span className="inline-flex items-center gap-1">{u.nombre}<Formula>{u.formula}</Formula></span></td>
                <td className={TDc} style={{ color: C.texto3 }}>
                  {u.editable && editando ? (
                    <span className="flex items-center gap-2">
                      <input type="month" value={b.ventanaDesde} onChange={(e) => setB({ ...b, ventanaDesde: e.target.value })} className={campo} style={{ border: `1px solid ${BORDE_EDICION}` }} />
                      <span style={{ color: C.texto2 }}>a</span>
                      <input type="month" value={b.ventanaHasta} onChange={(e) => setB({ ...b, ventanaHasta: e.target.value })} className={campo} style={{ border: `1px solid ${BORDE_EDICION}` }} />
                      <label className="inline-flex items-center gap-1.5 ml-2 cursor-pointer" style={{ color: C.texto }}>
                        <input type="checkbox" checked={b.ventanaAuto === false} onChange={(e) => setB({ ...b, ventanaAuto: !e.target.checked })} />Base fija
                      </label>
                      <Formula>Base fija: los meses que se suban después (p. ej. diciembre) solo actualizan los saldos de partida; los porcentajes, el ritmo real y las metas aprobadas no cambian. Sin marcar, el período se extiende solo hasta el último corte cargado.</Formula>
                    </span>
                  ) : u.nombre === "% de provisión" ? u.meses.map(per).join(" · ") || "—" : <>{rango(u.meses)}{u.editable && <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={d.config.ventanaAuto === false ? { background: C.acentoSuave, color: C.ok } : { background: "#F4EEDC", color: "#8A6A12" }}>{d.config.ventanaAuto === false ? "Base fija" : "Sigue los cortes nuevos"}</span>}</>}
                </td>
                <td className={`${TDc} text-right tabla-cifras`}>{u.meses.length || "—"}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${C.beige}`, height: 42 }}>
              <td className={TDc} style={{ color: C.texto }}>Cortes de Calificación cargados</td>
              <td className={TDc} style={{ color: C.texto3 }}>{primero ? rango([primero, ultimo!]) : "—"}</td>
              <td className={`${TDc} text-right tabla-cifras`}>{d.periodos.length || "—"}</td>
            </tr>
            <tr style={{ borderTop: `1px solid ${C.beige}`, height: 42 }}>
              <td className={TDc} style={{ color: C.texto }}>Estados de resultados cargados</td>
              <td className={TDc} style={{ color: C.texto3 }}>{d.eerr.length ? rango([d.eerr[0].periodo, d.eerr[d.eerr.length - 1].periodo]) : "—"}</td>
              <td className={`${TDc} text-right tabla-cifras`}>{d.eerr.length || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarraVal({ etiqueta, valor, max, color }: { etiqueta: string; valor: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[44px] shrink-0 text-[11px]" style={{ color: C.texto2 }}>{etiqueta}</span>
      <div className="flex-1 h-2 rounded-full" style={{ background: "#F1F3F2" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, valor) / max * 100}%`, background: color }} />
      </div>
      <span className="w-[80px] shrink-0 text-right text-[11px] tabla-cifras">{usd(valor)}</span>
    </div>
  );
}

// =====================================================================
// METODOLOGÍA: tres tarjetas (resumen), cálculo del mes y origen de los porcentajes
// =====================================================================
/** Tabla de ejemplo: encabezado, filas y una fila de total. La primera columna es texto; las demás, cifras. */
function TablaEj({ titulo, formula, cols, filas, total }: { titulo: string; formula?: ReactNode; cols: string[]; filas: ReactNode[][]; total?: ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.acento }}>{titulo}{formula && <Formula>{formula}</Formula>}</span>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse bg-white" style={{ border: `1px solid ${C.beige}` }}>
          <thead>
            <tr style={{ color: C.texto2, background: "#F3F5F4", height: 30 }}>
              {cols.map((c, i) => <th key={c + i} className={`${i ? "text-right" : "text-left"} px-3 font-semibold whitespace-nowrap`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, k) => (
              <tr key={k} style={{ borderTop: `1px solid ${C.beige}`, height: 30 }}>
                {f.map((c, i) => <td key={i} className={`${i ? "text-right tabla-cifras" : "text-left"} px-3 whitespace-nowrap`} style={{ color: i ? C.texto : C.texto3 }}>{c}</td>)}
              </tr>
            ))}
            {total && (
              <tr style={{ borderTop: "1px solid #B9C3BD", height: 32, fontWeight: 700 }}>
                {total.map((c, i) => <td key={i} className={`${i ? "text-right tabla-cifras" : "text-left"} px-3 whitespace-nowrap`}>{c}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type VistaMetodo = "resumen" | "calculo" | "origen" | "agencias";

function Metodologia({ d, onGuardar }: { d: EstadoProvisionFlow; onGuardar: (c: ConfigFlow) => Promise<boolean> }) {
  const [producto, setProducto] = useState<Producto>("CONSUMO");
  const [vista, setVista] = useState<VistaMetodo>("resumen");
  const e = d.config.escenario;
  const ej = useMemo(() => {
    if (!d.inicial) return null;
    const castigos = castigoPorProducto(d.config.castigoMensual, d.inicial, d.inicial);
    const r = proyectarProvisionFlow({ parametros: d.parametros, escenario: e, inicial: d.inicial, castigoMensualPorProducto: castigos, mesesPuente: 0, totalesEjercicio: null, restarCastigos: false });
    return { r: r[producto] };
  }, [d, e, producto]);
  if (!ej || !d.inicial || !d.corte) return null;
  const tr = TRAMOS[producto];
  const T = (k: string) => ETIQUETA_TRAMO[producto][k];
  const ini = d.inicial[producto];
  const par = d.parametros[producto];
  const sal = (k: string) => ej.r.saldos[k][0];
  const total = tr.reduce((t, k) => t + (ini[k] ?? 0), 0);
  const mora = tr.slice(1).reduce((t, k) => t + sal(k), 0);
  const mesEj = sig(d.corte);
  const kE = tr[tr.length - 1];
  const k1 = tr[1], k2 = tr[2];

  const periodos = Object.keys(d.historia?.saldo ?? {}).sort();
  const H = (p: string, k: string) => d.historia?.saldo[p]?.[producto]?.[k] ?? 0;
  const HP = (p: string, k: string) => d.historia?.prov[p]?.[producto]?.[k] ?? 0;
  const ventana = periodos.filter((p) => p >= d.config.ventanaDesde && p <= d.config.ventanaHasta && periodos.indexOf(p) > 0);
  const anterior = (p: string) => periodos[periodos.indexOf(p) - 1];
  const filasRod = ventana.map((p) => [`${per(anterior(p))} → ${per(p)}`, usd(H(anterior(p), tr[0])), usd(H(p, k1)), pctTxt(H(anterior(p), tr[0]) ? H(p, k1) / H(anterior(p), tr[0]) : 0)]);
  const sumAnt = ventana.reduce((t, p) => t + H(anterior(p), tr[0]), 0), sumLleg = ventana.reduce((t, p) => t + H(p, k1), 0);
  const cortesTasa = d.calibracion.periodosTasas;
  const filasTasa = cortesTasa.map((p) => [per(p), usd(H(p, k2)), usd(HP(p, k2)), pctTxt(H(p, k2) ? HP(p, k2) / H(p, k2) : 0)]);
  const sumS = cortesTasa.reduce((t, p) => t + H(p, k2), 0), sumP = cortesTasa.reduce((t, p) => t + HP(p, k2), 0);

  const provAnt = ej.r.provisionCorte, provNueva = ej.r.provision[0], castigo = ej.r.castigos[0], gasto = ej.r.gastoNeto[0];
  const moraIni = tr.slice(1).reduce((t, k) => t + (ini[k] ?? 0), 0);
  // Por tramo: lo que llega del anterior y lo que se queda
  const llega = (k: string, i: number) => (i === 0 ? null : ((ini[tr[i - 1]] ?? 0) / par[tr[i - 1]].n) * par[k].fr[e]);
  const queda = (k: string, i: number) => (i === 0 ? null : k === kE ? (ini[k] ?? 0) : par[k].n > 1 ? (ini[k] ?? 0) * (1 - 1 / par[k].n) : 0);
  const signo = (v: number) => `${v < 0 ? "−" : "+"}${usd(Math.abs(v))}`;
  const guion = <span style={{ color: C.tenue }}>—</span>;
  const TDn = "px-3 text-right tabla-cifras whitespace-nowrap";
  const res = { background: "#F2F7F4" };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-3">
        <BotonesVista etiqueta="Vista de la metodología" valor={vista} onChange={setVista}
          opciones={[{ id: "resumen", label: "Resumen" }, { id: "calculo", label: "Cálculo del mes" }, { id: "origen", label: "Origen de los %" }, { id: "agencias", label: "Ritmo por agencia" }]} />
        <span className="flex-1 text-right text-[12px]" style={{ color: C.texto2 }}>{per(d.corte)} → {per(mesEj)} · {NOMBRE_ESCENARIO[e]}</span>
        <BotonesVista etiqueta="Producto del ejemplo" valor={producto} onChange={setProducto} opciones={PRODUCTOS.map((p) => ({ id: p, label: NOMBRE_PRODUCTO[p] }))} />
      </div>

      {vista === "resumen" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-5 py-4">
          <TarjetaPregunta n={1} pregunta="¿Cuánta cartera se atrasa?" valor={usd(mora)}
            pie={`Con atraso a ${per(mesEj)} · ${signo(mora - moraIni)}`}
            formula={<>Cada tramo = saldo del tramo anterior el mes previo × % de migración.<br />{T(tr[0])} → {T(k1)}: {pctTxt(par[k1].fr[e])}<br />{T(k1)} → {T(k2)}: {pctTxt(par[k2].fr[e])}</>} />
          <TarjetaPregunta n={2} pregunta="¿Cuánto hay que provisionar?" valor={usd(provNueva)}
            pie={`Provisión a ${per(mesEj)} · ${signo(provNueva - provAnt)}`}
            formula={<>Σ saldo de cada tramo × su % de provisión.<br />{T(tr[0])}: {pctTxt(par[tr[0]].tasa)}<br />{T(kE)}: {pctTxt(par[kE].tasa, 0)}</>} />
          <TarjetaPregunta n={3} pregunta={gasto >= 0 ? "¿Cuánto va al gasto?" : "¿Cuánto se reversa?"} valor={usd(Math.abs(gasto))}
            pie={gasto >= 0 ? `Cuenta ${CUENTA_4402[producto]}` : "Cuenta 5604.10"}
            formula={<>Provisión {per(mesEj)} − provisión {per(d.corte)} + castigo.<br />{usd(provNueva)} − {usd(provAnt)} + {usd(castigo)}</>} />
        </div>
      )}

      {vista === "calculo" && (
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse bg-white" style={{ border: `1px solid ${C.beige}` }}>
              <thead>
                <tr style={{ color: C.texto2, background: "#F3F5F4", height: 34 }}>
                  <th className="px-3 text-left font-semibold whitespace-nowrap">Días de atraso</th>
                  <th className="px-3 text-left font-semibold whitespace-nowrap">Calificación</th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap">Saldo {per(d.corte)}</th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap">% migración</th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap"><span className="inline-flex items-center gap-1">Llega<Formula derecha>Saldo del tramo anterior en {per(d.corte)} × % de migración. En tramos de más de un mes, el saldo anterior se divide para sus meses.</Formula></span></th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap"><span className="inline-flex items-center gap-1">Se queda<Formula derecha>Tramos de más de un mes: la parte que aún no cumple el plazo. Último tramo: todo su saldo, hasta que se castiga.</Formula></span></th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap">Castigo</th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap" style={{ ...res, color: C.acento }}><span className="inline-flex items-center gap-1">Saldo {per(mesEj)}<Formula derecha>Llega + se queda − castigo. Al día = cartera total − tramos con atraso.</Formula></span></th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap">% provisión</th>
                  <th className="px-3 text-right font-semibold whitespace-nowrap" style={{ ...res, color: C.acento }}><span className="inline-flex items-center gap-1">Provisión {per(mesEj)}<Formula derecha>Saldo {per(mesEj)} × % de provisión.</Formula></span></th>
                </tr>
              </thead>
              <tbody>
                {tr.map((k, i) => {
                  const ll = llega(k, i), q = queda(k, i), pt = partesTramo(producto, k);
                  return (
                    <tr key={k} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                      <td className="px-3 whitespace-nowrap" style={{ color: C.texto }}>{pt.dias}</td>
                      <td className="px-3 whitespace-nowrap" style={{ color: C.texto2 }}>{pt.calificacion}</td>
                      <td className={TDn}>{usd(ini[k] ?? 0)}</td>
                      <td className={TDn}>{i === 0 ? guion : pctTxt(par[k].fr[e])}</td>
                      <td className={TDn}>{ll === null ? guion : usd(ll)}</td>
                      <td className={TDn}>{q === null || q === 0 ? guion : usd(q)}</td>
                      <td className={TDn} style={{ color: C.alerta }}>{k === kE && castigo ? `−${usd(castigo)}` : ""}</td>
                      <td className={`${TDn} font-semibold`} style={res}>{usd(sal(k))}</td>
                      <td className={TDn}>{pctTxt(par[k].tasa)}</td>
                      <td className={`${TDn} font-semibold`} style={res}>{usd(sal(k) * par[k].tasa)}</td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "1px solid #B9C3BD", height: 34, fontWeight: 700 }}>
                  <td className="px-3" colSpan={2}>Total</td>
                  <td className={TDn}>{usd(total)}</td>
                  <td /><td /><td />
                  <td className={TDn} style={{ color: C.alerta }}>{castigo ? `−${usd(castigo)}` : ""}</td>
                  <td className={TDn} style={res}>{usd(tr.reduce((t, k) => t + sal(k), 0))}</td>
                  <td />
                  <td className={TDn} style={res}>{usd(provNueva)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[[`Provisión ${per(mesEj)}`, usd(provNueva)], [`(−) Provisión ${per(d.corte)}`, usd(provAnt)], ["(+) Castigo", usd(castigo)]].map(([k, v]) => (
              <div key={k} className="rounded-lg px-3 py-2 flex flex-col" style={{ background: "#F3F5F4" }}>
                <span className="text-[11px]" style={{ color: C.texto2 }}>{k}</span>
                <b className="text-[14px] tabla-cifras">{v}</b>
              </div>
            ))}
            <div className="rounded-lg px-3 py-2 flex flex-col text-white" style={{ background: C.acento }}>
              <span className="text-[11px] opacity-90">{gasto >= 0 ? `Gasto · ${CUENTA_4402[producto]}` : "Reversión · 5604.10"}</span>
              <b className="text-[14px] tabla-cifras">{usd(Math.abs(gasto))}</b>
            </div>
          </div>
        </div>
      )}

      {vista === "agencias" && <RitmoPorAgencia d={d} producto={producto} onGuardar={onGuardar} />}

      {vista === "origen" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 px-5 py-4">
          <TablaEj titulo={`% de migración · ${partesTramo(producto, tr[0]).dias} → ${partesTramo(producto, k1).dias}`}
            formula={<>Suma de lo que llegó ÷ suma de lo que había en el tramo anterior el mes previo. Meses {rango(ventana)}.</>}
            cols={["Meses", "Había", "Llegó", "%"]}
            filas={filasRod} total={["Total", usd(sumAnt), usd(sumLleg), pctTxt(sumAnt ? sumLleg / sumAnt : 0)]} />
          <TablaEj titulo={`% de provisión · ${partesTramo(producto, k2).dias}`}
            formula={<>Provisión ÷ saldo de los últimos 3 cortes. Ya descuenta garantías.</>}
            cols={["Corte", "Saldo", "Provisión", "%"]}
            filas={filasTasa} total={["Total", usd(sumS), usd(sumP), pctTxt(sumS ? sumP / sumS : 0)]} />
          <TablaEj titulo="Escenarios"
            formula={<>Solo cambia el atraso hasta 60 días. Optimista y Pesimista = Base × factor.</>}
            cols={["", "Optimista", "Base", "Pesimista"]}
            filas={[
              ["Factor", `×${d.config.factorOptimista.toFixed(2).replace(".", ",")}`, "×1,00", `×${d.config.factorPesimista.toFixed(2).replace(".", ",")}`],
              [partesTramo(producto, k1).dias, pctTxt(par[k1].fr.optimista), pctTxt(par[k1].fr.base), pctTxt(par[k1].fr.pesimista)],
              [partesTramo(producto, k2).dias, pctTxt(par[k2].fr.optimista), pctTxt(par[k2].fr.base), pctTxt(par[k2].fr.pesimista)],
              ["Recuperación", usd(d.config.recuperacionAnual.optimista), usd(d.config.recuperacionAnual.base), usd(d.config.recuperacionAnual.pesimista)],
            ]} />
        </div>
      )}
    </div>
  );
}

/** % de migración de cada agencia (su propio ritmo de atraso); en gris, los tramos que usan el de la cooperativa. */
function RitmoPorAgencia({ d, producto, onGuardar }: { d: EstadoProvisionFlow; producto: Producto; onGuardar: (c: ConfigFlow) => Promise<boolean> }) {
  const [guardando, setGuardando] = useState(false);
  const usado = d.config.ritmo === "cooperativa" ? "cooperativa" : "agencia";
  const cambiar = async (v: string) => {
    if (v === usado || guardando) return;
    if (!window.confirm(v === "cooperativa"
      ? "El presupuesto de las 10 agencias se calculará con el ritmo de la cooperativa (metodología anterior). ¿Continuar?"
      : "El presupuesto de cada agencia se calculará con su propio ritmo de atraso. ¿Continuar?")) return;
    setGuardando(true); await onGuardar({ ...d.config, ritmo: v as "agencia" | "cooperativa" }); setGuardando(false);
  };
  const tr = TRAMOS[producto].slice(1);
  const par = d.parametros[producto];
  const alguno = Object.values(d.ritmos ?? {}).find((r) => r);
  const TDn = "px-3 text-right tabla-cifras whitespace-nowrap";
  return (
    <div className="px-5 py-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-[12px]" style={{ color: C.texto2 }}>
          % de migración de {NOMBRE_PRODUCTO[producto].toLowerCase()} · {alguno ? rango(mesesEntre(alguno.desde, alguno.hasta)) : "—"}
        </span>
        <span className="text-[12px]" style={{ color: C.texto2 }}>Presupuesto con</span>
        <BotonesVista etiqueta="Ritmo usado en el presupuesto" valor={usado} onChange={cambiar}
          opciones={[{ id: "agencia", label: "Ritmo de cada agencia" }, { id: "cooperativa", label: "Ritmo de la cooperativa (anterior)" }]} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse bg-white" style={{ border: `1px solid ${C.beige}` }}>
          <thead>
            <tr style={{ color: C.texto2, background: "#F3F5F4", height: 34 }}>
              <th className="px-3 text-left font-semibold">Agencia</th>
              {tr.map((k) => <th key={k} className="px-3 text-right font-semibold whitespace-nowrap">{partesTramo(producto, k).dias}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32, fontWeight: 600, background: "#F7FAF8" }}>
              <td className="px-3">Cooperativa</td>
              {tr.map((k) => <td key={k} className={TDn}>{pctTxt(par[k]?.fr.base ?? 0)}</td>)}
            </tr>
            {OFICINAS_RITMO.map(([clave, nombre]) => {
              const r = d.ritmos?.[clave]?.tramos?.[producto];
              return (
                <tr key={clave} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="px-3" style={{ color: C.texto }}>{nombre}</td>
                  {tr.map((k) => {
                    const t = r?.[k];
                    const propio = !!t?.propio;
                    return (
                      <td key={k} className={TDn} style={{ color: propio ? C.texto : C.tenue }}
                          title={propio ? undefined : "Poco saldo en el tramo anterior: usa el % de la cooperativa"}>
                        {pctTxt(propio ? t!.fr : par[k]?.fr.base ?? 0)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TarjetaPregunta({ n, pregunta, valor, pie, formula }: { n: number; pregunta: string; valor: string; pie: string; formula: ReactNode }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 bg-white" style={{ border: `1px solid ${C.beige}` }}>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold" style={{ background: C.acentoSuave, color: C.acento }}>{n}</span>
        <b className="text-[14px] flex-1">{pregunta}</b>
        <Formula derecha>{formula}</Formula>
      </div>
      <span className="text-[24px] font-extrabold tabla-cifras mt-2">{valor}</span>
      <span className="text-[11px]" style={{ color: C.tenue }}>{pie}</span>
    </div>
  );
}

function Supuesto({ titulo }: { titulo: string }) {
  return <span className="py-1.5 pr-4">{titulo}</span>;
}

// =====================================================================
// PANORAMA: ¿qué pasa si la cobranza o la recuperación de castigada mejora o empeora 2, 5, 10, 15 %?
// Parte de los supuestos vigentes (escenario activo) y la cartera presupuestada de la agencia; no guarda nada.
// =====================================================================
type DatosPanorama = DatosFlow & {
  simulacion?: { inicial: Record<Producto, Record<string, number>>; castigoPorProducto: Record<Producto, number>; totales: Record<Producto, number[]>; participacionE: number; parametros?: ParametrosFlow };
};
type Palanca = "cobranza" | "recuperacion";
// Columnas del panorama: % de mejora (izquierda) y de deterioro (derecha). Editables; se recuerdan en este navegador.
const PASOS_INICIALES = { mejora: [15, 10, 5, 2], empeora: [2, 5, 10, 15] };
type Pasos = typeof PASOS_INICIALES;
const CLAVE_PASOS = "panorama-provision-pasos";
function leerPasos(): Pasos {
  try { const x = JSON.parse(localStorage.getItem(CLAVE_PASOS) ?? "null"); if (x?.mejora?.length === 4 && x?.empeora?.length === 4) return x; } catch { /* sin almacenamiento */ }
  return PASOS_INICIALES;
}

function Panorama({ agencia, ejercicio, config, parametros }: { agencia: string; ejercicio: number; config: ConfigFlow; parametros: ParametrosFlow }) {
  const [abierto, setAbierto] = useState(false);
  const [palanca, setPalanca] = useState<Palanca>("cobranza");
  const [pasos, setPasos] = useState<Pasos>(leerPasos);
  const [borrador, setBorrador] = useState<Pasos | null>(null);
  const PASOS = useMemo(() => [...pasos.mejora.map((x) => -x), 0, ...pasos.empeora], [pasos]);
  const { datos: d } = useDatos<DatosPanorama>(abierto ? urlFlow(agencia, ejercicio) : null, 0);
  const esc = config.escenario;

  const filas = useMemo(() => {
    const s = d?.simulacion;
    if (!s) return null;
    const recBase = (config.recuperacionAnual[esc] || 0) * (s.participacionE ?? 0);
    const correr = (f: number) => {
      const par = {} as ParametrosFlow;
      for (const p of PRODUCTOS) {
        par[p] = {};
        for (const k of TRAMOS[p]) {
          const x = (s.parametros ?? parametros)[p][k];
          const fr = TRAMOS_ENTRADA[p].includes(k) ? Math.max(0, Math.min(1, x.fr[esc] * f)) : x.fr[esc];
          par[p][k] = { ...x, fr: { ...x.fr, [esc]: fr } };
        }
      }
      const r = proyectarProvisionFlow({ parametros: par, escenario: esc, inicial: s.inicial, castigoMensualPorProducto: s.castigoPorProducto,
        mesesPuente: d.mesesPuente ?? 0, totalesEjercicio: s.totales, restarCastigos: true });
      return {
        gasto: PRODUCTOS.reduce((t, p) => t + r[p].gastoNeto.reduce((a, b) => a + b, 0), 0),
        provision: PRODUCTOS.reduce((t, p) => t + r[p].provision[11], 0),
        mora: PRODUCTOS.reduce((t, p) => t + r[p].mora[11], 0),
      };
    };
    const actual = correr(1);
    return PASOS.map((paso) => {
      const r = palanca === "cobranza" ? correr(1 + paso / 100) : actual;
      const rec = palanca === "recuperacion" ? recBase * (1 - paso / 100) : recBase;
      return { paso, ...r, rec, efecto: (actual.gasto - r.gasto) + (rec - recBase) };
    });
  }, [d, palanca, parametros, config, esc, PASOS]);

  const TD = "px-3 text-right whitespace-nowrap tabla-cifras";
  const colorPaso = (p: number) => (p < 0 ? C.ok : p > 0 ? C.alerta : C.acento);
  const etiqueta = (p: number) => (p === 0 ? "Actual" : `${p < 0 ? "Mejora" : "Empeora"} ${String(Math.abs(p)).replace(".", ",")} %`);
  const signo = (v: number) => (Math.abs(v) < 0.5 ? "—" : `${v > 0 ? "+" : "−"}${usd(Math.abs(v))}`);
  const fila = (label: ReactNode, valor: (f: NonNullable<typeof filas>[number]) => ReactNode, fuerte = false) => (
    <tr style={{ borderTop: `1px solid ${C.beige}`, height: 40, fontWeight: fuerte ? 700 : 400 }}>
      <td className="pl-4 pr-3 whitespace-nowrap" style={{ color: C.texto3 }}>{label}</td>
      {filas!.map((f, i) => <td key={i} className={TD} style={f.paso === 0 ? { background: "#F7FAF8" } : undefined}>{valor(f)}</td>)}
    </tr>
  );

  return (
    <div style={{ borderTop: `1px solid ${C.beige}` }}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
                className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5"
                style={abierto ? { background: C.acentoSuave, color: C.acento, border: `1px solid ${BORDE_EDICION}` } : { background: "#FFFFFF", color: C.acento, border: "1px solid #C9D0CC" }}>
          Ver panorama <span aria-hidden>{abierto ? "▴" : "▾"}</span>
        </button>
        <span className="flex-1" />
        {abierto && <BotonesVista etiqueta="Qué cambia" valor={palanca} onChange={setPalanca}
          opciones={[{ id: "cobranza", label: "Cobranza temprana" }, { id: "recuperacion", label: "Recuperación de castigada" }]} />}
        {abierto && <BotonesSeccion editando={!!borrador} cambios={borrador && JSON.stringify(borrador) !== JSON.stringify(pasos) ? 1 : 0} guardando={false}
          onEditar={() => setBorrador(pasos)} onCancelar={() => setBorrador(null)}
          onGuardar={async () => {
            if (borrador) { setPasos(borrador); try { localStorage.setItem(CLAVE_PASOS, JSON.stringify(borrador)); } catch { /* sin almacenamiento */ } }
            setBorrador(null);
          }} />}
      </div>
      {abierto && (!filas ? <div className="px-4 pb-4"><EsqueletoTabla filas={5} /></div> : (
        <div className="pb-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse min-w-[980px]">
              <thead>
                <tr style={{ borderBottom: "2px solid #DDE2DF", height: 40 }}>
                  <th className="pl-4 text-left font-semibold" style={{ color: C.texto2 }}>
                    <span className="inline-flex items-center gap-1">{ejercicio}<Formula>
                      {palanca === "cobranza"
                        ? <>Mejora 10 % = de cada 100 dólares que hoy se atrasan o entran en mora, pasan 90. Parte del escenario {NOMBRE_ESCENARIO[esc]} de {agencia}; no cambia los supuestos.</>
                        : <>Mejora 10 % = se cobra 10 % más de la cartera castigada. Parte del escenario {NOMBRE_ESCENARIO[esc]} de {agencia}; no cambia los supuestos.</>}
                    </Formula></span>
                  </th>
                  {filas.map((f, i) => {
                    const lado = i < 4 ? "mejora" : i > 4 ? "empeora" : null;
                    const idx = i < 4 ? i : i - 5;
                    return (
                      <th key={i} className="px-3 text-right font-semibold whitespace-nowrap" style={{ color: colorPaso(f.paso), background: f.paso === 0 ? "#F7FAF8" : undefined }}>
                        {borrador && lado ? (
                          <span className="inline-flex items-center gap-1">
                            {lado === "mejora" ? "−" : "+"}
                            <input key={`${lado}-${idx}-${borrador[lado][idx]}`} defaultValue={String(borrador[lado][idx]).replace(".", ",")} inputMode="decimal"
                                   className={campo} style={{ width: 46, border: `1px solid ${BORDE_EDICION}` }}
                                   onBlur={(e) => { const v = leerNumero(e.target.value); if (v !== null && v >= 0 && v <= 100) setBorrador({ ...borrador, [lado]: borrador[lado].map((y, j) => (j === idx ? v : y)) }); }} />
                            %
                          </span>
                        ) : etiqueta(f.paso)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {palanca === "cobranza" && fila("Ritmo de atraso de la cartera hasta 60 días", (f) => `×${(1 + f.paso / 100).toFixed(2).replace(".", ",")}`)}
                {fila("Gasto de provisión del año", (f) => usd(f.gasto))}
                {fila("Ingreso por recuperación de castigada", (f) => usd(f.rec))}
                {fila("Efecto en el resultado frente a hoy", (f) => (
                  <span style={{ color: f.efecto > 0.5 ? C.ok : f.efecto < -0.5 ? C.alerta : C.tenue }}>{signo(f.efecto)}</span>
                ), true)}
                {palanca === "cobranza" && fila("Provisión a diciembre", (f) => usd(f.provision))}
                {palanca === "cobranza" && fila("Cartera con atraso a diciembre", (f) => usd(f.mora))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
