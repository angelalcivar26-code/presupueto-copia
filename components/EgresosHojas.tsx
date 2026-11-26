"use client";

import { apiFetch, guardarMontosPorMes, eliminarFilasDepartamental, cargarJSON, tieneDatos, errorDeRespuesta, useTurnos } from "../lib/useDatos";
import { aniosDeStats } from "../lib/base-historica";
import { leerMeses, sumaTextos, textoEditable } from "../lib/numeros";
import { usePendiente } from "../lib/cambios-pendientes";
import { CampoMonto, MensajeError } from "./GuardiaCambios";
import { cuentaCalculada } from "../lib/calc/cuentas-calculadas";
import { calcularMontosMensuales } from "../lib/montos-historico";
import { Fragment, useEffect, useRef, useState } from "react";
import { Pencil, Check, X, Trash2, RefreshCw, ArrowLeftRight, MoreHorizontal, Plus, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import {
  MESES, C, F_TABLA, F_TEXTO, suma, cifra, usd, pct, TABLA, Columnas, Cabecera, COLS_TOTALES, BotonF, Celda,
  FilaPanel, SelectorMes, Confirmacion, Cargando, BotonGuardar, BotonSecundario, INPUT, INPUT_STYLE,
  AccionesFila, reemplazoDe, type FilaExport, type Nodo, type CuentaCalculada,
} from "./EgresosComun";
import { useVerMes, useMensualAlEditar } from "./EgresosComun";
import ResumenArbol from "./ResumenArbol";

/**
 * Captura por hojas de un grupo de gastos (4502…4507, 42, 47, 48).
 * Misma lógica de antes (Directo / Prorrateado, Cargar histórico, Recalcular, Cambiar modo); solo cambia el diseño.
 * Todo se guarda en Turso: /api/hojas-presupuesto, /api/presupuesto-departamental, /api/presupuesto-resumen.
 */

export type Modo = "directo" | "prorrateado";
export interface FilaActivo { agencia_nombre: string; activo_dic2025: number | null; porcentaje: number; }

interface FilaResumenRaw { id: number; departamento: string; nombre: string; mes: number; monto: number; nota: string | null; }
interface LineaResumen { nombre: string; idsPorMes: number[]; montosPorMes: number[]; nota: string | null; }
interface FilaGastoRaw {
  id: number; departamento: string; concepto: string; cuenta_nombre: string | null;
  mes: number; monto: number; modo: Modo; resumen_id: number | null; origen: string;
}
export interface LineaGasto {
  concepto: string; cuenta_nombre: string | null; modo: Modo; origen: string;
  resumen_id: number | null; idsPorMes: (number | null)[]; montosPorMes: number[];
}

function agruparResumen(filas: FilaResumenRaw[]): LineaResumen[] {
  const porNombre = new Map<string, LineaResumen>();
  for (const f of filas) {
    if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, { nombre: f.nombre, idsPorMes: Array(12).fill(0), montosPorMes: Array(12).fill(0), nota: f.nota });
    const l = porNombre.get(f.nombre)!;
    l.idsPorMes[f.mes - 1] = f.id;
    l.montosPorMes[f.mes - 1] = f.monto;
    if (f.nota) l.nota = f.nota;
  }
  return Array.from(porNombre.values());
}
export function agruparGastos(filas: FilaGastoRaw[]): LineaGasto[] {
  const porConcepto = new Map<string, LineaGasto>();
  for (const f of filas) {
    if (!porConcepto.has(f.concepto)) {
      porConcepto.set(f.concepto, {
        concepto: f.concepto, cuenta_nombre: f.cuenta_nombre, modo: f.modo, resumen_id: f.resumen_id, origen: f.origen,
        idsPorMes: Array(12).fill(null), montosPorMes: Array(12).fill(0),
      });
    }
    const l = porConcepto.get(f.concepto)!;
    l.idsPorMes[f.mes - 1] = f.id;
    l.montosPorMes[f.mes - 1] = f.monto;
  }
  return Array.from(porConcepto.values());
}

/** Nombre de la hoja sin el código de la cuenta: «450205 - Consejos» → «Consejos». */
const nombreHoja = (h: string) => h.replace(/^\s*\d{4,}\s*[-–·.]?\s*/, "") || h;

function PuntoModo({ modo }: { modo: Modo }) {
  const pro = modo === "prorrateado";
  return <span title={pro ? "Prorrateado" : "Directo"} className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pro ? C.dorado : C.acento }} />;
}

/** Reparto de un total anual en 12 meses (mismo cálculo de antes). */

interface DatosHistoricosCuenta { codigo: string; base_ttm: number; pesos_mensuales: string | null; stats_anuales: string | null; }

// Íconos de acción de fila (mismo tamaño y color)
function Accion({ onClick, titulo, activo, peligro, children }: { onClick: () => void; titulo: string; activo?: boolean; peligro?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={titulo} title={titulo} className="p-0.5 rounded hover:bg-[#EEF1EF]"
            style={{ color: activo ? C.acento : peligro ? C.alerta : C.tenue }}>
      {children}
    </button>
  );
}

