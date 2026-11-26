"use client";

import { leerMonto, leerMeses, sumaTextos, textoEditable } from "../lib/numeros";
import { CampoMonto } from "./GuardiaCambios";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil, Trash2, Check, X, BookOpen } from "lucide-react";
import { apiFetch, guardarMontosPorMes, eliminarFilasDepartamental, errorDeRespuesta } from "../lib/useDatos";
import { cuentaCalculada } from "../lib/calc/cuentas-calculadas";
import {
  C, F_TABLA, F_TEXTO, MESES, usd, pct, suma, useJSON, Columnas, Cabecera, Celda, BotonF, FilaPanel, NombreCuenta,
  COLS_TOTALES, BotonGuardar, BotonSecundario, Cargando, Confirmacion, SelectorMes,
} from "./EgresosComun";
import { useVerMes, useMensualAlEditar } from "./EgresosComun";

/** Filas de presupuesto_departamental de la 4504 (lo cargado a mano), agrupadas por cuenta. */
interface FilaRaw { id: number | null; departamento: string; concepto: string; cuenta_nombre: string | null; mes: number; monto: number; modo: string | null }
interface Manual { concepto: string; nombre: string; montos: number[]; ids: (number | null)[][]; prorrateado: boolean; calculada: boolean }
function agrupar(filas: FilaRaw[]): Manual[] {
  const m = new Map<string, Manual>();
  for (const f of filas) {
    const k = String(f.concepto).replace(/\D/g, "");
    const x = m.get(k) ?? { concepto: k, nombre: f.cuenta_nombre || k, montos: Array(12).fill(0), ids: Array.from({ length: 12 }, () => [] as (number | null)[]), prorrateado: false, calculada: !!cuentaCalculada(k) };
    if (f.mes >= 1 && f.mes <= 12) { x.montos[f.mes - 1] += Number(f.monto) || 0; x.ids[f.mes - 1].push(f.id); }
    if (f.modo === "prorrateado") x.prorrateado = true;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => a.concepto.localeCompare(b.concepto));
}
const HOJA_4504 = "Impuestos y contribuciones";

/**
 * 4504 · CONTRIBUCIONES CALCULADAS: COSEDE (45042010 prima fija, 45042105 prima ajustada por riesgo) y SEPS (450415).
 * Las tasas se editan aquí y se guardan en Turso (otros_pasivo_parametros); sin dato guardado se usa la tasa real del
 * año anterior (histórico) para COSEDE y la de la norma para SEPS.
 */
type Origen = "guardado" | "historico" | "respaldo" | "norma";
interface Datos {
  error?: string;
  tasas: { cosedeFija: number; cosedePar: number; sepsActivos: number; sepsExcedentes: number; origen: Record<string, Origen> };
  cosede: { base: number[]; fija: number[]; par: number[] };
  seps: { porMes: number[]; detalle: { activosH2: number; activosH1: number; abrilActivos: number; excedente: number; excedenteNeto: number; participacion: number; parteExcedente: number; septiembre: number } };
  real: null | {
    cosedeReal: { periodo: string | null; meses: number; pagadoFija: number; pagadoPar: number; base21: number; fijaAnual: number | null; parAnual: number | null };
    sepsReal: { periodo: string | null; porMes: number[] };
    activosSegundoSemestre: { valor: number | null; meses: string[] };
    excedenteAnterior: { valor: number | null; periodo: string | null };
    participacionActivo: number;
  };
  saldo21?: { corte: number; porMes: number[] };
  corte?: { anio: number; mes: number } | null;
}
type Clave = "cosedeFija" | "cosedePar" | "sepsActivos" | "sepsExcedentes";
const CONCEPTO: Record<Clave, string> = {
  cosedeFija: "cosede_prima_fija_anual", cosedePar: "cosede_par_anual", sepsActivos: "seps_tasa_activos_semestral", sepsExcedentes: "seps_tasa_excedentes",
};
const ETIQUETA: Record<Clave, string> = {
  cosedeFija: "COSEDE · prima fija anual", cosedePar: "COSEDE · prima ajustada por riesgo anual",
  sepsActivos: "SEPS · % semestral sobre activos promedio", sepsExcedentes: "SEPS · % sobre excedentes del año anterior",
};
const ORIGEN: Record<Origen, string> = { guardado: "Guardado", historico: "Real del año anterior", respaldo: "Valor anterior de la herramienta", norma: "Norma SEPS" };
/** Porcentaje escrito en formato Ecuador (0,45 = 0,45 %) → fracción; null si está vacío o no se puede leer. */
const leer = (t: string) => { const r = leerMonto(t.replace("%", "")); return r.error || r.valor === null ? null : r.valor / 100; };

