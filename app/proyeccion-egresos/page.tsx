"use client";

import { VALORES_DE_SIEMPRE, type ParametrosVigentes } from "../../lib/calc/parametros-vigentes";
import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { apiFetch, guardarMontosPorMes, eliminarFilasDepartamental, cargarJSON, tieneDatos, precargarEnSerie, pasosGrupoHojas, errorDeRespuesta, useTurnos } from "../../lib/useDatos";
import { leerMonto, leerMeses, sumaTextos, textoEditable } from "../../lib/numeros";
import { usePendiente } from "../../lib/cambios-pendientes";
import { CampoMonto, MensajeError } from "../../components/GuardiaCambios";
import { useEffect, useState, Fragment, Suspense } from "react";
import { Pencil, Check, X, Trash2, ChevronsUpDown, ChevronsDownUp, ChevronRight } from "lucide-react";
import ResumenArbol from "../../components/ResumenArbol";
import {
  MESES, C, F_TABLA, F_TEXTO, suma, cifra, usd, TABLA, Columnas, Cabecera, COLS_TOTALES, BotonF, Celda, FilaPanel, AccionesFila,
  SelectorMes, Encabezado, Chips, TarjetasEgresos, TablaCalculada, Confirmacion, Cargando, BotonTexto, BotonGuardar,
  BotonSecundario, INPUT, INPUT_STYLE, NombreCuenta, useEgresos, usePrecargaEgresos, buscarNodo, descargarCsv, urlResultados, type FilaExport, type Nodo,
} from "../../components/EgresosComun";
import { useVerMes, useMensualAlEditar } from "../../components/EgresosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { PAGINA, PAGINA_STYLE } from "../../components/EgresosComun";
import HojasGrupo, { agruparGastos, type FilaActivo, type LineaGasto } from "../../components/EgresosHojas";
import { EsqueletoTabla } from "../../components/Carga";
import { Contribuciones4504 } from "../../components/Contribuciones4504";

/** Ejercicios ya igualados en esta sesión (la igualación es idempotente; se hace una vez al entrar). */
const estructuraIgualada = new Set<number>();

/**
 * GASTOS OPERACIONALES (grupo 45). Estilo institucional.
 * 4501 tiene Nómina / Resumen / Gastos detallados; 4505 Depreciaciones se lee del motor de Activos fijos (solo lectura);
 * los demás subgrupos se capturan por hojas (EgresosHojas). Los cálculos no cambian.
 */

const GRUPOS = [
  { id: "4501", label: "Gastos de personal" },
  { id: "4502", label: "Honorarios" },
  { id: "4503", label: "Servicios varios" },
  { id: "4504", label: "Impuestos y aportes" },
  { id: "4505", label: "Depreciaciones" },
  { id: "4506", label: "Amortizaciones" }, // se calcula en Otros activos (1904)
  { id: "4507", label: "Otros gastos" },
];

// ---------- Nómina ----------
// Valores del ejercicio (Administración → Parámetros institucionales); se cargan al abrir la pantalla.
let TASAS: ParametrosVigentes = VALORES_DE_SIEMPRE;

interface Empleado { id: number; nombre: string; basico_2025: number; incremento_pct: number; movilizacion_anual: number; agencia?: string; }

function calcularEmpleado(e: { basico_2025: number; incremento_pct: number; movilizacion_anual: number }) {
  const basico2026 = e.basico_2025 * e.incremento_pct + e.basico_2025;
  const sueldoAnual = basico2026 * 12;
  const totalAnual = sueldoAnual + e.movilizacion_anual;
  const iessPatronalAnual = totalAnual * TASAS.iess_patronal;
  const fondoReservaAnual = totalAnual * TASAS.fondo_reserva;
  const decimoTerceroAnual = totalAnual / 12;
  const decimoCuartoAnual = TASAS.sbu;
  const costoTotalAnual = totalAnual + iessPatronalAnual + fondoReservaAnual + decimoTerceroAnual + decimoCuartoAnual;
  return { basico2026, sueldoAnual, totalAnual, iessPatronalAnual, fondoReservaAnual, decimoTerceroAnual, decimoCuartoAnual, costoTotalAnual };
}

interface RubroResumen4501 { nombre: string; montosPorMes: number[]; }

/** Cuenta de cada rubro del Resumen 4501 (las mismas subcuentas del Estado de resultados). */
const CUENTA_RUBRO_4501 = ["45010505", "45011005", "45011010", "45012005", "45013505", "4501"];
/** Nombres de las cuentas madre de 4501 (Catálogo SEPS) si el Estado de resultados no trae la cuenta. */
const NOMBRE_4501: Record<string, string> = {
  "4501": "Gastos de personal", "450105": "Remuneraciones mensuales", "450110": "Beneficios sociales", "450115": "Gastos de representación, residencia y responsabilidad",
  "450120": "Aportes al IESS", "450125": "Impuesto a la renta del personal", "450130": "Pensiones y jubilaciones", "450135": "Fondo de reserva IESS", "450190": "Otros",
};

type Extras4501 = { decimoPorMes: number[]; fondoPorMes: number[]; iessPorMes: number[]; basePorMes: number[] };
const EXTRAS_CERO: Extras4501 = { decimoPorMes: Array(12).fill(0), fondoPorMes: Array(12).fill(0), iessPorMes: Array(12).fill(0), basePorMes: Array(12).fill(0) };
const pctTxt = (x: number) => `${(x * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %`;
const VARIABLES = "horas extras + comisiones + subrogaciones";

function explicacionRubro(indice: number, rubros: RubroResumen4501[], extras: Extras4501, numeroEmpleados: number, mesIdx: number): string {
  const total = rubros[indice]?.montosPorMes[mesIdx] ?? 0;
  const mesLabel = MESES[mesIdx];
  if (indice === 0) return `Suma del básico proyectado de los ${numeroEmpleados} empleados de la planilla; igual los 12 meses. ${mesLabel} = ${usd(total)}.`;
  if (indice === 1) {
    const extra = extras.decimoPorMes[mesIdx];
    return `${mesLabel} = ${usd(total - extra)} (Nómina: un mes de nómina ÷ 12) + ${usd(extra)} (Talento Humano: ${VARIABLES} = ${usd(extras.basePorMes[mesIdx])}, ÷ 12) = ${usd(total)}`;
  }
  if (indice === 2) return `${numeroEmpleados} empleados × ${usd(TASAS.sbu)} (1 SBU) ÷ 12 = ${usd(total)}; igual los 12 meses.`;
  if (indice === 3) {
    const extra = extras.iessPorMes[mesIdx];
    return `${mesLabel} = ${usd(total - extra)} (Nómina: total anual × ${pctTxt(TASAS.iess_patronal)} ÷ 12) + ${usd(extra)} (Talento Humano: ${VARIABLES} = ${usd(extras.basePorMes[mesIdx])}, × ${pctTxt(TASAS.iess_patronal)}) = ${usd(total)}`;
  }
  if (indice === 4) {
    const extra = extras.fondoPorMes[mesIdx];
    return `${mesLabel} = ${usd(total - extra)} (Nómina: total anual × ${pctTxt(TASAS.fondo_reserva)} ÷ 12) + ${usd(extra)} (Talento Humano: ${VARIABLES} = ${usd(extras.basePorMes[mesIdx])}, × ${pctTxt(TASAS.fondo_reserva)}) = ${usd(total)}`;
  }
  return `Suma de las demás cuentas 4501 cargadas directo en Talento Humano (jubilación patronal, refrigerios, uniformes, horas extras, comisiones, etc.). ${mesLabel} = ${usd(total)}.`;
}

