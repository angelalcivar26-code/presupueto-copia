"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useMemo, useState, Suspense } from "react";
import { ChevronRight, ChevronDown, Download } from "lucide-react";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

interface NodoResultados {
  codigo: string;
  label: string;
  valores: number[]; // acumulados en el año (YTD), tal como los entrega la API
  hijos?: NodoResultados[];
  cuentas?: string[];
}

/** Respuesta de /api/estado-resultados: el motor (egresos/ingresos) y la misma información por cuenta (cuentas). */
interface RespuestaER {
  egresos: NodoResultados; ingresos: NodoResultados; resultadoDelEjercicio: NodoResultados;
  cuentas?: {
    egresos: NodoResultados; ingresos: NodoResultados; control?: { egresos: number[]; ingresos: number[] };
  } | null;
}
/** La pantalla muestra la estructura por cuenta (como el estado de resultados real); si no llegó, la del motor. */
function porCuenta(d: RespuestaER | null | undefined): (RespuestaER & { descuadre: number }) | null {
  if (!d) return null;
  if (!d.cuentas) return { ...d, descuadre: 0 };
  const c = d.cuentas.control, max = c ? Math.max(...[...c.egresos, ...c.ingresos].map((x) => Math.abs(x))) : 0;
  return { ...d, egresos: d.cuentas.egresos, ingresos: d.cuentas.ingresos, descuadre: max };
}

type Vista = "valores" | "vertical" | "horizontal";
type Base = "acumulado" | "mensual";

const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

// Paleta institucional (misma de Cartera, Activos y Balance)
const C = {
  texto: "#111418",
  texto2: "#3D4843",
  texto3: "#26302B",
  tenue: "#7A847F",
  borde: "#DDE2DF",
  beige: "#E6EAE8",
  acento: "#005A28",
  acentoSuave: "#E3EEE7",
  ok: "#1E6B3A",
  alerta: "#B42318",
};
const FONDO = "#EEF1EF";

// ---------- utilidades ----------
// Negativos entre paréntesis (convención contable)
function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function pct(n: number, d = 1): string {
  return Math.abs(n).toFixed(d).replace(".", ",") + " %";
}
const esCero = (v: number[]) => v.every((x) => Math.round(x) === 0);

function desacumular(nodo: NodoResultados): NodoResultados {
  const valores = nodo.valores.map((v, i) => (i === 0 ? v : v - nodo.valores[i - 1]));
  return { ...nodo, valores, hijos: nodo.hijos?.map(desacumular) };
}
function desacumularArr(v: number[]): number[] {
  return v.map((x, i) => (i === 0 ? x : x - v[i - 1]));
}

// ---------- celda según la vista ----------
// base = valores ya en la base elegida (acumulado o mensual); ingresos = ingresos totales en esa misma base
function celda(valores: number[], i: number, vista: Vista, ingresos: number[]): { txt: string; color: string } {
  const x = valores[i];
  if (vista === "valores") {
    if (Math.round(x) === 0) return { txt: "—", color: C.tenue };
    return { txt: numero(x), color: C.texto };
  }
  if (vista === "vertical") {
    if (Math.round(x) === 0 || !ingresos[i]) return { txt: "—", color: C.tenue };
    return { txt: x < 0 ? `(${pct((x / ingresos[i]) * 100)})` : pct((x / ingresos[i]) * 100), color: C.texto };
  }
  if (i === 0 || !valores[i - 1]) return { txt: "—", color: C.tenue };
  const d = ((x - valores[i - 1]) / Math.abs(valores[i - 1])) * 100; // sobre el valor absoluto: el signo sigue al cambio real
  if (Math.abs(d) < 0.05) return { txt: "0,0 %", color: C.texto2 };
  return { txt: (d > 0 ? "+" : "−") + pct(d), color: d > 0 ? C.ok : C.alerta };
}

// ---------- celda de código (Σ para filas que agrupan varias cuentas) ----------
function CeldaCodigo({ nodo }: { nodo: NodoResultados }) {
  const partes = nodo.codigo.split(/[\/+]/).filter(Boolean);
  if (nodo.codigo && partes.length === 1) return <>{nodo.codigo}</>;

  let titulo = "Agrupa varias cuentas";
  if (partes.length > 1) titulo = `Suma de ${partes.join(", ")}`;
  else if (nodo.cuentas?.length) titulo = `Suma de ${nodo.cuentas.join(", ")}`;
  else if (nodo.label === "RESULTADO DEL EJERCICIO") titulo = "Ingresos (5) − Egresos (4)";
  else if (nodo.hijos?.some((h) => h.codigo)) titulo = `Suma de ${nodo.hijos.filter((h) => h.codigo).map((h) => h.codigo).join(", ")}`;

  return (
    <span title={titulo}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold cursor-help"
          style={{ background: "#F3F5F4", color: C.texto2 }}>
      Σ
    </span>
  );
}

