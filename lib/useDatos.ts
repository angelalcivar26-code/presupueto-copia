"use client";

import { useEffect, useRef, useState } from "react";
import { ejercicioEnUso } from "./seleccion";

import {
  obtenerRespuestaCache,
  guardarRespuestaCache,
  tieneRespuestaCache,
  obtenerJSONCache,
  guardarJSONCache,
  limpiarMemoriaCache,
  registrarFetchCrudo,
  registrarConsulta,
  despuesDeGuardar,
  esperarMemoria,
} from "./cache-sistema";

/**
 * Carga de datos para las pantallas: al instante desde la memoria y siempre coherente.
 *
 * - Lo que ya está en memoria (precargado o visto antes) se entrega al instante, sin ir a la base.
 * - Lo que no está se pide una vez al servidor y queda en memoria.
 * - Cualquier guardado (POST, PUT, PATCH, DELETE) borra la memoria en ese momento, así que después
 *   de guardar nunca se ven cifras anteriores; luego se vuelve a precargar sola por detrás.
 * - La memoria se renueva al sincronizar (botón o revisión automática cada 30 min, ver
 *   lib/cache-sistema.ts).
 */
const memoria = new Map<string, unknown>();

interface Guardada { t: number; status: number; body: string; tipo: string }
const enCurso = new Map<string, Promise<Guardada>>();

/** ¿La respuesta es JSON de verdad (y no una página HTML)? */
function esJSON(tipo: string | null, body?: string): boolean {
  if (tipo && !/json/i.test(tipo)) return false;
  if (body !== undefined) {
    const inicio = body.trimStart().charAt(0);
    if (inicio !== "{" && inicio !== "[") return false;
  }
  return true;
}

function responder(g: { status: number; body: string; tipo: string }): Response {
  return new Response(g.body, { status: g.status, headers: { "content-type": g.tipo } });
}

let originalFetch: typeof fetch | null = null;
function fetchBase(): typeof fetch {
  return originalFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
}

/** Si la sesión venció (el middleware marca la respuesta con x-sesion), vuelve a la pantalla de ingreso. */
let yendoALogin = false;
function fetchServidor(): typeof fetch {
  const base = fetchBase();
  return (async (...a: Parameters<typeof fetch>) => {
    const r = await base(...a);
    if (r.status === 401 && typeof window !== "undefined" && r.headers.get("x-sesion") === "requerida" && !yendoALogin) {
      yendoALogin = true;
      const aqui = window.location.pathname + window.location.search;
      window.location.href = `/login?siguiente=${encodeURIComponent(aqui)}`;
    }
    return r;
  }) as typeof fetch;
}

/**
 * Límite de tiempo para leer datos: ninguna pantalla se queda esperando para siempre.
 * Si el servidor no responde en 90 s, el pedido se corta y la pantalla muestra el error.
 */
const LIMITE_GET_MS = 90_000;
function conLimite(servidor: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal) return servidor(input, init); // ya trae su propio control
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), LIMITE_GET_MS);
  return servidor(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** GET a /api: desde la memoria si está; si no, al servidor (pedidos iguales comparten una llamada). */
/** Aviso global: un cálculo se hizo con una lectura fallida (lo muestra components/AvisoLecturaParcial). */
export const EVENTO_LECTURA_PARCIAL = "lectura-parcial";
function avisarLecturaParcial(detalle: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO_LECTURA_PARCIAL, { detail: detalle }));
}

async function pedirGET(clave: string, pedir: () => Promise<Response>): Promise<Response> {
  let g = obtenerRespuestaCache(clave);
  if (g) return responder(g);
  // Al abrir: primero se revisa lo guardado en este navegador. (Protegido por si la versión de
  // lib/cache-sistema.ts que corre en el servidor todavía es la anterior.)
  if (typeof esperarMemoria === "function") await esperarMemoria();
  g = obtenerRespuestaCache(clave);
  if (g) return responder(g);

  let p = enCurso.get(clave);
  if (!p) {
    p = pedir().then(async (res) => {
      const body = await res.text();
      const tipo = res.headers.get("content-type") ?? "application/json";
      const datos = { t: Date.now(), status: res.status, body, tipo };
      // Calculado con una lectura fallida: se muestra con aviso, pero no se guarda (el siguiente pedido vuelve a calcular).
      const parcial = res.headers.get("x-lectura-parcial");
      if (parcial) {
        avisarLecturaParcial(decodeURIComponent(parcial));
        return datos;
      }
      // Solo se guarda en memoria una respuesta JSON correcta. Si llega una página HTML (por
      // ejemplo mientras la vista previa compila o reinicia), no se guarda nunca.
      if (res.status < 400 && esJSON(tipo, body)) {
        guardarRespuestaCache(clave, datos);
        try {
          const parsed = JSON.parse(body);
          memoria.set(clave, parsed);
          guardarJSONCache(clave, parsed);
        } catch {
          // No es JSON
        }
        registrarConsulta(clave);
      }
      return datos;
    });
    enCurso.set(clave, p);
    p.catch(() => undefined).finally(() => enCurso.delete(clave));
  }

  return responder(await p);
}