function Accion({ onClick, titulo, activo, peligro, children }: { onClick: () => void; titulo: string; activo?: boolean; peligro?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={titulo} title={titulo} className="p-0.5 rounded hover:bg-[#EEF1EF]"
            style={{ color: activo ? C.acento : peligro ? C.alerta : C.tenue }}>{children}</button>
  );
}

function GastosOperacionalesContenido() {
  const [ejercicio] = useEjercicio();
  // Parámetros institucionales del ejercicio para la planilla (se vuelve a pintar al llegar)
  const [, setTasasListas] = useState(0);
  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/parametros-institucionales?ejercicio=${ejercicio}`).then((r) => (r.ok ? r.json() : null)).then((d: { valores?: Record<string, { valor: number }> } | null) => {
      if (!vivo || !d?.valores) return;
      TASAS = { ...VALORES_DE_SIEMPRE, ...Object.fromEntries(Object.entries(d.valores).map(([k, v]) => [k, v.valor])) } as ParametrosVigentes;
      setTasasListas((x) => x + 1);
    }).catch(() => undefined);
    return () => { vivo = false; };
  }, [ejercicio]);
  const [grupoActivo, setGrupoActivo] = useState("4501");
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [activos, setActivos] = useState<FilaActivo[]>([]);
  const [version, setVersion] = useState(0);
  const refrescar = () => setVersion((v) => v + 1);
  // Misma estructura de egresos en las 10 agencias: al entrar se crean (en 0) las cuentas que falten en alguna agencia
  useEffect(() => {
    if (estructuraIgualada.has(ejercicio)) return;
    estructuraIgualada.add(ejercicio);
    apiFetch("/api/presupuesto-departamental", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "igualarEstructura", ejercicio }) })
      .then((r) => r.json()).then((d) => { if (d?.cuentasCreadas) setVersion((v) => v + 1); })
      .catch(() => estructuraIgualada.delete(ejercicio));
  }, [ejercicio]);
  const { egresos, calculadas, cargando: cargandoER } = useEgresos(agencia, ejercicio, version);
  // Consolidado (suma de las 10 agencias): solo lectura; nada se guarda desde aquí.
  const esConsolidado = agencia === "Consolidado";
  usePrecargaEgresos(agencia, ejercicio);
  // Las demás pestañas de Gastos operacionales se preparan por detrás (solo en la versión publicada).
  useEffect(() => precargarEnSerie([
    `/api/nomina-empleados?agencia=${encodeURIComponent(agencia)}`,
    `/api/resumen-4501?agencia=${encodeURIComponent(agencia)}`,
    `/api/presupuesto-departamental?grupo=4501&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`,
    ...(agencia === "Consolidado" ? [] : ["4502", "4503", "4504", "4507"].flatMap((g) => pasosGrupoHojas(g, agencia, ejercicio))),
  ]), [agencia, ejercicio]);
  const [filasExport, setFilasExport] = useState<FilaExport[]>([]);
  const [confirmacion, setConfirmacion] = useState<{ mensaje: string; accion: () => void } | null>(null);

  useEffect(() => {
    cargarJSON<{ filas?: FilaActivo[] }>("/api/activos-por-agencia", (d) => setActivos(d.filas ?? [])).catch(() => undefined);
  }, []);

  // ---------- 4501 ----------
  const [sub4501, setSub4501] = useState<"nomina" | "resumen" | "detalle">("nomina");
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [cargandoNomina, setCargandoNomina] = useState(true);
  const [rubros4501, setRubros4501] = useState<RubroResumen4501[]>([]);
  const [totalPorMes4501, setTotalPorMes4501] = useState<number[]>(Array(12).fill(0));
  const [numeroEmpleados4501, setNumeroEmpleados4501] = useState(0);
  const [extras4501, setExtras4501] = useState<Extras4501>(EXTRAS_CERO);
  const [nominaAlMes, setNominaAlMes] = useState(false);
  const [cargandoResumen4501, setCargandoResumen4501] = useState(true);
  const [detalle4501, setDetalle4501] = useState<LineaGasto[]>([]);
  // Gastos detallados como árbol: cuenta madre (6 dígitos) y sus subcuentas (8 dígitos); abiertas por defecto
  const [cerrados4501, setCerrados4501] = useState<Set<string>>(new Set());
  const [cargandoDetalle4501, setCargandoDetalle4501] = useState(true);
  const [formulaAbierta, setFormulaAbierta] = useState<string | null>(null);
  const [mesFormula, setMesFormula] = useState(0);

  const turnos = useTurnos();
  function cargarNomina() {
    const url = `/api/nomina-empleados?agencia=${encodeURIComponent(agencia)}`;
    const t = turnos.nuevo("nomina");
    setCargandoNomina(!tieneDatos(url));
    if (!tieneDatos(url)) setEmpleados([]);
    cargarJSON<{ filas?: Empleado[] }>(url, (d) => { if (turnos.vigente(t, "nomina")) setEmpleados(d.filas ?? []); }).catch(() => undefined).finally(() => { if (turnos.vigente(t, "nomina")) setCargandoNomina(false); });
  }
  function cargarResumen4501() {
    const url = `/api/resumen-4501?agencia=${encodeURIComponent(agencia)}`;
    const t = turnos.nuevo("resumen");
    setCargandoResumen4501(!tieneDatos(url));
    cargarJSON<{ rubros?: RubroResumen4501[]; totalPorMes?: number[]; numeroEmpleados?: number; extras?: Extras4501 }>(url, (d) => {
        if (!turnos.vigente(t, "resumen")) return;
        setRubros4501(d.rubros ?? []);
        setTotalPorMes4501(d.totalPorMes ?? Array(12).fill(0));
        setNumeroEmpleados4501(d.numeroEmpleados ?? 0);
        setExtras4501(d.extras?.decimoPorMes ? d.extras : EXTRAS_CERO);
      }).catch(() => undefined).finally(() => { if (turnos.vigente(t, "resumen")) setCargandoResumen4501(false); });
  }
  function cargarDetalle4501() {
    const url = `/api/presupuesto-departamental?grupo=4501&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
    const t = turnos.nuevo("detalle");
    setCargandoDetalle4501(!tieneDatos(url));
    if (!tieneDatos(url)) setDetalle4501([]);
    cargarJSON<{ filas?: Parameters<typeof agruparGastos>[0] }>(url, (d) => { if (turnos.vigente(t, "detalle")) setDetalle4501(agruparGastos(d.filas ?? [])); }).catch(() => undefined).finally(() => { if (turnos.vigente(t, "detalle")) setCargandoDetalle4501(false); });
  }

  useEffect(() => {
    setFormulaAbierta(null);
    if (grupoActivo !== "4501") return;
    if (sub4501 === "nomina") cargarNomina();
    if (sub4501 === "resumen") cargarResumen4501();
    if (sub4501 === "detalle") cargarDetalle4501();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoActivo, sub4501, agencia]);

  // Filas para Exportar según la vista abierta
  useEffect(() => {
    if (grupoActivo === "4501") {
      if (sub4501 === "nomina") setFilasExport(empleados.map((e) => ({ codigo: "4501", cuenta: e.nombre, montos: Array(12).fill(calcularEmpleado(e).costoTotalAnual / 12) })));
      if (sub4501 === "resumen") setFilasExport(rubros4501.map((r) => ({ codigo: "4501", cuenta: r.nombre, montos: r.montosPorMes })));
      if (sub4501 === "detalle") setFilasExport(detalle4501.map((l) => ({ codigo: l.concepto, cuenta: l.cuenta_nombre ?? "", montos: l.montosPorMes })));
    } else if (grupoActivo === "4505" || grupoActivo === "4506" || esConsolidado) {
      const n = buscarNodo(egresos, grupoActivo);
      const hojas = n?.hijos?.length ? n.hijos : n ? [n] : [];
      setFilasExport(hojas.map((h) => ({ codigo: h.codigo, cuenta: h.label, montos: h.valores })));
    }
  }, [grupoActivo, sub4501, empleados, rubros4501, detalle4501, egresos, esConsolidado]);

  // Nómina: agregar / editar uno / editar planilla completa / dar de baja
  const [editandoEmpleado, setEditandoEmpleado] = useState<number | null>(null);
  const [editEmp, setEditEmp] = useState({ nombre: "", basico: "", incremento: "", movilizacion: "" });
  const [agregandoEmpleado, setAgregandoEmpleado] = useState(false);
  const [nuevoEmp, setNuevoEmp] = useState({ nombre: "", basico: "", incremento: "4", movilizacion: "" });

  // Un mensaje de error y un «guardando» comunes a los guardados de esta pantalla
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

  /** Lee y valida los datos de un empleado. El incremento se escribe en % (4 = 4 %) y se guarda en decimal. */
  function leerEmpleado(f: { nombre: string; basico: string; incremento: string; movilizacion: string }, quien = "") {
    const de = quien ? ` de ${quien}` : "";
    if (!f.nombre.trim()) return { error: `Escriba el nombre${de}.` } as const;
    const b = leerMonto(f.basico), inc = leerMonto(f.incremento), mov = leerMonto(f.movilizacion);
    if (b.error) return { error: `Básico${de}: ${b.error}.` } as const;
    if (!b.valor || b.valor <= 0) return { error: `El básico${de} debe ser mayor a 0.` } as const;
    if (inc.error) return { error: `Incremento${de}: ${inc.error}.` } as const;
    if ((inc.valor ?? 0) < 0 || (inc.valor ?? 0) > 50) return { error: `El incremento${de} debe estar entre 0 % y 50 %.` } as const;
    if (mov.error) return { error: `Movilización${de}: ${mov.error}.` } as const;
    if ((mov.valor ?? 0) < 0) return { error: `La movilización${de} no puede ser negativa.` } as const;
    return { datos: { nombre: f.nombre.trim(), basico_2025: b.valor, incremento_pct: (inc.valor ?? 0) / 100, movilizacion_anual: mov.valor ?? 0 } } as const;
  }
  const textoEmpleado = (e: Empleado) => ({ nombre: e.nombre, basico: textoEditable(e.basico_2025), incremento: textoEditable(e.incremento_pct * 100, 4) || "0", movilizacion: textoEditable(e.movilizacion_anual) });

  async function guardarNuevoEmpleado(): Promise<boolean> {
    if (esConsolidado) return false;
    const l = leerEmpleado(nuevoEmp);
    if ("error" in l) { setErrorGuardar(l.error ?? null); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await apiFetch("/api/nomina-empleados", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...l.datos, agencia }),
    })));
    if (!ok) return false;
    setNuevoEmp({ nombre: "", basico: "", incremento: "4", movilizacion: "" });
    setAgregandoEmpleado(false);
    cargarNomina(); refrescar();
    return true;
  }
  function empezarEdicionEmpleado(e: Empleado) {
    if (esConsolidado) return;
    setFormulaAbierta(null); setErrorGuardar(null);
    setEditandoEmpleado(e.id);
    setEditEmp(textoEmpleado(e));
  }
  async function guardarEdicionEmpleado(): Promise<boolean> {
    if (esConsolidado || editandoEmpleado === null) return false;
    const l = leerEmpleado(editEmp);
    if ("error" in l) { setErrorGuardar(l.error ?? null); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await apiFetch("/api/nomina-empleados", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editandoEmpleado, ...l.datos }),
    })));
    if (!ok) return false;
    setEditandoEmpleado(null);
    cargarNomina(); refrescar();
    return true;
  }
  type FilaPlanilla = { nombre: string; basico: string; incremento: string; movilizacion: string };
  const [planilla, setPlanilla] = useState<Record<number, FilaPlanilla> | null>(null);
  const [guardandoPlanilla, setGuardandoPlanilla] = useState(false);
  const cambiosPlanilla = planilla ? empleados.filter((e) => {
    const f = planilla[e.id], o = textoEmpleado(e);
    return f && (f.nombre !== o.nombre || f.basico !== o.basico || f.incremento !== o.incremento || f.movilizacion !== o.movilizacion);
  }) : [];
  function empezarPlanilla() {
    if (esConsolidado) return;
    setEditandoEmpleado(null); setAgregandoEmpleado(false); setFormulaAbierta(null); setErrorGuardar(null);
    setPlanilla(Object.fromEntries(empleados.map((e) => [e.id, textoEmpleado(e)])));
  }
  function escribirPlanilla(id: number, campo: keyof FilaPlanilla, valor: string) {
    setPlanilla((p) => (p ? { ...p, [id]: { ...p[id], [campo]: valor } } : p));
  }
  async function guardarPlanilla(): Promise<boolean> {
    if (esConsolidado) { setPlanilla(null); return true; }
    if (!planilla || !cambiosPlanilla.length) { setPlanilla(null); return true; }
    const filas: Record<string, unknown>[] = [];
    for (const e of cambiosPlanilla) {
      const l = leerEmpleado(planilla[e.id], e.nombre);
      if ("error" in l) { setErrorGuardar(l.error ?? null); return false; }
      filas.push({ id: e.id, ...l.datos });
    }
    setGuardandoPlanilla(true);
    try {
      const ok = await conGuardado(async () => errorDeRespuesta(await apiFetch("/api/nomina-empleados", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleados: filas }),
      })));
      if (!ok) return false;
      setPlanilla(null);
      cargarNomina(); refrescar();
      return true;
    } finally {
      setGuardandoPlanilla(false);
    }
  }
  async function darDeBajaEmpleado(id: number) {
    if (esConsolidado) return;
    await apiFetch(`/api/nomina-empleados?id=${id}`, { method: "DELETE" });
    cargarNomina(); refrescar();
  }

  // Gastos detallados de Talento Humano (4501)
  const [editandoDetalle, setEditandoDetalle] = useState<string | null>(null);
  const [editDetalleMontos, setEditDetalleMontos] = useState<string[]>(Array(12).fill(""));
  const [agregandoDetalle, setAgregandoDetalle] = useState(false);
  const ver = useVerMes();
  useMensualAlEditar(editandoDetalle !== null || agregandoDetalle);
  const [nuevoDetalleHoja, setNuevoDetalleHoja] = useState("Talento Humano");
  const [nuevoDetalleCodigo, setNuevoDetalleCodigo] = useState("");
  const [nuevoDetalleNombre, setNuevoDetalleNombre] = useState("");
  const [nuevoDetalleMontos, setNuevoDetalleMontos] = useState<string[]>(Array(12).fill(""));

  async function guardarEdicionDetalle(l: LineaGasto): Promise<boolean> {
    if (esConsolidado) return false;
    const lectura = leerMeses(editDetalleMontos);
    if (lectura.error !== null) { setErrorGuardar(lectura.error); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-departamental", l.idsPorMes, (i) => lectura.valores[i])));
    if (!ok) return false;
    setEditandoDetalle(null);
    cargarDetalle4501(); refrescar();
    return true;
  }
  async function eliminarDetalle(l: LineaGasto) {
    if (esConsolidado) return;
    await eliminarFilasDepartamental(l.idsPorMes);
    cargarDetalle4501(); refrescar();
  }
  async function guardarNuevoDetalle(): Promise<boolean> {
    if (esConsolidado) return false;
    if (!nuevoDetalleCodigo.trim() || !nuevoDetalleHoja.trim()) { setErrorGuardar("Escriba el código de la cuenta y la hoja."); return false; }
    const lectura = leerMeses(nuevoDetalleMontos);
    if (lectura.error !== null) { setErrorGuardar(lectura.error); return false; }
    const ok = await conGuardado(async () => errorDeRespuesta(await apiFetch("/api/presupuesto-departamental", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        departamento: nuevoDetalleHoja.trim(), concepto: nuevoDetalleCodigo.trim(),
        cuenta_nombre: nuevoDetalleNombre.trim() || null, montosPorMes: lectura.valores,
        agencia, modo: "directo", ejercicio,
      }),
    })));
    if (!ok) return false;
    setNuevoDetalleCodigo(""); setNuevoDetalleNombre(""); setNuevoDetalleMontos(Array(12).fill(""));
    setAgregandoDetalle(false);
    cargarDetalle4501(); refrescar();
    return true;
  }

  // Ediciones abiertas: se avisan antes de cambiar de agencia o de pestaña
  const empleadoEditado = editandoEmpleado !== null ? empleados.find((e) => e.id === editandoEmpleado) ?? null : null;
  usePendiente(empleadoEditado ? { descripcion: `Datos de ${empleadoEditado.nombre} (nómina de ${agencia})`, guardar: guardarEdicionEmpleado, descartar: () => { setEditandoEmpleado(null); setErrorGuardar(null); } } : null);
  usePendiente(agregandoEmpleado && (nuevoEmp.nombre.trim() || nuevoEmp.basico.trim()) ? { descripcion: `Nuevo empleado en ${agencia}`, guardar: guardarNuevoEmpleado, descartar: () => { setAgregandoEmpleado(false); setErrorGuardar(null); } } : null);
  usePendiente(planilla && cambiosPlanilla.length ? { descripcion: `${cambiosPlanilla.length} cambio${cambiosPlanilla.length === 1 ? "" : "s"} en la planilla de ${agencia}`, guardar: guardarPlanilla, descartar: () => { setPlanilla(null); setErrorGuardar(null); } } : null);
  const detalleEditado = editandoDetalle ? detalle4501.find((l) => l.concepto === editandoDetalle) ?? null : null;
  usePendiente(detalleEditado ? { descripcion: `Montos de ${detalleEditado.concepto} en ${agencia}`, guardar: () => guardarEdicionDetalle(detalleEditado), descartar: () => { setEditandoDetalle(null); setErrorGuardar(null); } } : null);
  usePendiente(agregandoDetalle && (nuevoDetalleCodigo.trim() || nuevoDetalleMontos.some((m) => m.trim())) ? { descripcion: `Nueva cuenta de Talento Humano en ${agencia}`, guardar: guardarNuevoDetalle, descartar: () => { setAgregandoDetalle(false); setErrorGuardar(null); } } : null);

  const totalesNomina = empleados.reduce((acc, e) => {
    const c = calcularEmpleado(e);
    return {
      basico: acc.basico + e.basico_2025, basico2026: acc.basico2026 + c.basico2026, iess: acc.iess + c.iessPatronalAnual,
      fondo: acc.fondo + c.fondoReservaAnual, dec3: acc.dec3 + c.decimoTerceroAnual, dec4: acc.dec4 + c.decimoCuartoAnual, costo: acc.costo + c.costoTotalAnual,
    };
  }, { basico: 0, basico2026: 0, iess: 0, fondo: 0, dec3: 0, dec4: 0, costo: 0 });

  const grupoInfo = GRUPOS.find((g) => g.id === grupoActivo)!;
  const cols = COLS_TOTALES(false);
  const celdaNum = "px-2 text-right whitespace-nowrap";
  const div = nominaAlMes ? 12 : 1; // planilla: valores anuales o al mes
  const grupos4501 = (() => {
    const m = new Map<string, LineaGasto[]>();
    for (const l of detalle4501) { const k = l.concepto.replace(/\D/g, "").slice(0, 6) || l.concepto; m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([codigo, lineas]) => ({
      codigo, lineas: [...lineas].sort((a, b) => a.concepto.localeCompare(b.concepto)),
      nombre: buscarNodo(egresos, codigo)?.label ?? NOMBRE_4501[codigo] ?? `Cuenta ${codigo}`,
      valores: MESES.map((_, i) => suma(lineas.map((l) => l.montosPorMes[i]))),
    }));
  })();
  const todosAbiertos4501 = grupos4501.every((g) => !cerrados4501.has(g.codigo));

  // ====================================================================
  return (
    <div className={PAGINA} style={PAGINA_STYLE}>
      <Encabezado
        titulo="Gastos operacionales"
        pestanas={GRUPOS}
        activa={grupoActivo}
        onPestana={(id) => { setGrupoActivo(id); setFilasExport([]); }}
        agencia={agencia}
        onAgencia={setAgencia}
        onExportar={() => descargarCsv(`Gastos operacionales ${grupoActivo} - ${agencia} ${ejercicio}`, filasExport, ejercicio)}
        conConsolidado
      />
      <AvisoConsolidado url={urlResultados(agencia, ejercicio)} agencia={agencia} />

      <TarjetasEgresos egresos={egresos} cargando={cargandoER} codigos={["45"]} titulo="Gastos operacionales" grupo={{ codigo: grupoActivo, label: grupoInfo.label }} />

      {grupoActivo === "4501" && (
        <div className="flex flex-col gap-3" style={F_TEXTO}>
          <div className="flex items-center justify-between gap-4">
            <Chips items={[{ id: "nomina", label: "Nómina" }, { id: "resumen", label: "Resumen" }, { id: "detalle", label: "Gastos detallados" }]}
                   activa={sub4501} onElegir={(id) => setSub4501(id as typeof sub4501)} />
            <MensajeError texto={errorGuardar} />
            {sub4501 === "nomina" && (
              <span role="group" aria-label="Ver la planilla" className="inline-flex p-[3px] gap-0.5 rounded-lg bg-white ml-auto" style={{ border: `1px solid ${C.borde}` }}>
                {([[false, "Anual"], [true, "Al mes"]] as const).map(([v, l]) => (
                  <button key={l} type="button" aria-pressed={nominaAlMes === v} onClick={() => setNominaAlMes(v)} className="h-7 px-3 rounded text-[12px]"
                          style={nominaAlMes === v ? { background: "#E3EEE7", color: C.acento, fontWeight: 600 } : { color: C.texto2 }}>{l}</button>
                ))}
              </span>
            )}
            {sub4501 === "nomina" && !esConsolidado && (planilla ? (
              <span className="flex items-center gap-2">
                <BotonSecundario onClick={() => setPlanilla(null)} disabled={guardandoPlanilla}>Cancelar</BotonSecundario>
                <BotonGuardar onClick={guardarPlanilla} disabled={guardandoPlanilla || cambiosPlanilla.length === 0}>
                  {guardandoPlanilla ? "Guardando..." : cambiosPlanilla.length ? `Guardar ${cambiosPlanilla.length} ${cambiosPlanilla.length === 1 ? "cambio" : "cambios"}` : "Guardar"}
                </BotonGuardar>
              </span>
            ) : (
              <span className="flex items-center gap-5">
                <BotonTexto onClick={empezarPlanilla} disabled={!empleados.length}>Editar planilla</BotonTexto>
                <BotonTexto onClick={() => { setAgregandoEmpleado(true); setEditandoEmpleado(null); }}>+ Nuevo empleado</BotonTexto>
              </span>
            ))}
            {sub4501 === "detalle" && (
              <span className="flex items-center gap-5 ml-auto">
                <button type="button" onClick={() => setCerrados4501(todosAbiertos4501 ? new Set(grupos4501.map((g) => g.codigo)) : new Set())}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: C.acento }}>
                  {todosAbiertos4501 ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}{todosAbiertos4501 ? "Contraer todo" : "Expandir todo"}
                </button>
                {!esConsolidado && <BotonTexto onClick={() => setAgregandoDetalle(true)}>+ Nuevo registro</BotonTexto>}
              </span>
            )}
          </div>

          {/* -------- Nómina -------- */}
          {sub4501 === "nomina" && (cargandoNomina ? <Cargando /> : (
            <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
              <table className="w-full table-fixed border-collapse text-[11px]" style={F_TABLA}>
                <colgroup>
                  <col style={{ width: 320 }} />
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <col key={i} />)}
                  <col style={{ width: 28 }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
                    <th className="pl-4 py-2.5 text-left font-semibold text-[11px]" style={{ color: C.texto }}>Planilla · {agencia}</th>
                    {["Básico actual", "% Increm.", "Básico proyectado", ...(nominaAlMes ? ["IESS patronal al mes", "Fondo reserva al mes", "Décimo 3.º al mes", "Décimo 4.º al mes", "Costo total al mes"] : ["IESS patronal anual", "Fondo reserva anual", "Décimo 3.º anual", "Décimo 4.º anual", "Costo total anual"])].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-right font-semibold">{h}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {empleados.map((e) => {
                    const c = calcularEmpleado(e);
                    const f = planilla?.[e.id];
                    const id = `emp-${e.id}`;
                    if (!esConsolidado && (f || editandoEmpleado === e.id)) {
                      const val = f ?? editEmp;
                      const set = (campo: keyof FilaPlanilla, v: string) => f ? escribirPlanilla(e.id, campo, v) : setEditEmp((p) => ({ ...p, [campo]: v }));
                      return (
                        <tr key={e.id} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                          <td className="pl-4 pr-2">
                            <span className="flex items-center gap-1">
                              <input value={val.nombre} aria-label={`Nombre de ${e.nombre}`} onChange={(ev) => set("nombre", ev.target.value)} className="w-full text-[11px] rounded px-1.5 py-1 bg-white" style={INPUT_STYLE} />
                              {!f && <>
                                <Accion onClick={() => { if (!guardando) guardarEdicionEmpleado(); }} titulo={guardando ? "Guardando…" : "Guardar"} activo><Check size={14} /></Accion>
                                <Accion onClick={() => { setEditandoEmpleado(null); setErrorGuardar(null); }} titulo="Cancelar"><X size={14} /></Accion>
                              </>}
                            </span>
                          </td>
                          <td className="px-1"><CampoMonto value={val.basico} etiqueta={`Básico de ${e.nombre}`} onChange={(v) => set("basico", v)} className={INPUT} style={INPUT_STYLE} /></td>
                          <td className="px-1"><CampoMonto value={val.incremento} etiqueta={`Incremento en % de ${e.nombre}`} onChange={(v) => set("incremento", v)} className={INPUT} style={INPUT_STYLE} /></td>
                          <td colSpan={5} className="px-2 text-[10px] italic" style={{ color: C.tenue, ...F_TEXTO }}>
                            <span className="flex items-center gap-2">
                              Movilización anual
                              <CampoMonto value={val.movilizacion} etiqueta={`Movilización de ${e.nombre}`} onChange={(v) => set("movilizacion", v)} className="w-24 text-right text-[11px] rounded px-1 py-1 bg-white not-italic" style={{ ...INPUT_STYLE, ...F_TABLA }} />
                              · se recalcula al guardar
                            </span>
                          </td>
                          <td />
                          <td />
                        </tr>
                      );
                    }
                    return (
                      <Fragment key={e.id}>
                        <tr className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                          <td className="pl-4 pr-2 truncate relative" style={{ color: C.texto3 }} title={e.agencia ? `${e.nombre} · ${e.agencia}` : e.nombre}>
                            {e.nombre}{esConsolidado && e.agencia && <span style={{ color: C.tenue }}> · {e.agencia}</span>}
                            {!esConsolidado && <AccionesFila>
                              <Accion onClick={() => empezarEdicionEmpleado(e)} titulo="Editar"><Pencil size={13} /></Accion>
                              <Accion peligro titulo="Dar de baja" onClick={() => setConfirmacion({ mensaje: `¿Dar de baja a "${e.nombre}"?`, accion: () => darDeBajaEmpleado(e.id) })}><Trash2 size={13} /></Accion>
                            </AccionesFila>}
                          </td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(e.basico_2025)}</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{(e.incremento_pct * 100).toLocaleString("es-EC", { maximumFractionDigits: 1 })} %</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(c.basico2026)}</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(c.iessPatronalAnual / div)}</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(c.fondoReservaAnual / div)}</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(c.decimoTerceroAnual / div)}</td>
                          <td className={celdaNum} style={{ color: C.texto3 }}>{cifra(c.decimoCuartoAnual / div)}</td>
                          <td className={celdaNum} style={{ color: C.texto, fontWeight: 600 }}>{cifra(c.costoTotalAnual / div)}</td>
                          <td className="text-center"><BotonF abierto={formulaAbierta === id} onClick={() => setFormulaAbierta(formulaAbierta === id ? null : id)} /></td>
                        </tr>
                        {formulaAbierta === id && (
                          <FilaPanel colSpan={10}>
                            <div className="text-[11px] flex flex-col gap-0.5" style={{ color: C.texto2 }}>
                              <p>Básico proyectado = {usd(e.basico_2025)} × (1 + {(e.incremento_pct * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %) = {usd(c.basico2026)}</p>
                              <p>Total anual (base) = sueldo {usd(c.basico2026)} × 12 + movilización {usd(e.movilizacion_anual)} = {usd(c.totalAnual)}</p>
                              <p>IESS patronal = {usd(c.totalAnual)} × {pctTxt(TASAS.iess_patronal)} = {usd(c.iessPatronalAnual)} ({usd(c.iessPatronalAnual / 12)} al mes) · Fondo de reserva = {usd(c.totalAnual)} × {pctTxt(TASAS.fondo_reserva)} = {usd(c.fondoReservaAnual)} ({usd(c.fondoReservaAnual / 12)} al mes)</p>
                              <p>Décimo 3.º = un mes de sueldo: {usd(c.totalAnual)} ÷ 12 = {usd(c.decimoTerceroAnual)} ({usd(c.decimoTerceroAnual / 12)} al mes) · Décimo 4.º = 1 SBU = {usd(c.decimoCuartoAnual)} ({usd(c.decimoCuartoAnual / 12)} al mes)</p>
                              <p style={{ color: C.texto }}><b>Costo total anual = {usd(c.totalAnual)} + {usd(c.iessPatronalAnual)} + {usd(c.fondoReservaAnual)} + {usd(c.decimoTerceroAnual)} + {usd(c.decimoCuartoAnual)} = {usd(c.costoTotalAnual)}</b> ({usd(c.costoTotalAnual / 12)} al mes)</p>
                            </div>
                          </FilaPanel>
                        )}
                      </Fragment>
                    );
                  })}
                  {agregandoEmpleado && !esConsolidado && (
                    <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                      <td className="pl-4 pr-2">
                        <span className="flex items-center gap-1">
                          <input placeholder="Nombre" value={nuevoEmp.nombre} autoFocus onChange={(e) => setNuevoEmp((p) => ({ ...p, nombre: e.target.value }))} className="w-full text-[11px] rounded px-1.5 py-1 bg-white" style={INPUT_STYLE} />
                          <Accion onClick={() => { if (!guardando) guardarNuevoEmpleado(); }} titulo={guardando ? "Guardando…" : "Guardar"} activo><Check size={14} /></Accion>
                          <Accion onClick={() => { setAgregandoEmpleado(false); setErrorGuardar(null); }} titulo="Cancelar"><X size={14} /></Accion>
                        </span>
                      </td>
                      <td className="px-1"><CampoMonto placeholder="Básico" etiqueta="Básico" value={nuevoEmp.basico} onChange={(v) => setNuevoEmp((p) => ({ ...p, basico: v }))} className={INPUT} style={INPUT_STYLE} /></td>
                      <td className="px-1"><CampoMonto placeholder="4" etiqueta="Incremento en %" value={nuevoEmp.incremento} onChange={(v) => setNuevoEmp((p) => ({ ...p, incremento: v }))} className={INPUT} style={INPUT_STYLE} /></td>
                      <td colSpan={5} className="px-2 text-[10px] italic" style={{ color: C.tenue, ...F_TEXTO }}>
                        <span className="flex items-center gap-2">
                          Movilización anual
                          <CampoMonto value={nuevoEmp.movilizacion} placeholder="0" etiqueta="Movilización anual" onChange={(v) => setNuevoEmp((p) => ({ ...p, movilizacion: v }))} className="w-24 text-right text-[11px] rounded px-1 py-1 bg-white not-italic" style={{ ...INPUT_STYLE, ...F_TABLA }} />
                          · se calcula al guardar
                        </span>
                      </td>
                      <td />
                      <td />
                    </tr>
                  )}
                  <tr style={{ borderTop: "1px solid #B9C3BD", height: 34, fontWeight: 600, color: C.texto }}>
                    <td className="pl-4 font-bold">Total planilla ({empleados.length} empleados)</td>
                    <td className={celdaNum}>{cifra(totalesNomina.basico)}</td>
                    <td />
                    <td className={celdaNum}>{cifra(totalesNomina.basico2026)}</td>
                    <td className={celdaNum}>{cifra(totalesNomina.iess / div)}</td>
                    <td className={celdaNum}>{cifra(totalesNomina.fondo / div)}</td>
                    <td className={celdaNum}>{cifra(totalesNomina.dec3 / div)}</td>
                    <td className={celdaNum}>{cifra(totalesNomina.dec4 / div)}</td>
                    <td className={celdaNum}>{cifra(totalesNomina.costo / div)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          {/* -------- Resumen -------- */}
          {sub4501 === "resumen" && (cargandoResumen4501 ? <Cargando /> : (
            <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
              <table className={TABLA} style={F_TABLA}>
                <Columnas acciones={false} />
                <Cabecera titulo={`Resumen 4501 · ${agencia}`} ejercicio={ejercicio} acciones={false} />
                <tbody>
                  {rubros4501.map((r, idx) => {
                    const id = `rub-${idx}`;
                    return (
                      <Fragment key={r.nombre}>
                        <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                          <td className="pl-4 pr-2"><NombreCuenta codigo={CUENTA_RUBRO_4501[idx] === "4501" ? "4501 otras" : CUENTA_RUBRO_4501[idx]} label={r.nombre} ancho={64} /></td>
                          {ver(r.montosPorMes).map((v, i) => <Celda key={i} v={v} />)}
                          <Celda v={suma(r.montosPorMes)} fuerte />
                          <td className="text-center"><BotonF abierto={formulaAbierta === id} onClick={() => setFormulaAbierta(formulaAbierta === id ? null : id)} /></td>
                        </tr>
                        {formulaAbierta === id && (
                          <FilaPanel colSpan={COLS_TOTALES(false)}>
                            <SelectorMes mes={mesFormula} onMes={setMesFormula} />
                            <p className="text-[11px]" style={{ color: C.texto2 }}>{explicacionRubro(idx, rubros4501, extras4501, numeroEmpleados4501, mesFormula)}</p>
                          </FilaPanel>
                        )}
                      </Fragment>
                    );
                  })}
                  <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
                    <td className="pl-4 font-bold" style={{ color: C.texto }}><NombreCuenta codigo="4501" label="Total gastos de personal" ancho={64} estilo={{ color: C.texto, fontWeight: 700 }} /></td>
                    {ver(totalPorMes4501).map((v, i) => <Celda key={i} v={v} fuerte />)}
                    <Celda v={suma(totalPorMes4501)} fuerte />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          {/* -------- Gastos detallados (Talento Humano) -------- */}
          {sub4501 === "detalle" && (cargandoDetalle4501 ? <Cargando /> : (
            <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
              <table className={TABLA} style={F_TABLA}>
                <Columnas acciones={false} />
                <Cabecera titulo="Talento Humano" ejercicio={ejercicio} acciones={false} />
                <tbody>
                  {grupos4501.map((g) => {
                    const abierto = !cerrados4501.has(g.codigo);
                    return (
                      <Fragment key={g.codigo}>
                        <tr className="hover:bg-[#F5F7F6] cursor-pointer" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }} onClick={() => setCerrados4501((p) => { const n = new Set(p); if (n.has(g.codigo)) n.delete(g.codigo); else n.add(g.codigo); return n; })}>
                          <td className="pl-1">
                            <span className="flex items-center">
                              <button type="button" aria-expanded={abierto} aria-label={`${abierto ? "Contraer" : "Expandir"} ${g.codigo}`} className="w-5 h-5 flex items-center justify-center shrink-0" style={{ color: C.tenue }}>
                                <ChevronRight size={13} style={{ transform: abierto ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
                              </button>
                              <NombreCuenta codigo={g.codigo} label={g.nombre} ancho={58} estilo={{ color: C.texto, fontWeight: abierto ? 600 : 500 }} />
                            </span>
                          </td>
                          {ver(g.valores).map((v, i) => <Celda key={i} v={v} fuerte={abierto} />)}
                          <Celda v={suma(g.valores)} fuerte />
                          <td />
                        </tr>
                        {abierto && g.lineas.map((l) => {
                    const enEdicion = !esConsolidado && editandoDetalle === l.concepto;
                    const id = `det-${l.concepto}`;
                    return (
                      <Fragment key={l.concepto}>
                        <tr className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                          <td className="pl-9 relative">
                            <NombreCuenta codigo={l.concepto} label={l.cuenta_nombre ?? ""} ancho={64} />
                            {enEdicion ? (
                              <AccionesFila fijo>
                                <Accion onClick={() => { if (!guardando) guardarEdicionDetalle(l); }} titulo={guardando ? "Guardando…" : "Guardar"} activo><Check size={14} /></Accion>
                                <Accion onClick={() => { setEditandoDetalle(null); setErrorGuardar(null); }} titulo="Cancelar"><X size={14} /></Accion>
                              </AccionesFila>
                            ) : !esConsolidado && (
                              <AccionesFila>
                                <Accion onClick={() => { setFormulaAbierta(null); setErrorGuardar(null); setEditandoDetalle(l.concepto); setEditDetalleMontos(l.montosPorMes.map((v) => textoEditable(v))); }} titulo="Editar montos"><Pencil size={13} /></Accion>
                                <Accion peligro titulo="Eliminar" onClick={() => setConfirmacion({ mensaje: `¿Eliminar "${l.concepto} ${l.cuenta_nombre ?? ""}" (12 meses)?`, accion: () => eliminarDetalle(l) })}><Trash2 size={13} /></Accion>
                              </AccionesFila>
                            )}
                          </td>
                          {l.montosPorMes.map((v, i) => enEdicion ? (
                            <td key={i} className="px-0.5"><CampoMonto value={editDetalleMontos[i]} etiqueta={`Monto de ${MESES[i]}`} onChange={(v) => setEditDetalleMontos((p) => p.map((x, j) => (j === i ? v : x)))} className={INPUT} style={INPUT_STYLE} /></td>
                          ) : <Celda key={i} v={ver(l.montosPorMes)[i]} />)}
                          <Celda v={enEdicion ? sumaTextos(editDetalleMontos) : suma(l.montosPorMes)} fuerte />
                          <td className="text-center"><BotonF abierto={formulaAbierta === id} onClick={() => setFormulaAbierta(formulaAbierta === id ? null : id)} /></td>
                        </tr>
                        {enEdicion && (
                          <FilaPanel colSpan={cols}>
                            <div className="flex items-center gap-4 text-[11px]">
                              <button onClick={() => setEditDetalleMontos((p) => Array(12).fill(p[0] || "0"))} className="hover:underline" style={{ color: C.acento }}>Repetir enero en los 12 meses</button>
                              <button onClick={() => setEditDetalleMontos(Array(12).fill("0"))} className="hover:underline" style={{ color: C.alerta }}>Poner los 12 meses en 0</button>
                              <MensajeError texto={errorGuardar} />
                            </div>
                          </FilaPanel>
                        )}
                        {formulaAbierta === id && (
                          <FilaPanel colSpan={cols}>
                            <p className="text-[11px]" style={{ color: C.texto2 }}>{esConsolidado ? "Suma de lo cargado en Talento Humano por las 10 agencias." : "Monto directo cargado a mano en Talento Humano; no depende de otra cuenta."} Total anual {usd(suma(l.montosPorMes))}.</p>
                          </FilaPanel>
                        )}
                      </Fragment>
                    );
                  })}
                      </Fragment>
                    );
                  })}
                  {agregandoDetalle && !esConsolidado && (
                    <tr style={{ borderTop: `1px solid ${C.beige}` }}>
                      <td className="pl-4 pr-2 py-1.5">
                        <div className="flex flex-col gap-1">
                          <input placeholder="Código" value={nuevoDetalleCodigo} autoFocus onChange={(e) => setNuevoDetalleCodigo(e.target.value)} className="w-full text-[11px] rounded px-1.5 py-1 bg-white" style={INPUT_STYLE} />
                          <input placeholder="Nombre de cuenta" value={nuevoDetalleNombre} onChange={(e) => setNuevoDetalleNombre(e.target.value)} className="w-full text-[11px] rounded px-1.5 py-1 bg-white" style={{ ...INPUT_STYLE, ...F_TEXTO }} />
                          <input placeholder="Hoja (ej. Talento Humano)" value={nuevoDetalleHoja} onChange={(e) => setNuevoDetalleHoja(e.target.value)} className="w-full text-[11px] rounded px-1.5 py-1 bg-white" style={{ ...INPUT_STYLE, ...F_TEXTO }} />
                          <span className="flex items-center justify-end gap-0.5">
                            <Accion onClick={() => { if (!guardando) guardarNuevoDetalle(); }} titulo={guardando ? "Guardando…" : "Guardar"} activo><Check size={14} /></Accion>
                            <Accion onClick={() => { setAgregandoDetalle(false); setErrorGuardar(null); }} titulo="Cancelar"><X size={14} /></Accion>
                          </span>
                        </div>
                      </td>
                      {nuevoDetalleMontos.map((v, i) => (
                        <td key={i} className="px-0.5"><CampoMonto value={v} placeholder="0" etiqueta={`Monto de ${MESES[i]}`} onChange={(x) => setNuevoDetalleMontos((p) => p.map((y, j) => (j === i ? x : y)))} className={INPUT} style={INPUT_STYLE} /></td>
                      ))}
                      <Celda v={sumaTextos(nuevoDetalleMontos)} fuerte />
                      <td />
                    </tr>
                  )}
                  <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
                    <td className="pl-4 font-bold" style={{ color: C.texto }}><NombreCuenta codigo="4501" label="Total cargado en Talento Humano" ancho={64} estilo={{ color: C.texto, fontWeight: 700 }} /></td>
                    {ver(MESES.map((_, i) => suma(detalle4501.map((l) => l.montosPorMes[i])))).map((v, i) => <Celda key={i} v={v} fuerte />)}
                    <Celda v={suma(detalle4501.map((l) => suma(l.montosPorMes)))} fuerte />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {grupoActivo === "4505" && (cargandoER ? <Cargando /> : (
        <TablaCalculada
          titulo={`Depreciaciones · ${agencia}`}
          raiz={buscarNodo(egresos, "4505")}
          ejercicio={ejercicio}
          vacio="El Estado de resultados todavía no trae la cuenta 4505 para esta agencia. Revisa el registro en Activos fijos."
          formula={(n, mes) => `${n.codigo} ${n.label}: calculado por el motor de Activos fijos (saldo depreciable de cada bien × factor anual ÷ 12, más las compras del Plan de adquisiciones). ${MESES[mes]} = ${usd(n.valores[mes] ?? 0)}. Se edita en Activos fijos.`}
        />
      ))}

      {grupoActivo === "4506" && (cargandoER ? <Cargando /> : (
        <TablaCalculada
          titulo={`Amortizaciones · ${agencia}`}
          raiz={buscarNodo(egresos, "4506")}
          ejercicio={ejercicio}
          vacio="El Estado de resultados todavía no trae la cuenta 4506 para esta agencia."
          formula={(n, mes) => `${n.codigo} ${n.label}: amortización de gastos y pagos anticipados, igual a las salidas de la cuenta 1904 que se editan en Otros activos → Gastos anticipados. ${MESES[mes]} = ${usd(n.valores[mes] ?? 0)}.`}
        />
      ))}

      {grupoActivo !== "4501" && grupoActivo !== "4505" && grupoActivo !== "4506" && esConsolidado && (cargandoER ? <Cargando /> : (
        <ResumenConsolidado grupo={grupoActivo} etiqueta={grupoInfo.label} nodo={buscarNodo(egresos, grupoActivo)} ejercicio={ejercicio} />
      ))}

      {grupoActivo === "4504" && !esConsolidado && <Contribuciones4504 agencia={agencia} ejercicio={ejercicio} onCambio={refrescar} />}

      {grupoActivo !== "4501" && grupoActivo !== "4504" && grupoActivo !== "4505" && grupoActivo !== "4506" && !esConsolidado && (
        <HojasGrupo key={grupoActivo} grupo={grupoActivo} agencia={agencia} ejercicio={ejercicio} activos={activos} onCambio={refrescar} onExport={setFilasExport}
                    etiqueta={grupoInfo.label} nodoER={buscarNodo(egresos, grupoActivo)} calculadas={calculadas} />
      )}

      {confirmacion && !esConsolidado && <Confirmacion mensaje={confirmacion.mensaje} onSi={confirmacion.accion} onNo={() => setConfirmacion(null)} />}
    </div>
  );
}

export default function GastosOperacionalesPage() {
  return (
    <Suspense fallback={<div className="estilo-institucional min-h-screen px-6 py-6" style={{ background: "#EEF1EF" }}><EsqueletoTabla filas={10} /></div>}>
      <GastosOperacionalesContenido />
    </Suspense>
  );
}

/** Consolidado de un grupo con hojas: el mismo árbol del Resumen, armado con las cuentas del Estado de resultados de las 10 agencias. */
function ResumenConsolidado({ grupo, etiqueta, nodo, ejercicio }: { grupo: string; etiqueta: string; nodo: Nodo | null; ejercicio: number }) {
  const [expandido, setExpandido] = useState(false);
  const hojasDe = (n: Nodo): Nodo[] => (n.hijos?.length ? n.hijos.flatMap(hojasDe) : [n]);
  const lineas = nodo?.hijos?.length ? nodo.hijos.flatMap(hojasDe).map((n) => ({ concepto: n.codigo, cuenta_nombre: n.label, montosPorMes: n.valores })) : [];
  return (
    <div className="bg-white rounded-xl flex flex-col" style={{ border: `1px solid ${C.borde}`, ...F_TEXTO }}>
      <div className="flex items-center gap-2 px-4 min-h-[48px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <span className="flex-1 text-[13px] font-semibold" style={{ color: C.texto }}>Resumen · Consolidado</span>
        {lineas.length > 1 && (
          <button type="button" onClick={() => setExpandido((x) => !x)} aria-pressed={expandido}
                  className="h-8 px-3 rounded-lg bg-white hover:bg-[#F3F5F4] text-[12.5px] flex items-center gap-1.5" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}>
            {expandido ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {expandido ? "Contraer" : "Expandir"}</button>
        )}
      </div>
      {lineas.length ? <ResumenArbol key={String(expandido)} expandido={expandido} grupo={grupo} etiqueta={etiqueta} ejercicio={ejercicio} nodoER={nodo} lineas={lineas} />
        : <p className="text-[12px] px-4 py-6" style={{ color: C.texto2 }}>El Estado de resultados consolidado todavía no trae la cuenta {grupo}.</p>}
    </div>
  );
}
