"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import "../lib/useDatos";
import { cargarBaseDeDatosEnCache, iniciarRevisionAutomatica } from "../lib/cache-sistema";

/**
 * Arranca la memoria de la herramienta al abrirla, sin mostrar nada en pantalla:
 * si los datos no cambiaron desde la última visita se usan los guardados en este navegador;
 * si cambiaron, se recargan por detrás. También deja programada la revisión automática.
 * En la pantalla de ingreso no hace nada (todavía no hay sesión).
 */
export default function VigilanteDatos() {
  const enLogin = usePathname() === "/login";
  useEffect(() => {
    if (enLogin) return;
    iniciarRevisionAutomatica();
    cargarBaseDeDatosEnCache().catch((e) => console.error("[memoria]", e));
  }, [enLogin]);
  return null;
}
