"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * EJERCICIO Y AGENCIA COMUNES A TODA LA HERRAMIENTA.
 *
 * Lo que se elige en una pantalla se mantiene al pasar a otra (antes cada pantalla volvía a
 * Consolidado y a 2027). Se recuerda en este navegador; no consulta la base.
 */
const CLAVE = "seleccion-presupuesto";
interface Seleccion { agencia: string; ejercicio: number; elegido?: boolean }
const INICIAL: Seleccion = { agencia: "Consolidado", ejercicio: 2027 };

let actual: Seleccion = INICIAL;
let leido = false;
let elegido = false; // el ejercicio vino de una elección guardada (no es el inicial)
const oyentes = new Set<() => void>();

function leer(): Seleccion {
  if (!leido && typeof window !== "undefined") {
    leido = true;
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Partial<Seleccion> | null;
      if (g && typeof g.agencia === "string" && Number.isInteger(g.ejercicio)) { actual = { agencia: g.agencia, ejercicio: Number(g.ejercicio) }; elegido = g.elegido === true; }
    } catch { /* sin almacenamiento: se usa lo inicial */ }
  }
  return actual;
}
function cambiar(c: Partial<Seleccion>) {
  const n = { ...leer(), ...c };
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify({ ...n, elegido })); } catch { /* sin almacenamiento */ } };
  if (c.ejercicio !== undefined && !elegido) { elegido = true; guardar(); }
  if (n.agencia === actual.agencia && n.ejercicio === actual.ejercicio) return;
  actual = n;
  guardar();
  oyentes.forEach((o) => o());
}
function suscribir(o: () => void) { oyentes.add(o); return () => { oyentes.delete(o); }; }
const servidor = () => INICIAL;
// Funciones fijas (no cambian entre renders), como el setState de React.
const fijarAgencia = (a: string) => cambiar({ agencia: a });
const fijarEjercicio = (e: number) => cambiar({ ejercicio: e });

/**
 * Agencia elegida, compartida entre pantallas. `conConsolidado = false` para pantallas sin
 * Consolidado: si lo elegido es Consolidado, esa pantalla muestra Matriz (sin cambiar lo elegido).
 */
export function useAgencia(conConsolidado = true): [string, (a: string) => void] {
  const s = useSyncExternalStore(suscribir, leer, servidor);
  const agencia = !conConsolidado && s.agencia === "Consolidado" ? "Matriz" : s.agencia;
  return [agencia, fijarAgencia];
}

/** Ejercicio elegido. Si la dirección trae ?ejercicio=, ese manda (enlaces desde Inicio). */
export function useEjercicio(): [number, (e: number) => void] {
  const s = useSyncExternalStore(suscribir, leer, servidor);
  useEffect(() => {
    const q = Number(new URLSearchParams(window.location.search).get("ejercicio"));
    if (Number.isInteger(q) && q > 2000) cambiar({ ejercicio: q });
  }, []);
  return [s.ejercicio, fijarEjercicio];
}

/** Ejercicio en uso, fuera de un componente (para los pedidos al servidor). */
/** Si el ejercicio en uso lo eligió alguien en este navegador (false = es el inicial, nunca se eligió). */
export function ejercicioFueElegido(): boolean {
  leer();
  return elegido;
}

export function ejercicioEnUso(): number {
  return leer().ejercicio;
}

/** La dirección de un pedido /api con el ejercicio en uso (si no trae uno). Clave única de la memoria. */
export function conEjercicioEnUso(url: string): string {
  if (!url.startsWith("/api/") || url.startsWith("/api/auth/") || /[?&]ejercicio=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}ejercicio=${ejercicioEnUso()}`;
}
