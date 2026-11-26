"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { C } from "./ActivosComun";

/**
 * Formulario en ventana (el mismo en toda la herramienta): título, bloques con su nombre pequeño y campos en 4 columnas,
 * y abajo una línea de resumen con Cancelar / Guardar. Se cierra con la X, Cancelar o Escape.
 */
export const CAMPO = "h-9 w-full rounded-md px-3 text-[13px] bg-white";
export const BORDE = { border: "1px solid #C9D0CC" };

export function VentanaFormulario({ titulo, onCerrar, onGuardar, guardando, textoGuardar = "Guardar", pie, error, children, ancho = 780 }: {
  titulo: string; onCerrar: () => void; onGuardar: () => void; guardando?: boolean; textoGuardar?: string;
  /** Resumen a la izquierda de los botones (p. ej. «Gasto: 12 cuotas de $1.000»). */
  pie?: ReactNode; error?: string | null; children: ReactNode; ancho?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 md:pt-[6vh] overflow-y-auto" style={{ background: "rgba(17,20,24,0.32)" }}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="w-full bg-white rounded-xl shadow-xl flex flex-col" style={{ maxWidth: ancho }}>
        <div className="flex items-center px-6 pt-5 pb-3">
          <b className="text-[15px] flex-1">{titulo}</b>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#F3F5F4]"><X size={16} color={C.texto2} /></button>
        </div>
        <div className="flex flex-col gap-5 px-6 pb-5">{children}</div>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 rounded-b-xl" style={{ borderTop: `1px solid ${C.beige}`, background: "#FAFBFA" }}>
          <span className="text-[12px] flex-1" style={{ color: error ? C.alerta : C.texto2 }}>{error || pie}</span>
          <button type="button" onClick={onCerrar} className="h-9 px-4 rounded-md bg-white text-[12px] font-semibold" style={{ ...BORDE, color: C.texto }}>Cancelar</button>
          <button type="button" onClick={onGuardar} disabled={guardando} className="h-9 px-4 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>{guardando ? "Guardando..." : textoGuardar}</button>
        </div>
      </div>
    </div>
  );
}

/** Bloque del formulario: nombre pequeño y campos en 4 columnas. */
export function SeccionForm({ t, children }: { t: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.tenue }}>{t}</span>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

/** Campo con su etiqueta; span = columnas que ocupa (1, 2 o 4). */
export function CampoForm({ label, span = 1, children }: { label: string; span?: 1 | 2 | 4; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-[12px] ${span === 2 ? "col-span-2" : span === 4 ? "col-span-full" : ""}`} style={{ color: C.texto2 }}>
      {label}{children}
    </label>
  );
}