function olvidarTodo() {
  limpiarMemoriaCache();
  enCurso.clear();
  memoria.clear();
}

/**
 * fetch de la herramienta: úsalo en lugar de fetch en las pantallas. Los GET a /api salen de la
 * memoria; los guardados van a la base y borran la memoria. Funciona aunque el navegador no deje
 * reemplazar window.fetch (vista previa de AI Studio).
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const servidor = fetchServidor();
  if (typeof window === "undefined") return servidor(input, init);
  const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const texto = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const dir = new URL(texto, window.location.href);
  const esApi = dir.origin === window.location.origin && dir.pathname.startsWith("/api/");
  if (!esApi) return servidor(input, init);
  // Cada pedido lleva el ejercicio en uso (si no trae uno): el servidor usa los datos de ese año.
  if (!dir.searchParams.has("ejercicio") && !dir.pathname.startsWith("/api/auth/")) {
    dir.searchParams.set("ejercicio", String(ejercicioEnUso()));
    input = input instanceof Request ? new Request(dir.toString(), input) : dir.pathname + dir.search;
  }
  // Inicio de sesión, cambio de contraseña, usuarios: directo al servidor, sin memoria ni recálculo
  if (dir.pathname.startsWith("/api/auth/") || dir.pathname === "/api/usuarios" || dir.pathname.startsWith("/api/usuarios/") || dir.pathname === "/api/bitacora") {
    return fetchBase()(input, init);
  }

  if (metodo === "GET" || metodo === "HEAD") {
    if (dir.pathname === "/api/sincronizar" || dir.pathname === "/api/esquema") return servidor(input, init);
    return pedirGET(dir.pathname + dir.search, () => conLimite(servidor, input, init));
  }

  // Guardado: va a la base; la memoria queda vieja, así que se borra y se vuelve a precargar sola.
  try {
    return await servidor(input, init);
  } finally {
    if (dir.pathname !== "/api/sincronizar") {
      olvidarTodo();
      despuesDeGuardar();
    }
  }
}

/** Instala el vigilante: también las llamadas a fetch normales pasan por apiFetch, si el navegador lo permite. */
if (typeof window !== "undefined" && !(window as unknown as { __fetchVigilado?: boolean }).__fetchVigilado) {
  (window as unknown as { __fetchVigilado?: boolean }).__fetchVigilado = true;
  originalFetch = window.fetch.bind(window);
  registrarFetchCrudo(originalFetch);
  const vigilado = (input: RequestInfo | URL, init?: RequestInit) => apiFetch(input, init);
  try {
    (window as unknown as { fetch: typeof fetch }).fetch = vigilado as typeof fetch;
  } catch {
    try { Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: vigilado }); } catch { /* no se puede */ }
  }
}

/** fetch para las funciones de este archivo (desde la memoria si está). */
function pedirUnaVez(url: string): Promise<Response> {
  return apiFetch(url);
}

/**
 * Igual, pero si la conexión se corta ("Failed to fetch", por ejemplo mientras la vista previa
 * reinicia el servidor) vuelve a intentar hasta 3 veces antes de rendirse.
 */
async function pedirDatos(url: string): Promise<Response> {
  for (let intento = 0; ; intento++) {
    try {
      const r = await pedirUnaVez(url);
      // Una página HTML en lugar de datos (vista previa compilando o reiniciando): se reintenta.
      if (!esJSON(r.headers.get("content-type")) && intento < 6) {
        await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1)));
        continue;
      }
      return r;
    } catch (e) {
      // Si se cortó por el límite de tiempo, no se reintenta (se mostraría "Cargando..." varios minutos).
      if (intento >= 3 || (e instanceof DOMException && e.name === "AbortError")) throw e;
      await new Promise((r) => setTimeout(r, 700 * (intento + 1)));
    }
  }
}

