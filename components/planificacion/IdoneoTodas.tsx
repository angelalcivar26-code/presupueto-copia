"use client";
/**
 * «Aplicar idóneo a las 10 agencias», en dos pasos:
 *  1. Vista previa (no guarda nada): en cada agencia calcula el idóneo de la recuperación por vencer, el pase a riesgo de
 *     cada línea y la recuperación de vencida (el mismo cálculo de la vista Idóneo) y la utilidad del ejercicio antes y
 *     con el idóneo.
 *  2. «Aplicar»: guarda el idóneo y las precancelaciones reales en las agencias marcadas. Con «Incluir la tasa real de
 *     cada línea» también pone la tasa real de cada línea con tope en TOPE_TASA_LINEA (sin tasa real, la del presupuesto). % que vence, distribución,
 *     cumplimiento y meta de ritmo no cambian. Cada agencia guarda su copia para deshacer.
 */
import { useState } from "react";
import { apiFetch } from "../../lib/useDatos";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import { NOMBRE_LINEA, TOPE_TASA_LINEA, type HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import { versionIdoneo } from "../../lib/calc/idoneo-cartera";
import { idoneoAgencia, insumosCartera, correrCartera } from "./EstudioCartera";
import { ORDEN_OFICINAS } from "./Integrado";
import { E, u, p2 } from "./EstudioComun";

type Estado = "listo" | "igual" | "sin datos" | "aplicado" | "error";
interface Cuerpo { filas: unknown[]; cumplimiento: number[] | null; factorMora: number | null; interesMora: number | null }
/** Variante de la agencia: solo el idóneo (sin) o el idóneo más la tasa real de cada línea (con). */
interface Variante { despues?: number; cambia: boolean; cuerpo: Cuerpo }
interface Fila {
  ag: string; estado: Estado; texto?: string; antes?: number; marcada: boolean;
  sin?: Variante; con?: Variante;
  /** Líneas cuya tasa real pasaba del tope (tasa más alta del producto en base 360) y quedaron en el tope. */
  topes?: string;
}

export function AplicarIdoneoTodas({ motor }: { motor: Record<string, { am?: unknown }> }) {
  const AGENCIAS = ORDEN_OFICINAS.filter((a) => a !== "Consolidado");
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [aplicado, setAplicado] = useState(false);
  const [conTasa, setConTasa] = useState(false);
  const vari = (f: Fila) => (conTasa ? f.con : f.sin);
  const listo = (f: Fila) => f.estado === "listo" && !!vari(f)?.cambia;

  // 1. Vista previa: no guarda nada
  const previa = async () => {
    const faltan = AGENCIAS.filter((a) => !motor[a]?.am);
    if (faltan.length) { window.alert(`Todavía se está leyendo el presupuesto de: ${faltan.join(", ")}. Espere a que termine y vuelva a intentar.`); return; }
    const out: Fila[] = [];
    setFilas(null); setAplicado(false);
    for (const ag of AGENCIAS) {
      setCorriendo(`Calculando… ${ag}`);
      try {
        const am = motor[ag].am as AgenciaMotor;
        if (!am.ins.paramsCredito.length) { out.push({ ag, estado: "sin datos", texto: "No tiene parámetros de crédito en el presupuesto", marcada: false }); continue; }
        const r = await apiFetch(`/api/estudio-agencia?agencia=${encodeURIComponent(ag)}`);
        const h = (await r.json()) as HistoricoEstudio & { error?: string };
        if (!r.ok || h.error) { out.push({ ag, estado: "sin datos", texto: h.error ?? "Sin históricos", marcada: false }); continue; }
        const { pres, calc, tasaReal } = idoneoAgencia(am, h);
        if (!calc) { out.push({ ag, estado: "sin datos", texto: "Faltan meses sin alivio con balance y reporte de recuperación", marcada: false }); continue; }
        const v = versionIdoneo(calc);
        // tasa real de cada línea, sin pasar de la tasa más alta del producto en base 360
        const topadas: string[] = [];
        const vt = { ...v, tasa: v.tasa.map((x, i) => {
          const r = tasaReal[i]; if (r === null || r === undefined) return x;
          if (r > TOPE_TASA_LINEA[i] + 1e-9) { topadas.push(`${NOMBRE_LINEA[i]} ${p2(r)} → ${p2(TOPE_TASA_LINEA[i])}`); return TOPE_TASA_LINEA[i]; }
          return r;
        }) };
        const variante = (vv: typeof v): Variante => {
          const x = insumosCartera(am, pres, vv);
          const cambia = x.interesMora !== null || x.filas.some((f, i) => JSON.stringify(f) !== JSON.stringify(am.ins.paramsCredito[i]));
          return { despues: correrCartera(am, pres, vv)?.kpi.util, cambia,
            cuerpo: { filas: x.filas, cumplimiento: x.cumplimiento, factorMora: x.factorMora, interesMora: x.interesMora } };
        };
        const sin = variante(v), con = variante(vt);
        const algo = sin.cambia || con.cambia;
        out.push({ ag, estado: algo ? "listo" : "igual", antes: correrVersion(am, {}).kpi.util, marcada: algo, sin, con, topes: topadas.length ? `Tasa con tope: ${topadas.join("; ")}` : undefined });
      } catch (e) { out.push({ ag, estado: "error", texto: e instanceof Error ? e.message : "No se pudo calcular", marcada: false }); }
    }
    setCorriendo(null); setFilas(out);
  };

  // 2. Aplicar a las agencias marcadas
  const aplicar = async () => {
    if (!filas) return;
    const sel = filas.filter((f) => f.marcada && listo(f));
    if (!sel.length) return;
    if (!window.confirm(`Se guardará el idóneo${conTasa ? " y la tasa real de cada línea" : ""} en ${sel.length} ${sel.length === 1 ? "agencia" : "agencias"}: ${sel.map((f) => f.ag).join(", ")}. Cada una guarda una copia para deshacer. ¿Continuar?`)) return;
    const out = filas.map((f) => ({ ...f }));
    for (const f of out) {
      const cuerpo = vari(f)?.cuerpo;
      if (!f.marcada || !listo(f) || !cuerpo) continue;
      setCorriendo(`Aplicando… ${f.ag}`);
      try {
        const p = await apiFetch("/api/estudio-agencia", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agencia: f.ag, accion: "aplicar", origen: conTasa ? "Cartera, idóneo y tasa real (varias agencias)" : "Cartera, idóneo (varias agencias)", ...cuerpo }) });
        const j = await p.json().catch(() => ({}));
        if (!p.ok || j.error) { f.estado = "error"; f.texto = j.error ?? `Error ${p.status}`; } else f.estado = "aplicado";
      } catch (e) { f.estado = "error"; f.texto = e instanceof Error ? e.message : "No se pudo guardar"; }
    }
    setCorriendo(null); setFilas(out); setAplicado(true);
  };

  const color: Record<Estado, string> = { listo: E.tinta, aplicado: E.verde, igual: E.gris, "sin datos": E.alerta, error: E.alerta };
  const texto: Record<Estado, string> = { listo: "", aplicado: "Aplicado", igual: "Sin cambios", "sin datos": "No se puede", error: "Error" };
  const marcadas = filas?.filter((f) => f.marcada && listo(f)).length ?? 0;
  return (
    <span className="relative inline-flex">
      <button type="button" disabled={!!corriendo} onClick={() => void previa()}
        className="h-8 px-3.5 rounded-md bg-white text-[12px] font-semibold disabled:opacity-60" style={{ border: `1px solid ${E.verde}`, color: E.verde }}>
        {corriendo ?? `Idóneo en las ${AGENCIAS.length} agencias`}
      </button>
      {filas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,30,25,.35)" }}>
        <div role="dialog" aria-modal="true" aria-label="Idóneo en las agencias" className="w-[600px] max-w-full max-h-[90vh] overflow-auto rounded-lg bg-white p-4 shadow-lg text-[12px] text-left font-normal whitespace-normal" style={{ border: `1px solid ${E.linea}`, color: E.tinta }}>
          <div className="flex items-center mb-1"><b className="flex-1 text-[14px]">Idóneo en las agencias{aplicado ? "" : " · vista previa"}</b>
            <button type="button" onClick={() => setFilas(null)} className="text-[12px] font-semibold" style={{ color: E.gris }}>Cerrar</button></div>
          <p className="mt-0 mb-2" style={{ color: E.gris }}>Recuperación por vencer, pase a cartera en riesgo y recuperación de vencida: el idóneo de cada agencia. Precancelaciones: las reales.{conTasa ? ` Tasa: la real de cada línea (jun a la fecha, con el interés refinanciado, base 360), sin pasar de la tasa más alta del producto × 365 ÷ 360 (Microcrédito ${p2(TOPE_TASA_LINEA[3])}, Consumo ${p2(TOPE_TASA_LINEA[1])}, Inmobiliario ${p2(TOPE_TASA_LINEA[2])}, Productivo ${p2(TOPE_TASA_LINEA[0])}); sin tasa real se deja la del presupuesto.` : ""} Lo demás no cambia.{aplicado ? "" : " Todavía no se guardó nada."}</p>
          {!aplicado && (
            <label className="flex items-center gap-2 mb-2 cursor-pointer" style={{ color: E.tinta }}>
              <input type="checkbox" checked={conTasa} onChange={(e) => setConTasa(e.target.checked)} />
              Incluir la tasa real de cada línea
            </label>
          )}
          <table className="w-full table-fixed" style={{ fontVariantNumeric: "tabular-nums" }}>
            <colgroup><col style={{ width: 28 }} /><col style={{ width: "24%" }} /><col style={{ width: "19%" }} /><col style={{ width: "21%" }} /><col /></colgroup>
            <thead><tr style={{ color: E.gris }}>
              <th /><th className="font-normal pb-1" style={{ textAlign: "left" }}>Agencia</th>
              <th className="text-right font-normal pb-1">Utilidad hoy</th><th className="text-right font-normal pb-1">{conTasa ? "Con idóneo y tasa" : "Con el idóneo"}</th><th className="text-right font-normal pb-1" />
            </tr></thead>
            <tbody>
              {filas.map((f, k) => {
                const despues = vari(f)?.despues;
                const d = f.antes !== undefined && despues !== undefined ? despues - f.antes : null;
                const est: Estado = f.estado === "listo" && !listo(f) ? "igual" : f.estado;
                return (
                  <tr key={f.ag} style={{ borderTop: `1px solid ${E.fondo}` }}>
                    <td className="py-1.5">{est === "listo" && !aplicado && (
                      <input type="checkbox" aria-label={`Aplicar en ${f.ag}`} checked={f.marcada} onChange={(e) => setFilas(filas.map((x, j) => (j === k ? { ...x, marcada: e.target.checked } : x)))} />
                    )}</td>
                    <td className="py-1.5 overflow-hidden text-ellipsis" style={{ textAlign: "left", whiteSpace: "nowrap" }}>{f.ag}</td>
                    <td className="py-1.5 text-right" style={{ color: (f.antes ?? 0) < 0 ? E.alerta : E.tinta }}>{f.antes !== undefined ? u(f.antes) : ""}</td>
                    <td className="py-1.5 text-right font-semibold" style={{ color: (despues ?? 0) < 0 ? E.alerta : E.tinta }}>{despues !== undefined ? u(despues) : ""}
                      {d !== null && Math.abs(d) >= 1 && <span className="block text-[11px] font-normal" style={{ color: d < 0 ? E.alerta : E.verde }}>{d > 0 ? "+" : "−"}{u(Math.abs(d))}</span>}</td>
                    <td className="py-1.5 pl-3 text-right" style={{ color: color[est], whiteSpace: "normal", overflowWrap: "anywhere" }}>{texto[est]}
                      {f.texto && <span className="block text-[11px]" style={{ color: E.gris }}>{f.texto}</span>}
                      {conTasa && f.topes && <span className="block text-[11px]" style={{ color: E.alerta }}>{f.topes}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!aplicado ? (
            <div className="flex items-center gap-2 mt-3">
              <span className="flex-1" style={{ color: E.gris }}>Desmarque las agencias en las que no quiera aplicarlo.</span>
              <button type="button" onClick={() => setFilas(null)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: `1px solid ${E.linea}`, color: E.gris }}>Cancelar</button>
              <button type="button" disabled={!marcadas || !!corriendo} onClick={() => void aplicar()} className="h-8 px-3.5 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: E.verde }}>
                {corriendo ?? `Aplicar en ${marcadas} ${marcadas === 1 ? "agencia" : "agencias"}`}
              </button>
            </div>
          ) : (
            <p className="mt-2 mb-0" style={{ color: E.gris }}>El presupuesto se recalcula en unos segundos. En cada agencia, «Deshacer el último cambio» vuelve a sus supuestos anteriores.</p>
          )}
        </div>
        </div>
      )}
    </span>
  );
}
