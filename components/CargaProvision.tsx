"use client";

import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import ZonaArchivos from "./ZonaArchivos";
import { apiFetch } from "../lib/useDatos";
import { notificarCambioArchivo } from "../lib/cache-sistema";
import { C, Tarjeta, usd } from "./ActivosComun";
import { parsearCalificacion, type ResultadoCalificacion } from "../lib/provision-parsers";
import { matrizDe, mensajeOtraPestana } from "../lib/detectar-archivo";
import type { FilaCalificacion } from "../lib/provision-flow-db";
import type { EstadoProvisionFlow } from "./ProvisionFlowParametros";

/**
 * CARGA DE DATOS → Calificación de cartera
 *  - CalificacionCartera_Report.xlsx tal como sale del sistema: uno o varios cortes (archivos sueltos o .zip). El corte y
 *    las agencias se leen del contenido. Si un corte viene en varios archivos (uno por agencia), se juntan.
 *  - El estado de resultados del Consolidado (4402, 5604.10, 5604.05) llega desde la pestaña Estados de resultados.
 * Con estos datos el modelo de provisión toma su estado inicial y se recalibra (Cartera de crédito → Provisión).
 */
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const per = (p: string) => { const [a, m] = p.split("-"); return `${MES[Number(m) - 1]}-${a.slice(2)}`; };

/** Un corte leído: puede juntar varios archivos (agencias distintas del mismo corte). */
interface Corte { periodo: string; corte: string; archivos: string[]; filas: FilaCalificacion[]; oficinas: string[] }