export function Contribuciones4504({ agencia, ejercicio, onCambio }: { agencia: string; ejercicio: number; onCambio: () => void }) {
  const [version, setVersion] = useState(0);
  const { datos: d, cargando } = useJSON<Datos>(`/api/contribuciones?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}&v=${version}`, version);
  const [formula, setFormula] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState<Record<Clave, string>>({ cosedeFija: "", cosedePar: "", sepsActivos: "", sepsExcedentes: "" });
  const [todas, setTodas] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const urlManual = `/api/presupuesto-departamental?grupo=4504&agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}&v=${version}`;
  const { datos: dm } = useJSON<{ filas?: FilaRaw[] }>(urlManual, version);
  const [editFila, setEditFila] = useState<string | null>(null);
  const [editMontos, setEditMontos] = useState<string[]>([]);
  const ver = useVerMes();
  const [nueva, setNueva] = useState<{ codigo: string; nombre: string; montos: string[] } | null>(null);
  const [confirmar, setConfirmar] = useState<{ mensaje: string; accion: () => void } | null>(null);
  const [errFila, setErrFila] = useState<string | null>(null);
  useMensualAlEditar(editFila !== null || nueva !== null);
  const [verMetodo, setVerMetodo] = useState(false);
  // Lo cargado antes a mano en SEPS y COSEDE (venía del histórico) ya no se usa: se elimina solo, junto con sus hojas,
  // una vez por agencia. El cálculo no cambia; así en la base quedan solo los valores actuales.
  const limpiado = useRef<string | null>(null);
  useEffect(() => {
    const viejas = (dm?.filas ?? []).filter((f) => cuentaCalculada(String(f.concepto)));
    if (!viejas.length || limpiado.current === agencia) return;
    limpiado.current = agencia;
    (async () => {
      await eliminarFilasDepartamental(viejas.map((f) => f.id));
      const h = await apiFetch(`/api/hojas-presupuesto?grupo=4504&ejercicio=${ejercicio}`).then((r) => r.json()).catch(() => ({ hojas: [] }));
      for (const nombre of (h.hojas ?? []) as string[]) {
        const c = nombre.match(/^\s*(\d{4,})/)?.[1];
        if (c && cuentaCalculada(c)) await apiFetch(`/api/hojas-presupuesto?grupo=4504&nombre=${encodeURIComponent(nombre)}&ejercicio=${ejercicio}`, { method: "DELETE" });
      }
      setVersion((x) => x + 1); onCambio();
    })().catch(() => { limpiado.current = null; });
  }, [dm, agencia, ejercicio, onCambio]);

  if (cargando && !d) return <Cargando />;
  if (!d || d.error) return <p className="text-[12px]" style={{ color: C.alerta }}>{d?.error ?? "No se pudieron calcular las contribuciones."}</p>;

  const t = d.tasas, r = d.real, sd = d.seps.detalle, anio = ejercicio - 1;
  const cols = COLS_TOTALES(false);
  const fmt = (k: Clave, v: number) => (k === "sepsActivos" ? `${(v * 1000).toLocaleString("es-EC", { maximumFractionDigits: 3 })} por mil` : pct(v, 3));
  const real: Record<Clave, string> = {
    cosedeFija: r?.cosedeReal.fijaAnual != null ? pct(r.cosedeReal.fijaAnual, 3) : "sin histórico",
    cosedePar: r?.cosedeReal.parAnual != null ? pct(r.cosedeReal.parAnual, 3) : "sin histórico",
    sepsActivos: "0,45 por mil (norma)", sepsExcedentes: "1 % (norma)",
  };
  const filas = [
    { id: "f", codigo: "45042010", label: "COSEDE · prima fija", v: d.cosede.fija,
      f: (i: number) => `Saldo promedio de Obligaciones con el público (21) del mes ${usd(d.cosede.base[i])} × prima fija ${pct(t.cosedeFija, 3)} ÷ 12 = ${usd(d.cosede.fija[i])}. Se paga cada mes (hasta el día 8 del mes siguiente).` },
    { id: "p", codigo: "45042105", label: "COSEDE · prima ajustada por riesgo", v: d.cosede.par,
      f: (i: number) => `Saldo promedio de 21 ${usd(d.cosede.base[i])} × PAR ${pct(t.cosedePar, 3)} ÷ 12 = ${usd(d.cosede.par[i])}.` },
    { id: "s", codigo: "450415", label: "Aportes a la SEPS", v: d.seps.porMes,
      f: (i: number) => i === 3
        ? `Abril: activos promedio jul–dic ${anio} ${usd(sd.activosH2)} × ${fmt("sepsActivos", t.sepsActivos)} = ${usd(sd.abrilActivos)}; más ${pct(t.sepsExcedentes, 2)} del excedente ${anio} de la cooperativa (${usd(sd.excedente)} − 15 % participación = ${usd(sd.excedenteNeto)}) × participación de la agencia en el activo ${pct(sd.participacion, 2)} = ${usd(sd.parteExcedente)}. Total ${usd(d.seps.porMes[3])}.`
        : i === 8
          ? `Septiembre: activos promedio ene–jun ${ejercicio} ${usd(sd.activosH1)} (activo del balance de partida + crecimiento de las captaciones hasta junio) × ${fmt("sepsActivos", t.sepsActivos)} = ${usd(sd.septiembre)}.`
          : "La contribución a la SEPS se paga en abril (segundo semestre del año anterior y excedentes) y septiembre (primer semestre)." },
  ];
  const todasManual = agrupar(dm?.filas ?? []);
  const manuales = todasManual.filter((x) => !x.calculada);
  type Fila = { id: string; codigo: string; label: string; v: number[]; f?: (i: number) => string; manual?: Manual };
  const tabla: Fila[] = [
    ...filas,
    ...manuales.map((x) => ({ id: `m-${x.concepto}`, codigo: x.concepto, label: x.nombre, v: x.montos, manual: x })),
  ].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const total = MESES.map((_, i) => suma(tabla.map((x) => x.v[i])));
  const refrescar = () => { setVersion((x) => x + 1); onCambio(); };

  async function guardarFila(x: Manual) {
    const lectura = leerMeses(editMontos);
    if (lectura.error !== null) { setErrFila(lectura.error); return; }
    const v = lectura.valores;
    // el monto del mes va en la primera fila guardada; si la cuenta estaba en varias hojas, las demás quedan en 0
    let err = await errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-departamental", x.ids.map((l) => l[0] ?? null), (i) => v[i]));
    const resto = x.ids.flatMap((l, i) => l.slice(1).map((id) => ({ id, i })));
    if (!err && resto.length) err = await errorDeRespuesta(await guardarMontosPorMes("/api/presupuesto-departamental", resto.map((r) => r.id), () => 0));
    if (err) { setErrFila(err); return; }
    setErrFila(null); setEditFila(null); refrescar();
  }
  async function guardarNueva() {
    if (!nueva) return;
    const codigo = nueva.codigo.replace(/\D/g, "");
    if (!codigo.startsWith("4504")) { setErrFila("El código debe empezar con 4504."); return; }
    if (cuentaCalculada(codigo)) { setErrFila(`${codigo} la calcula la herramienta (fila de arriba).`); return; }
    const lectura = leerMeses(nueva.montos);
    if (lectura.error !== null) { setErrFila(lectura.error); return; }
    const r = await apiFetch("/api/presupuesto-departamental", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departamento: HOJA_4504, concepto: codigo, cuenta_nombre: nueva.nombre.trim() || codigo, agencia, ejercicio, montosPorMes: lectura.valores }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); setErrFila(e.error ?? "No se pudo guardar."); return; }
    setNueva(null); setErrFila(null); refrescar();
  }
  const input = "h-[26px] w-full rounded px-1 text-right text-[11px] bg-white";

  async function guardar() {
    setGuardando(true); setMsg(null);
    try {
      for (const k of Object.keys(CONCEPTO) as Clave[]) {
        const txt = texto[k].trim();
        if (txt === "") continue;
        const v = leer(txt);
        if (v === null || v < 0 || v > 0.05) throw new Error(`Revisa ${ETIQUETA[k]}: escribe un porcentaje entre 0 y 5.`);
        const r2 = await apiFetch("/api/otros-pasivo-parametros", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agencia, ejercicio, concepto: CONCEPTO[k], montosPorMes: Array(12).fill(v), todasLasAgencias: todas }),
        });
        const err = await errorDeRespuesta(r2);
        if (err) throw new Error(err);
      }
      setEditando(false); setTodas(false); setMsg({ t: todas ? "Tasas guardadas en las 10 agencias." : "Tasas guardadas." });
      setVersion((x) => x + 1); onCambio();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally { setGuardando(false); }
  }
  async function usarDefecto(k: Clave) {
    const err = await errorDeRespuesta(await apiFetch("/api/otros-pasivo-parametros", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agencia, ejercicio, concepto: CONCEPTO[k], borrar: true, todasLasAgencias: todas }),
    }).catch(() => undefined)) ?? null;
    if (err) { setMsg({ t: `No se pudo restablecer ${ETIQUETA[k]}: ${err}`, e: true }); return; }
    setMsg({ t: `${ETIQUETA[k]}: vuelve a ${k.startsWith("cosede") ? "la tasa real del año anterior" : "la tasa de la norma"}.` });
    setVersion((x) => x + 1); onCambio();
  }

  return (
    <div className="flex flex-col gap-4">
      {confirmar && <Confirmacion mensaje={confirmar.mensaje} onSi={confirmar.accion} onNo={() => setConfirmar(null)} />}
      <div className="flex flex-wrap items-center justify-end gap-4 text-[12px] -mb-2" style={F_TEXTO}>
        <button type="button" onClick={() => setVerMetodo((v) => !v)} aria-expanded={verMetodo}
                className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 mr-auto"
                style={verMetodo ? { background: C.acentoSuave, color: C.acento, border: "1px solid #8DB39B" } : { background: "#FFFFFF", color: C.acento, border: "1px solid #C9D0CC" }}>
          <BookOpen size={15} /> {verMetodo ? "Ocultar metodología" : "Ver metodología aplicada"}
        </button>
        {errFila && <span style={{ color: C.alerta }}>{errFila}</span>}
        {!nueva && <button type="button" className="font-semibold hover:underline" style={{ color: C.acento }} onClick={() => { setNueva({ codigo: "4504", nombre: "", montos: Array(12).fill("") }); setErrFila(null); }}>+ Nueva cuenta</button>}
      </div>
      {verMetodo && (
        <Metodologia4504 d={d} agencia={agencia} ejercicio={ejercicio} totalAnual={suma(total)} onCerrar={() => setVerMetodo(false)}
          manuales={manuales.map((x) => ({ concepto: x.concepto, nombre: x.nombre, total: suma(x.montos) }))} />
      )}
      <div className="bg-white rounded-xl" style={{ border: `1px solid ${C.borde}` }}>
        <table className="w-full table-fixed text-[11px] border-collapse" style={F_TABLA}>
          <Columnas acciones={false} />
          <Cabecera titulo={`4504 · Impuestos, contribuciones y multas · ${agencia}`} ejercicio={ejercicio} acciones={false} />
          <tbody>
            {tabla.map((x) => {
              const m = x.manual, editando = m && editFila === m.concepto;
              return (
                <Fragment key={x.id}>
                  <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                    <td className="pl-4"><NombreCuenta codigo={x.codigo} label={x.label} ancho={58} /></td>
                    {editando
                      ? editMontos.map((t, i) => <td key={i} className="px-0.5"><CampoMonto value={t} etiqueta={`${x.label} ${MESES[i]}`} onChange={(v) => setEditMontos((p) => p.map((y, j) => (j === i ? v : y)))} className={input} style={{ border: `1px solid ${C.borde}` }} /></td>)
                      : MESES.map((_, i) => <Celda key={i} v={ver(x.v)[i]} />)}
                    <Celda v={editando ? sumaTextos(editMontos) : suma(x.v)} fuerte />
                    <td className="text-center whitespace-nowrap">
                      {m && !m.prorrateado && (editando ? (
                        <span className="inline-flex gap-1">
                          <button type="button" title="Guardar" aria-label="Guardar" onClick={() => guardarFila(m)}><Check size={13} color={C.acento} /></button>
                          <button type="button" title="Cancelar" aria-label="Cancelar" onClick={() => setEditFila(null)}><X size={13} color={C.texto2} /></button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <button type="button" title="Editar montos" aria-label={`Editar ${x.label}`} onClick={() => { setEditFila(m.concepto); setEditMontos(m.montos.map((v) => textoEditable(v))); setErrFila(null); }}><Pencil size={12} color={C.texto2} /></button>
                          <button type="button" title="Eliminar" aria-label={`Eliminar ${x.label}`} onClick={() => setConfirmar({ mensaje: `¿Eliminar ${x.codigo} ${x.label} (12 meses)?`, accion: async () => { setConfirmar(null); await eliminarFilasDepartamental(m.ids.flat()); refrescar(); } })}><Trash2 size={12} color={C.alerta} /></button>
                        </span>
                      ))}
                      {!m && <BotonF abierto={formula === x.id} onClick={() => setFormula(formula === x.id ? null : x.id)} />}
                    </td>
                  </tr>
                  {formula === x.id && x.f && (
                    <FilaPanel colSpan={cols}>
                      <div className="flex flex-col gap-1 text-[11px]" style={{ color: C.texto2 }}>
                        {(x.id === "s" ? [3, 8] : [0]).map((i) => <p key={i}>{MESES[i]}: {x.f!(i)}</p>)}
                      </div>
                    </FilaPanel>
                  )}
                </Fragment>
              );
            })}
            {nueva && (
              <tr style={{ borderTop: `1px solid ${C.beige}` }}>
                <td className="pl-4 pr-2 py-1.5">
                  <div className="flex flex-col gap-1">
                    <input placeholder="Código (4504…)" value={nueva.codigo} autoFocus onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })} className="h-[26px] rounded px-1.5 text-[11px] bg-white" style={{ border: `1px solid ${C.borde}` }} />
                    <input placeholder="Nombre de la cuenta" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} className="h-[26px] rounded px-1.5 text-[11px] bg-white" style={{ border: `1px solid ${C.borde}`, ...F_TEXTO }} />
                  </div>
                </td>
                {nueva.montos.map((t, i) => <td key={i} className="px-0.5"><CampoMonto value={t} placeholder="0" etiqueta={`Nueva cuenta ${MESES[i]}`} onChange={(v) => setNueva({ ...nueva, montos: nueva.montos.map((y, j) => (j === i ? v : y)) })} className={input} style={{ border: `1px solid ${C.borde}` }} /></td>)}
                <Celda v={sumaTextos(nueva.montos)} fuerte />
                <td className="text-center whitespace-nowrap">
                  <span className="inline-flex gap-1">
                    <button type="button" title="Guardar" aria-label="Guardar nueva cuenta" onClick={guardarNueva}><Check size={13} color={C.acento} /></button>
                    <button type="button" title="Cancelar" aria-label="Cancelar" onClick={() => { setNueva(null); setErrFila(null); }}><X size={13} color={C.texto2} /></button>
                  </span>
                </td>
              </tr>
            )}
            <tr style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
              <td className="pl-4 font-bold" style={{ color: C.texto }}>Total 4504 · Impuestos, contribuciones y multas</td>
              {ver(total).map((v, i) => <Celda key={i} v={v} fuerte />)}
              <Celda v={suma(total)} fuerte />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl" style={{ border: `1px solid ${editando ? "#8DB39B" : C.borde}` }}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <h3 className="flex-1 text-[13px] font-semibold" style={F_TEXTO}>Tasas de las contribuciones</h3>
          {editando && (
            <label className="flex items-center gap-1.5 text-[12px]" style={{ color: C.texto2, ...F_TEXTO }}>
              <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Aplicar a las 10 agencias
            </label>
          )}
          {editando ? (
            <>
              <BotonSecundario onClick={() => { setEditando(false); setTodas(false); }}>Cancelar</BotonSecundario>
              <BotonGuardar onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</BotonGuardar>
            </>
          ) : (
            <BotonSecundario onClick={() => { setEditando(true); setMsg(null); setTexto({ cosedeFija: "", cosedePar: "", sepsActivos: "", sepsExcedentes: "" }); }}>Editar</BotonSecundario>
          )}
        </div>
        {msg && <p className="px-4 pt-2 text-[12px]" style={{ color: msg.e ? C.alerta : C.ok, ...F_TEXTO }}>{msg.t}</p>}
        <table className="w-full text-[11px] border-collapse" style={F_TABLA}>
          <thead>
            <tr style={{ color: C.texto2, borderBottom: `1px solid ${C.borde}` }}>
              <th className="pl-4 py-2 text-left font-semibold">Tasa</th>
              <th className="px-2 py-2 text-right font-semibold">Usada</th>
              <th className="px-2 py-2 text-left font-semibold">Origen</th>
              <th className="px-2 py-2 text-right font-semibold">Real {anio} / norma</th>
              <th className="px-4 py-2 text-left font-semibold">{editando ? "Nueva tasa (%)" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(CONCEPTO) as Clave[]).map((k) => (
              <tr key={k} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                <td className="pl-4" style={{ color: C.texto3 }}>{ETIQUETA[k]}</td>
                <td className="px-2 text-right font-semibold">{fmt(k, t[k])}</td>
                <td className="px-2" style={{ color: C.texto2 }}>
                  {ORIGEN[t.origen[k]]}
                  {t.origen[k] === "guardado" && <button type="button" className="ml-2 underline" style={{ color: C.acento }} onClick={() => usarDefecto(k)}>usar {k.startsWith("cosede") ? "la real" : "la norma"}</button>}
                </td>
                <td className="px-2 text-right" style={{ color: C.texto2 }}>{real[k]}</td>
                <td className="px-4">
                  {editando && (
                    <input value={texto[k]} placeholder={(t[k] * 100).toFixed(k === "sepsActivos" ? 3 : 3)} inputMode="decimal" aria-label={ETIQUETA[k]}
                           onChange={(e) => setTexto({ ...texto, [k]: e.target.value })}
                           className="h-7 w-[110px] rounded px-2 text-right text-[11px] bg-white" style={{ border: `1px solid ${C.borde}` }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// METODOLOGÍA DE 4504 (explicación con las cifras de la agencia, como la del Fondo de Liquidez)
// =====================================================================

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Un paso: a la izquierda lo que dice la norma; a la derecha el cálculo con las cifras de la herramienta. */
function PasoMetodo({ n, titulo, regla, children, ultimo }: { n: number | string; titulo: string; regla: ReactNode; children: ReactNode; ultimo?: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2" style={{ borderBottom: ultimo ? "none" : `1px solid ${C.beige}` }}>
      <div className="px-5 py-4 flex gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ background: C.acento }}>{n}</span>
        <div className="flex flex-col gap-1.5">
          <b className="text-[13px]">{titulo}</b>
          <div className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>{regla}</div>
        </div>
      </div>
      <div className="px-5 py-4 flex flex-col gap-1.5 lg:border-l" style={{ borderColor: C.beige, background: "#FAFBFA" }}>{children}</div>
    </div>
  );
}
/** Línea de cálculo: concepto a la izquierda y cifra a la derecha. */
function Linea({ concepto, valor, total, signo }: { concepto: ReactNode; valor: string; total?: boolean; signo?: string }) {
  return (
    <div className="flex items-baseline gap-3 text-[12px]" style={total ? { borderTop: "1px solid #B9C3BD", paddingTop: 5, marginTop: 2, fontWeight: 700 } : undefined}>
      <span className="w-4 shrink-0 text-center" style={{ color: C.texto2 }}>{signo ?? ""}</span>
      <span className="flex-1" style={{ color: total ? C.texto : C.texto3 }}>{concepto}</span>
      <span className="whitespace-nowrap" style={F_TABLA}>{valor}</span>
    </div>
  );
}
const Ejemplo = ({ children }: { children: ReactNode }) => <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>{children}</span>;

function Metodologia4504({ d, agencia, ejercicio, manuales, totalAnual, onCerrar }: {
  d: Datos; agencia: string; ejercicio: number; manuales: { concepto: string; nombre: string; total: number }[]; totalAnual: number; onCerrar: () => void;
}) {
  const [mes, setMes] = useState(0);
  const t = d.tasas, r = d.real, sd = d.seps.detalle, anio = ejercicio - 1, nm = MESES_LARGOS[mes];
  const s21 = d.saldo21;
  const cierreAnt = mes === 0 ? s21?.corte ?? 0 : s21?.porMes[mes - 1] ?? 0, cierre = s21?.porMes[mes] ?? 0;
  const corteTxt = d.corte ? `${MESES_LARGOS[d.corte.mes - 1]} ${d.corte.anio}` : "el corte";
  const tasaTxt = (v: number) => pct(v, 3);
  const origenCosede = t.origen.cosedeFija === "guardado" ? "guardada en Tasas" : t.origen.cosedeFija === "historico" ? `real de ${anio}` : "valor anterior de la herramienta (sin histórico)";
  const cr = r?.cosedeReal;
  const totalCosede = suma(d.cosede.fija) + suma(d.cosede.par), totalSeps = suma(d.seps.porMes), totalManual = suma(manuales.map((x) => x.total));

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${C.borde}` }}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ background: C.acentoSuave }}>
        <BookOpen size={17} color={C.acento} />
        <b className="text-[14px] flex-1" style={{ color: C.acento, ...F_TEXTO }}>Metodología de 4504 · Impuestos, contribuciones y multas · {agencia}</b>
        <span className="text-[12px]" style={{ color: C.texto2, ...F_TEXTO }}>Ver el ejemplo de</span>
        <div className="-mb-2"><SelectorMes mes={mes} onMes={setMes} /></div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar metodología" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white"><X size={16} color={C.texto2} /></button>
      </div>

      <div style={F_TEXTO}>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <div className="px-5 py-4 flex flex-col gap-1.5">
            <b className="text-[13px]">¿Qué se calcula y qué se carga?</b>
            <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
              La herramienta <b>calcula</b> las dos contribuciones obligatorias: el <b>Seguro de Depósitos (COSEDE)</b>, en 45042010 (prima fija) y
              45042105 (prima ajustada por riesgo), y el <b>aporte a la SEPS</b>, en 450415. Esas cuentas no se cargan a mano. Las demás cuentas de 4504
              (impuestos municipales, otros impuestos) se <b>cargan</b> en la tabla y entran tal cual al resultado.
            </p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-1.5 lg:border-l" style={{ borderColor: C.beige }}>
            <b className="text-[13px]">¿De dónde salen las tasas?</b>
            <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
              COSEDE: Resolución 648-2021-F de la Junta de Política y Regulación Financiera; las cooperativas de los segmentos 1 a 3 pagan cada mes
              (hasta el día 8 del mes siguiente). Las primas las fija la Junta, por eso se usa la <b>tasa real de {anio}</b> de la agencia, que se puede
              cambiar en Tasas. SEPS: Resolución SEPS-IGT-ITICA-IGJ-2017-124: 0,45 por mil semestral sobre activos y 1 % sobre excedentes.
            </p>
          </div>
        </div>

        <PasoMetodo n={1} titulo="COSEDE · base: saldo promedio de Obligaciones con el público"
          regla={<>La norma usa el <b>saldo promedio diario del grupo 21</b>. Como el presupuesto tiene saldos de fin de mes, el promedio del mes se aproxima con el
            <b> cierre del mes anterior y el cierre del mes</b> (enero usa el saldo del balance a {corteTxt}).</>}>
          <Ejemplo>Ejemplo · {nm}</Ejemplo>
          <Linea concepto={mes === 0 ? `Grupo 21 en el balance a ${corteTxt}` : `Cierre de ${MESES_LARGOS[mes - 1]}`} valor={usd(cierreAnt)} />
          <Linea signo="+" concepto={`Cierre de ${nm}`} valor={usd(cierre)} />
          <Linea signo="÷" concepto="Entre 2" valor="2" />
          <Linea concepto={`Saldo promedio de ${nm}`} valor={usd(d.cosede.base[mes])} total />
        </PasoMetodo>

        <PasoMetodo n={2} titulo="COSEDE · tasa real del año anterior"
          regla={<><b>Tasa anual = lo pagado en el año ÷ meses × 12 ÷ saldo promedio del grupo 21.</b> Se toma del estado de resultados y los balances históricos
            de la agencia (450420 prima fija y 450421 prima ajustada por riesgo). Si guardas otra tasa en Tasas, se usa la guardada.</>}>
          <Ejemplo>{cr?.periodo ? `Real ${anio} · hasta ${cr.periodo}` : `Sin histórico de ${anio}`}</Ejemplo>
          {cr?.periodo ? (
            <>
              <Linea concepto={`Prima fija registrada (450420) en ${cr.meses} meses`} valor={usd(cr.pagadoFija)} />
              <Linea signo="÷" concepto={`${cr.meses} meses × 12`} valor={usd((cr.pagadoFija / cr.meses) * 12)} />
              <Linea signo="÷" concepto="Saldo promedio del grupo 21" valor={usd(cr.base21)} />
              <Linea concepto="Prima fija anual real" valor={cr.fijaAnual != null ? tasaTxt(cr.fijaAnual) : "—"} total />
              <Linea concepto={`Prima ajustada por riesgo anual real (450421: ${usd(cr.pagadoPar)})`} valor={cr.parAnual != null ? tasaTxt(cr.parAnual) : "—"} />
              <Linea concepto={`Tasas usadas en ${ejercicio} (${origenCosede})`} valor={`${tasaTxt(t.cosedeFija)} + ${tasaTxt(t.cosedePar)}`} />
            </>
          ) : (
            <Linea concepto={`Tasas usadas (${origenCosede})`} valor={`${tasaTxt(t.cosedeFija)} + ${tasaTxt(t.cosedePar)}`} total />
          )}
        </PasoMetodo>

        <PasoMetodo n={3} titulo="COSEDE · contribución del mes"
          regla={<><b>Contribución = saldo promedio × (prima fija + prima ajustada por riesgo) ÷ 12.</b> Se registra cada mes en 45042010 y 45042105 y sale de caja
            el mismo mes en el Flujo de efectivo.</>}>
          <Ejemplo>Ejemplo · {nm}</Ejemplo>
          <Linea concepto="Saldo promedio (paso 1)" valor={usd(d.cosede.base[mes])} />
          <Linea signo="×" concepto={`Prima fija ${tasaTxt(t.cosedeFija)} ÷ 12 → 45042010`} valor={usd(d.cosede.fija[mes])} />
          <Linea signo="×" concepto={`Prima ajustada por riesgo ${tasaTxt(t.cosedePar)} ÷ 12 → 45042105`} valor={usd(d.cosede.par[mes])} />
          <Linea concepto={`COSEDE de ${nm}`} valor={usd(d.cosede.fija[mes] + d.cosede.par[mes])} total />
          <Linea concepto={`COSEDE del año ${ejercicio}`} valor={usd(totalCosede)} />
        </PasoMetodo>

        <PasoMetodo n={4} titulo="SEPS · abril: segundo semestre y excedentes"
          regla={<>Se paga hasta el 30 de abril: <b>0,45 por mil × activos promedio de julio a diciembre del año anterior</b>, más el <b>1 % de las utilidades y
            excedentes del año anterior</b> (ingresos 51–56 − gastos 41–47, menos el 15 % de participación a trabajadores). El 1 % es de la cooperativa: cada
            agencia asume su parte según su participación en el activo; si hubo pérdida, es 0.</>}>
          <Ejemplo>Abril {ejercicio}</Ejemplo>
          <Linea concepto={`Activos promedio jul–dic ${anio}${r?.activosSegundoSemestre.meses.length ? ` (${r.activosSegundoSemestre.meses.length} meses cargados)` : " (activo del balance de partida)"}`} valor={usd(sd.activosH2)} />
          <Linea signo="×" concepto="0,45 por mil" valor={usd(sd.abrilActivos)} />
          <Linea signo="+" concepto={`1 % × (excedente ${anio} ${usd(sd.excedente)} − 15 % = ${usd(sd.excedenteNeto)}) × participación ${pct(sd.participacion, 2)}`} valor={usd(sd.parteExcedente)} />
          <Linea concepto="SEPS de abril → 450415" valor={usd(d.seps.porMes[3])} total />
        </PasoMetodo>

        <PasoMetodo n={5} titulo="SEPS · septiembre: primer semestre"
          regla={<>Se paga hasta el 30 de septiembre: <b>0,45 por mil × activos promedio de enero a junio</b> del año. Como esos meses son proyectados, el activo
            se estima con el <b>activo del balance de partida más lo que crecen las captaciones</b> hasta junio.</>}>
          <Ejemplo>Septiembre {ejercicio}</Ejemplo>
          <Linea concepto={`Activos promedio estimados ene–jun ${ejercicio}`} valor={usd(sd.activosH1)} />
          <Linea signo="×" concepto="0,45 por mil" valor={usd(sd.septiembre)} />
          <Linea concepto="SEPS de septiembre → 450415" valor={usd(d.seps.porMes[8])} total />
          <Linea concepto={`SEPS del año ${ejercicio}`} valor={usd(totalSeps)} />
        </PasoMetodo>

        <PasoMetodo n={6} titulo="Total 4504 en el Estado de resultados" ultimo
          regla={<><b>4504 = COSEDE + SEPS + cuentas cargadas.</b> El total llega al Estado de resultados, al Flujo de efectivo (sale de caja en el mes) y al resultado
            del ejercicio que pasa a la cuenta 36 del Balance.</>}>
          <Ejemplo>Año {ejercicio}</Ejemplo>
          <Linea concepto="COSEDE (paso 3)" valor={usd(totalCosede)} />
          <Linea signo="+" concepto="SEPS (pasos 4 y 5)" valor={usd(totalSeps)} />
          {manuales.map((x) => <Linea key={x.concepto} signo="+" concepto={`${x.concepto} ${x.nombre} (cargada)`} valor={usd(x.total)} />)}
          <Linea concepto="Total 4504" valor={usd(totalAnual)} total />
          {Math.abs(totalCosede + totalSeps + totalManual - totalAnual) >= 1 && <Linea concepto="Diferencia (revisar)" valor={usd(totalCosede + totalSeps + totalManual - totalAnual)} />}
        </PasoMetodo>
      </div>
    </div>
  );
}
