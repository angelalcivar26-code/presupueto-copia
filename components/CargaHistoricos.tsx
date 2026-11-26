"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Save, X } from "lucide-react";
import ZonaArchivos from "./ZonaArchivos";
import { apiFetch } from "../lib/useDatos";
import { notificarCambioArchivo } from "../lib/cache-sistema";
import { C, Tarjeta } from "./ActivosComun";
import { parsearHistorico, type ArchivoHistorico } from "../lib/historico-parser";
import { mensajeOtraPestana } from "../lib/detectar-archivo";

/**
 * CARGA DE DATOS → Balances, Estados de resultados y Cuentas de orden (una pestaña cada uno): balances, estados de resultados y cuentas contingentes y de orden mensuales por agencia (los .zip tal como
 * salen de las carpetas, o los .xlsx sueltos). El mes y la oficina se leen del contenido de cada archivo.
 * Alimentan Planificación (Diagnóstico y Comparar agencias).
 */
const OFICINAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];
type Tipo = "BAL" | "ER" | "CO";
type Inv = { oficina: string; periodo: string; tipo: Tipo }[];

async function leerLibro(datos: ArrayBuffer, nombre: string) {
  const wb = XLSX.read(datos, { cellDates: true });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
  return parsearHistorico(filas, nombre);
}

