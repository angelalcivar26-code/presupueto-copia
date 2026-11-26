"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { leerMonto, textoEditable } from "../../lib/numeros";
import { apiFetch, errorDeRespuesta } from "../../lib/useDatos";
import { VentanaFormulario, SeccionForm, CampoForm, CAMPO, BORDE } from "../../components/VentanaFormulario";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Download, ShoppingCart, Pencil, Check, Trash2, Plus, AlertTriangle, X, Search,
} from "lucide-react";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { TablaMeses as TablaMesesComun, Tarjeta as TarjetaComun, type DefFila as FilaComun } from "../../components/ActivosComun";
import { ResumenPorAgencia, BotonesVista } from "../../components/PorAgencia";

// =====================================================================
// CONFIGURACIÓN
// =====================================================================

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

interface Categoria { nombre: string; codigo: string; label: string; depreciable: boolean }
const CATEGORIAS: Categoria[] = [
  { nombre: "Terrenos", codigo: "1801", label: "Terrenos", depreciable: false },
  { nombre: "Edificios", codigo: "1802", label: "Edificios", depreciable: true },
  { nombre: "Muebles de oficina", codigo: "18050501", label: "Muebles", depreciable: true },
  { nombre: "Equipo de oficina", codigo: "18050502", label: "Equipo oficina", depreciable: true },
  { nombre: "Enseres de Oficina", codigo: "18050503", label: "Enseres", depreciable: true },
  { nombre: "Equipos de Computación", codigo: "1806", label: "Equipos cómputo", depreciable: true },
  { nombre: "Unidades de Transporte", codigo: "1807", label: "Transporte", depreciable: true },
  { nombre: "Otros Activos", codigo: "1890", label: "Otros", depreciable: true },
];

type Pestana = "resumen" | "saldos" | "bienes" | "plan" | "analisis";
type Seleccion = "TODAS" | string; // nombre de la categoría

// Paleta institucional (misma de Cartera, Inversiones y Otros activos)
const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#7A847F",
  borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F3F5F4",
  cabecera: "#FFFFFF", cabeceraTexto: "#3D4843",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", okSuave: "#E3F1E7",
  aviso: "#B7791F", avisoSuave: "#FBF1DC",
  alerta: "#B42318", alertaSuave: "#FBE4E1",
};
const FONDO = "#EEF1EF";

/** Selecciones: verde institucional suave. */
const CHIP_ON = { background: C.acentoSuave, color: C.acento };
const CHIP_OFF = { background: "transparent", color: C.texto2 };

// =====================================================================
// UTILIDADES
// =====================================================================

// Negativos entre paréntesis (convención contable)
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
function pct(frac: number, d = 1): string {
  return (frac * 100).toFixed(d).replace(".", ",") + " %";
}
const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** fetch que SÍ avisa cuando la API responde con error (fetch solo falla si no hay conexión). */
async function llamar(url: string, init?: RequestInit): Promise<unknown> {
  const r = await apiFetch(url, init);
  let d: unknown = null;
  try { d = await r.json(); } catch { /* respuesta sin JSON */ }
  const err = (d as { error?: string } | null)?.error;
  if (!r.ok || err) throw new Error(`${init?.method ?? "GET"} ${url.split("?")[0]} → ${err ?? `error ${r.status}`}`);
  return d;
}

// =====================================================================
// TIPOS DE LAS APIS (sin cambios)
// =====================================================================

interface DetalleMesActivoFijo {
  mes: number; costoInicioMes: number; adquisicionDelMes: number; costoFinMes: number;
  depreciacionAcumuladaInicioMes: number; depreciacionDelMes: number; depreciacionAcumulada: number;
  valorNetoEnLibros: number; tasas: { factorAnual: number };
}
interface DetalleMesTerrenos { mes: number; costoInicioMes: number; adquisicionDelMes: number; costoFinMes: number }
interface Compra { descripcion: string; departamentoReal: string; modo: string; agencia: string; montosPorMes: number[] }

// Registro de activos fijos (reporte de la contadora) usado en el cálculo
interface Registro {
  fechaCorte: string; bienes: number; terminanPorMes: number[];
  porCategoria: Record<string, { bienes: number; depreciados: number; siguen: number; terminanEnAnio: number }>;
}
interface Comparacion { antes: Record<string, number>; ahora: Record<string, number> }
interface Bien {
  codigo: string; descripcion: string; fechaActivacion: string; costo: number; cuota: number; cuotaCalculada: boolean;
  netoInicio: number; depAnio: number; netoFin: number; termina: string | null; terminaEnAnio: boolean; depreciado: boolean;
}
function mesAnio(aaaamm: string | null): string {
  if (!aaaamm) return "—";
  const [a, m] = aaaamm.split("-");
  return `${MESES[Number(m) - 1].toLowerCase()}-${a}`;
}

// Resumen de una categoría, calculado con los datos que ya entrega la API
interface ResumenCategoria {
  cat: Categoria;
  costoIni: number; costoFin: number; compras: number;
  depAnio: number; depAcum: number; neto: number[]; // neto mes a mes
  depreciado: number | null; vidaMeses: number | null; factor: number | null;
}

function resumir(cat: Categoria, cats: Record<string, DetalleMesActivoFijo[]>, terrenos: DetalleMesTerrenos[] | null): ResumenCategoria | null {
  if (!cat.depreciable) {
    if (!terrenos) return null;
    return {
      cat, costoIni: terrenos[0].costoInicioMes, costoFin: terrenos[11].costoFinMes,
      compras: suma(terrenos.map((f) => f.adquisicionDelMes)), depAnio: 0, depAcum: 0,
      neto: terrenos.map((f) => f.costoFinMes), depreciado: null, vidaMeses: null, factor: null,
    };
  }
  const f = cats[cat.nombre];
  if (!f) return null;
  const depMesDic = Math.abs(f[11].depreciacionDelMes);
  return {
    cat, costoIni: f[0].costoInicioMes, costoFin: f[11].costoFinMes,
    compras: suma(f.map((x) => x.adquisicionDelMes)),
    depAnio: suma(f.map((x) => Math.abs(x.depreciacionDelMes))),
    depAcum: Math.abs(f[11].depreciacionAcumulada),
    neto: f.map((x) => x.valorNetoEnLibros),
    depreciado: f[11].costoFinMes ? Math.abs(f[11].depreciacionAcumulada) / f[11].costoFinMes : null,
    vidaMeses: depMesDic > 0 ? f[11].valorNetoEnLibros / depMesDic : null,
    factor: f[11].tasas.factorAnual,
  };
}

// =====================================================================
// PIEZAS COMUNES
// =====================================================================

/** Selector limpio: marco fino en blanco y la opción elegida en verde suave con texto verde (igual que Cartera). */
function Pastillas<T extends string>({ opciones, valor, onChange, etiqueta, chico }: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string; chico?: boolean;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap p-[3px] gap-0.5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => {
        const on = valor === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on}
                  className={chico ? "h-7 px-2.5 rounded text-[12px] transition-colors" : "h-8 px-3.5 rounded-md text-[13px] transition-colors"}
                  style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { background: "transparent", color: C.texto2 }}>
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
  return <Pastillas {...props} chico />;
}

function ChipsMes({ valor, onChange }: { valor: number; onChange: (i: number) => void }) {
  return (
    <div role="group" aria-label="Mes de la fórmula" className="flex flex-wrap gap-0.5">
      {MESES.map((m, i) => (
        <button key={m} type="button" onClick={() => onChange(i)} aria-pressed={valor === i}
                className="w-[31px] h-[23px] rounded-md text-[11px] font-semibold"
                style={valor === i ? CHIP_ON : CHIP_OFF}>
          {m}
        </button>
      ))}
    </div>
  );
}

/** Indicador en tarjeta propia (igual que Cartera). */
function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: string; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}

/** Tonos suaves para la barra de "depreciado": se entiende el semáforo sin colores fuertes. */
function colorDepreciado(v: number) {
  return v >= 0.9 ? "#E3A08F" : v >= 0.7 ? "#E6CB93" : "#8DB39B";
}

// =====================================================================
// PÁGINA
// =====================================================================

