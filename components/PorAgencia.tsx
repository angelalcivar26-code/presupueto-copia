"use client";

import { useEffect, useState } from "react";
import { cargarJSON } from "../lib/useDatos";
import { AGENCIAS as AGENCIAS_CONSOLIDADO, C, MESES, usd, pct, TablaMeses, type DefFila } from "./ActivosComun";
import { EsqueletoTabla } from "./Carga";

/**
 * RESUMEN POR AGENCIA (para el Consolidado): una fila por agencia y el total, mes a mes.
 * Cada agencia se pide a su propia ruta (el servidor ya la tiene calculada, porque el Consolidado
 * se arma con esas mismas respuestas), así que abrirlo no recalcula nada.
 * Sirve para cualquier sección: se le pasa la ruta de una agencia y qué serie leer de la respuesta.
 */
interface ConceptoAgencia<T> {
  id: string;
  label: string;
  valores: (d: T) => number[];
  /** "fin" = saldo (la última columna es diciembre); "suma" = movimiento (la última columna es el total del año). */
  tipo?: "fin" | "suma";
}

/** Botones de vista (mismo estilo que en Cartera). */
export function BotonesVista<V extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { id: V; label: string }[]; valor: V; onChange: (v: V) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap p-[3px] gap-0.5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => {
        const on = valor === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on}
                  className="h-8 px-3.5 rounded-md text-[13px] transition-colors"
                  style={on ? { background: "#E3EEE7", color: C.acento, fontWeight: 600 } : { background: "transparent", color: C.texto2 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ResumenPorAgencia<T>({ url, conceptos }: { url: (agencia: string) => string; conceptos: ConceptoAgencia<T>[] }) {
  const [concepto, setConcepto] = useState(conceptos[0].id);
  const [datos, setDatos] = useState<Record<string, T | null>>({});
  const urls = AGENCIAS_CONSOLIDADO.map(url).join("|");

  useEffect(() => {
    let vivo = true;
    setDatos({});
    for (const a of AGENCIAS_CONSOLIDADO) {
      cargarJSON<T & { error?: string }>(url(a), (d) => { if (vivo) setDatos((p) => ({ ...p, [a]: d && !d.error ? d : null })); })
        .catch(() => { if (vivo) setDatos((p) => ({ ...p, [a]: null })); });
    }
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls]);

  const listas = AGENCIAS_CONSOLIDADO.filter((a) => a in datos).length;
  if (listas < AGENCIAS_CONSOLIDADO.length) return <EsqueletoTabla indicadores={false} filas={10} />;

  const c = conceptos.find((x) => x.id === concepto) ?? conceptos[0];
  const fin = (c.tipo ?? "fin") === "fin";
  const serie = (a: string) => { const d = datos[a]; return d ? c.valores(d) : Array(12).fill(0); };
  const total = MESES.map((_, i) => AGENCIAS_CONSOLIDADO.reduce((t, a) => t + (serie(a)[i] || 0), 0));
  const cierre = (v: number[]) => (fin ? v[11] : v.reduce((t, x) => t + x, 0));
  const totCierre = cierre(total);

  const filas: DefFila[] = [
    ...AGENCIAS_CONSOLIDADO.map((a): DefFila => {
      const v = serie(a);
      return {
        id: a, label: datos[a] ? a : `${a} · sin datos`, valores: v, total: cierre(v), tenue: !datos[a],
        formula: (i) => `${a} en ${MESES[i]}: ${usd(v[i])}, el ${pct(total[i] ? v[i] / total[i] : 0)} del consolidado. `
          + `${fin ? "En diciembre" : "En el año"}: ${usd(cierre(v))} (${pct(totCierre ? cierre(v) / totCierre : 0)}).`,
      };
    }),
    { id: "tot", label: "Consolidado", valores: total, total: totCierre, clave: true, separador: true,
      formula: (i) => `Suma de las ${AGENCIAS_CONSOLIDADO.length} agencias en ${MESES[i]}: ${usd(total[i])}.` },
  ];

  return (
    <div className="flex flex-col">
      {conceptos.length > 1 && (
        <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <BotonesVista etiqueta="Concepto por agencia" valor={concepto} onChange={setConcepto}
                        opciones={conceptos.map((x) => ({ id: x.id, label: x.label }))} />
        </div>
      )}
      <TablaMeses titulo="Agencia" ultima="Año" filas={filas} />
    </div>
  );
}
