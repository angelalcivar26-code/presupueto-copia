"use client";

import { useEffect, useState } from "react";
import { apiFetch, errorDeRespuesta } from "../../../lib/useDatos";
import { useEjercicio } from "../../../lib/seleccion";
import { CampoNumero, hayCamposConError, MENSAJE_CAMPOS_CON_ERROR } from "../../../components/GuardiaCambios";
import { usePendiente } from "../../../lib/cambios-pendientes";

interface Def { clave: string; nombre: string; unidad: "usd" | "pct"; defecto: number; fuente: string; afecta: string; min: number; max: number }
interface Datos { definiciones: Def[]; valores: Record<string, { valor: number; guardado: boolean }> }

const claseBoton = "h-9 px-4 rounded-lg text-[13px] font-semibold border border-[#D5DAD7] bg-white text-[#26302B] hover:bg-[#F4F6F5] disabled:opacity-50";
const claseBotonPrincipal = "h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-[#005A28] hover:bg-[#004A21] disabled:opacity-50";

function mostrar(d: Def, v: number): string {
  return d.unidad === "usd"
    ? `$${v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${(v * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %`;
}

/** Administración → Parámetros institucionales: valores de ley y de política, por ejercicio. */
export default function ParametrosInstitucionalesPage() {
  const [ejercicio] = useEjercicio();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [edicion, setEdicion] = useState<Record<string, number | null> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/parametros-institucionales?ejercicio=${ejercicio}`).then(async (r) => {
      const e = await errorDeRespuesta(r.clone());
      if (!vivo) return;
      if (e) { setError(e); return; }
      setDatos(await r.json());
    }).catch(() => { if (vivo) setError("No hay conexión con el servidor."); });
    return () => { vivo = false; };
  }, [ejercicio, version]);

  async function guardar(): Promise<boolean> {
    if (!edicion) return true;
    if (hayCamposConError()) { setError(MENSAJE_CAMPOS_CON_ERROR); return false; }
    setGuardando(true); setError(null);
    try {
      const valores = Object.fromEntries(Object.entries(edicion).filter(([, v]) => v !== null));
      const r = await apiFetch(`/api/parametros-institucionales?ejercicio=${ejercicio}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores }),
      });
      const e = await errorDeRespuesta(r);
      if (e) { setError(e); return false; }
      setEdicion(null); setAviso(`Parámetros del ejercicio ${ejercicio} guardados. El presupuesto se recalcula con los valores nuevos.`); setVersion((x) => x + 1);
      return true;
    } catch { setError("No hay conexión con el servidor."); return false; }
    finally { setGuardando(false); }
  }
  usePendiente(edicion ? { descripcion: `Parámetros institucionales ${ejercicio}`, guardar, descartar: () => setEdicion(null) } : null);

  return (
    <div className="px-8 py-8 max-w-[1200px]">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111418]">Parámetros institucionales<span className="font-normal text-[#6B7570]"> · {ejercicio}</span></h1>
        </div>
        {datos && (edicion ? (
          <div className="flex gap-2">
            <button type="button" className={claseBoton} disabled={guardando} onClick={() => { setEdicion(null); setError(null); }}>Cancelar</button>
            <button type="button" className={claseBotonPrincipal} disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        ) : (
          <button type="button" className={claseBoton} onClick={() => { setAviso(null); setEdicion(Object.fromEntries(datos.definiciones.map((d) => [d.clave, datos.valores[d.clave].valor]))); }}>Editar</button>
        ))}
      </div>

      {error && <p role="alert" className="mb-4 text-[13px] text-[#9B1C1C]">{error}</p>}
      {aviso && <p role="status" className="mb-4 text-[13px] text-[#0B5A2A]">{aviso}</p>}

      <div className="bg-white rounded-2xl border border-[#E3E6E4] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[860px]">
          <thead>
            <tr className="text-left text-[11px] font-bold tracking-[0.04em] text-[#26302B] border-b border-[#E3E6E4]">
              <th className="px-5 py-3">PARÁMETRO</th>
              <th className="px-3 py-3 text-right w-[160px]">VALOR</th>
              <th className="px-3 py-3">FUENTE</th>
              <th className="px-5 py-3">SE USA EN</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.definiciones ?? []).map((d) => {
              const v = datos!.valores[d.clave];
              const cambiado = v.valor !== d.defecto;
              return (
                <tr key={d.clave} className="border-b border-[#EEF1EF] last:border-0">
                  <td className="px-5 py-3 font-medium text-[#111418]">{d.nombre}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {edicion ? (
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        {d.unidad === "usd" && <span className="text-[#6B7570]">$</span>}
                        <CampoNumero valor={edicion[d.clave]} onValor={(x) => setEdicion({ ...edicion, [d.clave]: x })} etiqueta={d.nombre}
                          escala={d.unidad === "pct" ? 100 : 1} decimales={d.unidad === "pct" ? 2 : 2}
                          min={d.unidad === "pct" ? d.min * 100 : d.min} max={d.unidad === "pct" ? d.max * 100 : d.max}
                          className="h-8 w-[96px] px-2 rounded-md border border-[#C9D0CC] text-right text-[13px]" />
                        {d.unidad === "pct" && <span className="text-[#6B7570]">%</span>}
                      </span>
                    ) : (
                      <span className="font-semibold tabular-nums" title={cambiado ? `Antes: ${mostrar(d, d.defecto)}` : undefined}>{mostrar(d, v.valor)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[#4A554F]">{d.fuente}</td>
                  <td className="px-5 py-3 text-[#4A554F]">{d.afecta}</td>
                </tr>
              );
            })}
            {!datos && !error && <tr><td colSpan={4} className="px-5 py-6 text-[#6B7570]">Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
