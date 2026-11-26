"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { listaPendientes, type Pendiente } from "../lib/cambios-pendientes";
import { leerMonto } from "../lib/numeros";

/**
 * Antes de cambiar de agencia o de pestaña: si hay ediciones sin guardar, pregunta
 * «Guardar y continuar · Descartar · Seguir editando». Sin nada pendiente, cambia de inmediato.
 *
 *   const guardia = useGuardiaCambios();
 *   onChange={(a) => guardia.pedir(() => setAgencia(a))}   ·   {guardia.dialogo}
 */
export function useGuardiaCambios(): { pedir: (accion: () => void) => void; dialogo: ReactNode } {
  const [espera, setEspera] = useState<{ accion: () => void; lista: Pendiente[] } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pedir(accion: () => void) {
    const lista = listaPendientes();
    if (!lista.length) { accion(); return; }
    setError(null);
    setEspera({ accion, lista });
  }
  async function guardarYSeguir() {
    if (!espera) return;
    setGuardando(true); setError(null);
    try {
      for (const p of espera.lista) {
        if (p.guardar) { if (!(await p.guardar())) { setError(`No se pudo guardar: ${p.descripcion}. Revise el mensaje en la tabla.`); return; } }
        else p.descartar();
      }
      const accion = espera.accion;
      setEspera(null);
      accion();
    } finally { setGuardando(false); }
  }
  function descartar() {
    if (!espera) return;
    espera.lista.forEach((p) => p.descartar());
    const accion = espera.accion;
    setEspera(null);
    accion();
  }

  const puedeGuardar = !!espera?.lista.some((p) => p.guardar);
  const dialogo = espera && (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Cambios sin guardar"
         onKeyDown={(e) => { if (e.key === "Escape" && !guardando) setEspera(null); }}>
      <div className="bg-white rounded-xl max-w-md w-full p-5" style={{ border: "1px solid #D5DBD7", fontFamily: "inherit" }}>
        <p className="text-[13px] font-semibold mb-2" style={{ color: "#111418" }}>Tiene cambios sin guardar</p>
        <ul className="text-[12px] mb-3 list-disc pl-5" style={{ color: "#26302B" }}>
          {espera.lista.map((p, i) => <li key={i}>{p.descripcion}</li>)}
        </ul>
        {error && <p role="alert" className="text-[12px] mb-3" style={{ color: "#B42318" }}>{error}</p>}
        <div className="flex justify-end gap-2 flex-wrap">
          <button autoFocus type="button" disabled={guardando} onClick={() => setEspera(null)} className="text-[12px] px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ border: "1px solid #D5DBD7", color: "#3D4843" }}>Seguir editando</button>
          <button type="button" disabled={guardando} onClick={descartar} className="text-[12px] px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ border: "1px solid #E5B8B3", color: "#B42318" }}>Descartar</button>
          {puedeGuardar && (
            <button type="button" disabled={guardando} onClick={guardarYSeguir} className="text-[12px] px-4 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: "#005A28" }}>
              {guardando ? "Guardando…" : "Guardar y continuar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return { pedir, dialogo };
}

/**
 * Casilla de monto en formato Ecuador. Si lo escrito no se puede leer, el borde se pone rojo
 * y el mensaje aparece al pasar el ratón (y lo leen los lectores de pantalla).
 */
export function CampoMonto({ value, onChange, className, style, placeholder, etiqueta }: {
  value: string; onChange: (v: string) => void; className?: string; style?: CSSProperties; placeholder?: string; etiqueta?: string;
}) {
  const error = leerMonto(value).error;
  return (
    <input value={value} inputMode="decimal" placeholder={placeholder} aria-label={etiqueta} aria-invalid={!!error} title={error ?? undefined}
           onChange={(e) => onChange(e.target.value)} className={className}
           style={{ ...style, ...(error ? { border: "1px solid #B42318", background: "#FDF2F1", outlineColor: "#B42318" } : {}) }} />
  );
}

/** Mensaje de error bajo un formulario (o nada). */
export function MensajeError({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <p role="alert" className="text-[11px]" style={{ color: "#B42318" }}>{texto}</p>;
}

// ---------------------------------------------------------------------
// Casilla numérica que no se reformatea mientras se escribe
// ---------------------------------------------------------------------

/** Casillas con texto que no se puede leer (o fuera de rango), para bloquear el guardado. */
const camposConError = new Set<string>();
let campoSiguiente = 0;
/** ¿Hay alguna casilla en rojo en la pantalla? Los guardados la consultan antes de enviar. */
export function hayCamposConError(): boolean {
  return camposConError.size > 0;
}
export const MENSAJE_CAMPOS_CON_ERROR = "Revise las casillas con borde rojo (use coma para decimales; el punto solo separa miles).";

/**
 * Casilla para un número guardado (porcentaje con escala 100, o dólares con escala 1).
 * Mientras se escribe conserva el texto tal cual; al salir muestra el valor con formato.
 * Lo que no se puede leer, o queda fuera de [min, max], se marca en rojo y no se aplica.
 */
export function CampoNumero({ valor, onValor, escala = 1, decimales = 2, permitirVacio = false, min, max, className, style, etiqueta, placeholder, enteros = false }: {
  valor: number | null | undefined; onValor: (v: number | null) => void; escala?: number; decimales?: number; permitirVacio?: boolean;
  min?: number; max?: number; className?: string; style?: CSSProperties; etiqueta?: string; placeholder?: string; enteros?: boolean;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [id] = useState(() => `c${++campoSiguiente}`);
  const mostrado = valor === null || valor === undefined ? "" : (valor * escala).toFixed(decimales).replace(".", ",").replace(/,0+$/, "").replace(/(,\d*?)0+$/, "$1");
  const t = texto ?? mostrado;
  const r = leerMonto(t);
  const v = r.valor;
  const error = r.error
    ?? (v === null && !permitirVacio && texto !== null && texto.trim() !== "" ? "Valor no válido" : null)
    ?? (v !== null && enteros && !Number.isInteger(v) ? "Use un número entero" : null)
    ?? (v !== null && ((min !== undefined && v < min) || (max !== undefined && v > max))
      ? `Debe estar entre ${(min ?? -Infinity).toLocaleString("es-EC")} y ${(max ?? Infinity).toLocaleString("es-EC")}` : null);
  useEffect(() => {
    if (error) camposConError.add(id); else camposConError.delete(id);
    return () => { camposConError.delete(id); };
  }, [error, id]);
  return (
    <input value={t} inputMode="decimal" aria-label={etiqueta} aria-invalid={!!error} title={error ?? undefined} placeholder={placeholder}
           onFocus={() => { if (texto === null) setTexto(mostrado); }}
           onChange={(e) => {
             const x = e.target.value;
             setTexto(x);
             const l = leerMonto(x);
             if (l.error) return;
             if (l.valor === null) onValor(permitirVacio ? null : 0);
             else onValor(l.valor / escala);
           }}
           onBlur={() => { if (!error) setTexto(null); }}
           className={className}
           style={{ ...style, ...(error ? { border: "1px solid #B42318", background: "#FDF2F1" } : {}) }} />
  );
}
