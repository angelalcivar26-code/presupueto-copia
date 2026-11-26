"use client";

import { conEjercicioEnUso } from "./seleccion";
import { useEffect, useState, useSyncExternalStore } from "react";

// =====================================================================
// MEMORIA DE LA HERRAMIENTA (navegador) Y SINCRONIZACIÓN CON LA BASE
// =====================================================================
// 1. Al abrir la herramienta se precarga en memoria todo lo de la agencia en uso (todas las
//    secciones y pestañas). Al cambiar de agencia, se precarga la nueva.
// 2. Las pantallas se atienden desde la memoria: abren al instante.
// 3. Guardar algo lo graba en la base en ese momento y la pantalla abierta muestra el dato nuevo.
//    Las demás pantallas se recalculan cuando se abren (no se recarga todo en cada guardado).
// 4. Cada 30 minutos (y al volver a la pestaña después de 5 min) se pregunta a la base, con una
//    sola fila, si algo cambió. Solo si cambió se recarga la memoria.
// 5. El botón Sincronizar recarga todo a mano cuando se quiera.
// Las rutas que se precargan se aprenden solas: cada pantalla que se abre queda anotada y la
// próxima vez se precarga para la agencia en uso.
// =====================================================================

type EstadoSync = "inicial" | "cargando_cache" | "sincronizado" | "pendiente" | "sincronizando";

interface InfoSincronizacion {
  estado: EstadoSync;
  ultimaSincronizacion: number | null;
  proximaRevision: number | null;
  cambiosPendientes: number;
  ultimoCambioTexto: string | null;
  totalConsultasEnCache: number;
  mensaje: string;
  versionDatos: number | null;
  agencia: string;
}

interface EntradaCache { status: number; body: string; tipo: string; t: number }

const cacheRespuestas = new Map<string, EntradaCache>();
const cacheJSON = new Map<string, unknown>();

// ---------------------------------------------------------------------
// Memoria guardada en este navegador (IndexedDB): sobrevive a cerrar y abrir la herramienta.
// Al abrir, si la versión de los datos en la base es la misma que la guardada, todo se toma de
// aquí sin consultar la base (solo se pregunta la versión: 1 fila).
// ---------------------------------------------------------------------
const IDB_NOMBRE = "presupuesto2027-memoria-v2";
const IDB_ANTERIOR = "presupuesto2027-memoria"; // versión anterior (se borra: podía tener páginas HTML guardadas)
const IDB_TABLA = "respuestas";
const CLAVE_META = "__meta__";
// Versión del programa (marca de la compilación): lo guardado por otra versión no se reutiliza,
// porque una versión nueva puede calcular distinto o devolver otros campos.
const VERSION_PROGRAMA = process.env.VERSION_BUILD || "local";
let idbPromesa: Promise<IDBDatabase | null> | null = null;

function abrirIDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  if (!idbPromesa) {
    try { window.indexedDB.deleteDatabase(IDB_ANTERIOR); } catch { /* ignorar */ }
    idbPromesa = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(IDB_NOMBRE, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(IDB_TABLA); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return idbPromesa;
}

const pendientesIDB = new Map<string, unknown>();
let temporizadorIDB: ReturnType<typeof setTimeout> | null = null;
function persistir(clave: string, valor: unknown) {
  if (typeof window === "undefined") return;
  pendientesIDB.set(clave, valor);
  if (temporizadorIDB) clearTimeout(temporizadorIDB);
  temporizadorIDB = setTimeout(async () => {
    const db = await abrirIDB();
    if (!db) return;
    try {
      const tx = db.transaction(IDB_TABLA, "readwrite");
      const st = tx.objectStore(IDB_TABLA);
      for (const [k, v] of pendientesIDB) st.put(v, k);
      pendientesIDB.clear();
    } catch { /* sin almacenamiento: solo memoria de la sesión */ }
  }, 400);
}
async function borrarIDB() {
  pendientesIDB.clear();
  const db = await abrirIDB();
  if (!db) return;
  try { db.transaction(IDB_TABLA, "readwrite").objectStore(IDB_TABLA).clear(); } catch { /* ignorar */ }
}
async function leerIDB(): Promise<{ version: number | null; t: number | null; entradas: [string, EntradaCache][] }> {
  const db = await abrirIDB();
  if (!db) return { version: null, t: null, entradas: [] };
  return new Promise((resolve) => {
    try {
      const st = db.transaction(IDB_TABLA, "readonly").objectStore(IDB_TABLA);
      const entradas: [string, EntradaCache][] = [];
      let version: number | null = null;
      let t: number | null = null;
      const cur = st.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve({ version, t, entradas }); return; }
        if (c.key === CLAVE_META) {
          const meta = c.value as { version?: number; programa?: string };
          version = meta?.programa === VERSION_PROGRAMA ? meta?.version ?? null : null;
          t = (c.value as { t?: number })?.t ?? null;
        }
        else entradas.push([String(c.key), c.value as EntradaCache]);
        c.continue();
      };
      cur.onerror = () => resolve({ version: null, t: null, entradas: [] });
    } catch {
      resolve({ version: null, t: null, entradas: [] });
    }
  });
}
function guardarVersionLocal(version: number | null, t = Date.now()) {
  if (version !== null) persistir(CLAVE_META, { version, t, programa: VERSION_PROGRAMA });
}

