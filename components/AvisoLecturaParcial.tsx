"use client";

import { useEffect, useState } from "react";
import { EVENTO_LECTURA_PARCIAL } from "../lib/useDatos";

/**
 * Aviso fijo cuando un cálculo se hizo con una lectura fallida (conexión momentánea con la base).
 * Las cifras mostradas pueden venir de un método alterno; «Reintentar» vuelve a calcular.
 * No se guarda nada de ese cálculo.
 */
export default function AvisoLecturaParcial() {
  const [detalle, setDetalle] = useState<string | null>(null);
  useEffect(() => {
    const oir = (e: Event) => setDetalle(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(EVENTO_LECTURA_PARCIAL, oir);
    return () => window.removeEventListener(EVENTO_LECTURA_PARCIAL, oir);
  }, []);
  if (!detalle) return null;
  return (
    <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg p-3 text-[12px] shadow"
         style={{ background: "#FFF8EB", border: "1px solid #E7C98A", color: "#6E4A0E" }}>
      <p className="font-semibold mb-1">Algunos datos no se pudieron leer</p>
      <p className="mb-2">Las cifras de esta pantalla pueden estar incompletas: {detalle}.</p>
      <div className="flex gap-2 justify-end">
        <button type="button" className="px-3 py-1 rounded" style={{ border: "1px solid #E7C98A" }} onClick={() => setDetalle(null)}>Cerrar</button>
        <button type="button" className="px-3 py-1 rounded text-white" style={{ background: "#005A28" }}
                onClick={() => { setDetalle(null); window.location.reload(); }}>Reintentar</button>
      </div>
    </div>
  );
}