/** Cuadro oficina × año: cuántos meses hay cargados de este tipo. */
function Cobertura({ inv }: { inv: Inv }) {
  const anios = [...new Set(inv.map((x) => x.periodo.slice(0, 4)))].sort();
  const cuenta = (o: string, a: string) => new Set(inv.filter((x) => x.oficina === o && x.periodo.startsWith(a)).map((x) => x.periodo)).size;
  const oficinas = OFICINAS.filter((o) => inv.some((x) => x.oficina === o));
  if (!oficinas.length) return <p className="px-4 py-3 text-[12px]" style={{ color: C.texto2 }}>Sin datos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
            <th className="pl-4 text-left font-semibold">Oficina</th>
            {anios.map((a) => <th key={a} className="px-3 text-right font-semibold whitespace-nowrap">{a}</th>)}
          </tr>
        </thead>
        <tbody>
          {oficinas.map((o) => (
            <tr key={o} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
              <td className="pl-4" style={{ color: C.texto3 }}>{o}</td>
              {anios.map((a) => {
                const n = cuenta(o, a); const esperado = a === anios[0] && n === 1 ? 1 : 12;
                return <td key={a} className="px-3 text-right tabla-cifras" style={{ color: n === 0 ? C.tenue : n < esperado && a !== anios[anios.length - 1] ? C.aviso : C.texto }}>{n ? `${n} ${n === 1 ? "mes" : "meses"}` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MES_TXT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const perTxt = (p: string) => `${MES_TXT[Number(p.slice(5, 7)) - 1]}-${p.slice(0, 4)}`;
/** Lo leído antes de guardar: cada archivo con su agencia y mes (tomados del contenido) y si reemplaza uno ya cargado. */
function Leidos({ lista, inv }: { lista: ArchivoHistorico[]; inv: Inv }) {
  const orden = [...lista].sort((a, b) => OFICINAS.indexOf(a.oficina) - OFICINAS.indexOf(b.oficina) || a.periodo.localeCompare(b.periodo));
  return (
    <div className="max-h-[320px] overflow-y-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 bg-white">
          <tr style={{ color: C.texto2, height: 32, borderBottom: "2px solid #DDE2DF" }}>
            <th className="pl-4 text-left font-semibold">Agencia</th><th className="px-3 text-left font-semibold">Mes</th>
            <th className="px-3 text-right font-semibold">Cuentas</th><th className="pr-4 text-right font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody>
          {orden.map((a) => {
            const ya = inv.some((y) => y.oficina === a.oficina && y.periodo === a.periodo);
            return (
              <tr key={`${a.oficina}|${a.periodo}`} style={{ borderTop: `1px solid ${C.beige}`, height: 30 }}>
                <td className="pl-4" style={{ color: C.texto }}>{a.oficina}</td>
                <td className="px-3" style={{ color: C.texto3 }}>{perTxt(a.periodo)}</td>
                <td className="px-3 text-right tabla-cifras" style={{ color: C.texto3 }}>{Object.keys(a.cuentas).length}</td>
                <td className="pr-4 text-right" style={{ color: ya ? C.aviso : C.ok }}>{ya ? "Reemplaza el cargado" : "Nuevo"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const NOMBRE_TIPO: Record<Tipo, { uno: string; varios: string; titulo: string }> = {
  BAL: { uno: "balance", varios: "Balances", titulo: "Balances mensuales" },
  ER: { uno: "estado de resultados", varios: "Estados de resultados", titulo: "Estados de resultados mensuales" },
  CO: { uno: "archivo de cuentas de orden", varios: "Cuentas de orden", titulo: "Cuentas contingentes y de orden mensuales" },
};

/** Una pestaña de Carga de datos por tipo (balances, estados de resultados o cuentas de orden). */
export function CargaHistoricos({ tipo }: { tipo: Tipo }) {
  const nt = NOMBRE_TIPO[tipo];
  const [inv, setInv] = useState<Inv>([]);
  const [version, setVersion] = useState(0);
  const [leidos, setLeidos] = useState<Map<string, ArchivoHistorico>>(new Map());
  const [errores, setErrores] = useState<string[]>([]);
  const [progreso, setProgreso] = useState<{ t: string; n: number; total: number } | null>(null);
  const [aviso, setAviso] = useState<{ t: string; e?: boolean } | null>(null);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/historico?vista=inventario").then((r) => r.json()).then((j) => { if (vivo && j.inventario) setInv((j.inventario as Inv).filter((x) => x.tipo === tipo)); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [version, tipo]);

  async function leer(archivos: File[]) {
    setAviso(null);
    const nuevos = new Map(leidos); const errs = [...errores];
    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ t: "Leyendo", n: i + 1, total: archivos.length });
      try {
        const datos = await archivos[i].arrayBuffer();
        const r = await leerLibro(datos, archivos[i].name);
        if ("error" in r) errs.push(mensajeOtraPestana(archivos[i].name, datos, nt.varios as never, r.error.replace(`${archivos[i].name}: `, "")));
        // un archivo de otro tipo no se guarda aquí: se indica en qué pestaña va
        else if (r.tipo !== tipo) errs.push(`${archivos[i].name}: es el ${NOMBRE_TIPO[r.tipo].uno} de ${r.oficina} (${perTxt(r.periodo)}); súbalo en la pestaña ${NOMBRE_TIPO[r.tipo].varios}.`);
        else nuevos.set(`${r.oficina}|${r.periodo}|${r.tipo}`, r);
      } catch { errs.push(`${archivos[i].name}: no se pudo leer.`); }
      if (i % 20 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    setProgreso(null); setLeidos(nuevos); setErrores(errs);
  }

  async function guardar() {
    const lista = [...leidos.values()];
    setAviso(null);
    try {
      for (let i = 0; i < lista.length; i += 12) {
        setProgreso({ t: "Guardando", n: Math.min(i + 12, lista.length), total: lista.length });
        const r = await apiFetch("/api/historico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivos: lista.slice(i, i + 12) }) });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
      }
      // Una sola vez al final: indicadores por oficina y mes (Planificación lee solo este resumen)
      setProgreso({ t: "Calculando indicadores", n: lista.length, total: lista.length });
      let oficinas = [...new Set(lista.map((x) => x.oficina))];
      for (let vuelta = 0; oficinas.length && vuelta < 12; vuelta++) {
        const rr = await apiFetch("/api/historico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "recalcular", oficinas }) });
        const jj = await rr.json();
        if (!rr.ok || jj.error) throw new Error(jj.error ?? `Error ${rr.status}`);
        oficinas = jj.faltan ?? [];
      }
      // el estado de resultados del Consolidado también alimenta el modelo de provisión (4402, 5604.10, 5604.05).
      // En orden de fecha (cada mes se mensualiza con los anteriores). Un mes de un año sin los meses previos
      // (p. ej. solo dic-2023, para comparar) se guarda igual en Históricos; solo no pasa a la provisión, que no lo usa.
      const sinProvision: string[] = [];
      if (tipo === "ER") {
        for (const a of lista.filter((x) => x.oficina === "Consolidado").sort((x, y) => x.periodo.localeCompare(y.periodo))) {
          const v = (c: string) => Number(a.cuentas[c]) || 0;
          const rp = await apiFetch("/api/provision-flow-parametros", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "eerr", periodo: a.periodo, acumulado: { g4402: v("4402"), r560410: v("560410"), r560405: v("560405") } }) });
          const jp = await rp.json().catch(() => ({}));
          if (rp.status === 400 && /faltan los meses anteriores/.test(String(jp.error ?? ""))) { sinProvision.push(perTxt(a.periodo)); continue; }
          if (!rp.ok || jp.error) throw new Error(`Los estados de resultados se guardaron, pero no se pudo pasar ${perTxt(a.periodo)} del Consolidado a la provisión de cartera: ${jp.error ?? `Error ${rp.status}`}`);
        }
      }
      if (sinProvision.length) {
        setAviso({ t: `${lista.length} ${lista.length === 1 ? "archivo guardado" : "archivos guardados"}. ${sinProvision.join(", ")}: guardado en Históricos; no se usa en la provisión porque faltan los meses anteriores de ese año (no hace falta).` });
        notificarCambioArchivo("subida", `${nt.varios} (${lista.length} archivos)`);
        setLeidos(new Map()); setErrores([]); setVersion((v) => v + 1);
        return;
      }
      setAviso({ t: `${lista.length} ${lista.length === 1 ? "archivo guardado" : "archivos guardados"}.` });
      notificarCambioArchivo("subida", `${nt.varios} (${lista.length} archivos)`);
      setLeidos(new Map()); setErrores([]); setVersion((v) => v + 1);
    } catch (e) { setAviso({ t: e instanceof Error ? e.message : "No se pudo guardar.", e: true }); }
    finally { setProgreso(null); }
  }

  const invLeidos = useMemo<Inv>(() => [...leidos.values()].map((x) => ({ oficina: x.oficina, periodo: x.periodo, tipo: x.tipo })), [leidos]);
  const reemplaza = invLeidos.filter((x) => inv.some((y) => y.oficina === x.oficina && y.periodo === x.periodo && y.tipo === x.tipo)).length;

  return (
    <div className="flex flex-col gap-5 pb-6">
      {aviso && <p className="text-[12px] -my-2" style={{ color: aviso.e ? C.alerta : C.ok }}>{aviso.t}</p>}
      <Tarjeta titulo={nt.titulo}
        derecha={(leidos.size > 0 || errores.length > 0) && !progreso ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setLeidos(new Map()); setErrores([]); }} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid #C9D0CC", color: C.texto }}><X className="w-4 h-4" /> Descartar</button>
            {leidos.size > 0 && <button type="button" onClick={guardar} className="h-8 px-3 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5" style={{ background: C.acento }}><Save className="w-4 h-4" /> Guardar {leidos.size} {leidos.size === 1 ? "archivo" : "archivos"}</button>}
          </div>
        ) : undefined}>
        <div className="p-4 flex flex-col gap-3">
          {progreso ? (
            <div className="flex flex-col gap-2 py-6 items-center">
              <span className="text-[13px] font-semibold">{progreso.t === "Calculando indicadores" ? "Calculando indicadores…" : `${progreso.t} ${progreso.n} de ${progreso.total}`}</span>
              <div className="w-full max-w-md h-2 rounded-full" style={{ background: "#EEF1EF" }}>
                <div className="h-full rounded-full" style={{ width: `${(progreso.n / progreso.total) * 100}%`, background: C.acento }} />
              </div>
            </div>
          ) : (
            <ZonaArchivos texto={`Subir ${nt.varios.toLowerCase()}`} onArchivos={leer} />
          )}
          {leidos.size > 0 && !progreso && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]" style={{ color: C.texto2 }}>
              <span>Leídos <b style={{ color: C.texto }}>{leidos.size}</b></span>
              <span>Agencias <b style={{ color: C.texto }}>{new Set(invLeidos.map((x) => x.oficina)).size}</b></span>
              <span>Meses <b style={{ color: C.texto }}>{new Set(invLeidos.map((x) => x.periodo)).size}</b></span>
              {reemplaza > 0 && <span>Ya cargados, se reemplazan <b style={{ color: C.texto }}>{reemplaza}</b></span>}
              {errores.length > 0 && <span style={{ color: C.alerta }}>No se guardan <b>{errores.length}</b></span>}
            </div>
          )}
        </div>
        {leidos.size > 0 && !progreso && <div style={{ borderTop: `1px solid ${C.beige}` }}><Leidos lista={[...leidos.values()]} inv={inv} /></div>}
        {errores.length > 0 && !progreso && (
          <ul className="px-4 py-3 text-[12px] flex flex-col gap-0.5" style={{ borderTop: `1px solid ${C.beige}`, color: C.alerta }}>
            {errores.slice(0, 20).map((e) => <li key={e}>{e}</li>)}
            {errores.length > 20 && <li>… y {errores.length - 20} más</li>}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo={`${nt.varios} cargados`}>
        <Cobertura inv={inv} />
        {inv.length > 0 && <EliminarMes inv={inv} tipo={tipo} onListo={(t) => { setAviso({ t }); setVersion((v) => v + 1); }} />}
      </Tarjeta>
    </div>
  );
}

/** Eliminar un mes cargado por error (de este tipo de archivo). */
function EliminarMes({ inv, tipo, onListo }: { inv: Inv; tipo: Tipo; onListo: (t: string) => void }) {
  const oficinas = OFICINAS.filter((o) => inv.some((x) => x.oficina === o));
  const [oficina, setOficina] = useState(oficinas[0] ?? "");
  const periodos = [...new Set(inv.filter((x) => x.oficina === oficina).map((x) => x.periodo))].sort().reverse();
  const [periodo, setPeriodo] = useState("");
  const per = periodos.includes(periodo) ? periodo : periodos[0] ?? "";
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sel = "h-9 px-2.5 text-[13px] rounded-md bg-white";
  const nombre = tipo === "BAL" ? "el balance" : tipo === "CO" ? "las cuentas de orden" : "el estado de resultados";
  async function eliminar() {
    setOcupado(true); setError(null);
    try {
      const r = await apiFetch(`/api/historico?oficina=${encodeURIComponent(oficina)}&periodo=${per}&tipo=${tipo}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo eliminar."); return; }
      setConfirmar(false);
      notificarCambioArchivo("eliminacion", `Históricos ${oficina} ${per}`);
      onListo(`Se eliminó ${nombre} de ${oficina} (${per}). Queda una copia restaurable en Administración → Bitácora.`);
    } catch { setError("No hay conexión con el servidor."); } finally { setOcupado(false); }
  }
  return (
    <div className="px-4 py-3 flex flex-wrap items-end gap-3 text-[12px]" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2 }}>
      <span className="font-semibold pb-2" style={{ color: C.texto }}>Eliminar un mes cargado por error</span>
      <label className="flex flex-col gap-1">Agencia
        <select className={sel} style={{ border: `1px solid ${C.borde}` }} value={oficina} onChange={(e) => { setOficina(e.target.value); setPeriodo(""); }}>
          {oficinas.map((o) => <option key={o}>{o}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Período
        <select className={sel} style={{ border: `1px solid ${C.borde}` }} value={per} onChange={(e) => setPeriodo(e.target.value)}>
          {periodos.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <button type="button" disabled={!per} onClick={() => setConfirmar(true)} className="h-9 px-3 rounded-md font-semibold disabled:opacity-50" style={{ border: "1px solid #E5B8B3", color: C.alerta }}>Eliminar…</button>
      {confirmar && (
        <div className="basis-full rounded-md p-3 flex flex-wrap items-center gap-3" style={{ background: "#FDF2F1", color: C.alerta }}>
          <span className="flex-1 min-w-[260px]">¿Eliminar {nombre} de <b>{oficina}</b> del período <b>{per}</b>? Los indicadores y la Planificación de esa agencia se recalculan sin ese mes.</span>
          <button type="button" disabled={ocupado} onClick={() => setConfirmar(false)} className="h-8 px-3 rounded-md bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>Cancelar</button>
          <button type="button" disabled={ocupado} onClick={eliminar} className="h-8 px-3 rounded-md text-white font-semibold" style={{ background: C.alerta }}>{ocupado ? "Eliminando…" : "Eliminar"}</button>
        </div>
      )}
      {error && <span className="basis-full" style={{ color: C.alerta }}>{error}</span>}
    </div>
  );
}