function ActivosFijosContenido() {
  const searchParams = useSearchParams();
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>(searchParams.get("tab") === "plan" ? "plan" : "resumen");
  const [seleccion, setSeleccion] = useState<Seleccion>("TODAS");
  const [version, setVersion] = useState(0);
  const ticketSync = useEscucharSincronizacion();

  const url = `/api/activos-fijos?agencia=${encodeURIComponent(agencia)}`;
  const cached = obtenerJSONCache<{
    categorias?: Record<string, DetalleMesActivoFijo[]>;
    terrenos?: DetalleMesTerrenos[];
    registro?: Registro;
    corteSaldos?: { anio: number; mes: number };
    comparacion?: Comparacion;
  }>(url);

  const [cats, setCats] = useState<Record<string, DetalleMesActivoFijo[]> | null>(() => cached?.categorias ?? null);
  const [terrenos, setTerrenos] = useState<DetalleMesTerrenos[] | null>(() => cached?.terrenos ?? null);
  const [registro, setRegistro] = useState<Registro | null>(() => cached?.registro ?? null);
  const [comparacion, setComparacion] = useState<Comparacion | null>(() => cached?.comparacion ?? null);
  const [cargando, setCargando] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);

  const [compras, setCompras] = useState<Record<string, Compra[]>>(() => {
    const init: Record<string, Compra[]> = {};
    for (const c of CATEGORIAS) {
      const k = `/api/activos-fijos-compras?concepto=${c.codigo}`;
      const d = obtenerJSONCache<{ compras?: Compra[] }>(k);
      if (d?.compras) init[c.nombre] = d.compras;
    }
    return init;
  });

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = obtenerJSONCache<{
      categorias?: Record<string, DetalleMesActivoFijo[]>;
      terrenos?: DetalleMesTerrenos[];
      registro?: Registro;
      corteSaldos?: { anio: number; mes: number };
      comparacion?: Comparacion;
    }>(url);

    if (enCache) {
      setCats(enCache.categorias ?? {});
      setTerrenos(enCache.terrenos ?? null);
      setRegistro(enCache.registro ?? null);
      setComparacion(enCache.comparacion ?? null);
      setCargando(false);
    } else {
      setCats({}); setTerrenos(null); setRegistro(null); setComparacion(null);
      setCargando(true);
    }
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (d.error) {
          if (!enCache) setError(d.error);
          return;
        }
        guardarJSONCache(url, d);
        setCats(d.categorias ?? {});
        setTerrenos(d.terrenos ?? null);
        setRegistro(d.registro ?? null);
        setComparacion(d.comparacion ?? null);
      })
      .catch(() => {
        if (vivo && !enCache) setError("Error de conexión al cargar Activos fijos.");
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [agencia, version, ticketSync]);

  function cargarCompras() {
    return Promise.all(
      CATEGORIAS.map((c) =>
        apiFetch(`/api/activos-fijos-compras?concepto=${c.codigo}`)
          .then((r) => r.json())
          .then((d) => [c.nombre, d.compras ?? []] as [string, Compra[]])
      )
    ).then((entradas) => setCompras(Object.fromEntries(entradas)));
  }
  const esConsolidado = agencia === "Consolidado";
  // El Plan de adquisiciones es por agencia: en Consolidado no se muestra esa pestaña
  useEffect(() => { if (esConsolidado && pestana === "plan") setPestana("resumen"); }, [esConsolidado, pestana]);
  // En Consolidado no se lee el Plan de adquisiciones (ruta de parámetros): la página queda en solo lectura.
  useEffect(() => {
    if (esConsolidado) return;
    cargarCompras().catch(() => undefined);
  }, [version, ticketSync, esConsolidado]); // eslint-disable-line react-hooks/exhaustive-deps

  const resumenes = useMemo(
    () => (cats ? CATEGORIAS.map((c) => resumir(c, cats, terrenos)).filter((r): r is ResumenCategoria => !!r) : []),
    [cats, terrenos],
  );
  const totalCompras = Object.values(compras).reduce((n, l) => n + l.length, 0);

  const netoTotal = MESES.map((_, i) => suma(resumenes.map((r) => r.neto[i])));
  const netoIni = suma(resumenes.map((r) => r.costoIni)) - suma(resumenes.map((r) => {
    const f = cats?.[r.cat.nombre];
    return f ? Math.abs(f[0].depreciacionAcumuladaInicioMes) : 0;
  }));
  const depAnio = suma(resumenes.map((r) => r.depAnio));
  const comprasAnio = suma(resumenes.map((r) => r.compras));
  const regTot = registro ? Object.values(registro.porCategoria) : [];


  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50";
  // Selector de categoría: va a la derecha de la barra de título de la tabla (como el de líneas en Cartera)
  const selectorCategoria = (
    <Pastillas chico etiqueta="Categoría" valor={seleccion} onChange={setSeleccion}
               opciones={[{ id: "TODAS", label: "Todas" }, ...CATEGORIAS.map((c) => ({ id: c.nombre, label: c.label }))]} />
  );
  const tabs: { id: Pestana; label: string; badge?: number }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "saldos", label: "Saldos" },
    { id: "bienes", label: "Bienes" },
    { id: "plan", label: "Plan de adquisiciones", badge: totalCompras },
    { id: "analisis", label: "Análisis" },
  ];

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>

      {/* Encabezado: título; a la derecha, fecha de los datos y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Activos fijos<AnioEjercicio /></h1>
        {pestana === "resumen" && (
          <button type="button" onClick={() => void exportarPantalla()} disabled={!resumenes.length} title="Exportar a Excel" className={accion} style={{ color: C.acento }}>
            <Download size={16} /> Exportar
          </button>
        )}
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones de activos fijos" className="flex flex-wrap gap-x-7 flex-1">
          {tabs.filter((t) => !(esConsolidado && t.id === "plan")).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={pestana === t.id} onClick={() => setPestana(t.id)}
                    className="pt-2 pb-2.5 -mb-px flex items-center gap-1.5 text-[13px]"
                    style={{ color: pestana === t.id ? C.acento : C.texto2, fontWeight: pestana === t.id ? 600 : 400, borderBottom: `2px solid ${pestana === t.id ? C.acento : "transparent"}` }}>
              {t.label}
              {t.badge ? <span className="text-[11px] font-semibold px-1.5 rounded" style={{ background: C.crema, color: C.texto2 }}>{t.badge}</span> : null}
            </button>
          ))}
        </div>
        {(pestana !== "plan" || esConsolidado) && (
          <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
            Agencia
            <select value={agencia} onChange={(e) => setAgencia(e.target.value)}
                    className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
              {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {/* Indicadores (solo en Resumen): tarjetas separadas */}
      {pestana === "resumen" && resumenes.length > 0 && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {(() => {
            const vNeto = netoIni ? netoTotal[11] - netoIni : null;
            return (
              <>
                <Indicador titulo={`Valor neto en libros dic-${ejercicioEnUso()}`} valor={usd(netoTotal[11])}
                  pie={vNeto === null ? "—" : `${vNeto >= 0 ? "Sube" : "Baja"} ${usd(Math.abs(vNeto))} en el año`} />
                <Indicador titulo="Depreciación del año" valor={usd(depAnio)} pie={`≈ ${usd(depAnio / 12)} al mes`} />
                <Indicador titulo="Compras planificadas del año" valor={usd(comprasAnio)}
                  pie={comprasAnio ? `En ${agencia}, ya repartidas` : "Ninguna compra con efecto en esta agencia"} />
                {registro ? (
                  <Indicador titulo="Bienes" valor={numero(registro.bienes)}
                    pie={`${numero(suma(regTot.map((c) => c.siguen)))} se siguen depreciando · ${numero(suma(regTot.map((c) => c.depreciados)))} ya depreciados`} />
                ) : (
                  <Indicador titulo="Bienes" valor="—" pie="Sin registro de activos cargado" />
                )}
              </>
            );
          })()}
        </div>
      )}

      {pestana === "plan" && esConsolidado ? null : pestana === "plan" ? (
        <PlanAdquisiciones compras={compras} onCambio={() => setVersion((v) => v + 1)} />
      ) : cargando ? (
        <EsqueletoTabla filas={8} />
      ) : error ? (
        <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      ) : pestana === "saldos" ? (
        <SaldosAF datos={{ categorias: cats ?? undefined, terrenos: terrenos ?? undefined }} agencia={agencia} esConsolidado={esConsolidado} />
      ) : pestana === "bienes" ? (
        <ListaBienes agencia={agencia} registro={registro} />
      ) : pestana === "resumen" ? (
        <div className="flex flex-col gap-4">
          {seleccion === "TODAS"
            ? <ResumenTodas resumenes={resumenes} registro={registro} onElegir={setSeleccion} barra={selectorCategoria} />
            : (() => {
                const cat = CATEGORIAS.find((c) => c.nombre === seleccion)!;
                const res = resumenes.find((r) => r.cat.nombre === seleccion) ?? null;
                return (
                  <>
                    {cat.depreciable
                      ? <FactorDepreciacion key={cat.nombre} categoria={cat} resumen={res} soloLectura={esConsolidado} onGuardado={() => setVersion((v) => v + 1)} />
                      : (
                        <div className="tarjeta px-5 py-3.5 text-[12px]" style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>
                          Los terrenos no se deprecian: su costo solo cambia con nuevas compras del Plan de adquisiciones.
                        </div>
                      )}
                    <DetalleCategoria categoria={cat} filas={cat.depreciable ? cats?.[cat.nombre] ?? null : null} terrenos={terrenos} barra={selectorCategoria} />
                  </>
                );
              })()}
        </div>
      ) : (
        <Analisis resumenes={resumenes} netoTotal={netoTotal} comprasAnio={comprasAnio} agencia={agencia}
                  registro={registro} comparacion={comparacion} />
      )}
    </div>
  );
}

// =====================================================================
// RESUMEN DE TODAS LAS CATEGORÍAS
// =====================================================================

