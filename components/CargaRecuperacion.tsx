"use client";

import { useEffect, useState } from "react";
import { X, Save } from "lucide-react";
import ZonaArchivos from "./ZonaArchivos";
import { matrizDe, mensajeOtraPestana } from "../lib/detectar-archivo";
import { apiFetch } from "../lib/useDatos";
import { notificarCambioArchivo } from "../lib/cache-sistema";
import { C, Tarjeta, usd, pct } from "./ActivosComun";
import { parsearRecuperacion, type FilaRecuperacion, type ResultadoRecuperacion } from "../lib/recuperacion-parser";

/**
 * CARGA DE DATOS → Recuperación de cartera
 * Reporte "Recuperación de cartera Vigente y Vencida por Oficina" (un bloque por mes, todas las oficinas).
 * Planificación → Estudio de agencia lo usa para el ritmo real de la cartera (cobro de cuotas, precancelaciones,
 * recuperación de vencida y plazo).
 */
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const clave = (f: FilaRecuperacion) => `${f.oficina}|${f.periodo}|${f.tipo}`;
const per = (p: string) => { const [a, m] = p.split("-"); return `${MES[Number(m) - 1]}-${a.slice(2)}`; };

export function CargaRecuperacion() {
  const [leidas, setLeidas] = useState<Map<string, FilaRecuperacion>>(new Map());
  const [archivos, setArchivos] = useState<string[]>([]);
  const [errores, setErrores] = useState<string[]>([]);
  const [avisosArchivo, setAvisosArchivo] = useState<string[]>([]);
  const [guardadas, setGuardadas] = useState<FilaRecuperacion[]>([]);
  const [version, setVersion] = useState(0);
  const [aviso, setAviso] = useState<{ t: string; e?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/recuperacion-cartera").then((r) => r.json()).then((j) => { if (vivo && !j.error) setGuardadas(j.filas ?? []); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [version]);

  async function leer(lista: File[]) {
    setAviso(null);
    const nuevas = new Map(leidas); const errs = [...errores]; const avs = [...avisosArchivo]; const nombres = [...archivos];
    for (const f of lista) {
      let datos: ArrayBuffer | null = null;
      try {
        datos = await f.arrayBuffer();
        const r: ResultadoRecuperacion = parsearRecuperacion(matrizDe(datos));
        if (!r.filas.length) { errs.push(mensajeOtraPestana(f.name, datos, "Recuperación de cartera", "no se encontraron meses con filas VIGENTE y VENCIDO por oficina.")); continue; }
        // un mes y oficina que ya vino en otro archivo no se toma dos veces
        const repetidas = r.filas.filter((x) => nuevas.has(clave(x)));
        if (repetidas.length) { errs.push(`${f.name}: ${[...new Set(repetidas.map((x) => `${x.oficina} ${per(x.periodo)}`))].slice(0, 6).join(", ")} ya vienen en otro archivo; no se toma este archivo.`); continue; }
        for (const x of r.filas) nuevas.set(clave(x), x);
        avs.push(...r.avisos.map((a) => `${f.name}: ${a}`)); nombres.push(f.name);
      } catch (e) { errs.push(datos ? mensajeOtraPestana(f.name, datos, "Recuperación de cartera", e instanceof Error ? e.message : "no se pudo leer.") : `${f.name}: no se pudo leer.`); }
    }
    setLeidas(nuevas); setErrores(errs); setAvisosArchivo(avs); setArchivos(nombres);
  }
  function descartar() { setLeidas(new Map()); setErrores([]); setAvisosArchivo([]); setArchivos([]); }
  async function guardar() {
    const filas = [...leidas.values()];
    if (!filas.length) return;
    setOcupado(true); setAviso(null);
    try {
      const r = await apiFetch("/api/recuperacion-cartera", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filas }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
      const meses = new Set(filas.map((x) => x.periodo)).size, ofs = new Set(filas.map((x) => x.oficina)).size;
      setAviso({ t: `Recuperación de cartera guardada: ${meses} ${meses === 1 ? "mes" : "meses"}, ${ofs} oficinas.` });
      notificarCambioArchivo("subida", "Recuperación de cartera"); descartar(); setVersion((v) => v + 1);
    } catch (e) { setAviso({ t: e instanceof Error ? e.message : "No se pudo guardar.", e: true }); }
    finally { setOcupado(false); }
  }
  const lista = [...leidas.values()];
  const mesesLeidos = [...new Set(lista.map((x) => x.periodo))].sort();

  // resumen de lo guardado: por mes, % neto recuperado de vigente y vencido de todas las oficinas
  const periodos = [...new Set(guardadas.map((f) => f.periodo))].sort().reverse();
  const res = (p: string, t: string) => { const x = guardadas.filter((f) => f.periodo === p && f.tipo === t); const cap = x.reduce((a, f) => a + Number(f.capital), 0), net = x.reduce((a, f) => a + Number(f.neto), 0); return { cap, net, prec: x.reduce((a, f) => a + Number(f.precancelados), 0), n: x.length }; };
  return (
    <div className="flex flex-col gap-5 pb-6">
      {aviso && <p className="text-[12px] -my-2" style={{ color: aviso.e ? C.alerta : C.ok }}>{aviso.t}</p>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Tarjeta titulo="Recuperación de cartera vigente y vencida">
          <div className="p-4 flex flex-col gap-3">
            {leidas.size > 0 || errores.length > 0 ? <>
              {mesesLeidos.length > 0 && (
                <table className="w-full text-[12px] border-collapse">
                  <thead><tr style={{ color: C.texto2, height: 30, borderBottom: "2px solid #DDE2DF" }}>
                    <th className="text-left font-semibold">Mes</th><th className="px-3 text-right font-semibold">Oficinas</th><th className="text-right font-semibold">Estado</th>
                  </tr></thead>
                  <tbody>{mesesLeidos.map((p) => {
                    const ofs = new Set(lista.filter((x) => x.periodo === p).map((x) => x.oficina));
                    const ya = guardadas.some((g) => g.periodo === p && ofs.has(g.oficina));
                    return (
                      <tr key={p} style={{ borderTop: `1px solid ${C.beige}`, height: 30 }}>
                        <td style={{ color: C.texto }}>{per(p)}</td><td className="px-3 text-right" style={{ color: C.texto3 }}>{ofs.size}</td>
                        <td className="text-right" style={{ color: ya ? C.aviso : C.ok }}>{ya ? "Reemplaza el cargado" : "Nuevo"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
              {[...avisosArchivo, ...errores].length > 0 && (
                <ul className="text-[12px] flex flex-col gap-0.5" style={{ color: C.alerta }}>
                  {[...avisosArchivo, ...errores].slice(0, 20).map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={descartar} className="h-9 px-3.5 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid #C9D0CC", color: C.texto }}><X className="w-4 h-4" /> Descartar</button>
                {leidas.size > 0 && <button type="button" onClick={guardar} disabled={ocupado} className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-60" style={{ background: C.acento }}>
                  <Save className="w-4 h-4" /> {ocupado ? "Guardando..." : `Guardar ${archivos.length} ${archivos.length === 1 ? "archivo" : "archivos"}`}
                </button>}
              </div>
            </> : <ZonaArchivos texto="Subir reporte de recuperación de cartera" onArchivos={leer} />}
          </div>
        </Tarjeta>
        <Tarjeta titulo={`Meses cargados (${periodos.length})`}>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-white"><tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 text-left font-semibold">Mes</th><th className="px-3 text-right font-semibold">Oficinas</th>
                <th className="px-3 text-right font-semibold">Capital vigente</th><th className="px-3 text-right font-semibold">% neto vigente</th>
                <th className="px-3 text-right font-semibold">Precancelados</th><th className="pr-4 text-right font-semibold">% neto vencido</th>
              </tr></thead>
              <tbody>{periodos.map((p) => { const v = res(p, "VIGENTE"), w = res(p, "VENCIDO"); return (
                <tr key={p} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4">{per(p)}</td><td className="px-3 text-right">{v.n}</td><td className="px-3 text-right">{usd(v.cap)}</td>
                  <td className="px-3 text-right">{v.cap ? pct(v.net / v.cap, 1) : "—"}</td><td className="px-3 text-right">{usd(v.prec)}</td>
                  <td className="pr-4 text-right">{w.cap ? pct(w.net / w.cap, 1) : "—"}</td>
                </tr>); })}</tbody>
            </table>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}