// Las pantallas esperan (como máximo 1,2 s) a que se decida si se usa la memoria guardada,
// para no ir a la base por algo que ya está guardado en el navegador.
let avisarLista: () => void = () => undefined;
const memoriaLista: Promise<void> = new Promise((r) => { avisarLista = r; });
let listaResuelta = false;
function marcarLista() { if (!listaResuelta) { listaResuelta = true; avisarLista(); } }
export function esperarMemoria(): Promise<void> {
  if (listaResuelta || typeof window === "undefined") return Promise.resolve();
  return Promise.race([memoriaLista, new Promise<void>((r) => setTimeout(r, 1200))]);
}

const REVISION_MS = 30 * 60 * 1000;      // revisión automática
const REVISION_AL_VOLVER_MS = 5 * 60 * 1000;

/** Estado con el que se dibuja en el servidor y en la primera pasada del navegador (deben ser iguales). */
const ESTADO_INICIAL: InfoSincronizacion = {
  estado: "inicial",
  ultimaSincronizacion: null,
  proximaRevision: null,
  cambiosPendientes: 0,
  ultimoCambioTexto: null,
  totalConsultasEnCache: 0,
  mensaje: "Iniciando memoria de la herramienta...",
  versionDatos: null,
  agencia: "Consolidado", // las secciones abren en el Consolidado
};
let estadoActual: InfoSincronizacion = ESTADO_INICIAL;

const subscriptores = new Set<() => void>();
function emitirCambio(parcial?: Partial<InfoSincronizacion>) {
  estadoActual = { ...estadoActual, ...parcial, totalConsultasEnCache: cacheRespuestas.size };
  subscriptores.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } });
}
function obtenerEstadoSincronizacion(): InfoSincronizacion { return estadoActual; }
function suscribirEstadoSincronizacion(callback: () => void): () => void {
  subscriptores.add(callback);
  return () => subscriptores.delete(callback);
}

// fetch "crudo" (sin pasar por la memoria): lo registra lib/useDatos.ts al instalarse.
let fetchCrudo: typeof fetch = (...a) => fetch(...a);
export function registrarFetchCrudo(f: typeof fetch) { fetchCrudo = f; }

