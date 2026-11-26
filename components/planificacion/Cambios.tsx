"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { escPres, type Mundo } from "../../lib/calc/plan2027";
import { cambiosPresupuesto, insumosEscenario, type AgenciaMotor, type CambioPresupuesto } from "../../lib/calc/plan-motor";
import { usd, pc, mill } from "./Comun";
import type { Escenario } from "./Integrado";
import { C } from "../ActivosComun";

/**
 * QUÉ CAMBIAR EN EL PRESUPUESTO: lista, pantalla por pantalla, los parámetros que habría que modificar para que el
 * presupuesto dé el escenario elegido. No modifica nada: los cambios se hacen a mano en cada pantalla.
 */
export function VentanaCambios({ Mpres, Mesc, ag, esc, nombres, onCerrar }: {
  Mpres: Mundo; Mesc: Mundo; ag: string; esc: Escenario; nombres?: Record<string, string>; onCerrar: () => void;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [onCerrar]);
  const base = Mpres.motor?.[ag]?.am as AgenciaMotor | undefined, amEsc = Mesc.motor?.[ag]?.am as AgenciaMotor | undefined;
  const lista: CambioPresupuesto[] = base && amEsc ? cambiosPresupuesto(base.ins, insumosEscenario(amEsc, esc.L), nombres) : [];
  const grupos = [...new Set(lista.map((c) => c.modulo))];
  const f = (c: CambioPresupuesto, v: number) => (c.formato === "pct" ? pc(v, 2) : c.formato === "usd" ? usd(v) : (Math.round(v * 100) / 100).toString().replace(".", ","));
  const pres = Mpres.motor?.[ag]?.correr(escPresDe(Mpres, ag))?.kpi.util;

  return (
    <div role="dialog" aria-modal="true" aria-label="Qué cambiar en el presupuesto" className="no-print fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto" style={{ background: "rgba(17,20,24,.35)" }} onClick={onCerrar}>
      <div className="bg-white rounded-xl w-full max-w-[920px] mt-6 shadow-xl" style={{ border: "1px solid #DDE2DF" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-6 py-4" style={{ borderBottom: "1px solid #DDE2DF" }}>
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[.08em]" style={{ color: C.acento }}>Qué cambiar en el presupuesto</div>
            <div className="text-[18px] font-bold mt-0.5">{esc.n} · Agencia {ag}</div>
            {pres !== undefined && (() => {
              const aj = esc.R.ajPlan, extra = aj ? aj.fondeo - aj.provMora : 0, enPres = esc.R.kpi.util - extra;
              return <div className="text-[13px] mt-1" style={{ color: C.texto2 }}>
                Con estos cambios el presupuesto pasa de {mill(pres)} a <b style={{ color: C.texto }}>{mill(enPres)}</b> de utilidad
                {Math.abs(extra) < 500 ? ", lo mismo que el escenario." : <>. El escenario da {mill(esc.R.kpi.util)} porque además calcula {aj && Math.abs(aj.provMora) >= 500 ? <>provisión por mora de {mill(aj.provMora)}</> : null}{aj && Math.abs(aj.provMora) >= 500 && Math.abs(aj.fondeo) >= 500 ? " y " : ""}{aj && Math.abs(aj.fondeo) >= 500 ? <>fondeo con otras oficinas de {mill(aj.fondeo)}</> : null}, que el presupuesto no calcula.</>}
              </div>;
            })()}
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#F3F5F4]"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-5">
          {!base || !amEsc ? <p className="text-[13px]" style={{ color: C.texto2 }}>Elige una agencia: el Consolidado es la suma de las agencias y los cambios se hacen en cada una.</p>
            : !lista.length ? <p className="text-[13px]" style={{ color: C.texto2 }}>El presupuesto ya tiene los parámetros de este escenario: no hay nada que cambiar.</p>
            : grupos.map((g) => (
              <div key={g}>
                <div className="text-[13px] font-bold mb-1.5">{g}</div>
                <table className="w-full text-[12px] border-collapse">
                  <thead><tr style={{ color: C.texto2, borderBottom: "1px solid #DDE2DF" }}><th className="text-left font-semibold py-1.5">Parámetro</th><th className="text-right font-semibold">En el presupuesto</th><th className="text-right font-semibold">Cambiar a</th><th className="text-left font-semibold pl-4" /></tr></thead>
                  <tbody>{lista.filter((c) => c.modulo === g).map((c) => (
                    <tr key={c.parametro} style={{ borderBottom: "1px solid #EEF1EF" }}>
                      <td className="py-1.5 pr-3">{c.parametro}</td><td className="text-right">{f(c, c.actual)}</td><td className="text-right font-bold" style={{ color: C.acento }}>{f(c, c.nuevo)}</td>
                      <td className="pl-4" style={{ color: C.texto2, fontSize: 11.5 }}>{c.nota ?? ""}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            ))}
        </div>
        <div className="flex justify-end gap-2 px-6 py-3" style={{ borderTop: "1px solid #DDE2DF" }}>
          <button type="button" onClick={onCerrar} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold" style={{ background: C.acento }}>Entendido</button>
        </div>
      </div>
    </div>
  );
}

const escPresDe = (M: Mundo, ag: string) => escPres(M, M.ags[ag]);
