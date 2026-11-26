"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import { aniosDeStats } from "../../lib/base-historica";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { leerMonto, leerMeses, sumaTextos, textoEditable } from "../../lib/numeros";
import { usePendiente } from "../../lib/cambios-pendientes";
import { CampoMonto, MensajeError, useGuardiaCambios } from "../../components/GuardiaCambios";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useRef, useState, Fragment, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, Check, Plus, Trash2, X, RefreshCw, ArrowLeftRight, Eye, ArrowUpRight, AlertTriangle, MoreHorizontal, ChevronsUpDown, ChevronsDownUp, Download } from "lucide-react";
import { cargarJSON, pedirJSON, tieneDatos, guardarMontosPorMes, eliminarFilasDepartamental, precargarEnSerie, pasosGrupoHojas, useTurnos, errorDeRespuesta } from "../../lib/useDatos";
import { EsqueletoTabla } from "../../components/Carga";
import { MESES, AGENCIAS, C, FONDO, CHIP_ON, CHIP_OFF, BotonF, ChipsMes, Indicador } from "../../components/ActivosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { useDatos } from "../../lib/useDatos";
import ResumenArbol from "../../components/ResumenArbol";
import { useResultados, buscarNodo, reemplazoDe, useVerMes, useMensualAlEditar, SelectorBaseMes } from "../../components/EgresosComun";
import { seriesEscenario, urlFlow, type DatosFlow } from "../../components/ProvisionFlowVistas";

/** Las 10 agencias más el Consolidado (suma, solo lectura). */
const AGENCIAS_PAGINA = [...AGENCIAS, "Consolidado"];
const CONSOLIDADO = "Consolidado";

// =====================================================================
// CONFIGURACIÓN · estilo institucional (mismo de Cartera, Activos, Obligaciones y Patrimonio)
// =====================================================================

const GRUPOS = [
  { id: "51", label: "51 · Intereses ganados", corto: "51 · Intereses" },
  { id: "53", label: "53 · Utilidades financieras", corto: "53 · Utilidades" },
  { id: "54", label: "54 · Ingresos por servicios", corto: "54 · Servicios" },
  { id: "55", label: "55 · Otros ingresos operacionales", corto: "55 · Otros operacionales" },
  { id: "56", label: "56 · Otros ingresos", corto: "56 · Otros ingresos" },
] as const;

