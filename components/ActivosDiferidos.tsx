"use client";

import { leerMonto, textoEditable } from "../lib/numeros";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { apiFetch, useDatos } from "../lib/useDatos";
import { EsqueletoTabla } from "./Carga";
import { AGENCIAS, MESES, C, BORDE_EDICION, suma, numero, usd, etiquetaCorte, leerNumero, Indicador, FranjaIndicadores, TablaMeses, type DefFila } from "./ActivosComun";
import { mesesAmortizacion, type GrupoDiferido, type PartidaCalc, type GrupoCalc, type PlanMateriales } from "../lib/calc/activos-diferidos";
import { VentanaFormulario, SeccionForm, CampoForm, CAMPO, BORDE } from "./VentanaFormulario";
import { NOMBRE_CUENTA_1905, type LecturaArchivo } from "../lib/calc/diferidos-archivo";

/**
 * Gastos anticipados (1904), gastos diferidos (1905) y materiales (1906).
 *  - Movimiento: saldo del grupo mes a mes (balance al corte + pagos − gasto).
 *  - Pólizas / Partidas: agrupadas por su cuenta de gasto (un tipo de seguro = un grupo con su subtotal), ordenadas por
 *    fecha; en «Resumen» con su vigencia y montos, en «Mensual» el gasto de cada mes. Ahí mismo se registran y editan.
 * El cuadre con el balance se hace contra la subcuenta donde están las partidas (1904: 190490 otros gastos anticipados;
 * lo demás de la 1904, como los anticipos a terceros 190410, no se proyecta y se mantiene).
 */
type Partida = PartidaCalc & { agencia?: string; agencias?: number; miembros?: Partida[] };
type Pcts = { agencia: string; pct: number; pctAnterior?: number | null; base: number; corte: { anio: number; mes: number }; fuente: string }[];
interface Datos {
  corte: { anio: number; mes: number }; fechaCorte: string; ejercicio: number;
  proyeccion: { grupos: Record<GrupoDiferido, GrupoCalc>; partidas: Partida[] };
  saldosSub?: Record<string, number>;
  cuentas: { codigo: string; nombre: string }[];
  gastoPorDefecto: Record<GrupoDiferido, string>;
  porcentajesActivo?: Pcts;
  error?: string;
}
const TEXTO: Record<GrupoDiferido, { titulo: string; lista: string; gasto: string; ejemplo: string; cuenta: string }> = {
  "1904": { titulo: "Gastos y pagos anticipados", lista: "Pólizas", gasto: "4503", ejemplo: "Ej. Seguro de vehículos", cuenta: "190490" },
  "1905": { titulo: "Gastos diferidos", lista: "Partidas", gasto: "4506", ejemplo: "Ej. Licencia del sistema", cuenta: "1905" },
  "1906": { titulo: "Materiales, mercaderías e insumos", lista: "Compras", gasto: "450705", ejemplo: "Ej. Suministros de oficina", cuenta: "1906" },
};
const fechaCorta = (f: string) => { const [a, m, d] = f.split("-"); return `${d}/${m}/${a.slice(2)}`; };
const pc1 = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
interface Form { id: number | null; descripcion: string; detalle: string; proveedor: string; cuentaActivo: string; cuentaGasto: string; fechaInicio: string; fechaFin: string; monto: string; alcance: "agencia" | "cooperativa" | "reparto"; renueva: boolean; incremento: string; pctBase: "corte" | "anterior"; enCuotas: boolean; mesesPago: number[]; unitario: string; reparto: Record<string, string>; mesCompra: number; mesesConsumo: number }


