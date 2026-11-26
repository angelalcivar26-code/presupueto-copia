"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, useEjercicio, ejercicioEnUso } from "../../lib/seleccion";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useMemo, useState, Suspense } from "react";
import { ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Download } from "lucide-react";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

interface NodoBalance {
  codigo: string;
  label: string;
  valores: number[];
  hijos?: NodoBalance[];
  cuentas?: string[]; // códigos que suma una fila agrupada (opcional)
}

type Vista = "valores" | "vertical" | "horizontal";

const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

// Paleta institucional (misma de Cartera y Activos)
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

// ---------- utilidades de formato ----------
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
/** Variación sobre el valor absoluto del mes base: con base negativa el signo sigue al cambio real
 *  (de −50.000 a +20.000 es +140 %, mejora; de −1,0 M a −1,1 M es −10 %, la cuenta baja). */
const variacion = (a: number, b: number) => (a === 0 ? null : ((b - a) / Math.abs(a)) * 100);

// ---------- celda según la vista ----------
function celda(
  nodo: NodoBalance, i: number, vista: Vista, activo: number[],
): { txt: string; color: string } {
  const x = nodo.valores[i];
  if (vista === "valores") {
    if (Math.round(x) === 0) return { txt: "—", color: C.tenue };
    return { txt: numero(x), color: C.texto };
  }
  if (vista === "vertical") {
    if (Math.round(x) === 0 || !activo[i]) return { txt: "—", color: C.tenue };
    // Las cuentas negativas (provisiones, depreciación, pérdidas) conservan su signo, entre paréntesis
    return { txt: x < 0 ? `(${pct((x / activo[i]) * 100)})` : pct((x / activo[i]) * 100), color: C.texto };
  }
  // horizontal: contra el mes anterior
  if (i === 0) return { txt: "—", color: C.tenue };
  const d = variacion(nodo.valores[i - 1], x);
  if (d === null) return { txt: "—", color: C.tenue };
  if (Math.abs(d) < 0.05) return { txt: "0,0 %", color: C.texto2 };
  return { txt: (d > 0 ? "+" : "−") + pct(d), color: d > 0 ? C.ok : C.alerta };
}

// ---------- fila recursiva ----------
function Fila({
  nodo, nivel, columnas, vista, activo, ocultarCeros, primera, expandido = false,
}: {
  nodo: NodoBalance; nivel: number; columnas: number[]; vista: Vista;
  activo: number[]; ocultarCeros: boolean; primera?: boolean; expandido?: boolean;
}) {
  const [abierto, setAbierto] = useState(nivel === 0 || expandido);
  const hijos = (nodo.hijos ?? []).filter((h) => !(ocultarCeros && esCero(h.valores)));
  const tieneHijos = hijos.length > 0;
  const seccion = nivel === 0;
  const va = variacion(nodo.valores[0], nodo.valores[11]);
  const vaColor = va === null ? C.tenue : Math.abs(va) < 0.05 ? C.texto2 : va > 0 ? C.ok : C.alerta;
  const vaTxt = va === null ? "—" : Math.abs(va) < 0.05 ? "0,0 %" : (va > 0 ? "+" : "−") + pct(va);

  return (
    <>
      {/* Espacio blanco antes de Pasivo y Patrimonio: cada sección se lee como un bloque */}
      {seccion && !primera && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={columnas.length + 3} /></tr>}
      <tr
        onClick={() => tieneHijos && setAbierto((a) => !a)}
        className="hover:bg-[#F5F7F6]"
        style={{
          borderTop: seccion ? (primera ? "none" : "1px solid #DDE2DF") : `1px solid ${C.beige}`,
          cursor: tieneHijos ? "pointer" : "default",
          height: 32,
          fontWeight: seccion ? 600 : 400,
        }}
      >
        <td className="pl-4 pr-1 text-[11px] whitespace-nowrap" style={{ color: C.tenue }}>
          {nodo.codigo ? (
            nodo.codigo
          ) : nodo.cuentas?.length && nodo.cuentas.length <= 3 ? (
            // fila que suma pocas cuentas (p. ej. ahorro a la vista, una línea de cartera): se ven sus códigos
            <span title={`Suma de ${nodo.cuentas.join(", ")}`} className="cursor-help flex flex-col leading-[1.15] py-1">{nodo.cuentas.map((c) => <span key={c}>{c}</span>)}</span>
          ) : (
            <span
              title={
                nodo.cuentas?.length
                  ? `Suma de ${nodo.cuentas.join(", ")}`
                  : nodo.hijos?.some((h) => h.codigo)
                    ? `Suma de ${nodo.hijos.filter((h) => h.codigo).map((h) => h.codigo).join(", ")}`
                    : "Agrupa varias cuentas del balance"
              }
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold cursor-help"
              style={{ background: "#F3F5F4", color: C.texto2 }}
            >
              Σ
            </span>
          )}
        </td>
        <td className="pr-2" style={{ paddingLeft: 2 + nivel * 18 }}>
          <span className="flex items-center gap-1.5 min-w-0">
            {tieneHijos ? (
              abierto ? <ChevronDown size={13} className="shrink-0" color={seccion ? C.acento : C.texto2} /> : <ChevronRight size={13} className="shrink-0" color={seccion ? C.acento : C.texto2} />
            ) : (
              <span className="shrink-0" style={{ width: 12, display: "inline-block" }} />
            )}
            <span className={`truncate ${seccion ? "text-[12px] font-bold" : "text-[11px]"}`} title={nodo.label}
                  style={{ color: seccion ? C.acento : C.texto3 }}>{seccion ? nodo.label.charAt(0) + nodo.label.slice(1).toLowerCase() : nodo.label}</span>
          </span>
        </td>
        {columnas.map((i) => {
          const c = celda(nodo, i, vista, activo);
          return (
            <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: c.color }}>
              {c.txt}
            </td>
          );
        })}
        <td className="pl-2 pr-4 text-right whitespace-nowrap font-semibold" style={{ color: vaColor }}>
          {vaTxt}
        </td>
      </tr>
      {tieneHijos && abierto &&
        hijos.map((h, i) => (
          <Fila key={`${h.codigo}-${i}`} nodo={h} nivel={nivel + 1} columnas={columnas} vista={vista} expandido={expandido}
                activo={activo} ocultarCeros={ocultarCeros} />
        ))}
    </>
  );
}

