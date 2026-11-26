"use client";
/**
 * CARGA DE DATOS → Balance de partida: el balance desde el que arranca el presupuesto de cada agencia. No se sube
 * aparte: se elige entre los balances ya cargados en la pestaña Balances (el último antes de enero del ejercicio).
 */
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/useDatos";
import { notificarCambioArchivo } from "../lib/cache-sistema";
import { useEjercicio } from "../lib/seleccion";
import { C, Tarjeta } from "./ActivosComun";

interface Fila {
  agencia: string; agenciaId: number | null; partida: { anio: number; mes: number; cuentas: number } | null;
  guardadas: { anio: number; mes: number; cuentas: number }[]; ultimoBalance: string | null;
}
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const txt = (a: number, m: number) => `${MES[m - 1]}-${a}`;
const txtP = (p: string) => txt(Number(p.slice(0, 4)), Number(p.slice(5, 7)));
const clave = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;

export function BalancePartida() {
  const [ejercicio] = useEjercicio();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [version, setVersion] = useState(0);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ t: string; e?: boolean } | null>(null);
  const [borrar, setBorrar] = useState<{ f: Fila; anio: number; mes: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/balance-partida?ejercicio=${ejercicio}`).then((r) => r.json()).then((j) => {
      if (!vivo) return;
      if (j.error) { setAviso({ t: j.error, e: true }); return; }
      const fs = j.agencias as Fila[];
      setFilas(fs);
      // por defecto, las agencias con un balance más reciente que su partida
      setElegidas(new Set(fs.filter((f) => f.ultimoBalance && (!f.partida || f.ultimoBalance > clave(f.partida.anio, f.partida.mes))).map((f) => f.agencia)));
    }).catch(() => { if (vivo) setAviso({ t: "No hay conexión con el servidor.", e: true }); });
    return () => { vivo = false; };
  }, [ejercicio, version]);

  async function usar() {
    setOcupado(true); setAviso(null);
    try {
      const r = await apiFetch("/api/balance-partida", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencias: [...elegidas], ejercicio }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
      const hechas = j.hechas as { agencia: string; periodo: string }[];
      setAviso({ t: `Balance de partida actualizado en ${hechas.length} ${hechas.length === 1 ? "agencia" : "agencias"}.${j.sinBalance?.length ? ` Sin balance cargado: ${j.sinBalance.join(", ")}.` : ""}` });
      notificarCambioArchivo("subida", `Balance de partida ${ejercicio} (${hechas.map((h) => h.agencia).join(", ")})`);
      setConfirmar(false); setVersion((v) => v + 1);
    } catch (e) { setAviso({ t: e instanceof Error ? e.message : "No se pudo guardar.", e: true }); }
    finally { setOcupado(false); }
  }
  async function eliminar() {
    if (!borrar?.f.agenciaId) return;
    setOcupado(true); setAviso(null);
    try {
      const r = await apiFetch(`/api/saldos-iniciales?agenciaId=${borrar.f.agenciaId}&anio=${borrar.anio}&mes=${borrar.mes}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
      setAviso({ t: `Se eliminó la partida de ${borrar.f.agencia} (${txt(borrar.anio, borrar.mes)}). Queda una copia restaurable en Administración → Bitácora.` });
      notificarCambioArchivo("eliminacion", `Balance de partida ${borrar.f.agencia} ${txt(borrar.anio, borrar.mes)}`);
      setBorrar(null); setVersion((v) => v + 1);
    } catch (e) { setAviso({ t: e instanceof Error ? e.message : "No se pudo eliminar.", e: true }); }
    finally { setOcupado(false); }
  }

  const todas = filas?.filter((f) => f.ultimoBalance).map((f) => f.agencia) ?? [];
  const alternar = (a: string) => setElegidas((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  return (
    <div className="flex flex-col gap-5 pb-6">
      {aviso && <p className="text-[12px] -my-2" style={{ color: aviso.e ? C.alerta : C.ok }}>{aviso.t}</p>}
      <Tarjeta titulo={`Balance de partida del presupuesto ${ejercicio}`}
        derecha={filas ? (
          <button type="button" disabled={!elegidas.size || ocupado} onClick={() => setConfirmar(true)}
                  className="h-8 px-3 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>
            Usar el último balance cargado ({elegidas.size})
          </button>
        ) : undefined}>
        {!filas ? <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>Cargando…</p> : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 w-8 text-left">
                  <input type="checkbox" aria-label="Elegir todas" className="w-4 h-4" style={{ accentColor: C.acento }}
                         checked={todas.length > 0 && todas.every((a) => elegidas.has(a))} onChange={(e) => setElegidas(new Set(e.target.checked ? todas : []))} />
                </th>
                <th className="px-2 text-left font-semibold">Agencia</th>
                <th className="px-3 text-left font-semibold">Partida actual</th>
                <th className="px-3 text-left font-semibold">Último balance cargado</th>
                <th className="pr-4 text-right font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const actual = f.partida ? clave(f.partida.anio, f.partida.mes) : null;
                const alDia = !!f.ultimoBalance && actual === f.ultimoBalance;
                const nuevo = !!f.ultimoBalance && (!actual || f.ultimoBalance > actual);
                return (
                  <tr key={f.agencia} style={{ borderTop: `1px solid ${C.beige}`, height: 34 }}>
                    <td className="pl-4">
                      <input type="checkbox" aria-label={`Elegir ${f.agencia}`} className="w-4 h-4" style={{ accentColor: C.acento }} disabled={!f.ultimoBalance}
                             checked={elegidas.has(f.agencia)} onChange={() => alternar(f.agencia)} />
                    </td>
                    <td className="px-2" style={{ color: C.texto }}>{f.agencia}</td>
                    <td className="px-3" style={{ color: C.texto3 }}>{f.partida ? `${txt(f.partida.anio, f.partida.mes)} · ${f.partida.cuentas} cuentas` : "—"}</td>
                    <td className="px-3" style={{ color: C.texto3 }}>{f.ultimoBalance ? txtP(f.ultimoBalance) : "Sin balances cargados"}</td>
                    <td className="pr-4 text-right" style={{ color: alDia ? C.ok : nuevo ? C.aviso : C.tenue }}>
                      {alDia ? "Al día" : nuevo ? "Hay un balance más reciente" : f.ultimoBalance ? "La partida es más reciente" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {confirmar && (
          <div className="m-4 rounded-md p-3 flex flex-wrap items-center gap-3 text-[12px]" style={{ background: C.avisoSuave, color: C.texto }}>
            <span className="flex-1 min-w-[260px]">
              Se usará como punto de partida el último balance cargado de: <b>{[...elegidas].join(", ")}</b>. El balance, el estado de resultados,
              el flujo y la cartera de esas agencias se recalculan desde ese balance. Lo cargado en las hojas no cambia.
            </span>
            <button type="button" disabled={ocupado} onClick={() => setConfirmar(false)} className="h-8 px-3 rounded-md bg-white" style={{ border: `1px solid ${C.borde}` }}>Cancelar</button>
            <button type="button" disabled={ocupado} onClick={usar} className="h-8 px-3 rounded-md text-white font-semibold" style={{ background: C.acento }}>{ocupado ? "Guardando…" : "Confirmar"}</button>
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="Partidas guardadas">
        {!filas ? null : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ color: C.texto2, height: 34, borderBottom: "2px solid #DDE2DF" }}>
                <th className="pl-4 text-left font-semibold">Agencia</th><th className="px-3 text-left font-semibold">Mes</th>
                <th className="px-3 text-right font-semibold">Cuentas</th><th className="pr-4 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {filas.flatMap((f) => f.guardadas.map((g) => (
                <tr key={`${f.agencia}-${g.anio}-${g.mes}`} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4" style={{ color: C.texto }}>{f.agencia}</td>
                  <td className="px-3" style={{ color: C.texto3 }}>{txt(g.anio, g.mes)}{f.partida && f.partida.anio === g.anio && f.partida.mes === g.mes ? " · partida actual" : ""}</td>
                  <td className="px-3 text-right tabla-cifras" style={{ color: C.texto3 }}>{g.cuentas}</td>
                  <td className="pr-4 text-right">
                    <button type="button" onClick={() => setBorrar({ f, anio: g.anio, mes: g.mes })} className="text-[12px] font-semibold hover:underline" style={{ color: C.alerta }}>Eliminar…</button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        )}
        {borrar && (
          <div className="m-4 rounded-md p-3 flex flex-wrap items-center gap-3 text-[12px]" style={{ background: "#FDF2F1", color: C.alerta }}>
            <span className="flex-1 min-w-[260px]">
              ¿Eliminar la partida de <b>{borrar.f.agencia}</b> de <b>{txt(borrar.anio, borrar.mes)}</b>? El balance cargado en la pestaña Balances no se borra.
              {(() => {
                const p = borrar.f.partida;
                if (!p || p.anio !== borrar.anio || p.mes !== borrar.mes) return null;
                const sig = borrar.f.guardadas.filter((g) => g.anio < ejercicio && !(g.anio === p.anio && g.mes === p.mes))[0];
                return <b className="block mt-1">Es la partida del presupuesto {ejercicio}: {sig ? `el presupuesto de la agencia se recalculará desde ${txt(sig.anio, sig.mes)}.` : "la agencia queda sin partida y su presupuesto no se podrá calcular hasta elegir otra."}</b>;
              })()}
            </span>
            <button type="button" disabled={ocupado} onClick={() => setBorrar(null)} className="h-8 px-3 rounded-md bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>Cancelar</button>
            <button type="button" disabled={ocupado} onClick={eliminar} className="h-8 px-3 rounded-md text-white font-semibold" style={{ background: C.alerta }}>{ocupado ? "Eliminando…" : "Eliminar"}</button>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