// ---------- fila recursiva ----------
function Fila({
  nodo, total, nivel, columnas, vista, ingresos, ingresosTotal, ocultarCeros, destacado = false, primera = false,
}: {
  nodo: NodoResultados;      // en la base elegida (acumulado o mensual)
  total: NodoResultados;     // en acumulado, para la columna Total año
  nivel: number; columnas: number[]; vista: Vista;
  ingresos: number[]; ingresosTotal: number; ocultarCeros: boolean; destacado?: boolean; primera?: boolean;
}) {
  const [abierto, setAbierto] = useState(nivel === 0);
  const pares = (nodo.hijos ?? [])
    .map((h, i) => ({ h, t: total.hijos?.[i] ?? h }))
    .filter(({ t }) => !(ocultarCeros && esCero(t.valores)));
  const tieneHijos = pares.length > 0;
  const seccion = nivel === 0;

  const totalAnio = total.valores[11];
  const totalCelda =
    vista === "vertical"
      ? (Math.round(totalAnio) === 0 || !ingresosTotal ? { txt: "—", color: C.tenue } : { txt: totalAnio < 0 ? `(${pct((totalAnio / ingresosTotal) * 100)})` : pct((totalAnio / ingresosTotal) * 100), color: C.texto })
      : (Math.round(totalAnio) === 0 ? { txt: "—", color: C.tenue } : { txt: numero(totalAnio), color: C.texto });
  const etiqueta = seccion ? nodo.label.charAt(0) + nodo.label.slice(1).toLowerCase() : nodo.label;

  return (
    <>
      {/* Espacio blanco antes de cada sección: Ingresos, Egresos y Resultado se leen como bloques */}
      {seccion && !primera && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={columnas.length + 3} /></tr>}
      <tr
        onClick={() => tieneHijos && setAbierto((a) => !a)}
        className="hover:bg-[#F5F7F6]"
        style={{
          borderTop: destacado ? "1px solid #B9C3BD" : seccion ? (primera ? "none" : "1px solid #DDE2DF") : `1px solid ${C.beige}`,
          cursor: tieneHijos ? "pointer" : "default",
          height: seccion ? 38 : 36,
          fontWeight: seccion ? 600 : 400,
        }}
      >
        <td className="pl-4 pr-1 text-[11px] whitespace-nowrap" style={{ color: C.tenue }}>
          <CeldaCodigo nodo={nodo} />
        </td>
        <td className="pr-2" style={{ paddingLeft: 2 + nivel * 18 }}>
          <span className="flex items-center gap-1.5 min-w-0">
            {tieneHijos ? (
              abierto ? <ChevronDown size={13} className="shrink-0" color={seccion ? C.acento : C.texto2} /> : <ChevronRight size={13} className="shrink-0" color={seccion ? C.acento : C.texto2} />
            ) : (
              <span className="shrink-0" style={{ width: 12, display: "inline-block" }} />
            )}
            <span className={`truncate ${seccion ? "text-[12px] font-bold" : "text-[11px]"}`} title={nodo.label}
                  style={{ color: destacado ? C.texto : seccion ? C.acento : C.texto3 }}>{etiqueta}</span>
          </span>
        </td>
        {columnas.map((i) => {
          const c = celda(nodo.valores, i, vista, ingresos);
          return (
            <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: c.color }}>
              {c.txt}
            </td>
          );
        })}
        <td className="pl-2 pr-4 text-right whitespace-nowrap font-semibold" style={{ color: totalCelda.color }}>
          {totalCelda.txt}
        </td>
      </tr>
      {tieneHijos && abierto &&
        pares.map(({ h, t }, i) => (
          <Fila key={`${h.codigo}-${i}`} nodo={h} total={t} nivel={nivel + 1} columnas={columnas} vista={vista}
                ingresos={ingresos} ingresosTotal={ingresosTotal} ocultarCeros={ocultarCeros} />
        ))}
    </>
  );
}

// ---------- indicador (tarjeta limpia, sin gráficas) ----------
function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: React.ReactNode; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}

