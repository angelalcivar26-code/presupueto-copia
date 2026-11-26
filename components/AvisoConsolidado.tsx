"use client";

import { AlertTriangle } from "lucide-react";
import { obtenerJSONCache } from "../lib/useDatos";

/** Línea bajo el filtro cuando se ve el Consolidado: avisa qué agencias no entraron en la suma. */
export function AvisoConsolidado({ url, agencia }: { url: string; agencia: string }) {
  if (agencia !== "Consolidado") return null;
  const c = obtenerJSONCache<{ consolidado?: { incluidas: string[]; faltantes: { agencia: string; motivo: string }[] } }>(url)?.consolidado;
  // Vista limpia, igual que una agencia: solo se avisa si alguna agencia no entró en la suma.
  if (!c || !c.faltantes.length) return null;
  return (
    <div className="flex items-start gap-2 px-3.5 py-2 rounded-md text-[12px] -mt-1" style={{ background: "#FBF1DC", color: "#6E4A0E" }}>
      <AlertTriangle size={15} className="shrink-0 mt-px" />
      <span>
        Consolidado de {c.incluidas.length} de 10 agencias. No entran en la suma, por no tener balance cargado o por un error al calcular:{" "}
        <b>{c.faltantes.map((f) => f.agencia).join(", ")}</b>.
      </span>
    </div>
  );
}
