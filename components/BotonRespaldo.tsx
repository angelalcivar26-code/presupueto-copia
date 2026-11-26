"use client";

import { useState } from "react";

/**
 * «Descargar respaldo»: baja toda la base (sin memorias de cálculo ni contraseñas) en un archivo
 * comprimido. Pide tabla por tabla y por tramos a /api/respaldo; cada fila se lee una sola vez.
 */
type Lista = { tablas: { nombre: string; sql: string }[]; indices: string[]; lote: number; error?: string };
type Tramo = { columnas: string[]; filas: unknown[][]; siguiente: number | null; error?: string };

async function pedir<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error ?? `Error ${r.status}`);
  return d as T;
}

export function BotonRespaldo({ clase }: { clase: string }) {
  const [estado, setEstado] = useState<{ t: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function descargar() {
    setOcupado(true);
    setEstado({ t: "Preparando el respaldo…" });
    try {
      const lista = await pedir<Lista>("/api/respaldo");
      const tablas: Record<string, { sql: string; columnas: string[]; filas: unknown[][] }> = {};
      let total = 0;
      for (const [i, t] of lista.tablas.entries()) {
        setEstado({ t: `Leyendo ${t.nombre} (${i + 1} de ${lista.tablas.length})…` });
        const destino = { sql: t.sql, columnas: [] as string[], filas: [] as unknown[][] };
        let desde: number | null = 0;
        while (desde !== null) {
          const tramo: Tramo = await pedir<Tramo>(`/api/respaldo?tabla=${encodeURIComponent(t.nombre)}&desde=${desde}`);
          destino.columnas = tramo.columnas;
          destino.filas.push(...tramo.filas);
          desde = tramo.siguiente;
        }
        total += destino.filas.length;
        tablas[t.nombre] = destino;
      }
      const fecha = new Date().toISOString().slice(0, 10);
      const texto = JSON.stringify({ generado: new Date().toISOString(), indices: lista.indices, tablas });
      // Comprimido si el navegador lo permite (el archivo baja unas 10 veces más liviano)
      let blob: Blob = new Blob([texto], { type: "application/json" });
      let nombre = `respaldo-presupuesto-${fecha}.json`;
      if (typeof CompressionStream !== "undefined") {
        blob = await new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).blob();
        nombre += ".gz";
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(a.href);
      setEstado({ t: `Respaldo descargado: ${lista.tablas.length} tablas, ${total.toLocaleString("es-EC")} filas.` });
    } catch (e) {
      setEstado({ t: `No se pudo completar el respaldo: ${e instanceof Error ? e.message : "error"}. No se descargó ningún archivo.`, error: true });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={clase} disabled={ocupado} onClick={descargar}>
        {ocupado ? "Generando respaldo…" : "Descargar respaldo"}
      </button>
      {estado && (
        <span role={estado.error ? "alert" : "status"} className={`text-[12px] ${estado.error ? "text-[#9B1C1C]" : "text-[#3D4843]"}`}>{estado.t}</span>
      )}
    </div>
  );
}