function ResumenTodas({ resumenes, registro, onElegir, barra }: { resumenes: ResumenCategoria[]; registro: Registro | null; onElegir: (s: string) => void; barra?: React.ReactNode }) {
  const tot = {
    costoFin: suma(resumenes.map((r) => r.costoFin)), depAnio: suma(resumenes.map((r) => r.depAnio)),
    neto: suma(resumenes.map((r) => r.neto[11])),
    bienes: registro ? registro.bienes : 0,
  };
  const celda = (v: number, color?: string) => (
    <td className="px-4 text-right whitespace-nowrap" style={{ color: Math.round(v) === 0 ? C.tenue : color ?? C.texto }}>
      {Math.round(v) === 0 ? "—" : numero(v)}
    </td>
  );
  return (
    <div className="flex flex-col gap-2">
      <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="flex-1 text-[14px] font-semibold">Resumen por categoría</h2>
        {barra}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[12px] border-collapse min-w-[810px]">
          {/* Categoría · 4 columnas de cifras del mismo ancho · columna de la barra más ancha */}
          <colgroup>
            <col />
            {registro && <col style={{ width: "14%" }} />}
            <col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr className="text-[12px] font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 34 }}>
              <th className="pl-4 text-left font-semibold">Categoría</th>
              {registro && <th className="px-4 text-right font-semibold">Bienes</th>}
              <th className="px-4 text-right font-semibold">Costo</th>
              <th className="px-4 text-right font-semibold">Depreciación año</th>
              <th className="px-4 text-right font-semibold">Valor neto Dic</th>
              <th className="px-4 text-right font-semibold">Depreciado a Dic</th>
            </tr>
          </thead>
          <tbody>
            {resumenes.map((r) => (
              <tr key={r.cat.nombre} onClick={() => onElegir(r.cat.nombre)} className="cursor-pointer hover:bg-[#F5F7F6]"
                  style={{ borderTop: `1px solid ${C.beige}`, height: 32 }} title={`Ver el detalle mes a mes de ${r.cat.label}`}>
                <td className="pl-4 font-semibold" style={{ color: C.texto }}>{r.cat.label}</td>
                {registro && celda(registro.porCategoria[r.cat.nombre]?.bienes ?? 0, C.texto)}
                {celda(r.costoFin)}
                {celda(-r.depAnio, C.texto3)}
                <td className="px-4 text-right font-semibold whitespace-nowrap" style={{ color: Math.round(r.neto[11]) === 0 ? C.tenue : C.texto }}>
                  {Math.round(r.neto[11]) === 0 ? "—" : numero(r.neto[11])}
                </td>
                {/* Alineada a la derecha como las cifras: todas las columnas terminan en el mismo ritmo */}
                <td className="px-4 text-right">
                  {r.depreciado === null ? <span className="text-[12px]" style={{ color: C.tenue }}>No se deprecia</span> : (
                    <div className="flex items-center justify-end gap-2.5">
                      <div className="w-[90px] h-[6px] rounded-full overflow-hidden" style={{ background: C.beige }}>
                        <div className="h-[6px] rounded-full" style={{ width: `${Math.min(r.depreciado, 1) * 100}%`, background: colorDepreciado(r.depreciado) }} />
                      </div>
                      <span className="w-[40px] text-right text-[12px] whitespace-nowrap" style={{ color: C.texto3 }}>{pct(r.depreciado, 0)}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid #B9C3BD", height: 34, background: "#FFFFFF" }} className="font-bold">
              <td className="pl-4">Total</td>
              {registro && celda(tot.bienes)}
              {celda(tot.costoFin)}{celda(-tot.depAnio)}{celda(tot.neto)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      </section>
      {!registro && (
        <p className="text-[12px]" style={{ color: C.texto2 }}>
          Esta agencia no tiene cargado el registro de activos fijos: la depreciación se calcula como costo × factor ÷ 12. Súbelo en <a href="/carga-datos" className="font-semibold underline" style={{ color: C.acento }}>Carga de datos</a>.
        </p>
      )}
    </div>
  );
}

// =====================================================================
// SALDOS MENSUALES (igual que el grupo 18 del Balance) y, en Consolidado, por agencia
// =====================================================================

interface DatosAF { categorias?: Record<string, DetalleMesActivoFijo[]>; terrenos?: DetalleMesTerrenos[] }

/** Series del grupo 18 a partir de la respuesta de /api/activos-fijos (mismas cifras que el Balance). */
function seriesAF(d: DatosAF) {
  const cero = () => Array(12).fill(0) as number[];
  const costo: Record<string, number[]> = {};
  const dep: Record<string, number[]> = {};
  const depMes: Record<string, number[]> = {};
  for (const c of CATEGORIAS) {
    if (!c.depreciable) { costo[c.nombre] = d.terrenos ? d.terrenos.map((t) => t.costoFinMes) : cero(); continue; }
    const f = d.categorias?.[c.nombre];
    costo[c.nombre] = f ? f.map((x) => x.costoFinMes) : cero();
    dep[c.nombre] = f ? f.map((x) => -Math.abs(x.depreciacionAcumulada)) : cero();
    depMes[c.nombre] = f ? f.map((x) => Math.abs(x.depreciacionDelMes)) : cero();
  }
  const sumar = (o: Record<string, number[]>) => MESES.map((_, i) => Object.values(o).reduce((t, v) => t + v[i], 0));
  const totCosto = sumar(costo), totDep = sumar(dep);
  return { costo, dep, depMes, totCosto, totDep, totDepMes: sumar(depMes), neto: totCosto.map((v, i) => v + totDep[i]) };
}

function SaldosAF({ datos, agencia, esConsolidado }: { datos: DatosAF; agencia: string; esConsolidado: boolean }) {
  const [vista, setVista] = useState<"cuentas" | "agencias">("cuentas");
  const s = seriesAF(datos);
  const nombre = (c: Categoria) => `${c.codigo} · ${c.nombre}`;
  const filas: FilaComun[] = [
    ...CATEGORIAS.map((c): FilaComun => {
      const v = s.costo[c.nombre];
      const det = c.depreciable ? datos.categorias?.[c.nombre] : null;
      return { id: `c-${c.nombre}`, label: nombre(c), valores: v, total: v[11],
        formula: (i) => det
          ? `Costo al inicio de ${MESES[i]} + compras del mes = ${usd(det[i].costoInicioMes)} + ${usd(det[i].adquisicionDelMes)} = ${usd(v[i])}.`
          : datos.terrenos
            ? `Costo al inicio de ${MESES[i]} + compras del mes = ${usd(datos.terrenos[i].costoInicioMes)} + ${usd(datos.terrenos[i].adquisicionDelMes)} = ${usd(v[i])}. No se deprecia.`
            : `Sin datos.` };
    }),
    { id: "tc", label: "Total costo", valores: s.totCosto, total: s.totCosto[11], clave: true,
      formula: (i) => `Suma del costo de las categorías en ${MESES[i]}: ${usd(s.totCosto[i])}.` },
    ...CATEGORIAS.filter((c) => c.depreciable).map((c): FilaComun => {
      const v = s.dep[c.nombre];
      return { id: `d-${c.nombre}`, label: nombre(c), valores: v, total: v[11],
        formula: (i) => `Depreciación acumulada del mes anterior + depreciación de ${MESES[i]} = ${usd(Math.abs(i === 0 ? v[0] + s.depMes[c.nombre][0] : v[i - 1]))} + ${usd(s.depMes[c.nombre][i])} = ${usd(Math.abs(v[i]))}.` };
    }),
    { id: "td", label: "Total depreciación acumulada", valores: s.totDep, total: s.totDep[11], clave: true,
      formula: (i) => `Suma de la depreciación acumulada de las categorías en ${MESES[i]}: ${usd(Math.abs(s.totDep[i]))}.` },
    { id: "neto", label: "Activo fijo neto · 18", valores: s.neto, total: s.neto[11], clave: true, separador: true,
      formula: (i) => `Total costo − depreciación acumulada = ${usd(s.totCosto[i])} − ${usd(Math.abs(s.totDep[i]))} = ${usd(s.neto[i])}. Es el saldo de la cuenta 18 en el Balance${esConsolidado ? "" : ` de ${agencia}`}.` },
  ];
  return (
    <TarjetaComun titulo={vista === "cuentas" ? "Saldos mensuales · 18" : "Saldos por agencia · 18"}
      derecha={esConsolidado ? (
        <BotonesVista etiqueta="Vista de saldos" valor={vista} onChange={setVista}
          opciones={[{ id: "cuentas", label: "Por cuenta" }, { id: "agencias", label: "Por agencia" }]} />
      ) : undefined}>
      {esConsolidado && vista === "agencias" ? (
        <ResumenPorAgencia<DatosAF> url={(a) => `/api/activos-fijos?agencia=${encodeURIComponent(a)}`} conceptos={[
          { id: "neto", label: "Activo fijo neto", valores: (d) => seriesAF(d).neto },
          { id: "costo", label: "Costo", valores: (d) => seriesAF(d).totCosto },
          { id: "dep", label: "Depreciación acumulada", valores: (d) => seriesAF(d).totDep },
          { id: "depmes", label: "Depreciación del mes", valores: (d) => seriesAF(d).totDepMes, tipo: "suma" },
        ]} />
      ) : (
        <TablaMesesComun titulo="Cuenta" ultima="Año" titulosAparte filas={filas}
          grupos={{ "c-Terrenos": "Costo", "d-Edificios": "(Depreciación acumulada) · 1899" }} />
      )}
    </TarjetaComun>
  );
}

// =====================================================================
// BIENES (registro bien por bien)
// =====================================================================

const POR_PAGINA = 10;

function ListaBienes({ agencia, registro }: { agencia: string; registro: Registro | null }) {
  const depreciables = CATEGORIAS.filter((c) => c.depreciable);
  const [categoria, setCategoria] = useState<string>(depreciables[0].nombre);
  const [bienes, setBienes] = useState<Bien[]>([]);
  const [todos, setTodos] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registro) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    setPagina(0);
    apiFetch(`/api/activos-fijos-bienes?agencia=${encodeURIComponent(agencia)}&categoria=${encodeURIComponent(categoria)}${todos ? "&todos=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (d.error) { setError(d.error); return; }
        setBienes(d.bienes ?? []);
      })
      .catch(() => { if (vivo) setError("Error de conexión al cargar los bienes."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [agencia, categoria, todos, registro]);

  if (!registro) {
    return (
      <div className="tarjeta px-6 py-8 flex flex-col items-center gap-2 text-center">
        <span className="text-[13px] font-semibold">{agencia} no tiene cargado el registro de activos fijos</span>
        <span className="text-[12px] max-w-[414px]" style={{ color: C.texto2 }}>
          Sube el reporte de la contadora en <a href="/carga-datos" className="font-semibold underline" style={{ color: C.acento }}>Carga de datos</a> para ver aquí cada bien y su depreciación.
        </span>
      </div>
    );
  }

  const q = buscar.trim().toLowerCase();
  const filtrados = q ? bienes.filter((b) => b.codigo.toLowerCase().includes(q) || b.descripcion.toLowerCase().includes(q)) : bienes;
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const visibles = filtrados.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const info = registro.porCategoria[categoria];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Categoría" className="flex flex-wrap gap-0.5">
          {depreciables.map((c) => (
            <button key={c.nombre} type="button" onClick={() => { setCategoria(c.nombre); setBuscar(""); }} aria-pressed={categoria === c.nombre}
                    className="h-7 px-3 rounded-md text-[12px] font-semibold"
                    style={categoria === c.nombre ? CHIP_ON : CHIP_OFF}>{c.label}</button>
          ))}
        </div>
        <div className="flex-1" />
        {info && info.depreciados > 0 && (
          <button type="button" onClick={() => setTodos((t) => !t)} aria-pressed={todos}
                  className="h-7 px-3 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5"
                  style={todos ? CHIP_ON : { border: `1px solid ${C.borde}`, color: C.texto2 }}>
            {todos && <Check size={12} />} Incluir ya depreciados ({numero(info.depreciados)})
          </button>
        )}
        <label className="h-8 w-[198px] px-3 rounded-md bg-white flex items-center gap-2" style={{ border: `1px solid ${C.borde}` }}>
          <Search size={13} color={C.tenue} />
          <input value={buscar} onChange={(e) => { setBuscar(e.target.value); setPagina(0); }} placeholder="Buscar bien"
                 aria-label="Buscar por código o descripción" className="flex-1 min-w-0 bg-transparent outline-none text-[12px]" />
        </label>
      </div>

      <div className="tarjeta overflow-x-auto" style={{ border: `1px solid ${C.borde}` }}>
        <table className="w-full text-[12px] border-collapse min-w-[882px]">
          <thead>
            <tr className="text-[12px] font-semibold" style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <th className="pl-4 py-2.5 text-left font-semibold">Código</th>
              <th className="px-3 py-2.5 text-left font-semibold">Descripción</th>
              <th className="px-3 py-2.5 text-right font-semibold">Costo</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cuota mes</th>
              <th className="px-3 py-2.5 text-right font-semibold">Deprec. {ejercicioEnUso()}</th>
              <th className="px-3 py-2.5 text-right font-semibold">Neto Dic</th>
              <th className="pr-4 py-2.5 text-right font-semibold">Termina</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} className="px-4 py-6 text-[12px]" style={{ color: C.texto2 }}>Cargando bienes...</td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-6 text-[12px]" style={{ color: C.alerta }}>{error}</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-[12px]" style={{ color: C.texto2 }}>{q ? "Ningún bien coincide con la búsqueda." : "No hay bienes que se sigan depreciando en esta categoría."}</td></tr>
            ) : visibles.map((b) => (
              <tr key={b.codigo} className="hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                <td className="pl-4 text-[12px] whitespace-nowrap" style={{ color: C.texto2 }}>{b.codigo}</td>
                <td className="px-3 max-w-[414px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate" title={b.descripcion}>{b.descripcion}</span>
                    {b.cuotaCalculada && (
                      <span className="shrink-0 text-[11px] font-bold px-2 py-px rounded-md" title="El reporte trae cuota 0 porque se activó en el mes del corte; la cuota se calcula con costo − residual ÷ vida útil"
                            style={{ background: C.acentoSuave, color: C.acento }}>NUEVO</span>
                    )}
                  </div>
                </td>
                {[b.costo, b.cuota, b.depAnio, b.netoFin].map((v, i) => (
                  <td key={i} className={`px-3 text-right whitespace-nowrap ${i === 3 ? "font-semibold" : ""}`} style={{ color: Math.abs(v) < 0.005 ? C.tenue : C.texto }}>
                    {Math.abs(v) < 0.005 ? "—" : i === 1 ? "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : usd(v)}
                  </td>
                ))}
                <td className="pr-4 text-right whitespace-nowrap" style={{ color: b.depreciado ? C.tenue : b.terminaEnAnio ? C.aviso : C.texto3 }}>
                  {b.depreciado ? "depreciado" : mesAnio(b.termina)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > 0 && (
          <div className="flex items-center gap-3 px-4 h-10 text-[12px]" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2 }}>
            <span className="flex-1">
              {filtrados.length > POR_PAGINA ? `${numero(pagina * POR_PAGINA + 1)}–${numero(Math.min((pagina + 1) * POR_PAGINA, filtrados.length))} de ` : ""}{numero(filtrados.length)} bienes
              {info && info.terminanEnAnio > 0 && <> · <span style={{ color: C.aviso }}>{numero(info.terminanEnAnio)} terminan en {ejercicioEnUso()}</span></>}
            </span>
            {paginas > 1 && (
              <>
                <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="font-semibold disabled:opacity-40" style={{ color: C.texto3 }}>‹ Anterior</button>
                <span>{pagina + 1} / {paginas}</span>
                <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)} className="font-semibold disabled:opacity-40" style={{ color: C.texto3 }}>Siguiente ›</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// FACTOR DE DEPRECIACIÓN (bloqueado hasta presionar Editar)
// =====================================================================

function FactorDepreciacion({ categoria, resumen, soloLectura, onGuardado }: { categoria: Categoria; resumen: ResumenCategoria | null; soloLectura?: boolean; onGuardado: () => void }) {
  const [factor, setFactor] = useState<number | null>(null); // en %
  const [factorTxt, setFactorTxt] = useState("");
  const [original, setOriginal] = useState<number | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);

  useEffect(() => {
    apiFetch("/api/factores-depreciacion").then((r) => r.json()).then((d) => {
      const v = (d.factores?.[categoria.nombre] ?? 0) * 100;
      setFactor(v); setOriginal(v);
    }).catch(() => setMsg({ t: "No se pudo leer el factor.", e: true }));
  }, [categoria.nombre]);

  async function guardar() {
    const lf = leerMonto(factorTxt);
    if (lf.error || lf.valor === null) { setMsg({ t: `Factor: ${lf.error ?? "escriba el factor"}.`, e: true }); return; }
    if (lf.valor < 0 || lf.valor > 100) { setMsg({ t: "El factor anual debe estar entre 0 % y 100 %.", e: true }); return; }
    if (guardando) return;
    setGuardando(true);
    setMsg(null);
    try {
      const r = await apiFetch("/api/factores-depreciacion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria: categoria.nombre, factor_anual: lf.valor / 100 }),
      });
      const err = await errorDeRespuesta(r);
      if (err) throw new Error(err);
      setOriginal(factor);
      setEditando(false);
      setMsg({ t: "Factor guardado. Aplica a las 10 agencias." });
      onGuardado();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally {
      setGuardando(false);
    }
  }

  const cambio = factor !== null && original !== null && Math.abs(factor - original) > 1e-9;
  const vidaUtil = factor ? 100 / factor : null;

  return (
    <div className="tarjeta px-5 py-4 flex flex-wrap items-center gap-5"
         style={{ border: `1px solid ${editando ? "#8DB39B" : C.borde}`, boxShadow: editando ? `0 0 0 2px ${C.acentoSuave}` : "none" }}>
      <div className="flex-1 min-w-[270px] flex flex-col gap-1">
        <span className="text-[12px] font-semibold" style={{ color: C.texto2 }}>Parámetro · {categoria.label}</span>
        <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: C.texto3 }}>
          Factor de depreciación anual
          {editando ? (
            <span className="flex items-center gap-1">
              <input value={factorTxt} inputMode="decimal" aria-label="Factor de depreciación anual (%)" autoFocus
                     aria-invalid={!!leerMonto(factorTxt).error} title={leerMonto(factorTxt).error ?? undefined}
                     onChange={(e) => { setFactorTxt(e.target.value); const r = leerMonto(e.target.value); if (!r.error) setFactor(r.valor ?? 0); }}
                     className="h-[27px] w-[72px] rounded-md px-2.5 text-right font-semibold"
                     style={leerMonto(factorTxt).error ? { border: "1px solid #B42318", background: "#FDF2F1" } : { border: `1px solid ${cambio ? C.acento : C.borde}`, background: cambio ? C.acentoSuave : "#FFFFFF" }} />
              %
            </span>
          ) : (
            <b className="text-[14px]" style={{ color: C.texto }}>{factor === null ? "…" : `${factor.toFixed(2).replace(".", ",")} %`}</b>
          )}
          <span style={{ color: C.texto2 }}>
            {vidaUtil ? `· vida útil ${Number.isInteger(vidaUtil) ? vidaUtil : vidaUtil.toFixed(1).replace(".", ",")} años ` : ""}· institucional, igual en las 10 agencias
          </span>
        </div>
        {editando && <span className="text-[12px]" style={{ color: "#6E4A0E" }}>Modo edición: el cambio se aplica solo al presionar Guardar.</span>}
        {msg && <span className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</span>}
      </div>

      {resumen?.depreciado != null && (
        <div className="flex flex-col items-end gap-1">
          <span className="text-[12px]" style={{ color: C.texto2 }}>Depreciado al cierre de {ejercicioEnUso()}</span>
          <div className="flex items-center gap-2">
            <div className="w-40 h-2 rounded-md overflow-hidden" style={{ background: C.beige }}>
              <div className="h-2" style={{ width: `${Math.min(resumen.depreciado, 1) * 100}%`, background: colorDepreciado(resumen.depreciado) }} />
            </div>
            <span className="text-[12px] font-bold">{pct(resumen.depreciado)}</span>
          </div>
        </div>
      )}

      {soloLectura ? null : !editando ? (
        <button type="button" onClick={() => { setFactorTxt(textoEditable(factor ?? 0, 4) || "0"); setEditando(true); setMsg(null); }}
                className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F5F7F6]"
                style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>
          <Pencil size={13} /> Editar
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setFactor(original); setEditando(false); }} disabled={guardando}
                  className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold disabled:opacity-50"
                  style={{ border: `1px solid ${C.borde}`, color: C.texto3 }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando || !cambio}
                  className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: C.acento }}>
            <Check size={13} /> {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// DETALLE DE UNA CATEGORÍA (mes a mes)
// =====================================================================

interface DefFila {
  label: string; valores: number[]; total: "inicio" | "fin" | "suma"; clave?: boolean; color?: "ok" | "alerta";
  formula?: (i: number) => string;
}

function DetalleCategoria({ categoria, filas, terrenos, barra }: { categoria: Categoria; filas: DetalleMesActivoFijo[] | null; terrenos: DetalleMesTerrenos[] | null; barra?: React.ReactNode }) {
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);
  const [mesFormula, setMesFormula] = useState(11);

  let secciones: { titulo: string; sub: string; filas: DefFila[] }[] = [];
  if (categoria.depreciable && filas) {
    const f = filas;
    secciones = [
      {
        titulo: "Costo", sub: "valor de compra acumulado",
        filas: [
          { label: "Costo al inicio del mes", valores: f.map((x) => x.costoInicioMes), total: "inicio" },
          { label: "(+) Compras del mes", valores: f.map((x) => x.adquisicionDelMes), total: "suma", color: "ok",
            formula: (i) => `Suma de las compras del Plan de adquisiciones para este mes (prorrateadas por % de Activo de esta agencia, o directas si se registraron para ella): ${usd(f[i].adquisicionDelMes)}.` },
          { label: "Costo al final del mes", valores: f.map((x) => x.costoFinMes), total: "fin", clave: true },
        ],
      },
      {
        titulo: "Depreciación", sub: "se acumula mes a mes",
        filas: [
          { label: "Depreciación acumulada inicial", valores: f.map((x) => x.depreciacionAcumuladaInicioMes), total: "inicio" },
          { label: "(−) Depreciación del mes", valores: f.map((x) => x.depreciacionDelMes), total: "suma", color: "alerta",
            formula: (i) => `Costo al inicio del mes × factor anual ÷ 12, con tope en el valor neto que queda: ${usd(f[i].costoInicioMes)} × ${pct(f[i].tasas.factorAnual, 2)} ÷ 12 = ${usd(f[i].depreciacionDelMes)}.` },
          { label: "Depreciación acumulada final", valores: f.map((x) => x.depreciacionAcumulada), total: "fin", clave: true },
        ],
      },
      {
        titulo: "Valor neto en libros", sub: "costo − depreciación acumulada",
        filas: [
          { label: "Valor neto al cierre del mes", valores: f.map((x) => x.valorNetoEnLibros), total: "fin", clave: true,
            formula: (i) => `Costo al final del mes + depreciación acumulada (nunca menos de $0): ${usd(f[i].costoFinMes)} + ${usd(f[i].depreciacionAcumulada)} = ${usd(f[i].valorNetoEnLibros)}.` },
        ],
      },
    ];
  } else if (!categoria.depreciable && terrenos) {
    const t = terrenos;
    secciones = [{
      titulo: "Costo", sub: "los terrenos no se deprecian",
      filas: [
        { label: "Costo al inicio del mes", valores: t.map((x) => x.costoInicioMes), total: "inicio" },
        { label: "(+) Compras del mes", valores: t.map((x) => x.adquisicionDelMes), total: "suma", color: "ok",
          formula: (i) => `Suma de las compras del Plan de adquisiciones para este mes (prorrateadas o directas a esta agencia): ${usd(t[i].adquisicionDelMes)}.` },
        { label: "Costo al final del mes", valores: t.map((x) => x.costoFinMes), total: "fin", clave: true },
      ],
    }];
  }

  if (!secciones.length) return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="flex-1 text-[14px] font-semibold">Proyección mensual · {categoria.label}</h2>
        {barra}
      </div>
      <p className="px-4 py-4 text-[13px]" style={{ color: C.texto2 }}>No hay datos para {categoria.label}.</p>
    </section>
  );

  // Columnas que se reparten solas en el ancho disponible (sin barra horizontal), como en Cartera
  const G = "grid grid-cols-[minmax(210px,2.6fr)_repeat(13,minmax(0,1fr))_26px] items-center";

  function Fila({ fila, si, grupo }: { fila: DefFila; si: number; grupo?: { titulo: string; primero: boolean } }) {
    const id = `${si}-${fila.label}`;
    const abierta = filaAbierta === id;
    const totalV = fila.total === "inicio" ? fila.valores[0] : fila.total === "fin" ? fila.valores[11] : suma(fila.valores);
    const fuerte = !!grupo || !!fila.clave;
    const txt = (v: number) => (Math.round(v) === 0 ? { t: "—", c: C.tenue } : { t: numero(v), c: fuerte ? C.texto : C.texto3 });
    const borde = grupo ? (grupo.primero ? "none" : "1px solid #DDE2DF") : fila.clave ? "1px solid #B9C3BD" : `1px solid ${C.beige}`;
    return (
      <div>
        <div className={`${G} h-9 hover:bg-[#F5F7F6]`} style={{ borderTop: borde, fontWeight: fuerte ? 600 : 400, background: "#FFFFFF" }}>
          {grupo ? (
            <div className="min-w-0 pl-4 pr-2 flex items-baseline gap-1.5 whitespace-nowrap overflow-hidden" title={`${grupo.titulo} · ${fila.label}`}>
              <span className="shrink-0 text-[12px] font-bold" style={{ color: C.acento }}>{grupo.titulo}</span>
              <span className="truncate text-[11px] font-normal" style={{ color: C.texto2 }}>· {fila.label.toLowerCase()}</span>
            </div>
          ) : (
            <div className="pl-8 pr-2 truncate text-[11px]" title={fila.label} style={{ color: fila.clave ? C.texto : C.texto3 }}>{fila.label}</div>
          )}
          {fila.valores.map((v, i) => { const x = txt(v); return <div key={i} className="px-1 text-right whitespace-nowrap" style={{ color: x.c }}>{x.t}</div>; })}
          <div className="px-1.5 text-right whitespace-nowrap font-semibold" style={{ color: txt(totalV).c }}>{txt(totalV).t}</div>
          <div className="flex justify-center">
            {fila.formula && (
              <button type="button" onClick={() => setFilaAbierta(abierta ? null : id)} aria-expanded={abierta}
                      aria-label={`Ver cómo se calcula ${fila.label}`} title="Ver cómo se calcula esta fila"
                      className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
                      style={abierta ? CHIP_ON : { color: C.tenue }}>ƒ</button>
            )}
          </div>
        </div>
        {abierta && fila.formula && (
          <div className="px-8 py-3 flex flex-wrap items-start gap-x-6 gap-y-2" style={{ background: "#F3F5F4", borderTop: `1px solid ${C.beige}` }}>
            <ChipsMes valor={mesFormula} onChange={setMesFormula} />
            <p className="flex-1 min-w-[288px] text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
              <span className="font-semibold" style={{ color: C.acento }}>{MESES[mesFormula]} · </span>{fila.formula(mesFormula)}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="flex-1 text-[14px] font-semibold">Proyección mensual · {categoria.label}</h2>
        {barra}
      </div>
      <div className="overflow-x-auto">
        <div className="tabla-cifras min-w-[1062px] text-[11px]">
          {/* Meses una sola vez */}
          <div className={`${G} h-9 text-[11px] font-semibold`} style={{ color: C.texto2, background: "#FFFFFF", borderBottom: "2px solid #DDE2DF" }}>
            <div className="pl-4">Concepto</div>
            {MESES.map((m) => <div key={m} className="px-1 text-right">{m}</div>)}
            <div className="px-1.5 text-right">Año</div>
            <div />
          </div>
          {/* Cada grupo: el título va en la fila de su primera cifra y hay un espacio blanco antes del siguiente */}
          {secciones.map((s, si) => (
            <div key={s.titulo} style={{ paddingTop: si ? 14 : 0 }}>
              <Fila fila={s.filas[0]} si={si} grupo={{ titulo: s.titulo, primero: si === 0 }} />
              {s.filas.slice(1).map((fila) => <Fila key={fila.label} fila={fila} si={si} />)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// PLAN DE ADQUISICIONES (misma lógica de guardado que la pantalla anterior)
// =====================================================================

const NUEVO_DEPARTAMENTO = "__nuevo__";

function PlanAdquisiciones({ compras, onCambio }: { compras: Record<string, Compra[]>; onCambio: () => void }) {
  const [departamentos, setDepartamentos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState<{ cat: Categoria; compra: Compra } | null>(null);
  const [editando, setEditando] = useState<{ cat: Categoria; compra: Compra } | null>(null);
  const [vista, setVista] = useState<"lista" | "meses">("lista");
  const [verPct, setVerPct] = useState(false);
  const [desactualizadas, setDesactualizadas] = useState(0);
  const [deQue, setDeQue] = useState<{ departamento: string; concepto: string; cuenta: string; valores: number }[]>([]);
  const [verDeQue, setVerDeQue] = useState(false);
  const [recalculando, setRecalculando] = useState(false);

  // ¿Hay compras o gastos repartidos con % distintos a los actuales?
  function revisarReparto() {
    llamar("/api/porcentajes-activo")
      .then((d) => {
        const x = d as { filasDesactualizadas?: number; desactualizadasPorCuenta?: typeof deQue };
        setDesactualizadas(x.filasDesactualizadas ?? 0); setDeQue(x.desactualizadasPorCuenta ?? []);
      })
      .catch(() => undefined);
  }
  useEffect(revisarReparto, [compras]);

  async function repartirDeNuevo() {
    setRecalculando(true);
    try {
      await llamar("/api/porcentajes-activo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "recalcular" }),
      });
      setMensaje("Listo: las compras y gastos prorrateados se repartieron con los % actuales.");
      onCambio();
    } catch (e) {
      setError(`No se pudo repartir de nuevo: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setRecalculando(false);
    }
  }

  // ---- formulario ----
  const [activo, setActivo] = useState<Categoria>(CATEGORIAS[1]);
  const [departamento, setDepartamento] = useState("");
  const [nuevoDeptoTexto, setNuevoDeptoTexto] = useState("");
  const [mostrandoNuevoDepto, setMostrandoNuevoDepto] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const montoValido = leerMonto(monto).valor ?? 0;
  const [aplicacion, setAplicacion] = useState<"mes" | "prorratear_anio">("prorratear_anio");
  const [mesSeleccionado, setMesSeleccionado] = useState(1);
  const [alcance, setAlcance] = useState<"prorrateo" | "agencia">("prorrateo");
  const [agenciaSeleccionada, setAgenciaSeleccionada] = useState("El Guabo");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiFetch("/api/departamentos").then((r) => r.json()).then((d) => setDepartamentos(d.departamentos ?? [])).catch(() => undefined);
  }, []);

  async function crearDepartamento() {
    const nombre = nuevoDeptoTexto.trim();
    if (!nombre) return;
    await apiFetch("/api/departamentos", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }),
    });
    setDepartamentos((prev) => (prev.includes(nombre) ? prev : [...prev, nombre].sort()));
    setDepartamento(nombre);
    setNuevoDeptoTexto("");
    setMostrandoNuevoDepto(false);
  }

  function limpiar() {
    setDepartamento(""); setDescripcion(""); setMonto("");
    setAplicacion("prorratear_anio"); setMesSeleccionado(1);
    setAlcance("prorrateo"); setAgenciaSeleccionada("El Guabo");
    setEditando(null);
    setError(null);
  }

  // Abre el formulario con los datos de una compra ya registrada
  function editarCompra(cat: Categoria, compra: Compra) {
    const meses = compra.montosPorMes.map((v, i) => (v !== 0 ? i : -1)).filter((i) => i >= 0);
    setActivo(cat);
    setDepartamento(compra.departamentoReal ?? "");
    setDescripcion(compra.descripcion);
    setMonto(textoEditable(suma(compra.montosPorMes)));
    if (meses.length === 1) { setAplicacion("mes"); setMesSeleccionado(meses[0] + 1); }
    else { setAplicacion("prorratear_anio"); setMesSeleccionado(1); }
    if (compra.modo === "prorrateado") setAlcance("prorrateo");
    else { setAlcance("agencia"); setAgenciaSeleccionada(compra.agencia); }
    setEditando({ cat, compra });
    setError(null);
    setMensaje(null);
    setAbierto(true);
  }

  // Quita una compra de las dos tablas donde vive (sin mensajes)
  async function borrarCompra(cat: Categoria, compra: Compra) {
    await llamar(`/api/presupuesto-departamental?departamento=${encodeURIComponent(compra.descripcion)}&concepto=${cat.codigo}`, { method: "DELETE" });
    if (compra.modo === "prorrateado") {
      await llamar(`/api/presupuesto-resumen?departamento=${encodeURIComponent(compra.descripcion)}&nombre=${encodeURIComponent(compra.descripcion)}`, { method: "DELETE" });
    }
  }

  async function guardarCompra() {
    const lm = leerMonto(monto);
    if (lm.error) { setError(`Monto: ${lm.error}.`); return; }
    if (!departamento.trim() || !descripcion.trim() || !lm.valor || lm.valor <= 0) {
      setError("Completa Departamento, Descripción y un Monto mayor a 0.");
      return;
    }
    // Al crear (no al editar) no se permite repetir la descripción en la misma categoría,
    // porque la descripción es la que identifica la compra.
    const repetida = (compras[activo.nombre] ?? []).some((c) => c.descripcion.trim().toLowerCase() === descripcion.trim().toLowerCase()
      && !(editando && editando.cat.nombre === activo.nombre && editando.compra.descripcion === c.descripcion));
    if (repetida) {
      setError(`Ya existe una compra "${descripcion.trim()}" en ${activo.label}. Usa otra descripción o edita la existente.`);
      return;
    }
    setGuardando(true);
    setError(null);
    // Escribe una compra (nueva o la anterior, si hay que restituirla).
    const escribir = async (cat: Categoria, desc: string, nota: string, prorrateo: boolean, agencia: string, montosPorMes: number[]) => {
      if (prorrateo) {
        await llamar("/api/presupuesto-resumen", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departamento: desc, nombre: desc, montosPorMes, nota }),
        });
        await llamar("/api/presupuesto-departamental", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion: "cambiar_modo", departamento: desc, concepto: cat.codigo,
            cuenta_nombre: cat.label, nuevoModo: "prorrateado", resumenNombre: desc,
          }),
        });
      } else {
        // Los 12 meses en una sola llamada (solo se crean los meses con compra)
        await llamar("/api/presupuesto-departamental", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            departamento: desc, concepto: cat.codigo, cuenta_nombre: cat.label,
            montosPorMes: montosPorMes.map((m) => (m === 0 ? null : m)), nota, modo: "directo", agencia,
          }),
        });
      }
    };
    const anterior = editando;
    let anteriorBorrada = false;
    try {
      // Editar = quitar la versión anterior y guardar la nueva; si la nueva falla, se restituye la anterior.
      if (anterior) { await borrarCompra(anterior.cat, anterior.compra); anteriorBorrada = true; }
      const montosPorMes = Array(12).fill(0);
      const montoNum = lm.valor;
      if (aplicacion === "mes") montosPorMes[mesSeleccionado - 1] = montoNum;
      else for (let i = 0; i < 12; i++) montosPorMes[i] = montoNum / 12;
      await escribir(activo, descripcion.trim(), departamento.trim(), alcance === "prorrateo", agenciaSeleccionada, montosPorMes);
      setMensaje(editando ? `Compra "${descripcion.trim()}" actualizada.` : `Compra "${descripcion.trim()}" registrada en ${activo.label}.`);
      limpiar();
      setAbierto(false);
      onCambio();
    } catch (e) {
      let restituida = "";
      if (anterior && anteriorBorrada) {
        try {
          const c = anterior.compra;
          await escribir(anterior.cat, c.descripcion, c.departamentoReal ?? "", c.modo === "prorrateado", c.agencia, c.montosPorMes);
          restituida = " Se restituyó la compra anterior sin cambios.";
        } catch {
          restituida = ` Tampoco se pudo restituir la compra anterior «${anterior.compra.descripcion}»: regístrela de nuevo.`;
        }
      }
      setError(`No se pudo guardar la compra: ${e instanceof Error ? e.message : "error de conexión"}.${restituida}`);
      onCambio(); // refresca la lista para ver cómo quedó
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarCompra(cat: Categoria, compra: Compra) {
    try {
      await borrarCompra(cat, compra);
      setMensaje(`Compra "${compra.descripcion}" eliminada.`);
      setConfirmar(null);
      onCambio();
    } catch (e) {
      setConfirmar(null);
      setError(`No se pudo eliminar la compra: ${e instanceof Error ? e.message : "error de conexión"}`);
      onCambio();
    }
  }

  const totalesPorCategoria: Record<string, number[]> = {};
  for (const cat of CATEGORIAS) {
    const lista = compras[cat.nombre] ?? [];
    totalesPorCategoria[cat.nombre] = MESES.map((_, i) => lista.reduce((s, c) => s + c.montosPorMes[i], 0));
  }
  const totalPorMes = MESES.map((_, i) => CATEGORIAS.reduce((s, cat) => s + totalesPorCategoria[cat.nombre][i], 0));
  const todas = CATEGORIAS.flatMap((cat) => (compras[cat.nombre] ?? []).map((c) => ({ ...c, cat })));


  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {todas.length > 0 && (
          <Segmentado etiqueta="Vista del plan" valor={vista} onChange={setVista}
            opciones={[{ id: "lista", label: `Compras (${todas.length})` }, { id: "meses", label: "Por mes" }]} />
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => setVerPct((v) => !v)} aria-pressed={verPct}
                className="h-8 px-3.5 rounded-md text-[12px] font-semibold" style={verPct ? { ...CHIP_ON, border: `1px solid ${C.acentoSuave}` } : { background: "#FFFFFF", border: `1px solid ${C.borde}`, color: C.texto3 }}>
          % de asignación
        </button>
        {!abierto && (
          <button type="button" onClick={() => { setAbierto(true); setMensaje(null); }}
                  className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5" style={{ background: C.acento }}>
            <Plus size={14} /> Registrar compra
          </button>
        )}
      </div>
      {mensaje && <p className="text-[12px]" style={{ color: C.ok }}>{mensaje}</p>}
      {!abierto && error && <p className="text-[12px]" style={{ color: C.alerta }}>{error}</p>}

      {desactualizadas > 0 && (
        <div role="note" className="flex flex-wrap items-center gap-3 rounded-md px-4 py-2.5 text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1 min-w-[234px]">
            Hay {numero(desactualizadas)} valores de compras o gastos prorrateados del presupuesto (no solo de activos fijos) que se repartieron con % de asignación anteriores. Repártelos de nuevo para que cada agencia reciba su % actual.
            {deQue.length > 0 && <button type="button" onClick={() => setVerDeQue((v) => !v)} className="ml-2 font-semibold underline">{verDeQue ? "Ocultar cuáles" : "Ver cuáles"}</button>}
          </span>
          <button type="button" onClick={repartirDeNuevo} disabled={recalculando}
                  className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>
            {recalculando ? "Repartiendo..." : "Repartir de nuevo"}
          </button>
          {verDeQue && (
            <table className="w-full text-[12px] border-collapse mt-1" style={{ color: C.texto }}>
              <thead><tr style={{ color: "#6E4A0E" }}><th className="text-left font-semibold py-1">Departamento</th><th className="text-left font-semibold">Cuenta</th><th className="text-right font-semibold">Valores (agencia × mes)</th></tr></thead>
              <tbody>{deQue.map((g) => (
                <tr key={`${g.departamento}|${g.concepto}`} style={{ borderTop: "1px solid #EAD9B5" }}>
                  <td className="py-1">{g.departamento}</td><td>{g.concepto} · {g.cuenta}</td><td className="text-right">{numero(g.valores)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {verPct && <PanelAsignacion montoEjemplo={abierto && alcance === "prorrateo" && montoValido > 0 ? montoValido : 10000} onRecalculado={onCambio} />}

      {/* ---------- Formulario (ventana) ---------- */}
      {abierto && (
        <VentanaFormulario titulo={editando ? "Editar compra" : "Registrar compra"} onCerrar={() => { limpiar(); setAbierto(false); }}
          onGuardar={guardarCompra} guardando={guardando} textoGuardar={editando ? "Guardar cambios" : "Guardar compra"} error={error}
          pie={montoValido > 0 ? (aplicacion === "mes" ? `${usd(montoValido)} en ${MESES_LARGOS[mesSeleccionado - 1].toLowerCase()}` : `12 meses de ${usd(montoValido / 12)}`)
            + (alcance === "prorrateo" ? " · repartido por % de activo" : ` · ${agenciaSeleccionada}`) : ""}>
          <SeccionForm t="Compra">
            <CampoForm label="Categoría">
              <select value={activo.nombre} onChange={(e) => setActivo(CATEGORIAS.find((c) => c.nombre === e.target.value) ?? CATEGORIAS[0])} className={CAMPO} style={BORDE}>
                {CATEGORIAS.map((c) => <option key={c.nombre} value={c.nombre}>{c.label}</option>)}
              </select>
            </CampoForm>
            <CampoForm label="Departamento">
              {mostrandoNuevoDepto ? (
                <span className="flex gap-1">
                  <input value={nuevoDeptoTexto} onChange={(e) => setNuevoDeptoTexto(e.target.value)} placeholder="Nombre del departamento" autoFocus className={CAMPO} style={BORDE} />
                  <button type="button" onClick={crearDepartamento} aria-label="Crear departamento" className="h-9 px-2.5 rounded-md text-white" style={{ background: C.acento }}><Check size={14} /></button>
                  <button type="button" onClick={() => setMostrandoNuevoDepto(false)} aria-label="Cancelar" className="h-9 px-2.5 rounded-md bg-white" style={BORDE}><X size={14} /></button>
                </span>
              ) : (
                <select value={departamento} className={CAMPO} style={BORDE}
                        onChange={(e) => { if (e.target.value === NUEVO_DEPARTAMENTO) { setMostrandoNuevoDepto(true); return; } setDepartamento(e.target.value); }}>
                  <option value="">Seleccionar...</option>
                  {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
                  {departamento && !departamentos.includes(departamento) && <option value={departamento}>{departamento}</option>}
                  <option value={NUEVO_DEPARTAMENTO}>+ Nuevo departamento</option>
                </select>
              )}
            </CampoForm>
            <CampoForm label="Descripción" span={2}>
              <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. ampliación de agencia" className={CAMPO} style={BORDE} />
            </CampoForm>
          </SeccionForm>
          <SeccionForm t="Valor y aplicación">
            <CampoForm label="Monto total (USD)">
              <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="10.000,00"
                     aria-invalid={!!leerMonto(monto).error} title={leerMonto(monto).error ?? undefined}
                     className={`${CAMPO} text-right`} style={leerMonto(monto).error ? { ...BORDE, border: "1px solid #B42318", background: "#FDF2F1" } : BORDE} />
            </CampoForm>
            <CampoForm label="Aplicación" span={2}>
              <select value={aplicacion} onChange={(e) => setAplicacion(e.target.value as "mes" | "prorratear_anio")} className={CAMPO} style={BORDE}>
                <option value="prorratear_anio">Repartir en los 12 meses</option>
                <option value="mes">Compra en un mes específico</option>
              </select>
            </CampoForm>
            {aplicacion === "mes" ? (
              <CampoForm label="Mes de la compra">
                <select value={mesSeleccionado} onChange={(e) => setMesSeleccionado(Number(e.target.value))} className={CAMPO} style={BORDE}>
                  {MESES_LARGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </CampoForm>
            ) : <span />}
          </SeccionForm>
          <SeccionForm t="Distribución">
            <CampoForm label="Alcance" span={2}>
              <select value={alcance} onChange={(e) => setAlcance(e.target.value as "prorrateo" | "agencia")} className={CAMPO} style={BORDE}>
                <option value="prorrateo">Toda la cooperativa, por % de activo</option>
                <option value="agencia">Solo una agencia (compra directa)</option>
              </select>
            </CampoForm>
            {alcance === "agencia" && (
              <CampoForm label="Agencia" span={2}>
                <select value={agenciaSeleccionada} onChange={(e) => setAgenciaSeleccionada(e.target.value)} className={CAMPO} style={BORDE}>
                  {AGENCIAS.filter((a) => a !== "Consolidado").map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </CampoForm>
            )}
          </SeccionForm>
        </VentanaFormulario>
      )}

      {/* ---------- Compras registradas / resumen por mes (una a la vez) ---------- */}
      {todas.length === 0 ? (
        <div className="tarjeta px-6 py-7 flex flex-col items-center gap-2 text-center">
          <span className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: C.beige }}><ShoppingCart size={18} color={C.texto2} /></span>
          <span className="text-[13px] font-semibold">Todavía no hay compras planificadas para {ejercicioEnUso()}</span>
          <span className="text-[12px] max-w-[414px]" style={{ color: C.texto2 }}>
            Las compras que registres aparecen aquí y se suman solas al costo de su categoría, a la depreciación y al Flujo de efectivo.
          </span>
        </div>
      ) : (
        vista === "lista" && (
        <div className="tarjeta overflow-auto max-h-[297px]" style={{ border: `1px solid ${C.borde}` }}>
          <table className="w-full table-fixed text-[12px] border-collapse min-w-[810px]">
            <colgroup>
              <col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "22%" }} />
              <col style={{ width: "17%" }} /><col style={{ width: "15%" }} /><col style={{ width: "11%" }} /><col style={{ width: 94 }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="text-[12px] font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                <th className="pl-4 pr-3 text-left font-semibold">Categoría</th>
                <th className="px-3 text-left font-semibold">Departamento</th>
                <th className="px-3 text-left font-semibold">Descripción</th>
                <th className="px-3 text-left font-semibold">Aplicación</th>
                <th className="px-3 text-left font-semibold">Alcance</th>
                <th className="px-3 text-right font-semibold">Monto</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {todas.map((c) => {
                const meses = c.montosPorMes.map((v, i) => (v !== 0 ? i : -1)).filter((i) => i >= 0);
                const aplic = meses.length === 12 ? "Repartida en 12 meses" : meses.map((i) => MESES_LARGOS[i]).join(", ");
                return (
                  <tr key={c.cat.nombre + c.descripcion} className="hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 36 }}>
                    <td className="pl-4 pr-3 font-semibold truncate" title={c.cat.label}>{c.cat.label}</td>
                    <td className="px-3 truncate" title={c.departamentoReal || ""} style={{ color: C.texto3 }}>{c.departamentoReal || "—"}</td>
                    <td className="px-3 truncate" title={c.descripcion}>{c.descripcion}</td>
                    <td className="px-3 truncate" title={aplic} style={{ color: C.texto3 }}>{aplic}</td>
                    <td className="px-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                            style={c.modo === "prorrateado" ? { background: C.beige, color: C.cabeceraTexto } : { background: C.acentoSuave, color: C.acento }}>
                        {c.agencia}
                      </span>
                    </td>
                    <td className="px-3 text-right font-semibold whitespace-nowrap">{usd(suma(c.montosPorMes))}</td>
                    <td className="pr-4">
                      <div className="flex items-center justify-end gap-3">
                        <button type="button" onClick={() => editarCompra(c.cat, c)} aria-label={`Editar compra ${c.descripcion}`} title="Editar"
                                className="w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-[#E3EEE7]">
                          <Pencil size={15} color={C.texto} />
                        </button>
                        <button type="button" onClick={() => setConfirmar({ cat: c.cat, compra: c })} aria-label={`Eliminar compra ${c.descripcion}`} title="Eliminar"
                                className="w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-[#FBE4E1]">
                          <Trash2 size={15} color={C.alerta} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )
      )}

      {/* ---------- Matriz por categoría y mes ---------- */}
      {(vista === "meses" || todas.length === 0) && (
      <div className="tarjeta overflow-x-auto" style={{ border: `1px solid ${C.borde}` }}>
        <table className="w-full text-[12px] border-collapse min-w-[1170px]">
          <thead>
            <tr className="text-[12px] font-semibold" style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <th className="pl-4 py-2.5 text-left font-semibold">Compras por categoría</th>
              {MESES.map((m) => <th key={m} className="px-2 py-2.5 text-right font-semibold min-w-[72px]">{m}</th>)}
              <th className="px-3 py-2.5 text-right font-semibold" style={{ borderLeft: "1px solid #DDE2DF" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIAS.filter((cat) => Math.round(suma(totalesPorCategoria[cat.nombre])) !== 0).map((cat) => {
              const v = totalesPorCategoria[cat.nombre];
              const t = suma(v);
              return (
                <tr key={cat.nombre} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4" style={{ color: C.texto3 }}>{cat.label}</td>
                  {v.map((x, i) => <td key={i} className="px-2 text-right" style={{ color: Math.round(x) ? C.texto : C.tenue }}>{Math.round(x) ? numero(x) : "—"}</td>)}
                  <td className="px-3 text-right font-semibold" style={{ borderLeft: `1px solid ${C.beige}`, color: Math.round(t) ? C.texto : C.tenue }}>{Math.round(t) ? numero(t) : "—"}</td>
                </tr>
              );
            })}
            <tr className="font-bold" style={{ borderTop: "2px solid #DDE2DF", height: 32 }}>
              <td className="pl-4">Total compras</td>
              {totalPorMes.map((x, i) => <td key={i} className="px-2 text-right" style={{ color: Math.round(x) ? C.texto : C.tenue }}>{Math.round(x) ? numero(x) : "—"}</td>)}
              <td className="px-3 text-right" style={{ borderLeft: `1px solid ${C.beige}` }}>{numero(suma(totalPorMes))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {confirmar && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-md shadow-lg max-w-sm w-full p-5">
            <p className="text-[13px] font-semibold mb-2">¿Eliminar la compra “{confirmar.compra.descripcion}”?</p>
            <p className="text-[12px] mb-4" style={{ color: C.texto2 }}>
              Se quita de {confirmar.cat.label} en {confirmar.compra.modo === "prorrateado" ? "las 10 agencias" : confirmar.compra.agencia} y deja de sumar al costo y al Flujo.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)} className="h-9 px-4 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${C.borde}` }}>Cancelar</button>
              <button type="button" onClick={() => eliminarCompra(confirmar.cat, confirmar.compra)}
                      className="h-9 px-4 rounded-md text-white text-[12px] font-semibold" style={{ background: C.alerta }}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// GRÁFICOS Y ANÁLISIS
// =====================================================================

function Analisis({ resumenes, netoTotal, comprasAnio, agencia, registro, comparacion }: {
  resumenes: ResumenCategoria[]; netoTotal: number[]; comprasAnio: number; agencia: string;
  registro: Registro | null; comparacion: Comparacion | null;
}) {
  const depreciables = resumenes.filter((r) => r.depreciado !== null && r.costoFin > 0).sort((a, b) => (b.depreciado ?? 0) - (a.depreciado ?? 0));
  const criticas = depreciables.filter((r) => (r.depreciado ?? 0) >= 0.7);

  const W = 620, H = 200, x0 = 52, x1 = 596, yT = 20, yB = 165;
  const max = Math.max(...netoTotal, 1) * 1.1;
  const ancho = (x1 - x0) / 12;
  const y = (v: number) => yB - (Math.max(v, 0) / max) * (yB - yT);

  return (
    <div className="flex flex-col gap-4">
      {(criticas.length > 0 || comprasAnio === 0) && (
        <div role="note" className="flex items-start gap-3 rounded-md px-4 py-3 text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
          <AlertTriangle size={18} className="shrink-0 mt-px" />
          <span>
            {criticas.length > 0 && (
              <><strong>{criticas.map((r) => `${r.cat.label} (${pct(r.depreciado ?? 0, 0)})`).join(", ")}</strong> {criticas.length === 1 ? "cierra" : "cierran"} {ejercicioEnUso()} con más del 70 % depreciado. </>
            )}
            {comprasAnio === 0
              ? <>No hay compras con efecto en {agencia}, así que el valor neto baja de {millones(netoTotal[0])} a {millones(netoTotal[11])} solo por depreciación.</>
              : <>Las compras planificadas suman {usd(comprasAnio)} en {agencia}.</>}
          </span>
        </div>
      )}

      {registro && comparacion && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TerminanPorMes registro={registro} />
          <ComparacionCalculo comparacion={comparacion} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
          <div>
            <div className="text-[13px] font-semibold">¿Cuánta vida le queda a cada categoría?</div>
            <div className="text-[12px]" style={{ color: C.texto2 }}>% depreciado al cierre de {ejercicioEnUso()} y meses restantes al ritmo actual</div>
          </div>
          <div className="flex flex-col gap-2.5">
            {depreciables.map((r) => (
              <div key={r.cat.nombre} className="grid grid-cols-[120px_minmax(0,1fr)_56px_100px] items-center gap-3 text-[12px]">
                <span style={{ color: C.texto3 }}>{r.cat.label}</span>
                <div className="h-2.5 rounded-md overflow-hidden" style={{ background: C.beige }}>
                  <div className="h-2.5 rounded-md" style={{ width: `${Math.min(r.depreciado ?? 0, 1) * 100}%`, background: colorDepreciado(r.depreciado ?? 0) }} />
                </div>
                <b className="text-right">{pct(r.depreciado ?? 0, 0)}</b>
                <span className="text-right" style={{ color: C.texto2 }}>
                  {r.vidaMeses === null ? "—" : r.vidaMeses < 0.5 ? "depreciado" : `≈ ${Math.round(r.vidaMeses)} meses`}
                </span>
              </div>
            ))}
            {!depreciables.length && <p className="text-[12px]" style={{ color: C.texto2 }}>No hay categorías con costo.</p>}
          </div>
        </div>

        <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
          <div>
            <div className="text-[13px] font-semibold">Valor neto de los activos fijos</div>
            <div className="text-[12px]" style={{ color: C.texto2 }}>Cierre de cada mes · {agencia}</div>
          </div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Valor neto del activo fijo por mes">
            <line x1={x0} x2={x1} y1={yB} y2={yB} stroke={C.borde} />
            {netoTotal.map((v, i) => (
              <rect key={i} x={x0 + i * ancho + 8} y={y(v)} width={ancho - 16} height={yB - y(v)} rx={3} fill={C.acento} opacity={0.55 + 0.035 * i} />
            ))}
            <text x={x0 + 8} y={y(netoTotal[0]) - 6} fontSize={10.5} fontWeight={600} fill={C.acento}>{millones(netoTotal[0])}</text>
            <text x={x1 - 8} y={y(netoTotal[11]) - 6} textAnchor="end" fontSize={10.5} fontWeight={600} fill={C.acento}>{millones(netoTotal[11])}</text>
            {MESES.map((m, i) => i % 2 === 0 && <text key={m} x={x0 + i * ancho + ancho / 2} y={184} textAnchor="middle" fontSize={10} fill={C.texto2}>{m}</text>)}
          </svg>
        </div>
      </div>
    </div>
  );
}

function TerminanPorMes({ registro }: { registro: Registro }) {
  const v = registro.terminanPorMes;
  const max = Math.max(...v, 1);
  const W = 620, yB = 170, alto = 130, ancho = (W - 40) / 12;
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
      <div>
        <div className="text-[13px] font-semibold">Bienes que terminan de depreciarse en {ejercicioEnUso()}</div>
        <div className="text-[12px]" style={{ color: C.texto2 }}>{numero(suma(v))} en total · desde el mes siguiente dejan de sumar gasto</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} 195`} role="img" aria-label="Bienes que terminan de depreciarse por mes">
        <line x1={20} x2={W - 20} y1={yB} y2={yB} stroke={C.borde} />
        {v.map((n, i) => {
          const h = (n / max) * alto;
          const x = 20 + i * ancho + ancho * 0.2;
          return (
            <g key={i}>
              {n > 0 && <rect x={x} y={yB - h} width={ancho * 0.6} height={h} rx={3} fill={C.aviso} />}
              <text x={x + ancho * 0.3} y={n > 0 ? yB - h - 6 : yB - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={n > 0 ? C.texto : C.tenue}>{n > 0 ? n : "—"}</text>
              <text x={x + ancho * 0.3} y={188} textAnchor="middle" fontSize={10.5} fill={C.texto2}>{MESES[i]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ComparacionCalculo({ comparacion }: { comparacion: Comparacion }) {
  const filas = CATEGORIAS.filter((c) => c.depreciable)
    .map((c) => ({ label: c.label, antes: comparacion.antes[c.nombre] ?? 0, ahora: comparacion.ahora[c.nombre] ?? 0 }))
    .filter((f) => Math.round(f.antes) !== 0 || Math.round(f.ahora) !== 0);
  const tA = suma(filas.map((f) => f.antes)), tH = suma(filas.map((f) => f.ahora));
  const dif = (d: number) => (
    <span className="text-right font-semibold whitespace-nowrap" style={{ color: Math.round(d) === 0 ? C.tenue : d > 0 ? C.alerta : C.ok }}>
      {Math.round(d) === 0 ? "—" : (d > 0 ? "+" : "−") + usd(Math.abs(d))}
    </span>
  );
  const grid = "grid grid-cols-[minmax(0,1fr)_110px_110px_100px] items-center gap-2";
  return (
    <div className="tarjeta px-5 py-4 flex flex-col" style={{ border: `1px solid ${C.borde}` }}>
      <div className="mb-2">
        <div className="text-[13px] font-semibold">Depreciación del año frente al cálculo anterior</div>
        <div className="text-[12px]" style={{ color: C.texto2 }}>Antes: costo × factor ÷ 12 · Ahora: cuota de cada bien del registro (sin compras nuevas en los dos)</div>
      </div>
      <div className={`${grid} text-[12px] font-semibold pb-1.5`} style={{ color: C.texto2 }}>
        <span /><span className="text-right">Antes</span><span className="text-right">Ahora</span><span className="text-right">Dif.</span>
      </div>
      {filas.map((f) => (
        <div key={f.label} className={`${grid} py-2 text-[12px]`} style={{ borderTop: `1px solid ${C.beige}` }}>
          <span style={{ color: C.texto3 }}>{f.label}</span>
          <span className="text-right" style={{ color: C.texto2 }}>{usd(f.antes)}</span>
          <b className="text-right">{usd(f.ahora)}</b>
          {dif(f.ahora - f.antes)}
        </div>
      ))}
      <div className={`${grid} py-2 text-[12px] font-bold`} style={{ borderTop: `1px solid ${C.borde}` }}>
        <span>Total</span><span className="text-right">{usd(tA)}</span><span className="text-right">{usd(tH)}</span>{dif(tH - tA)}
      </div>
      <p className="text-[11px] mt-1" style={{ color: C.texto2 }}>Menos depreciación = menos gasto en el ER (4505) y más valor neto en el Balance.</p>
    </div>
  );
}

// =====================================================================
// % DE ASIGNACIÓN POR AGENCIA (para cuadrar el reparto a mano)
// =====================================================================

interface DetalleActivoAgencia {
  agencia: string; fuente: "balance" | "referencia" | "sin datos";
  activoGrupos: number | null; cuenta1908: number | null; baseBalance: number | null; base: number; referencia: number | null; porcentaje: number; corte: { anio: number; mes: number };
}

function PanelAsignacion({ montoEjemplo, onRecalculado }: { montoEjemplo: number; onRecalculado: () => void }) {
  const [detalle, setDetalle] = useState<DetalleActivoAgencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ejemplo, setEjemplo] = useState(String(montoEjemplo));
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setEjemplo(String(montoEjemplo)); }, [montoEjemplo]);
  useEffect(() => {
    llamar("/api/porcentajes-activo")
      .then((d) => setDetalle((d as { detalle: DetalleActivoAgencia[] }).detalle))
      .catch((e) => setError(e instanceof Error ? e.message : "Error de conexión"));
  }, []);

  async function recalcular() {
    setConfirmar(false);
    try {
      const d = (await llamar("/api/porcentajes-activo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "recalcular" }),
      })) as { filasActualizadas: number };
      setMsg(`Listo: ${numero(d.filasActualizadas)} filas repartidas otra vez con estos %.`);
      onRecalculado();
    } catch (e) {
      setMsg(`No se pudo recalcular: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  if (error) return <p className="text-[12px]" style={{ color: C.alerta }}>{error}</p>;
  if (!detalle) return <EsqueletoTabla indicadores={false} filas={10} />;

  const monto = Number(ejemplo) || 0;
  const tot = {
    grupos: suma(detalle.map((d) => d.activoGrupos ?? 0)), c1908: suma(detalle.map((d) => d.cuenta1908 ?? 0)),
    baseBal: suma(detalle.map((d) => d.baseBalance ?? 0)),
    base: suma(detalle.map((d) => d.base)), pct: suma(detalle.map((d) => d.porcentaje)),
  };
  const negativas = detalle.filter((d) => d.base < 0);
  const celda = (v: number | null, extra = "") => (
    <td className={`px-3 text-right whitespace-nowrap ${extra}`} style={{ color: v === null || Math.round(v) === 0 ? C.tenue : v < 0 ? C.alerta : C.texto }}>
      {v === null || Math.round(v) === 0 ? "—" : numero(v)}
    </td>
  );

  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}` }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[234px]">
          <div className="text-[13px] font-semibold">% de asignación por agencia</div>
          <div className="text-[12px]" style={{ color: C.texto2 }}>El % sale del balance del último corte cargado de cada agencia (activo − 1908) y queda guardado en la base · la referencia de dic-2025 se usa solo si una agencia no tiene balance</div>
        </div>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: C.texto2 }}>Ejemplo de reparto
          <input value={ejemplo} onChange={(e) => setEjemplo(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
                 className="h-8 w-[99px] rounded-md px-2.5 text-right text-[12px] bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }} />
        </label>
      </div>

      {negativas.length > 0 && (
        <div role="note" className="flex items-start gap-2 rounded-md px-3 py-2 text-[12px]" style={{ background: C.alertaSuave, color: "#7A1A12" }}>
          <AlertTriangle size={15} className="shrink-0 mt-px" />
          <span><b>{negativas.map((d) => d.agencia).join(", ")}</b> {negativas.length === 1 ? "queda" : "quedan"} con base negativa. Así su % resta y el resto de agencias recibe de más: revisa ese dato.</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-md" style={{ border: `1px solid ${C.borde}` }}>
        <table className="w-full text-[12px] border-collapse min-w-[972px]">
          <thead>
            <tr className="text-[12px] font-semibold" style={{ background: C.cabecera, color: C.cabeceraTexto }}>
              <th className="pl-4 py-2.5 text-left font-semibold">Agencia</th>
              <th className="px-3 py-2.5 text-right font-semibold">Activo balance</th>
              <th className="px-3 py-2.5 text-right font-semibold">− 1908</th>
              <th className="px-3 py-2.5 text-right font-semibold">Base balance</th>
              <th className="px-3 py-2.5 text-right font-semibold">Referencia dic-25</th>
              <th className="px-3 py-2.5 text-right font-semibold">Variación</th>
              <th className="px-3 py-2.5 text-left font-semibold">Usa</th>
              <th className="px-3 py-2.5 text-right font-semibold">%</th>
              <th className="pr-4 py-2.5 text-right font-semibold">De {usd(monto)}</th>
            </tr>
          </thead>
          <tbody>
            {[...detalle].sort((a, b) => b.base - a.base).map((d) => (
              <tr key={d.agencia} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                <td className="pl-4 font-medium">{d.agencia}</td>
                {celda(d.activoGrupos)}{celda(d.cuenta1908 === null ? null : -d.cuenta1908)}{celda(d.baseBalance)}
                {celda(d.referencia)}
                {celda(d.baseBalance !== null && d.referencia !== null ? d.baseBalance - d.referencia : null)}
                <td className="px-3">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap"
                        style={d.fuente === "balance" ? { background: C.okSuave, color: C.ok } : d.fuente === "referencia" ? { background: C.avisoSuave, color: "#6E4A0E" } : { background: C.alertaSuave, color: C.alerta }}>
                    {d.fuente === "balance" ? `balance ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][d.corte.mes - 1]}-${String(d.corte.anio).slice(2)}` : d.fuente === "referencia" ? "referencia dic-25" : "sin datos"}
                  </span>
                </td>
                <td className="px-3 text-right font-semibold" style={{ color: d.porcentaje < 0 ? C.alerta : C.texto }}>{pct(d.porcentaje, 2)}</td>
                <td className="pr-4 text-right font-semibold whitespace-nowrap" style={{ color: monto * d.porcentaje < 0 ? C.alerta : C.texto }}>
                  {"$" + (monto * d.porcentaje).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
            <tr className="font-bold" style={{ borderTop: `1px solid ${C.borde}`, background: C.crema, height: 36 }}>
              <td className="pl-4">Total</td>
              {celda(tot.grupos)}{celda(-tot.c1908)}{celda(tot.baseBal)}{celda(tot.base)}<td /><td />
              <td className="px-3 text-right" style={{ color: Math.abs(tot.pct - 1) > 0.0001 ? C.alerta : C.texto }}>{pct(tot.pct, 2)}</td>
              <td className="pr-4 text-right">{"$" + (monto * tot.pct).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-[12px]" style={{ color: C.texto2 }}>
          Cada mes, cada agencia recibe el monto institucional del mes × su %. Las compras y gastos ya registrados se repartieron con los % que había en ese momento.
        </span>
        {msg && <span className="text-[12px] font-semibold" style={{ color: msg.startsWith("Listo") ? C.ok : C.alerta }}>{msg}</span>}
        {confirmar ? (
          <span className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: C.texto3 }}>Se vuelven a repartir todas las compras y gastos prorrateados de {ejercicioEnUso()}. ¿Continuar?</span>
            <button type="button" onClick={() => setConfirmar(false)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${C.borde}` }}>No</button>
            <button type="button" onClick={recalcular} className="h-8 px-3 rounded-md text-white text-[12px] font-semibold" style={{ background: C.acento }}>Sí, recalcular</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} disabled={negativas.length > 0 || Math.abs(tot.pct - 1) > 0.0001}
                  title={negativas.length ? "Corrige primero las bases negativas" : undefined}
                  className="h-8 px-3.5 rounded-md text-[12px] font-semibold disabled:opacity-40" style={{ border: `1px solid ${C.acento}`, color: C.acento }}>
            Repartir de nuevo con estos %
          </button>
        )}
      </div>
    </div>
  );
}

export default function ActivosFijosPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[#7A7167]">Cargando activos fijos...</div>}>
      <ActivosFijosContenido />
    </Suspense>
  );
}
