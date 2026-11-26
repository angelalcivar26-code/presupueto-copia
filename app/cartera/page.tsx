"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { leerMonto } from "../../lib/numeros";
import { CampoNumero, hayCamposConError, MENSAJE_CAMPOS_CON_ERROR, useGuardiaCambios } from "../../components/GuardiaCambios";
import { usePendiente } from "../../lib/cambios-pendientes";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Printer,
  Download, ArrowRight, AlertTriangle, Pencil, Check, Trash2,
} from "lucide-react";
import { useDatos, cargarJSON, precargar, tieneDatos, obtenerJSONCache, useTurnos } from "../../lib/useDatos";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { ProvisionFlowParametros } from "../../components/ProvisionFlowParametros";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { Actualizando, EsqueletoTabla } from "../../components/Carga";
import { calibrar } from "../../lib/calc/plan2027";
import { calcularLineaCartera } from "../../lib/calc/cartera";
import { CODIGOS_CARTERA, CODIGOS_PROVISION_CARTERA } from "../../lib/calc/orquestador";
import { BotonCodigos } from "../../components/ActivosComun";
import { useMostrarCodigos } from "../../lib/mostrar-codigos";
import type { DatosPlanificacion } from "../../components/planificacion/Comun";

// =====================================================================
// CONFIGURACIÓN
// =====================================================================

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

type Linea = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";
type Filtro = Linea | "TODAS";
type Rango = "JUNIOR" | "SENIOR" | "MASTER";
type Pestana = "detalle" | "metas" | "tasas" | "provision" | "analisis";

const LINEAS: { id: Linea; label: string }[] = [
  { id: "PRODUCTIVO", label: "Productivo" },
  { id: "CONSUMO", label: "Consumo" },
  { id: "INMOBILIARIO", label: "Inmobiliario" },
  { id: "MICROCREDITO", label: "Microcrédito" },
];
const NOMBRE_LINEA: Record<Linea, string> = { PRODUCTIVO: "Productivo", CONSUMO: "Consumo", INMOBILIARIO: "Inmobiliario", MICROCREDITO: "Microcrédito" };
const PCT_DISTRIBUCION_DEFAULT: Record<Linea, number> = { PRODUCTIVO: 0, CONSUMO: 0.8, INMOBILIARIO: 0, MICROCREDITO: 0.2 };
const RANGOS: { id: Rango; label: string }[] = [
  { id: "JUNIOR", label: "Junior" }, { id: "SENIOR", label: "Senior" }, { id: "MASTER", label: "Master" },
];

// Umbrales de color para morosidad y cobertura. Ajústalos a la política de la cooperativa.
const MOROSIDAD_ALERTA = 0.10;  // desde aquí se pinta en rojo
const COBERTURA_OK = 1.0;       // 100 % o más: verde
const COBERTURA_AVISO = 0.9;    // entre 90 % y 100 %: ámbar; menos: rojo

// Paleta institucional (verde #005A28 + detalle dorado #C38A03 en el menú). Propuesta A.
const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#7A847F",
  borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F8FAF9",
  cabecera: "#FFFFFF", cabeceraTexto: "#26302B",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", okSuave: "#E3F1E7",
  aviso: "#B7791F", avisoSuave: "#FBF1DC",
  alerta: "#B42318", alertaSuave: "#FBE4E1",
};
/** Fondo de la pantalla: gris claro; las tarjetas y tablas van en blanco encima. */
const FONDO = "#EEF1EF";

/** Filtros y selecciones: verde institucional suave. */
const CHIP_ON = { background: C.acentoSuave, color: C.acento };
const CHIP_OFF = { background: "transparent", color: C.texto2 };

// =====================================================================
// UTILIDADES
// =====================================================================

function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function millones(n: number): string {
  const s = "$" + (Math.abs(n) / 1_000_000).toFixed(2).replace(".", ",") + " M";
  return n < 0 ? `(${s})` : s;
}
function pct(frac: number, d = 2): string {
  return (frac * 100).toFixed(d).replace(".", ",") + " %";
}
const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);

// =====================================================================
// TIPOS DE LAS APIS (sin cambios)
// =====================================================================

interface Oficial { id: number; usuario: string; rango: Rango; activo: number }
type Metas = { meta_junior: number; meta_senior: number; meta_master: number; minimo_operaciones: number; relacion_mora: number };

interface FilaCredito {
  linea: Linea; mes: number;
  tasa_interes_anual: number;
  pct_recuperacion_periodo: number;
  tasa_efectividad_recup: number;
  tasa_recuperacion_vencida: number;
  pct_distribucion: number | null;
  pct_pase_riesgo: number | null;     // vacío = la parte de las cuotas que no se cobra
  pct_precancelacion: number | null;  // vacío = 0
  pct_precancelacion_vencida?: number | null;  // vacío = ritmo real × el margen de la cartera por vencer
  monto_promedio: number;        // no se muestra (modo CAPACIDAD_ARCHIVO), pero el route.ts lo espera
  num_operaciones_conceder: number; // idem
}

interface DetalleMesLinea {
  mes: number;
  porVencer: { saldoInicial: number; prestamosAConceder: number; recuperacionPrestamos: number; cuotasCobradas?: number; precancelaciones?: number; incrementosRiesgo: number; saldoFinal: number };
  enRiesgo: { saldoInicial: number; incrementosRiesgo: number; recuperacionRiesgo: number; recuperacionNeta?: number; precancelaciones?: number; castigos?: number; saldoFinal: number };
  provision: number;
  ingresoPorInteres: number;
  tasas: {
    metaColocacionAgencia: number; cumplimientoColocacion?: number; pctDistribucion: number; pctRecuperacionPeriodo: number;
    tasaEfectividadRecuperacion: number; tasaRecuperacionCarteraVencida: number; pctPaseRiesgo?: number | null; pctPrecancelacion?: number; pctPrecancelacionVencida?: number;
    tasaInteresAnual: number; ratioProvision: number;
    provisionAnterior?: number; pctProvisionObjetivo?: number; pctProvisionInicial?: number; pctProvisionFinal?: number;
    provisionGradual?: boolean; provisionSinReversiones?: boolean;
  };
}

function filasVaciasCredito(): FilaCredito[] {
  const filas: FilaCredito[] = [];
  for (const l of LINEAS) {
    for (let mes = 1; mes <= 12; mes++) {
      filas.push({
        linea: l.id, mes, tasa_interes_anual: 0, pct_recuperacion_periodo: 0,
        tasa_efectividad_recup: 0, tasa_recuperacion_vencida: 0, pct_distribucion: null, pct_pase_riesgo: null, pct_precancelacion: null, pct_precancelacion_vencida: null,
        monto_promedio: 0, num_operaciones_conceder: 0,
      });
    }
  }
  return filas;
}

// =====================================================================
// SERIES: una línea o las 4 sumadas
// =====================================================================

// Producción (N° de operaciones) que calcula /api/cartera-credito con lib/calc/produccion.ts
interface ProduccionMes {
  mes: number; operacionesIniciales: number; operacionesAConceder: number; creditosCancelados: number; creditosAlFin: number;
  oficialesRequeridos: number | null; montoPromedio: number | null; pctCrecimientoAcumulado: number | null;
}
interface EntradasProduccion {
  asesoresActivos: number; minimoOperaciones: number;
  parametros: Record<Linea, { operacionesIniciales: number; creditosPorOficial: number }>;
}

interface Series {
  pvSI: number[]; prestamos: number[]; recuperacion: number[]; precancelaciones: number[]; pasoRiesgo: number[]; pvSF: number[];
  rSI: number[]; rIncremento: number[]; rRecuperacion: number[]; rPrecancelaciones: number[]; rCastigos: number[]; rSF: number[];
  provision: number[]; ingreso: number[]; neta: number[]; morosidad: number[]; cobertura: number[];
}

function construirSeries(datos: Record<Linea, DetalleMesLinea[]>, filtro: Filtro): Series {
  const lineas = filtro === "TODAS" ? LINEAS.map((l) => l.id) : [filtro];
  const s = (fn: (f: DetalleMesLinea) => number) =>
    MESES.map((_, i) => lineas.reduce((acc, l) => acc + (datos[l]?.[i] ? fn(datos[l][i]) : 0), 0));
  const pvSF = s((f) => f.porVencer.saldoFinal);
  const rSF = s((f) => f.enRiesgo.saldoFinal);
  const provision = s((f) => f.provision);
  return {
    pvSI: s((f) => f.porVencer.saldoInicial),
    prestamos: s((f) => f.porVencer.prestamosAConceder),
    recuperacion: s((f) => f.porVencer.cuotasCobradas ?? f.porVencer.recuperacionPrestamos),
    precancelaciones: s((f) => f.porVencer.precancelaciones ?? 0),
    pasoRiesgo: s((f) => -f.porVencer.incrementosRiesgo),
    pvSF,
    rSI: s((f) => f.enRiesgo.saldoInicial),
    rIncremento: s((f) => f.enRiesgo.incrementosRiesgo),
    rRecuperacion: s((f) => -(f.enRiesgo.recuperacionNeta ?? f.enRiesgo.recuperacionRiesgo)),
    rPrecancelaciones: s((f) => -(f.enRiesgo.precancelaciones ?? 0)),
    rCastigos: s((f) => -(f.enRiesgo.castigos ?? 0)),
    rSF,
    provision,
    ingreso: s((f) => f.ingresoPorInteres),
    neta: MESES.map((_, i) => pvSF[i] + rSF[i] + provision[i]),
    morosidad: MESES.map((_, i) => (pvSF[i] + rSF[i] ? rSF[i] / (pvSF[i] + rSF[i]) : 0)),
    cobertura: MESES.map((_, i) => (rSF[i] ? Math.abs(provision[i]) / rSF[i] : 0)),
  };
}

// =====================================================================
// PIEZAS COMUNES
// =====================================================================

