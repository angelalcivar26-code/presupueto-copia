"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/useDatos";
import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { AGENCIAS } from "../../components/ActivosComun";
import AnioEjercicio from "../../components/AnioEjercicio";
import { armarLibroMetas, reunirDatosMetas, totalesCooperativa } from "../../lib/metas-agencia-excel";

const claseBoton = "h-10 px-5 rounded-lg text-[13px] font-semibold disabled:opacity-50";

const pedir = async (url: string) => {
  const r = await apiFetch(url, { cache: "no-store" });
  return r.json();
};

/** Nombre de archivo sin tildes ni ñ (algunos navegadores los descartan al descargar). */
const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, "n").replace(/Ñ/g, "N");

function guardar(blob: Blob, nombre: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = sinTildes(nombre);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Metas por agencia: descarga el Excel de metas de una agencia, del Consolidado o de las 10 agencias (.zip). */
export default function MetasAgenciaPage() {
  const [agencia, setAgencia] = useAgencia(true);
  const [ejercicio] = useEjercicio();
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ocupado = estado !== null;

  async function libro(ag: string, coop?: Awaited<ReturnType<typeof totalesCooperativa>>) {
    const ExcelJS = (await import("exceljs")).default;
    const d = await reunirDatosMetas(ag, ejercicio, pedir, coop);
    const wb = await armarLibroMetas(ExcelJS, d);
    return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  async function una() {
    setError(null); setEstado(`Preparando ${agencia}…`);
    try { guardar(await libro(agencia), `Metas ${ejercicio} - ${agencia}.xlsx`); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo generar el archivo."); }
    finally { setEstado(null); }
  }

  async function todas() {
    setError(null);
    try {
      setEstado("Preparando los totales de la cooperativa…");
      const coop = await totalesCooperativa(ejercicio, pedir);
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const fallidas: string[] = [];
      for (const [i, ag] of AGENCIAS.entries()) {
        setEstado(`Preparando ${ag} (${i + 1} de ${AGENCIAS.length})…`);
        try { zip.file(`Metas ${ejercicio} - ${ag}.xlsx`, await libro(ag, coop)); }
        catch (e) { fallidas.push(`${ag}: ${e instanceof Error ? e.message : "error"}`); }
      }
      if (fallidas.length === AGENCIAS.length) throw new Error(`Ninguna agencia se pudo generar. ${fallidas[0]}`);
      setEstado("Comprimiendo…");
      guardar(await zip.generateAsync({ type: "blob" }), `Metas ${ejercicio} - 10 agencias.zip`);
      if (fallidas.length) setError(`No se generaron: ${fallidas.join(" · ")}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo generar el archivo."); }
    finally { setEstado(null); }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="text-[20px] font-bold text-[#111418] mb-5">Metas por agencia<AnioEjercicio /></h1>
      <div className="bg-white rounded-2xl border border-[#E3E6E4] p-6 max-w-[760px]">
        <label className="flex flex-col gap-1.5 mb-5 max-w-[280px]">
          <span className="text-[12px] font-semibold text-[#26302B]">Agencia</span>
          <select value={agencia} onChange={(e) => setAgencia(e.target.value)} disabled={ocupado}
                  className="h-10 px-3 rounded-lg border border-[#D5DAD7] bg-white text-[14px] outline-none focus:border-[#005A28] focus:ring-2 focus:ring-[#005A28]/20">
            {[...AGENCIAS, "Consolidado"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${claseBoton} bg-[#005A28] text-white hover:bg-[#004A21]`} onClick={una} disabled={ocupado}>
            Descargar metas de {agencia}
          </button>
          <button type="button" className={`${claseBoton} border border-[#D5DAD7] bg-white text-[#26302B] hover:bg-[#F4F6F5]`} onClick={todas} disabled={ocupado}>
            Descargar las 10 agencias (.zip)
          </button>
        </div>
        {estado && <p role="status" className="mt-4 text-[13px] text-[#4A554F]">{estado}</p>}
        {error && <p role="alert" className="mt-4 text-[13px] text-[#9B1C1C]">{error}</p>}
      </div>
    </div>
  );
}
