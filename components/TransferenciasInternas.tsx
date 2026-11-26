"use client";

import { leerMonto, textoEditable } from "../lib/numeros";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch, useDatos } from "../lib/useDatos";
import { EsqueletoTabla } from "./Carga";
import { MESES, C, BORDE_EDICION, suma, numero, usd, leerNumero, Indicador, FranjaIndicadores, TablaMeses, type DefFila } from "./ActivosComun";
import { VentanaFormulario, SeccionForm, CampoForm, CAMPO, BORDE } from "./VentanaFormulario";
import { OFICINAS } from "../lib/calc/prestamos-internos";

/**
 * Transferencias internas (1908 / 2908): Resumen de la agencia, Préstamos internos (con abono mensual, interés y
 * préstamos nuevos) y Transaccionalidad entre agencias. El interés se calcula como contabilidad (por días, base 360).
 */
type Proy = { saldoCorte: number; saldo: number[]; abonos: number[]; nuevos: number[]; interes: number[]; diasAntes: number[]; diasDespues: number[] };
interface Prestamo {
  prestamista: string; deudora: string; saldoPresta: number; saldoRecibe: number;
  abono: number; abonoGuardado: boolean; abonoHistorico: number | null;
  nuevos: { id: number; mes: number; monto: number; descripcion: string }[];
  presta: Proy; recibe: Proy; termina: string | null;
}
interface Oficina { agencia: string; corte: { anio: number; mes: number } | null; corrientes: { contraparte: string; saldo: number; cambioMensual: number | null }[]; prestamos1908: number; prestamos2908: number; corrientes1908: number; corrientes2908: number }
interface Datos { ejercicio: number; tasa: number; tasaGuardada: boolean; oficinas: Oficina[]; prestamos: Prestamo[]; error?: string }
type FormNuevo = { id: number | null; prestamista: string; deudora: string; mes: number; monto: string; descripcion: string };
const TDn = "px-4 whitespace-nowrap text-right";
const LINEA = "#ECEFED";
const cero = (v: number) => Math.round(v) === 0;
const val = (v: number) => (cero(v) ? <span style={{ color: C.tenue }}>—</span> : numero(v));

