"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * CAMBIOS SIN GUARDAR — registro común de toda la herramienta.
 *
 * Cada edición abierta (una fila en edición, un registro nuevo a medio llenar…) se anota aquí con
 * usePendiente. Antes de cambiar de agencia o de pestaña, el encabezado pregunta si guardar,
 * descartar o seguir editando (ver components/GuardiaCambios.tsx). Al cerrar o recargar la página
 * con algo pendiente, el navegador también avisa. No consulta la base: vive solo en la pantalla.
 */
export interface Pendiente {
  /** Qué está sin guardar, en palabras del usuario: "Montos de 450305 en Matriz". */
  descripcion: string;
  /** Guarda lo pendiente; devuelve true si se guardó. Sin esta función solo se ofrece descartar. */
  guardar?: () => Promise<boolean>;
  /** Cierra la edición sin guardar. */
  descartar: () => void;
}

const pendientes = new Map<string, Pendiente>();
const oyentes = new Set<() => void>();
let instantanea: Pendiente[] = [];

function avisar() {
  instantanea = [...pendientes.values()];
  oyentes.forEach((o) => o());
}

export function listaPendientes(): Pendiente[] {
  return instantanea;
}

let idSiguiente = 0;
/**
 * Anota una edición abierta mientras `pendiente` no sea null. Las funciones se leen siempre en su
 * versión más reciente, así guardar usa lo último que se escribió.
 */
export function usePendiente(pendiente: Pendiente | null) {
  const [clave] = useState(() => `p${++idSiguiente}`);
  const actual = useRef(pendiente);
  useLayoutEffect(() => { actual.current = pendiente; });
  const activo = pendiente !== null;
  const descripcion = pendiente?.descripcion ?? "";
  const conGuardar = !!pendiente?.guardar;
  useEffect(() => {
    if (!activo) return;
    pendientes.set(clave, {
      descripcion,
      guardar: conGuardar ? () => actual.current?.guardar?.() ?? Promise.resolve(true) : undefined,
      descartar: () => actual.current?.descartar(),
    });
    avisar();
    return () => { pendientes.delete(clave); avisar(); };
  }, [clave, activo, descripcion, conGuardar]);
}

// Al cerrar o recargar la pestaña del navegador con cambios pendientes, el navegador pregunta.
if (typeof window !== "undefined" && !(window as unknown as { __avisoPendientes?: boolean }).__avisoPendientes) {
  (window as unknown as { __avisoPendientes?: boolean }).__avisoPendientes = true;
  window.addEventListener("beforeunload", (e) => {
    if (pendientes.size) { e.preventDefault(); e.returnValue = ""; }
  });
}