/** Selector limpio: marco fino en blanco y la opción elegida en verde suave con texto verde. */
function Pastillas<T extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap p-[3px] gap-0.5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => {
        const on = valor === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on}
                  className="h-8 px-3.5 rounded-md text-[13px] transition-colors"
                  style={on
                    ? { background: "#E3EEE7", color: C.acento, fontWeight: 600 }
                    : { background: "transparent", color: C.texto2 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Segmentado<T extends string>(props: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return <Pastillas {...props} />;
}

function ChipsMes({ valor, onChange }: { valor: number; onChange: (i: number) => void }) {
  return (
    <div role="group" aria-label="Mes de la fórmula" className="flex flex-wrap gap-0.5">
      {MESES.map((m, i) => (
        <button key={m} type="button" onClick={() => onChange(i)} aria-pressed={valor === i}
                className="w-[31px] h-[23px] rounded text-[11px] font-semibold"
                style={valor === i ? CHIP_ON : CHIP_OFF}>
          {m}
        </button>
      ))}
    </div>
  );
}

// =====================================================================
// PÁGINA
// =====================================================================

export default function CarteraCreditoPage() {
  const guardia = useGuardiaCambios();
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("detalle");
  const [vistaMetas, setVistaMetas] = useState<VistaMetas>("asesores");
  const [filtro, setFiltro] = useState<Filtro>("TODAS");
  const [vistaDetalle, setVistaDetalle] = useState<VistaDetalle>("cartera");
  const [version, setVersion] = useState(0); // sube al guardar parámetros para recalcular el detalle
  const ticketSync = useEscucharSincronizacion();

  const consolidado = agencia === "Consolidado"; // suma de las 10 agencias: solo lectura, sin parámetros
  // Metas y Tasas son parámetros por agencia: en Consolidado no se muestran (Provisión sí: muestra todas las agencias)
  useEffect(() => { if (consolidado && (pestana === "metas" || pestana === "tasas")) setPestana("detalle"); }, [consolidado, pestana]);
  const url = `/api/cartera-credito?agencia=${encodeURIComponent(agencia)}`;
  const resp = useDatos<{ detalle: Record<Linea, DetalleMesLinea[]>; produccion?: Record<Linea, ProduccionMes[]>; entradasProduccion?: EntradasProduccion; relacionMora?: number; interesMoraPorMes?: number[]; factorVencida?: number; precancelacionReal?: { q: number; qv: number } | null }>(
    url, version + ticketSync, (d) => (d.detalle ? null : "No se pudo calcular la cartera."),
  );
  // Mientras se ve el Detalle, se piden por adelantado las demás pestañas: al cambiar de pestaña ya están.
  useEffect(() => {
    if (!resp.datos || agencia === "Consolidado") return; // en Consolidado no hay parámetros que precargar
    const a = encodeURIComponent(agencia);
    precargar([
      `/api/oficiales-credito?agencia=${a}`, "/api/metas-credito-institucional", `/api/parametros-credito?agencia=${a}`,
      `/api/parametros-produccion?agencia=${a}`, `/api/parametros-provision?agencia=${a}`,
    ]);
  }, [agencia, resp.datos]);
  const datos = resp.datos?.detalle ?? null;
  const produccion = resp.datos?.produccion ?? null;
  const entradasProd = resp.datos?.entradasProduccion ?? null;
  const relacionMora = resp.datos?.relacionMora ?? 0.05;
  const interesMoraPorMes = resp.datos?.interesMoraPorMes;
  const { cargando, actualizando, error } = resp;


  const series = useMemo(() => (datos ? construirSeries(datos, filtro) : null), [datos, filtro]);
  const grupos = useMemo(() => (datos && series
    ? filasDeVista(vistaDetalle, { series, datos, filtro, consolidado, relacionMora, interesMoraPorMes, produccion, entradas: entradasProd })
    : []), [vistaDetalle, series, datos, filtro, consolidado, relacionMora, interesMoraPorMes, produccion, entradasProd]);
  const nombreFiltro = filtro === "TODAS" ? "todas las líneas" : NOMBRE_LINEA[filtro];


  const tabs: { id: Pestana; label: string }[] = [
    { id: "detalle", label: "Detalle" },
    { id: "metas", label: "Metas" },
    { id: "tasas", label: "Tasas y recuperación" },
    { id: "provision", label: "Provisión" },
    { id: "analisis", label: "Análisis" },
  ];
  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50";
  const conFiltro = pestana === "detalle" || pestana === "analisis";
  const filtroLinea = (
    <Pastillas etiqueta="Línea de crédito" valor={filtro} onChange={setFiltro}
               opciones={[{ id: "TODAS" as Filtro, label: "Todas" }, ...LINEAS.map((l) => ({ id: l.id as Filtro, label: l.label }))]} />
  );

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>

      {/* Encabezado: título a la izquierda; Anexo PDF y Exportar a la derecha */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Cartera de crédito<AnioEjercicio /></h1>
        <Actualizando visible={actualizando} />
        {!consolidado && (
          <a href={`/reportes/cartera?agencia=${encodeURIComponent(agencia)}`} title="Anexo impreso de cartera (PDF)"
             className={accion} style={{ color: C.acento }}>
            <Printer size={16} /> Anexo PDF
          </a>
        )}
        {conFiltro && (
          <button type="button" onClick={() => void exportarPantalla()} disabled={!series} title="Exportar a Excel" className={accion} style={{ color: C.acento }}>
            <Download size={16} /> Exportar
          </button>
        )}
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha, en la misma línea */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones de cartera" className="flex gap-7 flex-1">
          {tabs.filter((t) => !(consolidado && (t.id === "metas" || t.id === "tasas"))).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={pestana === t.id} onClick={() => { if (t.id !== pestana) guardia.pedir(() => setPestana(t.id)); }}
                    className="pt-2 pb-2.5 -mb-px text-[13px]"
                    style={{ color: pestana === t.id ? C.acento : C.texto2, fontWeight: pestana === t.id ? 600 : 400, borderBottom: `2px solid ${pestana === t.id ? C.acento : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => { const a = e.target.value; guardia.pedir(() => setAgencia(a)); }}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white"
                  style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />
      {guardia.dialogo}

      {/* Indicadores: tarjetas separadas, solo en Detalle y Análisis */}
      {series && conFiltro && (() => {
        const bruta0 = series.pvSI[0] + series.rSI[0];
        const brutaD = series.pvSF[11] + series.rSF[11];
        const crec = bruta0 ? brutaD / bruta0 - 1 : null;
        const colocAnio = suma(series.prestamos);
        const mD = series.morosidad[11], m0 = series.morosidad[0];
        const cD = series.cobertura[11];
        const items = [
          { t: `Cartera bruta dic-${ejercicioEnUso()}`, v: usd(brutaD), sub: crec === null ? "—" : `Crecimiento en el año: ${pct(crec, 1)}`, c: C.texto2, b: false },
          { t: "Colocación del año", v: usd(colocAnio), sub: `${usd(colocAnio / 12)} al mes`, c: C.texto2, b: false },
          // Morosidad: bajar es bueno (verde); por encima del umbral se marca en rojo
          { t: `Morosidad dic-${ejercicioEnUso()}`, v: pct(mD), sub: `${mD <= m0 ? "Baja" : "Sube"} desde ${pct(m0)} en enero`,
            c: mD >= MOROSIDAD_ALERTA && mD > m0 ? C.alerta : mD <= m0 ? C.ok : C.aviso, b: true },
          { t: `Cobertura de provisión dic-${ejercicioEnUso()}`, v: pct(cD), sub: `${cD >= COBERTURA_OK ? "Sobre" : "Bajo"} la meta de ${pct(COBERTURA_OK, 0)}`,
            c: cD >= COBERTURA_OK ? C.ok : cD >= COBERTURA_AVISO ? C.aviso : C.alerta, b: true },
        ];
        return (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {items.map((k) => (
              <div key={k.t} className="tarjeta px-5 py-4 flex flex-col gap-1">
                <span className="text-[12px]" style={{ color: C.texto2 }}>{k.t}</span>
                <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{k.v}</span>
                <span className="text-[12px]" style={{ color: k.c, fontWeight: k.b ? 600 : 400 }}>{k.sub}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {/* Filtro de línea debajo de las tarjetas: las tarjetas quedan en el mismo sitio que en las demás secciones */}
      {conFiltro && datos && <div className="self-start">{filtroLinea}</div>}

      {consolidado && (pestana === "metas" || pestana === "tasas") ? null : pestana === "metas" ? (
        <div className="flex flex-col gap-5">
          <ParametrosColocacion key="metas" agencia={agencia} onGuardado={() => setVersion((v) => v + 1)} seccion="colocacion"
            vistaMetas={vistaMetas} onVistaMetas={setVistaMetas} />
          {/* Se mantiene montada (oculta) para no perder lo que se esté editando al cambiar de botón */}
          <div className={vistaMetas === "produccion" ? "" : "hidden"}>
            <ParametrosProduccion key={agencia} agencia={agencia} entradas={entradasProd} onGuardado={() => setVersion((v) => v + 1)}
              vistaMetas={vistaMetas} onVistaMetas={setVistaMetas} />
          </div>
        </div>
      ) : pestana === "tasas" ? (
        <ParametrosColocacion key="tasas" agencia={agencia} onGuardado={() => setVersion((v) => v + 1)} seccion="recuperacion" cartera={resp.datos} />
      ) : pestana === "provision" ? (
        <ProvisionFlowParametros agencia={agencia} onGuardado={() => setVersion((v) => v + 1)} />
      ) : cargando ? (
        <EsqueletoTabla indicadores={false} filas={10} />
      ) : error ? (
        <p className="text-sm" style={{ color: C.alerta }}>{error}</p>
      ) : datos && series ? (
        pestana === "detalle"
          ? <Detalle vista={vistaDetalle} onVista={setVistaDetalle} grupos={grupos} />
          : <Analisis series={series} nombre={nombreFiltro} />
      ) : null}
    </div>
  );
}

// =====================================================================
// DETALLE DE CARTERA
// =====================================================================

type TipoTotal = "inicio" | "fin" | "suma";
interface DefFila {
  label: string; valores: number[]; total: TipoTotal; clave?: boolean; color?: "ok" | "alerta";
  formula?: (i: number) => string;
  fmt?: (v: number) => string;   // formato propio (decimales, %, $); por defecto número entero
  totalValor?: number | null;    // total propio (ej. monto promedio del año)
  total2?: boolean;              // fila de total de la vista (cartera bruta, 5104): fondo suave
}

/** Producción de la línea elegida o la suma de las 4 (en "Todas"). */
function produccionDe(produccion: Record<Linea, ProduccionMes[]>, datos: Record<Linea, DetalleMesLinea[]>, filtro: Filtro) {
  const lineas = filtro === "TODAS" ? LINEAS.map((l) => l.id) : [filtro];
  const sumaMes = (fn: (p: ProduccionMes) => number | null) => MESES.map((_, i) => lineas.reduce((a, l) => a + (fn(produccion[l][i]) ?? 0), 0));
  const prestamos = MESES.map((_, i) => lineas.reduce((a, l) => a + datos[l][i].porVencer.prestamosAConceder, 0));
  const pvSF = MESES.map((_, i) => lineas.reduce((a, l) => a + datos[l][i].porVencer.saldoFinal, 0));
  const pvSI0 = lineas.reduce((a, l) => a + datos[l][0].porVencer.saldoInicial, 0);
  const aConceder = sumaMes((p) => p.operacionesAConceder);
  return {
    iniciales: sumaMes((p) => p.operacionesIniciales),
    aConceder,
    cancelados: sumaMes((p) => p.creditosCancelados),
    alFin: sumaMes((p) => p.creditosAlFin),
    oficiales: sumaMes((p) => p.oficialesRequeridos),
    hayOficiales: lineas.some((l) => produccion[l].some((p) => p.oficialesRequeridos !== null)),
    montoPromedio: MESES.map((_, i) => (aConceder[i] > 0 ? prestamos[i] / aConceder[i] : 0)),
    montoPromedioAnio: suma(aConceder) > 0 ? suma(prestamos) / suma(aConceder) : null,
    crecimiento: pvSF.map((v) => (pvSI0 > 0 ? v / pvSI0 - 1 : 0)),
    prestamos, pvSF, pvSI0,
  };
}

type VistaDetalle = "cartera" | "provision" | "intereses" | "produccion";
const VISTAS_DETALLE: { id: VistaDetalle; label: string; titulo: string }[] = [
  { id: "cartera", label: "Cartera", titulo: "Cartera de créditos · 14" },
  { id: "provision", label: "Provisión", titulo: "Provisión de cartera · 1499" },
  { id: "intereses", label: "Intereses", titulo: "Intereses ganados de cartera · 5104" },
  { id: "produccion", label: "Producción", titulo: "Producción · número de operaciones" },
];

/** Grupo de filas de una vista: título opcional (sin cifras) y sus filas en orden del movimiento. */
/** codigos: cuentas contables que suman el grupo (informativo; se ven con el botón # de la cabecera). */
interface GrupoFilas { titulo?: string; codigos?: string[]; filas: DefFila[] }

/** Filas de la vista elegida. También las usa Exportar, así el CSV sale igual a lo que se ve. */
function filasDeVista(vista: VistaDetalle, a: {
  series: Series; datos: Record<Linea, DetalleMesLinea[]>; filtro: Filtro; consolidado: boolean; relacionMora: number; interesMoraPorMes?: number[];
  produccion: Record<Linea, ProduccionMes[]> | null; entradas: EntradasProduccion | null;
}): GrupoFilas[] {
  const { series, datos, filtro, consolidado, relacionMora, interesMoraPorMes, produccion, entradas } = a;
  const lineas = filtro === "TODAS" ? LINEAS.map((l) => l.id) : [filtro];
  const una = filtro === "TODAS" ? null : filtro;
  const f = (i: number) => (una ? datos[una][i] : undefined);
  const conFormula = !!una && !consolidado; // en "Todas" y en Consolidado no hay una sola tasa por mes
  const sumaL = (fn: (x: DetalleMesLinea, i: number) => number) => MESES.map((_, i) => lineas.reduce((t, l) => t + (datos[l]?.[i] ? fn(datos[l][i], i) : 0), 0));
  const bruta = MESES.map((_, i) => series.pvSF[i] + series.rSF[i]);
  // códigos contables de la línea elegida (en "Todas" no se muestran: serían las cuentas de las 4 líneas)
  const cods = (lista: string[] | undefined) => (una && lista?.length ? lista : undefined);

  if (vista === "cartera") {
    return [
      {
        titulo: "Cartera por vencer", codigos: cods(una ? CODIGOS_CARTERA[una].porVencer : undefined),
        filas: [
          { label: "Saldo inicial", valores: series.pvSI, total: "inicio" },
          { label: "(+) Préstamos a conceder", valores: series.prestamos, total: "suma",
            formula: conFormula ? (i) => `Meta de colocación de la agencia × % de cumplimiento × % de distribución de esta línea: ${usd(f(i)!.tasas.metaColocacionAgencia)} × ${pct(f(i)!.tasas.cumplimientoColocacion ?? 1)} × ${pct(f(i)!.tasas.pctDistribucion)} = ${usd(f(i)!.porVencer.prestamosAConceder)}.` : undefined },
          { label: "(−) Recuperación de cartera por vencer (cuotas)", valores: series.recuperacion, total: "suma",
            formula: conFormula ? (i) => `Saldo inicial × % de recuperación por período × % de recuperación de cartera por vencer (solo lo neto recuperado): ${usd(f(i)!.porVencer.saldoInicial)} × ${pct(f(i)!.tasas.pctRecuperacionPeriodo)} × ${pct(f(i)!.tasas.tasaEfectividadRecuperacion)} = ${usd(Math.abs(f(i)!.porVencer.cuotasCobradas ?? f(i)!.porVencer.recuperacionPrestamos))}.` : undefined },
          { label: "(−) Precancelaciones con dinero", valores: series.precancelaciones, total: "suma",
            formula: conFormula ? (i) => `Saldo inicial × % de precancelaciones con dinero: ${usd(f(i)!.porVencer.saldoInicial)} × ${pct(f(i)!.tasas.pctPrecancelacion ?? 0)} = ${usd(Math.abs(f(i)!.porVencer.precancelaciones ?? 0))}. Los refinanciamientos, reestructurados y novaciones no se restan: cancelan y vuelven a colocar el mismo saldo.` : undefined },
          { label: "(−) Pase a cartera en riesgo", valores: series.pasoRiesgo, total: "suma",
            formula: conFormula ? (i) => (f(i)!.tasas.pctPaseRiesgo ?? null) !== null
              ? `Saldo inicial × % de pase a cartera en riesgo: ${usd(f(i)!.porVencer.saldoInicial)} × ${pct(f(i)!.tasas.pctPaseRiesgo ?? 0)} = ${usd(f(i)!.porVencer.incrementosRiesgo)}.`
              : `Saldo inicial × % de recuperación × (1 − % de recuperación de cartera por vencer), la parte que no se recupera a tiempo: ${usd(f(i)!.porVencer.saldoInicial)} × ${pct(f(i)!.tasas.pctRecuperacionPeriodo)} × ${pct(1 - f(i)!.tasas.tasaEfectividadRecuperacion)} = ${usd(f(i)!.porVencer.incrementosRiesgo)}.` : undefined },
          { label: "Saldo final", valores: series.pvSF, total: "fin", clave: true },
        ],
      },
      {
        titulo: "Cartera en riesgo", codigos: cods(una ? CODIGOS_CARTERA[una].enRiesgo : undefined),
        filas: [
          { label: "Saldo inicial", valores: series.rSI, total: "inicio" },
          { label: "(+) Pase desde cartera por vencer", valores: series.rIncremento, total: "suma" },
          { label: "(−) Recuperación de cartera vencida", valores: series.rRecuperacion, total: "suma",
            formula: conFormula ? (i) => `Saldo inicial en riesgo × % de recuperación sobre el saldo (solo lo neto recuperado; el % del presupuesto es sobre las cuotas vencidas, como el reporte): ${usd(f(i)!.enRiesgo.saldoInicial)} × ${pct(f(i)!.tasas.tasaRecuperacionCarteraVencida)} = ${usd(f(i)!.enRiesgo.recuperacionNeta ?? f(i)!.enRiesgo.recuperacionRiesgo)}.` : undefined },
          ...(series.rPrecancelaciones.some((v) => Math.abs(v) >= 0.5) ? [{ label: "(−) Precancelaciones con dinero", valores: series.rPrecancelaciones, total: "suma" as TipoTotal,
            formula: conFormula ? (i: number) => `Saldo inicial en riesgo × % real de precancelaciones de cartera vencida × el mismo margen de la cartera por vencer: ${usd(f(i)!.enRiesgo.saldoInicial)} × ${pct(f(i)!.tasas.pctPrecancelacionVencida ?? 0)} = ${usd(f(i)!.enRiesgo.precancelaciones ?? 0)}.` : undefined }] : []),
          ...(series.rCastigos.some((v) => Math.abs(v) >= 0.5) ? [{ label: "(−) Castigos", valores: series.rCastigos, total: "suma" as TipoTotal,
            formula: (i: number) => `Castigos del modelo de provisión por tramos (salen del tramo E: más de 120 días; inmobiliario más de 450): ${usd(-series.rCastigos[i])}. Bajan la cartera y la provisión por el mismo monto. El monto mensual se edita en la pestaña Provisión.` }] : []),
          { label: "Saldo final", valores: series.rSF, total: "fin", clave: true },
        ],
      },
      {
        filas: [
          { label: "Cartera bruta", valores: bruta, total: "fin", clave: true, total2: true,
            formula: (i) => `Cartera por vencer + cartera en riesgo: ${usd(series.pvSF[i])} + ${usd(series.rSF[i])} = ${usd(bruta[i])}.` },
        ],
      },
    ];
  }

  if (vista === "provision") {
    // Provisión en positivo: saldo inicial + provisión del mes (gasto 4402) = saldo final
    const fin = sumaL((x) => Math.abs(x.provision));
    const ini = sumaL((x, i) => (i === 0 ? x.tasas.provisionAnterior ?? 0 : 0)).map((v, i) => (i === 0 ? v : fin[i - 1]));
    // Castigos (modelo por tramos): consumen provisión. Gasto neto = variación + castigos.
    const castigos = sumaL((x) => x.enRiesgo.castigos ?? 0);
    const hayCastigos = castigos.some((v) => Math.abs(v) >= 0.5);
    const gasto = MESES.map((_, i) => fin[i] - ini[i] + castigos[i]);
    return [
      {
        titulo: "Movimiento de la provisión", codigos: cods(una ? CODIGOS_PROVISION_CARTERA[una] : undefined),
        filas: [
          { label: "Saldo inicial", valores: ini, total: "inicio",
            formula: (i) => (i === 0 ? `Provisión del balance de partida${una ? ` de ${NOMBRE_LINEA[una]}` : ""} = ${usd(ini[0])}.` : `Saldo final de ${MESES[i - 1]} = ${usd(ini[i])}.`) },
          { label: hayCastigos ? "(+) Gasto neto del mes · 4402 − 5604.10" : "(+) Provisión del mes · gasto 4402", valores: gasto, total: "suma",
            formula: (i) => hayCastigos
              ? `Provisión del modelo por tramos del mes − la del mes anterior + castigos = ${usd(gasto[i])}. Si es positivo va a 4402; si es negativo, a 5604.10 (reversión). El detalle está en Provisiones.`
              : `Provisión requerida del mes − saldo inicial: ${usd(fin[i])} − ${usd(ini[i])} = ${usd(gasto[i])}. Es el gasto que va a Provisiones (4402) en el Estado de resultados.` },
          ...(hayCastigos ? [{ label: "(−) Castigos", valores: castigos.map((v) => -v), total: "suma" as TipoTotal,
            formula: (i: number) => `Castigos del mes (tramo E): ${usd(castigos[i])}. Bajan la provisión y la cartera en riesgo por el mismo monto.` }] : []),
          { label: "Saldo final", valores: fin, total: "fin", clave: true,
            formula: hayCastigos
              ? (i) => `Saldo inicial + gasto neto − castigos = ${usd(ini[i])} + ${usd(gasto[i])} − ${usd(castigos[i])} = ${usd(fin[i])}. Es la provisión por tramos del modelo más la provisión no explicada por tramos del balance de partida (constante).`
              : conFormula ? (i) => `Cartera bruta × % de provisión del mes: ${usd(bruta[i])} × ${pct(f(i)!.tasas.ratioProvision)} = ${usd(fin[i])}.` : (i) => `Suma de las 4 líneas (cartera bruta de cada línea × su % de provisión) = ${usd(fin[i])}.` },
        ],
      },
      {
        titulo: "Cartera neta",
        filas: [
          { label: "Cartera bruta", valores: bruta, total: "fin" },
          { label: "(−) Provisión", valores: fin.map((v) => -v), total: "fin" },
          { label: "Cartera neta", valores: series.neta, total: "fin", clave: true,
            formula: (i) => `Cartera bruta − provisión: ${usd(bruta[i])} − ${usd(fin[i])} = ${usd(series.neta[i])}.` },
        ],
      },
    ];
  }

  if (vista === "intereses") {
    const normal = series.ingreso;
    // todas las líneas: el valor del motor (en el Consolidado, la suma de cada agencia con su %); una línea: su interés × %
    const mora = !una && interesMoraPorMes?.length === 12 ? interesMoraPorMes : normal.map((v) => v * relacionMora);
    const total = normal.map((v, i) => v + mora[i]);
    const formulaLinea = (l: Linea) => (i: number) => {
      const x = datos[l][i];
      return `Promedio del saldo por vencer (inicial y final) × tasa anual ÷ 12: promedio(${usd(x.porVencer.saldoInicial)}, ${usd(x.porVencer.saldoFinal)}) × ${pct(x.tasas.tasaInteresAnual)} ÷ 12 = ${usd(x.ingresoPorInteres)}.`;
    };
    const filasNormal: DefFila[] = una
      ? [{ label: "Interés normal", valores: normal, total: "suma", formula: consolidado ? undefined : formulaLinea(una) }]
      : LINEAS.map((l) => ({ label: `Interés normal · ${l.label}`, valores: datos[l.id].map((x) => x.ingresoPorInteres), total: "suma" as TipoTotal,
          formula: consolidado ? undefined : formulaLinea(l.id) }));
    return [
      {
        filas: [
          ...filasNormal,
          { label: "(+) Interés de mora", valores: mora, total: "suma",
            formula: (i) => consolidado ? `Suma del interés de mora de las agencias (cada una: interés normal × su % de interés de mora). ${usd(mora[i])}.`
              : `Interés normal × interés de mora de la agencia (Planificación → Cartera → Supuestos): ${usd(normal[i])} × ${pct(relacionMora)} = ${usd(mora[i])}.` },
          { label: "Intereses ganados · 5104", valores: total, total: "suma", clave: true, total2: true,
            formula: (i) => `Interés normal + interés de mora = ${usd(normal[i])} + ${usd(mora[i])} = ${usd(total[i])}. Es lo que va a la cuenta 5104 de Proyección de ingresos y del Estado de resultados (allí se muestra acumulado en el año).` },
        ],
      },
    ];
  }

  // Producción: N° de operaciones (informativo)
  if (!produccion || !entradas) return [];
  const pr = produccionDe(produccion, datos, filtro);
  const par = una ? entradas.parametros[una] : null;
  const entero = (v: number) => Math.round(v).toLocaleString("es-EC");
  const sumaAg = (v: number) => `Suma de las agencias = ${entero(v)}.`;
  const faltaIni = pr.iniciales[0] === 0 ? (consolidado ? " Ninguna agencia tiene registradas las operaciones vigentes al corte." : " Falta el N° de operaciones vigentes al corte: escríbelo en Metas → Producción.") : "";
  return [
    {
      filas: [
        { label: "N° operaciones iniciales", valores: pr.iniciales, total: "inicio", fmt: entero,
          formula: (i) => (i === 0
            ? `Enero: créditos vigentes al corte${una ? ` en ${NOMBRE_LINEA[una]}` : ""} = ${entero(pr.iniciales[0])}.${faltaIni}`
            : `Créditos al fin de ${MESES[i - 1]} = ${entero(pr.iniciales[i])}.`) },
        { label: "(+) Operaciones a conceder", valores: pr.aConceder, total: "suma", fmt: entero,
          formula: (i) => consolidado ? sumaAg(pr.aConceder[i]) : una
            ? `Asesores activos × mínimo de operaciones por asesor × % de colocación de ${NOMBRE_LINEA[una]} = ${entradas.asesoresActivos} × ${entradas.minimoOperaciones} × ${pct(datos[una][i].tasas.pctDistribucion)} = ${entero(pr.aConceder[i])}.`
            : `Suma de las 4 líneas = ${entero(pr.aConceder[i])}.` },
        { label: "(−) Créditos cancelados", valores: pr.cancelados.map((v) => -v), total: "suma", fmt: (v) => (v < 0 ? `(${entero(Math.abs(v))})` : entero(v)),
          formula: (i) => consolidado ? sumaAg(pr.cancelados[i]) : una
            ? `Operaciones iniciales × % de recuperación del período = ${entero(pr.iniciales[i])} × ${pct(datos[una][i].tasas.pctRecuperacionPeriodo)} = ${entero(pr.cancelados[i])}.`
            : `Suma de las 4 líneas = ${entero(pr.cancelados[i])}.` },
        { label: "N° créditos al fin del período", valores: pr.alFin, total: "fin", clave: true, fmt: entero,
          formula: (i) => `Iniciales + a conceder − cancelados = ${entero(pr.iniciales[i])} + ${entero(pr.aConceder[i])} − ${entero(pr.cancelados[i])} = ${entero(pr.alFin[i])}.` },
      ],
    },
    {
      filas: [
        { label: "N° oficiales requeridos", valores: pr.hayOficiales ? pr.oficiales : Array(12).fill(0), total: "fin",
          fmt: (v) => v.toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          formula: (i) => consolidado ? `Suma de las agencias = ${pr.oficiales[i].toFixed(1).replace(".", ",")}.` : una
            ? (par && par.creditosPorOficial > 0
              ? `Créditos al fin ÷ créditos que administra un oficial = ${entero(pr.alFin[i])} ÷ ${entero(par.creditosPorOficial)} = ${pr.oficiales[i].toFixed(1).replace(".", ",")}.`
              : "Falta cuántos créditos administra un oficial: escríbelo en Metas → Producción.")
            : `Suma de las 4 líneas = ${pr.oficiales[i].toFixed(1).replace(".", ",")}.` },
        { label: "Monto promedio por operación", valores: pr.montoPromedio, total: "suma", totalValor: pr.montoPromedioAnio, fmt: (v) => usd(v),
          formula: (i) => `Préstamos a conceder ÷ operaciones a conceder = ${usd(pr.prestamos[i])} ÷ ${entero(pr.aConceder[i])} = ${usd(pr.montoPromedio[i])}. En la columna Año, el promedio de todo el año.` },
      ],
    },
  ];
}

function Detalle({ vista, onVista, grupos }: { vista: VistaDetalle; onVista: (v: VistaDetalle) => void; grupos: GrupoFilas[] }) {
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);
  const [mesFormula, setMesFormula] = useState(11);
  const [verCodigos, cambiarCodigos] = useMostrarCodigos();
  const G = "grid grid-cols-[minmax(230px,2.6fr)_repeat(13,minmax(0,1fr))_26px] items-center";

  function Fila({ fila, id }: { fila: DefFila; id: string }) {
    const abierta = filaAbierta === id;
    const totalV = fila.totalValor !== undefined ? (fila.totalValor ?? 0) : fila.total === "inicio" ? fila.valores[0] : fila.total === "fin" ? fila.valores[11] : suma(fila.valores);
    const fuerte = !!fila.clave;
    // Un solo criterio de color: lo que resta (negativo) en rojo; lo demás en el tono del texto
    const txt = (v: number) => ((fila.fmt ? Math.abs(v) < 0.0005 : Math.round(v) === 0)
      ? { t: "—", c: C.tenue }
      : { t: fila.fmt ? fila.fmt(v) : numero(v), c: !fuerte && v < 0 ? C.alerta : C.texto });
    const borde = fila.total2 ? "1px solid #B9C3BD" : fila.clave ? "1px solid #B9C3BD" : `1px solid ${C.beige}`;
    return (
      <div>
        <div className={`${G} h-9 hover:bg-[#F5F7F6]`} style={{ borderTop: borde, fontWeight: fuerte ? 600 : 400, background: fila.total2 ? "#F7F9F8" : "#FFFFFF" }}>
          <div className={`${fila.total2 ? "pl-4" : "pl-6"} pr-2 truncate text-[11px]`} title={fila.label} style={{ color: fuerte ? C.texto : C.texto3 }}>{fila.label}</div>
          {fila.valores.map((v, i) => { const x = txt(v); return <div key={i} className="px-1 text-right whitespace-nowrap" style={{ color: x.c }}>{x.t}</div>; })}
          <div className="px-1.5 text-right whitespace-nowrap font-semibold" style={{ color: txt(totalV).c }}>{txt(totalV).t}</div>
          <div className="flex justify-center">
            {fila.formula && (
              <button type="button" onClick={() => setFilaAbierta(abierta ? null : id)} aria-expanded={abierta}
                      aria-label={`Ver cómo se calcula ${fila.label}`} title="Ver cómo se calcula esta fila"
                      className="w-5 h-5 rounded inline-flex items-center justify-center text-[11px] font-mono"
                      style={abierta ? CHIP_ON : { color: C.tenue }}>ƒ</button>
            )}
          </div>
        </div>
        {abierta && fila.formula && (
          <div className="px-10 py-3 flex flex-wrap items-start gap-x-6 gap-y-2" style={{ background: "#F3F5F4", borderTop: `1px solid ${C.beige}` }}>
            <ChipsMes valor={mesFormula} onChange={setMesFormula} />
            <p className="flex-1 min-w-[288px] text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
              <span className="font-semibold" style={{ color: C.acento }}>{MESES[mesFormula]} · </span>{fila.formula(mesFormula)}
            </p>
          </div>
        )}
      </div>
    );
  }

  const titulo = VISTAS_DETALLE.find((v) => v.id === vista)!.titulo;
  const hayCodigos = grupos.some((g) => g.codigos?.length);
  return (
    <div className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="flex-1 min-w-[216px] text-[14px] font-semibold">{titulo}</h2>
        <Pastillas etiqueta="Vista del detalle" valor={vista} onChange={(v) => { setFilaAbierta(null); onVista(v); }}
                   opciones={VISTAS_DETALLE.map((v) => ({ id: v.id, label: v.label }))} />
      </div>
      <div className="overflow-x-auto">
        <div className="tabla-cifras min-w-[1062px] text-[11px]">
          <div className={`${G} h-9 text-[11px] font-semibold`} style={{ color: C.texto2, background: "#FFFFFF", borderBottom: "2px solid #DDE2DF" }}>
            <div className="pl-4 pr-2 flex items-center gap-2">
              <span className="flex-1">Concepto</span>
              {hayCodigos && <BotonCodigos ver={verCodigos} onCambiar={cambiarCodigos} />}
            </div>
            {MESES.map((m) => <div key={m} className="px-1 text-right">{m}</div>)}
            <div className="px-1.5 text-right">Año</div>
            <div />
          </div>
          {grupos.length === 0 && <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>Sin datos de producción.</p>}
          {grupos.map((g, gi) => (
            <div key={gi} style={{ paddingTop: gi ? 12 : 0 }}>
              {g.titulo && (
                <div className={`${G} h-9`} style={{ borderTop: gi ? `1px solid ${C.borde}` : "none" }}>
                  <div className="pl-4 text-[12px] font-bold" style={{ color: C.acento }}>{g.titulo}</div>
                  {/* cuentas que suman el grupo, en gris a la derecha del título y solo a pedido */}
                  {verCodigos && g.codigos?.length ? (
                    <div className="col-span-14 px-1 text-[10.5px] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: C.tenue }}
                         title={g.codigos.join(" + ")}>
                      Cuentas: {g.codigos.join(" + ")}
                    </div>
                  ) : null}
                </div>
              )}
              {g.filas.map((fila) => <Fila key={fila.label} fila={fila} id={`${gi}-${fila.label}`} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// GRÁFICOS Y ANÁLISIS
// =====================================================================

function Analisis({ series, nombre }: { series: Series; nombre: string }) {
  const W = 620, H = 210, x0 = 52, x1 = 596, yT = 20, yB = 170;
  const px = (i: number) => x0 + (i * (x1 - x0)) / 11;
  const max = Math.max(...series.pvSF.map((v, i) => v + series.rSF[i]), 1) * 1.08;
  const paso = max > 40e6 ? 10e6 : max > 16e6 ? 5e6 : max > 6e6 ? 2e6 : max > 2e6 ? 1e6 : 500e3;
  const marcas = Array.from({ length: Math.floor(max / paso) + 1 }, (_, k) => k * paso);
  const yv = (v: number) => yB - (Math.max(v, 0) / max) * (yB - yT);

  const todos = [...series.morosidad, ...series.cobertura, COBERTURA_OK];
  const pMin = Math.max(0, Math.min(...todos) - 0.05), pMax = Math.max(...todos) + 0.05;
  const yp = (v: number) => yB - ((v - pMin) / (pMax - pMin)) * (yB - yT);
  const lin = (v: number[]) => v.map((x, i) => `${px(i).toFixed(1)},${yp(x).toFixed(1)}`).join(" ");

  const bruta0 = series.pvSI[0] + series.rSI[0], brutaD = series.pvSF[11] + series.rSF[11];
  const crec = bruta0 ? brutaD / bruta0 - 1 : 0;
  const crecRiesgo = series.rSI[0] ? series.rSF[11] / series.rSI[0] - 1 : 0;
  const cobD = series.cobertura[11];

  return (
    <div className="flex flex-col gap-4">
      {(crecRiesgo > 0 || cobD < COBERTURA_OK) && (
        <div role="note" className="flex items-start gap-3 rounded px-4 py-3 text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
          <AlertTriangle size={18} className="shrink-0 mt-px" />
          <span>
            <strong>La cartera de {nombre} {crec >= 0 ? "crece" : "baja"} {pct(Math.abs(crec), 0)} en el año</strong> ({millones(bruta0)} → {millones(brutaD)}) con {millones(suma(series.prestamos))} colocados.{" "}
            {crecRiesgo > 0 && <>La cartera en riesgo también sube {pct(crecRiesgo, 0)}{series.morosidad[11] < series.morosidad[0] ? "; la morosidad baja solo porque el saldo total crece más rápido" : ""}. </>}
            {cobD < COBERTURA_OK && <>La provisión cubre el {pct(cobD, 0)} del riesgo en diciembre, por debajo del {pct(COBERTURA_OK, 0)}.</>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[180px]">
              <div className="text-[13px] font-semibold">Composición de la cartera</div>
              <div className="text-[12px]" style={{ color: C.texto2 }}>Saldo final de cada mes · {nombre}</div>
            </div>
            <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C.ok }} />Por vencer</span>
            <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C.aviso }} />En riesgo</span>
          </div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cartera por vencer y en riesgo por mes">
            {marcas.map((m) => (
              <g key={m}>
                <line x1={x0} x2={x1} y1={yv(m)} y2={yv(m)} stroke={m === 0 ? C.borde : C.beige} />
                <text x={x0 - 6} y={yv(m) + 3} textAnchor="end" fontSize={10} fill={C.texto2}>{m === 0 ? "0" : `${m / 1e6} M`}</text>
              </g>
            ))}
            {series.pvSF.map((v, i) => (
              <g key={i}>
                <rect x={px(i) - 14} y={yv(v)} width={28} height={yB - yv(v)} rx={3} fill={C.ok} />
                <rect x={px(i) - 14} y={yv(v + series.rSF[i]) - 2} width={28} height={Math.max(yv(v) - yv(v + series.rSF[i]), 0)} rx={3} fill={C.aviso} />
              </g>
            ))}
            {MESES.map((m, i) => i % 2 === 0 && <text key={m} x={px(i)} y={190} textAnchor="middle" fontSize={10} fill={C.texto2}>{m}</text>)}
          </svg>
        </div>

        <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[180px]">
              <div className="text-[13px] font-semibold">Morosidad y cobertura</div>
              <div className="text-[12px]" style={{ color: C.texto2 }}>Evolución mensual · {nombre}</div>
            </div>
            <span className="flex items-center gap-1.5 text-[11px]"><span className="w-3.5 h-[3px]" style={{ background: C.alerta }} />Morosidad</span>
            <span className="flex items-center gap-1.5 text-[11px]"><span className="w-3.5 h-[3px]" style={{ background: C.ok }} />Cobertura</span>
          </div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Morosidad y cobertura de provisión por mes">
            <line x1={x0} x2={x1} y1={yB} y2={yB} stroke={C.borde} />
            <line x1={x0} x2={x1} y1={yp(COBERTURA_OK)} y2={yp(COBERTURA_OK)} stroke={C.ok} strokeDasharray="4 4" />
            <text x={x1} y={yp(COBERTURA_OK) - 5} textAnchor="end" fontSize={10} fill={C.ok}>meta de cobertura {pct(COBERTURA_OK, 0)}</text>
            <polyline points={lin(series.cobertura)} fill="none" stroke={C.ok} strokeWidth={2.2} strokeLinejoin="round" />
            <polyline points={lin(series.morosidad)} fill="none" stroke={C.alerta} strokeWidth={2.2} strokeLinejoin="round" />
            <text x={px(0) + 4} y={yp(series.morosidad[0]) - 7} fontSize={10.5} fontWeight={600} fill={C.alerta}>{pct(series.morosidad[0])}</text>
            <text x={px(11)} y={yp(series.morosidad[11]) + 15} textAnchor="end" fontSize={10.5} fontWeight={600} fill={C.alerta}>{pct(series.morosidad[11])}</text>
            <text x={px(0) + 4} y={yp(series.cobertura[0]) + 15} fontSize={10.5} fontWeight={600} fill={C.ok}>{pct(series.cobertura[0], 1)}</text>
            <text x={px(11)} y={yp(series.cobertura[11]) - 7} textAnchor="end" fontSize={10.5} fontWeight={600} fill={C.ok}>{pct(series.cobertura[11], 1)}</text>
            {MESES.map((m, i) => i % 2 === 0 && <text key={m} x={px(i)} y={190} textAnchor="middle" fontSize={10} fill={C.texto2}>{m}</text>)}
          </svg>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// PARÁMETROS: asesores + metas + tasas + distribución
// =====================================================================

type CampoTasa = "tasa_interes_anual" | "pct_recuperacion_periodo" | "tasa_efectividad_recup" | "tasa_recuperacion_vencida" | "pct_pase_riesgo" | "pct_precancelacion" | "pct_precancelacion_vencida";
/** Parámetros de Tasas y recuperación: cada uno con su efecto en dólares del mes (fila de abajo). */
const CAMPOS_TASAS: { key: CampoTasa; label: string; unidad: string; dolar: string; grupo: "porVencer" | "riesgo" }[] = [
  { key: "tasa_interes_anual", label: "Tasa de interés anual (base 360)", unidad: "% anual", dolar: "Intereses ganados", grupo: "porVencer" },
  { key: "pct_recuperacion_periodo", label: "Porcentaje de recuperación por período", unidad: "% del saldo por vencer", dolar: "Cuotas que vencen", grupo: "porVencer" },
  { key: "tasa_efectividad_recup", label: "Tasa de recuperación de cartera por vencer", unidad: "% de las cuotas", dolar: "Cuotas cobradas", grupo: "porVencer" },
  { key: "pct_precancelacion", label: "Precancelación de cartera por vencer", unidad: "% mensual del saldo por vencer", dolar: "Precancelado con dinero", grupo: "porVencer" },
  { key: "pct_pase_riesgo", label: "Pase a cartera en riesgo mensual", unidad: "% mensual del saldo por vencer", dolar: "Pasa a riesgo", grupo: "porVencer" },
  { key: "tasa_recuperacion_vencida", label: "Recuperación de cartera vencida", unidad: "% de las cuotas vencidas del mes", dolar: "Recuperado (neto)", grupo: "riesgo" },
  { key: "pct_precancelacion_vencida", label: "Precancelación de cartera vencida", unidad: "% mensual del saldo en riesgo", dolar: "Precancelado con dinero", grupo: "riesgo" },
];
const VACIABLES = new Set(["pct_pase_riesgo", "pct_precancelacion", "pct_precancelacion_vencida"]);
type RealTasas = { desde: string; hasta: string; lineas: Record<string, Partial<Record<CampoTasa, number | null>>> } | null;
interface CarteraTasas { detalle: Record<Linea, DetalleMesLinea[]>; factorVencida?: number; precancelacionReal?: { q: number; qv: number } | null }

/** Lo que mueve cada parámetro en dólares del mes, con los mismos cálculos del motor (lib/calc/cartera.ts). */
function dolaresTasas(filas: FilaCredito[], det: DetalleMesLinea[], fv: number, pr: { q: number; qv: number } | null): Record<CampoTasa, number[]> {
  const f = (i: number) => filas.find((x) => x.mes === i + 1);
  const n = (v: unknown) => Number(v) || 0;
  const q = Array.from({ length: 12 }, (_, i) => n(f(i)?.pct_precancelacion));
  const r = calcularLineaCartera(det[0].porVencer.saldoInicial, det[0].enRiesgo.saldoInicial, {
    tasaInteresAnual: Array.from({ length: 12 }, (_, i) => n(f(i)?.tasa_interes_anual)),
    pctRecuperacionPeriodo: Array.from({ length: 12 }, (_, i) => n(f(i)?.pct_recuperacion_periodo)),
    tasaEfectividadRecuperacion: Array.from({ length: 12 }, (_, i) => n(f(i)?.tasa_efectividad_recup)),
    tasaRecuperacionCarteraVencida: Array.from({ length: 12 }, (_, i) => n(f(i)?.tasa_recuperacion_vencida) * fv),
    prestamosAConceder: det.map((d) => d.porVencer.prestamosAConceder),
    pctPaseRiesgo: Array.from({ length: 12 }, (_, i) => { const v = f(i)?.pct_pase_riesgo; return v === null || v === undefined ? null : n(v); }),
    pctPrecancelacion: q,
    pctPrecancelacionVencida: Array.from({ length: 12 }, (_, i) => { const v = f(i)?.pct_precancelacion_vencida; return v !== null && v !== undefined ? n(v) : pr ? pr.qv * Math.max(0, Math.min(3, q[i] / pr.q)) : 0; }),
  });
  return {
    tasa_interes_anual: r.ingresoPorInteres,
    pct_recuperacion_periodo: r.porVencer.map((x, i) => x.saldoInicial * n(f(i)?.pct_recuperacion_periodo)),
    tasa_efectividad_recup: r.porVencer.map((x) => Math.abs(Number(x.detalle?.cuotasCobradas) || 0)),
    pct_precancelacion: r.porVencer.map((x) => Math.abs(Number(x.detalle?.precancelaciones) || 0)),
    pct_pase_riesgo: r.porVencer.map((x) => Number(x.detalle?.incrementosRiesgo) || 0),
    tasa_recuperacion_vencida: r.enRiesgo.map((x) => Number(x.detalle?.recuperacionNeta) || 0),
    pct_precancelacion_vencida: r.enRiesgo.map((x) => Number(x.detalle?.precancelaciones) || 0),
  };
}
/** Los mismos valores, tal como los calculó el presupuesto guardado. */
function dolaresGuardados(det: DetalleMesLinea[]): Record<CampoTasa, number[]> {
  return {
    tasa_interes_anual: det.map((d) => d.ingresoPorInteres),
    pct_recuperacion_periodo: det.map((d) => d.porVencer.saldoInicial * d.tasas.pctRecuperacionPeriodo),
    tasa_efectividad_recup: det.map((d) => Math.abs(d.porVencer.cuotasCobradas ?? 0)),
    pct_precancelacion: det.map((d) => Math.abs(d.porVencer.precancelaciones ?? 0)),
    pct_pase_riesgo: det.map((d) => d.porVencer.incrementosRiesgo),
    tasa_recuperacion_vencida: det.map((d) => d.enRiesgo.recuperacionNeta ?? 0),
    pct_precancelacion_vencida: det.map((d) => d.enRiesgo.precancelaciones ?? 0),
  };
}

const distEfectiva = (f: FilaCredito) => f.pct_distribucion ?? PCT_DISTRIBUCION_DEFAULT[f.linea];
const redondeo = (x: number) => Math.round(x * 1e6) / 1e6;

// Cada sección se muestra BLOQUEADA (solo lectura). Para cambiar algo hay que
// presionar "Editar", y los cambios solo se aplican al presionar "Guardar".
// "Cancelar" descarta todo lo que no se guardó.

// =====================================================================
// METAS → PRODUCCIÓN: datos que no salen del balance (tabla parametros_produccion)
// =====================================================================

function ParametrosProduccion({ agencia, entradas, onGuardado, vistaMetas = "produccion", onVistaMetas }: {
  agencia: string; entradas: EntradasProduccion | null; onGuardado: () => void;
  vistaMetas?: VistaMetas; onVistaMetas?: (v: VistaMetas) => void;
}) {
  type Val = Record<Linea, { operacionesIniciales: number; creditosPorOficial: number }>;
  const urlProd = `/api/parametros-produccion?agencia=${encodeURIComponent(agencia)}`;
  const [guardados, setGuardados] = useState<Val | null>(() => obtenerJSONCache<{ parametros?: Val }>(urlProd)?.parametros ?? null);
  const [borrador, setBorrador] = useState<Val | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const ticketSync = useEscucharSincronizacion();

  useEffect(() => {
    let vivo = true;
    cargarJSON<{ error?: string; parametros: Val }>(urlProd,
      (d) => { if (!vivo) return; if (d.error) setMsg({ t: d.error, e: true }); else setGuardados(d.parametros); })
      .catch(() => { if (vivo) setMsg({ t: "Error de conexión.", e: true }); });
    return () => { vivo = false; };
  }, [agencia, version, ticketSync]);

  const hayCambiosProd = editando && !!borrador && !!guardados && LINEAS.some((l) => JSON.stringify(borrador[l.id]) !== JSON.stringify(guardados[l.id]));
  usePendiente(hayCambiosProd ? { descripcion: `Producción de ${agencia}`, descartar: () => { setEditando(false); setBorrador(null); setTextos({}); } } : null);

  if (!guardados) return null;
  const v = editando && borrador ? borrador : guardados;
  const campos: { key: "operacionesIniciales" | "creditosPorOficial"; label: string }[] = [
    { key: "operacionesIniciales", label: "Operaciones vigentes al corte" },
    { key: "creditosPorOficial", label: "Créditos que administra un oficial" },
  ];
  const cambios = editando && borrador ? LINEAS.reduce((n, l) => n + campos.filter((c) => borrador[l.id][c.key] !== guardados[l.id][c.key]).length, 0) : 0;

  async function guardar() {
    if (!borrador) return;
    if (Object.values(textos).some((t) => leerMonto(t).error)) { setMsg({ t: MENSAJE_CAMPOS_CON_ERROR, e: true }); return; }
    if (guardando) return;
    for (const l of LINEAS) {
      const b = borrador[l.id];
      if (!Number.isInteger(b.operacionesIniciales) || b.operacionesIniciales < 0) { setMsg({ t: `${l.label}: las operaciones deben ser un número entero sin negativos.`, e: true }); return; }
      if (b.creditosPorOficial < 0) { setMsg({ t: `${l.label}: los créditos por oficial no pueden ser negativos.`, e: true }); return; }
    }
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/parametros-produccion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencia, lineas: borrador }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `error ${r.status}`);
      setEditando(false); setBorrador(null); setTextos({});
      setMsg({ t: "Producción guardada. El detalle de cartera ya usa estos datos." });
      setVersion((x) => x + 1);
      onGuardado();
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <TarjetaMetas titulo="Producción" vista={vistaMetas} onVista={onVistaMetas} editando={editando}
      botones={<BotonesSeccion editando={editando} cambios={cambios} guardando={guardando}
        onEditar={() => { setBorrador(JSON.parse(JSON.stringify(guardados))); setTextos({}); setEditando(true); setMsg(null); }}
        onCancelar={() => { setEditando(false); setBorrador(null); setTextos({}); }}
        onGuardar={guardar} />}
      avisos={<>
        {editando && <AvisoEdicion texto="Operaciones vigentes: del reporte del sistema a la fecha del corte · créditos por oficial: política de cada línea." />}
        {msg && <Mensaje texto={msg.t} error={msg.e} />}
      </>}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse min-w-[576px]">
          <thead>
            <tr className="text-[12px] font-semibold" style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <th className="pl-4 py-2.5 text-left font-semibold">Línea</th>
              {campos.map((c) => <th key={c.key} className="px-4 py-2.5 text-right font-semibold w-[288px] whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {LINEAS.map((l) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${C.beige}`, height: editando ? 40 : 36 }}>
                <td className="pl-4" style={{ color: C.texto3 }}>{l.label}</td>
                {campos.map((c) => {
                  const k = `${l.id}-${c.key}`;
                  const val = v[l.id][c.key];
                  return (
                    <td key={c.key} className="px-4 text-right">
                      {editando ? (
                        <input value={textos[k] ?? String(val)} inputMode="numeric" aria-label={`${c.label} · ${l.label}`}
                               onChange={(e) => {
                                 const t = e.target.value;
                                 setTextos((x) => ({ ...x, [k]: t }));
                                 const r = leerMonto(t);
                                 if (!r.error && r.valor !== null) setBorrador((b) => (b ? { ...b, [l.id]: { ...b[l.id], [c.key]: r.valor! } } : b));
                               }}
                               onBlur={() => { if (!leerMonto(textos[k] ?? "").error) setTextos((x) => { const n = { ...x }; delete n[k]; return n; }); }}
                               aria-invalid={!!(textos[k] && leerMonto(textos[k]).error)} title={textos[k] ? leerMonto(textos[k]).error ?? undefined : undefined}
                               className="w-[99px] h-7 rounded px-2 text-right text-[12px]" style={textos[k] && leerMonto(textos[k]).error ? { border: "1px solid #B42318", background: "#FDF2F1" } : { border: "1px solid #8DB39B", background: "#FFFFFF" }} />
                      ) : (
                        <span style={{ color: val ? C.texto : C.tenue }}>{val ? val.toLocaleString("es-EC") : "—"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TarjetaMetas>
  );
}

function BotonesSeccion({ editando, cambios, guardando, bloqueoGuardar, discreto, onEditar, onCancelar, onGuardar }: {
  editando: boolean; cambios: number; guardando: boolean; bloqueoGuardar?: boolean; discreto?: boolean;
  onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
}) {
  if (!editando && discreto) {
    return (
      <button type="button" onClick={onEditar}
              className="h-7 px-2 -ml-1 rounded text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#E6EAE8]"
              style={{ color: C.acento }}>
        <Pencil size={12} /> Editar
      </button>
    );
  }
  if (!editando) {
    return (
      <button type="button" onClick={onEditar}
              className="h-8 px-3.5 rounded bg-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F4F5F3]"
              style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>
        <Pencil size={13} /> Editar
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancelar} disabled={guardando}
              className="h-8 px-3.5 rounded bg-white text-[12px] font-semibold disabled:opacity-50"
              style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>
        Cancelar
      </button>
      <button type="button" onClick={onGuardar} disabled={guardando || cambios === 0 || bloqueoGuardar}
              className="h-8 px-3.5 rounded text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: C.acento }}>
        <Check size={13} /> {guardando ? "Guardando..." : cambios ? `Guardar ${cambios} ${cambios === 1 ? "cambio" : "cambios"}` : "Guardar"}
      </button>
    </div>
  );
}

function AvisoEdicion({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
      <Pencil size={13} /> {texto}
    </div>
  );
}

function Mensaje({ texto, error }: { texto: string; error?: boolean }) {
  return <p className="text-[12px]" style={{ color: error ? C.alerta : C.ok }}>{texto}</p>;
}

/** seccion "colocacion" = meta, asesores, metas por rango y distribución por línea · "recuperacion" = tasas y recuperación por línea */
type VistaMetas = "asesores" | "rangos" | "cumplimiento" | "distribucion" | "produccion";
const VISTAS_METAS: { id: VistaMetas; label: string }[] = [
  { id: "asesores", label: "Asesores" }, { id: "rangos", label: "Metas por rango" }, { id: "cumplimiento", label: "Cumplimiento" },
  { id: "distribucion", label: "Distribución por línea" }, { id: "produccion", label: "Producción" },
];

/** Botones de vista con la misma forma que en Inversiones (fondo gris claro, activo en blanco). */
function SelectorVistaMetas({ vista, onVista }: { vista: VistaMetas; onVista: (v: VistaMetas) => void }) {
  return (
    <div role="tablist" aria-label="Vistas de metas" className="flex flex-wrap gap-1 p-1 rounded-lg" style={{ background: "#F3F5F4" }}>
      {VISTAS_METAS.map((v) => (
        <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} onClick={() => onVista(v.id)}
                className="h-8 px-3.5 rounded-md text-[12px] transition-colors"
                style={vista === v.id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Tarjeta de cada vista de Metas: título a la izquierda; botones de vista y Editar a la derecha. */
function TarjetaMetas({ titulo, vista, onVista, editando, botones, avisos, children }: {
  titulo: string; vista: VistaMetas; onVista?: (v: VistaMetas) => void; editando: boolean;
  botones: ReactNode; avisos?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="tarjeta overflow-hidden flex flex-col"
             style={{ border: `1px solid ${editando ? "#8DB39B" : "#D5DBD7"}`, boxShadow: editando ? `0 0 0 2px ${C.acentoSuave}` : "none" }}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="text-[14px] font-semibold flex-1">{titulo}</h2>
        {onVista && <SelectorVistaMetas vista={vista} onVista={onVista} />}
        {botones}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 empty:hidden" style={{ borderBottom: `1px solid ${C.beige}` }}>{avisos}</div>
      {children}
    </section>
  );
}

function ParametrosColocacion({ agencia, onGuardado, seccion, vistaMetas = "asesores", onVistaMetas, cartera = null }: {
  agencia: string; onGuardado: () => void; seccion: "colocacion" | "recuperacion";
  vistaMetas?: VistaMetas; onVistaMetas?: (v: VistaMetas) => void;
  /** Tasas y recuperación: el cálculo vigente de la cartera, para mostrar cada % en dólares */
  cartera?: CarteraTasas | null;
}) {
  const urlOficiales = `/api/oficiales-credito?agencia=${encodeURIComponent(agencia)}`;
  const urlMetas = "/api/metas-credito-institucional";
  const urlCredito = `/api/parametros-credito?agencia=${encodeURIComponent(agencia)}`;

  const cachedOf = obtenerJSONCache<{ oficiales?: Oficial[] }>(urlOficiales)?.oficiales;
  const cachedMetas = obtenerJSONCache<Metas>(urlMetas);
  const cachedCredito = obtenerJSONCache<{ filas?: FilaCredito[] }>(urlCredito)?.filas;
  const [realTasas, setRealTasas] = useState<RealTasas>(() => obtenerJSONCache<{ real?: RealTasas }>(urlCredito)?.real ?? null);

  const inicialFilas = () => {
    if (!cachedCredito) return filasVaciasCredito();
    return filasVaciasCredito().map((f) => {
      const g = cachedCredito.find((x) => x.linea === f.linea && x.mes === f.mes);
      return g ? { ...f, ...g } : f;
    });
  };

  const [cargando, setCargando] = useState(() => !(cachedOf && cachedMetas && cachedCredito));
  const [error, setError] = useState<string | null>(null);

  // --- asesores: borrador + original
  const [oficiales, setOficiales] = useState<Oficial[]>(() => cachedOf ?? []);
  const [borradorOf, setBorradorOf] = useState<Oficial[]>(() => cachedOf ?? []);
  const [editOf, setEditOf] = useState(false);
  const [guardandoOf, setGuardandoOf] = useState(false);
  const [msgOf, setMsgOf] = useState<{ t: string; e?: boolean } | null>(null);
  const [nuevoUsuario, setNuevoUsuario] = useState("");
  const [nuevoRango, setNuevoRango] = useState<Rango>("JUNIOR");
  const [siguienteIdTemporal, setSiguienteIdTemporal] = useState(-1);

  // --- metas institucionales
  const [metas, setMetas] = useState<Metas | null>(() => cachedMetas ?? null);
  const [metasOriginal, setMetasOriginal] = useState<Metas | null>(() => cachedMetas ?? null);
  const [editMetas, setEditMetas] = useState(false);
  const [guardandoMetas, setGuardandoMetas] = useState(false);
  const [msgMetas, setMsgMetas] = useState<{ t: string; e?: boolean } | null>(null);

  // --- tasas y distribución
  const [filas, setFilas] = useState<FilaCredito[]>(inicialFilas);
  const [filasOriginal, setFilasOriginal] = useState<FilaCredito[]>(inicialFilas);
  const [editTasas, setEditTasas] = useState(false);
  const [editDist, setEditDist] = useState(false);
  const [guardandoTasas, setGuardandoTasas] = useState(false);
  const [msgTasas, setMsgTasas] = useState<{ t: string; e?: boolean } | null>(null);
  const [lineaTasas, setLineaTasas] = useState<Linea>("CONSUMO");
  // Tasas y recuperación: ver en porcentajes o en dólares; al editar, los dólares solo de la fila que se está cambiando
  const [vistaTasas, setVistaTasas] = useState<"pct" | "usd">("pct");
  const [focoTasa, setFocoTasa] = useState<CampoTasa | null>(null);

  // --- % de cumplimiento de la meta de colocación (12 meses, fracción); sin dato guardado = 100 %
  const urlCump = `/api/otros-pasivo-parametros?agencia=${encodeURIComponent(agencia)}`;
  const leerCump = (d?: { parametros?: Record<string, number[]> } | null) => {
    const v = d?.parametros?.colocacion_pct_cumplimiento;
    return v && v.length === 12 && v.some((x) => x !== 0) ? [...v] : Array(12).fill(1) as number[];
  };
  const [cump, setCump] = useState<number[]>(() => leerCump(obtenerJSONCache(urlCump)));
  const [cumpOriginal, setCumpOriginal] = useState<number[]>(() => leerCump(obtenerJSONCache(urlCump)));
  const [editCump, setEditCump] = useState(false);
  const [guardandoCump, setGuardandoCump] = useState(false);
  const [msgCump, setMsgCump] = useState<{ t: string; e?: boolean } | null>(null);
  const [cumpTodas, setCumpTodas] = useState(false);
  const [verFCump, setVerFCump] = useState(false);
  // Referencia: cumplimiento real de los últimos 12 meses (misma calibración que Planificación); se pide solo al abrir la vista
  const [realAg, setRealAg] = useState<{ ag: string; cumpl: number; coloc: number } | null>(null);
  const real = realAg?.ag === agencia ? realAg : null;
  useEffect(() => {
    if (seccion !== "colocacion" || vistaMetas !== "cumplimiento" || realAg?.ag === agencia) return;
    cargarJSON<DatosPlanificacion & { error?: string }>("/api/planificacion", (d) => {
      const base = d.bases?.[agencia], par = d.parametros?.[agencia]; if (!base || !par) return;
      const A = calibrar(agencia, { base, mix: par.mix, credito: par.credito ?? {}, vistaNeto: par.vistaNeto ?? null, capt13: (d.trayectoria?.[agencia] ?? []).slice(-13).map((x) => x.capt) }, d.metasAsesor ?? [110000, 125000, 135000]);
      if (!A) return;
      const cap = A.mix.reduce((t, n, j) => t + n * A.metas[j], 0);
      setRealAg({ ag: agencia, cumpl: A.calib.cumplObs, coloc: cap ? cap * A.calib.cumplObs : A.capSinAsesores });
    }).catch(() => undefined);
  }, [seccion, vistaMetas, agencia, realAg]);

  async function guardarCump() {
    if (hayCamposConError()) { setMsgCump({ t: MENSAJE_CAMPOS_CON_ERROR, e: true }); return; }
    if (cump.some((x) => !(x >= 0 && x <= 1.5))) { setMsgCump({ t: "Cada mes debe estar entre 0 % y 150 %.", e: true }); return; }
    setGuardandoCump(true); setMsgCump(null);
    try {
      const r = await apiFetch("/api/otros-pasivo-parametros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, concepto: "colocacion_pct_cumplimiento", montosPorMes: cump, todasLasAgencias: cumpTodas }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar el cumplimiento.");
      setCumpOriginal(cump); setEditCump(false);
      setMsgCump({ t: cumpTodas ? "Cumplimiento guardado en las 10 agencias. La colocación, la cartera y los resultados ya lo usan." : "Cumplimiento guardado. La colocación, la cartera y los resultados ya lo usan." });
      setCumpTodas(false);
      onGuardado();
    } catch (e) {
      setMsgCump({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally {
      setGuardandoCump(false);
    }
  }

  // Tabla de asesores: se ajusta al alto de la pantalla y se desplaza por dentro
  const refTablaOf = useRef<HTMLDivElement>(null);
  const [altoTablaOf, setAltoTablaOf] = useState<number | null>(null);
  useLayoutEffect(() => {
    const calcular = () => {
      const el = refTablaOf.current;
      if (!el) return;
      const arriba = el.getBoundingClientRect().top + window.scrollY;
      setAltoTablaOf(Math.max(260, Math.floor(window.innerHeight - arriba - 46)));
    };
    calcular();
    window.addEventListener("resize", calcular);
    return () => window.removeEventListener("resize", calcular);
  }, [vistaMetas, editOf, msgOf, cargando]);

  const turnos = useTurnos();
  function cargarOficiales(t = turnos.nuevo("of")) {
    return cargarJSON<{ error?: string; oficiales?: Oficial[] }>(urlOficiales, (d) => {
      if (!turnos.vigente(t, "of")) return;
      if (d.error) throw new Error(d.error);
      setOficiales(d.oficiales ?? []);
      setBorradorOf(d.oficiales ?? []);
    });
  }

  function cargarTodo() {
    // Si las tres consultas ya están recordadas, se muestran al instante (y se actualizan por detrás)
    setCargando(!(tieneDatos(urlOficiales) && tieneDatos(urlMetas) && tieneDatos(urlCredito)));
    setError(null);
    setEditOf(false); setEditMetas(false); setEditTasas(false); setEditDist(false); setEditCump(false);
    setMsgOf(null); setMsgMetas(null); setMsgTasas(null); setMsgCump(null);
    // Turno de esta carga: si cambia la agencia antes de que lleguen las respuestas, se descartan
    const t = turnos.nuevo();
    Promise.all([
      cargarOficiales(turnos.nuevo("of")),
      cargarJSON<Metas & { error?: string; sinDatos?: boolean }>(urlMetas, (d) => {
        if (!turnos.vigente(t)) return;
        if (!d.error) {
          const m: Metas = { meta_junior: d.meta_junior, meta_senior: d.meta_senior, meta_master: d.meta_master, minimo_operaciones: d.minimo_operaciones, relacion_mora: d.relacion_mora };
          setMetas(m); setMetasOriginal(m);
          if (d.sinDatos) setMsgMetas({ t: "Este ejercicio todavía no tiene metas por asesor: ingréselas y guárdelas.", e: true });
        }
      }),
      cargarJSON<{ error?: string; parametros?: Record<string, number[]> }>(urlCump, (d) => {
        if (!turnos.vigente(t)) return;
        if (!d.error) { const v = leerCump(d); setCump(v); setCumpOriginal(v); }
      }),
      cargarJSON<{ error?: string; filas?: FilaCredito[]; real?: RealTasas }>(urlCredito, (d) => {
        if (!turnos.vigente(t)) return;
        if (d.error) throw new Error(d.error);
        setRealTasas(d.real ?? null);
        const guardadas: FilaCredito[] = d.filas ?? [];
        const base = filasVaciasCredito().map((f) => {
          const g = guardadas.find((x) => x.linea === f.linea && x.mes === f.mes);
          return g ? { ...f, ...g } : f;
        });
        setFilas(base);
        setFilasOriginal(base);
      }),
    ])
      .catch((e) => { if (turnos.vigente(t)) setError(e instanceof Error ? e.message : "Error de conexión al cargar los parámetros."); })
      .finally(() => { if (turnos.vigente(t)) setCargando(false); });
  }
  useEffect(cargarTodo, [agencia]); // eslint-disable-line react-hooks/exhaustive-deps

  // ================= ASESORES =================
  const eliminadosOf = oficiales.filter((o) => !borradorOf.some((b) => b.id === o.id));
  const nuevosOf = borradorOf.filter((b) => b.id < 0);
  const modificadosOf = borradorOf.filter((b) => {
    const o = oficiales.find((x) => x.id === b.id);
    return o && (o.rango !== b.rango || o.activo !== b.activo);
  });
  const cambiosOf = eliminadosOf.length + nuevosOf.length + modificadosOf.length;

  function agregarBorrador() {
    const usuario = nuevoUsuario.trim().toUpperCase();
    if (!usuario) return;
    setBorradorOf((prev) => [...prev, { id: siguienteIdTemporal, usuario, rango: nuevoRango, activo: 1 }]);
    setSiguienteIdTemporal((n) => n - 1);
    setNuevoUsuario("");
  }

  async function guardarOficiales() {
    setGuardandoOf(true);
    setMsgOf(null);
    try {
      const pedir = async (url: string, init: RequestInit) => {
        const r = await apiFetch(url, init);
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "No se pudo guardar un cambio de asesores."); }
      };
      const json = { "Content-Type": "application/json" };
      for (const o of eliminadosOf) await pedir(`/api/oficiales-credito?id=${o.id}`, { method: "DELETE" });
      for (const n of nuevosOf) {
        await pedir("/api/oficiales-credito", { method: "POST", headers: json, body: JSON.stringify({ agencia, usuario: n.usuario, rango: n.rango }) });
      }
      for (const b of modificadosOf) {
        const o = oficiales.find((x) => x.id === b.id)!;
        if (o.rango !== b.rango) await pedir("/api/oficiales-credito", { method: "PATCH", headers: json, body: JSON.stringify({ id: b.id, rango: b.rango }) });
        if (o.activo !== b.activo) await pedir("/api/oficiales-credito", { method: "PATCH", headers: json, body: JSON.stringify({ id: b.id, activo: b.activo }) });
      }
      await cargarOficiales();
      setEditOf(false);
      setMsgOf({ t: "Asesores guardados." });
      onGuardado();
    } catch (e) {
      setMsgOf({ t: e instanceof Error ? e.message : "Error de conexión al guardar.", e: true });
      await cargarOficiales().catch(() => undefined);
    } finally {
      setGuardandoOf(false);
    }
  }

  // ================= METAS =================
  const cambiosMetas = metas && metasOriginal
    ? (Object.keys(metas) as (keyof Metas)[]).filter((k) => redondeo(metas[k]) !== redondeo(metasOriginal[k])).length : 0;

  async function guardarMetas() {
    if (!metas) return;
    if (hayCamposConError()) { setMsgMetas({ t: MENSAJE_CAMPOS_CON_ERROR, e: true }); return; }
    setGuardandoMetas(true);
    setMsgMetas(null);
    try {
      const r = await apiFetch("/api/metas-credito-institucional", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metas),
      });
      if (!r.ok) throw new Error("No se pudieron guardar las metas.");
      setMetasOriginal(metas);
      setEditMetas(false);
      setMsgMetas({ t: "Metas guardadas. Aplican a las 10 agencias." });
      onGuardado();
    } catch (e) {
      setMsgMetas({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally {
      setGuardandoMetas(false);
    }
  }

  // ================= TASAS Y DISTRIBUCIÓN =================
  /** Valor ya leído (fracción). Pase a riesgo y precancelaciones pueden quedar vacíos (el motor usa su cálculo por defecto). */
  function setValor(linea: Linea, mes: number, campo: keyof FilaCredito, valor: number | null) {
    const v = valor === null ? (VACIABLES.has(String(campo)) ? null : 0) : valor;
    setFilas((prev) => prev.map((f) => (f.linea === linea && f.mes === mes ? { ...f, [campo]: v } : f)));
  }
  function copiarEnero(linea: Linea, campo: keyof FilaCredito) {
    setFilas((prev) => {
      const ene = prev.find((f) => f.linea === linea && f.mes === 1);
      const v = campo === "pct_distribucion" && ene ? distEfectiva(ene) : ene ? ene[campo] : 0;
      return prev.map((f) => (f.linea === linea ? { ...f, [campo]: v } : f));
    });
  }
  const cambiada = (linea: Linea, mes: number, campo: keyof FilaCredito) => {
    const a = filas.find((f) => f.linea === linea && f.mes === mes)!;
    const b = filasOriginal.find((f) => f.linea === linea && f.mes === mes)!;
    const va = campo === "pct_distribucion" ? distEfectiva(a) : (a[campo] as number | null);
    const vb = campo === "pct_distribucion" ? distEfectiva(b) : (b[campo] as number | null);
    if (va === null || vb === null || va === undefined || vb === undefined) return (va ?? null) !== (vb ?? null);
    return redondeo(va) !== redondeo(vb);
  };
  const cambiosTasas = filas.reduce((n, f) =>
    n + (CAMPOS_TASAS.map((c) => c.key) as (keyof FilaCredito)[]).filter((c) => cambiada(f.linea, f.mes, c)).length, 0);
  const cambiosDist = filas.reduce((n, f) => n + (cambiada(f.linea, f.mes, "pct_distribucion") ? 1 : 0), 0);
  const totalesDist = MESES.map((_, i) => LINEAS.reduce((s, l) => s + distEfectiva(filas.find((f) => f.linea === l.id && f.mes === i + 1)!), 0));
  const distInvalida = totalesDist.some((t) => Math.abs(t - 1) > 0.0001);

  async function guardarTasas() {
    if (distInvalida) return;
    if (hayCamposConError()) { setMsgTasas({ t: MENSAJE_CAMPOS_CON_ERROR, e: true }); return; }
    // Tasas, recuperación, pase a riesgo y precancelaciones: entre 0 % y 100 % (las vacías usan el cálculo por defecto)
    for (const c of CAMPOS_TASAS) {
      const mal = filas.find((f) => { const v = f[c.key] as number | null | undefined; return v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1); });
      if (mal) { setMsgTasas({ t: `${c.label}: ${MESES[mal.mes - 1]} debe estar entre 0 % y 100 %.`, e: true }); return; }
    }
    setGuardandoTasas(true);
    setMsgTasas(null);
    try {
      const r = await apiFetch("/api/parametros-credito", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filas, agencia }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudieron guardar las tasas.");
      setFilasOriginal(filas);
      setEditTasas(false);
      setEditDist(false);
      setMsgTasas({ t: "Parámetros guardados. El detalle de cartera ya usa los nuevos valores." });
      onGuardado();
    } catch (e) {
      setMsgTasas({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally {
      setGuardandoTasas(false);
    }
  }

  // Ediciones abiertas con cambios: se avisan antes de cambiar de agencia o de pestaña
  const cambiosCumpPend = cump.filter((v, i) => Math.round(v * 1e6) !== Math.round((cumpOriginal[i] ?? 0) * 1e6)).length;
  usePendiente(editOf && cambiosOf > 0 ? { descripcion: `Asesores de ${agencia}`, descartar: () => { setBorradorOf(oficiales); setEditOf(false); setNuevoUsuario(""); } } : null);
  usePendiente(editMetas && cambiosMetas > 0 ? { descripcion: "Metas por asesor", descartar: () => { setMetas(metasOriginal); setEditMetas(false); } } : null);
  usePendiente(editCump && cambiosCumpPend > 0 ? { descripcion: `Cumplimiento de la meta de ${agencia}`, descartar: () => { setCump(cumpOriginal); setEditCump(false); setCumpTodas(false); } } : null);
  usePendiente((editTasas || editDist) && (cambiosTasas > 0 || cambiosDist > 0) ? { descripcion: `Tasas y distribución de ${agencia}`, descartar: () => { setFilas(filasOriginal); setEditTasas(false); setEditDist(false); } } : null);

  if (cargando) return <EsqueletoTabla indicadores={false} filas={8} />;
  if (error) return <p className="text-sm" style={{ color: C.alerta }}>{error}</p>;

  // --- datos para mostrar
  const listaOf = editOf ? borradorOf : oficiales;
  const metasVista = metas;
  const metaPorRango: Record<Rango, number> = metasVista
    ? { JUNIOR: metasVista.meta_junior, SENIOR: metasVista.meta_senior, MASTER: metasVista.meta_master }
    : { JUNIOR: 0, SENIOR: 0, MASTER: 0 };
  const activos = listaOf.filter((o) => o.activo === 1);
  const metaTotal = activos.reduce((s, o) => s + (metaPorRango[o.rango] ?? 0), 0);
  const campoMeta: Record<Rango, keyof Metas> = { JUNIOR: "meta_junior", SENIOR: "meta_senior", MASTER: "meta_master" };

  const celdaLectura = "h-[27px] w-full rounded px-2 text-right text-[12px] flex items-center justify-end";
  const inputCls = "h-[27px] w-full rounded px-2 text-right text-[12px] bg-white outline-none focus:ring-2 focus:ring-[#CFE3D6]";
  const GT = "grid grid-cols-[minmax(320px,1fr)_repeat(12,minmax(72px,1fr))_44px] items-center gap-x-1";
  // Borde completo (no solo el color) para que React no mezcle "border" con "borderColor".
  const marcoEdicion = (on: boolean) => ({ border: `1px solid ${on ? "#8DB39B" : C.borde}`, boxShadow: on ? `0 0 0 2px ${C.acentoSuave}` : "none" });

  return (
    <div className={`flex flex-col gap-5 ${seccion === "colocacion" && vistaMetas === "produccion" ? "" : "pb-6"}`}>
      {/* ================= INDICADORES (tarjetas separadas, como en Detalle) ================= */}
      {seccion === "colocacion" && (() => {
        const lineasActivas = LINEAS.map((l) => ({ ...l, d: distEfectiva(filas.find((f) => f.linea === l.id && f.mes === 1)!) })).filter((l) => l.d > 0);
        const cumpVista = editCump ? cump : cumpOriginal, cumpProm = suma(cumpVista) / 12, colocPres = metaTotal * cumpProm;
        const items = [
          { t: "Meta de colocación mensual", v: usd(metaTotal), sub: `100 % · ${usd(metaTotal * 12)} en el año` },
          { t: "Colocación presupuestada", v: usd(colocPres), sub: `${pct(cumpProm, 0)} de la meta (promedio) · ${usd(metaTotal * suma(cumpVista))} en el año` },
          ...(vistaMetas === "cumplimiento" && real ? [{ t: "Cumplimiento real · últimos 12 meses", v: pct(real.cumpl, 0), sub: `colocación promedio ${usd(real.coloc)} al mes` }] : []),
          { t: "Asesores activos", v: String(activos.length), sub: RANGOS.map((r) => `${activos.filter((o) => o.rango === r.id).length} ${r.label}`).join(" · ") },
          ...lineasActivas.map((l) => ({ t: `Colocación ${l.label.toLowerCase()}`, v: usd(colocPres * l.d), sub: `${pct(l.d, 0)} de la colocación presupuestada` })),
        ];
        return (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {items.map((k) => (
              <div key={k.t} className="tarjeta px-5 py-4 flex flex-col gap-1">
                <span className="text-[12px]" style={{ color: C.texto2 }}>{k.t}</span>
                <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{k.v}</span>
                <span className="text-[12px]" style={{ color: C.texto2 }}>{k.sub}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ================= ASESORES ================= */}
      {seccion === "colocacion" && vistaMetas === "asesores" && (() => {
        // Los nuevos aparecen arriba mientras se edita; al guardar toman su lugar alfabético
        const orden = [...listaOf].sort((a, b) => (a.id < 0) !== (b.id < 0) ? (a.id < 0 ? -1 : 1) : a.usuario.localeCompare(b.usuario));
        const th = "px-4 py-2.5 font-semibold";
        const fijo = "sticky top-0 z-10 bg-white";
        const sombraCab = { boxShadow: `inset 0 -1px 0 ${C.beige}` };
        return (
          <TarjetaMetas titulo="Asesores de crédito" vista={vistaMetas} onVista={onVistaMetas} editando={editOf}
            botones={<BotonesSeccion editando={editOf} cambios={cambiosOf} guardando={guardandoOf}
              onEditar={() => { setBorradorOf(oficiales); setEditOf(true); setMsgOf(null); }}
              onCancelar={() => { setBorradorOf(oficiales); setEditOf(false); setNuevoUsuario(""); }}
              onGuardar={guardarOficiales} />}
            avisos={<>
              {editOf && <AvisoEdicion texto="Modo edición: los cambios de asesores se aplican solo al presionar Guardar." />}
              {editOf && (
                <div className="flex flex-wrap gap-2">
                  <input placeholder="Usuario del nuevo asesor" value={nuevoUsuario} onChange={(e) => setNuevoUsuario(e.target.value)}
                         onKeyDown={(e) => e.key === "Enter" && agregarBorrador()} aria-label="Usuario del nuevo asesor"
                         className="flex-1 min-w-[180px] h-[31px] rounded px-3 text-[12px] bg-white" style={{ border: `1px solid ${C.borde}` }} />
                  <select value={nuevoRango} onChange={(e) => setNuevoRango(e.target.value as Rango)} aria-label="Rango del nuevo asesor"
                          className="h-[31px] rounded px-3 text-[12px] bg-white" style={{ border: `1px solid ${C.borde}` }}>
                    {RANGOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                  <button type="button" onClick={agregarBorrador} className="h-[31px] px-4 rounded text-white text-[12px] font-semibold" style={{ background: C.acento }}>+ Agregar</button>
                </div>
              )}
              {msgOf && <Mensaje texto={msgOf.t} error={msgOf.e} />}
            </>}>
            <div ref={refTablaOf} className="overflow-y-auto" style={{ maxHeight: altoTablaOf ?? undefined }}>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr style={{ color: C.cabeceraTexto }}>
                  <th className={`${th} ${fijo} text-left`} style={sombraCab}>Asesor</th>
                  <th className={`${th} ${fijo} text-left`} style={sombraCab}>Rango</th>
                  <th className={`${th} ${fijo} text-right`} style={sombraCab}>Meta mensual</th>
                  <th className={`${th} ${fijo} text-right`} style={sombraCab}>Participación en la meta</th>
                  <th className={`${th} ${fijo} text-right w-[120px]`} style={sombraCab}>Estado</th>
                  {editOf && <th className={`${fijo} w-12`} style={sombraCab} />}
                </tr>
              </thead>
              <tbody>
                {orden.map((o) => {
                  const original = oficiales.find((x) => x.id === o.id);
                  const esNuevo = o.id < 0;
                  const cambio = esNuevo || (original && (original.rango !== o.rango || original.activo !== o.activo));
                  const meta = metaPorRango[o.rango] ?? 0;
                  return (
                    <tr key={o.id} style={{ borderTop: `1px solid ${C.beige}`, height: editOf ? 38 : 34, background: editOf && cambio ? "#EEF5F0" : undefined, color: o.activo ? C.texto : C.tenue }}>
                      <td className="px-4 font-medium">
                        {o.usuario}
                        {esNuevo && <span className="ml-2 text-[11px] font-bold px-1.5 py-px rounded" style={{ background: C.acentoSuave, color: C.acento }}>NUEVO</span>}
                      </td>
                      <td className="px-4">
                        {editOf ? (
                          <select value={o.rango} aria-label={`Rango de ${o.usuario}`}
                                  onChange={(e) => setBorradorOf((prev) => prev.map((x) => (x.id === o.id ? { ...x, rango: e.target.value as Rango } : x)))}
                                  className="h-7 pl-2 pr-1 rounded text-[12px] bg-white cursor-pointer" style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>
                            {RANGOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                          </select>
                        ) : RANGOS.find((r) => r.id === o.rango)?.label}
                      </td>
                      <td className="px-4 text-right">{usd(meta)}</td>
                      <td className="px-4 text-right">{o.activo && metaTotal > 0 ? pct(meta / metaTotal, 1) : "—"}</td>
                      <td className="px-4 text-right">
                        {editOf ? (
                          <button type="button" role="switch" aria-checked={o.activo === 1} aria-label={`${o.usuario} activo`} disabled={o.id < 0}
                                  onClick={() => setBorradorOf((prev) => prev.map((x) => (x.id === o.id ? { ...x, activo: x.activo ? 0 : 1 } : x)))}
                                  className="relative inline-block w-[31px] h-5 rounded-full align-middle transition-colors disabled:opacity-60"
                                  style={{ background: o.activo ? C.ok : "#C4CAC6" }}>
                            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: o.activo ? 13 : 2 }} />
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5" style={{ color: C.texto2 }}>
                            <span className="w-[7px] h-[7px] rounded-full" style={{ background: o.activo ? C.ok : "#C4CAC6" }} />
                            {o.activo ? "Activo" : "Inactivo"}
                          </span>
                        )}
                      </td>
                      {editOf && (
                        <td className="text-center">
                          <button type="button" aria-label={`Quitar a ${o.usuario}`} title="Quitar asesor"
                                  onClick={() => setBorradorOf((prev) => prev.filter((x) => x.id !== o.id))}
                                  className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#FBE0DD]">
                            <Trash2 size={14} color={C.alerta} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {orden.length === 0 && (
                  <tr><td colSpan={editOf ? 6 : 5} className="px-4 py-6 text-center" style={{ color: C.texto2 }}>{agencia} todavía no tiene asesores registrados.</td></tr>
                )}
              </tbody>
              {orden.length > 0 && (() => {
                const pie = "sticky bottom-0 bg-[#F8FAF9] px-4";
                const linea = { boxShadow: `inset 0 1px 0 ${C.borde}`, height: 36 };
                return (
                  <tfoot>
                    <tr className="font-semibold">
                      <td className={pie} style={linea}>Total · {activos.length} {activos.length === 1 ? "asesor activo" : "asesores activos"}</td>
                      <td className={pie} style={linea} />
                      <td className={`${pie} text-right`} style={linea}>{usd(metaTotal)}</td>
                      <td className={`${pie} text-right`} style={linea}>{metaTotal > 0 ? "100 %" : "—"}</td>
                      <td className={pie} style={linea} />
                      {editOf && <td className={pie} style={linea} />}
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
            </div>
          </TarjetaMetas>
        );
      })()}

      {/* ================= METAS POR RANGO (a todo el ancho) ================= */}
      {seccion === "colocacion" && vistaMetas === "rangos" && metas && (() => {
        const th = "px-4 py-2.5 font-semibold";
        const entrada = (ch: boolean) => ({ border: `1px solid ${ch ? C.acento : C.borde}`, background: ch ? C.acentoSuave : "#FFFFFF", color: C.texto });
        const barra = (p: number) => (
          <span className="inline-block w-[90px] h-1 rounded-full overflow-hidden align-middle ml-2.5" style={{ background: C.beige }}>
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, p * 100)}%`, background: "#8FAE9B" }} />
          </span>
        );
        const chMin = !!metasOriginal && metas.minimo_operaciones !== metasOriginal.minimo_operaciones;
        const chMora = !!metasOriginal && redondeo(metas.relacion_mora) !== redondeo(metasOriginal.relacion_mora);
        return (
          <TarjetaMetas titulo="Metas por rango" vista={vistaMetas} onVista={onVistaMetas} editando={editMetas}
            botones={<BotonesSeccion editando={editMetas} cambios={cambiosMetas} guardando={guardandoMetas}
              onEditar={() => { setEditMetas(true); setMsgMetas(null); }}
              onCancelar={() => { setMetas(metasOriginal); setEditMetas(false); }}
              onGuardar={guardarMetas} />}
            avisos={<>
              {editMetas && <AvisoEdicion texto="Las metas por rango y los parámetros institucionales aplican a las 10 agencias." />}
              {msgMetas && <Mensaje texto={msgMetas.t} error={msgMetas.e} />}
            </>}>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr style={{ background: C.cabecera, color: C.cabeceraTexto }}>
                  <th className={`${th} text-left`}>Rango</th>
                  <th className={`${th} text-right`}>Meta mensual por asesor</th>
                  <th className={`${th} text-right`}>Asesores activos</th>
                  <th className={`${th} text-right`}>Meta del rango</th>
                  <th className={`${th} text-right w-[240px]`}>Participación</th>
                </tr>
              </thead>
              <tbody>
                {RANGOS.map((r) => {
                  const cant = activos.filter((o) => o.rango === r.id).length;
                  const k = campoMeta[r.id];
                  const ch = !!metasOriginal && metas[k] !== metasOriginal[k];
                  const aporte = cant * metas[k];
                  const part = metaTotal > 0 ? aporte / metaTotal : 0;
                  return (
                    <tr key={r.id} style={{ borderTop: `1px solid ${C.beige}`, height: editMetas ? 38 : 34 }}>
                      <td className="px-4 font-semibold">{r.label}</td>
                      <td className="px-4 text-right">
                        {editMetas ? (
                          <CampoNumero valor={metas[k]} etiqueta={`Meta mensual ${r.label}`} min={0} decimales={2}
                                 onValor={(n) => setMetas({ ...metas, [k]: n ?? 0 })}
                                 className="h-7 w-[110px] rounded px-2.5 text-right text-[12px]" style={entrada(ch)} />
                        ) : usd(metas[k])}
                      </td>
                      <td className="px-4 text-right">{cant}</td>
                      <td className="px-4 text-right">{usd(aporte)}</td>
                      <td className="px-4 text-right">{pct(part, 0)}{barra(part)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold" style={{ borderTop: `1px solid ${C.borde}`, background: "#F8FAF9", height: 36 }}>
                  <td className="px-4">Total</td>
                  <td />
                  <td className="px-4 text-right">{activos.length}</td>
                  <td className="px-4 text-right">{usd(metaTotal)}</td>
                  <td className="px-4 text-right">{metaTotal > 0 ? "100 %" : "—"}{barra(metaTotal > 0 ? 1 : 0)}</td>
                </tr>
                <tr style={{ borderTop: `1px solid ${C.beige}`, background: "#F8FAF9", height: 34 }}>
                  <td colSpan={5} className="px-4 font-semibold" style={{ color: C.texto3 }}>Parámetros institucionales</td>
                </tr>
                <tr style={{ borderTop: `1px solid ${C.beige}`, height: editMetas ? 38 : 32 }}>
                  <td colSpan={4} className="px-4" style={{ color: C.texto3 }}>Mínimo de operaciones por asesor</td>
                  <td className="px-4 text-right font-semibold">
                    {editMetas ? (
                      <CampoNumero valor={metas.minimo_operaciones} etiqueta="Mínimo de operaciones por asesor" min={0} enteros decimales={0}
                             onValor={(n) => setMetas({ ...metas, minimo_operaciones: n ?? 0 })}
                             className="h-7 w-[90px] rounded px-2.5 text-right text-[12px]" style={entrada(chMin)} />
                    ) : metas.minimo_operaciones}
                  </td>
                </tr>
                <tr style={{ borderTop: `1px solid ${C.beige}`, height: editMetas ? 38 : 32 }}>
                  <td colSpan={4} className="px-4" style={{ color: C.texto3 }}>Interés de mora sobre cartera</td>
                  <td className="px-4 text-right font-semibold">
                    {editMetas ? (
                      <CampoNumero valor={metas.relacion_mora} escala={100} min={0} max={100} etiqueta="Interés de mora sobre cartera (%)"
                             onValor={(n) => setMetas({ ...metas, relacion_mora: n ?? 0 })}
                             className="h-7 w-[90px] rounded px-2.5 text-right text-[12px]" style={entrada(chMora)} />
                    ) : pct(metas.relacion_mora)}
                  </td>
                </tr>
              </tbody>
            </table>
          </TarjetaMetas>
        );
      })()}

      {/* ================= CUMPLIMIENTO DE LA META DE COLOCACIÓN ================= */}
      {seccion === "colocacion" && vistaMetas === "cumplimiento" && (() => {
        const cambiosCump = cump.filter((v, i) => redondeo(v) !== redondeo(cumpOriginal[i])).length;
        const vista = editCump ? cump : cumpOriginal;
        const setMes = (i: number, n: number | null) => setCump((prev) => prev.map((x, j) => (j === i ? n ?? 0 : x)));
        const fila = (label: string, valores: (i: number) => ReactNode, negrita = false, extra?: ReactNode) => (
          <div className={`${GT} py-1.5 ${negrita ? "font-semibold" : ""}`} style={{ borderTop: `1px solid ${C.beige}` }}>
            <div className="pl-4 text-[12px]" style={{ color: negrita ? C.texto : C.texto3 }}>{label}</div>
            {MESES.map((_, i) => <div key={i} className={celdaLectura} style={{ color: C.texto }}>{valores(i)}</div>)}
            <div className="flex justify-center">{extra}</div>
          </div>
        );
        return (
          <TarjetaMetas titulo="Cumplimiento de la meta de colocación" vista={vistaMetas} onVista={onVistaMetas} editando={editCump}
            botones={<>
              {editCump && (
                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: C.texto2 }}>
                  <input type="checkbox" checked={cumpTodas} onChange={(e) => setCumpTodas(e.target.checked)} />
                  Aplicar a las 10 agencias
                </label>
              )}
              <BotonesSeccion editando={editCump} cambios={cambiosCump + (cumpTodas ? 1 : 0)} guardando={guardandoCump}
                onEditar={() => { setEditCump(true); setMsgCump(null); }}
                onCancelar={() => { setCump(cumpOriginal); setEditCump(false); setCumpTodas(false); }}
                onGuardar={guardarCump} />
            </>}
            avisos={<>
              {editCump && <AvisoEdicion texto={cumpTodas ? "Se guardarán estos 12 meses en las 10 agencias." : "100 % = la meta completa de los asesores. La colocación de cada línea sale de este monto × Distribución por línea."} />}
              {msgCump && <Mensaje texto={msgCump.t} error={msgCump.e} />}
            </>}>
            <div className="overflow-x-auto">
              <div className="min-w-[1170px]">
                <div className={`${GT} h-[34px] text-[12px] font-semibold`} style={{ background: C.cabecera, color: C.cabeceraTexto }}>
                  <div className="pl-4">Concepto</div>
                  {MESES.map((m) => <div key={m} className="text-right pr-2">{m}</div>)}
                  <div />
                </div>
                {fila("Meta de los asesores (100 %)", () => usd(metaTotal))}
                <div className={`${GT} py-1.5`} style={{ borderTop: `1px solid ${C.beige}` }}>
                  <div className="pl-4 text-[12px]" style={{ color: C.texto3 }}>% de cumplimiento de la meta</div>
                  {MESES.map((_, i) => {
                    const ch = redondeo(cump[i]) !== redondeo(cumpOriginal[i]);
                    const txt = (vista[i] * 100).toFixed(2);
                    return editCump ? (
                      <CampoNumero key={i} valor={vista[i]} escala={100} min={0} max={150} etiqueta={`Cumplimiento ${MESES[i]}`} onValor={(n) => setMes(i, n)}
                             className={inputCls} style={{ border: `1px solid ${ch ? C.acento : C.borde}`, background: ch ? C.acentoSuave : "#FFFFFF" }} />
                    ) : (
                      <div key={i} className={celdaLectura} style={{ color: C.texto }}>{txt.replace(".", ",")}</div>
                    );
                  })}
                  <div className="flex justify-center">
                    {editCump && (
                      <button type="button" onClick={() => setCump((prev) => prev.map(() => prev[0]))} title="Copiar el valor de enero a los 12 meses"
                              aria-label="Copiar enero a los 12 meses: cumplimiento"
                              className="w-[27px] h-[27px] rounded bg-white flex items-center justify-center hover:bg-[#F4F5F3]" style={{ border: `1px solid ${C.borde}` }}>
                        <ArrowRight size={14} color={C.texto2} />
                      </button>
                    )}
                  </div>
                </div>
                {fila("Colocación presupuestada", (i) => usd(metaTotal * vista[i]), true,
                  <BotonF abierto={verFCump} onClick={() => setVerFCump((v) => !v)} titulo="Ver fórmula de la colocación presupuestada" />)}
                {verFCump && (
                  <div className="px-4 py-2 text-[12px]" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2, background: "#F8FAF9" }}>
                    Colocación presupuestada = meta de los asesores × % de cumplimiento del mes: {usd(metaTotal)} × {pct(vista[0])} = {usd(metaTotal * vista[0])} en enero.
                    Cada línea recibe ese monto × su % de Distribución por línea; de ahí salen la cartera, los intereses, la provisión, el flujo y la utilidad.
                  </div>
                )}
              </div>
            </div>
          </TarjetaMetas>
        );
      })()}

      {/* ================= DISTRIBUCIÓN DE LA COLOCACIÓN ================= */}
      {seccion === "colocacion" && vistaMetas === "distribucion" && (
        <TarjetaMetas titulo="Distribución de la colocación" vista={vistaMetas} onVista={onVistaMetas} editando={editDist}
          botones={<BotonesSeccion editando={editDist} cambios={cambiosDist} guardando={guardandoTasas} bloqueoGuardar={distInvalida}
            onEditar={() => { setEditDist(true); setMsgTasas(null); }}
            onCancelar={() => { setFilas(filasOriginal); setEditDist(false); }}
            onGuardar={guardarTasas} />}
          avisos={<>
            {editDist && <AvisoEdicion texto={distInvalida ? "La distribución no suma 100 % en todos los meses. Corrígela para poder guardar." : "Cada mes debe sumar 100 % entre las 4 líneas."} />}
            {msgTasas && <Mensaje texto={msgTasas.t} error={msgTasas.e} />}
          </>}>
        <div className="overflow-x-auto">

          <div className="min-w-[1170px]">
            <div className={`${GT} h-[34px] text-[12px] font-semibold`} style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <div className="pl-4">Línea</div>
              {MESES.map((m) => <div key={m} className="text-right pr-2">{m}</div>)}
              <div />
            </div>
            {LINEAS.map((l) => (
              <div key={l.id} className={`${GT} py-1.5`} style={{ borderTop: `1px solid ${C.beige}` }}>
                <div className="pl-4 text-[12px]" style={{ color: C.texto3 }}>{l.label}</div>
                {MESES.map((_, i) => {
                  const f = filas.find((x) => x.linea === l.id && x.mes === i + 1)!;
                  const v = distEfectiva(f);
                  const ch = cambiada(l.id, i + 1, "pct_distribucion");
                  const txt = (v * 100).toFixed(2);
                  return editDist ? (
                    <CampoNumero key={i} valor={v} escala={100} min={0} max={100} etiqueta={`Distribución ${l.label} ${MESES[i]}`}
                           onValor={(n) => setValor(l.id, i + 1, "pct_distribucion", n)}
                           className={inputCls}
                           style={{ border: `1px solid ${ch ? C.acento : C.borde}`, background: ch ? C.acentoSuave : "#FFFFFF", color: v === 0 ? C.tenue : C.texto }} />
                  ) : (
                    <div key={i} className={celdaLectura} style={{ color: v === 0 ? C.tenue : C.texto }}>{v === 0 ? "—" : txt.replace(".", ",")}</div>
                  );
                })}
                <div className="flex justify-center">
                  {editDist && (
                    <button type="button" onClick={() => copiarEnero(l.id, "pct_distribucion")} title="Copiar el valor de enero a los 12 meses"
                            aria-label={`Copiar enero a los 12 meses: ${l.label}`}
                            className="w-[27px] h-[27px] rounded bg-white flex items-center justify-center hover:bg-[#F4F5F3]" style={{ border: `1px solid ${C.borde}` }}>
                      <ArrowRight size={14} color={C.texto2} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className={`${GT} py-2`} style={{ borderTop: "2px solid #DDE1DC", background: distInvalida ? "#FDF4F3" : "#F4FAF6" }}>
              <div className="pl-4 text-[12px] font-bold">Total</div>
              {totalesDist.map((t, i) => {
                const ok = Math.abs(t - 1) <= 0.0001;
                return (
                  <div key={i} className="text-right pr-1">
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold"
                          style={ok ? { background: C.okSuave, color: C.ok } : { background: C.alertaSuave, color: C.alerta }}>{pct(t, 0)}</span>
                  </div>
                );
              })}
              <div />
            </div>
          </div>
        </div>
        </TarjetaMetas>
      )}

      {/* ================= RECUPERACIÓN Y TASAS ================= */}
      {seccion === "recuperacion" && (() => {
        const det = cartera?.detalle?.[lineaTasas] ?? null;
        const fv = cartera?.factorVencida ?? 1, pr = cartera?.precancelacionReal ?? null;
        const filasL = filas.filter((x) => x.linea === lineaTasas), origL = filasOriginal.filter((x) => x.linea === lineaTasas);
        // dólares: lo calculado con lo guardado; al editar, más lo que cambia con los valores nuevos
        const guardado = det ? dolaresGuardados(det) : null;
        const conCambios = det && filasL.some((f) => CAMPOS_TASAS.some((c) => cambiada(lineaTasas, f.mes, c.key)));
        const nuevo = conCambios ? dolaresTasas(filasL, det!, fv, pr) : null, antes = conCambios ? dolaresTasas(origL, det!, fv, pr) : null;
        const dolar = (k: CampoTasa, i: number) => (guardado ? guardado[k][i] + (nuevo && antes ? nuevo[k][i] - antes[k][i] : 0) : null);
        const real = realTasas?.lineas?.[lineaTasas] ?? null;
        const anioReal = realTasas?.hasta?.slice(0, 4) ?? "";
        const ene = det?.[0];
        const realDolar = (k: CampoTasa): number | null => {
          const v = real?.[k]; if (v === null || v === undefined || !ene) return null;
          const pv = ene.porVencer.saldoInicial, rr = ene.enRiesgo.saldoInicial;
          if (k === "tasa_interes_anual") return ((pv + ene.porVencer.saldoFinal) / 2) * v / 12;
          if (k === "tasa_efectividad_recup") return pv * (real?.pct_recuperacion_periodo ?? ene.tasas.pctRecuperacionPeriodo) * v;
          if (k === "tasa_recuperacion_vencida") return rr * v * fv;
          if (k === "pct_precancelacion_vencida") return rr * v;
          return pv * v;
        };
        // valor que usa el cálculo cuando la celda está vacía (pase a riesgo y precancelaciones)
        const usado = (k: CampoTasa, i: number): number | null => {
          const t = det?.[i]?.tasas; if (!t) return null;
          if (k === "pct_pase_riesgo") return t.pctPaseRiesgo ?? (t.pctRecuperacionPeriodo * (1 - t.tasaEfectividadRecuperacion));
          if (k === "pct_precancelacion_vencida") return t.pctPrecancelacionVencida ?? null;
          if (k === "pct_precancelacion") return t.pctPrecancelacion ?? 0;
          return null;
        };
        const lejos = (k: CampoTasa, v: number | null | undefined) => {
          const r = real?.[k]; return v !== null && v !== undefined && r !== null && r !== undefined && r > 0 && (v > r * 2 || v < r / 2);
        };
        const usarReal = () => setFilas((prev) => prev.map((f) => {
          if (f.linea !== lineaTasas || !real) return f;
          const n = { ...f };
          for (const c of CAMPOS_TASAS) { const v = real[c.key]; if (v !== null && v !== undefined) (n as Record<string, unknown>)[c.key] = Math.round(v * 1e6) / 1e6; }
          return n;
        }));
        const pc = (v: number) => (v * 100).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const GR = "grid grid-cols-[minmax(290px,1fr)_84px_repeat(12,minmax(70px,1fr))_40px] items-center gap-x-1";
        return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] font-semibold flex-1">Tasas y recuperación <span className="text-[12px] font-normal" style={{ color: C.texto2 }}>· por línea y mes</span></span>
          <Segmentado etiqueta="Línea para ver tasas" valor={lineaTasas} onChange={setLineaTasas} opciones={LINEAS} />
          {!editTasas && <Segmentado etiqueta="Ver en" valor={vistaTasas} onChange={setVistaTasas} opciones={[{ id: "pct", label: "Porcentajes" }, { id: "usd", label: "Dólares" }]} />}
          {editTasas && real && (
            <button type="button" onClick={usarReal} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>Usar el real</button>
          )}
          <BotonesSeccion editando={editTasas} cambios={cambiosTasas} guardando={guardandoTasas}
            onEditar={() => { setEditTasas(true); setMsgTasas(null); setFocoTasa(null); }}
            onCancelar={() => { setFilas(filasOriginal); setEditTasas(false); }}
            onGuardar={guardarTasas} />
        </div>
        {msgTasas && <Mensaje texto={msgTasas.t} error={msgTasas.e} />}

        <div className="tarjeta overflow-x-auto pb-1.5" style={{ ...marcoEdicion(editTasas) }}>
          <div className="min-w-[1240px]">
            <div className={`${GR} h-[34px] text-[12px] font-semibold`} style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <div className="pl-4">Parámetro · {NOMBRE_LINEA[lineaTasas]}</div>
              <div className="text-right pr-2 self-stretch flex items-center justify-end" style={{ background: "#F3F7F5", color: C.acento }} title="Meses sin alivio (los mismos del Idóneo y de la provisión)">{realTasas?.desde ? `Real ${MESES[Number(realTasas.desde.slice(5, 7)) - 1]}–${MESES[Number(realTasas.hasta.slice(5, 7)) - 1]} ${anioReal}` : `Real ${anioReal}`}</div>
              {MESES.map((m) => <div key={m} className="text-right pr-2">{m}</div>)}
              <div />
            </div>
            {(["porVencer", "riesgo"] as const).map((g) => (
              <div key={g}>
                <div className="h-[30px] flex items-center pl-4 text-[11px] font-bold uppercase tracking-wide" style={{ borderTop: `1px solid ${C.beige}`, background: "#FAFBFA", color: C.acento }}>
                  {g === "porVencer" ? "Cartera por vencer" : "Cartera en riesgo"}
                </div>
                {CAMPOS_TASAS.filter((c) => c.grupo === g).map((c) => {
                  const rv = real?.[c.key], rd = realDolar(c.key);
                  const enUsd = !editTasas && vistaTasas === "usd";
                  const conDolares = editTasas && focoTasa === c.key;
                  return (
                    <div key={c.key} style={{ borderTop: `1px solid ${C.beige}` }}>
                      <div className={`${GR} h-[38px]`}>
                        <div className="pl-4 text-[12px]" style={{ color: C.texto }} title={c.unidad}>{enUsd ? c.dolar : c.label}</div>
                        <div className="h-full flex items-center justify-end pr-2 text-[12px] font-semibold" style={{ background: "#F3F7F5", color: C.acento }}>
                          {enUsd ? (rd === null ? "—" : usd(rd)) : rv === null || rv === undefined ? "—" : `${pc(rv)} %`}
                        </div>
                        {MESES.map((_, i) => {
                          const f = filasL.find((x) => x.mes === i + 1)!;
                          const ch = cambiada(lineaTasas, i + 1, c.key);
                          const crudo = f[c.key] as number | null | undefined;
                          const marca = lejos(c.key, crudo);
                          const aviso = marca && rv ? `${pc(crudo!)} % frente a ${pc(rv)} % real` : undefined;
                          if (editTasas) return (
                            <span key={i} title={aviso} onFocus={() => setFocoTasa(c.key)}>
                              <CampoNumero valor={crudo ?? null} escala={100} min={0} max={100} permitirVacio={VACIABLES.has(String(c.key))} etiqueta={`${c.label} ${MESES[i]}`}
                                onValor={(n) => setValor(lineaTasas, i + 1, c.key, n)}
                                className={inputCls} style={{ border: `1px solid ${marca ? C.aviso : ch ? C.acento : C.borde}`, background: marca ? C.avisoSuave : ch ? C.acentoSuave : "#FFFFFF" }} />
                            </span>
                          );
                          if (enUsd) { const v = dolar(c.key, i); return <div key={i} className={celdaLectura} style={{ color: C.texto }}>{v === null ? "—" : usd(v)}</div>; }
                          const vacio = crudo === null || crudo === undefined;
                          const u = vacio ? usado(c.key, i) : null;
                          return (
                            <div key={i} className={celdaLectura} title={aviso} style={{ color: vacio ? C.tenue : C.texto, background: marca ? C.avisoSuave : undefined }}>
                              {vacio ? (u === null ? "—" : `${pc(u)} %`) : `${pc(crudo!)} %`}
                            </div>
                          );
                        })}
                        <div className="flex justify-center">
                          {editTasas && (
                            <button type="button" onClick={() => copiarEnero(lineaTasas, c.key)} title="Copiar el valor de enero a los 12 meses"
                                    aria-label={`Copiar enero a los 12 meses: ${c.label}`}
                                    className="w-[27px] h-[27px] rounded bg-white flex items-center justify-center hover:bg-[#F4F5F3]" style={{ border: `1px solid ${C.borde}` }}>
                              <ArrowRight size={14} color={C.texto2} />
                            </button>
                          )}
                        </div>
                      </div>
                      {conDolares && (
                        <div className={`${GR} pb-1.5 text-[11px]`} style={{ color: C.tenue }}>
                          <div className="pl-7">{c.dolar}</div>
                          <div className="h-full flex items-center justify-end pr-2" style={{ background: "#F3F7F5", color: C.acento }}>{rd === null ? "" : usd(rd)}</div>
                          {MESES.map((_, i) => { const v = dolar(c.key, i); return <div key={i} className="text-right pr-2">{v === null ? "" : usd(v)}</div>; })}
                          <div />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

      </div>
        );
      })()}
    </div>
  );
}

function BotonF({ abierto, onClick, titulo }: { abierto: boolean; onClick: () => void; titulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={abierto} title={titulo} aria-label={titulo}
            className="w-7 h-7 rounded inline-flex items-center justify-center font-mono text-[12px]"
            style={abierto ? CHIP_ON : CHIP_OFF}>ƒ</button>
  );
}