/** GET a /api que devuelve el JSON, con reintentos si la conexión se corta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pedirJSON<T = any>(url: string): Promise<T> {
  const r = await pedirDatos(url);
  return (await r.json()) as T;
}

export { obtenerJSONCache, guardarJSONCache, tieneRespuestaCache } from "./cache-sistema";

/** ¿Hay algo recordado para esta dirección? */
export function tieneDatos(url: string) {
  return memoria.has(url) || tieneRespuestaCache(url) || obtenerJSONCache(url) !== undefined;
}

/**
 * Para pantallas que cargan con fetch(...).then(...): llama a `alRecibir` al instante con lo
 * recordado (si hay) y otra vez cuando llega la respuesta del servidor, solo si cambió.
 * Devuelve una promesa que termina cuando llegó la respuesta del servidor.
 */
export function cargarJSON<T = unknown>(url: string, alRecibir: (d: T) => void): Promise<void> {
  const previo = (memoria.get(url) as T | undefined) ?? obtenerJSONCache<T>(url);
  if (previo !== undefined) {
    alRecibir(previo);
  }
  return pedirDatos(url)
    .then((r) => r.json())
    .then((d) => {
      const esError = d && typeof d === "object" && "error" in d && d.error;
      if (!esError) {
        memoria.set(url, d);
        guardarJSONCache(url, d);
      }
      if (previo === undefined || esError || JSON.stringify(previo) !== JSON.stringify(d)) {
        alRecibir(d as T);
      }
    });
}

/**
 * Precarga de las OTRAS pestañas de la sección abierta, para que al cambiar de pestaña ya estén listas.
 * - Solo en la versión publicada: en la vista previa de AI Studio cada pedido obliga a compilar y
 *   muchos pedidos juntos provocan "Rate exceeded".
 * - De a un pedido, con pausa, y empieza 1,5 s después de abrir: nunca compite con la pantalla visible.
 * - Un paso puede ser una dirección o una función que devuelve más direcciones (por ejemplo: leer la
 *   lista de hojas de un grupo y luego pedir la primera hoja).
 * Devuelve una función para cancelarla (al salir de la sección o cambiar de agencia).
 */
type PasoPrecarga = string | (() => Promise<string[]>);
export function precargarEnSerie(pasos: PasoPrecarga[], pausaMs = 350): () => void {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production") return () => undefined;
  let vivo = true;
  const t = setTimeout(async () => {
    const cola = [...pasos];
    while (vivo && cola.length) {
      if (document.visibilityState === "hidden") break;
      const paso = cola.shift()!;
      if (typeof paso === "function") {
        try { cola.unshift(...(await paso())); } catch { /* se omite */ }
        continue;
      }
      if (tieneDatos(paso)) continue;
      try {
        const d = await (await pedirDatos(paso)).json();
        if (!(d && typeof d === "object" && "error" in d && d.error)) { memoria.set(paso, d); guardarJSONCache(paso, d); }
      } catch { /* se omite: la pestaña lo pedirá al abrirse */ }
      await new Promise((r) => setTimeout(r, pausaMs));
    }
  }, 1500);
  return () => { vivo = false; clearTimeout(t); };
}

/** Pasos para precargar un grupo con hojas (Egresos / Ingresos): la lista de hojas y la primera hoja. */
export function pasosGrupoHojas(grupo: string, agencia: string, ejercicio: number): PasoPrecarga[] {
  const uHojas = `/api/hojas-presupuesto?grupo=${grupo}&ejercicio=${ejercicio}`;
  return [uHojas, async () => {
    const d = await pedirJSON<{ hojas?: string[] }>(uHojas);
    const hoja = d?.hojas?.[0];
    if (!hoja) return [];
    return [
      `/api/presupuesto-resumen?departamento=${encodeURIComponent(hoja)}&ejercicio=${ejercicio}`,
      `/api/presupuesto-departamental?departamento=${encodeURIComponent(hoja)}&grupo=${grupo}&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`,
    ];
  }];
}

/** Pide por adelantado (sin mostrar nada) las direcciones de las otras pestañas. */
export function precargar(urls: string[]) {
  for (const url of urls) {
    if (tieneDatos(url)) continue;
    pedirDatos(url)
      .then((r) => r.json())
      .then((d) => {
        if (!(d && typeof d === "object" && "error" in d && d.error)) {
          memoria.set(url, d);
          guardarJSONCache(url, d);
        }
      })
      .catch(() => undefined);
  }
}