// ---------- indicador (tarjeta limpia, igual que Cartera) ----------
function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: string; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}

// ---------- exportar CSV (Excel lo abre directo) ----------

function BalanceGeneralContenido() {
  const [ejercicio] = useEjercicio();
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [vista, setVista] = useState<Vista>("valores");
  const [ocultarCeros, setOcultarCeros] = useState(true); // por defecto no se muestran cuentas sin saldo ni proyección
  const [expandido, setExpandido] = useState(false);
  const ticketSync = useEscucharSincronizacion();

  const url = `/api/balance-general?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
  const cached = obtenerJSONCache<{ activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance }>(url);

  const [datos, setDatos] = useState<typeof cached | null>(() => cached ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = obtenerJSONCache<{ activo: NodoBalance; pasivo: NodoBalance; patrimonio: NodoBalance }>(url);
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
        if (data.activo) {
          guardarJSONCache(url, data);
          setDatos(data);
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
    const A = datos.activo.valores;
    const P = datos.pasivo.valores;
    const Pt = datos.patrimonio.valores;
    const hijosA = datos.activo.hijos ?? [];
    const cartera = hijosA.find((h) => h.codigo === "14")?.valores ?? A.map(() => 0);
    // Fondos disponibles = cuentas del activo que empiezan en 11 (Fondos disponibles) y 13 (Inversiones)
    const fondos = A.map((_, i) =>
      hijosA.filter((h) => h.codigo.startsWith("11") || h.codigo.startsWith("13"))
            .reduce((s, h) => s + h.valores[i], 0));
    const cuadre = A.map((a, i) => a - P[i] - Pt[i]);
    const mesesDescuadre = cuadre.filter((d) => Math.abs(d) > 1).length;
    return { A, Pt, cartera, fondos, cuadre, mesesDescuadre };
  }, [datos]);

  if (error) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.alerta }}>{error}</div>;
  }
  if (!datos || !resumen) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.texto2 }}><EsqueletoTabla filas={12} /></div>;
  }

  const columnas = NOMBRES_MES.map((_, i) => i);
  const { A, Pt, cartera, fondos, cuadre } = resumen;
  const vistas: { id: Vista; label: string }[] = [
    { id: "valores", label: "Valores" }, { id: "vertical", label: "Vertical %" }, { id: "horizontal", label: "Horizontal %" },
  ];
  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]";
  const selector = "h-9 px-2.5 text-[13px] rounded-md bg-white";
  const texto = (v: number | null, txt: string) => (v === null ? "—" : `${v >= 0 ? "Sube" : "Baja"} ${pct(v)} ${txt}`);
  const vF = variacion(fondos[0], fondos[11]);

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>

      {/* Encabezado: título y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Balance general<AnioEjercicio /></h1>
        <button type="button" onClick={() => void exportarPantalla({ agencia, ejercicio })}
                className={accion} style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Vista como pestañas a la izquierda; período y agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Vista del balance" className="flex gap-7 flex-1">
          {vistas.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={vista === t.id} onClick={() => setVista(t.id)}
                    className="pt-2 pb-2.5 -mb-px text-[13px]"
                    style={{ color: vista === t.id ? C.acento : C.texto2, fontWeight: vista === t.id ? 600 : 400, borderBottom: `2px solid ${vista === t.id ? C.acento : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => setAgencia(e.target.value)} className={`${selector} min-w-[153px]`}
                  style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {/* Indicadores: tarjetas limpias, sin gráficas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Total activo dic-${ejercicioEnUso()}`} valor={usd(A[11])} pie={texto(variacion(A[0], A[11]), "desde enero")} />
        <Indicador titulo={`Cartera de créditos dic-${ejercicioEnUso()}`} valor={usd(cartera[11])}
                   pie={`${A[11] ? `${pct((cartera[11] / A[11]) * 100)} del activo · ` : ""}${texto(variacion(cartera[0], cartera[11]), "").trim().toLowerCase()}`} />
        <Indicador titulo={`Fondos disponibles dic-${ejercicioEnUso()}`} valor={usd(fondos[11])}
                   pie={`Caja, bancos e inversiones · ${texto(vF, "").trim().toLowerCase()}`}
                   color={(vF ?? 0) < -25 ? C.alerta : undefined} />
        <Indicador titulo={`Patrimonio dic-${ejercicioEnUso()}`} valor={usd(Pt[11])} pie={texto(variacion(Pt[0], Pt[11]), "desde enero")} />
      </div>

      {/* Tabla */}
      <section className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <h2 className="flex-1 text-[14px] font-semibold">
            {vista === "valores" ? "Proyección mensual" : vista === "vertical" ? "Análisis vertical · % del activo total" : "Análisis horizontal · variación frente al mes anterior"}
          </h2>
          <button type="button" onClick={() => setExpandido((x) => !x)} aria-pressed={expandido}
                  className="h-8 px-3 rounded-lg bg-white hover:bg-[#F3F5F4] text-[12.5px] flex items-center gap-1.5" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}>
            {expandido ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandido ? "Contraer" : "Expandir"}</button>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: C.texto2 }}>
            <input type="checkbox" checked={ocultarCeros} onChange={(e) => setOcultarCeros(e.target.checked)}
                   className="w-4 h-4" style={{ accentColor: C.acento }} />
            Ocultar cuentas en cero
          </label>
        </div>
        <div className="tabla-fija fija-2" style={{ "--col1": "56px" } as React.CSSProperties}>
          <table className="w-full table-fixed text-[11px] border-collapse min-w-[1250px]">
            <colgroup>
              <col style={{ width: 92 }} />
              <col style={{ width: 230 }} />
              {columnas.map((i) => <col key={i} />)}
              <col style={{ width: 76 }} />
            </colgroup>
            <thead>
              <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.texto2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                <th className="pl-4 pr-1 text-left font-semibold">Código</th>
                <th className="px-2 text-left font-semibold">Cuenta</th>
                {columnas.map((i) => (
                  <th key={i} className="px-1 text-right font-semibold">{NOMBRES_MES[i]}</th>
                ))}
                <th className="pl-2 pr-4 text-right font-semibold whitespace-nowrap">Var. año</th>
              </tr>
            </thead>
            <tbody>
              {[datos.activo, datos.pasivo, datos.patrimonio].map((raiz, k) => (
                <Fila key={`${raiz.codigo}-${expandido}`} nodo={raiz} nivel={0} columnas={columnas} vista={vista} expandido={expandido}
                      activo={A} ocultarCeros={ocultarCeros} primera={k === 0} />
              ))}
              {/* Cuadre al final del balance (sin franjas de color) */}
              <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={columnas.length + 3} /></tr>
              <tr style={{ borderTop: "1px solid #B9C3BD", height: 36 }}>
                <td />
                <td className="px-2 text-[12px] font-bold whitespace-nowrap" style={{ color: C.texto }}>Cuadre A − (P + Pt)</td>
                {columnas.map((i) => {
                  const d = cuadre[i];
                  const ok = Math.abs(d) <= 1;
                  return (
                    <td key={i} className="px-1 text-right whitespace-nowrap font-semibold" style={{ color: ok ? C.ok : C.alerta }}>
                      {ok ? "✓" : numero(d)}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function BalanceGeneralPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-[#3D4843]">Cargando balance general...</div>}>
      <BalanceGeneralContenido />
    </Suspense>
  );
}