// --- Acceso directo a la memoria ---
export function obtenerRespuestaCache(clave: string): EntradaCache | undefined { return cacheRespuestas.get(conEjercicioEnUso(clave)); }
export function guardarRespuestaCache(clave: string, valor: { status: number; body: string; tipo: string }): void {
  clave = conEjercicioEnUso(clave);
  if (!/^\s*[[{]/.test(valor.body)) return; // solo JSON
  const e = { status: valor.status, body: valor.body, tipo: valor.tipo, t: Date.now() };
  cacheRespuestas.set(clave, e);
  persistir(clave, e);
}
export function tieneRespuestaCache(clave: string): boolean { return cacheRespuestas.has(conEjercicioEnUso(clave)); }
export function obtenerJSONCache<T = unknown>(clave: string): T | undefined { return cacheJSON.get(conEjercicioEnUso(clave)) as T | undefined; }
export function guardarJSONCache(clave: string, valor: unknown): void {
  clave = conEjercicioEnUso(clave);
  // Siempre se reemplaza: lo que llega aquí es la respuesta más reciente del servidor.
  cacheJSON.set(clave, valor);
  try {
    const e = { status: 200, body: JSON.stringify(valor), tipo: "application/json", t: Date.now() };
    cacheRespuestas.set(clave, e);
    persistir(clave, e);
  } catch { /* ignorar */ }
}
export function limpiarMemoriaCache(): void {
  cacheRespuestas.clear();
  cacheJSON.clear();
  borrarIDB().catch(() => undefined);
  emitirCambio();
}

// =====================================================================
// RUTAS A PRECARGAR: base conocida + las que se aprenden al navegar
// =====================================================================
// {A} = agencia. Deben escribirse igual que las piden las pantallas.
const RUTAS_BASE: string[] = [
  "/api/ejercicios",
  "/api/activos-por-agencia",
  "/api/departamentos",
  "/api/factores-depreciacion",
  "/api/metas-credito-institucional",
  "/api/prestamos-internos",
  "/api/balance-general?agencia={A}",
  "/api/estado-resultados?agencia={A}",
  "/api/flujo-efectivo?agencia={A}",
  "/api/cartera-credito?agencia={A}",
  "/api/oficiales-credito?agencia={A}",
  "/api/parametros-credito?agencia={A}",
  "/api/parametros-produccion?agencia={A}",
  "/api/parametros-provision?agencia={A}",
  "/api/captaciones?agencia={A}",
  "/api/parametros-captaciones?agencia={A}",
  "/api/inversiones?agencia={A}",
  "/api/activos-fijos?agencia={A}",
  "/api/otros-activos-detalle?agencia={A}",
  "/api/pasivo-detalle?agencia={A}",
  "/api/patrimonio-detalle?agencia={A}",
  "/api/ingresos-51?agencia={A}",
  "/api/ingresos-cartera-detalle?agencia={A}",
  "/api/nomina-empleados?agencia={A}",
  "/api/resumen-4501?agencia={A}",
];

const CLAVE_RUTAS = "presupuesto2027.rutas";
const NO_APRENDER = /[?&](id|q|nombre|fechaCorte|mes|anio)=/;
const rutasAprendidas = new Set<string>();
let rutasLeidas = false;

function leerRutas() {
  if (rutasLeidas || typeof window === "undefined") return;
  rutasLeidas = true;
  try {
    const guardadas = JSON.parse(window.localStorage.getItem(CLAVE_RUTAS) ?? "[]");
    if (Array.isArray(guardadas)) guardadas.slice(0, 300).forEach((r) => typeof r === "string" && rutasAprendidas.add(r));
  } catch { /* sin almacenamiento: se usan solo las rutas base */ }
}
let temporizadorRutas: ReturnType<typeof setTimeout> | null = null;
function guardarRutas() {
  if (temporizadorRutas) clearTimeout(temporizadorRutas);
  temporizadorRutas = setTimeout(() => {
    try { window.localStorage.setItem(CLAVE_RUTAS, JSON.stringify([...rutasAprendidas].slice(0, 300))); } catch { /* ignorar */ }
  }, 1500);
}

/** Convierte una dirección pedida en un patrón con {A} en lugar de la agencia (null = no se aprende). */
function patronDe(clave: string): string | null {
  if (!clave.startsWith("/api/") || clave.startsWith("/api/sincronizar") || clave.startsWith("/api/esquema")) return null;
  if (NO_APRENDER.test(clave)) return null;
  // sin el año: la precarga usa siempre el ejercicio en uso (conEjercicioEnUso)
  return clave.replace(/([?&]agencia=)[^&]*/, "$1{A}").replace(/([?&])ejercicio=\d+(&|$)/, (_m, a, b) => (b ? a : "")).replace(/[?&]$/, "");
}

/** Lo llama lib/useDatos.ts con cada GET que se responde bien: anota la ruta y la agencia en uso. */
export function registrarConsulta(clave: string) {
  leerRutas();
  const patron = patronDe(clave);
  if (patron && !RUTAS_BASE.includes(patron) && !rutasAprendidas.has(patron)) {
    rutasAprendidas.add(patron);
    guardarRutas();
  }
  const m = clave.match(/[?&]agencia=([^&]*)/);
  if (m) {
    let agencia = m[1];
    try { agencia = decodeURIComponent(agencia); } catch { /* se deja como vino */ }
    if (agencia && agencia !== estadoActual.agencia) {
      emitirCambio({ agencia });
      programarPrecarga();
    }
  }
}

function rutasParaAgencia(agencia: string): string[] {
  leerRutas();
  const a = encodeURIComponent(agencia);
  // Las aprendidas se limitan a las 40 más recientes, para que la precarga no crezca sin control.
  const aprendidas = [...rutasAprendidas].slice(-40);
  const rutas = [...new Set([...RUTAS_BASE, ...aprendidas])];
  // En Consolidado no hay parámetros (son por agencia): no se precargan esas rutas
  return (agencia === "Consolidado" ? rutas.filter((p) => !/\/api\/parametros-/.test(p)) : rutas).map((p) => p.replace("{A}", a));
}

async function cargarUnaRuta(url: string) {
  url = conEjercicioEnUso(url);
  if (cacheRespuestas.has(url)) return;
  try {
    const res = await fetchCrudo(url, { cache: "no-store" });
    if (!res.ok || res.headers.get("x-lectura-parcial")) return; // un cálculo con lecturas fallidas no se guarda
    const body = await res.text();
    const tipo = res.headers.get("content-type") ?? "application/json";
    if (!/json/i.test(tipo) || !/^\s*[[{]/.test(body)) return; // nunca guardar una página HTML
    const e = { status: res.status, body, tipo, t: Date.now() };
    cacheRespuestas.set(url, e);
    persistir(url, e);
    try { cacheJSON.set(url, JSON.parse(body)); } catch { /* no es JSON */ }
  } catch (e) {
    console.warn(`[memoria] no se pudo precargar ${url}`, e);
  }
}

/**
 * Precarga las rutas de una agencia por detrás.
 * RENDIMIENTO (sep-2026):
 *  - En la vista previa de AI Studio (modo desarrollo) NO se precarga: cada ruta obliga al servidor a
 *    compilar y calcular, y ~25 rutas juntas provocaban "Rate exceeded" y pantallas sin estilos.
 *    Allí cada pantalla carga lo suyo al abrirse.
 *  - En la versión publicada se precarga DE A UNA, con una pausa corta, y solo con la pestaña visible:
 *    nunca compite con la pantalla que el usuario está abriendo. Como el servidor ya guarda en Turso
 *    los resultados calculados (lib/cache-persistente.ts), cada ruta suele costar 1 fila.
 */
const PAUSA_PRECARGA_MS = 250;
let precargaEnCurso: string | null = null;
async function precargarAgencia(agencia: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") { emitirCambio(); return; }
  if (precargaEnCurso === agencia) return;
  precargaEnCurso = agencia;
  try {
    const urls = rutasParaAgencia(agencia).filter((u) => !cacheRespuestas.has(u));
    for (const url of urls) {
      if (estadoActual.agencia !== agencia) break; // cambió la agencia: se precarga la nueva
      if (typeof document !== "undefined" && document.visibilityState === "hidden") break;
      await cargarUnaRuta(url);
      await new Promise((r) => setTimeout(r, PAUSA_PRECARGA_MS));
    }
  } finally {
    precargaEnCurso = null;
    emitirCambio();
  }
}

let temporizadorPrecarga: ReturnType<typeof setTimeout> | null = null;
function programarPrecarga(ms = 3000) {
  if (typeof window === "undefined") return;
  if (temporizadorPrecarga) clearTimeout(temporizadorPrecarga);
  temporizadorPrecarga = setTimeout(() => { precargarAgencia(estadoActual.agencia).catch(() => undefined); }, ms);
}

// =====================================================================
// VERSIÓN DE LOS DATOS (1 fila) Y SINCRONIZACIÓN
// =====================================================================
/** Versión de los datos (1 fila). Si el servidor no responde en 5 s, se sigue sin esperar (null). */
async function leerVersionServidor(): Promise<number | null> {
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetchCrudo("/api/sincronizar", { cache: "no-store", signal: ctrl.signal });
    const d = await r.json();
    return typeof d.version === "number" ? d.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(limite);
  }
}

let cargandoPromesa: Promise<void> | null = null;

/**
 * Al abrir la herramienta (sin mostrar nada en pantalla):
 * 1. Pregunta a la base la versión de los datos (1 fila).
 * 2. Si coincide con la guardada en este navegador, usa todo lo guardado: no se consulta nada más.
 * 3. Si no coincide (alguien guardó algo), borra lo guardado y precarga de nuevo por detrás.
 * En ambos casos completa por detrás lo que falte de la agencia en uso.
 */
export async function cargarBaseDeDatosEnCache(forzar = false): Promise<void> {
  if (cargandoPromesa && !forzar) return cargandoPromesa;
  if (!forzar && estadoActual.estado === "sincronizado" && cacheRespuestas.size >= 5) return;

  emitirCambio({ estado: "cargando_cache", mensaje: "Preparando los datos..." });
  cargandoPromesa = (async () => {
    try {
      const [version, guardado] = await Promise.all([leerVersionServidor(), forzar ? Promise.resolve({ version: null, t: null, entradas: [] as [string, EntradaCache][] }) : leerIDB()]);
      const vigente = !forzar && version !== null && guardado.version === version && guardado.entradas.length > 0;
      if (vigente) {
        for (const [clave, e] of guardado.entradas) {
          if (!e || typeof e.body !== "string" || !/^\s*[[{]/.test(e.body)) continue;
          cacheRespuestas.set(clave, e);
          try { cacheJSON.set(clave, JSON.parse(e.body)); } catch { /* no es JSON */ }
        }
      } else if (!forzar) {
        await borrarIDB();
      }
      const ahora = Date.now();
      const desde = vigente && guardado.t ? guardado.t : ahora;
      guardarVersionLocal(version, desde);
      marcarLista();
      // La precarga espera 2 s: primero se atienden los pedidos de la pantalla que se está abriendo.
      await new Promise((r) => setTimeout(r, 2000));
      await precargarAgencia(estadoActual.agencia);
      emitirCambio({
        estado: "sincronizado", ultimaSincronizacion: desde,
        proximaRevision: ahora + REVISION_MS, cambiosPendientes: 0, versionDatos: version, mensaje: "Datos al día.",
      });
      window.dispatchEvent(new CustomEvent("cache-sincronizado", { detail: { timestamp: ahora } }));
    } catch (e) {
      console.error("[memoria] error preparando los datos", e);
      marcarLista();
      emitirCambio({ estado: "sincronizado", mensaje: "Datos disponibles." });
    } finally {
      cargandoPromesa = null;
    }
  })();
  return cargandoPromesa;
}

/**
 * Sincroniza: borra la memoria del navegador y la vuelve a cargar desde la base.
 * `manual` (botón): además avisa al servidor que renueve su propia memoria, por si algo se
 * cambió directamente en Turso, fuera de la herramienta.
 */
async function sincronizarBaseDeDatos(manual = true): Promise<{ ok: boolean; mensaje: string }> {
  emitirCambio({ estado: "sincronizando", mensaje: "Sincronizando con la base de datos..." });
  try {
    if (manual) await fetchCrudo("/api/sincronizar", { method: "POST", cache: "no-store" });
    limpiarMemoriaCache();
    await cargarBaseDeDatosEnCache(true);
    emitirCambio({ ultimoCambioTexto: null, mensaje: "Base de datos sincronizada. Datos actualizados." });
    window.dispatchEvent(new CustomEvent("herramienta-actualizada", { detail: { timestamp: Date.now() } }));
    return { ok: true, mensaje: "Base de datos sincronizada y datos actualizados correctamente." };
  } catch (error) {
    console.error("[memoria] error al sincronizar", error);
    emitirCambio({ estado: "pendiente", mensaje: "No se pudo conectar con la base de datos." });
    return { ok: false, mensaje: "No se pudo completar la sincronización con la base de datos." };
  }
}

/** Pregunta (1 fila) si los datos cambiaron desde la última carga; solo si cambiaron, sincroniza. */
async function revisarCambios(): Promise<void> {
  if (estadoActual.estado === "cargando_cache" || estadoActual.estado === "sincronizando") return;
  const version = await leerVersionServidor();
  const ahora = Date.now();
  if (version !== null && estadoActual.versionDatos !== null && version !== estadoActual.versionDatos) {
    await sincronizarBaseDeDatos(false);
  } else {
    emitirCambio({ proximaRevision: ahora + REVISION_MS, versionDatos: version ?? estadoActual.versionDatos });
    guardarVersionLocal(version);
  }
  ultimaRevision = ahora;
}

let ultimaRevision = 0;
let revisionIniciada = false;
/** Revisión automática cada 30 min y al volver a la pestaña (si pasaron más de 5 min). */
export function iniciarRevisionAutomatica() {
  if (revisionIniciada || typeof window === "undefined") return;
  revisionIniciada = true;
  ultimaRevision = Date.now();
  window.setInterval(() => { revisarCambios().catch(() => undefined); }, REVISION_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - ultimaRevision > REVISION_AL_VOLVER_MS) {
      revisarCambios().catch(() => undefined);
    }
  });
}

/**
 * Lo llama lib/useDatos.ts después de cualquier guardado (la memoria ya se borró): anota la
 * versión nueva para que la revisión automática no vuelva a sincronizar, y precarga de nuevo
 * la agencia en uso por detrás, para que la navegación siga siendo instantánea.
 */
// AHORRO DE LECTURAS (oct-2026): antes, cada guardado volvía a pedir por detrás TODAS las
// pantallas de la agencia (~25 cálculos completos). Si se cambiaban 50 nombres, eran 50 recargas
// completas. Ahora, después de guardar:
//  - solo se recalcula la pantalla que está abierta (la propia pantalla vuelve a pedir su dato);
//  - las demás se calculan cuando se abren (una vez, y quedan en memoria);
//  - la versión de los datos se consulta una sola vez al terminar una ráfaga de guardados.
// Aplica a todo lo que se edita en la herramienta: sueldos, tasas, parámetros, montos, etc.
let temporizadorVersion: ReturnType<typeof setTimeout> | null = null;
export function despuesDeGuardar() {
  emitirCambio();
  if (temporizadorPrecarga) { clearTimeout(temporizadorPrecarga); temporizadorPrecarga = null; }
  if (temporizadorVersion) clearTimeout(temporizadorVersion);
  temporizadorVersion = setTimeout(() => {
    leerVersionServidor().then((v) => { if (v !== null) { emitirCambio({ versionDatos: v }); guardarVersionLocal(v); } }).catch(() => undefined);
  }, 3000);
}

/** Carga de datos: se subió o eliminó un archivo. La herramienta ya usa los datos nuevos. */
export function notificarCambioArchivo(tipo: "subida" | "eliminacion", detalle: string): void {
  emitirCambio({
    ultimoCambioTexto: detalle,
    mensaje: `Se ${tipo === "subida" ? "subió" : "eliminó"} ${detalle}. La herramienta ya usa los datos nuevos.`,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cambio-archivo-detectado", { detail: { tipo, detalle } }));
  }
}

// =====================================================================
// HOOKS DE REACT
// =====================================================================
export function useEstadoSincronizacion() {
  const info = useSyncExternalStore(suscribirEstadoSincronizacion, obtenerEstadoSincronizacion, () => ESTADO_INICIAL);
  return {
    ...info,
    sincronizar: () => sincronizarBaseDeDatos(true),
    esActivo: info.estado === "pendiente",
  };
}

/** Para que una pantalla vuelva a pedir sus datos cuando se sincroniza. */
export function useEscucharSincronizacion(onSincronizado?: () => void): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const handler = () => { setRevision((r) => r + 1); if (onSincronizado) onSincronizado(); };
    window.addEventListener("herramienta-actualizada", handler);
    return () => window.removeEventListener("herramienta-actualizada", handler);
  }, [onSincronizado]);
  return revision;
}