const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);
// Negativos entre paréntesis (convención contable)
const usd = (n: number) => { const t = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC"); return n < 0 ? `(${t})` : t; };
const cifra = (n: number) => { if (Math.round(n) === 0) return "—"; const t = Math.abs(Math.round(n)).toLocaleString("es-EC"); return n < 0 ? `(${t})` : t; };
const pct = (n: number) => `${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
/** Formato Ecuador (lib/numeros.ts); lo que no se puede leer cuenta 0 (los guardados validan antes con leerMeses). */
const numero = (v: string) => leerMonto(v).valor ?? 0;
const etiquetaCorte = (c: { anio: number; mes: number }) => `${MESES[c.mes - 1].toLowerCase()}-${String(c.anio).slice(2)}`;

const TABLA = "w-full table-fixed text-[11px] border-collapse";
/** Cabecera de tablas pequeñas (sin meses): blanca, sin mayúsculas. */
const CAB = "text-[11px] font-semibold";
const CAB_ESTILO = { background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF" };
const INPUT = "h-8 px-2.5 text-[12px] rounded-md bg-white outline-none focus:ring-2 focus:ring-[#E3EEE7]";
const BORDE_INPUT = "1px solid #C9D0CC";

function BotonSecundario({ onClick, children, disabled, activo }: { onClick: () => void; children: ReactNode; disabled?: boolean; activo?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="h-9 px-3.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F3F5F4] disabled:opacity-50"
            style={activo ? { ...CHIP_ON, border: `1px solid ${C.acentoSuave}` } : { background: "#fff", border: BORDE_INPUT, color: C.texto }}>
      {children}
    </button>
  );
}
function BotonPrimario({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.acento }}>
      {children}
    </button>
  );
}
function BotonIcono({ onClick, titulo, children, peligro, activo }: { onClick: () => void; titulo: string; children: ReactNode; peligro?: boolean; activo?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-label={titulo}
            className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#E6EAE8]"
            style={activo ? CHIP_ON : { color: peligro ? C.alerta : C.texto2 }}>
      {children}
    </button>
  );
}
function Cabecera({ primera, ultima, extra }: { primera: string; ultima: string; extra?: boolean; anio?: number }) {
  return (
    <thead>
      <tr className="text-[11px] font-semibold" style={{ ...CAB_ESTILO, height: 32 }}>
        <th className="pl-4 text-left font-semibold">{primera}</th>
        {MESES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
        <th className="px-2 text-right font-semibold">{ultima}</th>
        {extra && <th aria-hidden="true" />}
      </tr>
    </thead>
  );
}
/** Selector compacto (caja blanca, opción elegida en verde suave), igual que en Cartera. */
function Pastillas<T extends string>({ opciones, valor, onChange, etiqueta }: { opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string }) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-0.5 p-0.5 rounded-md bg-white" style={{ border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={valor === o.id}
                className="h-8 px-3 rounded text-[12px]" style={valor === o.id ? { ...CHIP_ON, fontWeight: 600 } : { ...CHIP_OFF, fontWeight: 400 }}>{o.label}</button>
      ))}
    </div>
  );
}
/** 12 casillas de monto con "Repetir Ene". */
function MontosMes({ valores, onChange, etiqueta }: { valores: string[]; onChange: (v: string[]) => void; etiqueta: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold flex-1" style={{ color: C.texto3 }}>{etiqueta}</span>
        <button type="button" onClick={() => onChange(Array(12).fill(valores[0] || "0"))} className="text-[11px] font-semibold" style={{ color: C.acento }}>Repetir Ene</button>
      </div>
      <div className="grid grid-cols-12 gap-1.5">
        {MESES.map((m, i) => (
          <label key={m} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-center" style={{ color: C.texto2 }}>{m}</span>
            <CampoMonto value={valores[i] ?? ""} placeholder="0" etiqueta={`${etiqueta} ${m}`}
                   onChange={(v) => onChange(valores.map((x, j) => (j === i ? v : x)))}
                   className={`${INPUT} w-full text-right px-1.5`} style={{ border: BORDE_INPUT }} />
          </label>
        ))}
      </div>
    </div>
  );
}
function Modal({ children, ancho = 640 }: { children: ReactNode; ancho?: number }) {
  return (
    <div className="estilo-institucional fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,20,24,0.32)" }}>
      <div className="w-full rounded-lg bg-white p-5 flex flex-col gap-3.5" style={{ maxWidth: ancho, border: "1px solid #D5DBD7", color: C.texto }}>{children}</div>
    </div>
  );
}

// =====================================================================
// PÁGINA
// =====================================================================

interface FilaActivo { agencia_nombre: string; activo_dic2025: number | null; porcentaje: number }

function IngresosContenido() {
  const [ejercicio] = useEjercicio();
  const [grupo, setGrupo] = useState<string>("51");
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const guardia = useGuardiaCambios();
  const [activos, setActivos] = useState<FilaActivo[]>([]);
  // Las demás pestañas (51 y hojas 53-56) se preparan por detrás (solo en la versión publicada).
  useEffect(() => precargarEnSerie([
    `/api/ingresos-51?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`,
    `/api/ingresos-cartera-detalle?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`,
    ...["53", "54", "55", "56"].flatMap((g) => pasosGrupoHojas(g, agencia, ejercicio)),
  ]), [agencia, ejercicio]);

  useEffect(() => {
    pedirJSON("/api/activos-por-agencia").then((d) => setActivos(d.filas ?? [])).catch(() => setActivos([]));
  }, []);

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Proyección de ingresos<AnioEjercicio /></h1>
        <button type="button" onClick={() => void exportarPantalla({ agencia, ejercicio })}
                className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]" style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Grupos a la izquierda, agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Grupos de ingresos" className="flex flex-wrap gap-x-7 flex-1">
          {GRUPOS.map((g) => {
            const activa = grupo === g.id;
            return (
              <button key={g.id} type="button" role="tab" aria-selected={activa} onClick={() => { if (g.id !== grupo) guardia.pedir(() => setGrupo(g.id)); }} title={g.label}
                      className="pt-2 pb-2.5 -mb-px text-[13px]"
                      style={{ color: activa ? C.acento : C.texto2, fontWeight: activa ? 600 : 400, borderBottom: `2px solid ${activa ? C.acento : "transparent"}` }}>
                {g.corto}
              </button>
            );
          })}
        </div>
        <span className="pb-1.5"><SelectorBaseMes /></span>
        <label className="flex items-center gap-2 pb-1.5 text-[13px] ml-2" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => { const a = e.target.value; guardia.pedir(() => setAgencia(a)); }}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS_PAGINA.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={`/api/ingresos-51?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`} agencia={agencia} />
      {guardia.dialogo}

      {grupo === "51" ? (
        <Intereses51 agencia={agencia} ejercicio={ejercicio} />
      ) : (
        <HojasGrupo key={grupo} grupo={grupo} agencia={agencia} ejercicio={ejercicio} activos={activos} />
      )}
    </div>
  );
}

// =====================================================================
// 51 · INTERESES Y DESCUENTOS GANADOS (una sola tabla: 5101 · 5103 · 5104 · 5190)
// =====================================================================

interface Datos51 {
  tasaBancosPorMes: number[]; tasaInternosPorMes: number[];
  basePorMesBancos: number[]; i5101PorMes: number[];
  cuentasInternas: { codigo: string; nombre: string; saldo: number }[]; basePorMesInternos: number[]; i5190PorMes: number[]; calcula5190: boolean;
  i5103PorMes: number[] | null; saldo13Corte: number;
  corte: { anio: number; mes: number }; error?: string;
}
interface DetalleIngresoCartera { productivo: number[]; consumo: number[]; inmobiliario: number[]; microcredito: number[]; mora: number[]; total: number[]; error?: string }
const LINEAS_5104: { key: keyof Omit<DetalleIngresoCartera, "total" | "error">; label: string }[] = [
  { key: "productivo", label: "Productivo" }, { key: "consumo", label: "Consumo" }, { key: "inmobiliario", label: "Inmobiliario" },
  { key: "microcredito", label: "Microcrédito" }, { key: "mora", label: "Mora" },
];

type Vista51 = "todas" | "5101" | "5103" | "5104" | "5190";
const VISTAS_51: { id: Vista51; label: string }[] = [
  { id: "todas", label: "Todas" }, { id: "5101", label: "Depósitos" }, { id: "5103", label: "Inversiones" },
  { id: "5104", label: "Cartera" }, { id: "5190", label: "Préstamos internos" },
];
interface TituloInteres { institucion: string; tasaAnual: number; capitalPorMes: number[]; interesPorMes: number[] }

/** "0,35 %" si es igual todo el año; "0,35 % → 0,50 % desde Jul" si cambia. */
function resumenTasa(t: number[]): string {
  const cambios = t.map((v, i) => (i > 0 && v !== t[i - 1] ? i : -1)).filter((i) => i > 0);
  if (!cambios.length) return pct(t[0]);
  if (cambios.length === 1) return `${pct(t[0])} → ${pct(t[cambios[0]])} desde ${MESES[cambios[0]]}`;
  return "varía por mes";
}

function Intereses51({ agencia, ejercicio }: { agencia: string; ejercicio: number }) {
  const esConsolidado = agencia === CONSOLIDADO;
  const [d, setD] = useState<Datos51 | null>(null);
  const [cart, setCart] = useState<DetalleIngresoCartera | null>(null);
  const ver = useVerMes();
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(0);

  // edición de tasas: un valor "desde" un mes (se guarda mes a mes)
  const [editando, setEditando] = useState(false);
  const [tB, setTB] = useState("");
  const [desdeB, setDesdeB] = useState(0);
  const [tI, setTI] = useState("");
  const [desdeI, setDesdeI] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // vista: todas las cuentas o el detalle de una fuente
  const [vista, setVista] = useState<Vista51>("todas");
  const [alcance5190, setAlcance5190] = useState<"agencia" | "todas">("agencia");
  const [titulos, setTitulos] = useState<TituloInteres[] | null>(null);
  useEffect(() => { setTitulos(null); }, [agencia, version]);
  useEffect(() => {
    if (vista !== "5103" || titulos || esConsolidado) return;
    pedirJSON(`/api/inversiones?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`)
      .then((x) => setTitulos(x?.proyeccion?.titulos ?? [])).catch(() => setTitulos([]));
  }, [vista, titulos, agencia, ejercicio, esConsolidado]);

  useEffect(() => {
    const u51 = `/api/ingresos-51?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    const uCart = `/api/ingresos-cartera-detalle?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    // Si ya se vio antes, se muestra al instante y se actualiza por detrás
    let vivo = true;
    setCargando(!(tieneDatos(u51) && tieneDatos(uCart))); setEditando(false);
    Promise.all([
      cargarJSON<Datos51>(u51, (a) => { if (vivo) setD(a); }).catch(() => { if (vivo) setD((x) => x ?? ({ error: "No se pudo conectar con el servidor. Recarga la página." } as unknown as Datos51)); }),
      cargarJSON<DetalleIngresoCartera & { error?: string }>(uCart, (b) => { if (vivo) setCart(b && !b.error && b.total ? delMes(b) : null); }).catch(() => undefined),
    ]).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [agencia, ejercicio, version]);

  if (cargando) return <EsqueletoTabla indicadores filas={5} />;
  if (!d || d.error || !d.i5101PorMes) return <p className="text-[13px]" style={{ color: C.alerta }}>{d?.error ?? "No se pudieron calcular los intereses de la 51."}</p>;

  const cero = Array(12).fill(0) as number[];
  const i5103 = d.i5103PorMes ?? cero;
  const i5104 = cart?.total ?? cero;
  // En Consolidado las tasas y bases no se suman (vienen de una sola agencia): solo valen los montos.
  const calcula5190 = d.calcula5190 || (esConsolidado && (d.i5190PorMes ?? []).some((v) => Math.round(v) !== 0));
  const i5190 = calcula5190 ? d.i5190PorMes : cero;
  const total = MESES.map((_, i) => d.i5101PorMes[i] + i5103[i] + i5104[i] + i5190[i]);
  const anterior = (i: number) => (i === 0 ? `el balance (${etiquetaCorte(d.corte)})` : MESES[i - 1]);

  // tasas nuevas "desde" un mes
  const aplicarDesde = (actual: number[], valor: string, desde: number) => actual.map((v, i) => (i >= desde ? numero(valor) : v));
  const nuevaB = editando ? aplicarDesde(d.tasaBancosPorMes, tB, desdeB) : d.tasaBancosPorMes;
  const nuevaI = editando ? aplicarDesde(d.tasaInternosPorMes, tI, desdeI) : d.tasaInternosPorMes;
  const prev5101 = d.basePorMesBancos.map((b, i) => Math.max(0, b) * nuevaB[i] / 100 / 12);
  const cambiaB = nuevaB.some((v, i) => v !== d.tasaBancosPorMes[i]);
  // la tasa de los préstamos internos se edita en Transferencias internas (la misma para todas las oficinas)
  const cambiaI = false;

  function empezar() {
    if (esConsolidado) return;
    setTB(textoEditable(d!.tasaBancosPorMes[0], 4) || "0"); setDesdeB(0); setTI(textoEditable(d!.tasaInternosPorMes[0], 4) || "0"); setDesdeI(0);
    setAviso(null); setEditando(true); setAbierta(null);
  }
  async function guardar() {
    if (esConsolidado) return;
    const malo = [tB, tI].map((t) => leerMonto(t).error).find(Boolean);
    if (malo) { setAviso(`Tasa: ${malo}.`); return; }
    if ([numero(tB), numero(tI)].some((t) => t < 0 || t > 100)) { setAviso("Las tasas deben estar entre 0 % y 100 %."); return; }
    if (guardando) return;
    setGuardando(true); setAviso(null);
    try {
      const envios = [
        ...(cambiaB ? [{ concepto: "ingresos_tasa_bancos", valores: nuevaB }] : []),
        ...(cambiaI ? [{ concepto: "ingresos_tasa_prestamos_internos", valores: nuevaI }] : []),
      ];
      for (const e of envios) {
        const r = await apiFetch("/api/otros-pasivo-parametros", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agencia, ejercicio, concepto: e.concepto, montosPorMes: e.valores }),
        });
        const err = await errorDeRespuesta(r);
        if (err) throw new Error(err);
      }
      setVersion((v) => v + 1);
    } catch (e) {
      setAviso(e instanceof Error && e.message ? `No se pudieron guardar las tasas: ${e.message}` : "No se pudieron guardar las tasas. Intenta de nuevo.");
    } finally { setGuardando(false); }
  }

  type Fila = {
    id: string; codigo?: string; label: string; tasa?: string; valores: number[]; clave?: boolean; tenue?: boolean; enlace?: string;
    formula?: (i: number) => ReactNode; enPct?: boolean; total?: number | null;
  };
  const internosConSaldo = d.cuentasInternas.filter((c) => Math.round(c.saldo) !== 0);
  const filasBase: Fila[] = [
    { id: "5101", codigo: "5101", label: "Depósitos en bancos", tasa: resumenTasa(d.tasaBancosPorMes), valores: d.i5101PorMes,
      formula: (i) => `Bancos (1103) al cierre de ${anterior(i)} ${usd(d.basePorMesBancos[i])} × ${pct(d.tasaBancosPorMes[i])} ÷ 12 = ${usd(d.i5101PorMes[i])}. Se usa el mes anterior porque el interés del mes entra a bancos.` },
    { id: "5103", codigo: "5103", label: "Inversiones", tasa: d.i5103PorMes ? "tasa de cada título" : "sin títulos", valores: i5103, tenue: !d.i5103PorMes, enlace: "/inversiones",
      formula: (i) => d.i5103PorMes
        ? `Interés devengado de cada título en ${MESES[i]} (capital × tasa ÷ base, día por día) = ${usd(i5103[i])}. El detalle por título está en Inversiones.`
        : `${agencia} no tiene títulos en el registro de Inversiones, por eso la 5103 es 0.` },
    { id: "5104", codigo: "5104", label: "Cartera de crédito", tasa: "de Cartera", valores: i5104, enlace: "/cartera",
      formula: (i) => cart
        ? <>{LINEAS_5104.map((l) => `${l.label} ${usd(cart[l.key][i])}`).join(" + ")} = <b>{usd(cart.total[i])}</b>. Sale del módulo de Cartera (interés por línea y relación de mora).</>
        : "No se pudo leer el detalle de Cartera." },
    { id: "5190", codigo: "5190", label: "Préstamos internos", tasa: d.calcula5190 ? resumenTasa(d.tasaInternosPorMes) : "sin préstamos", valores: i5190, tenue: !d.calcula5190,
      formula: (i) => d.calcula5190
        ? <>Interés por días, como contabilidad (base 360; del 25 al día 4 sobre el saldo antes del abono y del 4 al 25 sobre el saldo después), sobre lo prestado a otras oficinas ({usd(d.basePorMesInternos[i])} al empezar el mes) al {pct(d.tasaInternosPorMes[i])} = <b>{usd(i5190[i])}</b>. Saldos, abonos y tasa se manejan en Otros activos → Transferencias internas:
            <span className="flex flex-wrap gap-1.5 mt-1.5">{internosConSaldo.map((c) => (
              <span key={c.codigo} className="px-2 py-0.5 rounded text-[11px]" style={{ background: C.beige, color: C.texto3 }} title={c.codigo}>{c.nombre} · {usd(c.saldo)}</span>
            ))}</span></>
        : `${agencia} no tiene subcuentas de 1908 que digan "préstamos internos", por eso la 5190 es 0.` },
    { id: "tot", codigo: "51", label: "Total intereses ganados", valores: total, clave: true },
  ];
  // Consolidado: sin tasas ni fórmulas por agencia; la ƒ explica que es la suma de las 10 agencias.
  const filas: Fila[] = esConsolidado
    ? filasBase.map((f) => ({
        ...f, tasa: undefined,
        tenue: f.id === "5103" ? !d.i5103PorMes : f.id === "5190" ? !calcula5190 : f.tenue,
        formula: f.clave ? undefined : (i: number) => `Suma de la ${f.codigo} de las 10 agencias en ${MESES[i]}: ${usd(f.valores[i])}.`,
      }))
    : filasBase;

  // ---- detalle por fuente ----
  const detalle: Record<Exclude<Vista51, "todas">, { titulo: string; filas: Fila[]; vacio?: ReactNode }> = {
    "5101": {
      titulo: "Depósitos en bancos · 5101",
      filas: [
        { id: "b1", codigo: "1103", label: "Bancos al cierre del mes anterior", valores: d.basePorMesBancos, tenue: true, total: null,
          formula: (i) => (i === 0 ? `Saldo de bancos (1103) del balance a ${etiquetaCorte(d.corte)}: ${usd(d.basePorMesBancos[0])}.` : `Bancos proyectados al cierre de ${MESES[i - 1]} (sale del Flujo de efectivo): ${usd(d.basePorMesBancos[i])}.`) },
        { id: "b2", label: "Tasa anual", valores: d.tasaBancosPorMes, enPct: true, tenue: true, total: null },
        filas[0],
      ],
    },
    "5103": {
      titulo: "Inversiones · 5103",
      filas: titulos && titulos.length ? [
        ...titulos.map((t, k) => ({
          id: `t${k}`, label: t.institucion, tasa: pct(t.tasaAnual * 100), valores: t.interesPorMes,
          formula: (i: number) => `Capital de ${MESES[i]} ${usd(t.capitalPorMes[i])} × ${pct(t.tasaAnual * 100)} ÷ base × días del mes = ${usd(t.interesPorMes[i])}.`,
        })),
        { ...filas[1], id: "t-tot", label: "Total inversiones", clave: true, tasa: undefined, enlace: undefined, formula: undefined },
      ] : [],
      vacio: titulos === null ? "Cargando títulos..." : <>
        {agencia} no tiene títulos registrados, así que la 5103 es 0.{" "}
        <Link href="/inversiones" className="font-semibold underline" style={{ color: C.acento }}>Registrar en Inversiones</Link>
      </>,
    },
    "5104": {
      titulo: "Cartera de crédito · 5104",
      filas: cart ? [
        ...LINEAS_5104.map((l) => ({ id: `c-${l.key}`, label: l.key === "mora" ? "Intereses de mora" : l.label, valores: cart[l.key] })),
        { id: "c-tot", codigo: "5104", label: "Total cartera", valores: cart.total, clave: true, enlace: "/cartera",
          formula: (i: number) => `Interés de cada línea según su saldo y tasa, más la mora, del módulo de Cartera: ${usd(cart.total[i])} en ${MESES[i]}.` },
      ] : [],
      vacio: "No se pudo leer el detalle de Cartera.",
    },
    "5190": {
      titulo: "Préstamos internos · 5190",
      filas: d.calcula5190 ? [
        { ...filas[3], id: "p-tot", label: "Total préstamos internos", clave: true, tasa: resumenTasa(d.tasaInternosPorMes), formula: undefined },
      ] : [],
      vacio: `${agencia} no tiene subcuentas de 1908 que digan "préstamos internos", así que la 5190 es 0.`,
    },
  };
  // Consolidado: el detalle por tasa, título o subcuenta no se puede sumar; se muestra solo el total de la fuente.
  if (esConsolidado) {
    detalle["5101"].filas = [filas[0]];
    detalle["5103"].filas = [{ ...filas[1], id: "t-tot", label: "Total inversiones", clave: true, enlace: "/inversiones" }];
    detalle["5190"].filas = calcula5190 ? [{ ...filas[3], id: "p-tot", label: "Total préstamos internos", clave: true }] : [];
    detalle["5190"].vacio = "Ninguna agencia tiene subcuentas de 1908 que digan \"préstamos internos\", así que la 5190 es 0.";
  }
  const filasVista = vista === "todas" ? filas : detalle[vista].filas;
  const tituloVista = vista === "todas" ? "Intereses y descuentos ganados" : detalle[vista].titulo;
  const fila = filasVista.find((f) => f.id === abierta && f.formula) ?? null;

  const campoTasa = ({ etiqueta, valor, onValor, desde, onDesde, antes, despues }: {
    etiqueta: string; valor: string; onValor: (v: string) => void; desde: number; onDesde: (m: number) => void; antes: number[]; despues: number[];
  }) => {
    const dif = suma(despues) - suma(antes);
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="w-56 text-[12px] font-semibold whitespace-nowrap" style={{ color: C.texto3 }}>{etiqueta}</span>
        <input value={valor} onChange={(e) => onValor(e.target.value)} inputMode="decimal" aria-label={`${etiqueta} (% anual)`}
               className={`${INPUT} w-20 text-right`} style={{ border: BORDE_INPUT }} />
        <span className="text-[12px]" style={{ color: C.texto2 }}>% anual desde</span>
        <select value={desde} onChange={(e) => onDesde(Number(e.target.value))} aria-label={`${etiqueta} desde`} className={INPUT} style={{ border: BORDE_INPUT }}>
          {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <span className="text-[12px] ml-2" style={{ color: C.texto2 }}>
          En el año {usd(suma(antes))} → <b style={{ color: C.texto }}>{usd(suma(despues))}</b>
          <span className="font-semibold" style={{ color: Math.round(dif) === 0 ? C.tenue : dif > 0 ? C.ok : C.alerta }}>
            {Math.round(dif) === 0 ? " · sin cambio" : ` · ${dif > 0 ? "+" : "−"}${usd(Math.abs(dif))}`}
          </span>
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <Indicador titulo="Intereses ganados (51)" valor={usd(suma(total))} pie={`Promedio ${usd(suma(total) / 12)} al mes`} />
        <Indicador titulo="5101 · Bancos" valor={usd(suma(d.i5101PorMes))} pie={esConsolidado ? "Total del año" : `Tasa ${resumenTasa(d.tasaBancosPorMes)}`} />
        <Indicador titulo="5103 · Inversiones" valor={d.i5103PorMes ? usd(suma(i5103)) : "—"} pie={d.i5103PorMes ? "Según el registro de títulos" : "Sin títulos registrados"} />
        <Indicador titulo="5104 · Cartera" valor={usd(suma(i5104))} pie={`${suma(total) ? Math.round(suma(i5104) / suma(total) * 100) : 0} % del grupo`} />
        <Indicador titulo="5190 · Préstamos internos" valor={usd(suma(i5190))} pie={!calcula5190 ? "Sin préstamos internos" : esConsolidado ? "Total del año" : `Tasa ${resumenTasa(d.tasaInternosPorMes)}`} />
      </div>

      <section className="tarjeta overflow-hidden flex flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <h2 className="text-[14px] font-semibold">{tituloVista}</h2>
          <span className="flex-1" />
          <Pastillas etiqueta="Ver detalle" opciones={VISTAS_51} valor={vista} onChange={(v) => { setVista(v); setAbierta(null); }} />
          {vista === "5190" && (
            <Pastillas etiqueta="Alcance" valor={alcance5190} onChange={setAlcance5190}
              opciones={[{ id: "agencia", label: agencia }, { id: "todas", label: "Todas las agencias" }]} />
          )}
          {esConsolidado || vista === "5103" || vista === "5104" || vista === "5190" ? null : !editando ? (
            <BotonSecundario onClick={empezar}><Pencil size={14} /> Editar tasas</BotonSecundario>
          ) : (
            <div className="flex items-center gap-2">
              <BotonSecundario onClick={() => setEditando(false)} disabled={guardando}>Cancelar</BotonSecundario>
              <BotonPrimario onClick={guardar} disabled={guardando || (!cambiaB && !cambiaI)}><Check size={14} /> {guardando ? "Guardando..." : "Guardar tasas"}</BotonPrimario>
            </div>
          )}
        </div>

        {editando && !esConsolidado && (
          <div className="mx-4 mt-3 rounded-md px-4 py-3.5 flex flex-col gap-2.5" style={{ background: C.crema, border: `1px solid ${C.beige}` }}>
            {campoTasa({ etiqueta: "Bancos · 5101", valor: tB, onValor: setTB, desde: desdeB, onDesde: setDesdeB, antes: d.i5101PorMes, despues: prev5101 })}
            <p className="text-[11px]" style={{ color: C.texto2 }}>La tasa se aplica desde el mes elegido hasta diciembre; los meses anteriores se quedan como están. Al guardar se recalcula todo.</p>
            {aviso && <p className="text-[12px]" style={{ color: C.alerta }}>{aviso}</p>}
          </div>
        )}

        {vista === "5190" && alcance5190 === "todas" ? <PrestamosEntreAgencias ejercicio={ejercicio} version={version} /> : (
        <div className={editando || esConsolidado ? "mt-2" : undefined}>
          <table className={TABLA}>
            <colgroup><col style={{ width: 270 }} />{MESES.map((m) => <col key={m} />)}<col style={{ width: 90 }} /><col style={{ width: 25 }} /></colgroup>
            <Cabecera primera="Cuenta" ultima="Año" extra />
            <tbody>
              {filasVista.length === 0 && (
                <tr style={{ borderTop: `1px solid ${C.beige}`, height: 40 }}><td colSpan={15} className="pl-4 text-[12px]" style={{ color: C.texto2 }}>{vista !== "todas" && detalle[vista].vacio}</td></tr>
              )}
              {filasVista.map((f) => (
                <tr key={f.id} className="hover:bg-[#F5F7F6]" style={{ borderTop: f.clave ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: 32, fontWeight: f.clave ? 600 : 400 }}>
                  <td className="pl-4">
                    <span className="flex items-center gap-2 pr-2">
                      <span className="flex-1 flex items-baseline gap-2 overflow-hidden whitespace-nowrap text-[11px]">
                        {!f.clave && f.codigo && <span className="text-[11px] shrink-0" style={{ color: C.texto2 }}>{f.codigo}</span>}
                        <span className="overflow-hidden text-ellipsis" title={f.label} style={{ color: f.clave ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>{f.label}</span>
                        {f.tasa && <span className="text-[10px] shrink-0" style={{ color: C.tenue }}>{f.tasa}</span>}
                      </span>
                      {f.enlace && (
                        <Link href={f.enlace} title={`Ir a ${f.label}`} aria-label={`Ir a ${f.label}`} className="w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[#E6EAE8]" style={{ color: C.tenue }}>
                          <ArrowUpRight size={14} />
                        </Link>
                      )}
                    </span>
                  </td>
                  {(f.enPct ? f.valores : ver(f.valores)).map((v, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: f.enPct ? C.texto2 : Math.round(v) === 0 ? C.tenue : f.clave ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>
                      {f.enPct ? pct(v) : cifra(v)}
                    </td>
                  ))}
                  <td className="px-2 text-right whitespace-nowrap font-semibold" style={{ color: f.total === null || Math.round(suma(f.valores)) === 0 ? C.tenue : C.texto }}>
                    {f.total === null ? "" : cifra(suma(f.valores))}
                  </td>
                  {/* ƒ al final de la fila */}
                  <td className="text-center">
                    {f.formula && <BotonF abierto={abierta === f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} titulo={`Fórmula de ${f.label}`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fila?.formula && (
            <div className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.beige}`, background: C.crema }}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[12px]">ƒ</span>
                <b className="text-[12px] flex-1">{fila.codigo ? `${fila.codigo} · ` : ""}{fila.label}</b>
                <ChipsMes valor={mes} onChange={setMes} />
              </div>
              <div className="text-[12px]" style={{ color: C.texto3 }}><span className="font-semibold" style={{ color: C.acento }}>{MESES[mes]} · </span>{fila.formula(mes)}</div>
            </div>
          )}
        </div>
        )}
      </section>
    </>
  );
}