export function ActivosDiferidos({ agencia, grupo }: { agencia: string; grupo: GrupoDiferido }) {
  const [version, setVersion] = useState(0);
  const { datos: d, cargando, error } = useDatos<Datos>(`/api/activos-diferidos?agencia=${encodeURIComponent(agencia)}`, version, (x) => (x.proyeccion ? null : x.error ?? "No se pudo calcular."));
  if (cargando) return <EsqueletoTabla filas={6} />;
  if (error || !d) return <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>;
  const g = d.proyeccion.grupos[grupo];
  const partidas = d.proyeccion.partidas.filter((p) => p.grupo === grupo);
  const tx = TEXTO[grupo], corte = etiquetaCorte(d.corte), dic = `dic-${String(d.ejercicio).slice(2)}`;
  const gastoAnio = suma(g.gastoPorMes), pagosAnio = suma(g.pagosPorMes);
  // lo que sale de caja: contado y cuota inicial + cuotas pagadas; lo que queda por pagar a diciembre (25)
  const altaD = suma(g.deudaAltaPorMes ?? []), pagoD = suma(g.deudaPagoPorMes ?? []);
  // 1906: los pedidos a Matriz y sus entregas no son efectivo (van contra transferencias internas)
  const internoMat = g.plan ? suma(g.plan.pedidos) - suma(g.plan.entregas) : 0;
  const cajaAnio = pagosAnio - internoMat - altaD + pagoD, porPagarDic = altaD - pagoD;
  const ctasGasto = [...new Set(partidas.map((p) => p.cuentaGasto.slice(0, grupo === "1906" ? 6 : 4)).filter(Boolean))].sort().join(" / ") || tx.gasto;
  const recargar = () => setVersion((v) => v + 1);

  // 1904 = 190410 anticipos a terceros (saldo ± variación) + 190490 otros gastos anticipados (pólizas)
  const ant = grupo === "1904" ? g.anticipos ?? { saldoCorte: 0, variacionPorMes: Array(12).fill(0) as number[], saldoPorMes: Array(12).fill(0) as number[] } : null;
  const otrosCorte = g.saldoCorte - (ant?.saldoCorte ?? 0);
  const otrosSaldo = g.saldoPorMes.map((v, i) => v - (ant?.saldoPorMes[i] ?? 0));
  
  const si = MESES.map((_, i) => (i === 0 ? otrosCorte : otrosSaldo[i - 1]));
  const movimiento: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: si, total: otrosCorte, formula: (i) => (i === 0 ? `Saldo a ${corte}: ${usd(otrosCorte)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "pa", label: `(+) ${grupo === "1906" ? "Compras" : grupo === "1905" ? "Nuevas partidas y renovaciones" : "Pólizas contratadas o renovadas"}`, valores: g.pagosPorMes, total: pagosAnio, color: "ok",
      formula: (i) => grupo === "1906" ? `Compra mensual de la agencia (pestaña Por agencia) ${usd(g.plan?.compras[i] ?? 0)} + compras adicionales del mes ${usd(g.pagosPorMes[i] - (g.plan?.compras[i] ?? 0))} = ${usd(g.pagosPorMes[i])}. Sale de fondos disponibles.` : `Partidas que empiezan en ${MESES[i]} (las que empiezan entre el corte y diciembre entran en enero): ${usd(g.pagosPorMes[i])}. Entran completas al activo; las que se pagan en cuotas dejan lo que falta en cuentas por pagar (25).` },
    { id: "ga", label: `(−) ${grupo === "1906" ? "Consumo" : grupo === "1905" ? "Amortización" : "Gasto devengado"} · ${ctasGasto}`, valores: g.gastoPorMes.map((v) => -v), total: -gastoAnio, color: "alerta",
      formula: (i) => grupo === "1906" ? `Consumo mensual de la agencia ${usd(g.plan?.consumo[i] ?? 0)} + consumo de las compras adicionales ${usd(g.gastoPorMes[i] - (g.plan?.consumo[i] ?? 0))} = ${usd(g.gastoPorMes[i])}. Llega al Estado de resultados en 450705 (suministros); no es salida de efectivo.` : `Cuotas mensuales iguales de cada partida, como en contabilidad: monto ÷ número de meses, desde el mes siguiente al inicio hasta el mes de fin (${usd(g.gastoPorMes[i])} en ${MESES[i]}). Llega al Estado de resultados; no es salida de efectivo.` },
    { id: "sf", label: "Saldo final", valores: otrosSaldo, total: otrosSaldo[11], clave: true,
      formula: (i) => `Saldo inicial + ${grupo === "1906" ? "compras − consumo" : "pagos − gasto"} = ${usd(si[i])} + ${usd(g.pagosPorMes[i])} − ${usd(g.gastoPorMes[i])} = ${usd(otrosSaldo[i])}.` },
  ];
  // 1906: compras de Matriz, pedidos que reciben las agencias, entregas de Matriz y compras adicionales registradas
  const pl = g.plan;
  if (grupo === "1906" && pl) {
    const z = (v: number[]) => v.some((x) => Math.abs(x) >= 0.5);
    const cons = agencia === "Consolidado";
    movimiento.splice(1, 3,
      ...(z(pl.compras) || pl.esBodega || cons ? [{ id: "co", label: "(+) Compras de proveeduría · 1906", valores: pl.compras, total: suma(pl.compras), color: "ok" as const,
        formula: (i: number) => `Compras de proveeduría registradas en Matriz: ${usd(pl.compras[i])}. Salen de fondos disponibles.` }] : []),
      ...(!cons && (z(pl.pedidos) || !pl.esBodega) ? [{ id: "pe", label: "(+) Pedidos a Matriz · 1906", valores: pl.pedidos, total: suma(pl.pedidos), color: "ok" as const,
        formula: (i: number) => `Pedidos registrados de la agencia: ${usd(pl.pedidos[i])}. Sube su 1906; no es efectivo (transferencias internas 2908).` }] : []),
      ...(!cons && z(pl.entregas) ? [{ id: "en", label: "(−) Entregas a las agencias", valores: pl.entregas.map((v) => -v), total: -suma(pl.entregas), color: "alerta" as const,
        formula: (i: number) => `Pedidos de las agencias que entrega Matriz: ${usd(pl.entregas[i])}. No es efectivo (transferencias internas 1908).` }] : []),
      { id: "ga", label: "(−) Gasto · 450705", valores: g.gastoPorMes.map((v) => -v), total: -gastoAnio, color: "alerta" as const,
        formula: (i: number) => `Gastos registrados: ${usd(g.gastoPorMes[i])}. Baja la 1906 y llega al Estado de resultados en 450705 (suministros).` },
      { id: "sf", label: "Saldo final", valores: otrosSaldo, total: otrosSaldo[11], clave: true, formula: (i: number) => `Saldo inicial + entradas − salidas − consumo = ${usd(otrosSaldo[i])}.` },
    );
  }
  const tablaMov = <TablaMeses key={`m${grupo}`} titulo={grupo === "1904" ? "Otros gastos anticipados" : tx.titulo} ultima="Año / Dic" filas={movimiento} />;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <FranjaIndicadores>
        <Indicador titulo={`${grupo} a ${dic}`} valor={usd(g.saldoPorMes[11])} pie={`${g.saldoPorMes[11] >= g.saldoCorte ? "Sube" : "Baja"} ${usd(Math.abs(g.saldoPorMes[11] - g.saldoCorte))} desde ${corte}`} />
        <Indicador titulo={`Gasto ${d.ejercicio} · ${ctasGasto}`} valor={usd(gastoAnio)} pie={`Promedio mensual ${usd(gastoAnio / 12)}`} />
        <Indicador titulo={`Pagos ${d.ejercicio}`} valor={usd(cajaAnio)} pie={porPagarDic > 0.5 ? `Por pagar a dic: ${usd(porPagarDic)}` : "Salen de fondos disponibles"} />
        {grupo === "1906" && g.plan ? <Indicador titulo={`${g.plan.esBodega || agencia === "Consolidado" ? "Compras" : "Pedidos"} ${d.ejercicio} · 1906`} valor={usd(suma(g.plan.esBodega || agencia === "Consolidado" ? g.plan.compras : g.plan.pedidos))}
            pie={`Promedio mensual ${usd(suma(g.plan.esBodega || agencia === "Consolidado" ? g.plan.compras : g.plan.pedidos) / 12)}`} />
          : ant ? <Indicador titulo={`Anticipos a terceros a ${dic}`} valor={usd(ant.saldoPorMes[11])} pie={`Al corte ${usd(ant.saldoCorte)}`} />
          : <Indicador titulo={tx.lista} valor={String(partidas.length)} pie={`${partidas.filter((p) => p.vigenteAlCorte).length} vigentes al corte`} />}
      </FranjaIndicadores>
      <section className="tarjeta overflow-hidden">
        {grupo === "1906" ? <Materiales agencia={agencia} ejercicio={d.ejercicio} corte={corte} resumen={tablaMov} onCambio={recargar} /> : <Partidas key={grupo} d={d} grupo={grupo} agencia={agencia} partidas={partidas} onCambio={recargar} vistas={grupo === "1904" && ant ? [
          { id: "resumen", label: "Resumen", contenido: <TablaMeses key="r04" titulo="Cuenta" ultima="Var. año" filas={[
            { id: "a", label: "190410 · Anticipos a terceros", valores: ant.saldoPorMes, total: ant.saldoPorMes[11] - ant.saldoCorte, totalConSigno: true,
              formula: (i) => `Saldo final de Anticipos a terceros: ${usd(ant.saldoPorMes[i])}.` },
            { id: "o", label: "190490 · Otros gastos anticipados", valores: otrosSaldo, total: otrosSaldo[11] - otrosCorte, totalConSigno: true,
              formula: (i) => `Saldo final de Otros gastos anticipados (pólizas): ${usd(otrosSaldo[i])}.` },
            { id: "t", label: "Total 1904", valores: g.saldoPorMes, total: g.saldoPorMes[11] - g.saldoCorte, clave: true, totalConSigno: true,
              formula: (i) => `190410 + 190490 = ${usd(ant.saldoPorMes[i])} + ${usd(otrosSaldo[i])} = ${usd(g.saldoPorMes[i])}. Llega al Balance.` },
          ]} /> },
          { id: "anticipos", label: "Anticipos a terceros", contenido: <Anticipos ant={ant} agencia={agencia} corte={corte} onGuardado={recargar} /> },
          { id: "otros", label: "Otros gastos anticipados", contenido: tablaMov },
        ] : [{ id: "movimiento", label: "Resumen", contenido: tablaMov }]} />}
      </section>
    </div>
  );
}

/** 1906 · Materiales: pestañas Resumen y Pedidos y gastos (lo registrado por agencia; nada viene lleno). */
type Mov = { id: number; movimiento: "pedido" | "gasto"; descripcion: string; fechaInicio: string; fechaFin: string; monto: number; porMes: number[] };
type PlanAg = PlanMateriales & { agencia: string; registros: Mov[] };
type FormMov = { id: number | null; movimiento: "pedido" | "gasto"; agencia: string; mes: number; valor: string; descripcion: string };
/** Mes(es) de un registro: «mar-27» o «Todos los meses». */
function mesesDe(p: Mov, ejercicio: number): { mes: number; texto: string } {
  const a = Number(p.fechaInicio.slice(5, 7)), b = Number(p.fechaFin.slice(5, 7));
  const todos = p.fechaInicio.startsWith(`${ejercicio}-01`) && p.fechaFin.startsWith(`${ejercicio}-12`);
  const yy = String(ejercicio).slice(2);
  return todos ? { mes: 0, texto: "Todos los meses" } : { mes: a, texto: a === b ? `${MESES_MIN[a - 1]}-${yy}` : `${MESES_MIN[a - 1]} a ${MESES_MIN[b - 1]}-${yy}` };
}
const nombreMov = (m: "pedido" | "gasto", agencia: string) => (m === "gasto" ? "Gasto" : agencia === "Matriz" ? "Compra de proveeduría" : "Pedido a Matriz");
function Materiales({ agencia, ejercicio, corte, resumen, onCambio }: { agencia: string; ejercicio: number; corte: string; resumen: ReactNode; onCambio: () => void }) {
  const [pestana, setPestana] = useState<"resumen" | "registro">("resumen");
  const [version, setVersion] = useState(0);
  const { datos, cargando, error } = useDatos<{ agencias: PlanAg[]; error?: string }>(`/api/materiales-plan?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}&v=${version}`, version, (x) => x.error ?? null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set(agencia === "Consolidado" ? [] : [agencia]));
  const [form, setForm] = useState<FormMov | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errForm, setErrForm] = useState<string | null>(null);
  const consolidado = agencia === "Consolidado";
  const lista = datos?.agencias ?? [];
  const dic = `dic-${String(ejercicio).slice(2)}`;
  const listo = () => { setVersion((v) => v + 1); onCambio(); };

  async function post(body: object) {
    const r = await apiFetch("/api/activos-diferidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
  }
  async function guardar() {
    if (!form) return;
    const v = leerNumero(form.valor);
    if (!form.agencia) { setErrForm("Elige la agencia."); return; }
    const errV = leerMonto(form.valor).error;
    if (errV) { setErrForm(`Valor: ${errV}.`); return; }
    if (v === null || !(v > 0)) { setErrForm("Escribe el valor."); return; }
    if (guardando) return;
    const y = ejercicio, m = form.mes, mm = String(m).padStart(2, "0");
    const fechas = m === 0 ? { fechaInicio: `${y}-01-01`, fechaFin: `${y}-12-31` }
      : { fechaInicio: `${y}-${mm}-01`, fechaFin: `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
    setGuardando(true); setErrForm(null);
    try {
      await post({ accion: "guardar", agencia: form.agencia, partida: {
        id: form.id, grupo: "1906", movimiento: form.movimiento, descripcion: form.descripcion.trim() || nombreMov(form.movimiento, form.agencia), detalle: "", proveedor: "",
        cuentaActivo: "190615", cuentaGasto: "450705", ...fechas, monto: m === 0 ? v * 12 : v, alcance: "agencia", renueva: false, incremento: 0, mesesPago: [] } });
      setAbiertos((s) => new Set(s).add(form.agencia));
      setForm(null); listo();
    } catch (e) { setErrForm(`No se pudo guardar: ${e instanceof Error ? e.message : "error"}`); }
    finally { setGuardando(false); }
  }
  async function eliminar(p: Mov) {
    if (!window.confirm(`¿Eliminar «${p.descripcion}»?`)) return;
    try { await post({ accion: "eliminar", id: p.id }); listo(); }
    catch (e) { setMsg(`No se pudo eliminar: ${e instanceof Error ? e.message : "error"}`); }
  }
  const abrirForm = (movimiento: "pedido" | "gasto", ag?: string, p?: Mov) => {
    setErrForm(null);
    if (p) { const md = mesesDe(p, ejercicio); setForm({ id: p.id, movimiento: p.movimiento, agencia: ag!, mes: md.mes, valor: textoEditable(md.mes === 0 ? p.monto / 12 : p.monto), descripcion: p.descripcion === nombreMov(p.movimiento, ag!) ? "" : p.descripcion }); }
    else setForm({ id: null, movimiento, agencia: ag ?? (consolidado ? "" : agencia), mes: 0, valor: "", descripcion: "" });
  };

  const TDn = "px-4 whitespace-nowrap text-right";
  const tot = (f: (a: PlanAg) => number) => lista.reduce((t, a) => t + f(a), 0);
  const val = (v: number, neg = false) => (Math.round(v) === 0 ? <span style={{ color: C.tenue }}>—</span> : numero(neg ? -v : v));
  const entra = (a: PlanAg) => suma(a.esBodega ? a.compras : a.pedidos);
  const todos = lista.length > 0 && lista.every((a) => abiertos.has(a.agencia));

  // Formulario: valor, meses y el detalle de los 12 meses
  const vFm = form ? leerNumero(form.valor) ?? 0 : 0;
  const detalle = MESES.map((_, i) => (form && (form.mes === 0 || form.mes === i + 1) ? vFm : 0));
  const planFm = form ? lista.find((a) => a.agencia === form.agencia) : undefined;
  const sugerido = planFm ? (form?.movimiento === "gasto" ? planFm.promedioGasto : planFm.promedioPedido) : 0;

  const cabecera = (t: string, sub: string) => (
    <th className="px-4 text-right font-semibold whitespace-nowrap align-bottom pb-2">
      <span className="block">{t}</span><span className="block text-[10.5px] font-normal" style={{ color: C.tenue }}>{sub}</span>
    </th>
  );
  // Matriz: lo que entrega a las agencias baja su 1906 (va en Pedidos con signo negativo, así la fila cuadra y el total de
  // pedidos de la cooperativa es lo que compra Matriz)
  const totalEntradas = tot((a) => entra(a) - suma(a.entregas));
  const tabla = cargando ? <div className="p-4"><EsqueletoTabla filas={6} /></div> : error ? <p className="px-4 py-4 text-[12px]" style={{ color: C.alerta }}>{error}</p> : (
    <div className="overflow-x-auto">
      {msg && <p className="px-4 pt-3 text-[12px]" style={{ color: C.alerta }}>{msg}</p>}
      <table className="w-full border-collapse text-[12px] min-w-[860px]" style={{ fontVariantNumeric: "tabular-nums", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: 260 }} /><col /><col /><col /><col /><col /><col style={{ width: 64 }} /></colgroup>
        <thead>
          <tr style={{ color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF" }}>
            <th className="pl-4 pr-3 text-left font-semibold align-bottom pb-2">Agencia</th>
            {cabecera("Valor mensual", "registrado")}
            {cabecera("Saldo inicial", corte)}
            {cabecera("Pedidos", "1906")}
            {cabecera("Gasto", "450705")}
            {cabecera("Saldo final", dic)}
            <th className="pr-3 text-right align-bottom pb-1.5">
              <button type="button" onClick={() => setAbiertos(todos ? new Set() : new Set(lista.map((a) => a.agencia)))} aria-label={todos ? "Contraer todo" : "Expandir todo"} title={todos ? "Contraer todo" : "Expandir todo"}
                className="w-7 h-7 rounded-md inline-flex items-center justify-center hover:bg-[#F3F5F4]" style={{ color: C.texto2 }}>{todos ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          {lista.map((a) => {
            const ab = abiertos.has(a.agencia);
            const neg = a.saldoPorMes.some((v) => v < -0.5);
            return (
              <Fragment key={a.agencia}>
                <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 38, color: C.texto3, fontWeight: ab ? 600 : 400 }}>
                  <td className="pl-2 pr-3 whitespace-nowrap" style={{ color: C.texto }}>
                    <button type="button" onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(a.agencia)) n.delete(a.agencia); else n.add(a.agencia); return n; })}
                      className="inline-flex items-center gap-1.5" aria-expanded={ab}>
                      {ab ? <ChevronDown size={14} color={C.texto2} /> : <ChevronRight size={14} color={C.texto2} />}{a.agencia}
                      {a.esBodega && <span className="text-[10.5px] font-normal" style={{ color: C.tenue }}>· bodega</span>}</button>
                  </td>
                  <td />
                  <td className={TDn}>{numero(a.saldoCorte)}</td>
                  <td className={TDn} title={a.esBodega ? "Compras de proveeduría menos lo que entrega a las agencias (ver detalle)" : undefined}>{val(entra(a) - suma(a.entregas))}</td>
                  <td className={TDn}>{val(suma(a.consumo), true)}</td>
                  <td className={TDn} style={{ color: neg ? C.alerta : C.texto }} title={neg ? "El saldo queda negativo en algún mes: el gasto supera lo que hay más lo pedido" : undefined}>{numero(a.saldoPorMes[11])}</td>
                  <td />
                </tr>
                {ab && a.registros.map((p) => {
                  const md = mesesDe(p, ejercicio);
                  return (
                    <tr key={p.id} className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${LINEA}`, height: 34, color: C.texto3 }}>
                      <td className="pl-8 pr-3 whitespace-nowrap overflow-hidden text-ellipsis" title={p.descripcion}>{p.descripcion}</td>
                      <td className={TDn}>{md.mes !== 0 && <span className="mr-1.5 text-[10.5px]" style={{ color: C.tenue }}>{md.texto}</span>}{numero(p.movimiento === "gasto" ? -(md.mes === 0 ? p.monto / 12 : p.monto) : md.mes === 0 ? p.monto / 12 : p.monto)}</td>
                      <td />
                      <td className={TDn}>{p.movimiento === "pedido" ? numero(suma(p.porMes)) : ""}</td>
                      <td className={TDn}>{p.movimiento === "gasto" ? numero(-suma(p.porMes)) : ""}</td>
                      <td />
                      <td className="pr-3 text-right whitespace-nowrap">
                        <span className="opacity-60 group-hover:opacity-100 transition-opacity inline-flex gap-0.5">
                          <button type="button" onClick={() => abrirForm(p.movimiento, a.agencia, p)} aria-label="Editar" className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#E3EEE7]"><Pencil size={13} color={C.texto2} /></button>
                          <button type="button" onClick={() => eliminar(p)} aria-label="Eliminar" className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#F6E3E1]"><Trash2 size={13} color={C.texto2} /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {ab && a.esBodega && Math.abs(suma(a.entregas)) >= 0.5 && (
                  <tr style={{ borderTop: `1px solid ${LINEA}`, height: 34, color: C.texto2 }} title="Lo que piden las agencias: baja la 1906 de Matriz sin salir efectivo (transferencias internas)">
                    <td className="pl-8 pr-3 whitespace-nowrap">Entregas a las agencias</td>
                    <td className={TDn}>{numero(-suma(a.entregas) / 12)}</td><td />
                    <td className={TDn}>{numero(-suma(a.entregas))}</td><td colSpan={3} />
                  </tr>
                )}
                {ab && !a.registros.length && (
                  <tr style={{ borderTop: `1px solid ${LINEA}`, height: 34 }}>
                    <td colSpan={7} className="pl-8 text-[11.5px]" style={{ color: C.tenue }}>Sin registros</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {lista.length > 1 && (
            <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 40, color: C.texto }}>
              <td className="pl-4">Total</td><td />
              <td className={TDn}>{numero(tot((a) => a.saldoCorte))}</td>
              <td className={TDn}>{numero(totalEntradas)}</td>
              <td className={TDn}>{numero(-tot((a) => suma(a.consumo)))}</td>
              <td className={TDn}>{numero(tot((a) => a.saldoPorMes[11]))}</td><td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="flex items-end gap-2 px-4 min-h-[52px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div role="tablist" aria-label="Materiales" className="flex gap-6 flex-1">
          {([["resumen", "Resumen"], ["registro", "Pedidos y gastos"]] as const).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)} className="pb-3 pt-4 -mb-px text-[13px]"
              style={{ color: pestana === id ? C.texto : C.texto2, fontWeight: pestana === id ? 600 : 400, borderBottom: `2px solid ${pestana === id ? C.acento : "transparent"}` }}>{l}</button>
          ))}
        </div>
        {pestana === "registro" && (
          <div className="self-center flex gap-2">
            <button type="button" onClick={() => abrirForm("gasto")} className="h-8 px-3 rounded-lg bg-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
              <Plus size={14} /> Registrar gasto</button>
            <button type="button" onClick={() => abrirForm("pedido")} className="h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}>
              <Plus size={14} /> Registrar pedido</button>
          </div>
        )}
      </div>
      {pestana === "resumen" ? resumen : tabla}
      {form && (
        <VentanaFormulario titulo={`${form.id ? "Editar" : "Registrar"} ${form.movimiento === "gasto" ? "gasto de materiales" : form.agencia === "Matriz" ? "compra de proveeduría" : "pedido a Matriz"}`}
          onCerrar={() => setForm(null)} onGuardar={guardar} guardando={guardando} error={errForm} ancho={680}
          pie={vFm > 0 ? `${form.movimiento === "gasto" ? "Baja la 1906 y va a 450705" : form.agencia === "Matriz" ? "Sube la 1906 · sale de fondos disponibles" : "Sube la 1906 de la agencia"}: ${usd(suma(detalle))} en ${ejercicio}` : ""}>
          <SeccionForm t={form.movimiento === "gasto" ? "Gasto · 450705" : "Pedido · 1906"}>
            <CampoForm label="Agencia" span={2}>
              {consolidado && !form.id
                ? <select value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} className={CAMPO} style={BORDE}>
                    <option value="">Elegir…</option>{AGENCIAS.filter((x) => x !== "Consolidado").map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                : <input value={form.agencia} disabled className={CAMPO} style={{ ...BORDE, background: "#F5F7F6" }} />}
            </CampoForm>
            <CampoForm label="Meses" span={2}>
              <select value={form.mes} onChange={(e) => setForm({ ...form, mes: Number(e.target.value) })} className={CAMPO} style={BORDE}>
                <option value={0}>Todos los meses</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>Solo {m.toLowerCase()} {ejercicio}</option>)}
              </select>
            </CampoForm>
            <CampoForm label={form.mes === 0 ? "Valor mensual" : "Valor"} span={2}>
              <input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} inputMode="decimal" autoFocus
                placeholder={sugerido > 0 ? `Promedio ${numero(sugerido)}` : "0,00"} className={`${CAMPO} text-right`} style={BORDE} />
            </CampoForm>
            <CampoForm label="Descripción (opcional)" span={2}>
              <input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder={nombreMov(form.movimiento, form.agencia)} className={CAMPO} style={BORDE} />
            </CampoForm>
          </SeccionForm>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.tenue }}>Detalle mensual</span>
            <div className="grid grid-cols-6 md:grid-cols-12 rounded-md overflow-hidden text-[11px]" style={{ border: `1px solid ${C.beige}`, fontVariantNumeric: "tabular-nums" }}>
              {MESES.map((m, i) => (
                <div key={m} className="flex flex-col items-end px-1.5 py-1.5" style={{ borderLeft: i % 12 ? `1px solid ${C.beige}` : undefined }}>
                  <span style={{ color: C.texto2 }}>{MESES_MIN[i]}</span>
                  <span style={{ color: detalle[i] ? C.texto : C.tenue }}>{detalle[i] ? numero(detalle[i]) : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </VentanaFormulario>
      )}
    </>
  );
}

/** 190410 · Anticipos a terceros: saldo del corte ± una variación mensual promedio (la misma los 12 meses). */
function Anticipos({ ant, agencia, corte, onGuardado }: { ant: NonNullable<GrupoCalc["anticipos"]>; agencia: string; corte: string; onGuardado: () => void }) {
  const consolidado = agencia === "Consolidado";
  const actual = suma(ant.variacionPorMes) / 12;
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  async function guardar() {
    const v = leerNumero(texto);
    const errT = leerMonto(texto).error;
    if (errT) { setMsg({ t: `Valor: ${errT}.`, e: true }); return; }
    if (v === null) { setMsg({ t: "Escribe un valor (negativo si baja).", e: true }); return; }
    if (guardando) return;
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/otros-pasivo-parametros", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, concepto: "anticipos_terceros_variacion", montosPorMes: Array(12).fill(v) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      setEditando(false); onGuardado();
    } catch (e) { setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setGuardando(false); }
  }
  const si = MESES.map((_, i) => (i === 0 ? ant.saldoCorte : ant.saldoPorMes[i - 1]));
  const filas: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: si, total: ant.saldoCorte, formula: (i) => (i === 0 ? `Saldo de la 190410 a ${corte}: ${usd(ant.saldoCorte)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "va", label: "(+/−) Variación del mes", valores: ant.variacionPorMes, total: suma(ant.variacionPorMes), signo: true,
      formula: (i) => `Variación mensual promedio: ${usd(ant.variacionPorMes[i])}. Positiva: se entregan más anticipos (sale de caja); negativa: se liquidan (vuelve a caja).` },
    { id: "sf", label: "Saldo final", valores: ant.saldoPorMes, total: ant.saldoPorMes[11], clave: true,
      formula: (i) => `Saldo inicial + variación = ${usd(si[i])} + ${usd(ant.variacionPorMes[i])} = ${usd(ant.saldoPorMes[i])}.` },
  ];
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <span className="text-[13px]" style={{ color: C.texto2 }}>Variación mensual promedio</span>
        {editando ? (
          <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" autoFocus aria-label="Variación mensual promedio"
            onKeyDown={(e) => { if (e.key === "Enter") guardar(); if (e.key === "Escape") setEditando(false); }}
            className="w-[120px] h-8 rounded-md px-2.5 text-right text-[13px] font-semibold" style={{ border: `1px solid ${BORDE_EDICION}` }} />
        ) : <b className="text-[14px]">{usd(actual)}</b>}
        {msg && <span className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</span>}
        <span className="flex-1" />
        {!consolidado && (editando ? <>
          <button type="button" onClick={() => setEditando(false)} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="h-8 px-3 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>{guardando ? "Guardando..." : "Guardar"}</button>
        </> : (
          <button type="button" onClick={() => { setTexto(String(Math.round(actual * 100) / 100).replace(".", ",")); setEditando(true); setMsg(null); }}
            className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1" style={{ color: C.acento, border: `1px solid ${BORDE_EDICION}`, background: "#fff" }}><Pencil size={13} /> Editar</button>
        ))}
      </div>
      <TablaMeses key="a04" titulo="Anticipos a terceros" ultima="Año / Dic" filas={filas} />
    </div>
  );
}

/** Mes de inicio (1–12) de una fecha AAAA-MM-DD, como lista; sin fecha, enero. */
const mesInicio = (f: string) => [Number(f?.slice(5, 7)) || 1];
/** Forma de pago guardada de una partida (las antiguas con «n cuotas» = n meses seguidos desde el inicio). */
function pagoDe(p: Partida): { enCuotas: boolean; mesesPago: number[] } {
  if (p.mesesPago?.length) return { enCuotas: true, mesesPago: [...p.mesesPago] };
  const n = Math.max(1, p.cuotasPago ?? 1), m0 = Number(p.fechaInicio.slice(5, 7)) || 1;
  return n > 1 ? { enCuotas: true, mesesPago: Array.from({ length: n }, (_, j) => ((m0 - 1 + j) % 12) + 1).sort((a, b) => a - b) } : { enCuotas: false, mesesPago: [] };
}
/** «Contado» o «4 cuotas · ene–abr». */
function textoPago(p: Partida): string {
  const { enCuotas, mesesPago } = pagoDe(p);
  if (!enCuotas) return "Contado";
  const seguidos = mesesPago.every((x, i) => i === 0 || x === mesesPago[i - 1] + 1);
  const meses = seguidos && mesesPago.length > 2 ? `${MESES.at(mesesPago[0] - 1)}–${MESES.at(mesesPago.at(-1)! - 1)}` : mesesPago.map((x) => MESES.at(x - 1)).join(", ");
  return `${mesesPago.length} ${mesesPago.length === 1 ? "cuota" : "cuotas"} · ${meses?.toLowerCase()}`;
}

/** Etiqueta de «Al vencer»: renueva (verde), vence en el año (ámbar), venció antes o vence después (gris). */
const ESTADO = {
  ren: { background: C.acentoSuave, color: C.acento },
  ven: { background: C.avisoSuave, color: "#7A4E0E" },
  fin: { background: C.crema, color: C.texto2 },
} as const;
const mesAnio = (f: string) => `${MESES[Number(f.slice(5, 7)) - 1].toLowerCase()}-${f.slice(2, 4)}`;
function estado(p: Partida, fechaCorte: string, ejercicio: number): { texto: string; tipo: keyof typeof ESTADO } {
  if (p.renueva) {
    // próximo vencimiento después del corte (cada período dura los mismos meses)
    const plazo = Math.max(1, (Number(p.fechaFin.slice(0, 4)) - Number(p.fechaInicio.slice(0, 4))) * 12 + Number(p.fechaFin.slice(5, 7)) - Number(p.fechaInicio.slice(5, 7)));
    let f = p.fechaFin;
    for (let k = 0; k < 40 && f <= fechaCorte; k++) {
      const y = Number(f.slice(0, 4)), m = Number(f.slice(5, 7)) - 1 + plazo;
      f = `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
    }
    return { texto: `Renueva ${mesAnio(f)}`, tipo: "ren" };
  }
  const y = Number(p.fechaFin.slice(0, 4));
  return { texto: `Vence ${mesAnio(p.fechaFin)}`, tipo: y === ejercicio ? "ven" : "fin" };
}

const LINEA = "#ECEFED";
const MESES_MIN = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const COLOR_PUNTO = { ren: C.acento, ven: "#B26A00", fin: "#B9C1BD" } as const;
/** Sección del formulario: título pequeño y campos en 4 columnas. */
function Seccion({ t, children }: { t: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.tenue }}>{t}</span>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}
/** Estado como punto de color y texto (diseño nuevo). */
function Punto({ tipo, texto }: { tipo: keyof typeof ESTADO; texto: string }) {
  return <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: C.texto2 }}><i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: COLOR_PUNTO[tipo] }} />{texto}</span>;
}
/** Lo que pasa al vencer en una subcuenta: cuántas se renuevan o vencen en el año. */
function resumenGrupo(ps: Partida[], fechaCorte: string, ejercicio: number): { texto: string; tipo: keyof typeof ESTADO } {
  const ren = ps.filter((p) => p.renueva).length;
  const ven = ps.filter((p) => !p.renueva && estado(p, fechaCorte, ejercicio).tipo === "ven").length;
  if (ren) return { texto: `${ren} ${ren === 1 ? "renueva" : "renuevan"}`, tipo: "ren" };
  if (ven) return { texto: `${ven} ${ven === 1 ? "vence" : "vencen"} en ${ejercicio}`, tipo: "ven" };
  return { texto: "No se renuevan", tipo: "fin" };
}

interface Grupo { cta: string; nombre: string; ps: Partida[]; monto: number; pend: number; gasto: number; mes: number[] }

function Partidas({ d, grupo, agencia, partidas, onCambio, vistas }: {
  d: Datos; grupo: GrupoDiferido; agencia: string; partidas: Partida[]; onCambio: () => void;
  /** Pestañas propias de la cuenta (Resumen…), antes de las fijas: gasto mensual y la lista (Partidas, Pólizas o Compras).
   *  «＋ Agregar» y «⋯» van solo en la lista. */
  vistas: { id: string; label: string; contenido: ReactNode }[];
}) {
  const tx = TEXTO[grupo];
  const consolidado = agencia === "Consolidado";
  const titulo = tx.titulo;
  const [pestana, setPestana] = useState<string>(vistas[0]?.id ?? "partidas");
  const vistaPropia = vistas.find((v) => v.id === pestana);
  const singular = grupo === "1904" ? "póliza" : grupo === "1906" ? "compra" : "partida";
  const [menu, setMenu] = useState<"mas" | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [conAgencias, setConAgencias] = useState<Set<number>>(new Set()); // partidas del consolidado abiertas por agencia
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [borrar, setBorrar] = useState<Partida | null>(null);
  const [verPct, setVerPct] = useState(false);
  const cuentasActivo = d.cuentas.filter((c) => c.codigo.startsWith(grupo));
  // 1904: seguros (4503) o amortización (4506); 1905: amortización (4506); 1906: suministros (450705)
  const cuentasGasto = d.cuentas.filter((c) => (grupo === "1906" ? c.codigo.startsWith("450705") : grupo === "1904" ? c.codigo.startsWith("4503") || c.codigo.startsWith("4506") : c.codigo.startsWith("4506")));
  const nombre = (cod: string) => d.cuentas.find((c) => c.codigo === cod)?.nombre ?? NOMBRE_CUENTA_1905[cod] ?? cod;
  // 1905: por subcuenta del activo (como el balance); 1904 y 1906: por cuenta de gasto
  const claveGrupo = (p: Partida) => (grupo === "1905" ? p.cuentaActivo || "1905" : p.cuentaGasto);
  const g0 = d.proyeccion.grupos[grupo];
  const sinPartida = grupo === "1905" ? g0.saldoCorte - g0.registradoCorte : 0;
  const pcts = d.porcentajesActivo ?? [];
  const editable = (p: Partida) => (!consolidado || p.alcance !== "agencia") && (p.agencias ?? 1) === 1;

  // agrupadas por la cuenta de gasto (un tipo de seguro = un grupo), ordenadas por cuenta y por fecha de inicio
  // Consolidado: la misma partida en varias agencias (licencias repartidas) se ve en un solo renglón
  const lista: Partida[] = consolidado ? Object.values(partidas.reduce<Record<string, Partida>>((acc, p) => {
    const k = p.alcance !== "agencia" ? `c${p.id}` : [p.descripcion, p.fechaInicio, p.fechaFin, p.cuentaActivo, p.cuentaGasto, p.renueva].join("|");
    const a = acc[k];
    if (!a) acc[k] = { ...p, agencias: 1, miembros: [p], gastoPorMes: [...p.gastoPorMes] };
    else { a.monto += p.monto; a.pendienteCorte += p.pendienteCorte; a.gastoPorMes = a.gastoPorMes.map((v, i) => v + p.gastoPorMes[i]); a.agencias = (a.agencias ?? 1) + 1; a.miembros!.push(p); }
    return acc;
  }, {})) : partidas;
  const grupos: Grupo[] = [...new Set(lista.map(claveGrupo))].sort().map((cta) => {
    const ps = lista.filter((p) => claveGrupo(p) === cta).sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio) || a.descripcion.localeCompare(b.descripcion));
    const montoP = (p: Partida) => (p.alcance !== "agencia" && !consolidado ? p.monto * p.parte : p.monto);
    return {
      cta, nombre: limpiar(nombre(cta)), ps, monto: ps.reduce((t, p) => t + montoP(p), 0), pend: ps.reduce((t, p) => t + p.pendienteCorte, 0),
      gasto: ps.reduce((t, p) => t + suma(p.gastoPorMes), 0), mes: MESES.map((_, i) => ps.reduce((t, p) => t + p.gastoPorMes[i], 0)),
    };
  });
  const alternar = (k: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const todos = grupos.length > 0 && grupos.every((x) => abiertos.has(x.cta));

  function abrir(p?: Partida) {
    setMsg(null);
    setForm(p ? {
      id: p.id, descripcion: p.descripcion, detalle: p.detalle ?? "", proveedor: p.proveedor, cuentaActivo: p.cuentaActivo, cuentaGasto: p.cuentaGasto, fechaInicio: p.fechaInicio, fechaFin: p.fechaFin,
      monto: String(p.monto).replace(".", ","), alcance: p.alcance, renueva: p.renueva, incremento: String(Math.round(p.incremento * 10000) / 100).replace(".", ","),
      pctBase: p.pctBase === "anterior" ? "anterior" : "corte", ...pagoDe(p),
      ...(() => {
        const q = p.reparto ?? {}, tq = Object.values(q).reduce((t, v) => t + v, 0);
        return { unitario: tq > 0 ? String(Math.round((p.monto / tq) * 100) / 100).replace(".", ",") : "", reparto: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) };
      })(),
      mesCompra: Number(p.fechaInicio.slice(5, 7)) || 1,
      mesesConsumo: Math.max(1, (Number(p.fechaFin.slice(0, 4)) - Number(p.fechaInicio.slice(0, 4))) * 12 + Number(p.fechaFin.slice(5, 7)) - Number(p.fechaInicio.slice(5, 7)) + 1),
    } : {
      id: null, descripcion: "", detalle: "", proveedor: "", cuentaActivo: cuentasActivo.find((c) => c.codigo === tx.cuenta)?.codigo ?? cuentasActivo[0]?.codigo ?? "",
      cuentaGasto: d.gastoPorDefecto[grupo] || cuentasGasto[0]?.codigo || (grupo === "1906" ? "450705" : ""),
      fechaInicio: "", fechaFin: "", monto: "", alcance: consolidado ? "cooperativa" : "agencia", renueva: grupo === "1904", incremento: "0", pctBase: "corte", enCuotas: false, mesesPago: [], unitario: "", reparto: {}, mesCompra: 1, mesesConsumo: 1,
      ...(grupo === "1906" ? { cuentaActivo: "190615", cuentaGasto: "450705" } : {}),
    });
  }
  async function pedir(body: unknown) {
    const r = await apiFetch("/api/activos-diferidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
  }
  async function guardar() {
    if (!form) return;
    if (guardando) return;
    // Montos en formato Ecuador: lo que no se puede leer se avisa antes de guardar
    const textos = [form.monto, form.unitario, form.incremento, ...Object.values(form.reparto ?? {})].filter((t): t is string => typeof t === "string");
    const malo = textos.map((t) => leerMonto(t).error).find(Boolean);
    if (malo) { setMsg({ t: `Revise los valores: ${malo}.`, e: true }); return; }
    setGuardando(true); setMsg(null);
    try {
      const reparto = form.alcance === "reparto" ? Object.fromEntries(Object.entries(form.reparto).map(([k, v]) => [k, leerNumero(v) ?? 0]).filter(([, v]) => (v as number) > 0)) : undefined;
      // materiales: la compra entra el mes elegido y se consume en ese mes y los siguientes (450705)
      const mat = grupo === "1906" ? (() => {
        const y = d.ejercicio, m0 = form.mesCompra - 1, m1 = m0 + form.mesesConsumo - 1;
        const fin = new Date(Date.UTC(y, m1 + 1, 0)).toISOString().slice(0, 10);
        return { fechaInicio: `${y}-${String(form.mesCompra).padStart(2, "0")}-01`, fechaFin: fin, renueva: false, enCuotas: false, cuentaGasto: form.cuentaGasto || "450705", cuentaActivo: form.cuentaActivo || "190615" };
      })() : {};
      await pedir({ accion: "guardar", agencia, partida: { ...form, ...mat, grupo, monto: montoF, reparto, incremento: leerNumero(form.incremento) ?? 0, mesesPago: form.enCuotas && grupo !== "1906" ? form.mesesPago : [] } });
      setForm(null); setMsg({ t: "Guardado." }); onCambio();
    } catch (e) { setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setGuardando(false); }
  }
  async function eliminar(p: Partida) {
    try { await pedir({ accion: "eliminar", id: p.id }); setBorrar(null); setMsg({ t: `«${p.descripcion}» eliminada.` }); onCambio(); }
    catch (e) { setBorrar(null); setMsg({ t: `No se pudo eliminar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
  }

  const campo = "h-9 w-full rounded-md px-3 text-[13px] bg-white";
  const borde = { border: "1px solid #C9D0CC" };
  const cuotas = form?.fechaInicio && form?.fechaFin && form.fechaFin >= form.fechaInicio ? mesesAmortizacion(Date.parse(`${form.fechaInicio}T00:00:00Z`), Date.parse(`${form.fechaFin}T00:00:00Z`)).n : null;
  // repartida por cantidades: total = Σ cantidades × valor unitario
  const cantidadF = form ? Object.values(form.reparto).reduce((t, v) => t + (leerNumero(v) ?? 0), 0) : 0;
  const montoF = !form ? 0 : form.alcance === "reparto" ? Math.round(cantidadF * (leerNumero(form.unitario) ?? 0) * 100) / 100 : leerNumero(form.monto) ?? 0;

  // vista mensual: un renglón por grupo (se abre en sus partidas) y el total
  const filasMes: DefFila[] = [
    ...grupos.flatMap((x) => [
      { id: `g${x.cta}`, label: `${abiertos.has(x.cta) ? "▾" : "▸"} ${x.nombre}`, valores: x.mes, total: suma(x.mes), fuerte: abiertos.has(x.cta), onClick: () => alternar(x.cta) } as DefFila,
      ...(abiertos.has(x.cta) ? x.ps.map((p) => ({ id: `p${p.id}`, label: `${p.descripcion}${consolidado && p.alcance !== "cooperativa" ? ` · ${(p.agencias ?? 1) > 1 ? `${p.agencias} agencias` : p.agencia ?? ""}` : ""}`, valores: p.gastoPorMes, total: suma(p.gastoPorMes), tenue: true, sangria: true } as DefFila)) : []),
    ]),
    { id: "tot", label: `Total ${grupo === "1906" ? "consumo" : "gasto"}`, valores: MESES.map((_, i) => grupos.reduce((t, x) => t + x.mes[i], 0)), total: grupos.reduce((t, x) => t + x.gasto, 0), clave: true },
  ];

  const verPctDisponible = pcts.length > 0 && (consolidado || partidas.some((p) => p.alcance === "cooperativa"));
  const itemMenu = "w-full text-left px-3 py-2 rounded-md text-[13px] hover:bg-[#F3F5F4]";
  // Diseño nuevo: una línea por partida; fechas y agencia en columnas de ancho justo
  const TDn = "px-2 whitespace-nowrap";
  // columna Pago solo si alguna se paga en cuotas (pólizas)
  const conPago = partidas.some((p) => pagoDe(p).enCuotas);
  /** Valores de cada agencia de una partida del consolidado: las del reporte (una fila por agencia) o las repartidas por cantidad. */
  const porAgencia = (p: Partida): { agencia: string; cantidad: number | null; monto: number; pend: number; gasto: number }[] => {
    if (p.alcance === "reparto" && p.reparto) {
      const tq = Object.values(p.reparto).reduce((t, v) => t + v, 0) || 1, g = suma(p.gastoPorMes);
      return Object.entries(p.reparto).sort(([a], [b]) => a.localeCompare(b)).map(([ag, q]) => ({ agencia: ag, cantidad: q, monto: (p.monto * q) / tq, pend: (p.pendienteCorte * q) / tq, gasto: (g * q) / tq }));
    }
    return [...(p.miembros ?? [])].sort((a, b) => (a.agencia ?? "").localeCompare(b.agencia ?? "")).map((m) => ({ agencia: m.agencia ?? "", cantidad: null, monto: m.monto, pend: m.pendienteCorte, gasto: suma(m.gastoPorMes) }));
  };
  const thn = "px-2 font-semibold whitespace-nowrap";
  const tablaNueva = (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse table-fixed min-w-[940px] text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <colgroup>
          <col /><col style={{ width: 84 }} /><col style={{ width: 84 }} /><col style={{ width: 136 }} />{conPago && <col style={{ width: 132 }} />}
          <col style={{ width: 108 }} /><col style={{ width: 128 }} /><col style={{ width: 108 }} /><col style={{ width: 156 }} /><col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr style={{ color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
            <th className={`${thn} pl-4 text-left`}>{grupo === "1905" ? "Subcuenta / partida" : grupo === "1904" ? "Póliza" : "Compra"}</th>
            <th className={`${thn} text-left`}>Inicio</th>
            <th className={`${thn} text-left`}>Fin</th>
            <th className={`${thn} text-left`}>Agencia</th>
            {conPago && <th className={`${thn} text-left`}>Pago</th>}
            <th className={`${thn} text-right`}>Valor</th>
            <th className={`${thn} text-right`}>Pendiente {etiquetaCorte(d.corte)}</th>
            <th className={`${thn} text-right`}>{grupo === "1906" ? "Consumo" : "Gasto"} {d.ejercicio}</th>
            <th className={`${thn} pl-7 text-left`}>Al vencer</th>
            <th className="pr-2 text-right">
              {grupos.length > 0 && (
                <button type="button" onClick={() => setAbiertos(todos ? new Set() : new Set(grupos.map((x) => x.cta)))} aria-label={todos ? "Contraer todo" : "Expandir todo"} title={todos ? "Contraer todo" : "Expandir todo"}
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center hover:bg-[#F3F5F4]" style={{ color: C.texto2 }}>
                  {todos ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((x) => {
            const ab = abiertos.has(x.cta);
            const rg = resumenGrupo(x.ps, d.fechaCorte, d.ejercicio);
            return (
              <Fragment key={x.cta}>
                <tr onClick={() => alternar(x.cta)} className="cursor-pointer hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32, fontWeight: ab ? 600 : 400 }}>
                  <td className="pl-3 pr-2 overflow-hidden">
                    <span className="flex items-center gap-1.5 min-w-0" style={{ color: C.texto }}>
                      {ab ? <ChevronDown size={13} color={C.acento} className="shrink-0" /> : <ChevronRight size={13} color={C.acento} className="shrink-0" />}
                      <span className="truncate" title={x.nombre}>{x.nombre}</span>
                    </span>
                  </td>
                  <td colSpan={conPago ? 4 : 3} />
                  <td className={`${TDn} text-right`}>{numero(x.monto)}</td>
                  <td className={`${TDn} text-right`}>{numero(x.pend)}</td>
                  <td className={`${TDn} text-right`}>{numero(x.gasto)}</td>
                  <td className={`${TDn} pl-7 font-normal`}><Punto tipo={rg.tipo} texto={rg.texto} /></td>
                  <td />
                </tr>
                {ab && x.ps.map((p) => {
                  const varias = (p.agencias ?? 1) > 1;
                  const verAg = (varias || (p.alcance === "reparto" && consolidado)) && conAgencias.has(p.id);
                  const est = estado(p, d.fechaCorte, d.ejercicio);
                  const extra = [`${p.meses} ${p.meses === 1 ? "mes" : "meses"}`, pagoDe(p).enCuotas ? textoPago(p) : null, p.proveedor || null].filter(Boolean).join(" · ");
                  return (
                    <Fragment key={p.id}>
                      <tr className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32, color: C.texto3 }}>
                        <td className="pl-8 pr-2 overflow-hidden">
                          <span className="block truncate" title={`${p.detalle || p.descripcion}${extra ? `\n${extra}` : ""}`}>{p.descripcion}</span>
                        </td>
                        <td className={TDn}>{fechaCorta(p.fechaInicio)}</td>
                        <td className={TDn}>{fechaCorta(p.fechaFin)}</td>
                        <td className={`${TDn} overflow-hidden text-ellipsis`}>
                          {p.alcance === "reparto" && consolidado ? (
                            <button type="button" aria-expanded={verAg} onClick={() => setConAgencias((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                              className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: C.acento }}>
                              {Object.keys(p.reparto ?? {}).length} agencias {verAg ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          ) : p.alcance === "reparto" ? (
                            <span title={`${p.reparto?.[agencia] ?? 0} de ${Object.values(p.reparto ?? {}).reduce((t, v) => t + v, 0)} unidades`}>{agencia} · {p.reparto?.[agencia] ?? 0} de {Object.values(p.reparto ?? {}).reduce((t, v) => t + v, 0)}</span>
                          ) : varias ? (
                            <button type="button" aria-expanded={verAg} onClick={() => setConAgencias((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                              className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: C.acento }}>
                              {p.agencias} agencias {verAg ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          ) : p.alcance === "cooperativa" ? <span title={consolidado ? undefined : `Su parte: ${pc1(p.parte)}`}>Cooperativa{consolidado ? "" : ` · ${pc1(p.parte)}`}</span>
                            : (p.agencia ?? agencia)}
                        </td>
                        {conPago && <td className={`${TDn} overflow-hidden text-ellipsis`} title={textoPago(p)}>{textoPago(p)}</td>}
                        <td className={`${TDn} text-right`} title={p.alcance !== "agencia" && !consolidado ? `Total de la cooperativa ${numero(p.monto)}` : undefined}>{numero(p.alcance !== "agencia" && !consolidado ? p.monto * p.parte : p.monto)}</td>
                        <td className={`${TDn} text-right`}>{numero(p.pendienteCorte)}</td>
                        <td className={`${TDn} text-right`}>{suma(p.gastoPorMes) === 0 ? "—" : numero(suma(p.gastoPorMes))}</td>
                        <td className={`${TDn} pl-7`} title={p.renueva && p.incremento ? `Incremento al renovar: ${Math.round(p.incremento * 1000) / 10} %`.replace(".", ",") : undefined}><Punto tipo={est.tipo} texto={est.texto} /></td>
                        <td className="pr-2 text-right whitespace-nowrap">
                          {editable(p) && <span className="opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button type="button" onClick={() => abrir(p)} aria-label={`Editar ${p.descripcion}`} className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#E3EEE7]"><Pencil size={14} color={C.texto2} /></button>
                            <button type="button" onClick={() => setBorrar(p)} aria-label={`Eliminar ${p.descripcion}`} className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#FBE4E1]"><Trash2 size={14} color={C.alerta} /></button>
                          </span>}
                        </td>
                      </tr>
                      {verAg && porAgencia(p).map((m) => (
                        <tr key={`${p.id}-${m.agencia}`} style={{ color: C.texto2, height: 28, background: "#FAFBFA" }}>
                          <td /><td colSpan={2} />
                          <td className={TDn}>{m.agencia}{m.cantidad != null && <span style={{ color: C.tenue }}> · {m.cantidad}</span>}</td>
                          {conPago && <td />}
                          <td className={`${TDn} text-right`}>{numero(m.monto)}</td>
                          <td className={`${TDn} text-right`}>{numero(m.pend)}</td>
                          <td className={`${TDn} text-right`}>{m.gasto === 0 ? "—" : numero(m.gasto)}</td>
                          <td colSpan={2} />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
          {Math.abs(sinPartida) >= 1 && (
            <tr style={{ borderTop: `1px solid ${C.beige}`, height: 32, color: C.texto2 }}
                title="Saldo de la 1905 en el balance que no tiene una partida que lo explique: se mantiene en el año sin amortizarse.">
              <td className="pl-8 pr-2">Saldo del balance sin partida</td><td colSpan={conPago ? 5 : 4} />
              <td className={`${TDn} text-right`}>{numero(sinPartida)}</td><td className={`${TDn} text-right`}>—</td><td colSpan={2} />
            </tr>
          )}
          <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
            <td className="pl-4">Total</td><td colSpan={conPago ? 4 : 3} />
            <td className={`${TDn} text-right`}>{numero(grupos.reduce((t, x) => t + x.monto, 0))}</td>
            <td className={`${TDn} text-right`}>{numero(grupos.reduce((t, x) => t + x.pend, 0) + sinPartida)}</td>
            <td className={`${TDn} text-right`}>{numero(grupos.reduce((t, x) => t + x.gasto, 0))}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
  // Diseño nuevo: pestañas Resumen · Amortización mensual · Partidas; «＋ Agregar» y «⋯» solo en Partidas
  const pestanas = [...vistas.map((v) => [v.id, v.label] as const),
    ...(grupo === "1906" ? [] : [["mensual", grupo === "1904" ? "Gasto mensual" : "Amortización mensual"] as const]),
    ["partidas", grupo === "1906" ? "Compras adicionales" : tx.lista] as const];
  const cabeceraNueva = (
    <>
      {menu && <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />}
      <div className="flex items-end gap-2 px-4 min-h-[52px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div role="tablist" aria-label={titulo} className="flex gap-6 flex-1">
          {pestanas.map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)} className="pb-3 pt-4 -mb-px text-[13px]"
              style={{ color: pestana === id ? C.texto : C.texto2, fontWeight: pestana === id ? 600 : 400, borderBottom: `2px solid ${pestana === id ? C.acento : "transparent"}` }}>{l}</button>
          ))}
        </div>
        {pestana === "mensual" && grupos.length > 0 && (
          <button type="button" onClick={() => setAbiertos(todos ? new Set() : new Set(grupos.map((x) => x.cta)))} aria-label={todos ? "Contraer todo" : "Expandir todo"} title={todos ? "Contraer todo" : "Expandir todo"}
            className="self-center w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-[#F3F5F4]" style={{ color: C.texto2 }}>
            {todos ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
          </button>
        )}
        {pestana === "partidas" && (
          <div className="flex items-center gap-2 self-center">
            {verPctDisponible && (
              <div className="relative">
                <button type="button" aria-label="Más opciones" aria-expanded={menu === "mas"} onClick={() => setMenu(menu === "mas" ? null : "mas")}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-white hover:bg-[#F3F5F4]" style={{ border: "1px solid #E1E5E3", color: C.texto2 }}><MoreHorizontal size={16} /></button>
                {menu === "mas" && (
                  <div className="absolute right-0 top-10 z-30 w-[240px] p-1.5 bg-white rounded-lg shadow-lg" style={{ border: "1px solid #E1E5E3" }}>
                    <button type="button" className={itemMenu} onClick={() => { setVerPct((x) => !x); setMenu(null); }}>{verPct ? "Ocultar" : "Ver"} % de activo por agencia</button>
                  </div>
                )}
              </div>
            )}
            <button type="button" onClick={() => abrir()}
              className="h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}><Plus size={14} /> Agregar</button>
          </div>
        )}
      </div>
    </>
  );

  // Formulario en ventana (diseño nuevo), por secciones
  const etq = (t: string, campoJsx: ReactNode, span = 1) => (
    <label className={`flex flex-col gap-1 text-[12px] ${span === 2 ? "col-span-2" : span === 4 ? "col-span-full" : ""}`} style={{ color: C.texto2 }}>{t}{campoJsx}</label>
  );
  const fm = form;
  const formModal = fm && (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 md:pt-[6vh] overflow-y-auto" style={{ background: "rgba(17,20,24,0.32)" }}>
      <div role="dialog" aria-modal="true" aria-label={`${fm.id ? "Editar" : "Registrar"} ${singular}`} className="w-full max-w-[780px] bg-white rounded-xl shadow-xl flex flex-col">
        <div className="flex items-center px-6 pt-5 pb-3">
          <b className="text-[15px] flex-1">{fm.id ? "Editar" : "Registrar"} {singular}</b>
          <button type="button" onClick={() => setForm(null)} aria-label="Cerrar" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#F3F5F4]"><X size={16} color={C.texto2} /></button>
        </div>
        <div className="flex flex-col gap-5 px-6 pb-5">
          <Seccion t={singular.charAt(0).toUpperCase() + singular.slice(1)}>
            {etq("Descripción", <input value={fm.descripcion} onChange={(e) => setForm({ ...fm, descripcion: e.target.value })} className={campo} style={borde} placeholder={tx.ejemplo} />, 2)}
            {etq(grupo === "1904" ? "Aseguradora o proveedor" : "Proveedor", <input value={fm.proveedor} onChange={(e) => setForm({ ...fm, proveedor: e.target.value })} className={campo} style={borde} />, 2)}
            {grupo !== "1906" && etq("Detalle", <input value={fm.detalle} onChange={(e) => setForm({ ...fm, detalle: e.target.value })} className={campo} style={borde} placeholder="Descripción completa de contabilidad (opcional)" />, 4)}
          </Seccion>
          {grupo === "1906" && (
            <Seccion t="Mes y consumo">
              {etq("Mes de la compra", <select value={fm.mesCompra} onChange={(e) => setForm({ ...fm, mesCompra: Number(e.target.value) })} className={campo} style={borde}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m} {d.ejercicio}</option>)}</select>, 2)}
              {etq("Se consume", <select value={fm.mesesConsumo} onChange={(e) => setForm({ ...fm, mesesConsumo: Number(e.target.value) })} className={campo} style={borde}>
                <option value={1}>En el mismo mes</option>
                {Array.from({ length: 11 }, (_, k) => k + 2).map((n) => <option key={n} value={n}>En {n} meses</option>)}</select>, 2)}
            </Seccion>
          )}
          {grupo !== "1906" && <>
          <Seccion t="Cuentas">
            {etq("Cuenta del activo", <select value={fm.cuentaActivo} onChange={(e) => setForm({ ...fm, cuentaActivo: e.target.value })} className={campo} style={borde}>
              <option value="">{grupo}</option>
              {cuentasActivo.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              {fm.cuentaActivo && !cuentasActivo.some((c) => c.codigo === fm.cuentaActivo) && <option value={fm.cuentaActivo}>{fm.cuentaActivo} · {NOMBRE_CUENTA_1905[fm.cuentaActivo] ?? ""}</option>}
            </select>, 2)}
            {etq("Cuenta del gasto", <select value={fm.cuentaGasto} onChange={(e) => setForm({ ...fm, cuentaGasto: e.target.value })} className={campo} style={borde}>
              <option value="">Seleccionar...</option>
              {cuentasGasto.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
              {fm.cuentaGasto && !cuentasGasto.some((c) => c.codigo === fm.cuentaGasto) && <option value={fm.cuentaGasto}>{fm.cuentaGasto}</option>}
            </select>, 2)}
          </Seccion>
          <Seccion t="Vigencia">
            {etq("Fecha de inicio", <input type="date" value={fm.fechaInicio} onChange={(e) => setForm({ ...fm, fechaInicio: e.target.value })} className={campo} style={borde} />)}
            {etq("Fecha de fin", <input type="date" value={fm.fechaFin} onChange={(e) => setForm({ ...fm, fechaFin: e.target.value })} className={campo} style={borde} />)}
            {etq("Al vencer", <select value={fm.renueva ? "si" : "no"} onChange={(e) => setForm({ ...fm, renueva: e.target.value === "si" })} className={campo} style={borde}>
              <option value="si">Se renueva</option><option value="no">No se renueva</option></select>)}
            {fm.renueva ? etq("Incremento al renovar (%)", <input value={fm.incremento} onChange={(e) => setForm({ ...fm, incremento: e.target.value })} inputMode="decimal" className={`${campo} text-right`} style={borde} />) : <span />}
          </Seccion>
          </>}
          <Seccion t="Valor y distribución">
            {etq("Distribución", <select value={fm.alcance} onChange={(e) => setForm({ ...fm, alcance: e.target.value as Form["alcance"] })} className={campo} style={borde}>
              {!consolidado && <option value="agencia">Solo {agencia}</option>}
              <option value="reparto">Varias agencias, por cantidad</option>
              <option value="cooperativa">Toda la cooperativa, por % de activo</option>
            </select>, 2)}
            {fm.alcance === "reparto"
              ? etq("Valor unitario (USD)", <input value={fm.unitario} onChange={(e) => setForm({ ...fm, unitario: e.target.value })} inputMode="decimal" className={`${campo} text-right`} style={borde} placeholder="100" />)
              : etq("Valor (USD)", <input value={fm.monto} onChange={(e) => setForm({ ...fm, monto: e.target.value })} inputMode="decimal" className={`${campo} text-right`} style={borde} placeholder="12000" />)}
            {fm.alcance === "cooperativa"
              ? etq("% de activo", <select value={fm.pctBase} onChange={(e) => setForm({ ...fm, pctBase: e.target.value as Form["pctBase"] })} className={campo} style={borde}>
                  <option value="corte">Último corte ({pcts[0] ? etiquetaCorte(pcts[0].corte) : "balance"})</option>
                  <option value="anterior">Anterior (dic-25)</option></select>)
              : fm.alcance === "reparto" ? <div className="flex flex-col justify-end pb-2 text-[12px]" style={{ color: C.texto2 }}>Total <b className="text-[13px]" style={{ color: C.texto }}>{usd(montoF)}</b></div> : <span />}
            {fm.alcance === "reparto" && (
              <div className="col-span-full grid grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-2 rounded-lg p-3" style={{ background: C.crema }}>
                {AGENCIAS.map((ag) => (
                  <label key={ag} className="flex flex-col gap-1 text-[11px]" style={{ color: C.texto2 }}>{ag}
                    <input value={fm.reparto[ag] ?? ""} onChange={(e) => setForm({ ...fm, reparto: { ...fm.reparto, [ag]: e.target.value } })} inputMode="numeric"
                      className="h-8 w-full rounded-md px-2 text-right text-[12px] bg-white" style={borde} placeholder="0" />
                  </label>
                ))}
                <div className="col-span-full flex flex-wrap items-center gap-3 text-[11.5px] pt-1" style={{ color: C.texto2 }}>
                  <span>{cantidadF} unidades × {usd(leerNumero(fm.unitario) ?? 0)} = <b style={{ color: C.texto }}>{usd(montoF)}</b></span>
                  <button type="button" className="hover:underline" style={{ color: C.acento }}
                    onClick={() => { const v = Object.values(fm.reparto).find((x) => (leerNumero(x) ?? 0) > 0) ?? "1"; setForm({ ...fm, reparto: Object.fromEntries(AGENCIAS.map((a) => [a, v])) }); }}>Igual para todas</button>
                </div>
              </div>
            )}
          </Seccion>
          {grupo !== "1906" && <Seccion t="Pago">
            {etq("Forma de pago", <select value={fm.enCuotas ? "cuotas" : "contado"} onChange={(e) => setForm({ ...fm, enCuotas: e.target.value === "cuotas", mesesPago: e.target.value === "cuotas" && !fm.mesesPago.length ? mesInicio(fm.fechaInicio) : fm.mesesPago })} className={campo} style={borde}>
              <option value="contado">De contado</option><option value="cuotas">En cuotas (elegir los meses)</option></select>, 2)}
            {fm.enCuotas && (
              <div className="col-span-full flex flex-wrap gap-1">
                {MESES.map((m, i) => {
                  const on = fm.mesesPago.includes(i + 1);
                  return <button key={m} type="button" aria-pressed={on} onClick={() => setForm({ ...fm, mesesPago: on ? fm.mesesPago.filter((x) => x !== i + 1) : [...fm.mesesPago, i + 1].sort((a, b) => a - b) })}
                    className="h-8 w-[52px] rounded-md text-[12px]" style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600, border: `1px solid ${BORDE_EDICION}` } : { background: "#fff", color: C.texto2, border: "1px solid #C9D0CC" }}>{m}</button>;
                })}
              </div>
            )}
          </Seccion>}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 rounded-b-xl" style={{ borderTop: `1px solid ${C.beige}`, background: "#FAFBFA" }}>
          <span className="text-[12px] flex-1" style={{ color: msg?.e ? C.alerta : C.texto2 }}>
            {msg?.e ? msg.t : grupo === "1906" ? (montoF > 0 ? `${usd(montoF)} en ${MESES[fm.mesCompra - 1].toLowerCase()} · consumo ${fm.mesesConsumo === 1 ? "el mismo mes" : `de ${usd(montoF / fm.mesesConsumo)} al mes durante ${fm.mesesConsumo} meses`} (450705)` : "") : cuotas && montoF > 0 ? `Gasto: ${cuotas} cuotas de ${usd(montoF / cuotas)}${fm.enCuotas && fm.mesesPago.length ? ` · Pago en ${fm.mesesPago.length} ${fm.mesesPago.length === 1 ? "cuota" : "cuotas"}` : " · Pago de contado"}` : ""}
          </span>
          <button type="button" onClick={() => setForm(null)} className="h-9 px-4 rounded-md bg-white text-[12px] font-semibold" style={{ ...borde, color: C.texto }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="h-9 px-4 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>{guardando ? "Guardando..." : "Guardar"}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      {cabeceraNueva}
      {formModal}

      <div className="flex flex-col gap-3 empty:hidden px-4 pt-3 last:pb-3">
        {msg && <p className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</p>}
        {verPct && (
          <table className="text-[12px] border-collapse self-start" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead><tr style={{ color: C.texto2 }}><th className="text-left font-semibold py-1 pr-6">Agencia</th><th className="text-right font-semibold px-3">Activo (sin 1908)</th><th className="text-right font-semibold px-3">{pcts[0] ? etiquetaCorte(pcts[0].corte) : "Corte"}</th><th className="text-right font-semibold px-3">dic-25</th></tr></thead>
            <tbody>{pcts.map((x) => (
              <tr key={x.agencia} style={{ borderTop: `1px solid ${C.beige}`, color: C.texto }}>
                <td className="py-1 pr-6">{x.agencia}</td><td className="px-3 text-right">{usd(x.base)}</td><td className="px-3 text-right">{pc1(x.pct)}</td>
                <td className="px-3 text-right" style={{ color: C.texto2 }}>{x.pctAnterior != null ? pc1(x.pctAnterior) : "—"}</td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>

      {vistaPropia ? vistaPropia.contenido : partidas.length === 0 ? (
        <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>Sin {tx.lista.toLowerCase()} registradas.</p>
      ) : pestana === "mensual" ? (
        <TablaMeses key="pm" titulo={tx.lista} ultima="Año" filas={filasMes} />
      ) : tablaNueva}
      {borrar && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <p className="text-[14px] font-semibold mb-2">¿Eliminar «{borrar.descripcion}» por {usd(borrar.monto)}?</p>
            <p className="text-[12px] mb-4" style={{ color: C.texto2 }}>{borrar.alcance === "cooperativa" ? "Es de toda la cooperativa: deja de sumar en todas las agencias." : `Deja de sumar a la cuenta ${grupo} de ${agencia}.`}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBorrar(null)} className="h-9 px-4 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC" }}>Cancelar</button>
              <button type="button" onClick={() => eliminar(borrar)} className="h-9 px-4 rounded-md text-white text-[12px] font-semibold" style={{ background: C.alerta }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Vista previa del reporte de amortización antes de cargarlo: lo que se leyó, por subcuenta, y lo que no se reconoció. */
export function VistaArchivo({ archivo, corte, nombre, subiendo, onCancelar, onCargar }: {
  archivo: { nombre: string; lectura: LecturaArchivo }; corte: string; nombre: (c: string) => string; subiendo: boolean; onCancelar: () => void; onCargar: () => void;
}) {
  const { filas, omitidas, sinAgencia, sinCuenta, faltan, columnas = [], ignoradas = 0 } = archivo.lectura;
  const ctas = [...new Set(filas.map((f) => f.cuentaActivo))].sort();
  const fila = (cta: string) => {
    const fs = filas.filter((f) => f.cuentaActivo === cta);
    return { cta, n: fs.length, monto: fs.reduce((t, f) => t + f.monto, 0), libros: fs.reduce((t, f) => t + (f.libros ?? f.pendienteCalc), 0), calc: fs.reduce((t, f) => t + f.pendienteCalc, 0), renuevan: fs.filter((f) => f.renueva).length };
  };
  const rs = ctas.map(fila);
  const tot = { n: filas.length, monto: suma(rs.map((r) => r.monto)), libros: suma(rs.map((r) => r.libros)), calc: suma(rs.map((r) => r.calc)), renuevan: suma(rs.map((r) => r.renuevan)) };
  const agencias = new Set(filas.map((f) => f.agencia)).size;
  const avisos = [
    faltan.length ? `No se encontraron las columnas: ${faltan.join(", ")}.` : "",
    sinAgencia.length ? `Oficinas que no se reconocen (no se cargan): ${sinAgencia.join(", ")}.` : "",
    sinCuenta.length ? `Divisiones sin cuenta (no se cargan): ${sinCuenta.join(", ")}.` : "",
    Math.abs(tot.libros - tot.calc) >= 1 ? `El saldo que calcula la herramienta (${usd(tot.calc)}) difiere del archivo en ${usd(tot.calc - tot.libros)}.` : "",
  ].filter(Boolean);
  const TD = "px-3 text-right";
  return (
    <div className="rounded-md flex flex-col" style={{ border: `1px solid ${BORDE_EDICION}`, boxShadow: `0 0 0 2px ${C.acentoSuave}` }}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <b className="text-[13px]">{archivo.nombre}</b>
        <span className="text-[12px]" style={{ color: C.texto2 }}>{filas.length} partidas · {agencias} {agencias === 1 ? "agencia" : "agencias"}{omitidas ? ` · ${omitidas} ya amortizadas se omiten` : ""}</span>
        <span className="flex-1" />
        <button type="button" onClick={onCancelar} className="h-8 px-3 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
        <button type="button" onClick={onCargar} disabled={subiendo || !filas.length} className="h-8 px-3 rounded-md text-white text-[12px] font-semibold disabled:opacity-50" style={{ background: C.acento }}>{subiendo ? "Cargando..." : "Cargar partidas"}</button>
      </div>
      {filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse min-w-[720px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead><tr style={{ color: C.cabeceraTexto, height: 32 }}>
              <th className="pl-4 pr-3 text-left font-semibold">Subcuenta</th><th className={`${TD} font-semibold`}>Partidas</th>
              <th className={`${TD} font-semibold`}>Valor a amortizar</th><th className={`${TD} font-semibold`}>Saldo {corte}</th><th className={`${TD} pr-4 font-semibold`}>Se renuevan</th>
            </tr></thead>
            <tbody>
              {rs.map((r) => (
                <tr key={r.cta} style={{ borderTop: `1px solid ${C.beige}`, height: 30, color: C.texto3 }}>
                  <td className="pl-4 pr-3">{nombre(r.cta)}</td><td className={TD}>{r.n}</td><td className={TD}>{numero(r.monto)}</td>
                  <td className={TD}>{numero(r.libros)}</td><td className={`${TD} pr-4`} style={{ color: C.texto2 }}>{r.renuevan || "—"}</td>
                </tr>
              ))}
              <tr className="font-bold" style={{ borderTop: "1px solid #B9C3BD", height: 32 }}>
                <td className="pl-4">Total</td><td className={TD}>{tot.n}</td><td className={TD}>{numero(tot.monto)}</td><td className={TD}>{numero(tot.libros)}</td><td className={`${TD} pr-4`}>{tot.renuevan}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 py-2.5 flex flex-col gap-1 text-[12px]" style={{ borderTop: `1px solid ${C.beige}`, color: C.texto2 }}>
        {avisos.map((t) => <span key={t} style={{ color: C.alerta }}>{t}</span>)}
        {columnas.length > 0 && <span title={columnas.join(" · ")}>Se leen {columnas.length} columnas{ignoradas ? ` y se ignoran ${ignoradas}` : ""}: {columnas.join(", ")}.</span>}
        <span>Reemplaza las partidas cargadas antes de estas agencias; las registradas a mano se mantienen.</span>
      </div>
    </div>
  );
}

/** "SEGURO DE FIDELIDAD" → "Seguro de fidelidad" (nombres del catálogo en mayúsculas). */
function limpiar(s: string) {
  if (!s || s !== s.toUpperCase()) return s;
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
