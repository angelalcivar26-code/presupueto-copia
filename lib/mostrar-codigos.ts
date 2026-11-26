"use client";
import { useEffect, useState } from "react";

/**
 * Mostrar u ocultar los códigos contables en las tablas de las secciones (botón # en la cabecera de cada tabla).
 * Es una preferencia de quien mira: se recuerda en este navegador y cambia a la vez en todas las tablas abiertas.
 */
const CLAVE = "pf:mostrar-codigos";
const EVENTO = "pf:mostrar-codigos";

function leer(): boolean {
  try { return localStorage.getItem(CLAVE) === "1"; } catch { return false; }
}

export function useMostrarCodigos(): [boolean, () => void] {
  const [ver, setVer] = useState(false);
  useEffect(() => {
    const sync = () => setVer(leer());
    sync();
    window.addEventListener(EVENTO, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENTO, sync); window.removeEventListener("storage", sync); };
  }, []);
  const cambiar = () => {
    const nuevo = !ver;
    try { localStorage.setItem(CLAVE, nuevo ? "1" : "0"); } catch { /* sin almacenamiento: solo esta vista */ }
    setVer(nuevo);
    window.dispatchEvent(new Event(EVENTO));
  };
  return [ver, cambiar];
}