export function CargaProvision() {
  const [d, setD] = useState<EstadoProvisionFlow | null>(null);
  const [version, setVersion] = useState(0);
  const [cortes, setCortes] = useState<Map<string, Corte>>(new Map());
  const [errores, setErrores] = useState<string[]>([]);
  const [progreso, setProgreso] = useState<{ t: string; n: number; total: number } | null>(null);
  const [aviso, setAviso] = useState<{ t: string; e?: boolean } | null>(null);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/provision-flow-parametros").then((r) => r.json()).then((j) => { if (vivo && !j.error) setD(j); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [version]);

  async function leer(archivos: File[]) {
    setAviso(null);
    const nuevos = new Map(cortes); const errs = [...errores];
    for (let i = 0; i < archivos.length; i++) {
      const f = archivos[i];
      setProgreso({ t: "Leyendo", n: i + 1, total: archivos.length });
      let datos: ArrayBuffer | null = null;
      try {
        datos = await f.arrayBuffer();
        const r: ResultadoCalificacion = parsearCalificacion(matrizDe(datos, true) as never);
        const previo = nuevos.get(r.periodo);
        if (previo) {
          // el mismo corte en otro archivo: se junta solo si trae otras agencias (si se repite una, se sumaría dos veces)
          const repetidas = r.oficinas.filter((o) => previo.oficinas.includes(o));
          if (repetidas.length) { errs.push(`${f.name}: el corte ${r.corte} de ${repetidas.join(", ")} ya está en ${previo.archivos.join(", ")}; no se toma dos veces.`); continue; }
          nuevos.set(r.periodo, { ...previo, archivos: [...previo.archivos, f.name], filas: [...previo.filas, ...r.filas], oficinas: [...previo.oficinas, ...r.oficinas] });
        } else nuevos.set(r.periodo, { periodo: r.periodo, corte: r.corte, archivos: [f.name], filas: r.filas, oficinas: r.oficinas });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "no se pudo leer.";
        errs.push(datos ? mensajeOtraPestana(f.name, datos, "Calificación de cartera", msg) : `${f.name}: no se pudo leer.`);
      }
    }
    setProgreso(null); setCortes(nuevos); setErrores(errs);
  }

  async function guardar() {
    const lista = [...cortes.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
    setAviso(null);
    const hechos: string[] = [];
    try {
      for (let i = 0; i < lista.length; i++) {
        setProgreso({ t: "Guardando", n: i + 1, total: lista.length });
        const r = await apiFetch("/api/provision-flow-parametros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "calificacion", filas: lista[i].filas }) });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(`Corte ${per(lista[i].periodo)}: ${j.error ?? `Error ${r.status}`}`);
        hechos.push(lista[i].periodo);
      }
      setAviso({ t: `${hechos.length === 1 ? "Corte guardado" : `${hechos.length} cortes guardados`}: ${hechos.map(per).join(", ")}.` });
      setCortes(new Map()); setErrores([]);
    } catch (e) {
      setAviso({ t: `${hechos.length ? `Se guardaron ${hechos.map(per).join(", ")}. ` : ""}${e instanceof Error ? e.message : "No se pudo guardar."}`, e: true });
      setCortes((m) => { const n = new Map(m); for (const p of hechos) n.delete(p); return n; });
    } finally {
      if (hechos.length) { notificarCambioArchivo("subida", `Calificación de Cartera ${hechos.map(per).join(", ")}`); setVersion((v) => v + 1); }
      setProgreso(null);
    }
  }

  const leidos = [...cortes.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  const cargados = d ? [...d.periodos].reverse() : [];
  const suma = (fs: FilaCalificacion[], k: "saldo" | "prov") => fs.reduce((t, f) => t + f[k], 0);
  return (
    <div className="flex flex-col gap-5 pb-6">
      {aviso && <p className="text-[12px] -my-2" style={{ color: aviso.e ? C.alerta : C.ok }}>{aviso.t}</p>}
      <Tarjeta titulo="Calificación de cartera"
        derecha={(leidos.length > 0 || errores.length > 0) && !progreso ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setCortes(new Map()); setErrores([]); }} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid #C9D0CC", color: C.texto }}><X className="w-4 h-4" /> Descartar</button>
            {leidos.length > 0 && <button type="button" onClick={guardar} className="h-8 px-3 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5" style={{ background: C.acento }}><Save className="w-4 h-4" /> Guardar {leidos.length} {leidos.length === 1 ? "corte" : "cortes"}</button>}
          </div>
        ) : undefined}>
        <div className="p-4">
          {progreso ? (
            <div className="flex flex-col gap-2 py-6 items-center">
              <span className="text-[13px] font-semibold">{`${progreso.t} ${progreso.n} de ${progreso.total}`}</span>
              <div className="w-full max-w-md h-2 rounded-full" style={{ background: "#EEF1EF" }}>
                <div className="h-full rounded-full" style={{ width: `${(progreso.n / progreso.total) * 100}%`, background: C.acento }} />
              </div>
            </div>
          ) : <ZonaArchivos texto="Subir CalificacionCartera_Report" onArchivos={leer} />}
        </div>
        {leidos.length > 0 && !progreso && (
          <div className="overflow-x-auto" style={{ borderTop: `1px solid ${C.beige}` }}>
            <table className="w-full text-[12px] border-collapse">
              <thead><tr style={{ color: C.texto2, height: 32, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 text-left font-semibold">Corte</th><th className="px-3 text-right font-semibold">Agencias</th>
                <th className="px-3 text-right font-semibold">Filas</th><th className="px-3 text-right font-semibold">Cartera</th>
                <th className="px-3 text-right font-semibold">Provisión</th><th className="pr-4 text-right font-semibold">Estado</th>
              </tr></thead>
              <tbody>{leidos.map((c) => {
                const ya = d?.periodos.some((p) => p.periodo === c.periodo);
                // el corte se reemplaza completo: las oficinas cargadas que no vienen en el archivo se perderían
                const antes = d?.oficinasPorCorte?.[c.periodo] ?? [];
                const pierde = antes.filter((o) => !c.oficinas.includes(o));
                return (
                  <tr key={c.periodo} style={{ borderTop: `1px solid ${C.beige}`, height: 30 }}>
                    <td className="pl-4" style={{ color: C.texto }}>{c.corte}</td>
                    <td className="px-3 text-right" title={c.oficinas.join(", ")} style={{ color: C.texto3 }}>{c.oficinas.length}</td>
                    <td className="px-3 text-right" style={{ color: C.texto3 }}>{c.filas.length.toLocaleString("es-EC")}</td>
                    <td className="px-3 text-right" style={{ color: C.texto3 }}>{usd(suma(c.filas, "saldo"))}</td>
                    <td className="px-3 text-right" style={{ color: C.texto3 }}>{usd(suma(c.filas, "prov"))}</td>
                    <td className="pr-4 text-right" style={{ color: pierde.length ? C.alerta : ya ? C.aviso : C.ok }}
                        title={pierde.length ? `Se perderían: ${pierde.join(", ")}` : undefined}>
                      {pierde.length ? `Reemplaza el corte: el cargado tiene ${antes.length} agencias y el archivo trae ${c.oficinas.length}` : ya ? "Reemplaza el corte cargado" : "Nuevo"}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {errores.length > 0 && !progreso && (
          <ul className="px-4 py-3 text-[12px] flex flex-col gap-0.5" style={{ borderTop: `1px solid ${C.beige}`, color: C.alerta }}>
            {errores.slice(0, 20).map((e) => <li key={e}>{e}</li>)}
            {errores.length > 20 && <li>… y {errores.length - 20} más</li>}
          </ul>
        )}
      </Tarjeta>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Tarjeta titulo={`Cortes cargados (${cargados.length})`}>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-white"><tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 text-left font-semibold">Corte</th><th className="px-3 text-right font-semibold">Filas</th><th className="pr-4 text-right font-semibold">Cartera</th>
              </tr></thead>
              <tbody>{cargados.map((p) => (
                <tr key={p.periodo} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4">{p.corte}</td><td className="px-3 text-right">{p.filas}</td><td className="pr-4 text-right">{usd(d?.carteraPorCorte?.[p.periodo] ?? 0)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Tarjeta>
        <Tarjeta titulo={`Estado de resultados del Consolidado para la provisión (${d?.eerr.length ?? 0})`}>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-white"><tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 text-left font-semibold">Mes</th><th className="px-3 text-right font-semibold">4402</th><th className="px-3 text-right font-semibold">5604.10</th><th className="pr-4 text-right font-semibold">5604.05</th>
              </tr></thead>
              <tbody>{[...(d?.eerr ?? [])].reverse().map((m) => (
                <tr key={m.periodo} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4">{per(m.periodo)}</td><td className="px-3 text-right">{usd(m.g4402)}</td><td className="px-3 text-right">{usd(m.r560410)}</td><td className="pr-4 text-right">{usd(m.r560405)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}