export function useDatos<T>(url: string | null, version = 0, validar?: (d: T) => string | null) {
  const obtenerActual = (u: string | null): T | null => {
    if (!u) return null;
    return (memoria.get(u) as T) ?? (obtenerJSONCache<T>(u) ?? null);
  };

  const inicial = obtenerActual(url);
  // Los datos se guardan junto con la dirección de la que vinieron: al cambiar de agencia nunca se
  // muestran (ni se editan ni se exportan) las cifras de la agencia anterior bajo el nombre de la nueva.
  const [estado, setEstado] = useState<{ url: string | null; datos: T | null }>(() => ({ url, datos: inicial }));
  const datos = estado.url === url ? estado.datos : null;
  const [pidiendo, setPidiendo] = useState(() => !!url && inicial === null);
  const [error, setError] = useState<string | null>(null);
  const [ticketSync, setTicketSync] = useState(0);

  useEffect(() => {
    const handleSync = () => setTicketSync((t) => t + 1);
    if (typeof window !== "undefined") {
      window.addEventListener("herramienta-actualizada", handleSync);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("herramienta-actualizada", handleSync);
      }
    };
  }, []);

  useEffect(() => {
    if (!url) return;
    let vivo = true;
    const cacheActual = (memoria.get(url) as T) ?? (obtenerJSONCache<T>(url) ?? null);
    if (cacheActual !== null) {
      setEstado({ url, datos: cacheActual });
      setPidiendo(false);
    } else {
      setPidiendo(true);
    }
    setError(null);

    pedirDatos(url)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        const msg = (d && typeof d === "object" && "error" in d && d.error ? String(d.error) : null) ?? (validar ? validar(d as T) : null);
        if (msg) { setError(msg); return; }
        memoria.set(url, d);
        guardarJSONCache(url, d);
        setEstado({ url, datos: d as T });
      })
      .catch((e) => {
        console.error("[datos]", url, e);
        if (vivo && cacheActual === null) setError(`No se pudieron cargar los datos (${e instanceof Error ? e.message : "error"}).`);
      })
      .finally(() => { if (vivo) setPidiendo(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, version, ticketSync]);

  return {
    datos,
    cargando: pidiendo && datos === null,     // solo es verdadero si no hay datos en caché
    actualizando: pidiendo && datos !== null, // hay datos instantáneos y se actualiza por detrás
    error,
  };
}

/**
 * Guarda varios meses (o varias filas) en UNA sola llamada: { cambios: [{ id, monto }] }.
 * Úsalo en lugar de 12 llamadas seguidas (una por mes): la base graba un solo lote y la
 * herramienta se actualiza una sola vez. Las filas sin id (null) se omiten.
 */
export function guardarMontosPorMes(ruta: string, ids: (number | null)[], monto: (i: number) => number): Promise<Response | void> {
  const cambios = ids.map((id, i) => (id === null || id === undefined ? null : { id, monto: monto(i) })).filter((c): c is { id: number; monto: number } => c !== null);
  if (!cambios.length) return Promise.resolve();
  return apiFetch(ruta, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios }) });
}

/**
 * Revisa la respuesta de un guardado: null si salió bien, o el mensaje para mostrar.
 * (Una respuesta vacía —nada que guardar— cuenta como bien.)
 */
export async function errorDeRespuesta(r: Response | void): Promise<string | null> {
  if (!r) return null;
  if (r.ok) {
    const d = await r.clone().json().catch(() => null);
    return d && typeof d === "object" && "error" in d && d.error ? String(d.error) : null;
  }
  const d = await r.json().catch(() => null);
  if (r.status === 401) return "La sesión expiró. Vuelva a ingresar; lo escrito sigue en pantalla.";
  return (d && typeof d === "object" && "error" in d && d.error ? String(d.error) : null) ?? `El servidor no aceptó el cambio (error ${r.status}).`;
}

/** Elimina varias filas de presupuesto_departamental en una sola llamada. */
export function eliminarFilasDepartamental(ids: (number | null)[]): Promise<Response | void> {
  const lista = ids.filter((id): id is number => typeof id === "number");
  if (!lista.length) return Promise.resolve();
  return apiFetch(`/api/presupuesto-departamental?ids=${lista.join(",")}`, { method: "DELETE" });
}

/**
 * Turnos de carga: cada vez que una pantalla vuelve a pedir datos (cambio de agencia, de hoja, tras
 * guardar) toma un turno nuevo; una respuesta de un turno anterior que llega tarde se descarta.
 * Evita que una respuesta lenta de otra agencia pise la de la agencia elegida.
 */
export function useTurnos() {
  const ultimo = useRef<Record<string, number>>({});
  return {
    nuevo: (clave = "") => (ultimo.current[clave] = (ultimo.current[clave] ?? 0) + 1),
    vigente: (t: number, clave = "") => ultimo.current[clave] === t,
  };
}