export default function HojasGrupo({
  grupo, agencia, ejercicio, activos, onCambio, onExport, etiqueta = grupo, nodoER = null, calculadas = [],
}: {
  grupo: string; agencia: string; ejercicio: number; activos: FilaActivo[];
  onCambio: () => void; onExport: (filas: FilaExport[]) => void;
  /** Nombre del grupo y su nodo en el Estado de resultados (para el Resumen en árbol y el control de cuadre). */
  etiqueta?: string; nodoER?: Nodo | null;
  /** Cuentas que calcula la herramienta desde otro módulo (seguros de Gastos anticipados, 450705…): reemplazan lo cargado. */
  calculadas?: CuentaCalculada[];
}) {
  const agenciaActiva = activos.find((a) => a.agencia_nombre === agencia);
  const activoTotalGrupo = activos.reduce((s, a) => s + (a.activo_dic2025 ?? 0), 0);

  const [hojas, setHojas] = useState<string[]>([]);
  const [hojaActiva, setHojaActiva] = useState<string | null>(null);
  const [cargandoHojas, setCargandoHojas] = useState(true);
  const [agregandoHoja, setAgregandoHoja] = useState(false);
  const [nuevaHojaNombre, setNuevaHojaNombre] = useState("");
  const [editandoNombreHoja, setEditandoNombreHoja] = useState<string | null>(null);
  const [nuevoNombreHoja, setNuevoNombreHoja] = useState("");
  const [resumenHoja, setResumenHoja] = useState<LineaResumen[]>([]);
  const [gastosHoja, setGastosHoja] = useState<LineaGasto[]>([]);
  // Cuentas que calcula la herramienta (COSEDE, SEPS, depreciaciones…) cargadas a mano antes: no se usan, se pueden quitar
  const [calculadasHoja, setCalculadasHoja] = useState<LineaGasto[]>([]);
  const [cargandoHoja, setCargandoHoja] = useState(false);
  const [confirmacion, setConfirmacion] = useState<{ mensaje: string; accion: () => void } | null>(null);
  // Pestaña Resumen (todas las hojas del grupo) y menús de acciones
  const [enResumen, setEnResumen] = useState(true);
  const [expandido, setExpandido] = useState(false);
  const [menu, setMenu] = useState<"mas" | "agregar" | null>(null);
  const [resumenTodas, setResumenTodas] = useState<{ hoja: string; lineas: LineaGasto[] }[]>([]);
  const [versionResumen, setVersionResumen] = useState(0);

  function cargarHojas(elegir?: string) {
    const url = `/api/hojas-presupuesto?grupo=${grupo}&ejercicio=${ejercicio}`;
    setCargandoHojas(!tieneDatos(url));
    cargarJSON<{ hojas?: string[] }>(url, (d) => {
      // Las hojas de cuentas que calcula la herramienta (ej. "450415 - Aporte a la SEPS", "450420 - COSEDE") ya no se
      // muestran: esos valores salen de "Contribuciones calculadas" y lo cargado en ellas no se usa.
      const lista: string[] = (d.hojas ?? []).filter((h) => { const c = h.match(/^\s*(\d{4,})/)?.[1]; return !(c && cuentaCalculada(c)); });
      setHojas(lista);
      setHojaActiva((act) => elegir ?? (act && lista.includes(act) ? act : lista[0] ?? null));
    }).finally(() => setCargandoHojas(false));
  }
  useEffect(() => { cargarHojas(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [grupo, ejercicio]);

  const turnos = useTurnos();
  function cargarDatosHoja() {
    if (!hojaActiva) { setGastosHoja([]); setResumenHoja([]); return; }
    // Con memoria: si esta hoja ya se abrió, se muestra al instante y se actualiza por detrás.
    const uRes = `/api/presupuesto-resumen?departamento=${encodeURIComponent(hojaActiva)}&ejercicio=${ejercicio}`;
    const uGas = `/api/presupuesto-departamental?departamento=${encodeURIComponent(hojaActiva)}&grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    const t = turnos.nuevo();
    const enMemoria = tieneDatos(uRes) && tieneDatos(uGas);
    setCargandoHoja(!enMemoria);
    if (!enMemoria) { setGastosHoja([]); setCalculadasHoja([]); }
    Promise.all([
      cargarJSON<{ filas?: FilaResumenRaw[] }>(uRes, (d) => { if (turnos.vigente(t)) setResumenHoja(agruparResumen(d.filas ?? [])); }),
      cargarJSON<{ filas?: FilaGastoRaw[] }>(uGas, (d) => {
        if (!turnos.vigente(t)) return;
        const todas = agruparGastos(d.filas ?? []);
        setGastosHoja(todas.filter((l) => !cuentaCalculada(l.concepto)));
        setCalculadasHoja(todas.filter((l) => cuentaCalculada(l.concepto)));
      }),
    ]).catch(() => undefined).finally(() => { if (turnos.vigente(t)) setCargandoHoja(false); });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargarDatosHoja, [hojaActiva, grupo, agencia, ejercicio]);

  useEffect(() => {
    onExport(gastosHoja.map((l) => ({ codigo: l.concepto, cuenta: l.cuenta_nombre ?? "", montos: l.montosPorMes })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastosHoja]);

  /** Después de guardar: recarga solo esta hoja y avisa a la página (tarjetas). */
  function trasGuardar() { cargarDatosHoja(); setVersionResumen((v) => v + 1); onCambio(); }

  // Resumen: las cuentas de todas las hojas del grupo, con su subtotal
  useEffect(() => {
    if (!enResumen || !hojas.length) return;
    let vivo = true;
    const url = (h: string) => `/api/presupuesto-departamental?departamento=${encodeURIComponent(h)}&grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    const res: Record<string, LineaGasto[]> = {};
    Promise.all(hojas.map((h) => cargarJSON<{ filas?: FilaGastoRaw[] }>(url(h), (d) => {
      res[h] = agruparGastos(d.filas ?? []).filter((l) => !cuentaCalculada(l.concepto));
      if (vivo) setResumenTodas(hojas.map((x) => ({ hoja: x, lineas: res[x] ?? [] })));
    }))).catch(() => undefined);
    return () => { vivo = false; };
  }, [enResumen, hojas, grupo, agencia, ejercicio, versionResumen]);
  useEffect(() => {
    if (!enResumen) return;
    onExport(resumenTodas.flatMap((h) => h.lineas.map((l) => ({ codigo: l.concepto, cuenta: l.cuenta_nombre ?? "", montos: l.montosPorMes }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enResumen, resumenTodas]);

  // ---------- hojas ----------
  async function crearHoja() {
    const nombre = nuevaHojaNombre.trim();
    if (!nombre) return;
    await apiFetch("/api/hojas-presupuesto", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grupo, nombre, ejercicio }),
    });
    setNuevaHojaNombre(""); setAgregandoHoja(false);
    cargarHojas(nombre);
  }
  async function eliminarHoja(nombre: string) {
    await apiFetch(`/api/hojas-presupuesto?grupo=${grupo}&nombre=${encodeURIComponent(nombre)}&ejercicio=${ejercicio}`, { method: "DELETE" });
    if (hojaActiva === nombre) setHojaActiva(null);
    cargarHojas();
    onCambio();
  }
  async function renombrarHoja(nombreActual: string) {
    const nombreNuevo = nuevoNombreHoja.trim();
    if (!nombreNuevo || nombreNuevo === nombreActual) { setEditandoNombreHoja(null); return; }
    await apiFetch("/api/hojas-presupuesto", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grupo, nombreActual, nombreNuevo, ejercicio }),
    });
    setEditandoNombreHoja(null);
    cargarHojas(hojaActiva === nombreActual ? nombreNuevo : undefined);
  }

  // ---------- cargar histórico ----------
  const [cargandoHistorico, setCargandoHistorico] = useState(false);
  const [selectorHistorico, setSelectorHistorico] = useState<
    { codigo: string; nombre_cuenta: string; base_ttm: number; pesos_mensuales: string | null; seleccionado: boolean }[] | null
  >(null);
  const [crecimientoHistorico, setCrecimientoHistorico] = useState("0");
  // Cargar histórico en las 10 agencias (solo cuentas directas en 0; las prorrateadas no se tocan)
  const [modalTodas, setModalTodas] = useState(false);
  async function cargarHistoricoTodas() {
    if (!hojaActiva) return;
    setCargandoHistorico(true); setAviso(null);
    try {
      const r = await apiFetch("/api/presupuesto-departamental", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "historicoTodas", departamento: hojaActiva, grupo, ejercicio, crecimiento: parseFloat(crecimientoHistorico) || 0, reparto: repartoHistorico }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(d.error ?? "No se pudo cargar el histórico en las agencias."); return; }
      setModalTodas(false);
      setAviso(`${d.llenadas} cuentas llenadas con el histórico de cada agencia${d.sinHistorico ? `; ${d.sinHistorico} quedan en 0 porque esa agencia no tiene histórico de la cuenta` : ""}.`);
      trasGuardar();
    } finally {
      setCargandoHistorico(false);
    }
  }
  const [repartoHistorico, setRepartoHistorico] = useState<"estacional" | "parejo">("estacional");
  const [aviso, setAviso] = useState<string | null>(null);

  async function abrirSelectorHistorico() {
    if (!hojaActiva) return;
    setCargandoHistorico(true); setAviso(null);
    try {
      const res = await apiFetch(`/api/base-historica-gastos?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`);
      if (!res.ok) { setAviso("No se pudo consultar la base histórica (Históricos)."); return; }
      const data = await res.json();
      const sugeridas: { codigo: string; nombre_cuenta: string; base_ttm: number; pesos_mensuales: string | null; detalle?: boolean }[] = (data.cuentas ?? []).filter((c: { detalle?: boolean }) => c.detalle !== false);
      if (!sugeridas.length) { setAviso(`No hay cuentas históricas de ${agencia} en el grupo ${grupo}.`); return; }
      // las cuentas en 0 (creadas para igualar la estructura entre agencias) sí se pueden llenar con el histórico
      const yaExisten = new Set(gastosHoja.filter((l) => l.montosPorMes.some((v) => Math.abs(v) >= 0.005)).map((l) => l.concepto));
      // las cuentas que calcula la herramienta (COSEDE, SEPS, depreciaciones…) no se traen del histórico
      // tampoco una subcuenta o cuenta madre de una que ya está en la hoja (se sumarían las dos)
      // en cualquier hoja del grupo (no solo la abierta): una madre en una hoja y su subcuenta en otra también se suman
      const delGrupo = await apiFetch(`/api/presupuesto-departamental?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`)
        .then((r) => (r.ok ? r.json() : { filas: [] })).catch(() => ({ filas: [] })) as { filas?: { concepto: string; monto: number }[] };
      const totalPorCuenta = new Map<string, number>();
      for (const f of delGrupo.filas ?? []) totalPorCuenta.set(String(f.concepto), (totalPorCuenta.get(String(f.concepto)) ?? 0) + (Number(f.monto) || 0));
      const cargadas = [...new Set([...gastosHoja.map((l) => l.concepto), ...[...totalPorCuenta].filter(([, t]) => Math.abs(t) >= 0.005).map(([k]) => k)])];
      const cruza = (c: string) => cargadas.some((k) => k !== c && (k.startsWith(c) || c.startsWith(k)));
      const nuevas = sugeridas.filter((c) => !yaExisten.has(c.codigo) && !cuentaCalculada(c.codigo) && !cruza(c.codigo));
      if (!nuevas.length) { setAviso("Todas las cuentas históricas de este grupo ya están en esta hoja."); return; }
      setCrecimientoHistorico("0"); setRepartoHistorico("estacional");
      setSelectorHistorico(nuevas.map((c) => ({ ...c, seleccionado: true })));
    } finally {
      setCargandoHistorico(false);
    }
  }
  async function confirmarCargaHistorico() {
    if (!hojaActiva || !selectorHistorico) return;
    const elegidas = selectorHistorico.filter((c) => c.seleccionado);
    if (!elegidas.length) { setSelectorHistorico(null); return; }
    const p = parseFloat(crecimientoHistorico) || 0;
    setCargandoHistorico(true);
    try {
      let fallos = 0;
      for (const c of elegidas) {
        const r = await apiFetch("/api/presupuesto-departamental", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            departamento: hojaActiva, concepto: c.codigo, cuenta_nombre: c.nombre_cuenta,
            montosPorMes: calcularMontosMensuales(c.base_ttm, c.pesos_mensuales, p, repartoHistorico),
            agencia, modo: "directo", origen: "sugerido", ejercicio,
          }),
        });
        if (!r.ok) fallos++;
      }
      setSelectorHistorico(null);
      trasGuardar();
      if (fallos) setAviso(`Se cargaron ${elegidas.length - fallos} de ${elegidas.length} cuentas; ${fallos} fallaron al guardar.`);
    } finally {
      setCargandoHistorico(false);
    }
  }

  // ---------- recalcular una fila contra el histórico ----------
  const [recalculando, setRecalculando] = useState<string | null>(null);
  const [recalcDatos, setRecalcDatos] = useState<DatosHistoricosCuenta | null | undefined>(undefined);
  const [recalcBase, setRecalcBase] = useState<"ttm" | "avg">("ttm");
  const [recalcReparto, setRecalcReparto] = useState<"estacional" | "parejo">("estacional");
  const [recalcCrecimiento, setRecalcCrecimiento] = useState("0");

  async function abrirRecalcular(concepto: string) {
    cerrarPaneles();
    if (recalculando === concepto) return;
    setRecalculando(concepto);
    setRecalcBase("ttm"); setRecalcReparto("estacional"); setRecalcCrecimiento("0"); setRecalcDatos(undefined);
    const data = await apiFetch(`/api/base-historica-gastos?grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`).then((r) => r.json());
    const cuentas: DatosHistoricosCuenta[] = data.cuentas ?? [];
    setRecalcDatos(cuentas.find((x) => x.codigo === concepto) ?? null);
  }
  function baseAnual(c: DatosHistoricosCuenta): number {
    if (recalcBase === "ttm") return c.base_ttm;
    const avg = aniosDeStats(c.stats_anuales)?.anios[0]?.avg;
    return avg !== undefined ? avg * 12 : c.base_ttm;
  }
  async function confirmarRecalculo(l: LineaGasto) {
    if (!recalcDatos) return;
    const montos = calcularMontosMensuales(baseAnual(recalcDatos), recalcDatos.pesos_mensuales, parseFloat(recalcCrecimiento) || 0, recalcReparto);
    await guardarMontosPorMes("/api/presupuesto-departamental", l.idsPorMes, (i) => montos[i]);
    setRecalculando(null);
    trasGuardar();
  }

  // ---------- ƒ (fórmula; en prorrateado: valor institucional y nota) ----------
  const [formulaAbierta, setFormulaAbierta] = useState<string | null>(null);
  const [mesFormula, setMesFormula] = useState(0);
  const [notaTexto, setNotaTexto] = useState("");
  const [editInstMontos, setEditInstMontos] = useState<string[]>(Array(12).fill(""));
  const [instOriginal, setInstOriginal] = useState<string[]>(Array(12).fill(""));
  // Un solo mensaje de error y un solo «guardando» para los guardados de esta hoja
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Ejecuta un guardado: bloquea los botones, muestra el motivo si falla y devuelve si salió bien. */
  async function conGuardado(accion: () => Promise<string | null>): Promise<boolean> {
    if (guardando) return false;
    setGuardando(true); setErrorGuardar(null);
    try {
      const error = await accion();
      if (error) { setErrorGuardar(error); return false; }
      return true;
    } catch {
      setErrorGuardar("No hay conexión con el servidor. Lo escrito sigue en pantalla; intente de nuevo.");
      return false;
    } finally { setGuardando(false); }
  }

  function abrirFormula(l: LineaGasto, resumenOrigen: LineaResumen | null) {
    const abrir = formulaAbierta === l.concepto ? null : l.concepto;
    cerrarPaneles();
    setFormulaAbierta(abrir);
    if (abrir && resumenOrigen) {
      setEditInstMontos(resumenOrigen.montosPorMes.map((v) => textoEditable(v)));
      setInstOriginal(resumenOrigen.montosPorMes.map((v) => textoEditable(v)));
      setNotaTexto(resumenOrigen.nota ?? "");
    }
  }
  async function guardarValorInstitucional(r: LineaResumen): Promise<boolean> {
    const l = leerMeses(editInstMontos);
    if (l.error !== null) { setErrorGuardar(l.error); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-resumen", r.idsPorMes, (i) => l.valores[i])));
    if (ok) { setInstOriginal([...editInstMontos]); trasGuardar(); }
    return ok;
  }
  async function guardarNota(nombre: string) {
    if (!hojaActiva) return;
    await apiFetch("/api/presupuesto-resumen", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "actualizar_nota", departamento: hojaActiva, nombre, nota: notaTexto.trim() || null, ejercicio }),
    });
    cargarDatosHoja();
  }

  // ---------- cambiar modo ----------
  const [cambiandoModo, setCambiandoModo] = useState<string | null>(null);
  const [modoDestino, setModoDestino] = useState<Modo>("prorrateado");
  const [origenResumenDestino, setOrigenResumenDestino] = useState<"nueva" | "existente">("existente");
  const [resumenDestino, setResumenDestino] = useState("");
  const [montosResumenNuevo, setMontosResumenNuevo] = useState<string[]>(Array(12).fill(""));

  function abrirCambioModo(l: LineaGasto) {
    const abrir = cambiandoModo === l.concepto ? null : l.concepto;
    cerrarPaneles();
    setCambiandoModo(abrir);
    setModoDestino(l.modo === "directo" ? "prorrateado" : "directo");
    setOrigenResumenDestino("existente"); setResumenDestino(""); setMontosResumenNuevo(Array(12).fill(""));
  }
  async function guardarCambioModo(l: LineaGasto) {
    if (!hojaActiva) return;
    let resumenNombre = resumenDestino;
    if (modoDestino === "prorrateado") {
      if (origenResumenDestino === "nueva") {
        resumenNombre = `${l.concepto} ${l.cuenta_nombre ?? ""}`.trim();
      } else if (!resumenNombre) { setErrorGuardar("Elija la línea institucional."); return; }
    }
    const lectura = leerMeses(montosResumenNuevo);
    if (modoDestino === "prorrateado" && origenResumenDestino === "nueva" && lectura.error !== null) { setErrorGuardar(lectura.error); return; }
    const ok = await conGuardado(async () => {
      if (modoDestino === "prorrateado" && origenResumenDestino === "nueva") {
        const e = await errorDeRespuesta(await apiFetch("/api/presupuesto-resumen", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departamento: hojaActiva, nombre: resumenNombre, montosPorMes: lectura.valores, ejercicio }),
        }));
        if (e) return e;
      }
      return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "cambiar_modo", departamento: hojaActiva, concepto: l.concepto, cuenta_nombre: l.cuenta_nombre,
          nuevoModo: modoDestino, resumenNombre: modoDestino === "prorrateado" ? resumenNombre : undefined, ejercicio,
        }),
      }));
    });
    if (!ok) return;
    setCambiandoModo(null);
    trasGuardar();
  }

  // ---------- editar montos (directo) ----------
  const [editando, setEditando] = useState<string | null>(null);
  const [editMontos, setEditMontos] = useState<string[]>(Array(12).fill(""));
  function empezarEdicion(l: LineaGasto) {
    cerrarPaneles();
    setEditando(l.concepto);
    setEditMontos(l.montosPorMes.map((v) => textoEditable(v)));
  }
  async function guardarEdicion(l: LineaGasto): Promise<boolean> {
    const lectura = leerMeses(editMontos);
    if (lectura.error !== null) { setErrorGuardar(lectura.error); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-departamental", l.idsPorMes, (i) => lectura.valores[i])));
    if (!ok) return false;
    setEditando(null);
    trasGuardar();
    return true;
  }

  async function eliminarGasto(l: LineaGasto, resumenOrigen: LineaResumen | null) {
    if (!hojaActiva) return;
    if (l.modo === "prorrateado") {
      await apiFetch(`/api/presupuesto-departamental?departamento=${encodeURIComponent(hojaActiva)}&concepto=${encodeURIComponent(l.concepto)}&ejercicio=${ejercicio}`, { method: "DELETE" });
      // La línea institucional se borra solo si ninguna otra cuenta de la hoja se reparte desde ella.
      const compartida = resumenOrigen && gastosHoja.some((g) => g.concepto !== l.concepto && g.modo === "prorrateado" && g.resumen_id != null && resumenOrigen.idsPorMes.includes(g.resumen_id));
      if (resumenOrigen && !compartida) {
        await apiFetch(`/api/presupuesto-resumen?departamento=${encodeURIComponent(hojaActiva)}&nombre=${encodeURIComponent(resumenOrigen.nombre)}&ejercicio=${ejercicio}`, { method: "DELETE" });
      }
    } else {
      await eliminarFilasDepartamental(l.idsPorMes);
    }
    trasGuardar();
  }

  function cerrarPaneles() {
    setFormulaAbierta(null); setRecalculando(null); setCambiandoModo(null); setEditando(null); setErrorGuardar(null);
  }

  // ---------- nuevo registro ----------
  const [agregando, setAgregando] = useState(false);
  const ver = useVerMes();
  useMensualAlEditar(editando !== null || agregando);
  const [nCodigo, setNCodigo] = useState("");
  const [nCuenta, setNCuenta] = useState("");
  const [nModo, setNModo] = useState<Modo>("directo");
  const [nOrigenResumen, setNOrigenResumen] = useState<"nueva" | "existente">("nueva");
  const [nResumenNombre, setNResumenNombre] = useState("");
  const [nMontos, setNMontos] = useState<string[]>(Array(12).fill(""));
  const [sugerencias, setSugerencias] = useState<{ codigo: string; nombre: string }[]>([]);
  const [verSugerencias, setVerSugerencias] = useState(false);
  const buscarTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onCodigo(valor: string) {
    setNCodigo(valor);
    if (buscarTimeout.current) clearTimeout(buscarTimeout.current);
    if (!valor.trim()) { setSugerencias([]); setVerSugerencias(false); return; }
    buscarTimeout.current = setTimeout(() => {
      apiFetch(`/api/catalogo-cuentas?q=${encodeURIComponent(valor.trim())}`).then((r) => r.json()).then((d) => {
        setSugerencias(d.cuentas ?? []); setVerSugerencias(true);
      });
    }, 250);
  }
  function limpiarNuevo() {
    setNCodigo(""); setNCuenta(""); setNModo("directo"); setNResumenNombre(""); setNOrigenResumen("nueva");
    setNMontos(Array(12).fill("")); setAgregando(false); setSugerencias([]); setVerSugerencias(false); setErrorGuardar(null);
  }

  // ---------- ediciones abiertas: se avisan antes de cambiar de agencia o de pestaña ----------
  const lineaEditada = editando ? gastosHoja.find((g) => g.concepto === editando) ?? null : null;
  usePendiente(lineaEditada ? {
    descripcion: `Montos de ${lineaEditada.concepto} ${lineaEditada.cuenta_nombre ?? ""} en ${agencia}`.replace(/\s+/g, " "),
    guardar: () => guardarEdicion(lineaEditada),
    descartar: () => { setEditando(null); setErrorGuardar(null); },
  } : null);
  const nuevoConDatos = agregando && (nCodigo.trim() !== "" || nMontos.some((m) => m.trim() !== ""));
  usePendiente(nuevoConDatos ? {
    descripcion: `Nuevo registro${nCodigo.trim() ? ` ${nCodigo.trim()}` : ""} en ${hojaActiva ?? ""}`,
    guardar: guardarNuevo,
    descartar: limpiarNuevo,
  } : null);
  const lineaFormula = formulaAbierta ? gastosHoja.find((g) => g.concepto === formulaAbierta) ?? null : null;
  const resumenFormula = lineaFormula?.resumen_id ? resumenHoja.find((r) => r.idsPorMes.includes(lineaFormula.resumen_id!)) ?? null : null;
  const instCambiado = !!resumenFormula && editInstMontos.some((v, i) => v !== instOriginal[i]);
  usePendiente(instCambiado && resumenFormula ? {
    descripcion: `Valor institucional de ${resumenFormula.nombre}`,
    guardar: () => guardarValorInstitucional(resumenFormula),
    descartar: () => { setFormulaAbierta(null); setErrorGuardar(null); },
  } : null);
  async function guardarNuevo(): Promise<boolean> {
    if (!hojaActiva) return false;
    if (!nCodigo.trim()) { setErrorGuardar("Escriba el código de la cuenta."); return false; }
    if ([...gastosHoja, ...calculadasHoja].some((g) => g.concepto === nCodigo.trim())) {
      setErrorGuardar(`La cuenta ${nCodigo.trim()} ya está en esta hoja. Use «Editar montos» en su fila.`); return false;
    }
    const lectura = leerMeses(nMontos);
    const usaMontos = !(nModo === "prorrateado" && nOrigenResumen === "existente");
    if (usaMontos && lectura.error !== null) { setErrorGuardar(lectura.error); return false; }
    const montos = lectura.valores ?? Array(12).fill(0);
    let resumenNombre = nResumenNombre;
    if (nModo === "prorrateado") {
      if (nOrigenResumen === "nueva") resumenNombre = `${nCodigo.trim()} ${nCuenta.trim()}`.trim();
      else if (!resumenNombre) { setErrorGuardar("Elija la línea institucional."); return false; }
    }
    const ok = await conGuardado(async () => {
      if (nModo === "prorrateado") {
        if (nOrigenResumen === "nueva") {
          const e = await errorDeRespuesta(await apiFetch("/api/presupuesto-resumen", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ departamento: hojaActiva, nombre: resumenNombre, montosPorMes: montos, ejercicio }),
          }));
          if (e) return e;
        }
        return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion: "cambiar_modo", departamento: hojaActiva, concepto: nCodigo.trim(),
            cuenta_nombre: nCuenta.trim() || null, nuevoModo: "prorrateado", resumenNombre, ejercicio,
          }),
        }));
      }
      return errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departamento: hojaActiva, concepto: nCodigo.trim(), cuenta_nombre: nCuenta.trim() || null,
          montosPorMes: montos, agencia, modo: "directo", ejercicio,
        }),
      }));
    });
    if (!ok) return false;
    limpiarNuevo();
    trasGuardar();
    return true;
  }

  const cols = COLS_TOTALES(false);
  const campoTexto = "text-[11px] rounded-lg px-2.5 py-1.5 bg-white";
  const campoBorde = { border: `1px solid ${C.borde}` };

  // ====================================================================
  const itemMenu = "w-full text-left px-3 py-2 rounded-md text-[12.5px] hover:bg-[#F3F5F4]";
  const cargandoResumen = enResumen && hojas.length > 0 && resumenTodas.length === 0;
  // Cuentas que calcula la herramienta: en la hoja se ve el valor calculado (el que va al Estado de resultados), no lo cargado
  const digitos = (c: string) => c.replace(/\D/g, "");
  const calcGrupo = calculadas.filter((c) => c.codigo.startsWith(grupo));
  type Vista = LineaGasto & { calc?: CuentaCalculada; virtual?: boolean };
  const enOtraHoja = (c: string) => resumenTodas.some((h) => h.hoja !== hojaActiva && h.lineas.some((l) => digitos(l.concepto) === c));
  const vistaHoja: Vista[] = [
    ...gastosHoja.map((l) => {
      const r = reemplazoDe(calcGrupo, l.concepto);
      return r ? { ...l, calc: r, montosPorMes: digitos(l.concepto) === r.codigo ? r.valores : Array(12).fill(0) } : l;
    }),
    // cuentas calculadas sin fila en ninguna hoja: se muestran en la hoja que tiene su grupo (ej. una póliza nueva en Seguros)
    ...calcGrupo.filter((c) => !gastosHoja.some((l) => digitos(l.concepto) === c.codigo) && !enOtraHoja(c.codigo)
      && gastosHoja.some((l) => digitos(l.concepto).slice(0, 6) === c.codigo.slice(0, 6)))
      .map((c) => ({ concepto: c.codigo, cuenta_nombre: c.nombre, modo: "directo" as const, origen: "calculada", resumen_id: null,
        idsPorMes: Array(12).fill(null), montosPorMes: c.valores, calc: c, virtual: true })),
  ].sort((a, b) => a.concepto.localeCompare(b.concepto));
  return (
    <div className="bg-white rounded-xl flex flex-col" style={{ border: `1px solid ${C.borde}`, ...F_TEXTO }}>
      {menu && <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />}
      {/* Pestañas: Resumen + una por hoja (sin código); acciones a la derecha */}
      <div className="flex items-end gap-2 px-4 min-h-[48px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div role="tablist" aria-label="Hojas" className="flex gap-6 flex-1 flex-wrap">
          {[null, ...hojas].map((h) => {
            const on = h === null ? enResumen : !enResumen && hojaActiva === h;
            if (h !== null && editandoNombreHoja === h) {
              return (
                <span key={h} className="flex items-center gap-1 pb-2">
                  <input value={nuevoNombreHoja} onChange={(e) => setNuevoNombreHoja(e.target.value)} autoFocus
                         onKeyDown={(e) => { if (e.key === "Enter") renombrarHoja(h); if (e.key === "Escape") setEditandoNombreHoja(null); }}
                         className="text-[11px] rounded-md px-2 py-0.5 w-44 bg-white" style={INPUT_STYLE} />
                  <Accion onClick={() => renombrarHoja(h)} titulo="Guardar nombre" activo><Check size={14} /></Accion>
                  <Accion onClick={() => setEditandoNombreHoja(null)} titulo="Cancelar"><X size={14} /></Accion>
                </span>
              );
            }
            return (
              <span key={h ?? "resumen"} className="flex items-end">
                <button type="button" role="tab" aria-selected={on} title={h ?? undefined}
                        onClick={() => { cerrarPaneles(); if (h === null) setEnResumen(true); else { setEnResumen(false); setHojaActiva(h); } }}
                        className="pb-3 pt-3.5 -mb-px text-[13px]"
                        style={{ color: on ? C.texto : C.texto2, fontWeight: on ? 600 : 400, borderBottom: `2px solid ${on ? C.acento : "transparent"}` }}>
                  {h === null ? "Resumen" : nombreHoja(h)}
                </button>
              </span>
            );
          })}
          {agregandoHoja && (
            <span className="flex items-center gap-1 pb-2">
              <input placeholder="Nombre de la hoja, ej. 450205 - Consejos" value={nuevaHojaNombre} onChange={(e) => setNuevaHojaNombre(e.target.value)} autoFocus
                     onKeyDown={(e) => { if (e.key === "Enter") crearHoja(); if (e.key === "Escape") setAgregandoHoja(false); }}
                     className="text-[11px] rounded-md px-2 py-0.5 w-60 bg-white" style={INPUT_STYLE} />
              <Accion onClick={crearHoja} titulo="Guardar" activo><Check size={14} /></Accion>
              <Accion onClick={() => setAgregandoHoja(false)} titulo="Cancelar"><X size={14} /></Accion>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 self-center">
          {hojas.length > 0 && (
            <div className="relative">
              <button type="button" aria-label="Más opciones" aria-expanded={menu === "mas"} onClick={() => setMenu(menu === "mas" ? null : "mas")}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white hover:bg-[#F3F5F4]" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}><MoreHorizontal size={16} /></button>
              {menu === "mas" && (
                <div className="absolute right-0 top-10 z-30 w-[290px] p-1.5 bg-white rounded-lg shadow-lg" style={{ border: "1px solid #E1E5E3" }}>
                  <button type="button" className={itemMenu} disabled={cargandoHistorico} onClick={() => { setMenu(null); if (enResumen) setEnResumen(false); abrirSelectorHistorico(); }}>
                    Cargar histórico<span className="block text-[11.5px]" style={{ color: C.tenue }}>En la hoja {hojaActiva ? nombreHoja(hojaActiva) : ""} de {agencia}</span></button>
                  {agencia !== "Consolidado" && (
                    <button type="button" className={itemMenu} disabled={cargandoHistorico} onClick={() => { setMenu(null); if (enResumen) setEnResumen(false); cerrarPaneles(); setModalTodas(true); }}>
                      Histórico en las 10 agencias<span className="block text-[11.5px]" style={{ color: C.tenue }}>Llena las cuentas directas en 0 de cada agencia</span></button>
                  )}
                  {!enResumen && hojaActiva && (
                    <div className="mt-1 pt-1" style={{ borderTop: `1px solid ${C.beige}` }}>
                      <button type="button" className={itemMenu} onClick={() => { setMenu(null); setEditandoNombreHoja(hojaActiva); setNuevoNombreHoja(hojaActiva); }}>
                        Cambiar nombre de la hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>{nombreHoja(hojaActiva)}</span></button>
                      <button type="button" className={itemMenu} style={{ color: C.alerta }} onClick={() => { setMenu(null); setConfirmacion({ mensaje: `¿Eliminar la hoja "${hojaActiva}" y todas sus cuentas del grupo ${grupo}? Se borra en las 10 agencias, con sus valores institucionales.`, accion: () => eliminarHoja(hojaActiva) }); }}>
                        Eliminar hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>{nombreHoja(hojaActiva)} y todas sus cuentas</span></button>
                    </div>
                  )}
                  {agenciaActiva && (
                    <p className="px-3 pt-2 pb-1.5 mt-1 text-[11.5px]" style={{ color: C.texto2, borderTop: `1px solid ${C.beige}` }}>
                      Prorrateo {agencia}: <b style={{ color: C.texto }}>{pct(agenciaActiva.porcentaje)}</b> del activo ({usd(agenciaActiva.activo_dic2025 ?? 0)} de {usd(activoTotalGrupo)})</p>
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
            <button type="button" aria-expanded={menu === "agregar"} onClick={() => setMenu(menu === "agregar" ? null : "agregar")}
                    className="h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}><Plus size={14} /> Agregar</button>
            {menu === "agregar" && (
              <div className="absolute right-0 top-10 z-30 w-[250px] p-1.5 bg-white rounded-lg shadow-lg" style={{ border: "1px solid #E1E5E3" }}>
                {hojas.length > 0 && (
                  <button type="button" className={itemMenu} onClick={() => { setMenu(null); if (enResumen) setEnResumen(false); cerrarPaneles(); setAgregando(true); }}>
                    Nuevo registro<span className="block text-[11.5px]" style={{ color: C.tenue }}>Una cuenta en la hoja {hojaActiva ? nombreHoja(hojaActiva) : ""}</span></button>
                )}
                <button type="button" className={itemMenu} onClick={() => { setMenu(null); setAgregandoHoja(true); }}>
                  Nueva hoja<span className="block text-[11.5px]" style={{ color: C.tenue }}>Una subcuenta del grupo (ej. 450205 - Consejos)</span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      {aviso && (
        <p className="mx-4 mt-3 text-[11px] px-3 py-2 rounded-lg flex items-center justify-between" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
          {aviso}
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso"><X size={13} /></button>
        </p>
      )}

      {/* Resumen del grupo: todas las hojas con su subtotal */}
      {enResumen && !cargandoHojas && (
        cargandoResumen ? <div className="p-4"><Cargando /></div> : !hojas.length ? (
          <p className="text-[12px] px-4 py-6" style={{ color: C.texto2 }}>Todavía no hay hojas en este grupo. Crea la primera con «Agregar → Nueva hoja».</p>
        ) : (
          <ResumenArbol key={String(expandido)} expandido={expandido} grupo={grupo} etiqueta={etiqueta} ejercicio={ejercicio}
                        nodoER={nodoER} hojas={hojas} calculadas={calculadas} lineas={resumenTodas.flatMap((h) => h.lineas.map((l) => ({ ...l, hoja: h.hoja })))} />
        )
      )}

      {/* Nuevo registro */}
      {agregando && hojaActiva && !enResumen && (
        <div className="bg-white rounded-xl p-4 mx-4 mt-3" style={{ border: `1px solid ${BORDE_NUEVO}` }}>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-40 relative">
              <label className="text-[10px] block mb-1" style={{ color: C.texto2 }}>Código</label>
              <input placeholder="Buscar código..." value={nCodigo} autoFocus
                     onChange={(e) => onCodigo(e.target.value)}
                     onFocus={() => sugerencias.length > 0 && setVerSugerencias(true)}
                     onBlur={() => setTimeout(() => setVerSugerencias(false), 150)}
                     className={`w-full ${campoTexto}`} style={{ ...campoBorde, ...F_TABLA }} />
              {verSugerencias && sugerencias.length > 0 && (
                <div className="absolute z-20 left-0 top-full mt-1 bg-white rounded-lg shadow-lg max-h-56 overflow-y-auto w-80" style={campoBorde}>
                  {sugerencias.map((c) => (
                    <button key={c.codigo} onMouseDown={() => { setNCodigo(c.codigo); setNCuenta(c.nombre); setSugerencias([]); setVerSugerencias(false); }}
                            className="w-full text-left px-3 py-2 text-[11px] hover:bg-[#F5F7F6]" style={{ borderBottom: `1px solid ${C.beige}` }}>
                      <span style={{ color: C.tenue, ...F_TABLA }}>{c.codigo}</span> <span style={{ color: C.texto }}>{c.nombre}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-[198px]">
              <label className="text-[10px] block mb-1" style={{ color: C.texto2 }}>Nombre de cuenta</label>
              <input placeholder="Se llena al elegir una sugerencia" value={nCuenta} onChange={(e) => setNCuenta(e.target.value)} className={`w-full ${campoTexto}`} style={campoBorde} />
            </div>
            <div className="w-36">
              <label className="text-[10px] block mb-1" style={{ color: C.texto2 }}>Modo</label>
              <select value={nModo} onChange={(e) => setNModo(e.target.value as Modo)} className={`w-full ${campoTexto}`} style={campoBorde}>
                <option value="directo">Directo</option>
                <option value="prorrateado">Prorrateado</option>
              </select>
            </div>
            {nModo === "prorrateado" && (
              <div className="flex gap-2">
                <div className="w-44">
                  <label className="text-[10px] block mb-1" style={{ color: C.texto2 }}>Valor institucional</label>
                  <select value={nOrigenResumen} onChange={(e) => setNOrigenResumen(e.target.value as "nueva" | "existente")} className={`w-full ${campoTexto}`} style={campoBorde}>
                    <option value="nueva">Crear nuevo</option>
                    <option value="existente">Usar existente</option>
                  </select>
                </div>
                {nOrigenResumen === "existente" && (
                  <div className="w-56">
                    <label className="text-[10px] block mb-1" style={{ color: C.texto2 }}>Línea</label>
                    <select value={nResumenNombre} onChange={(e) => setNResumenNombre(e.target.value)} className={`w-full ${campoTexto}`} style={campoBorde}>
                      <option value="">Elegir línea...</option>
                      {resumenHoja.map((r) => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
          {!(nModo === "prorrateado" && nOrigenResumen === "existente") && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px]" style={{ color: C.texto2 }}>{nModo === "prorrateado" ? "Monto institucional por mes (antes del reparto)" : "Monto por mes"}</span>
                <button onClick={() => setNMontos((p) => Array(12).fill(p[0] || "0"))} className="text-[10px] hover:underline" style={{ color: C.acento }}>Repetir enero en los 12 meses</button>
              </div>
              <div className="grid grid-cols-12 gap-1.5">
                {MESES.map((m, i) => (
                  <div key={m}>
                    <span className="text-[10px] block text-center mb-0.5" style={{ color: C.tenue }}>{m}</span>
                    <CampoMonto value={nMontos[i]} placeholder="0" etiqueta={`Monto de ${m}`}
                           onChange={(v) => setNMontos((p) => p.map((x, j) => (j === i ? v : x)))}
                           className={INPUT} style={{ ...INPUT_STYLE, ...F_TABLA }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end items-center gap-2 mt-4">
            <MensajeError texto={errorGuardar} />
            <BotonSecundario onClick={limpiarNuevo} disabled={guardando}>Cancelar</BotonSecundario>
            <BotonGuardar onClick={guardarNuevo} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</BotonGuardar>
          </div>
        </div>
      )}

      {/* Tabla */}
      {enResumen ? null : cargandoHojas ? <div className="p-4"><Cargando /></div> : !hojaActiva ? (
        <p className="text-[12px] px-4 py-6" style={{ color: C.texto2 }}>Todavía no hay hojas en este grupo. Crea la primera con «Agregar → Nueva hoja».</p>
      ) : cargandoHoja ? <div className="p-4"><Cargando /></div> : (
        <div className="tabla-fija">
          <table className={TABLA} style={{ ...F_TABLA, minWidth: 1100 }}>
            <Columnas acciones={false} />
            <Cabecera titulo={nombreHoja(hojaActiva)} ejercicio={ejercicio} acciones={false} />
            <tbody>
              {calculadasHoja.length > 0 && (
                <tr><td colSpan={cols} className="pl-4 pr-4 py-2 text-[11px]" style={{ color: C.texto2, background: "#F8FAF9", ...F_TEXTO }}>
                  {calculadasHoja.map((l) => `${l.concepto} ${l.cuenta_nombre ?? ""}`).join(", ")}: {calculadasHoja.length === 1 ? "la calcula" : "las calcula"} la herramienta ({cuentaCalculada(calculadasHoja[0].concepto)}); lo cargado aquí no se usa.{" "}
                  <button type="button" className="underline" style={{ color: C.alerta }} onClick={() => setConfirmacion({
                    mensaje: `¿Quitar ${calculadasHoja.length === 1 ? "la cuenta cargada a mano" : `las ${calculadasHoja.length} cuentas cargadas a mano`} en ${hojaActiva}? El cálculo de la herramienta no cambia.`,
                    accion: async () => {
                      setConfirmacion(null);
                      for (const l of calculadasHoja) await apiFetch(`/api/presupuesto-departamental?departamento=${encodeURIComponent(hojaActiva ?? "")}&concepto=${encodeURIComponent(l.concepto)}&ejercicio=${ejercicio}`, { method: "DELETE" });
                      trasGuardar();
                    },
                  })}>Quitar de esta hoja</button>
                </td></tr>
              )}
              {gastosHoja.length === 0 && (
                <tr><td colSpan={cols} className="pl-4 py-5 text-[11px]" style={{ color: C.texto2, ...F_TEXTO }}>Sin cuentas en esta hoja. Usa «⋯ → Cargar histórico» o «Agregar → Nuevo registro».</td></tr>
              )}
              {vistaHoja.map((l) => {
                const resumenOrigen = l.resumen_id ? resumenHoja.find((r) => r.idsPorMes.includes(l.resumen_id!)) ?? null : null;
                const enEdicion = editando === l.concepto;
                return (
                  <Fragment key={l.concepto}>
                    <tr className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                      <td className="pl-4 relative">
                        <span className="flex items-center min-w-0 pr-2" title={`${l.concepto} ${l.cuenta_nombre ?? ""} · ${l.modo === "prorrateado" ? "Prorrateado" : "Directo"}`}>
                          <span className="shrink-0 w-3 flex"><PuntoModo modo={l.modo} /></span>
                          <span className="text-[10px] shrink-0 text-left" style={{ color: C.tenue, width: 58 }}>{l.concepto}</span>
                          <span className="truncate" style={{ color: C.texto3 }}>{l.cuenta_nombre}</span>
                          {l.calc && <span className="shrink-0 ml-2 text-[10px] italic" style={{ color: C.tenue }}
                                           title={digitos(l.concepto) === l.calc.codigo
                                             ? `La calcula la herramienta: ${l.calc.origen}. Lo cargado a mano en esta cuenta no se usa.`
                                             : `No se usa: la cuenta ${l.calc.codigo} se calcula en ${l.calc.origen}.`}>
                            {digitos(l.concepto) === l.calc.codigo ? l.calc.origen.replace(/\s*\(.*\)$/, "") : "no se usa"}</span>}
                        </span>
                        {l.virtual ? null : l.calc ? (
                          <AccionesFila>
                            <Accion peligro titulo="Quitar lo cargado a mano (no se usa)" onClick={() => setConfirmacion({
                              mensaje: `¿Quitar lo cargado a mano en "${l.concepto} ${l.cuenta_nombre ?? ""}"? No se usa: el valor sale de ${l.calc!.origen}.`,
                              accion: () => eliminarGasto(l, resumenOrigen),
                            })}><Trash2 size={13} /></Accion>
                          </AccionesFila>
                        ) : enEdicion ? (
                          <AccionesFila fijo>
                            <Accion onClick={() => { if (!guardando) guardarEdicion(l); }} titulo={guardando ? "Guardando…" : "Guardar"} activo><Check size={14} /></Accion>
                            <Accion onClick={() => { setEditando(null); setErrorGuardar(null); }} titulo="Cancelar"><X size={14} /></Accion>
                          </AccionesFila>
                        ) : (
                          <AccionesFila>
                            {l.modo === "directo" && <Accion onClick={() => empezarEdicion(l)} titulo="Editar montos"><Pencil size={13} /></Accion>}
                            <Accion onClick={() => abrirRecalcular(l.concepto)} titulo="Recalcular desde histórico" activo={recalculando === l.concepto}><RefreshCw size={13} /></Accion>
                            <Accion onClick={() => abrirCambioModo(l)} titulo="Cambiar modo" activo={cambiandoModo === l.concepto}><ArrowLeftRight size={13} /></Accion>
                            <Accion peligro titulo="Eliminar" onClick={() => setConfirmacion({
                              mensaje: l.modo === "prorrateado"
                                ? `¿Eliminar "${l.concepto} ${l.cuenta_nombre ?? ""}"? Se borra el valor institucional y lo repartido en las 10 agencias.`
                                : `¿Eliminar "${l.concepto} ${l.cuenta_nombre ?? ""}" (12 meses, solo ${agencia})?`,
                              accion: () => eliminarGasto(l, resumenOrigen),
                            })}><Trash2 size={13} /></Accion>
                          </AccionesFila>
                        )}
                      </td>
                      {l.montosPorMes.map((v, i) => enEdicion ? (
                        <td key={i} className="px-0.5">
                          <CampoMonto value={editMontos[i]} etiqueta={`Monto de ${MESES[i]}`} onChange={(v) => setEditMontos((p) => p.map((x, j) => (j === i ? v : x)))}
                                 className={INPUT} style={INPUT_STYLE} />
                        </td>
                      ) : <Celda key={i} v={ver(l.montosPorMes)[i]} />)}
                      <Celda v={enEdicion ? sumaTextos(editMontos) : suma(l.montosPorMes)} fuerte />
                      <td className="text-center">{!l.calc && <BotonF abierto={formulaAbierta === l.concepto} onClick={() => abrirFormula(l, resumenOrigen)} />}</td>
                    </tr>

                    {enEdicion && (
                      <FilaPanel colSpan={cols}>
                        <div className="flex items-center gap-4 text-[11px]">
                          <button onClick={() => setEditMontos((p) => Array(12).fill(p[0] || "0"))} className="hover:underline" style={{ color: C.acento }}>Repetir enero en los 12 meses</button>
                          <button onClick={() => setEditMontos(Array(12).fill("0"))} className="hover:underline" style={{ color: C.alerta }}>Poner los 12 meses en 0</button>
                          <MensajeError texto={errorGuardar} />
                        </div>
                      </FilaPanel>
                    )}

                    {formulaAbierta === l.concepto && (
                      <FilaPanel colSpan={cols}>
                        {l.modo === "prorrateado" && resumenOrigen && agenciaActiva ? (
                          <div className="flex flex-col gap-3 text-[11px]" style={{ color: C.texto2 }}>
                            <div>
                              <SelectorMes mes={mesFormula} onMes={setMesFormula} />
                              <p>
                                {MESES[mesFormula]} = {usd(resumenOrigen.montosPorMes[mesFormula])} (valor institucional) × {pct(agenciaActiva.porcentaje)} (participación de {agencia} en el activo del grupo) = <b style={{ color: C.texto }}>{usd(l.montosPorMes[mesFormula])}</b>
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold mb-1" style={{ color: C.acento }}>Valor institucional (antes del reparto) · {resumenOrigen.nombre}</p>
                              <div className="flex items-end gap-1 flex-wrap">
                                {MESES.map((m, i) => (
                                  <div key={m} className="flex flex-col items-center">
                                    <span className="text-[10px]" style={{ color: C.tenue }}>{m}</span>
                                    <CampoMonto value={editInstMontos[i]} etiqueta={`Valor institucional de ${m}`}
                                           onChange={(v) => setEditInstMontos((p) => p.map((x, j) => (j === i ? v : x)))}
                                           className="w-20 text-right text-[11px] rounded px-1 py-1 bg-white" style={{ ...INPUT_STYLE, ...F_TABLA }} />
                                  </div>
                                ))}
                                <span className="ml-2"><BotonGuardar onClick={() => guardarValorInstitucional(resumenOrigen)} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</BotonGuardar></span>
                              </div>
                              <MensajeError texto={errorGuardar} />
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold mb-1" style={{ color: C.acento }}>Nota de origen</p>
                              <div className="flex items-start gap-2">
                                <textarea value={notaTexto} onChange={(e) => setNotaTexto(e.target.value)} rows={1}
                                          placeholder="Ej. 5 integrantes × $1.446 de dieta"
                                          className="flex-1 text-[11px] rounded px-2 py-1.5 bg-white resize-none" style={{ border: `1px solid ${C.borde}`, color: C.texto }} />
                                <BotonSecundario onClick={() => guardarNota(resumenOrigen.nombre)}>Guardar nota</BotonSecundario>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px]" style={{ color: C.texto2 }}>
                            {l.origen === "sugerido"
                              ? `Monto directo de ${agencia}, cargado desde el histórico (base anual × (1 + crecimiento %), repartido en 12 meses). Total anual ${usd(suma(l.montosPorMes))}.`
                              : `Monto directo de ${agencia}, ingresado a mano en la hoja ${hojaActiva}; no depende de otra cuenta. Total anual ${usd(suma(l.montosPorMes))}.`}
                          </p>
                        )}
                      </FilaPanel>
                    )}

                    {recalculando === l.concepto && (
                      <FilaPanel colSpan={cols}>
                        {recalcDatos === undefined ? <p className="text-[11px]" style={{ color: C.texto2 }}>Cargando histórico de {l.concepto}...</p>
                          : recalcDatos === null ? <p className="text-[11px]" style={{ color: C.texto2 }}>No hay histórico guardado para {l.concepto} en {agencia}.</p>
                          : (() => {
                            const stats = aniosDeStats(recalcDatos.stats_anuales);
                            const p = parseFloat(recalcCrecimiento) || 0;
                            const b = baseAnual(recalcDatos);
                            return (
                              <div className="text-[11px]" style={{ color: C.texto2 }}>
                                {stats && stats.anios.length > 0 && (
                                  <div className="mb-2 flex gap-6 text-[10px]" style={F_TABLA}>
                                    {stats.anios.map((a, k) => (
                                      <span key={a.anio}>{a.anio}{a.completo ? "" : " (incompleto)"}: mín {cifra(a.min)} · máx {cifra(a.max)} · prom {cifra(a.avg)}
                                        {k === 0 && stats.variacion_pct !== undefined && stats.anios[1] && <span style={{ color: stats.variacion_pct >= 0 ? C.ok : C.alerta }}> ({stats.variacion_pct >= 0 ? "+" : ""}{stats.variacion_pct} % vs {stats.anios[1].anio})</span>}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-4 flex-wrap">
                                  <span className="flex gap-1">
                                    {(["avg", "ttm"] as const).map((k) => (
                                      <button key={k} onClick={() => setRecalcBase(k)} className="px-2.5 py-1 rounded-md text-[10px]"
                                              style={recalcBase === k ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { border: `1px solid ${C.borde}` }}>
                                        {k === "avg" ? "Promedio" : "Histórico (TTM)"}
                                      </button>
                                    ))}
                                  </span>
                                  <select value={recalcReparto} onChange={(e) => setRecalcReparto(e.target.value as "estacional" | "parejo")} className="rounded-md px-2 py-1 bg-white text-[11px]" style={{ border: `1px solid ${C.borde}` }}>
                                    <option value="estacional">Patrón histórico</option>
                                    <option value="parejo">Parejo, 1/12 cada mes</option>
                                  </select>
                                  <span className="flex items-center gap-2 flex-1 min-w-[234px]">
                                    <span>Incremento</span>
                                    <input type="range" min="-30" max="100" step="1" value={recalcCrecimiento} onChange={(e) => setRecalcCrecimiento(e.target.value)} className="flex-1 accent-[#005A28]" />
                                    <b className="w-12 text-right" style={{ color: C.texto }}>{p} %</b>
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <BotonSecundario onClick={() => setRecalculando(null)}>Cancelar</BotonSecundario>
                                    <BotonGuardar onClick={() => confirmarRecalculo(l)}>Aplicar</BotonGuardar>
                                  </span>
                                </div>
                                <p className="mt-2">
                                  Base {recalcBase === "avg" ? "promedio" : "TTM"} {usd(b)} × (1 + {p} %) = <b style={{ color: C.texto }}>{usd(b * (1 + p / 100))}</b> anual, repartido {recalcReparto === "estacional" ? "según el patrón histórico" : "parejo en los 12 meses"}.
                                </p>
                              </div>
                            );
                          })()}
                      </FilaPanel>
                    )}

                    {cambiandoModo === l.concepto && (
                      <FilaPanel colSpan={cols}>
                        <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: C.texto2 }}>
                          <span>Cambiar {l.concepto} a</span>
                          <select value={modoDestino} onChange={(e) => setModoDestino(e.target.value as Modo)} className="rounded-md px-2 py-1 bg-white" style={{ border: `1px solid ${C.borde}` }}>
                            <option value="directo">Directo</option>
                            <option value="prorrateado">Prorrateado</option>
                          </select>
                          {modoDestino === "prorrateado" && (
                            <>
                              <select value={origenResumenDestino} onChange={(e) => setOrigenResumenDestino(e.target.value as "nueva" | "existente")} className="rounded-md px-2 py-1 bg-white" style={{ border: `1px solid ${C.borde}` }}>
                                <option value="existente">Usar valor institucional existente</option>
                                <option value="nueva">Crear nuevo valor institucional</option>
                              </select>
                              {origenResumenDestino === "existente" && (
                                <select value={resumenDestino} onChange={(e) => setResumenDestino(e.target.value)} className="rounded-md px-2 py-1 bg-white" style={{ border: `1px solid ${C.borde}` }}>
                                  <option value="">Elegir línea...</option>
                                  {resumenHoja.map((r) => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
                                </select>
                              )}
                            </>
                          )}
                          <span className="ml-auto flex gap-2">
                            <BotonSecundario onClick={() => { setCambiandoModo(null); setErrorGuardar(null); }} disabled={guardando}>Cancelar</BotonSecundario>
                            <BotonGuardar onClick={() => guardarCambioModo(l)} disabled={guardando}>{guardando ? "Aplicando…" : "Aplicar"}</BotonGuardar>
                          </span>
                        </div>
                        <MensajeError texto={errorGuardar} />
                        {modoDestino === "prorrateado" && origenResumenDestino === "nueva" && (
                          <div className="mt-2.5">
                            <div className="flex items-center justify-between mb-1 text-[10px]">
                              <span style={{ color: C.texto2 }}>Monto institucional por mes (antes del reparto entre agencias)</span>
                              <button onClick={() => setMontosResumenNuevo((p) => Array(12).fill(p[0] || "0"))} className="hover:underline" style={{ color: C.acento }}>Repetir enero en los 12 meses</button>
                            </div>
                            <div className="grid grid-cols-12 gap-1.5">
                              {MESES.map((m, i) => (
                                <div key={m}>
                                  <span className="text-[10px] block text-center" style={{ color: C.tenue }}>{m}</span>
                                  <CampoMonto value={montosResumenNuevo[i]} etiqueta={`Monto institucional de ${m}`}
                                         onChange={(v) => setMontosResumenNuevo((p) => p.map((x, j) => (j === i ? v : x)))}
                                         className={INPUT} style={{ ...INPUT_STYLE, ...F_TABLA }} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </FilaPanel>
                    )}
                  </Fragment>
                );
              })}
              {vistaHoja.length > 0 && (
                <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
                  <td className="pl-4 font-bold" style={{ color: C.texto }}>Total {nombreHoja(hojaActiva)}</td>
                  {ver(MESES.map((_, i) => suma(vistaHoja.map((l) => l.montosPorMes[i])))).map((v, i) => <Celda key={i} v={v} fuerte />)}
                  <Celda v={suma(vistaHoja.map((l) => suma(l.montosPorMes)))} fuerte />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Cargar histórico en las 10 agencias */}
      {modalTodas && hojaActiva && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-xl w-full p-5 flex flex-col gap-3" style={{ border: `1px solid ${C.borde}`, ...F_TEXTO }}>
            <p className="text-[14px] font-semibold" style={{ color: C.texto }}>Histórico en las 10 agencias · {hojaActiva}</p>
            <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
              Cada cuenta de esta hoja que esté en 0 (o que falte) en una agencia se llena con el <b>histórico de esa agencia</b>. Las cuentas
              <b> prorrateadas</b> no se tocan (salen del monto institucional) y las que ya tienen valores se quedan como están.
            </p>
            <div className="flex items-center gap-5 rounded-lg px-3 py-2 flex-wrap text-[11px]" style={{ background: C.crema, color: C.texto2 }}>
              <span className="flex items-center gap-2">
                Crecimiento
                <input value={crecimientoHistorico} onChange={(e) => setCrecimientoHistorico(e.target.value)} inputMode="decimal" aria-label="Crecimiento %"
                       className="w-16 text-right rounded px-2 py-1 bg-white" style={{ ...INPUT_STYLE, ...F_TABLA }} />
                %
              </span>
              <span className="flex items-center gap-2">
                Reparto por mes
                <select value={repartoHistorico} onChange={(e) => setRepartoHistorico(e.target.value as "estacional" | "parejo")} className="rounded px-2 py-1 bg-white" style={{ border: `1px solid ${C.borde}` }}>
                  <option value="estacional">Según patrón histórico</option>
                  <option value="parejo">Parejo, 1/12 cada mes</option>
                </select>
              </span>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <BotonSecundario onClick={() => setModalTodas(false)}>Cancelar</BotonSecundario>
              <BotonGuardar onClick={cargarHistoricoTodas} disabled={cargandoHistorico}>{cargandoHistorico ? "Cargando..." : "Cargar en las 10 agencias"}</BotonGuardar>
            </div>
          </div>
        </div>
      )}

      {/* Cargar histórico */}
      {selectorHistorico && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-5" style={{ border: `1px solid ${C.borde}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] font-semibold" style={{ color: C.texto }}>Cargar histórico · {hojaActiva}</p>
              <span className="flex gap-4 text-[11px]">
                <button onClick={() => setSelectorHistorico((p) => p && p.map((c) => ({ ...c, seleccionado: true })))} className="hover:underline" style={{ color: C.acento }}>Seleccionar todo</button>
                <button onClick={() => setSelectorHistorico((p) => p && p.map((c) => ({ ...c, seleccionado: false })))} className="hover:underline" style={{ color: C.acento }}>Quitar todo</button>
              </span>
            </div>
            <div className="flex items-center gap-5 mb-3 rounded-lg px-3 py-2 flex-wrap text-[11px]" style={{ background: C.crema, color: C.texto2 }}>
              <span className="flex items-center gap-2">
                Crecimiento
                <input value={crecimientoHistorico} onChange={(e) => setCrecimientoHistorico(e.target.value)} inputMode="decimal"
                       className="w-16 text-right rounded px-2 py-1 bg-white" style={{ ...INPUT_STYLE, ...F_TABLA }} />
                %
              </span>
              <span className="flex items-center gap-2">
                Reparto por mes
                <select value={repartoHistorico} onChange={(e) => setRepartoHistorico(e.target.value as "estacional" | "parejo")} className="rounded px-2 py-1 bg-white" style={{ border: `1px solid ${C.borde}` }}>
                  <option value="estacional">Según patrón histórico</option>
                  <option value="parejo">Parejo, 1/12 cada mes</option>
                </select>
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg" style={{ border: `1px solid ${C.borde}` }}>
              <table className="w-full border-collapse text-[11px]" style={F_TABLA}>
                <thead className="sticky top-0 bg-white">
                  <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
                    <th className="w-8" />
                    <th className="px-2 py-2 text-left font-semibold w-24">Código</th>
                    <th className="px-2 py-2 text-left font-semibold">Cuenta</th>
                    <th className="px-2 py-2 text-right font-semibold w-20">Ene</th>
                    <th className="px-2 py-2 text-right font-semibold w-20">Dic</th>
                    <th className="px-3 py-2 text-right font-semibold w-24">Total año</th>
                  </tr>
                </thead>
                <tbody>
                  {selectorHistorico.map((c) => {
                    const montos = calcularMontosMensuales(c.base_ttm, c.pesos_mensuales, parseFloat(crecimientoHistorico) || 0, repartoHistorico);
                    return (
                      <tr key={c.codigo} style={{ borderTop: `1px solid ${C.beige}` }}>
                        <td className="pl-3 py-1.5"><input type="checkbox" className="accent-[#005A28]" checked={c.seleccionado}
                          onChange={() => setSelectorHistorico((p) => p && p.map((x) => (x.codigo === c.codigo ? { ...x, seleccionado: !x.seleccionado } : x)))} /></td>
                        <td className="px-2 py-1.5" style={{ color: C.tenue }}>{c.codigo}</td>
                        <td className="px-2 py-1.5 truncate max-w-0" title={c.nombre_cuenta} style={{ color: C.texto3 }}>{c.nombre_cuenta}</td>
                        <td className="px-2 py-1.5 text-right" style={{ color: C.texto3 }}>{cifra(montos[0])}</td>
                        <td className="px-2 py-1.5 text-right" style={{ color: C.texto3 }}>{cifra(montos[11])}</td>
                        <td className="px-3 py-1.5 text-right font-semibold" style={{ color: C.texto }}>{cifra(suma(montos))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <BotonSecundario onClick={() => setSelectorHistorico(null)}>Cancelar</BotonSecundario>
              <BotonGuardar onClick={confirmarCargaHistorico} disabled={cargandoHistorico}>
                {cargandoHistorico ? "Guardando..." : `Cargar ${selectorHistorico.filter((c) => c.seleccionado).length} cuentas`}
              </BotonGuardar>
            </div>
          </div>
        </div>
      )}

      {confirmacion && <Confirmacion mensaje={confirmacion.mensaje} onSi={confirmacion.accion} onNo={() => setConfirmacion(null)} />}
    </div>
  );
}

const BORDE_NUEVO = "#8DB39B";
