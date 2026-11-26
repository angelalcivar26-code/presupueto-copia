"use client";

import Link from "next/link";
import { useState } from "react";
import { useDatos } from "../../../lib/useDatos";
import { useEjercicio } from "../../../lib/seleccion";
import AnioEjercicio from "../../../components/AnioEjercicio";

interface Hallazgo { agencia?: string; mes?: number; periodo?: string; texto: string; diferencia?: number }
interface Control { id: string; titulo: string; descripcion: string; href: string; estado: "ok" | "error" | "aviso" | "sin-datos"; hallazgos: Hallazgo[] }

const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DESTINO: Record<string, string> = {
  balance: "Balance general", interoficinas: "Fondos disponibles", consolidado: "Carga de datos",
  prorrateo: "Gastos operacionales", distribucion: "Cartera de crédito", completos: "Inicio", hojas: "Gastos operacionales",
  "archivos-cuadre": "Carga de datos", "archivos-consolidado": "Carga de datos", "archivos-meses": "Carga de datos",
};
const usd = (v: number) => {
  const t = Math.abs(v).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${t})` : t;
};
const COLOR = { ok: "#0B5A2A", error: "#9B1C1C", aviso: "#8A5A12", "sin-datos": "#6B7570" } as const;
const FONDO = { ok: "#E3EEE7", error: "#FBE9E9", aviso: "#FBF0D9", "sin-datos": "#EEF1EF" } as const;

function Marca({ estado }: { estado: Control["estado"] }) {
  return (
    <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: FONDO[estado], color: COLOR[estado] }} aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {estado === "ok" ? <path d="m5 12 5 5 9-10" /> : estado === "error" ? <><path d="M7 7l10 10" /><path d="M17 7 7 17" /></> : estado === "aviso" ? <><path d="M12 6v8" /><path d="M12 18h.01" /></> : <path d="M6 12h12" />}
      </svg>
    </span>
  );
}

/** Control de integridad: revisa de una vez que el presupuesto del ejercicio cuadre. Solo lectura. */
export default function IntegridadPage() {
  const [ejercicio] = useEjercicio();
  const { datos, error } = useDatos<{ controles: Control[] }>(`/api/integridad?ejercicio=${ejercicio}`);
  const [abierto, setAbierto] = useState<string | null>(null);
  const controles = datos?.controles ?? [];
  const conError = controles.filter((c) => c.estado === "error" || c.estado === "aviso").length;

  return (
    <div className="px-8 py-8">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#111418]">Control de integridad<AnioEjercicio /></h1>
        <p className="text-[13px] text-[#26302B] mt-1">
          {!datos ? (error ? "" : "Revisando el presupuesto…") : conError ? `${conError} de ${controles.length} controles con observaciones` : `Los ${controles.length} controles cuadran`}
        </p>
      </div>
      {error && <p role="alert" className="mb-4 text-[13px] text-[#9B1C1C]">{error}</p>}

      <div className="bg-white rounded-2xl border border-[#E3E6E4]">
        {controles.map((c) => {
          const abre = abierto === c.id && c.hallazgos.length > 0;
          const conMes = c.hallazgos.some((h) => h.mes || h.periodo), conAg = c.hallazgos.some((h) => h.agencia), conDif = c.hallazgos.some((h) => h.diferencia !== undefined);
          return (
            <div key={c.id} className="border-b border-[#EEF1EF] last:border-0">
              <div className="flex items-center gap-4 px-5 py-4">
                <Marca estado={c.estado} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-[#111418]">{c.titulo}</div>
                  <div className="text-[12px] text-[#4A554F]">{c.descripcion}</div>
                </div>
                <div className="text-[13px] font-semibold whitespace-nowrap" style={{ color: COLOR[c.estado] }}>
                  {c.estado === "ok" ? "Cuadra" : c.estado === "sin-datos" ? "Sin datos" : `${c.hallazgos.length} ${c.hallazgos.length === 1 ? "observación" : "observaciones"}`}
                </div>
                <div className="w-[96px] text-right">
                  {c.hallazgos.length > 0 && (
                    <button type="button" className="text-[13px] font-semibold text-[#005A28] hover:underline" onClick={() => setAbierto(abre ? null : c.id)}>
                      {abre ? "Ocultar" : "Ver detalle"}
                    </button>
                  )}
                </div>
              </div>
              {abre && (
                <div className="px-5 pb-4 pl-[60px]">
                  <table className="w-full text-[12px]" style={{ fontFamily: "Tahoma, sans-serif" }}>
                    <thead>
                      <tr className="text-left text-[11px] font-bold text-[#26302B] border-b border-[#E3E6E4]">
                        {conAg && <th className="py-2 pr-3 w-[150px]">Agencia</th>}
                        {conMes && <th className="py-2 pr-3 w-[80px]">Mes</th>}
                        <th className="py-2 pr-3">Detalle</th>
                        {conDif && <th className="py-2 text-right w-[130px]">{c.id === "hojas" ? "Total sumado" : "Diferencia"}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {c.hallazgos.slice(0, 200).map((h, i) => (
                        <tr key={i} className="border-b border-[#EEF1EF] last:border-0">
                          {conAg && <td className="py-1.5 pr-3">{h.agencia ?? "—"}</td>}
                          {conMes && <td className="py-1.5 pr-3">{h.periodo ? `${MES[Number(h.periodo.slice(5, 7)) - 1]}-${h.periodo.slice(0, 4)}` : h.mes ? MES[h.mes - 1] : "—"}</td>}
                          <td className="py-1.5 pr-3 text-[#26302B]">{h.texto}</td>
                          {conDif && <td className="py-1.5 text-right tabular-nums">{h.diferencia !== undefined ? usd(h.diferencia) : ""}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {c.hallazgos.length > 200 && <p className="text-[12px] text-[#6B7570] mt-2">Se muestran 200 de {c.hallazgos.length}.</p>}
                  <Link href={c.href} className="inline-block mt-3 text-[13px] font-semibold text-[#005A28] hover:underline">Ir a {DESTINO[c.id] ?? "la pantalla"} →</Link>
                </div>
              )}
            </div>
          );
        })}
        {!datos && !error && <div className="px-5 py-6 text-[13px] text-[#6B7570]">Revisando el presupuesto…</div>}
      </div>
    </div>
  );
}