function Cab({ children, izq }: { children: ReactNode; izq?: boolean }) {
  return <th className={`${izq ? "pl-4 pr-3 text-left" : "px-4 text-right"} font-semibold whitespace-nowrap`}>{children}</th>;
}
export function TransferenciasInternas({ agencia }: { agencia: string }) {
  const [version, setVersion] = useState(0);
  const { datos: d, cargando, error } = useDatos<Datos>(`/api/transferencias-internas?v=${version}`, version, (x) => (x.oficinas ? null : x.error ?? "No se pudo leer."));
  const [pestana, setPestana] = useState<"resumen" | "prestamos" | "transacciones">("resumen");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [editAbono, setEditAbono] = useState<string | null>(null);
  const [txt, setTxt] = useState("");
  const [editTasa, setEditTasa] = useState(false);
  const [form, setForm] = useState<FormNuevo | null>(null);
  const [errForm, setErrForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (cargando) return <EsqueletoTabla filas={8} />;
  if (error || !d) return <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>;

  const consolidado = agencia === "Consolidado";
  const ej = d.ejercicio, dic = `dic-${String(ej).slice(2)}`;
  const listo = () => setVersion((v) => v + 1);
  const toggle = (k: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  async function post(body: object) {
    const r = await apiFetch("/api/transferencias-internas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ejercicio: ej, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
  }
  async function guardarAbono(p: Prestamo, usarPromedio = false) {
    const v = usarPromedio ? null : leerNumero(txt);
    const err = leerMonto(txt).error;
    if (!usarPromedio && err) { setMsg(`Abono: ${err}.`); return; }
    if (!usarPromedio && (v === null || v < 0)) { setMsg("Escribe el abono mensual (0 o más)."); return; }
    if (guardando) return;
    setGuardando(true); setMsg(null);
    try { await post({ accion: "abono", prestamista: p.prestamista, deudora: p.deudora, abono: v }); setEditAbono(null); listo(); }
    catch (e) { setMsg(`No se pudo guardar: ${e instanceof Error ? e.message : "error"}`); }
    finally { setGuardando(false); }
  }
  async function guardarTasa() {
    const v = leerNumero(txt);
    const err = leerMonto(txt).error;
    if (err) { setMsg(`Tasa: ${err}.`); return; }
    if (v === null || !(v >= 0 && v <= 30)) { setMsg("Escribe la tasa anual entre 0 % y 30 % (por ejemplo 7,03)."); return; }
    if (guardando) return;
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/otros-pasivo-parametros", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia: "Matriz", concepto: "ingresos_tasa_prestamos_internos", montosPorMes: Array(12).fill(v), todasLasAgencias: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      setEditTasa(false); listo();
    } catch (e) { setMsg(`No se pudo guardar: ${e instanceof Error ? e.message : "error"}`); }
    finally { setGuardando(false); }
  }
  async function guardarNuevo() {
    if (!form) return;
    const v = leerNumero(form.monto);
    if (!form.prestamista || !form.deudora || form.prestamista === form.deudora) { setErrForm("Elige quién presta y quién recibe."); return; }
    const err = leerMonto(form.monto).error;
    if (err) { setErrForm(`Monto: ${err}.`); return; }
    if (v === null || !(v > 0)) { setErrForm("Escribe el monto."); return; }
    if (guardando) return;
    setGuardando(true); setErrForm(null);
    try { await post({ accion: "nuevo", id: form.id, prestamista: form.prestamista, deudora: form.deudora, mes: form.mes, monto: v, descripcion: form.descripcion }); setForm(null); listo(); }
    catch (e) { setErrForm(`No se pudo guardar: ${e instanceof Error ? e.message : "error"}`); }
    finally { setGuardando(false); }
  }
  async function eliminar(id: number) {
    if (!window.confirm("¿Eliminar este préstamo nuevo?")) return;
    try { await post({ accion: "eliminar", id }); listo(); } catch (e) { setMsg(`No se pudo eliminar: ${e instanceof Error ? e.message : "error"}`); }
  }

  // ── Préstamos de la agencia (o todos en el consolidado) ──
  const prestamos = d.prestamos.filter((p) => consolidado || p.prestamista === agencia || p.deudora === agencia);
  const lado = (p: Prestamo): Proy => (!consolidado && p.deudora === agencia ? p.recibe : p.presta);
  const of = (n: string) => d.oficinas.find((o) => o.agencia === n);

  // ── Resumen (meses) ──
  const sumaP = (lista: Prestamo[], l: "presta" | "recibe", k: keyof Pick<Proy, "saldo" | "abonos" | "nuevos" | "interes">) => MESES.map((_, i) => lista.reduce((t, p) => t + p[l][k][i], 0));
  const ofs = consolidado ? d.oficinas : d.oficinas.filter((o) => o.agencia === agencia);
  const c1908 = ofs.reduce((t, o) => t + o.corrientes1908, 0), c2908 = ofs.reduce((t, o) => t + o.corrientes2908, 0);
  const lent = d.prestamos.filter((p) => consolidado || p.prestamista === agencia), owed = d.prestamos.filter((p) => consolidado || p.deudora === agencia);
  const pr1908 = sumaP(lent, "presta", "saldo"), pr2908 = sumaP(owed, "recibe", "saldo");
  const intC = sumaP(lent, "presta", "interes"), intP = sumaP(owed, "recibe", "interes");
  const abC = sumaP(lent, "presta", "abonos"), abP = sumaP(owed, "recibe", "abonos");
  const nvO = sumaP(lent, "presta", "nuevos"), nvR = sumaP(owed, "recibe", "nuevos");
  const z = (v: number[]) => v.some((x) => !cero(x));
  const constante = (v: number) => Array(12).fill(v) as number[];
  const filasRes: DefFila[] = [
    { id: "t1", label: "Transaccionalidad", valores: constante(c1908), total: c1908, totalNormal: true, formula: () => `Saldo del corte de las subcuentas de 1908 que no son préstamos: ${usd(c1908)}. Se mantiene en el año.` },
    ...(z(pr1908) || lent.length ? [{ id: "p1", label: "Préstamos otorgados", valores: pr1908, total: pr1908[11], totalNormal: true, formula: (i: number) => `Saldo de lo prestado a otras oficinas después del abono de ${MESES[i].toLowerCase()}: ${usd(pr1908[i])}.` }] : []),
    { id: "s1", label: "Saldo 1908", valores: pr1908.map((v) => v + c1908), total: pr1908[11] + c1908, clave: true, formula: (i: number) => `Transaccionalidad + préstamos otorgados = ${usd(pr1908[i] + c1908)}. Llega al Balance.` },
    { id: "t2", label: "Transaccionalidad", valores: constante(c2908), total: c2908, totalNormal: true, formula: () => `Saldo del corte de las subcuentas de 2908 que no son préstamos: ${usd(c2908)}. Se mantiene en el año.` },
    ...(z(pr2908) || owed.length ? [{ id: "p2", label: "Préstamos recibidos", valores: pr2908, total: pr2908[11], totalNormal: true, formula: (i: number) => `Saldo de lo que debe a otras oficinas después del abono de ${MESES[i].toLowerCase()}: ${usd(pr2908[i])}.` }] : []),
    { id: "s2", label: "Saldo 2908", valores: pr2908.map((v) => v + c2908), total: pr2908[11] + c2908, clave: true, formula: (i: number) => `Transaccionalidad + préstamos recibidos = ${usd(pr2908[i] + c2908)}. Llega al Balance.` },
    ...(z(intC) ? [{ id: "ic", label: "(+) Interés cobrado · 51909005", valores: intC, total: suma(intC), color: "ok" as const, formula: (i: number) => `Saldo prestado del mes anterior × ${d.tasa.toFixed(2).replace(".", ",")} % ÷ 12 = ${usd(intC[i])}.` }] : []),
    ...(z(intP) ? [{ id: "ip", label: "(−) Interés pagado · 41059005", valores: intP.map((v) => -v), total: -suma(intP), color: "alerta" as const, formula: (i: number) => `Saldo recibido del mes anterior × ${d.tasa.toFixed(2).replace(".", ",")} % ÷ 12 = ${usd(intP[i])}.` }] : []),
    ...(z(abC) ? [{ id: "ac", label: "(+) Abonos cobrados", valores: abC, total: suma(abC), color: "ok" as const, formula: (i: number) => `Capital que abonan las oficinas deudoras: ${usd(abC[i])}. Entra a caja.` }] : []),
    ...(z(abP) ? [{ id: "ap", label: "(−) Abonos pagados", valores: abP.map((v) => -v), total: -suma(abP), color: "alerta" as const, formula: (i: number) => `Capital abonado a la oficina que prestó: ${usd(abP[i])}. Sale de caja.` }] : []),
    ...(z(nvO) ? [{ id: "no", label: "(−) Préstamos nuevos otorgados", valores: nvO.map((v) => -v), total: -suma(nvO), color: "alerta" as const, formula: (i: number) => `Préstamos nuevos a otras oficinas: ${usd(nvO[i])}. Sale de caja.` }] : []),
    ...(z(nvR) ? [{ id: "nr", label: "(+) Préstamos nuevos recibidos", valores: nvR, total: suma(nvR), color: "ok" as const, formula: (i: number) => `Préstamos nuevos de otras oficinas: ${usd(nvR[i])}. Entra a caja.` }] : []),
  ];
  const grupos: Record<string, string> = { t1: "1908 · Le deben otras oficinas", t2: "2908 · Debe a otras oficinas" };
  const primeraER = filasRes.find((f) => ["ic", "ip", "ac", "ap", "no", "nr"].includes(f.id));
  if (primeraER) grupos[primeraER.id] = "Estado de resultados y flujo";

  // ── Préstamos internos: una fila por préstamo; al abrirla, sus meses en las mismas columnas ──
  const tasaTxt = `${d.tasa.toFixed(2).replace(".", ",")} %`;
  const difLibros = d.prestamos.filter((p) => Math.abs(p.saldoPresta - p.saldoRecibe) >= 1);
  const totP = (f: (p: Prestamo) => number) => prestamos.reduce((t, p) => t + f(p), 0);
  const CABT = { color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 };
  const iconos = (hijos: ReactNode) => <span className="opacity-60 group-hover:opacity-100 transition-opacity inline-flex items-center">{hijos}</span>;
  const btnIcono = "w-6 h-6 rounded inline-flex items-center justify-center";
  const tablaPrestamos = (
    <table className="w-full table-fixed border-collapse text-[11px] min-w-[940px]" style={{ fontVariantNumeric: "tabular-nums" }}>
      <colgroup><col style={{ width: 200 }} /><col style={{ width: 150 }} /><col /><col /><col /><col /><col /><col style={{ width: 130 }} /></colgroup>
      <thead><tr className="font-semibold" style={CABT}>
        <Cab izq>Oficina receptora</Cab><th className="pr-3 text-left font-semibold">Oficina proveedora</th><Cab>Saldo</Cab><Cab>Abono mensual</Cab><Cab>Tasa</Cab>
        <Cab>Interés {ej}</Cab><Cab>Saldo {dic}</Cab><th />
      </tr></thead>
      <tbody>
        {prestamos.map((p) => {
          const k = `${p.prestamista}|${p.deudora}`, ed = editAbono === k, l = lado(p), ab = abiertos.has(k);
          const dif = Math.abs(p.saldoPresta - p.saldoRecibe) >= 1;
          return (
            <Fragment key={k}>
              <tr className="group hover:bg-[#F5F7F6] cursor-pointer" onClick={() => !ed && toggle(k)} style={{ borderTop: `1px solid ${C.beige}`, height: 32, color: C.texto3, fontWeight: ab ? 600 : 400 }}>
                <td className="pl-2 pr-3 whitespace-nowrap" style={{ color: C.texto }}><span className="inline-flex items-center gap-1.5">
                  {ab ? <ChevronDown size={13} color={C.texto2} /> : <ChevronRight size={13} color={C.texto2} />}{p.deudora}</span></td>
                <td className="pr-3 whitespace-nowrap" style={{ color: C.texto2 }}>{p.prestamista}</td>
                <td className={TDn} style={dif ? { color: "#B7791F" } : undefined} title={dif ? `No cuadra: ${p.prestamista} registra ${numero(p.saldoPresta)} y ${p.deudora} ${numero(p.saldoRecibe)}` : undefined}>{numero(l.saldoCorte)}</td>
                <td className={TDn} onClick={(e) => ed && e.stopPropagation()}>
                  {ed ? <input value={txt} onChange={(e) => setTxt(e.target.value)} inputMode="decimal" autoFocus aria-label="Abono mensual"
                      onKeyDown={(e) => { if (e.key === "Enter") guardarAbono(p); if (e.key === "Escape") setEditAbono(null); }}
                      className="w-[96px] h-6 rounded-md px-2 text-right text-[11px]" style={{ border: `1px solid ${BORDE_EDICION}` }} />
                    : <span title={p.abonoGuardado ? `Editado · abono del último mes ${p.abonoHistorico !== null ? numero(p.abonoHistorico) : "—"}` : "Abono del último mes"}>{val(p.abono)}</span>}
                </td>
                <td className={TDn}>{tasaTxt}</td>
                <td className={TDn}>{val(suma(l.interes))}</td>
                <td className={TDn}>{val(l.saldo[11])}</td>
                <td className="pr-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{ed ? <span className="inline-flex gap-1">
                    <button type="button" onClick={() => setEditAbono(null)} className="h-6 px-2 rounded-md bg-white text-[11px] font-semibold" style={BORDE}>Cancelar</button>
                    <button type="button" onClick={() => guardarAbono(p)} disabled={guardando} className="h-6 px-2 rounded-md text-white text-[11px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>Guardar</button></span>
                  : iconos(<>
                    {p.abonoGuardado && p.abonoHistorico !== null && <button type="button" onClick={() => guardarAbono(p, true)} className="h-6 px-1.5 rounded text-[11px] font-normal hover:underline" style={{ color: C.acento }}>Usar último</button>}
                    <button type="button" onClick={() => { setEditTasa(false); setEditAbono(k); setTxt(textoEditable(p.abono)); setMsg(null); }} aria-label="Editar abono" title="Editar abono mensual"
                      className={`${btnIcono} hover:bg-[#E3EEE7]`}><Pencil size={12} color={C.texto2} /></button></>)}</td>
              </tr>
              {ab && MESES.map((m, i) => {
                const antes = i === 0 ? l.saldoCorte : l.saldo[i - 1];
                if (cero(antes) && cero(l.nuevos[i]) && cero(l.saldo[i])) return null;
                const nv = p.nuevos.filter((n) => n.mes === i + 1);
                return (
                  <tr key={m} className="group" style={{ borderTop: `1px solid ${LINEA}`, height: 30, color: C.texto2, background: "#FAFBFA" }}>
                    <td className="pl-9 pr-3">{m} {ej}</td>
                    <td className="pr-3 whitespace-nowrap" title={nv.map((n) => n.descripcion).filter(Boolean).join(" · ") || undefined}>{l.nuevos[i] ? `Préstamo nuevo +${numero(l.nuevos[i])}` : ""}</td>
                    <td className={TDn} title="Saldo antes del abono">{numero(antes)}</td>
                    <td className={TDn} title="Abono del día 4">{val(-l.abonos[i])}</td>
                    <td className={TDn} title={`${l.diasAntes[i]} días con el saldo antes del abono + ${l.diasDespues[i]} con el saldo después (base 360)`}>{l.diasAntes[i]} + {l.diasDespues[i]} días</td>
                    <td className={TDn} title={`${numero(antes)} × ${tasaTxt} × ${l.diasAntes[i]}/360 + ${numero(l.saldo[i])} × ${tasaTxt} × ${l.diasDespues[i]}/360`}>{numero(l.interes[i])}</td>
                    <td className={TDn} title="Saldo después del abono">{numero(l.saldo[i])}</td>
                    <td className="pr-3 text-right">{nv.length > 0 && iconos(<>
                      <button type="button" onClick={() => { const n = nv[0]; setErrForm(null); setForm({ id: n.id, prestamista: p.prestamista, deudora: p.deudora, mes: n.mes, monto: String(n.monto).replace(".", ","), descripcion: n.descripcion }); }} aria-label="Editar préstamo nuevo" className={`${btnIcono} hover:bg-[#E3EEE7]`}><Pencil size={12} color={C.texto2} /></button>
                      <button type="button" onClick={() => eliminar(nv[0].id)} aria-label="Eliminar préstamo nuevo" className={`${btnIcono} hover:bg-[#F6E3E1]`}><Trash2 size={12} color={C.texto2} /></button></>)}</td>
                  </tr>
                );
              })}
            </Fragment>
          );
        })}
        {!prestamos.length && <tr><td colSpan={8} className="px-4 py-4" style={{ color: C.tenue }}>{agencia} no tiene préstamos internos.</td></tr>}
        {prestamos.length > 1 && (
          <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 34, color: C.texto }}>
            <td className="pl-4">Total</td><td />
            <td className={TDn}>{numero(totP((p) => lado(p).saldoCorte))}</td>
            <td className={TDn}>{numero(totP((p) => p.abono))}</td><td />
            <td className={TDn}>{numero(totP((p) => suma(lado(p).interes)))}</td>
            <td className={TDn}>{numero(totP((p) => lado(p).saldo[11]))}</td><td />
          </tr>
        )}
      </tbody>
    </table>
  );
  const avisoLibros = difLibros.filter((p) => consolidado || p.prestamista === agencia || p.deudora === agencia);

  // ── Transaccionalidad: quienes financian y quienes usan fondos, con su posición neta ──
  const neto = (o: Oficina) => o.corrientes.reduce((t, c) => t + c.saldo, 0);
  const leDeben = (o: Oficina) => o.corrientes.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const debeA = (o: Oficina) => o.corrientes.filter((c) => c.saldo < 0).sort((a, b) => a.saldo - b.saldo);
  const sumaC = (l: { saldo: number }[]) => l.reduce((t, c) => t + c.saldo, 0);
  const maxNeto = Math.max(1, ...d.oficinas.map((o) => Math.abs(neto(o))));
  const barra = (v: number) => (
    <div className="h-[6px] rounded-full" style={{ width: `${Math.max(2, (Math.abs(v) / maxNeto) * 100)}%`, background: v >= 0 ? "#8FBF9F" : "#E3A79F" }} />
  );
  const filaOficina = (o: Oficina, fija = false) => {
    const k = `t${o.agencia}`, ab = fija || abiertos.has(k), n = neto(o);
    const subtitulo = (t: string) => <tr style={{ borderTop: `1px solid ${LINEA}`, height: 26, background: "#FAFBFA" }}><td colSpan={6} className="pl-9 text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: C.tenue }}>{t}</td></tr>;
    const contraparte = (c: { contraparte: string; saldo: number }) => (
      <tr key={c.contraparte} style={{ borderTop: `1px solid ${LINEA}`, height: 30, color: C.texto2, background: "#FAFBFA" }}>
        <td className="pl-9 pr-3">{c.contraparte}</td>
        <td className={TDn}>{c.saldo > 0 ? numero(c.saldo) : ""}</td>
        <td className={TDn}>{c.saldo < 0 ? numero(c.saldo) : ""}</td><td /><td /><td />
      </tr>
    );
    return (
      <Fragment key={o.agencia}>
        <tr className={fija ? "" : "hover:bg-[#F5F7F6] cursor-pointer"} onClick={() => !fija && toggle(k)} style={{ borderTop: `1px solid ${C.beige}`, height: 32, color: C.texto3, fontWeight: ab ? 600 : 400 }}>
          <td className="pl-2 pr-3" style={{ color: C.texto }}><span className="inline-flex items-center gap-1.5">{ab ? <ChevronDown size={13} color={C.texto2} /> : <ChevronRight size={13} color={C.texto2} />}{o.agencia}</span></td>
          <td className={TDn}>{val(sumaC(leDeben(o)))}</td>
          <td className={TDn}>{val(sumaC(debeA(o)))}</td>
          <td className={TDn} style={{ color: C.texto }}>{numero(n)}</td>
          <td className="pl-16 pr-4">{barra(n)}</td><td />
        </tr>
        {ab && leDeben(o).length > 0 && <>{subtitulo("Le deben")}{leDeben(o).map(contraparte)}</>}
        {ab && debeA(o).length > 0 && <>{subtitulo("Debe a")}{debeA(o).map(contraparte)}</>}
      </Fragment>
    );
  };
  const financian = d.oficinas.filter((o) => neto(o) >= 0).sort((a, b) => neto(b) - neto(a));
  const usan = d.oficinas.filter((o) => neto(o) < 0).sort((a, b) => neto(a) - neto(b));
  const grupoT = (titulo: string, lista: Oficina[]) => (
    <>
      <tr style={{ borderTop: `1px solid #DDE2DF`, height: 31 }}><td colSpan={6} className="pl-4 text-[12px] font-bold" style={{ color: C.acento }}>{titulo}</td></tr>
      {lista.map((o) => filaOficina(o))}
      <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 32, color: C.texto }}>
        <td className="pl-4">Subtotal</td>
        <td className={TDn}>{numero(lista.reduce((t, o) => t + sumaC(leDeben(o)), 0))}</td>
        <td className={TDn}>{numero(lista.reduce((t, o) => t + sumaC(debeA(o)), 0))}</td>
        <td className={TDn}>{numero(lista.reduce((t, o) => t + neto(o), 0))}</td><td /><td />
      </tr>
    </>
  );
  const unaOf = of(agencia);
  const tablaTrans = (
    <table className="w-full table-fixed border-collapse text-[11px] min-w-[860px]" style={{ fontVariantNumeric: "tabular-nums" }}>
      <colgroup><col style={{ width: 220 }} /><col /><col /><col /><col style={{ width: 320 }} /><col style={{ width: 40 }} /></colgroup>
      <thead><tr className="font-semibold" style={CABT}>
        <Cab izq>Agencia</Cab><Cab>Le deben</Cab><Cab>Debe</Cab><Cab>Posición neta</Cab><th className="pl-16 pr-4 text-left font-semibold">Tamaño</th><th />
      </tr></thead>
      <tbody>
        {!consolidado && unaOf ? filaOficina(unaOf, true) : <>
          {grupoT("Financian a otras agencias", financian)}
          {grupoT("Usan fondos de otras agencias", usan)}
          <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 34, color: C.texto }}>
            <td className="pl-4">Total</td>
            <td className={TDn}>{numero(d.oficinas.reduce((t, o) => t + sumaC(leDeben(o)), 0))}</td>
            <td className={TDn}>{numero(d.oficinas.reduce((t, o) => t + sumaC(debeA(o)), 0))}</td>
            <td className={TDn} title="Debería ser 0: lo que una oficina registra como «le deben» otra lo registra como «debe». La diferencia son partidas en tránsito.">{numero(d.oficinas.reduce((t, o) => t + neto(o), 0))}</td><td /><td />
          </tr>
        </>}
      </tbody>
    </table>
  );

  const fm = form, vFm = fm ? leerNumero(fm.monto) ?? 0 : 0;
  const totalInteres = consolidado ? suma(intC) : suma(intC) - suma(intP);
  return (
    <div className="flex flex-col gap-5 pb-6">
      <FranjaIndicadores>
        <Indicador titulo={`1908 a ${dic}`} valor={usd(pr1908[11] + c1908)} pie={`Préstamos otorgados ${usd(pr1908[11])}`} />
        <Indicador titulo={`2908 a ${dic}`} valor={usd(pr2908[11] + c2908)} pie={`Préstamos recibidos ${usd(pr2908[11])}`} />
        <Indicador titulo={consolidado ? `Interés interno ${ej}` : `Interés neto ${ej}`} valor={usd(totalInteres)} pie={consolidado ? "Cobrado = pagado (se anula)" : `Cobrado ${usd(suma(intC))} · pagado ${usd(suma(intP))}`} />
        <Indicador titulo="Tasa préstamos internos" valor={`${d.tasa.toFixed(2).replace(".", ",")} %`} pie="Interés pagado cada mes" />
      </FranjaIndicadores>
      <section className="tarjeta overflow-hidden">
        <div className="flex items-end gap-2 px-4 min-h-[52px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <div role="tablist" aria-label="Transferencias internas" className="flex gap-6 flex-1">
            {([["resumen", "Resumen"], ["prestamos", "Préstamos internos"], ["transacciones", "Transaccionalidad"]] as const).map(([id, l]) => (
              <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => { setPestana(id); setMsg(null); }} className="pb-3 pt-4 -mb-px text-[13px]"
                style={{ color: pestana === id ? C.texto : C.texto2, fontWeight: pestana === id ? 600 : 400, borderBottom: `2px solid ${pestana === id ? C.acento : "transparent"}` }}>{l}</button>
            ))}
          </div>
          {pestana === "prestamos" && <>
            {editTasa ? <span className="self-center inline-flex items-center gap-1.5 text-[12px]" style={{ color: C.texto2 }}>Tasa
                <input value={txt} onChange={(e) => setTxt(e.target.value)} inputMode="decimal" autoFocus onKeyDown={(e) => { if (e.key === "Enter") guardarTasa(); if (e.key === "Escape") setEditTasa(false); }}
                  className="w-[64px] h-8 rounded-md px-2 text-right text-[12px]" style={{ border: `1px solid ${BORDE_EDICION}` }} /> %
                <button type="button" onClick={guardarTasa} disabled={guardando} className="h-8 px-2.5 rounded-md text-white text-[11.5px] font-semibold" style={{ background: C.acento }}>Guardar</button></span>
              : <button type="button" onClick={() => { setEditAbono(null); setEditTasa(true); setTxt(d.tasa.toFixed(2).replace(".", ",")); setMsg(null); }} className="self-center h-8 px-3 rounded-lg bg-white text-[12.5px] font-medium" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
                  Tasa {d.tasa.toFixed(2).replace(".", ",")} %</button>}
            <button type="button" onClick={() => { setErrForm(null); setForm({ id: null, prestamista: consolidado ? "Matriz" : agencia, deudora: "", mes: 1, monto: "", descripcion: "" }); }}
              className="self-center h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}><Plus size={14} /> Registrar préstamo</button>
          </>}
        </div>
        {msg && <p className="px-4 pt-3 text-[12px]" style={{ color: C.alerta }}>{msg}</p>}
        {pestana === "resumen" && <TablaMeses titulo={consolidado ? "Consolidado" : agencia} ultima="Año / Dic" filas={filasRes} grupos={grupos} titulosAparte />}
        {pestana === "prestamos" && <div className="overflow-x-auto">{tablaPrestamos}
          {avisoLibros.length > 0 && <p className="px-4 py-2.5 text-[11px]" style={{ color: "#8A5A12", borderTop: `1px solid ${C.beige}` }}>
            No cuadran entre libros: {avisoLibros.map((p) => `${p.prestamista} registra ${numero(p.saldoPresta)} prestado a ${p.deudora}, que registra ${numero(p.saldoRecibe)}`).join(" · ")}.</p>}
        </div>}
        {pestana === "transacciones" && <div className="overflow-x-auto">{tablaTrans}</div>}
      </section>
      {fm && (
        <VentanaFormulario titulo={fm.id ? "Editar préstamo interno" : "Registrar préstamo interno"} onCerrar={() => setForm(null)} onGuardar={guardarNuevo} guardando={guardando} error={errForm} ancho={640}
          pie={vFm > 0 && fm.deudora ? `${fm.prestamista} entrega ${usd(vFm)} a ${fm.deudora} en ${MESES[fm.mes - 1].toLowerCase()}; desde el mes siguiente paga interés al ${d.tasa.toFixed(2).replace(".", ",")} %` : ""}>
          <SeccionForm t="Préstamo">
            <CampoForm label="Presta" span={2}>
              <select value={fm.prestamista} onChange={(e) => setForm({ ...fm, prestamista: e.target.value })} className={CAMPO} style={BORDE}>
                {OFICINAS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </CampoForm>
            <CampoForm label="Recibe" span={2}>
              <select value={fm.deudora} onChange={(e) => setForm({ ...fm, deudora: e.target.value })} className={CAMPO} style={BORDE}>
                <option value="">Elegir…</option>{OFICINAS.filter((o) => o !== fm.prestamista).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </CampoForm>
            <CampoForm label="Mes" span={2}>
              <select value={fm.mes} onChange={(e) => setForm({ ...fm, mes: Number(e.target.value) })} className={CAMPO} style={BORDE}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m} {ej}</option>)}
              </select>
            </CampoForm>
            <CampoForm label="Monto" span={2}>
              <input value={fm.monto} onChange={(e) => setForm({ ...fm, monto: e.target.value })} inputMode="decimal" placeholder="0,00" className={`${CAMPO} text-right`} style={BORDE} />
            </CampoForm>
            <CampoForm label="Descripción (opcional)" span={4}>
              <input value={fm.descripcion} onChange={(e) => setForm({ ...fm, descripcion: e.target.value })} placeholder="Ej. Fondeo para colocación" className={CAMPO} style={BORDE} />
            </CampoForm>
          </SeccionForm>
        </VentanaFormulario>
      )}
    </div>
  );
}