// ---------- selector chico (como el de categorías en Activos fijos) ----------
function Pastillas<T extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex p-[3px] gap-0.5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => {
        const on = valor === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on}
                  className="h-7 px-2.5 rounded text-[12px] transition-colors"
                  style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { background: "transparent", color: C.texto2 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- exportar CSV ----------

function EstadoResultadosContenido() {
  const [ejercicio] = useEjercicio();
  const [mesIndex, setMesIndex] = useState(0);
  const [vistaAcumulada, setVistaAcumulada] = useState(true); // true = 12 meses, false = un solo mes
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [vista, setVista] = useState<Vista>("valores");
  const [base, setBase] = useState<Base>("acumulado");
  const [ocultarCeros, setOcultarCeros] = useState(false);
  const ticketSync = useEscucharSincronizacion();

  const url = `/api/estado-resultados?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
  const cached = porCuenta(obtenerJSONCache<RespuestaER>(url));

  const [datos, setDatos] = useState<typeof cached | null>(() => cached ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = porCuenta(obtenerJSONCache<RespuestaER>(url));
    if (enCache) {
      setDatos(enCache);
    } else {
      setDatos(null);
    }
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!vivo) return;
        if (data.egresos) {
          guardarJSONCache(url, data);
          setDatos(porCuenta(data));
        } else if (!enCache) {
          setError(data.error || "Error desconocido.");
        }
      })
      .catch(() => {
        if (vivo && !enCache) setError("Error de conexión.");
      });
    return () => { vivo = false; };
  }, [agencia, ejercicio, ticketSync]);

  const resumen = useMemo(() => {
    if (!datos) return null;
    const ingAcum = datos.ingresos.valores;
    const egrAcum = datos.egresos.valores;
    const resAcum = datos.resultadoDelEjercicio.valores;
    const ingMes = desacumularArr(ingAcum);
    const egrMes = desacumularArr(egrAcum);
    const resMes = desacumularArr(resAcum);
    const margenMes = ingMes.map((v, i) => (v ? (resMes[i] / v) * 100 : 0));
    const margenAnio = ingAcum[11] ? (resAcum[11] / ingAcum[11]) * 100 : 0;
    const mesesNegativos = resMes.filter((v) => v < 0).length;
    return { ingAcum, egrAcum, resAcum, ingMes, egrMes, resMes, margenMes, margenAnio, mesesNegativos };
  }, [datos]);

  if (error) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.alerta }}>{error}</div>;
  }
  if (!datos || !resumen) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.texto2 }}><EsqueletoTabla filas={12} /></div>;
  }

  // Un solo mes siempre se muestra como movimiento del mes (igual que antes).
  const baseEfectiva: Base = vistaAcumulada ? base : "mensual";
  const enBase = (n: NodoResultados) => (baseEfectiva === "mensual" ? desacumular(n) : n);
  const ingresosN = enBase(datos.ingresos);
  const egresosN = enBase(datos.egresos);
  const resultadoN = enBase(datos.resultadoDelEjercicio);
  const columnas = vistaAcumulada ? NOMBRES_MES.map((_, i) => i) : [mesIndex];
  const ingresosBase = ingresosN.valores;
  const ingresosTotal = datos.ingresos.valores[11];

  const { ingAcum, egrAcum, resAcum, margenAnio, mesesNegativos } = resumen;
  const vistas: { id: Vista; label: string }[] = [
    { id: "valores", label: "Valores" }, { id: "vertical", label: "Vertical %" }, { id: "horizontal", label: "Horizontal %" },
  ];
  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]";
  const selector = "h-9 px-2.5 text-[13px] rounded-md bg-white";
  const titulo = vista === "vertical" ? "Análisis vertical · % de los ingresos"
    : vista === "horizontal" ? "Análisis horizontal · variación frente al mes anterior"
    : !vistaAcumulada ? `Movimiento de ${NOMBRES_MES[mesIndex]}`
    : baseEfectiva === "acumulado" ? "Acumulado en el año" : "Movimiento de cada mes";

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>

      {/* Encabezado: título y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Estado de resultados<AnioEjercicio /></h1>
        <button type="button" onClick={() => void exportarPantalla({ agencia, ejercicio })}
                className={accion} style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Vista como pestañas a la izquierda; período y agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Vista" className="flex gap-7 flex-1">
          {vistas.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={vista === t.id} onClick={() => setVista(t.id)}
                    className="pt-2 pb-2.5 -mb-px text-[13px]"
                    style={{ color: vista === t.id ? C.acento : C.texto2, fontWeight: vista === t.id ? 600 : 400, borderBottom: `2px solid ${vista === t.id ? C.acento : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Período
          <select value={vistaAcumulada ? "todos" : String(mesIndex)} className={`${selector} min-w-[108px]`}
                  style={{ border: "1px solid #C9D0CC", color: C.texto }}
                  onChange={(e) => {
                    if (e.target.value === "todos") setVistaAcumulada(true);
                    else { setMesIndex(Number(e.target.value)); setVistaAcumulada(false); }
                  }}>
            <option value="todos">12 meses</option>
            {NOMBRES_MES.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => setAgencia(e.target.value)} className={`${selector} min-w-[153px]`}
                  style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {/* Indicadores del año: tarjetas limpias, sin gráficas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo="Ingresos totales del año" valor={usd(ingAcum[11])} pie={`Promedio ${usd(ingAcum[11] / 12)} al mes`} />
        <Indicador titulo="Egresos totales del año" valor={usd(egrAcum[11])}
                   pie={`${ingAcum[11] ? pct((egrAcum[11] / ingAcum[11]) * 100) : "—"} de los ingresos`} />
        <Indicador titulo="Resultado del ejercicio" valor={usd(resAcum[11])}
                   pie={mesesNegativos > 0 ? `${mesesNegativos} de 12 meses con pérdida` : "Utilidad en los 12 meses"}
                   color={mesesNegativos > 0 ? C.alerta : C.ok} />
        <Indicador titulo="Margen neto del año" valor={margenAnio < 0 ? `(${pct(margenAnio)})` : pct(margenAnio)}
                   pie="ƒ resultado ÷ ingresos" />
      </div>

      {datos.descuadre >= 1 && (
        <div className="tarjeta px-4 py-3 text-[12px]" style={{ color: C.alerta }}>
          La estructura por cuenta no cuadra con el total del motor (diferencia de hasta {numero(datos.descuadre)}). Avísame para revisarlo.
        </div>
      )}

      {/* Tabla */}
      <section className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <h2 className="flex-1 text-[14px] font-semibold">{titulo}</h2>
          {vistaAcumulada && (
            <Pastillas etiqueta="Base" valor={base} onChange={setBase}
              opciones={[{ id: "acumulado", label: "Acumulado" }, { id: "mensual", label: "Mensual" }]} />
          )}
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: C.texto2 }}>
            <input type="checkbox" checked={ocultarCeros} onChange={(e) => setOcultarCeros(e.target.checked)}
                   className="w-4 h-4" style={{ accentColor: C.acento }} />
            Ocultar cuentas en cero
          </label>
        </div>
        <div className="tabla-fija fija-2" style={{ "--col1": "74px" } as React.CSSProperties}>
          <table className="w-full table-fixed text-[11px] border-collapse min-w-[1250px]">
            <colgroup>
              <col style={{ width: 74 }} />
              <col style={{ width: vistaAcumulada ? 250 : 380 }} />
              {columnas.map((i) => <col key={i} />)}
              <col style={{ width: 86 }} />
            </colgroup>
            <thead>
              <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.texto2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                <th className="pl-4 pr-1 text-left font-semibold">Código</th>
                <th className="px-2 text-left font-semibold">Cuenta</th>
                {columnas.map((i) => (
                  <th key={i} className="px-1 text-right font-semibold">{NOMBRES_MES[i]}</th>
                ))}
                <th className="pl-2 pr-4 text-right font-semibold whitespace-nowrap">Total año</th>
              </tr>
            </thead>
            <tbody>
              <Fila nodo={egresosN} total={datos.egresos} nivel={0} columnas={columnas} vista={vista}
                    ingresos={ingresosBase} ingresosTotal={ingresosTotal} ocultarCeros={ocultarCeros} primera />
              <Fila nodo={ingresosN} total={datos.ingresos} nivel={0} columnas={columnas} vista={vista}
                    ingresos={ingresosBase} ingresosTotal={ingresosTotal} ocultarCeros={ocultarCeros} />
              <Fila nodo={resultadoN} total={datos.resultadoDelEjercicio} nivel={0} columnas={columnas} vista={vista}
                    ingresos={ingresosBase} ingresosTotal={ingresosTotal} ocultarCeros={ocultarCeros} destacado />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function EstadoResultadosPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-[#3D4843]">Cargando estado de resultados...</div>}>
      <EstadoResultadosContenido />
    </Suspense>
  );
}