// ---------------- préstamos internos entre las 10 agencias ----------------
interface CuentaInterna { codigo: string; nombre: string; saldo: number }
interface AgenciaInterna {
  agencia: string; corte: { anio: number; mes: number }; tasa: number; interesCobrado: number; interesPagado: number;
  presta: CuentaInterna[]; recibe: CuentaInterna[]; totalPresta: number; totalRecibe: number;
  otras1908: CuentaInterna[]; otras2908: CuentaInterna[];
}

function PrestamosEntreAgencias({ ejercicio, version }: { ejercicio: number; version: number }) {
  const [datos, setDatos] = useState<AgenciaInterna[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    cargarJSON<{ error?: string; agencias?: AgenciaInterna[] }>(`/api/prestamos-internos?ejercicio=${ejercicio}`,
      (x) => (x.error ? setError(x.error) : setDatos(x.agencias ?? []))).catch(() => setError("Error de conexión. Recarga la página."));
  }, [ejercicio, version]);

  if (error) return <p className="px-4 py-3 text-[12px]" style={{ color: C.alerta }}>{error}</p>;
  if (!datos) return <p className="px-4 py-3 text-[12px]" style={{ color: C.texto2 }}>Leyendo los balances de las 10 agencias...</p>;

  const prestado = suma(datos.map((a) => a.totalPresta));
  const recibido = suma(datos.map((a) => a.totalRecibe));
  const cuadra = Math.abs(prestado - recibido) < 1;
  const Lista = ({ titulo, cuentas, tenue }: { titulo: string; cuentas: CuentaInterna[]; tenue?: boolean }) => (
    <div className="flex flex-col gap-1 min-w-[234px] flex-1">
      <span className="text-[12px] font-semibold" style={{ color: C.texto3 }}>{titulo}</span>
      {cuentas.length ? cuentas.map((c) => (
        <span key={c.codigo} className="flex gap-2 text-[11px]" style={{ color: tenue ? C.texto2 : C.texto3 }}>
          <span className="text-[11px]" style={{ color: C.texto2 }}>{c.codigo}</span>
          <span className="flex-1 truncate">{c.nombre || "sin nombre en el catálogo"}</span>
          <span>{usd(c.saldo)}</span>
        </span>
      )) : <span className="text-[11px]" style={{ color: C.tenue }}>ninguna</span>}
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="mt-2">
        <table className={TABLA}>
          <colgroup><col style={{ width: 198 }} /><col style={{ width: 81 }} /><col /><col /><col /><col /><col style={{ width: 36 }} /></colgroup>
          <thead>
            <tr className={CAB} style={{ ...CAB_ESTILO, height: 32 }}>
              <th className="pl-4 text-left font-semibold">Agencia</th>
              <th className="px-3 text-left">Corte</th>
              <th className="px-3 text-right">Presta · 1908</th>
              <th className="px-3 text-right">Cobra en el año · 5190</th>
              <th className="px-3 text-right">Recibe · 2908</th>
              <th className="px-3 text-right">Paga en el año · 41059005</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {datos.map((a) => {
              const abiertaEsta = abierta === a.agencia;
              const sinNada = !a.presta.length && !a.recibe.length;
              return (
                <Fragment key={a.agencia}>
                  <tr onClick={() => setAbierta(abiertaEsta ? null : a.agencia)} className="cursor-pointer hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                    <td className="pl-4" style={{ color: sinNada ? C.texto2 : C.texto3 }}>{a.agencia}</td>
                    <td className="px-3 text-[11px]" style={{ color: C.texto2 }}>{etiquetaCorte(a.corte)}</td>
                    <td className="px-3 text-right" style={{ color: a.totalPresta ? C.texto3 : C.tenue }}>{a.totalPresta ? usd(a.totalPresta) : "—"}</td>
                    <td className="px-3 text-right font-semibold" style={{ color: a.interesCobrado ? C.ok : C.tenue }}>{a.interesCobrado ? usd(a.interesCobrado) : "—"}</td>
                    <td className="px-3 text-right" style={{ color: a.totalRecibe ? C.texto3 : C.tenue }}>{a.totalRecibe ? usd(a.totalRecibe) : "—"}</td>
                    <td className="px-3 text-right font-semibold" style={{ color: a.interesPagado ? C.alerta : C.tenue }}>{a.interesPagado ? usd(a.interesPagado) : "—"}</td>
                    <td className="pr-3 text-right text-[11px]" style={{ color: C.tenue }}>{abiertaEsta ? "▴" : "▾"}</td>
                  </tr>
                  {abiertaEsta && (
                    <tr><td colSpan={7} className="px-4 py-3" style={{ background: C.crema, borderTop: `1px solid ${C.beige}` }}>
                      <div className="flex flex-wrap gap-6">
                        <Lista titulo="Préstamos que da (1908)" cuentas={a.presta} />
                        <Lista titulo="Préstamos que recibe (2908)" cuentas={a.recibe} />
                        <Lista titulo="Otras subcuentas 1908 / 2908 (transferencias, no cuentan)" cuentas={[...a.otras1908, ...a.otras2908]} tenue />
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            <tr style={{ borderTop: "1px solid #B9C3BD", height: 32, fontWeight: 600 }}>
              <td className="pl-4" colSpan={2}>Total</td>
              <td className="px-3 text-right">{usd(prestado)}</td>
              <td className="px-3 text-right">{usd(suma(datos.map((a) => a.interesCobrado)))}</td>
              <td className="px-3 text-right">{usd(recibido)}</td>
              <td className="px-3 text-right">{usd(suma(datos.map((a) => a.interesPagado)))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-[12px] flex items-center gap-2" style={{ color: cuadra ? C.ok : C.aviso, borderTop: `1px solid ${C.beige}` }}>
        {cuadra ? <Check size={14} /> : <AlertTriangle size={14} />}
        {cuadra
          ? `Lo prestado (${usd(prestado)}) es igual a lo recibido: las oficinas están conciliadas.`
          : `Lo prestado (${usd(prestado)}) no es igual a lo recibido (${usd(recibido)}): diferencia de ${usd(prestado - recibido)}. Puede ser un corte distinto entre agencias o una subcuenta con otro nombre; abre cada agencia para revisar.`}
      </p>
    </div>
  );
}

// =====================================================================
// 53 A 56 · HOJAS (cuentas cargadas a mano o desde el histórico)
// =====================================================================

type Modo = "directo" | "prorrateado";
interface FilaResumenRaw { id: number; departamento: string; nombre: string; mes: number; monto: number; nota: string | null }
interface LineaResumen { nombre: string; idsPorMes: number[]; montosPorMes: number[]; nota: string | null }
interface FilaRaw { id: number; departamento: string; concepto: string; cuenta_nombre: string | null; mes: number; monto: number; modo: Modo; resumen_id: number | null; origen: string }
interface Linea { concepto: string; cuenta_nombre: string | null; modo: Modo; origen: string; resumen_id: number | null; idsPorMes: (number | null)[]; montosPorMes: number[] }
interface DatosHistoricosCuenta { codigo: string; base_ttm: number; pesos_mensuales: string | null; stats_anuales: string | null }
type Sugerida = { codigo: string; nombre_cuenta: string; base_ttm: number; pesos_mensuales: string | null; seleccionado: boolean };

function agruparResumen(filas: FilaResumenRaw[]): LineaResumen[] {
  const m = new Map<string, LineaResumen>();
  for (const f of filas) {
    if (!m.has(f.nombre)) m.set(f.nombre, { nombre: f.nombre, idsPorMes: Array(12).fill(0), montosPorMes: Array(12).fill(0), nota: f.nota });
    const l = m.get(f.nombre)!;
    l.idsPorMes[f.mes - 1] = f.id; l.montosPorMes[f.mes - 1] = f.monto;
    if (f.nota) l.nota = f.nota;
  }
  return Array.from(m.values());
}
function agruparLineas(filas: FilaRaw[]): Linea[] {
  const m = new Map<string, Linea>();
  for (const f of filas) {
    if (!m.has(f.concepto)) m.set(f.concepto, { concepto: f.concepto, cuenta_nombre: f.cuenta_nombre, modo: f.modo, resumen_id: f.resumen_id, origen: f.origen, idsPorMes: Array(12).fill(null), montosPorMes: Array(12).fill(0) });
    const l = m.get(f.concepto)!;
    l.idsPorMes[f.mes - 1] = f.id; l.montosPorMes[f.mes - 1] = f.monto;
  }
  return Array.from(m.values());
}
function montosMensuales(baseAnual: number, pesosJson: string | null, crecimiento: number, reparto: "estacional" | "parejo"): number[] {
  const total = baseAnual * (1 + crecimiento / 100);
  const parejo = () => Array(12).fill(Math.round(total / 12));
  if (reparto === "parejo" || !pesosJson) return parejo();
  try {
    const pesos: number[] = JSON.parse(pesosJson);
    if (!Array.isArray(pesos) || pesos.length !== 12) return parejo();
    return pesos.map((p) => Math.round(total * p));
  } catch { return parejo(); }
}

/** Nombre de la hoja sin el código de la cuenta: «5301 - Utilidades» → «Utilidades». */
const sinCodigo = (h: string) => h.replace(/^\s*\d{4,}\s*[-–·.]?\s*/, "") || h;

function HojasGrupo({ grupo, agencia, ejercicio, activos }: { grupo: string; agencia: string; ejercicio: number; activos: FilaActivo[] }) {
  const agenciaActiva = activos.find((a) => a.agencia_nombre === agencia);
  // Consolidado: suma de las 10 agencias, solo lectura (sin crear, editar ni borrar nada).
  const soloLectura = agencia === CONSOLIDADO;
  const [hojas, setHojas] = useState<string[]>([]);
  const [hoja, setHoja] = useState<string | null>(null);
  const [cargandoHojas, setCargandoHojas] = useState(true);
  const [resumen, setResumen] = useState<LineaResumen[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cargando, setCargando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<{ mensaje: string; accion: () => void } | null>(null);

  // hojas
  const [creandoHoja, setCreandoHoja] = useState(false);
  const [menuH, setMenuH] = useState<"mas" | "agregar" | null>(null);
  // Pestaña Resumen: todas las hojas del grupo como árbol contable (cuenta madre → detalle), con control contra el ER
  const [enResumen, setEnResumen] = useState(true);
  const [resumenTodas, setResumenTodas] = useState<(Linea & { hoja?: string })[] | null>(null);
  const { ingresos: arbolIngresos, calculadas } = useResultados(agencia, ejercicio);
  const [expandido, setExpandido] = useState(false);
  const [nombreHoja, setNombreHoja] = useState("");
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");

  function cargarHojas(elegir?: string) {
    const uHojas = `/api/hojas-presupuesto?grupo=${grupo}&ejercicio=${ejercicio}`;
    setCargandoHojas(!tieneDatos(uHojas));
    pedirJSON(uHojas).then((d) => {
      const lista: string[] = d.hojas ?? [];
      setHojas(lista);
      setHoja(elegir && lista.includes(elegir) ? elegir : lista[0] ?? null);
    }).catch(() => undefined).finally(() => setCargandoHojas(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => cargarHojas(), [grupo, ejercicio]);

  const turnos = useTurnos();
  function cargarDatos() {
    if (!hoja) { setLineas([]); setResumen([]); return; }
    const uRes = `/api/presupuesto-resumen?departamento=${encodeURIComponent(hoja)}&ejercicio=${ejercicio}`;
    const uDep = `/api/presupuesto-departamental?departamento=${encodeURIComponent(hoja)}&grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    const t = turnos.nuevo();
    const enMemoria = tieneDatos(uRes) && tieneDatos(uDep);
    setCargando(!enMemoria);
    if (!enMemoria) setLineas([]);
    Promise.all([pedirJSON(uRes), pedirJSON(uDep)]).then(([res, dep]) => {
      if (!turnos.vigente(t)) return;
      setResumen(agruparResumen(res.filas ?? []));
      setLineas(agruparLineas(dep.filas ?? []));
    }).catch(() => undefined).finally(() => { if (turnos.vigente(t)) setCargando(false); });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargarDatos, [hoja, grupo, agencia, ejercicio]);

  async function crearHoja() {
    const nombre = nombreHoja.trim();
    if (soloLectura || !nombre) return;
    await apiFetch("/api/hojas-presupuesto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grupo, nombre, ejercicio }) });
    setNombreHoja(""); setCreandoHoja(false); cargarHojas(nombre);
  }
  async function eliminarHoja(nombre: string) {
    if (soloLectura) return;
    await apiFetch(`/api/hojas-presupuesto?grupo=${grupo}&nombre=${encodeURIComponent(nombre)}&ejercicio=${ejercicio}`, { method: "DELETE" });
    cargarHojas();
  }
  async function renombrarHoja(actual: string) {
    const nuevo = nombreNuevo.trim();
    if (soloLectura || !nuevo || nuevo === actual) { setRenombrando(null); return; }
    await apiFetch("/api/hojas-presupuesto", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grupo, nombreActual: actual, nombreNuevo: nuevo, ejercicio }) });
    setRenombrando(null); cargarHojas(nuevo);
  }

  // edición en línea
  const [editando, setEditando] = useState<string | null>(null);
  const [editMontos, setEditMontos] = useState<string[]>(Array(12).fill(""));
  const ver = useVerMes();
  useMensualAlEditar(editando !== null);
  // Un mensaje de error y un «guardando» comunes a los guardados de esta hoja
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  async function conGuardado(accion: () => Promise<string | null>): Promise<boolean> {
    if (guardando) return false;
    setGuardando(true); setErrorGuardar(null);
    try {
      const e = await accion();
      if (e) { setErrorGuardar(e); return false; }
      return true;
    } catch {
      setErrorGuardar("No hay conexión con el servidor. Lo escrito sigue en pantalla; intente de nuevo.");
      return false;
    } finally { setGuardando(false); }
  }
  async function guardarEdicion(l: Linea): Promise<boolean> {
    if (soloLectura) return false;
    const lectura = leerMeses(editMontos);
    if (lectura.error !== null) { setErrorGuardar(lectura.error); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-departamental", l.idsPorMes, (i) => lectura.valores[i])));
    if (!ok) return false;
    setEditando(null); cargarDatos();
    return true;
  }
  async function eliminarLinea(l: Linea, origen: LineaResumen | null) {
    if (soloLectura || !hoja) return;
    if (l.modo === "prorrateado") {
      await apiFetch(`/api/presupuesto-departamental?departamento=${encodeURIComponent(hoja)}&concepto=${encodeURIComponent(l.concepto)}&ejercicio=${ejercicio}`, { method: "DELETE" });
      // La línea institucional se borra solo si ninguna otra cuenta de la hoja se reparte desde ella.
      const compartida = origen && lineas.some((x) => x.concepto !== l.concepto && x.modo === "prorrateado" && x.resumen_id != null && origen.idsPorMes.includes(x.resumen_id));
      if (origen && !compartida) await apiFetch(`/api/presupuesto-resumen?departamento=${encodeURIComponent(hoja)}&nombre=${encodeURIComponent(origen.nombre)}&ejercicio=${ejercicio}`, { method: "DELETE" });
    } else {
      await eliminarFilasDepartamental(l.idsPorMes);
    }
    cargarDatos();
  }

  // panel abierto bajo una fila: detalle institucional, recálculo o cambio de modo
  const [panel, setPanel] = useState<{ tipo: "detalle" | "recalculo" | "modo"; concepto: string } | null>(null);
  const alternarPanel = (tipo: "detalle" | "recalculo" | "modo", concepto: string) =>
    setPanel(panel?.tipo === tipo && panel.concepto === concepto ? null : { tipo, concepto });

  // detalle institucional (prorrateado)
  const [instMontos, setInstMontos] = useState<string[]>(Array(12).fill(""));
  const [nota, setNota] = useState("");
  function abrirDetalle(l: Linea, origen: LineaResumen) {
    alternarPanel("detalle", l.concepto);
    setInstMontos(origen.montosPorMes.map((v) => textoEditable(v))); setNota(origen.nota ?? ""); setErrorGuardar(null);
  }
  async function guardarInstitucional(origen: LineaResumen) {
    if (soloLectura) return;
    const lectura = leerMeses(instMontos);
    if (lectura.error !== null) { setErrorGuardar(lectura.error); return; }
    const ok = await conGuardado(async () => {
      const e = await errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-resumen", origen.idsPorMes, (i) => lectura.valores[i]));
      if (e || !hoja) return e;
      return errorDeRespuesta(await apiFetch("/api/presupuesto-resumen", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "actualizar_nota", departamento: hoja, nombre: origen.nombre, nota: nota.trim() || null, ejercicio }),
      }));
    });
    if (!ok) return;
    setPanel(null); cargarDatos();
  }

  // recálculo desde histórico
  const [recalc, setRecalc] = useState<DatosHistoricosCuenta | null>(null);
  const [recalcBase, setRecalcBase] = useState<"ttm" | "avg">("ttm");
  const [recalcReparto, setRecalcReparto] = useState<"estacional" | "parejo">("estacional");
  const [recalcCrec, setRecalcCrec] = useState("0");
  const [buscandoRecalc, setBuscandoRecalc] = useState(false);
  async function abrirRecalculo(l: Linea) {
    alternarPanel("recalculo", l.concepto);
    setRecalcBase("ttm"); setRecalcReparto("estacional"); setRecalcCrec("0"); setRecalc(null); setBuscandoRecalc(true);
    try {
      const d = await pedirJSON(`/api/base-historica-gastos?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`);
      setRecalc(((d.cuentas ?? []) as DatosHistoricosCuenta[]).find((x) => x.codigo === l.concepto) ?? null);
    } finally { setBuscandoRecalc(false); }
  }
  function baseAnual(c: DatosHistoricosCuenta): number {
    if (recalcBase === "ttm") return c.base_ttm;
    const avg = aniosDeStats(c.stats_anuales)?.anios[0]?.avg;
    return avg !== undefined ? avg * 12 : c.base_ttm;
  }
  async function aplicarRecalculo(l: Linea) {
    if (soloLectura || !recalc) return;
    const montos = montosMensuales(baseAnual(recalc), recalc.pesos_mensuales, numero(recalcCrec), recalcReparto);
    await guardarMontosPorMes("/api/presupuesto-departamental", l.idsPorMes, (i) => montos[i]);
    setPanel(null); cargarDatos();
  }

  // cambio de modo
  const [modoDestino, setModoDestino] = useState<Modo>("prorrateado");
  const [origenDestino, setOrigenDestino] = useState<"nueva" | "existente">("existente");
  const [resumenDestino, setResumenDestino] = useState("");
  const [montosResumenNuevo, setMontosResumenNuevo] = useState<string[]>(Array(12).fill(""));
  function abrirModo(l: Linea) {
    alternarPanel("modo", l.concepto);
    setModoDestino(l.modo === "directo" ? "prorrateado" : "directo"); setOrigenDestino("existente"); setResumenDestino(""); setMontosResumenNuevo(Array(12).fill(""));
  }
  async function guardarModo(l: Linea) {
    if (soloLectura || !hoja) return;
    let resumenNombre = resumenDestino;
    const nueva = modoDestino === "prorrateado" && origenDestino === "nueva";
    if (modoDestino === "prorrateado") {
      if (nueva) resumenNombre = `${l.concepto} ${l.cuenta_nombre ?? ""}`.trim();
      else if (!resumenNombre) { setErrorGuardar("Elija la línea institucional."); return; }
    }
    const lectura = leerMeses(montosResumenNuevo);
    if (nueva && lectura.error !== null) { setErrorGuardar(lectura.error); return; }
    const ok = await conGuardado(async () => {
      if (nueva) {
        const e = await errorDeRespuesta(await apiFetch("/api/presupuesto-resumen", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departamento: hoja, nombre: resumenNombre, montosPorMes: lectura.valores, ejercicio }),
        }));
        if (e) return e;
      }
      return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cambiar_modo", departamento: hoja, concepto: l.concepto, cuenta_nombre: l.cuenta_nombre, nuevoModo: modoDestino, resumenNombre: modoDestino === "prorrateado" ? resumenNombre : undefined, ejercicio }),
      }));
    });
    if (!ok) return;
    setPanel(null); cargarDatos();
  }

  // nuevo registro
  const [nuevo, setNuevo] = useState(false);
  useMensualAlEditar(nuevo);
  const [nCodigo, setNCodigo] = useState("");
  const [nCuenta, setNCuenta] = useState("");
  const [nModo, setNModo] = useState<Modo>("directo");
  const [nOrigen, setNOrigen] = useState<"nueva" | "existente">("nueva");
  const [nResumen, setNResumen] = useState("");
  const [nMontos, setNMontos] = useState<string[]>(Array(12).fill(""));
  const [sugerencias, setSugerencias] = useState<{ codigo: string; nombre: string }[]>([]);
  const [verSugerencias, setVerSugerencias] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cambiarCodigo(v: string) {
    setNCodigo(v);
    if (temporizador.current) clearTimeout(temporizador.current);
    if (!v.trim()) { setSugerencias([]); setVerSugerencias(false); return; }
    temporizador.current = setTimeout(() => {
      pedirJSON(`/api/catalogo-cuentas?q=${encodeURIComponent(v.trim())}`).then((d) => {
        setSugerencias((d.cuentas ?? []).filter((c: { codigo: string }) => String(c.codigo).replace(/\D/g, "").startsWith(grupo)));
        setVerSugerencias(true);
      }).catch(() => undefined);
    }, 250);
  }
  function limpiarNuevo() {
    setNCodigo(""); setNCuenta(""); setNModo("directo"); setNOrigen("nueva"); setNResumen(""); setNMontos(Array(12).fill(""));
    setNuevo(false); setSugerencias([]); setVerSugerencias(false); setAvisoNuevo(null);
  }
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(null);
  async function guardarNuevo(): Promise<boolean> {
    const codigo = nCodigo.trim();
    if (soloLectura || !hoja) return false;
    if (!codigo) { setAvisoNuevo("Escriba el código de la cuenta."); return false; }
    if (!codigo.replace(/\D/g, "").startsWith(grupo)) { setAvisoNuevo(`El código debe ser del grupo ${grupo}.`); return false; }
    if (lineas.some((x) => x.concepto === codigo)) { setAvisoNuevo(`La cuenta ${codigo} ya está en esta hoja. Use «Editar montos» en su fila.`); return false; }
    const usaMontos = !(nModo === "prorrateado" && nOrigen === "existente");
    const lectura = leerMeses(nMontos);
    if (usaMontos && lectura.error !== null) { setAvisoNuevo(lectura.error); return false; }
    const montos = lectura.valores ?? Array(12).fill(0);
    let resumenNombre = nResumen;
    if (nModo === "prorrateado") {
      if (nOrigen === "nueva") resumenNombre = `${codigo} ${nCuenta.trim()}`.trim();
      else if (!resumenNombre) { setAvisoNuevo("Elija la línea institucional."); return false; }
    }
    setAvisoNuevo(null);
    const ok = await conGuardado(async () => {
      if (nModo === "prorrateado") {
        if (nOrigen === "nueva") {
          const e = await errorDeRespuesta(await apiFetch("/api/presupuesto-resumen", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ departamento: hoja, nombre: resumenNombre, montosPorMes: montos, ejercicio }),
          }));
          if (e) return e;
        }
        return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "cambiar_modo", departamento: hoja, concepto: codigo, cuenta_nombre: nCuenta.trim() || null, nuevoModo: "prorrateado", resumenNombre, ejercicio }),
        }));
      }
      return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departamento: hoja, concepto: codigo, cuenta_nombre: nCuenta.trim() || null, montosPorMes: montos, agencia, modo: "directo", ejercicio }),
      }));
    });
    if (!ok) return false;
    limpiarNuevo(); cargarDatos();
    return true;
  }

  // Ediciones abiertas: se avisan antes de cambiar de agencia o de pestaña
  const lineaEditada = editando ? lineas.find((x) => x.concepto === editando) ?? null : null;
  usePendiente(lineaEditada ? {
    descripcion: `Montos de ${lineaEditada.concepto} ${lineaEditada.cuenta_nombre ?? ""} en ${agencia}`.replace(/\s+/g, " "),
    guardar: () => guardarEdicion(lineaEditada),
    descartar: () => { setEditando(null); setErrorGuardar(null); },
  } : null);
  usePendiente(nuevo && (nCodigo.trim() !== "" || nMontos.some((m) => m.trim() !== "")) ? {
    descripcion: `Nuevo registro${nCodigo.trim() ? ` ${nCodigo.trim()}` : ""} en ${hoja ?? ""}`,
    guardar: guardarNuevo,
    descartar: limpiarNuevo,
  } : null);

  // cargar histórico (varias cuentas a la vez)
  const [selector, setSelector] = useState<Sugerida[] | null>(null);
  const [crecHist, setCrecHist] = useState("0");
  const [repartoHist, setRepartoHist] = useState<"estacional" | "parejo">("estacional");
  const [cargandoHist, setCargandoHist] = useState(false);
  const [avisoHist, setAvisoHist] = useState<string | null>(null);
  async function abrirHistorico() {
    if (soloLectura || !hoja) return;
    setCargandoHist(true); setAvisoHist(null);
    try {
      const r = await apiFetch(`/api/base-historica-gastos?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`);
      if (!r.ok) { setAvisoHist("No se pudo consultar el histórico de este grupo."); return; }
      const d = await r.json();
      const todas: Omit<Sugerida, "seleccionado">[] = (d.cuentas ?? []).filter((c: { detalle?: boolean }) => c.detalle !== false);
      if (!todas.length) { setAvisoHist(`No hay cuentas históricas guardadas para ${agencia} en el grupo ${grupo}.`); return; }
      const ya = new Set(lineas.map((l) => l.concepto));
      // tampoco una subcuenta o cuenta madre de una que ya está en cualquier hoja del grupo (se sumarían las dos)
      const delGrupo = await apiFetch(`/api/presupuesto-departamental?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`)
        .then((x) => (x.ok ? x.json() : { filas: [] })).catch(() => ({ filas: [] })) as { filas?: { concepto: string; monto: number }[] };
      const tot = new Map<string, number>();
      for (const f of delGrupo.filas ?? []) tot.set(String(f.concepto), (tot.get(String(f.concepto)) ?? 0) + (Number(f.monto) || 0));
      const cargadas = [...new Set([...lineas.map((l) => l.concepto), ...[...tot].filter(([, t]) => Math.abs(t) >= 0.005).map(([k]) => k)])];
      const nuevas = todas.filter((c) => !ya.has(c.codigo) && !cargadas.some((k) => k !== c.codigo && (k.startsWith(c.codigo) || c.codigo.startsWith(k))));
      if (!nuevas.length) { setAvisoHist("Todas las cuentas históricas de este grupo ya están en esta hoja."); return; }
      setCrecHist("0"); setRepartoHist("estacional");
      setSelector(nuevas.map((c) => ({ ...c, seleccionado: true })));
    } finally { setCargandoHist(false); }
  }
  async function confirmarHistorico() {
    if (soloLectura || !hoja || !selector) return;
    const elegidas = selector.filter((c) => c.seleccionado);
    if (!elegidas.length) { setSelector(null); return; }
    setCargandoHist(true);
    try {
      let fallos = 0;
      for (const c of elegidas) {
        const montos = montosMensuales(c.base_ttm, c.pesos_mensuales, numero(crecHist), repartoHist);
        const r = await apiFetch("/api/presupuesto-departamental", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departamento: hoja, concepto: c.codigo, cuenta_nombre: c.nombre_cuenta, montosPorMes: montos, agencia, modo: "directo", origen: "sugerido", ejercicio }),
        });
        if (!r.ok) fallos++;
      }
      setSelector(null); cargarDatos();
      if (fallos) setAvisoHist(`Se cargaron ${elegidas.length - fallos} de ${elegidas.length} cuentas; ${fallos} fallaron al guardar.`);
    } finally { setCargandoHist(false); }
  }

  // 56: recuperación de cartera castigada (560405) y reversión de provisiones (560410) las calcula el modelo de provisión
  // (Provisiones). Lo cargado en esas cuentas no se usa: se muestra el valor del modelo y, aparte, lo cargado.
  const flow = useDatos<DatosFlow>(grupo === "56" ? urlFlow(agencia, ejercicio) : null, 0);
  const sFlow = flow.datos?.disponible ? seriesEscenario(flow.datos, flow.datos.escenario) : null;
  const modelo5604 = sFlow ? { "560405": sFlow.rec, "560410": sFlow.rev } as Record<string, number[]> : null;
  const delModelo = (c: string) => { const k = c.replace(/\D/g, "").slice(0, 6); return modelo5604 && (k === "560405" || k === "560410") ? modelo5604[k] : null; };
  // Cuentas que calcula la herramienta desde otro módulo (530405 del Fondo de liquidez): lo cargado a mano no se usa
  const calcGrupo = calculadas.filter((c) => c.codigo.startsWith(grupo));
  const calcDe = (c: string) => reemplazoDe(calcGrupo, c);
  const valoresDe = (l: Linea) => {
    const r = calcDe(l.concepto);
    if (r) return l.concepto.replace(/\D/g, "") === r.codigo ? r.valores : Array(12).fill(0);
    return delModelo(l.concepto) ?? l.montosPorMes;
  };
  // las dos cuentas del modelo se muestran en la hoja que ya tiene 5604 (o en la primera hoja), aunque no estén cargadas
  const NOMBRE_MODELO: Record<string, string> = { "560405": "Recuperación de activos castigados", "560410": "Reversión de provisiones" };
  const llevaModelo = !!modelo5604 && (lineas.some((l) => l.concepto.startsWith("5604")) || hoja === hojas[0]);
  const virtuales: Linea[] = llevaModelo ? Object.keys(NOMBRE_MODELO).filter((k) => !lineas.some((l) => l.concepto.replace(/\D/g, "").slice(0, 6) === k))
    .map((k) => ({ concepto: k, cuenta_nombre: NOMBRE_MODELO[k], modo: "directo" as Modo, origen: "modelo", resumen_id: null, idsPorMes: Array(12).fill(null), montosPorMes: Array(12).fill(0) })) : [];
  const todas = [...lineas, ...virtuales].sort((a, b) => a.concepto.localeCompare(b.concepto));
  const visibles = todas;
  // Resumen del grupo: las cuentas de todas las hojas (con los valores del modelo en 560405 / 560410)
  useEffect(() => {
    if (!enResumen || !hojas.length) return;
    let vivo = true;
    Promise.all(hojas.map((h) => pedirJSON(`/api/presupuesto-departamental?departamento=${encodeURIComponent(h)}&grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`)
      .then((d) => agruparLineas(d.filas ?? []).map((l) => ({ ...l, hoja: h }))).catch(() => [] as (Linea & { hoja?: string })[])))
      .then((ls) => { if (vivo) setResumenTodas(ls.flat()); });
    return () => { vivo = false; };
  }, [enResumen, hojas, grupo, agencia, ejercicio, lineas]);
  const lineasResumen = resumenTodas && [
    ...resumenTodas.map((l) => ({ concepto: l.concepto, cuenta_nombre: l.cuenta_nombre, montosPorMes: valoresDe(l), hoja: l.hoja })),
    ...(modelo5604 ? Object.keys(NOMBRE_MODELO).filter((k) => !resumenTodas.some((l) => l.concepto.replace(/\D/g, "").slice(0, 6) === k))
      .map((k) => ({ concepto: k, cuenta_nombre: NOMBRE_MODELO[k], montosPorMes: modelo5604[k] })) : []),
  ];
  const [verCargado, setVerCargado] = useState(false);
  const comparables = todas.filter((l) => delModelo(l.concepto));
  const totalMes = MESES.map((_, i) => suma(visibles.map((l) => valoresDe(l)[i])));
  const nombreGrupo = GRUPOS.find((g) => g.id === grupo)?.label ?? grupo;

  return (
    <>
      {!cargandoHojas && !hoja && !creandoHoja ? (
        <div className="tarjeta px-6 py-7 flex flex-col items-center gap-2 text-center">
          <span className="text-[14px] font-semibold">{nombreGrupo} todavía no tiene hojas</span>
          <span className="text-[12px] max-w-[468px]" style={{ color: C.texto2 }}>Cada hoja agrupa cuentas del grupo (por ejemplo, por departamento). Dentro cargas las cuentas a mano o desde el histórico.</span>
          {!soloLectura && <div className="mt-2"><BotonPrimario onClick={() => setCreandoHoja(true)}><Plus size={13} /> Crear hoja</BotonPrimario></div>}
        </div>
      ) : (
        <section className="tarjeta flex flex-col">
          {menuH && <div className="fixed inset-0 z-20" onClick={() => setMenuH(null)} />}
          {/* Pestañas: una por hoja (sin código); acciones a la derecha, como en las demás secciones */}
          <div className="flex items-end gap-2 px-4 min-h-[48px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
            <div role="tablist" aria-label="Hojas" className="flex gap-6 flex-1 flex-wrap">
              {cargandoHojas ? <span className="h-6 w-40 mb-3 rounded-md animate-pulse" style={{ background: "#E6EAE8" }} aria-label="Cargando hojas" /> : [null, ...hojas].map((h) => h === null ? (
                  <span key="resumen" className="flex items-end">
                    <button type="button" role="tab" aria-selected={enResumen} onClick={() => setEnResumen(true)} className="pb-3 pt-3.5 -mb-px text-[13px]"
                            style={{ color: enResumen ? C.texto : C.texto2, fontWeight: enResumen ? 600 : 400, borderBottom: `2px solid ${enResumen ? C.acento : "transparent"}` }}>Resumen</button>
                  </span>
                ) : (
                renombrando === h && !soloLectura ? (
                  <span key={h} className="flex items-center gap-1 pb-2">
                    <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} autoFocus aria-label="Nuevo nombre de la hoja"
                           onKeyDown={(e) => { if (e.key === "Enter") renombrarHoja(h); if (e.key === "Escape") setRenombrando(null); }}
                           className={`${INPUT} w-44`} style={{ border: BORDE_INPUT }} />
                    <BotonIcono onClick={() => renombrarHoja(h)} titulo="Guardar nombre"><Check size={14} /></BotonIcono>
                    <BotonIcono onClick={() => setRenombrando(null)} titulo="Cancelar"><X size={14} /></BotonIcono>
                  </span>
                ) : (
                  <span key={h} className="flex items-end">
                    <button type="button" role="tab" aria-selected={!enResumen && hoja === h} title={h} onClick={() => { setEnResumen(false); setHoja(h); }} className="pb-3 pt-3.5 -mb-px text-[13px]"
                            style={{ color: !enResumen && hoja === h ? C.texto : C.texto2, fontWeight: !enResumen && hoja === h ? 600 : 400, borderBottom: `2px solid ${!enResumen && hoja === h ? C.acento : "transparent"}` }}>{sinCodigo(h)}</button>
                  </span>
                )
              ))}
              {creandoHoja && !soloLectura && (
                <span className="flex items-center gap-1 pb-2">
                  <input value={nombreHoja} onChange={(e) => setNombreHoja(e.target.value)} autoFocus placeholder="Nombre, ej. Operaciones" aria-label="Nombre de la hoja"
                         onKeyDown={(e) => { if (e.key === "Enter") crearHoja(); if (e.key === "Escape") setCreandoHoja(false); }}
                         className={`${INPUT} w-52`} style={{ border: BORDE_INPUT }} />
                  <BotonIcono onClick={crearHoja} titulo="Crear hoja"><Check size={14} /></BotonIcono>
                  <BotonIcono onClick={() => setCreandoHoja(false)} titulo="Cancelar"><X size={14} /></BotonIcono>
                </span>
              )}
            </div>
            {soloLectura && enResumen && hojas.length > 0 && (
              <div className="flex items-center gap-2 self-center">
                {enResumen && hojas.length > 0 && (
                  <button type="button" onClick={() => setExpandido((x) => !x)} aria-pressed={expandido}
                          className="h-8 px-3 rounded-lg bg-white hover:bg-[#F3F5F4] text-[12.5px] flex items-center gap-1.5" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}>
                    {expandido ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandido ? "Contraer" : "Expandir"}</button>
                )}
              </div>
            )}
            {!soloLectura && (
              <div className="flex items-center gap-2 self-center">
                {hoja && (
                  <div className="relative">
                    <button type="button" aria-label="Más opciones" aria-expanded={menuH === "mas"} onClick={() => setMenuH(menuH === "mas" ? null : "mas")}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-white hover:bg-[#F3F5F4]" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}><MoreHorizontal size={16} /></button>
                    {menuH === "mas" && (
                      <div className="absolute right-0 top-10 z-30 w-[270px] p-1.5 bg-white rounded-lg shadow-lg" style={{ border: "1px solid #E1E5E3" }}>
                        <button type="button" className="w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]" disabled={cargandoHist} onClick={() => { setMenuH(null); setEnResumen(false); abrirHistorico(); }}>
                          {cargandoHist && !selector ? "Buscando..." : "Cargar histórico"}<span className="block text-[11.5px]" style={{ color: C.tenue }}>En la hoja {sinCodigo(hoja)} de {agencia}</span></button>
                        {!enResumen && <div className="mt-1 pt-1" style={{ borderTop: `1px solid ${C.beige}` }}>
                          <button type="button" className="w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]" onClick={() => { setMenuH(null); setRenombrando(hoja); setNombreNuevo(hoja); }}>
                            Cambiar nombre de la hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>{sinCodigo(hoja)}</span></button>
                          <button type="button" className="w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]" style={{ color: C.alerta }}
                                  onClick={() => { setMenuH(null); setConfirmacion({ mensaje: `¿Eliminar la hoja "${hoja}" y todas sus cuentas de este grupo? Se borra en las 10 agencias, con sus valores institucionales.`, accion: () => eliminarHoja(hoja) }); }}>
                            Eliminar hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>{sinCodigo(hoja)} y todas sus cuentas</span></button>
                        </div>}
                        {agenciaActiva && (
                          <p className="px-3 pt-2 pb-1.5 mt-1 text-[11.5px]" style={{ color: C.texto2, borderTop: `1px solid ${C.beige}` }}>
                            Prorrateo {agencia}: <b style={{ color: C.texto }}>{(agenciaActiva.porcentaje * 100).toFixed(2).replace(".", ",")} %</b> del activo</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {enResumen && hojas.length > 0 && (
                  <button type="button" onClick={() => setExpandido((x) => !x)} aria-pressed={expandido}
                          className="h-8 px-3 rounded-lg bg-white hover:bg-[#F3F5F4] text-[12.5px] flex items-center gap-1.5" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}>
                    {expandido ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandido ? "Contraer" : "Expandir"}</button>
                )}
                <div className="relative">
                  <button type="button" aria-expanded={menuH === "agregar"} onClick={() => setMenuH(menuH === "agregar" ? null : "agregar")}
                          className="h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}><Plus size={14} /> Agregar</button>
                  {menuH === "agregar" && (
                    <div className="absolute right-0 top-10 z-30 w-[250px] p-1.5 bg-white rounded-lg shadow-lg" style={{ border: "1px solid #E1E5E3" }}>
                      {hoja && <button type="button" className="w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]" onClick={() => { setMenuH(null); setEnResumen(false); setNuevo(true); setAvisoNuevo(null); }}>
                        Nuevo registro<span className="block text-[11.5px]" style={{ color: C.tenue }}>Una cuenta en la hoja {sinCodigo(hoja)}</span></button>}
                      <button type="button" className="w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]" onClick={() => { setMenuH(null); setEnResumen(false); setCreandoHoja(true); }}>
                        Nueva hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>Agrupa cuentas del grupo</span></button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {avisoHist && <p className="px-4 pt-3 text-[12px] flex items-center gap-2" style={{ color: C.aviso }}><AlertTriangle size={14} /> {avisoHist}</p>}

          {nuevo && !soloLectura && (
            <div className="mx-4 mt-3 rounded-md px-4 py-3.5 flex flex-col gap-3" style={{ background: C.crema, border: `1px solid ${C.beige}` }}>
              <div className="text-[13px] font-semibold">Nuevo registro</div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 w-44 relative">
                  <span className="text-[11px]" style={{ color: C.texto2 }}>Código (grupo {grupo})</span>
                  <input value={nCodigo} onChange={(e) => cambiarCodigo(e.target.value)} placeholder="Buscar código..." autoFocus
                         onFocus={() => sugerencias.length > 0 && setVerSugerencias(true)} onBlur={() => setTimeout(() => setVerSugerencias(false), 150)}
                         className={INPUT} style={{ border: BORDE_INPUT }} />
                  {verSugerencias && sugerencias.length > 0 && (
                    <div className="absolute z-20 left-0 top-full mt-1 w-80 max-h-56 overflow-y-auto rounded-md bg-white shadow-lg" style={{ border: "1px solid #D5DBD7" }}>
                      {sugerencias.map((c) => (
                        <button key={c.codigo} type="button" onMouseDown={() => { setNCodigo(c.codigo); setNCuenta(c.nombre); setVerSugerencias(false); }}
                                className="w-full text-left px-3 py-2 text-[11px] hover:bg-[#F5F7F6]" style={{ borderBottom: `1px solid ${C.beige}` }}>
                          <span style={{ color: C.texto2 }}>{c.codigo}</span> <span style={{ color: C.texto }}>{c.nombre}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </label>
                <label className="flex flex-col gap-1 flex-1 min-w-[198px]">
                  <span className="text-[11px]" style={{ color: C.texto2 }}>Nombre de la cuenta</span>
                  <input value={nCuenta} onChange={(e) => setNCuenta(e.target.value)} placeholder="Se llena al elegir el código" className={INPUT} style={{ border: BORDE_INPUT }} />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: C.texto2 }}>Modo</span>
                  <div className="flex gap-0.5">
                    {(["directo", "prorrateado"] as Modo[]).map((m) => (
                      <button key={m} type="button" onClick={() => setNModo(m)} aria-pressed={nModo === m} className="h-8 px-3 rounded text-[12px] font-semibold capitalize"
                              style={nModo === m ? CHIP_ON : CHIP_OFF}>{m}</button>
                    ))}
                  </div>
                </div>
                {nModo === "prorrateado" && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px]" style={{ color: C.texto2 }}>Valor institucional</span>
                    <div className="flex items-center gap-1.5">
                      {(["nueva", "existente"] as const).map((o) => (
                        <button key={o} type="button" onClick={() => setNOrigen(o)} aria-pressed={nOrigen === o} className="h-8 px-3 rounded text-[12px] font-semibold"
                                style={nOrigen === o ? CHIP_ON : CHIP_OFF}>{o === "nueva" ? "Crear nuevo" : "Usar existente"}</button>
                      ))}
                      {nOrigen === "existente" && (
                        <select value={nResumen} onChange={(e) => setNResumen(e.target.value)} aria-label="Línea institucional" className={INPUT} style={{ border: BORDE_INPUT }}>
                          <option value="">Elegir línea...</option>
                          {resumen.map((r) => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {!(nModo === "prorrateado" && nOrigen === "existente") && (
                <MontosMes valores={nMontos} onChange={setNMontos} etiqueta={nModo === "prorrateado" ? "Monto institucional por mes (antes del reparto)" : "Monto por mes"} />
              )}
              {(avisoNuevo || errorGuardar) && <p role="alert" className="text-[12px]" style={{ color: C.alerta }}>{avisoNuevo ?? errorGuardar}</p>}
              <div className="flex justify-end gap-2">
                <BotonSecundario onClick={limpiarNuevo}>Cancelar</BotonSecundario>
                <BotonPrimario onClick={guardarNuevo} disabled={!nCodigo.trim() || guardando}><Check size={13} /> {guardando ? "Guardando…" : "Guardar"}</BotonPrimario>
              </div>
            </div>
          )}

          {enResumen ? (
            !lineasResumen ? <div className="p-4"><EsqueletoTabla indicadores={false} filas={6} /></div> : (
              <ResumenArbol key={String(expandido)} expandido={expandido} calculadas={calculadas} grupo={grupo} etiqueta={nombreGrupo.replace(/^\d+\s*·\s*/, "")} ejercicio={ejercicio} hojas={hojas}
                            nodoER={buscarNodo(arbolIngresos, grupo)} lineas={lineasResumen} />
            )
          ) : cargando ? <div className="p-4"><EsqueletoTabla indicadores={false} filas={6} /></div> : !todas.length ? (
            <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>{soloLectura
              ? "Ninguna agencia tiene cuentas en esta hoja todavía."
              : <>Esta hoja todavía no tiene cuentas para {agencia}. Usa “Nuevo registro” o “Cargar histórico”.</>}</p>
          ) : (
            <div className={nuevo || avisoHist ? "mt-2" : undefined}>
              {editando && errorGuardar && <div className="px-4 py-2"><MensajeError texto={errorGuardar} /></div>}
              <table className={TABLA}>
                <colgroup><col style={{ width: 320 }} />{MESES.map((m) => <col key={m} />)}<col style={{ width: 90 }} /><col style={{ width: 28 }} /></colgroup>
                <Cabecera primera="Cuenta" ultima="Año" extra anio={ejercicio} />
                <tbody>
                  {visibles.map((l) => {
                    const origen = l.resumen_id ? resumen.find((r) => r.idsPorMes.includes(l.resumen_id!)) ?? null : null;
                    const calc = calcDe(l.concepto);
                    // del modelo de provisión o calculada en otro módulo: solo lectura, con el valor que va al Estado de resultados
                    const mod = calc ? valoresDe(l) : delModelo(l.concepto);
                    const enEdicion = !soloLectura && !mod && editando === l.concepto;
                    const abierto = soloLectura || mod ? null : panel?.concepto === l.concepto ? panel.tipo : null;
                    const totalAnual = suma(mod ?? l.montosPorMes);
                    return (
                      <Fragment key={l.concepto}>
                        <tr className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                          <td className="pl-4 pr-2 relative">
                            <span className="flex items-baseline gap-2 overflow-hidden text-[11px]" title={`${l.concepto} · ${l.cuenta_nombre ?? ""}`}>
                              <span className="text-[11px] shrink-0" style={{ color: C.texto2 }}>{l.concepto}</span>
                              <span className="whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: C.texto3 }}>{l.cuenta_nombre}</span>
                              {l.modo === "prorrateado" && <span className="text-[10px] shrink-0" style={{ color: C.tenue }}>prorrateado</span>}
                              {calc && <span className="text-[10px] shrink-0 italic" style={{ color: C.tenue }}
                                              title={`La calcula la herramienta: ${calc.origen}. Lo cargado a mano en esta cuenta no se usa.`}>
                                {l.concepto.replace(/\D/g, "") === calc.codigo ? calc.origen.replace(/\s*\(.*\)$/, "") : "no se usa"}</span>}
                              {mod && !calc && <Link href="/provisiones" className="text-[10px] shrink-0 font-semibold hover:underline" style={{ color: C.acento }} title="La calcula el modelo de provisión por tramos (ver Provisiones)">modelo</Link>}
                            </span>
                            {!mod && !soloLectura && (
                              <span className={`acciones-fila ${enEdicion ? "acciones-3" : "acciones-4"} absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2 rounded bg-white group-hover:bg-[#F5F7F6] ${enEdicion ? "" : "opacity-60 group-hover:opacity-100"}`}>
                              {enEdicion ? (
                                <>
                                  <button type="button" onClick={() => setEditMontos((p) => Array(12).fill(p[0] || "0"))} className="text-[11px] font-semibold mr-1" style={{ color: C.acento }}>Rep. Ene</button>
                                  <BotonIcono onClick={() => { if (!guardando) guardarEdicion(l); }} titulo={guardando ? "Guardando…" : "Guardar"}><Check size={14} /></BotonIcono>
                                  <BotonIcono onClick={() => setEditando(null)} titulo="Cancelar"><X size={14} /></BotonIcono>
                                </>
                              ) : (
                                <>
                                  {l.modo === "prorrateado" && origen
                                    ? <BotonIcono onClick={() => abrirDetalle(l, origen)} titulo="Valor institucional y nota" activo={abierto === "detalle"}><Eye size={14} /></BotonIcono>
                                    : <BotonIcono onClick={() => { setEditando(l.concepto); setEditMontos(l.montosPorMes.map((v) => textoEditable(v))); setPanel(null); setErrorGuardar(null); }} titulo="Editar montos"><Pencil size={14} /></BotonIcono>}
                                  <BotonIcono onClick={() => abrirRecalculo(l)} titulo="Recalcular desde histórico" activo={abierto === "recalculo"}><RefreshCw size={14} /></BotonIcono>
                                  <BotonIcono onClick={() => abrirModo(l)} titulo="Cambiar modo" activo={abierto === "modo"}><ArrowLeftRight size={14} /></BotonIcono>
                                  <BotonIcono peligro titulo="Eliminar" onClick={() => setConfirmacion({
                                    mensaje: l.modo === "prorrateado"
                                      ? `¿Eliminar "${l.concepto} · ${l.cuenta_nombre ?? ""}"? Se borra el valor institucional y lo repartido en las 10 agencias.`
                                      : `¿Eliminar "${l.concepto} · ${l.cuenta_nombre ?? ""}" (los 12 meses de ${agencia})?`,
                                    accion: () => eliminarLinea(l, origen),
                                  })}><Trash2 size={14} /></BotonIcono>
                                </>
                              )}
                              </span>
                            )}
                          </td>
                          {(mod ?? l.montosPorMes).map((v, i) => enEdicion ? (
                            <td key={i} className="px-1">
                              <CampoMonto value={editMontos[i]} etiqueta={`${l.concepto} ${MESES[i]}`}
                                     onChange={(v) => setEditMontos((p) => p.map((x, j) => (j === i ? v : x)))}
                                     className={`${INPUT} w-full h-7 text-right px-1.5`} style={{ border: BORDE_INPUT }} />
                            </td>
                          ) : (
                            <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: Math.round(v) === 0 ? C.tenue : C.texto3 }}>{cifra(ver(mod ?? l.montosPorMes)[i])}</td>
                          ))}
                          <td className="px-2 text-right whitespace-nowrap font-semibold" style={{ color: Math.round(totalAnual) === 0 ? C.tenue : C.texto }}>
                            {enEdicion ? cifra(sumaTextos(editMontos)) : cifra(totalAnual)}
                          </td>
                          <td />
                        </tr>

                        {abierto === "detalle" && origen && (
                          <tr><td colSpan={15} className="px-4 py-3.5" style={{ background: C.crema, borderTop: `1px solid ${C.beige}` }}>
                            <div className="flex flex-col gap-3">
                              <MontosMes valores={instMontos} onChange={setInstMontos} etiqueta={`Valor institucional (antes del reparto) · ${origen.nombre}`} />
                              <p className="text-[11px]" style={{ color: C.texto3 }}>
                                <span className="font-semibold" style={{ color: C.acento }}>Ene · </span>
                                {usd(origen.montosPorMes[0])} institucional × {agenciaActiva ? pct(agenciaActiva.porcentaje * 100) : "—"} de {agencia} = <b>{usd(l.montosPorMes[0])}</b>
                              </p>
                              <label className="flex flex-col gap-1">
                                <span className="text-[11px]" style={{ color: C.texto2 }}>Nota de origen</span>
                                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Ej. Comisión de servicios bancarios corresponsales"
                                          className="px-2.5 py-2 text-[11px] rounded-lg bg-white resize-none outline-none" style={{ border: BORDE_INPUT }} />
                              </label>
                              <div className="flex justify-end gap-2">
                                <MensajeError texto={errorGuardar} />
                                <BotonSecundario onClick={() => setPanel(null)}>Cancelar</BotonSecundario>
                                <BotonPrimario onClick={() => guardarInstitucional(origen)} disabled={guardando}><Check size={13} /> {guardando ? "Guardando…" : "Guardar"}</BotonPrimario>
                              </div>
                            </div>
                          </td></tr>
                        )}

                        {abierto === "recalculo" && (
                          <tr><td colSpan={15} className="px-4 py-3.5" style={{ background: C.crema, borderTop: `1px solid ${C.beige}` }}>
                            {buscandoRecalc ? <p className="text-[11px]" style={{ color: C.texto2 }}>Buscando el histórico de {l.concepto}...</p>
                              : !recalc ? <p className="text-[11px]" style={{ color: C.aviso }}>No hay histórico guardado de {l.concepto} para {agencia}.</p>
                              : <PanelRecalculo datos={recalc} base={recalcBase} onBase={setRecalcBase} reparto={recalcReparto} onReparto={setRecalcReparto}
                                                crecimiento={recalcCrec} onCrecimiento={setRecalcCrec} baseAnual={baseAnual(recalc)} actual={totalAnual}
                                                onAplicar={() => aplicarRecalculo(l)} onCancelar={() => setPanel(null)} />}
                          </td></tr>
                        )}

                        {abierto === "modo" && (
                          <tr><td colSpan={15} className="px-4 py-3.5" style={{ background: C.crema, borderTop: `1px solid ${C.beige}` }}>
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span style={{ color: C.texto3 }}>Pasar {l.concepto} a</span>
                                {(["directo", "prorrateado"] as Modo[]).map((m) => (
                                  <button key={m} type="button" onClick={() => setModoDestino(m)} aria-pressed={modoDestino === m}
                                          className="h-8 px-3 rounded text-[12px] font-semibold capitalize" style={modoDestino === m ? CHIP_ON : CHIP_OFF}>{m}</button>
                                ))}
                                {modoDestino === "prorrateado" && (
                                  <>
                                    <span className="mx-1" style={{ color: C.tenue }}>·</span>
                                    {(["existente", "nueva"] as const).map((o) => (
                                      <button key={o} type="button" onClick={() => setOrigenDestino(o)} aria-pressed={origenDestino === o}
                                              className="h-8 px-3 rounded text-[12px] font-semibold" style={origenDestino === o ? CHIP_ON : CHIP_OFF}>
                                        {o === "existente" ? "Valor institucional existente" : "Crear valor institucional"}
                                      </button>
                                    ))}
                                    {origenDestino === "existente" && (
                                      <select value={resumenDestino} onChange={(e) => setResumenDestino(e.target.value)} aria-label="Línea institucional" className={INPUT} style={{ border: BORDE_INPUT }}>
                                        <option value="">Elegir línea...</option>
                                        {resumen.map((r) => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
                                      </select>
                                    )}
                                  </>
                                )}
                              </div>
                              {modoDestino === "prorrateado" && origenDestino === "nueva" && (
                                <MontosMes valores={montosResumenNuevo} onChange={setMontosResumenNuevo} etiqueta="Monto institucional por mes (antes del reparto entre agencias)" />
                              )}
                              <div className="flex justify-end gap-2">
                                <MensajeError texto={errorGuardar} />
                                <BotonSecundario onClick={() => setPanel(null)}>Cancelar</BotonSecundario>
                                <BotonPrimario onClick={() => guardarModo(l)} disabled={guardando}><Check size={13} /> {guardando ? "Aplicando…" : "Cambiar modo"}</BotonPrimario>
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid #B9C3BD", height: 32, fontWeight: 600 }}>
                    <td className="pl-4 text-[11px]">Total {hoja ? sinCodigo(hoja) : ""}</td>
                    {ver(totalMes).map((v, i) => <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: Math.round(v) === 0 ? C.tenue : C.texto }}>{cifra(v)}</td>)}
                    <td className="px-2 text-right whitespace-nowrap">{cifra(suma(totalMes))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {visibles.some((l) => delModelo(l.concepto)) && (
                <div className="px-4 py-2.5 text-[11px] flex flex-col gap-2" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2 }}>
                  <span>
                    Las cuentas marcadas <b style={{ color: C.acento }}>modelo</b> las calcula el modelo de provisión por tramos (escenario {flow.datos?.escenario}).{" "}
                    <Link href="/provisiones" className="font-semibold hover:underline" style={{ color: C.acento }}>Ver en Provisiones</Link>
                    {comparables.some((l) => Math.round(suma(l.montosPorMes)) !== 0) && <>{" · "}
                      <button type="button" className="font-semibold hover:underline" style={{ color: C.acento }} onClick={() => setVerCargado((x) => !x)}>{verCargado ? "Ocultar" : "Comparar con"} lo cargado desde el histórico</button></>}
                  </span>
                  {verCargado && (
                    <table className="max-w-[560px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <thead><tr style={{ color: C.texto2 }}><th className="text-left font-semibold py-1">Cuenta</th><th className="text-right font-semibold">Modelo {ejercicio}</th><th className="text-right font-semibold">Cargado (no se usa)</th><th className="text-right font-semibold">Diferencia</th></tr></thead>
                      <tbody>{comparables.map((l) => { const m = suma(valoresDe(l)), c = suma(l.montosPorMes); return (
                        <tr key={l.concepto} style={{ borderTop: `1px solid ${C.beige}`, color: C.texto3 }}>
                          <td className="py-1 pr-3">{l.concepto} {l.cuenta_nombre}</td><td className="text-right pl-3">{usd(m)}</td><td className="text-right pl-3">{usd(c)}</td><td className="text-right pl-3">{usd(m - c)}</td>
                        </tr>); })}</tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {selector && !soloLectura && (
        <Modal ancho={720}>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[14px] font-semibold">Cargar histórico · {hoja}</div>
              
            </div>
            <button type="button" onClick={() => setSelector((p) => p && p.map((c) => ({ ...c, seleccionado: !p.every((x) => x.seleccionado) })))}
                    className="text-[11px] font-semibold" style={{ color: C.acento }}>
              {selector.every((c) => c.seleccionado) ? "Quitar todas" : "Elegir todas"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5" style={{ background: C.crema }}>
            <label className="flex items-center gap-2 text-[11px]" style={{ color: C.texto3 }}>
              Crecimiento
              <input value={crecHist} onChange={(e) => setCrecHist(e.target.value)} inputMode="decimal" className={`${INPUT} w-16 text-right`} style={{ border: BORDE_INPUT }} /> %
            </label>
            <span className="text-[11px]" style={{ color: C.texto3 }}>Reparto</span>
            {(["estacional", "parejo"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRepartoHist(r)} aria-pressed={repartoHist === r} className="h-7 px-3 rounded text-[12px] font-semibold"
                      style={repartoHist === r ? CHIP_ON : CHIP_OFF}>{r === "estacional" ? "Patrón histórico" : "Parejo 1/12"}</button>
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto rounded-md" style={{ border: "1px solid #D5DBD7" }}>
            <table className="tabla-cifras w-full text-[11px] border-collapse">
              <thead className="sticky top-0">
                <tr className={CAB} style={{ ...CAB_ESTILO, height: 32 }}>
                  <th className="w-9" /><th className="px-2 py-2.5 text-left">Código</th><th className="px-2 py-2.5 text-left">Cuenta</th>
                  <th className="px-2 py-2.5 text-right">Ene</th><th className="px-2 py-2.5 text-right">Dic</th><th className="px-3 py-2.5 text-right">Año</th>
                </tr>
              </thead>
              <tbody>
                {selector.map((c) => {
                  const m = montosMensuales(c.base_ttm, c.pesos_mensuales, numero(crecHist), repartoHist);
                  return (
                    <tr key={c.codigo} style={{ borderTop: `1px solid ${C.beige}`, height: 31, opacity: c.seleccionado ? 1 : 0.5 }}>
                      <td className="pl-3"><input type="checkbox" checked={c.seleccionado} aria-label={`Elegir ${c.codigo}`} style={{ accentColor: C.acento }}
                                                 onChange={() => setSelector((p) => p && p.map((x) => (x.codigo === c.codigo ? { ...x, seleccionado: !x.seleccionado } : x)))} /></td>
                      <td className="px-2 text-[11px]" style={{ color: C.texto2 }}>{c.codigo}</td>
                      <td className="px-2 truncate max-w-0" title={c.nombre_cuenta} style={{ color: C.texto3 }}>{c.nombre_cuenta}</td>
                      <td className="px-2 text-right" style={{ color: C.texto2 }}>{usd(m[0])}</td>
                      <td className="px-2 text-right" style={{ color: C.texto2 }}>{usd(m[11])}</td>
                      <td className="px-3 text-right font-semibold">{usd(suma(m))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px]" style={{ color: C.texto2 }}>
            {repartoHist === "estacional" ? "Cada mes toma el peso que tuvo en el año según los dos últimos años completos de Históricos." : "El total del año se reparte en 12 partes iguales."} Después puedes ajustar mes a mes.
          </p>
          <div className="flex justify-end gap-2">
            <BotonSecundario onClick={() => setSelector(null)}>Cancelar</BotonSecundario>
            <BotonPrimario onClick={confirmarHistorico} disabled={cargandoHist || !selector.some((c) => c.seleccionado)}>
              <Check size={13} /> {cargandoHist ? "Guardando..." : `Cargar ${selector.filter((c) => c.seleccionado).length} ${selector.filter((c) => c.seleccionado).length === 1 ? "cuenta" : "cuentas"}`}
            </BotonPrimario>
          </div>
        </Modal>
      )}

      {confirmacion && !soloLectura && (
        <Modal ancho={420}>
          <p className="text-[13px]">{confirmacion.mensaje}</p>
          <p className="text-[11px]" style={{ color: C.texto2 }}>Se borra de la base de datos y no se puede deshacer.</p>
          <div className="flex justify-end gap-2">
            <BotonSecundario onClick={() => setConfirmacion(null)}>Cancelar</BotonSecundario>
            <button type="button" onClick={() => { confirmacion.accion(); setConfirmacion(null); }}
                    className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5" style={{ background: C.alerta }}>
              <Trash2 size={13} /> Sí, eliminar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------- recálculo desde histórico (con comparación antes de aplicar) ----------------
function PanelRecalculo({ datos, base, onBase, reparto, onReparto, crecimiento, onCrecimiento, baseAnual, actual, onAplicar, onCancelar }: {
  datos: DatosHistoricosCuenta; base: "ttm" | "avg"; onBase: (b: "ttm" | "avg") => void;
  reparto: "estacional" | "parejo"; onReparto: (r: "estacional" | "parejo") => void;
  crecimiento: string; onCrecimiento: (v: string) => void; baseAnual: number; actual: number;
  onAplicar: () => void; onCancelar: () => void;
}) {
  const st = aniosDeStats(datos.stats_anuales);
  const p = numero(crecimiento);
  const nuevo = suma(montosMensuales(baseAnual, datos.pesos_mensuales, p, reparto));
  const dif = nuevo - actual;
  return (
    <div className="flex flex-col gap-3 text-[11px]">
      {st && st.anios.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1" style={{ color: C.texto2 }}>
          {st.anios.map((a, k) => (
            <span key={a.anio}><b style={{ color: C.texto3 }}>{a.anio}{a.completo ? "" : " (incompleto)"}</b> · mín {usd(a.min)} · máx {usd(a.max)} · prom {usd(a.avg)}
              {k === 0 && st.variacion_pct !== undefined && st.anios[1] && <span style={{ color: st.variacion_pct >= 0 ? C.ok : C.alerta }}> ({st.variacion_pct >= 0 ? "+" : ""}{st.variacion_pct} % vs {st.anios[1].anio})</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ color: C.texto3 }}>Base</span>
        {(["avg", "ttm"] as const).map((b) => (
          <button key={b} type="button" onClick={() => onBase(b)} aria-pressed={base === b} className="h-7 px-3 rounded text-[12px] font-semibold" style={base === b ? CHIP_ON : CHIP_OFF}>
            {b === "avg" ? "Promedio" : "Últimos 12 meses"}
          </button>
        ))}
        <span className="ml-3" style={{ color: C.texto3 }}>Reparto</span>
        {(["estacional", "parejo"] as const).map((r) => (
          <button key={r} type="button" onClick={() => onReparto(r)} aria-pressed={reparto === r} className="h-7 px-3 rounded text-[12px] font-semibold" style={reparto === r ? CHIP_ON : CHIP_OFF}>
            {r === "estacional" ? "Patrón histórico" : "Parejo 1/12"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="w-20" style={{ color: C.texto3 }}>Incremento</span>
        <input type="range" min="-30" max="100" step="1" value={crecimiento} onChange={(e) => onCrecimiento(e.target.value)} className="flex-1 max-w-[378px]" style={{ accentColor: C.acento }} aria-label="Incremento" />
        <span className="w-12 text-right font-semibold">{p} %</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span style={{ color: C.texto2 }}>Base {base === "avg" ? "promedio" : "últimos 12 meses"} {usd(baseAnual)} × (1 + {p} %)</span>
        <span>Actual <b>{usd(actual)}</b> → Nuevo <b>{usd(nuevo)}</b>
          <span className="font-semibold" style={{ color: Math.round(dif) === 0 ? C.tenue : dif > 0 ? C.ok : C.alerta }}> {Math.round(dif) === 0 ? "sin cambio" : `${dif > 0 ? "+" : "−"}${usd(Math.abs(dif)).replace("−", "")}`}</span>
        </span>
        <span className="flex-1" />
        <BotonSecundario onClick={onCancelar}>Cancelar</BotonSecundario>
        <BotonPrimario onClick={onAplicar}><Check size={13} /> Aplicar</BotonPrimario>
      </div>
    </div>
  );
}

/** El detalle de la 5104 viene acumulado en el año (como el Estado de resultados); esta pantalla trabaja con el valor de cada mes. */
function delMes(b: DetalleIngresoCartera): DetalleIngresoCartera {
  const out = { ...b } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) {
    if (Array.isArray(v) && v.length === 12 && v.every((x) => typeof x === "number")) out[k] = (v as number[]).map((x, i) => (i === 0 ? x : x - (v as number[])[i - 1]));
  }
  return out as unknown as DetalleIngresoCartera;
}

export default function IngresosPage() {
  return (
    <Suspense fallback={<div className="estilo-institucional min-h-screen px-6 py-6" style={{ background: "#EEF1EF" }}><EsqueletoTabla filas={10} /></div>}>
      <IngresosContenido />
    </Suspense>
  );
}
