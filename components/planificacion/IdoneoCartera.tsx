"use client";
/**
 * 14 · CARTERA → IDÓNEO: cuánto debe recuperar la agencia, con fundamento.
 * Con los meses sin alivio (desde el inicio de la ventana de la provisión hasta el último mes cargado):
 *  - Real: lo que hizo en esos meses (suma ÷ suma).
 *  - Su mejor nivel: promedio de sus 2 mejores meses; su mejor mes: el tope de lo que ya demostró.
 *  - Punto de equilibrio: el nivel con el que la utilidad 2027 de la agencia queda en cero (motor del presupuesto, todo
 *    lo demás igual). Primero el pase a riesgo (lo que más pesa en el resultado) y, con ese, la recuperación de vencida.
 *  - Idóneo 2027 = el más exigente entre su real, su mejor nivel y el equilibrio, sin pasar de su mejor mes. Si el
 *    equilibrio está más allá de su mejor mes, se marca: la pérdida no se corrige solo con cobranza.
 * La recuperación de cartera por vencer no mueve la utilidad (trae efectivo): su idóneo es su mejor nivel.
 * Pantalla: Real · Mejor mes · Idóneo (con su fundamento en el ⓘ) · Presupuesto (editable, parte de lo guardado; «Usar el
 * idóneo» lo llena con el idóneo). «Guardar» aplica esos valores al presupuesto de la agencia; la utilidad se recalcula al momento.
 * Las precancelaciones no llevan meta: van con el real.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida } from "../../lib/calc/plan2027";
import { provisionFlowDe } from "../../lib/calc/provision-flow";
import type { MesReal, VersionCartera } from "../../lib/calc/estudio-agencia";
import { E, NUM, T, p1, p2, u, perCorto } from "./EstudioComun";
import { Formula } from "../ProvisionFlowParametros";
import { ejercicioEnUso } from "../../lib/seleccion";
import type { FuenteIdoneo } from "../../lib/calc/provision-metas";
import { calcularIdoneo, versionIdoneo, type FilaIdoneo, type CalculoIdoneo } from "../../lib/calc/idoneo-cartera";

type Fuente = FuenteIdoneo;
export const NOMBRE_FUENTE: Record<Fuente, string> = { real: "Su real", mejor: "Mitad hacia su mejor nivel", equilibrio: "Punto de equilibrio", tope: "Su mejor mes" };

type Fila = FilaIdoneo & { fmt: (v: number | null) => string };

export function IdoneoCartera({ am, ms, idx, pres, correr, onAplicar, guardando, todas, calculo }: {
  am: AgenciaMotor; ms: MesReal[]; idx: number[]; pres: VersionCartera;
  correr: (v: VersionCartera) => Corrida | null; onAplicar: (v: VersionCartera) => void; guardando: boolean; todas?: ReactNode; calculo?: CalculoIdoneo | null;
}) {
  const [metas, setMetas] = useState<Record<string, number>>({});
  const desde = provisionFlowDe(am.ins.saldos)?.config.ventanaDesde ?? "";
  const calc0 = useMemo(() => (calculo !== undefined ? calculo : calcularIdoneo({ ms, idx, pres, correr, desde })), [calculo, ms, idx, pres, correr, desde]);
  const calc = useMemo(() => (calc0 ? { ...calc0, filas: calc0.filas.map((f): Fila => ({ ...f, fmt: f.pct === 2 ? p2 : p1 })) } : null), [calc0]);

  // presupuesto 2027 (editable): parte del presupuesto guardado; «Usar el idóneo» lo llena con el idóneo
  const valor = (f: Fila) => metas[f.clave] ?? f.pres;
  const conMeta = useMemo(() => {
    if (!calc) return null;
    const todas: Record<string, number> = {};
    for (const f of calc.filas) if (f.clave !== "mora" || metas.mora !== undefined) todas[f.clave] = metas[f.clave] ?? f.pres;
    const v = versionIdoneo(calc, todas);
    return { v, U: correr(v)?.er.util ?? null };
  }, [calc, metas, correr]);

  if (!calc) return <p className="text-[13px] py-4" style={{ color: E.gris }}>Faltan meses sin alivio con balance y reporte de recuperación.</p>;
  const { sm, U0, filas } = calc;
  const editado = filas.some((f) => metas[f.clave] !== undefined && Math.abs(metas[f.clave] - f.pres) > 1e-9);
  const periodo = `${perCorto(sm[0].p)} a ${perCorto(sm[sm.length - 1].p)}`;
  const mejorMes = (f: Fila) => (f.tope === null || f.real === null || (f.alto ? f.tope <= f.real + 1e-9 : f.tope >= f.real - 1e-9) ? "—" : f.fmt(f.tope));
  const fundamento = (f: Fila) => f.porMinimo && f.fuente === "mejor" ? `Cobranza temprana: 10 % menos que su real.${f.limitado ? " Limitado para que la provisión no baje más de 25 % frente a su real." : ""}` : f.porReferencia && f.fuente === "mejor" ? `Mitad hacia la cooperativa: la mitad del camino entre su real y el pase de la cooperativa (${p2(f.ref ?? null)}), que otras agencias ya logran.${f.limitado ? " Limitado para que la provisión no baje más de 25 % frente a su real." : ""}` : `${f.fuente ? NOMBRE_FUENTE[f.fuente] : "Su real"}${f.fuente === "mejor" ? ": la mitad del camino entre su real y el promedio de sus 2 mejores meses." : f.fuente === "tope" ? ": lo máximo que ya logró." : f.fuente === "equilibrio" ? ": el nivel con el que la utilidad de la agencia queda en cero." : "."}${f.limitado ? " Limitado para que la provisión no baje más de 25 % frente a su real." : ""}${f.noAlcanza ? " Ni así se cubre la pérdida." : ""}`;
  const grupos: [string, Fila[]][] = [
    ["Recuperación", filas.filter((f) => f.clave === "e" || f.clave === "cv" || f.clave === "q")],
    ["Pase a cartera en riesgo mensual", filas.filter((f) => f.clave.startsWith("pase"))],
    ["Interés de mora", filas.filter((f) => f.clave === "mora")],
  ];
  const etiqueta = (f: Fila) => (f.clave.startsWith("pase") ? f.label.replace(/^Pase a cartera en riesgo mensual · /, "") : f.label);
  const dif = conMeta?.U !== null && conMeta?.U !== undefined ? conMeta.U - U0 : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-[13px]" style={{ color: E.gris }}>Real: {periodo} (meses sin alivio)</span>
        {todas}
        <button type="button" onClick={() => setMetas(Object.fromEntries(filas.filter((f) => f.idoneo !== null && f.clave !== "mora").map((f) => [f.clave, f.idoneo as number])))}
          className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${E.verde}`, color: E.verde }}>Usar el idóneo</button>
        {editado && <button type="button" onClick={() => setMetas({})} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC", color: E.gris }}>Descartar</button>}
        <button type="button" disabled={!conMeta || !editado || guardando} onClick={() => conMeta && onAplicar(conMeta.v)}
          className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: E.verde }}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <thead><tr style={T.cab} className="whitespace-nowrap">
            <th className={T.thIzq}>Parámetro</th>
            <th className={T.th}>Real</th>
            <th className={T.th}><span className="inline-flex items-center gap-1">Mejor mes<Formula info>El mejor mes sin alivio (sin meses atípicos): lo máximo que la agencia ya logró.</Formula></span></th>
            <th className={T.th}><span className="inline-flex items-center gap-1">Idóneo<Formula info derecha>El más exigente entre su real, la mitad del camino hacia su mejor nivel y el punto de equilibrio, sin pasar de su mejor mes. La provisión de la agencia no baja más de 25 % frente a su real. El ⓘ de cada fila dice de dónde sale.</Formula></span></th>
            <th className={T.th} style={{ background: E.fondo }}><span className="inline-flex items-center gap-1">Presupuesto {ejercicioEnUso()}<Formula info derecha>Lo que está en el presupuesto (los mismos parámetros de Cartera → Tasas y recuperación). Se puede escribir otro valor o «Usar el idóneo»; la utilidad de abajo se recalcula al momento y «Guardar» lo aplica en los 12 meses.</Formula></span></th>
          </tr></thead>
          <tbody>
            {grupos.filter(([, fs]) => fs.length).map(([g, fs]) => [
              <tr key={g}><td colSpan={5} className="pt-4 pb-1 text-[11px] font-semibold tracking-wide" style={{ color: E.verde, fontFamily: "inherit" }}>{g.toUpperCase()}</td></tr>,
              ...fs.map((f) => (
                <tr key={f.clave} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>{etiqueta(f)}</td>
                  <td className={T.td}>{f.fmt(f.real)}</td>
                  <td className={T.td} style={{ color: E.gris }}>{mejorMes(f)}</td>
                  <td className={T.td} style={{ color: E.verde, fontWeight: 600 }}><span className="inline-flex items-center gap-1 justify-end">{f.fmt(f.idoneo)}<Formula info derecha>{fundamento(f)}</Formula></span></td>
                  <td className={T.td} style={{ background: E.fondo }}>
                    <input key={`${f.clave}-${valor(f)}`} defaultValue={(valor(f) * 100).toFixed(f.alto ? 1 : 2).replace(".", ",")} inputMode="decimal" aria-label={`Presupuesto de ${f.label}`}
                      className="h-7 w-[72px] rounded-md px-2 text-right text-[12px] font-semibold bg-white"
                      style={{ border: `1px solid ${metas[f.clave] !== undefined && Math.abs(metas[f.clave] - f.pres) > 1e-9 ? "#B7791F" : "#BFD6C8"}`, color: E.tinta }}
                      onBlur={(e) => {
                        const n = Number(e.target.value.replace("%", "").replace(/\./g, "").replace(",", ".").trim());
                        if (!Number.isFinite(n) || n < 0 || n > 100) return;
                        const x = n / 100;
                        setMetas((o) => { const c = { ...o }; if (Math.abs(x - f.pres) < 1e-6) delete c[f.clave]; else c[f.clave] = x; return c; });
                      }} />
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg px-3 py-2" style={{ background: "#F3F5F4" }}>
          <span className="text-[11px]" style={{ color: E.gris }}>Utilidad {ejercicioEnUso()} si sigue como hoy</span>
          <b className="block text-[15px]" style={{ color: U0 < 0 ? E.alerta : E.tinta, ...NUM }}>{u(U0)}</b>
        </div>
        <div className="rounded-lg px-3 py-2" style={{ background: "#F3F5F4" }}>
          <span className="text-[11px]" style={{ color: E.gris }}>Utilidad {ejercicioEnUso()} con {editado ? "estos valores" : "el presupuesto"}</span>
          <b className="block text-[15px]" style={{ color: (conMeta?.U ?? 0) < 0 ? E.alerta : E.verde, ...NUM }}>{u(conMeta?.U ?? 0)}</b>
          {dif !== null && Math.abs(dif) >= 1 && <span className="text-[11px]" style={{ color: dif > 0 ? E.verde : E.alerta }}>{dif > 0 ? "+" : "−"}{u(Math.abs(dif))} frente a seguir como hoy</span>}
        </div>
      </div>
    </div>
  );
}
