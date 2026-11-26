"use client";

import { PoliticaCaptaciones } from "../../components/PoliticaCaptaciones";
import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { apiFetch, useDatos } from "../../lib/useDatos";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Actualizando, EsqueletoTabla } from "../../components/Carga";
import {
  MESES, AGENCIAS, C, FONDO, suma, usd, pct, etiquetaCorte, leerNumero,
  Indicador, Tarjeta, TablaMeses, Parametros,
  type DefFila, type DefParametro,
} from "../../components/ActivosComun";
import { GraficaLinea, GraficaEntradasSalidas, GraficaApilada, Leyenda, SERIE } from "../../components/Graficas";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

/** Agencias del selector: las 10 más el Consolidado (suma, solo lectura). */
const AGENCIAS_PAGINA = [...AGENCIAS, "Consolidado"];

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * OBLIGACIONES CON EL PÚBLICO (grupo 21): ahorro a la vista, ahorro crecer y depósitos a plazo fijo.
 * Estilo institucional (mismo de Cartera, Activos y Balance). Los cálculos no cambian:
 * parámetros en /api/parametros-captaciones y proyección en /api/captaciones.
 */

type Producto = "VISTA" | "CRECER" | "DPF";
type Pestana = "resumen" | Producto | "politica";
type Clave = "vista" | "crecer" | "dpf";

const PRODUCTOS: { id: Producto; label: string; cuentas: string; clave: Clave }[] = [
  { id: "VISTA", label: "Ahorro a la vista", cuentas: "21013505 + 21013510 + 21013535", clave: "vista" },
  { id: "CRECER", label: "Ahorro crecer", cuentas: "21013515", clave: "crecer" },
  { id: "DPF", label: "Depósitos a plazo fijo", cuentas: "2103", clave: "dpf" },
];

type Campo = "tasa_interes_anual" | "pct_ingresos" | "pct_retiros" | "pct_cancelaciones" | "ratio_renovaciones" | "pct_liquidez";
interface DefCampo extends DefParametro { concepto: Campo; ratio?: boolean }
const CAMPOS: Record<Producto, DefCampo[]> = {
  VISTA: [
    { concepto: "tasa_interes_anual", label: "Tasa de interés anual", esPct: true },
    { concepto: "pct_ingresos", label: "% de depósitos del mes", esPct: true },
    { concepto: "pct_retiros", label: "% de retiros del mes", esPct: true },
    { concepto: "pct_liquidez", label: "% de liquidez requerida", esPct: true },
  ],
  CRECER: [
    { concepto: "tasa_interes_anual", label: "Tasa de interés anual", esPct: true },
    { concepto: "pct_ingresos", label: "% de depósitos del mes", esPct: true },
    { concepto: "pct_retiros", label: "% de retiros del mes", esPct: true },
    { concepto: "pct_liquidez", label: "% de liquidez requerida", esPct: true },
  ],
  DPF: [
    { concepto: "tasa_interes_anual", label: "Tasa de interés anual", esPct: true },
    { concepto: "pct_cancelaciones", label: "% que vence y se cancela", esPct: true },
    { concepto: "ratio_renovaciones", label: "% Renovaciones y nuevos contratos", esPct: true, ratio: true },
    { concepto: "pct_liquidez", label: "% de liquidez requerida", esPct: true },
  ],
};

// Colores por producto (validados para daltonismo): verde plazo fijo, azul a la vista, dorado crecer
const COLOR_PRODUCTO: Record<Clave, string> = { dpf: SERIE.verde, vista: SERIE.azul, crecer: SERIE.dorado };

interface Fila {
  producto: Producto; mes: number;
  tasa_interes_anual: number;
  pct_ingresos: number | null; pct_retiros: number | null;
  pct_cancelaciones: number | null; ratio_renovaciones: number | null;
  pct_liquidez: number; // % de liquidez requerida: saldo final × % (va a la Proyección de liquidez)
}
interface DetMes {
  mes: number; saldoInicial: number; saldoFinal: number;
  depositos: number; retiros: number; capitalizacionInteres: number; cancelaciones: number; renovaciones: number;
  tasas: { tasaInteresAnual: number; pctIngresosPeriodo: number; pctRetirosPeriodo: number; pctCancelaciones: number; ratioRenovaciones: number };
}
interface Datos {
  detalle: Record<Clave, DetMes[]>;
  corte?: { anio: number; mes: number };
  /** otras: cuentas de la 21 que no son vista, Crecer ni DPF (solidarias, por confirmar, restringidos…), fijas en el año */
  control?: { otras?: number | null };
  error?: string;
}

function filaVacia(producto: Producto, mes: number): Fila {
  return { producto, mes, tasa_interes_anual: 0, pct_ingresos: 0, pct_retiros: 0, pct_cancelaciones: 0, ratio_renovaciones: 0, pct_liquidez: 0 };
}
/** Siempre 36 filas (3 productos × 12 meses): lo guardado encima de las vacías. */
function completar(guardadas: Fila[]): Fila[] {
  return PRODUCTOS.flatMap((p) => Array.from({ length: 12 }, (_, i) => {
    const g = guardadas.find((f) => f.producto === p.id && Number(f.mes) === i + 1);
    return g ? { ...filaVacia(p.id, i + 1), ...g, mes: i + 1 } : filaVacia(p.id, i + 1);
  }));
}
const valorDe = (f: Fila, c: Campo) => Number(f[c] ?? 0) || 0;
/** Interés del plazo fijo: no capitaliza en el saldo, va al gasto (mismo cálculo que el orquestador). */
const interesDPF = (d: DetMes) => ((d.saldoInicial + d.saldoFinal) / 2) * (d.tasas.tasaInteresAnual / 12);

// =====================================================================
// PÁGINA
// =====================================================================

export default function ObligacionesPublicoPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [version, setVersion] = useState(0);
  const q = `agencia=${encodeURIComponent(agencia)}`;
  const consolidado = agencia === "Consolidado";
  const urlCal = `/api/captaciones?${q}`;
  // En Consolidado no hay parámetros (se ven y editan por agencia): no se consulta esa ruta
  const par = useDatos<{ filas?: Fila[] }>(consolidado ? null : `/api/parametros-captaciones?${q}`, version);
  const cal = useDatos<Datos>(urlCal, version, (d) => (d.detalle ? null : "No se pudo calcular."));
  const filas = useMemo(() => completar(par.datos?.filas ?? []), [par.datos]);
  const datos = cal.datos;
  const cargando = par.cargando || cal.cargando;
  const actualizando = par.actualizando || cal.actualizando;
  const error = par.error ?? cal.error;

  // Edición de parámetros (una pestaña a la vez)
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Fila[]>([]);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);

  const producto = pestana === "resumen" || pestana === "politica" ? null : pestana;
  const cambios = producto ? borrador.reduce((n, b) => {
    const o = filas.find((f) => f.producto === b.producto && f.mes === b.mes)!;
    return n + CAMPOS[producto].filter((c) => Math.abs(valorDe(b, c.concepto) - valorDe(o, c.concepto)) > 1e-9).length;
  }, 0) : 0;

  function salirDeEdicion(): boolean {
    if (editando && cambios > 0 && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardar?")) return false;
    setEditando(false); setBorrador([]); setTextos({});
    return true;
  }
  function irA(t: Pestana) { if (t !== pestana && salirDeEdicion()) { setPestana(t); setMsg(null); } }
  function cambiarAgencia(a: string) { if (salirDeEdicion()) { setAgencia(a); setMsg(null); } }

  function empezarEdicion() {
    if (!producto || actualizando || consolidado) return;
    setBorrador(filas.filter((f) => f.producto === producto).map((f) => ({ ...f })));
    setTextos({}); setEditando(true); setMsg(null);
  }
  // i = 0..11 (índice del mes)
  function escribir(campo: DefCampo, i: number, texto: string) {
    setTextos((t) => ({ ...t, [`${campo.concepto}-${i}`]: texto }));
    const v = leerNumero(texto);
    if (v === null) return;
    setBorrador((b) => b.map((f) => (f.mes === i + 1 ? { ...f, [campo.concepto]: v / 100 } : f)));
  }
  function copiarEnero(campo: DefCampo) {
    setBorrador((b) => { const ene = valorDe(b.find((f) => f.mes === 1)!, campo.concepto); return b.map((f) => ({ ...f, [campo.concepto]: ene })); });
    setTextos((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith(`${campo.concepto}-`))));
  }
  async function guardar() {
    if (!producto || consolidado) return;
    // Validación antes de mandar a la base de datos
    for (const c of CAMPOS[producto]) {
      const malos = borrador.filter((f) => { const v = valorDe(f, c.concepto); return c.ratio ? v < 0 || v > 5 : v < 0 || v > 1; });
      if (malos.length) { setMsg({ t: `${c.label}: revisa ${malos.map((f) => MESES[f.mes - 1]).join(", ")} (${c.ratio ? "entre 0 % y 500 %" : "entre 0 % y 100 %"}).`, e: true }); return; }
    }
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/parametros-captaciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, filas: borrador }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `error ${r.status}`);
      setEditando(false); setBorrador([]); setTextos({});
      setMsg({ t: "Parámetros guardados. Balance, Estado de resultados y Flujo ya usan los nuevos valores." });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally {
      setGuardando(false);
    }
  }

  const det = datos?.detalle ?? null;
  const corte = datos?.corte ? etiquetaCorte(datos.corte) : null;


  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50";
  const pestanas: { id: Pestana; label: string }[] = [{ id: "resumen", label: "Resumen" }, ...PRODUCTOS.map((p) => ({ id: p.id as Pestana, label: p.label })), { id: "politica", label: "Política" }];
  const prodActual = producto ? PRODUCTOS.find((p) => p.id === producto)! : null;

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      {/* Encabezado: título y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Obligaciones con el público<AnioEjercicio /></h1>
        <Actualizando visible={actualizando} />
        <button type="button" onClick={() => void exportarPantalla()} disabled={!det} title="Exportar a Excel" className={accion} style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Pestañas a la izquierda, agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Productos" className="flex gap-7 flex-1">
          {pestanas.map((t) => {
            const activa = pestana === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={activa} onClick={() => irA(t.id)}
                      className="pt-2 pb-2.5 -mb-px text-[13px]"
                      style={{ color: activa ? C.acento : C.texto2, fontWeight: activa ? 600 : 400, borderBottom: `2px solid ${activa ? C.acento : "transparent"}` }}>
                {t.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => cambiarAgencia(e.target.value)}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS_PAGINA.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={urlCal} agencia={agencia} />

      {pestana === "politica" ? (
        <PoliticaCaptaciones onAplicado={() => setVersion((v) => v + 1)} />
      ) : cargando ? (
        <EsqueletoTabla indicadores filas={8} />
      ) : error ? (
        <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      ) : !det ? null : !prodActual ? (
        <>
          <Indicadores det={det} otras={datos?.control?.otras ?? 0} />
          <Resumen det={det} filas={filas} corte={corte} onElegir={irA} consolidado={consolidado} otras={datos?.control?.otras ?? 0} />
        </>
      ) : (
        <VistaProducto
          producto={prodActual} det={det[prodActual.clave]} detTodos={det} consolidado={consolidado}
          filas={editando ? borrador : filas.filter((f) => f.producto === prodActual.id)} corte={corte}
          editando={editando} cambios={cambios} guardando={guardando} textos={textos} msg={msg}
          onEditar={empezarEdicion} onCancelar={() => { setEditando(false); setBorrador([]); setTextos({}); }} onGuardar={guardar}
          onEscribir={escribir} onSoltar={(k) => setTextos((t) => { const n = { ...t }; delete n[k]; return n; })} onCopiarEnero={copiarEnero}
        />
      )}
    </div>
  );
}

// =====================================================================
// INDICADORES (solo en Resumen)
// =====================================================================

function Indicadores({ det, otras = 0 }: { det: Datos["detalle"]; otras?: number }) {
  // igual al grupo 21 del Balance (incluye las otras cuentas de la 21, fijas con su saldo del corte)
  const ini = det.vista[0].saldoInicial + det.crecer[0].saldoInicial + det.dpf[0].saldoInicial + otras;
  const fin = det.vista[11].saldoFinal + det.crecer[11].saldoFinal + det.dpf[11].saldoFinal + otras;
  const crec = ini ? fin / ini - 1 : 0;
  const intereses = suma(det.vista.map((x) => x.capitalizacionInteres)) + suma(det.crecer.map((x) => x.capitalizacionInteres)) + suma(det.dpf.map(interesDPF));
  const promedio = suma(MESES.map((_, i) => (["vista", "crecer", "dpf"] as Clave[]).reduce((a, k) => {
    const d = det[k][i]; return a + (d.saldoInicial + d.saldoFinal) / 2;
  }, 0))) / 12;
  const part = (k: Clave) => (fin ? det[k][11].saldoFinal / fin : 0);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Indicador titulo={`Obligaciones dic-${ejercicioEnUso()}`} valor={usd(fin)}
        pie={`${crec >= 0 ? "Suben" : "Bajan"} ${usd(Math.abs(fin - ini))} en el año (${pct(Math.abs(crec), 1)})`} />
      <Indicador titulo="Intereses del año" valor={usd(intereses)} pie={`Costo promedio ${pct(promedio ? intereses / promedio : 0)} sobre el saldo`} />
      <Composicion partes={[
        { label: "Plazo fijo", valor: part("dpf"), monto: det.dpf[11].saldoFinal, color: COLOR_PRODUCTO.dpf },
        { label: "A la vista", valor: part("vista"), monto: det.vista[11].saldoFinal, color: COLOR_PRODUCTO.vista },
        { label: "Crecer", valor: part("crecer"), monto: det.crecer[11].saldoFinal, color: COLOR_PRODUCTO.crecer },
      ]} />
    </div>
  );
}

/** Composición dic-2027: barra delgada y una línea por producto (nombre · % · saldo). Mismo tamaño que las otras tarjetas. */
function Composicion({ partes }: { partes: { label: string; valor: number; monto: number; color: string }[] }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-2">
      <span className="text-[12px]" style={{ color: C.texto2 }}>Composición dic-{ejercicioEnUso()}</span>
      <div className="flex h-[7px] rounded-sm overflow-hidden gap-[2px] mt-0.5" style={{ background: C.beige }} role="img"
           aria-label={partes.map((p) => `${p.label} ${pct(p.valor, 0)}`).join(", ")}>
        {partes.map((p) => <div key={p.label} style={{ width: `${p.valor * 100}%`, background: p.color }} />)}
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">
        {partes.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="flex-1" style={{ color: C.texto2 }}>{p.label}</span>
            <b className="w-[40px] text-right" style={{ color: C.texto }}>{pct(p.valor, 0)}</b>
            <span className="w-[99px] text-right" style={{ color: C.texto2 }}>{usd(p.monto)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// RESUMEN (botones a la derecha: saldos e intereses, liquidez requerida, análisis)
// =====================================================================

type VistaRes = "saldos" | "liquidez" | "analisis";
const VISTAS_RES: { id: VistaRes; label: string }[] = [
  { id: "saldos", label: "Saldos e intereses" }, { id: "liquidez", label: "Liquidez requerida" }, { id: "analisis", label: "Análisis" },
];

function Resumen({ det, filas, corte, onElegir, consolidado, otras = 0 }: { det: Datos["detalle"]; filas: Fila[]; corte: string | null; onElegir: (p: Pestana) => void; consolidado: boolean; otras?: number }) {
  const [vista, setVista] = useState<VistaRes>("saldos");
  const sf = (k: Clave) => det[k].map((x) => x.saldoFinal);
  // total igual al grupo 21 del Balance: los tres productos + las otras cuentas de la 21 (fijas con su saldo del corte)
  const total = MESES.map((_, i) => det.vista[i].saldoFinal + det.crecer[i].saldoFinal + det.dpf[i].saldoFinal + otras);
  const ini = det.vista[0].saldoInicial + det.crecer[0].saldoInicial + det.dpf[0].saldoInicial + otras;
  const intV = det.vista.map((x) => x.capitalizacionInteres), intC = det.crecer.map((x) => x.capitalizacionInteres), intD = det.dpf.map(interesDPF);
  const intT = MESES.map((_, i) => intV[i] + intC[i] + intD[i]);
  const varAnio = (k: Clave) => det[k][11].saldoFinal - det[k][0].saldoInicial;
  const saldo = (p: (typeof PRODUCTOS)[number]): DefFila => ({
    id: `s-${p.clave}`, codigo: p.cuentas, totalConSigno: true, label: p.label, valores: sf(p.clave), total: varAnio(p.clave), onClick: () => onElegir(p.id),
    formula: (i) => `Saldo final de ${MESES[i]} (ver la pestaña ${p.label}): ${usd(det[p.clave][i].saldoFinal)}. Año = saldo dic − saldo inicial${corte ? ` a ${corte}` : ""} = ${usd(det[p.clave][11].saldoFinal)} − ${usd(det[p.clave][0].saldoInicial)} = ${usd(varAnio(p.clave))}.`,
  });
  const saldos: DefFila[] = [
    ...PRODUCTOS.map(saldo),
    ...(Math.abs(otras) >= 0.5 ? [{ id: "s-otras", label: "Otras cuentas de la 21 (solidarias, por confirmar, restringidos…)", valores: MESES.map(() => otras), total: 0, tenue: true,
      formula: () => `Cuentas de la 21 que no son ahorro a la vista, Crecer ni plazo fijo: se mantienen con su saldo del corte (${usd(otras)}). Su detalle por cuenta está en el Balance.` } as DefFila] : []),
    { id: "s-total", codigo: "21", totalConSigno: true, label: "Total obligaciones con el público", valores: total, total: total[11] - ini, clave: true,
      formula: (i) => `Ahorro a la vista + ahorro crecer + plazo fijo${Math.abs(otras) >= 0.5 ? " + otras cuentas de la 21" : ""} = ${usd(det.vista[i].saldoFinal)} + ${usd(det.crecer[i].saldoFinal)} + ${usd(det.dpf[i].saldoFinal)}${Math.abs(otras) >= 0.5 ? ` + ${usd(otras)}` : ""} = ${usd(total[i])}. Es el grupo 21 del Balance.` },
    { id: "i-vista", codigo: "41011505", label: "Ahorro a la vista", valores: intV, total: suma(intV),
      formula: (i) => `Capitalización del mes (ver la pestaña Ahorro a la vista): ${usd(intV[i])}.` },
    { id: "i-crecer", codigo: "41011535", label: "Ahorro crecer", valores: intC, total: suma(intC),
      formula: (i) => `Capitalización del mes (ver la pestaña Ahorro crecer): ${usd(intC[i])}.` },
    { id: "i-dpf", codigo: "410130", label: "Depósitos a plazo fijo", valores: intD, total: suma(intD),
      formula: (i) => `(Saldo inicial + saldo final) ÷ 2 × tasa anual ÷ 12 = (${usd(det.dpf[i].saldoInicial)} + ${usd(det.dpf[i].saldoFinal)}) ÷ 2 × ${pct(det.dpf[i].tasas.tasaInteresAnual)} ÷ 12 = ${usd(intD[i])}.` },
    { id: "i-total", codigo: "4101", label: "Total intereses", valores: intT, total: suma(intT), clave: true,
      formula: (i) => `Suma de los intereses de los tres productos = ${usd(intT[i])}. Llega al Estado de resultados como gasto de intereses (41).` },
  ];

  // Liquidez requerida por producto: saldo final × % parametrizado
  const pctDe = (p: Producto) => MESES.map((_, i) => valorDe(filas.find((f) => f.producto === p && f.mes === i + 1) ?? filaVacia(p, i + 1), "pct_liquidez"));
  const liqDe = (p: (typeof PRODUCTOS)[number]) => { const ps = pctDe(p.id); return sf(p.clave).map((v, i) => v * ps[i]); };
  const liqPorProd = Object.fromEntries(PRODUCTOS.map((p) => [p.clave, liqDe(p)])) as Record<Clave, number[]>;
  const liqTotal = MESES.map((_, i) => liqPorProd.vista[i] + liqPorProd.crecer[i] + liqPorProd.dpf[i]);
  const liquidez: DefFila[] = [
    ...PRODUCTOS.map((p) => ({
      id: `l-${p.clave}`, label: p.label, valores: liqPorProd[p.clave], total: liqPorProd[p.clave][11], onClick: () => onElegir(p.id),
      formula: (i: number) => `Saldo final × % de liquidez requerida = ${usd(det[p.clave][i].saldoFinal)} × ${pct(pctDe(p.id)[i])} = ${usd(liqPorProd[p.clave][i])}.`,
    } as DefFila)),
    { id: "l-total", label: "Liquidez requerida total", valores: liqTotal, total: liqTotal[11], clave: true,
      formula: (i) => `Suma de los tres productos = ${usd(liqTotal[i])}. Es la fila «Liquidez requerida» de la Proyección de liquidez (Fondos disponibles). No incluye el encaje del BCE.` },
    { id: "l-pct", label: "% sobre el total de captaciones", valores: liqTotal.map((v, i) => (total[i] ? v / total[i] : 0)), total: total[11] ? liqTotal[11] / total[11] : 0, esPct: true, tenue: true,
      formula: (i) => `Liquidez requerida total ÷ total de obligaciones = ${usd(liqTotal[i])} ÷ ${usd(total[i])} = ${pct(total[i] ? liqTotal[i] / total[i] : 0)}.` },
  ];

  return (
    <Tarjeta titulo="Obligaciones con el público" derecha={<Botones opciones={consolidado ? VISTAS_RES.filter((o) => o.id !== "liquidez") : VISTAS_RES} valor={consolidado && vista === "liquidez" ? "saldos" : vista} onCambio={setVista} etiqueta="Vista del resumen" />}>
      {/* La liquidez requerida sale de los % parametrizados por agencia: en Consolidado no se muestra */}
      {(vista === "saldos" || (consolidado && vista === "liquidez")) && <TablaMeses key="s" titulo="Producto" ultima="Año" filas={saldos}
        grupos={{ "s-vista": "Saldo al cierre del mes", "i-vista": "Intereses del mes" }} titulosAparte />}
      {vista === "liquidez" && !consolidado && <TablaMeses key="l" titulo="Liquidez requerida" ultima="Cierre" filas={liquidez} />}
      {vista === "analisis" && <AnalisisResumen det={det} total={total} ini={ini} intT={intT} liqTotal={liqTotal} consolidado={consolidado} />}
    </Tarjeta>
  );
}

function AnalisisResumen({ det, total, ini, intT, liqTotal, consolidado }: { det: Datos["detalle"]; total: number[]; ini: number; intT: number[]; liqTotal: number[]; consolidado: boolean }) {
  const crec = total[11] - ini, crecPct = ini ? total[11] / ini - 1 : 0;
  const promedio = suma(MESES.map((_, i) => (["vista", "crecer", "dpf"] as Clave[]).reduce((a, k) => a + (det[k][i].saldoInicial + det[k][i].saldoFinal) / 2, 0))) / 12;
  const costo = promedio ? suma(intT) / promedio : 0;
  const crecDe = (k: Clave) => (det[k][0].saldoInicial ? det[k][11].saldoFinal / det[k][0].saldoInicial - 1 : 0);
  const masCrece = PRODUCTOS.reduce((m, p) => (crecDe(p.clave) > crecDe(m.clave) ? p : m), PRODUCTOS[0]);
  const series = [
    { label: "Plazo fijo", color: COLOR_PRODUCTO.dpf, valores: det.dpf.map((d) => d.saldoFinal) },
    { label: "A la vista", color: COLOR_PRODUCTO.vista, valores: det.vista.map((d) => d.saldoFinal) },
    { label: "Crecer", color: COLOR_PRODUCTO.crecer, valores: det.crecer.map((d) => d.saldoFinal) },
  ];
  const parte = (k: Clave, i: number, campo: "saldoInicial" | "saldoFinal", t: number) => (t ? det[k][i][campo] / t : 0);
  const sinLiq = liqTotal.every((v) => v === 0);
  const frases = [
    `Las obligaciones con el público ${crec >= 0 ? "crecen" : "bajan"} ${pct(Math.abs(crecPct), 1)} en el año (${crec >= 0 ? "+" : "−"}${usd(Math.abs(crec))}) y cierran en ${usd(total[11])}.`,
    `${masCrece.label} es el producto que más crece (${crecDe(masCrece.clave) >= 0 ? "+" : "−"}${pct(Math.abs(crecDe(masCrece.clave)), 1)}).`,
    `El plazo fijo pasa de ${pct(parte("dpf", 0, "saldoInicial", ini), 1)} a ${pct(parte("dpf", 11, "saldoFinal", total[11]), 1)} del total; el ahorro a la vista, de ${pct(parte("vista", 0, "saldoInicial", ini), 1)} a ${pct(parte("vista", 11, "saldoFinal", total[11]), 1)}.`,
    `El costo promedio de las captaciones es ${pct(costo)} (intereses ${usd(suma(intT))} ÷ saldo promedio).`,
    consolidado ? "La liquidez requerida se calcula con los % de cada agencia: elija una agencia para verla." :
    sinLiq ? "Aún no hay % de liquidez requerida en los productos: cárguelo en cada pestaña con Editar." : `La liquidez requerida total llega a ${usd(liqTotal[11])} en diciembre (${pct(total[11] ? liqTotal[11] / total[11] : 0)} de las captaciones).`,
  ];
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Mini titulo={`Total dic-${ejercicioEnUso()}`} valor={usd(total[11])} pie={`${crec >= 0 ? "+" : "−"}${usd(Math.abs(crec))} (${crec >= 0 ? "+" : "−"}${pct(Math.abs(crecPct), 1)}) en el año`} color={crec >= 0 ? C.ok : C.alerta} />
        <Mini titulo="Costo promedio" valor={pct(costo)} pie={`Intereses del año ${usd(suma(intT))}`} />
        <Mini titulo={`Liquidez requerida dic-${ejercicioEnUso()}`} valor={consolidado || sinLiq ? "—" : usd(liqTotal[11])} pie={consolidado ? "" : sinLiq ? "Sin % cargado" : `${pct(total[11] ? liqTotal[11] / total[11] : 0)} de las captaciones`} />
        <Mini titulo="Producto que más crece" valor={masCrece.label} pie={`${crecDe(masCrece.clave) >= 0 ? "+" : "−"}${pct(Math.abs(crecDe(masCrece.clave)), 1)} en el año`} />
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Composición de las captaciones mes a mes</h3>
          <Leyenda items={series.map((s) => ({ label: s.label, color: s.color }))} />
        </div>
        <GraficaApilada series={series} />
      </div>
      <div className="rounded-lg px-4 py-3" style={{ background: "#F6F8F7", border: "1px solid #E6EAE8" }}>
        <h3 className="text-[12px] font-semibold mb-1.5" style={{ color: C.acento }}>Lectura</h3>
        <ul className="flex flex-col gap-1 text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
          {frases.map((f) => <li key={f} className="flex gap-2"><span style={{ color: C.acento }}>•</span><span>{f}</span></li>)}
        </ul>
      </div>
    </div>
  );
}

// =====================================================================
// UN PRODUCTO: parámetros + resultados (botones a la derecha)
// =====================================================================

type VistaProd = "saldo" | "crecimiento" | "liquidez" | "analisis";
const VISTAS_PROD: { id: VistaProd; label: string }[] = [
  { id: "saldo", label: "Saldo" }, { id: "crecimiento", label: "Crecimiento" },
  { id: "liquidez", label: "Liquidez requerida" }, { id: "analisis", label: "Análisis" },
];

function Botones<T extends string>({ opciones, valor, onCambio, etiqueta }: { opciones: { id: T; label: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div role="tablist" aria-label={etiqueta} className="flex flex-wrap gap-1 p-1 rounded-lg" style={{ background: "#F3F5F4" }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id} onClick={() => onCambio(o.id)}
                className="h-8 px-3.5 rounded-md text-[12px] transition-colors"
                style={valor === o.id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Interés del producto en el mes: capitalización (vista y crecer) o interés del plazo fijo. */
const interesDe = (clave: Clave, d: DetMes) => (clave === "dpf" ? interesDPF(d) : d.capitalizacionInteres);

function VistaProducto({ producto, det, detTodos, consolidado, filas, corte, editando, cambios, guardando, textos, msg, onEditar, onCancelar, onGuardar, onEscribir, onSoltar, onCopiarEnero }: {
  producto: (typeof PRODUCTOS)[number]; det: DetMes[]; detTodos: Datos["detalle"]; consolidado: boolean; filas: Fila[]; corte: string | null;
  editando: boolean; cambios: number; guardando: boolean; textos: Record<string, string>; msg: { t: string; e?: boolean } | null;
  onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
  onEscribir: (c: DefCampo, i: number, texto: string) => void; onSoltar: (k: string) => void; onCopiarEnero: (c: DefCampo) => void;
}) {
  const [vista, setVista] = useState<VistaProd>("saldo");
  const ordenadas = [...filas].sort((a, b) => a.mes - b.mes);
  const esDPF = producto.id === "DPF";
  const si = det.map((x) => x.saldoInicial);
  const sf = det.map((x) => x.saldoFinal);
  const origen = `saldo del balance${corte ? ` a ${corte}` : ""} (cuentas ${producto.cuentas})`;
  const mov: DefFila[] = esDPF ? [
    { id: "si", label: "Saldo inicial", valores: si, total: si[0], formula: (i) => (i === 0 ? `Enero arranca con el ${origen}: ${usd(si[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "can", label: "(−) Cancelaciones", color: "alerta", valores: det.map((x) => x.cancelaciones), total: suma(det.map((x) => x.cancelaciones)),
      formula: (i) => `Saldo inicial × % que vence y se cancela = ${usd(si[i])} × ${pct(det[i].tasas.pctCancelaciones)} = ${usd(-det[i].cancelaciones)}.` },
    { id: "ren", label: "(+) Renovaciones y nuevos contratos", color: "ok", valores: det.map((x) => x.renovaciones), total: suma(det.map((x) => x.renovaciones)),
      formula: (i) => `Monto cancelado × % renovaciones y nuevos contratos = ${usd(-det[i].cancelaciones)} × ${pct(det[i].tasas.ratioRenovaciones)} = ${usd(det[i].renovaciones)}. Si es mayor que 100 %, entra más de lo que sale.` },
    { id: "sf", label: "Saldo final", valores: sf, total: det[11].saldoFinal, clave: true,
      formula: (i) => `Saldo inicial − cancelaciones + renovaciones = ${usd(si[i])} − ${usd(-det[i].cancelaciones)} + ${usd(det[i].renovaciones)} = ${usd(det[i].saldoFinal)}.` },
    { id: "int", label: "Interés por pagar", valores: det.map(interesDPF), total: suma(det.map(interesDPF)), separador: true,
      formula: (i) => `(Saldo inicial + saldo final) ÷ 2 × tasa anual ÷ 12 = (${usd(si[i])} + ${usd(det[i].saldoFinal)}) ÷ 2 × ${pct(det[i].tasas.tasaInteresAnual)} ÷ 12 = ${usd(interesDPF(det[i]))}. Es gasto de intereses (Estado de resultados, 41); en plazo fijo no se suma al saldo.` },
  ] : [
    { id: "si", label: "Saldo inicial", valores: si, total: si[0], formula: (i) => (i === 0 ? `Enero arranca con el ${origen}: ${usd(si[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "dep", label: "(+) Depósitos", color: "ok", valores: det.map((x) => x.depositos), total: suma(det.map((x) => x.depositos)),
      formula: (i) => `Saldo inicial × % de depósitos = ${usd(si[i])} × ${pct(det[i].tasas.pctIngresosPeriodo)} = ${usd(det[i].depositos)}.` },
    { id: "ret", label: "(−) Retiros", color: "alerta", valores: det.map((x) => x.retiros), total: suma(det.map((x) => x.retiros)),
      formula: (i) => `Saldo inicial × % de retiros = ${usd(si[i])} × ${pct(det[i].tasas.pctRetirosPeriodo)} = ${usd(-det[i].retiros)}.` },
    { id: "cap", label: "(+) Capitalización de interés", color: "ok", valores: det.map((x) => x.capitalizacionInteres), total: suma(det.map((x) => x.capitalizacionInteres)),
      formula: (i) => `(Saldo inicial + depósitos − retiros) × tasa anual ÷ 12 = (${usd(si[i])} + ${usd(det[i].depositos)} − ${usd(-det[i].retiros)}) × ${pct(det[i].tasas.tasaInteresAnual)} ÷ 12 = ${usd(det[i].capitalizacionInteres)}. Es gasto de intereses y a la vez aumenta el saldo.` },
    { id: "sf", label: "Saldo final", valores: sf, total: det[11].saldoFinal, clave: true,
      formula: (i) => `Saldo inicial + depósitos − retiros + capitalización = ${usd(si[i])} + ${usd(det[i].depositos)} − ${usd(-det[i].retiros)} + ${usd(det[i].capitalizacionInteres)} = ${usd(det[i].saldoFinal)}.` },
    { id: "int", label: "Interés por pagar", valores: det.map((x) => x.capitalizacionInteres), total: suma(det.map((x) => x.capitalizacionInteres)), separador: true,
      formula: (i) => `Interés del mes del producto = ${usd(det[i].capitalizacionInteres)}. Es gasto de intereses (Estado de resultados, 41); en este producto se paga capitalizándolo en la cuenta del socio, por eso es el mismo valor de la fila de capitalización.` },
  ];

  // Crecimiento
  const crecMes = sf.map((v, i) => v - si[i]);
  const crecMesPct = sf.map((v, i) => (si[i] ? v / si[i] - 1 : 0));
  const crecAcum = sf.map((v) => v - si[0]);
  const crecAcumPct = sf.map((v) => (si[0] ? v / si[0] - 1 : 0));
  const crecimiento: DefFila[] = [
    { id: "sf", label: "Saldo final", valores: sf, total: sf[11], clave: true, formula: (i) => `Saldo al cierre de ${MESES[i]}: ${usd(sf[i])}.` },
    { id: "cm", label: "Crecimiento del mes ($)", valores: crecMes, total: suma(crecMes), signo: true, totalConSigno: true,
      formula: (i) => `Saldo final − saldo inicial del mes = ${usd(sf[i])} − ${usd(si[i])} = ${usd(crecMes[i])}. Año = suma de los 12 meses.` },
    { id: "cmp", label: "Crecimiento del mes (%)", valores: crecMesPct, total: crecAcumPct[11], esPct: true, signo: true, totalConSigno: true,
      formula: (i) => `Saldo final ÷ saldo inicial del mes − 1 = ${usd(sf[i])} ÷ ${usd(si[i])} − 1 = ${pct(crecMesPct[i])}. Año = crecimiento anual.` },
    { id: "ca", label: "Crecimiento acumulado ($)", valores: crecAcum, total: crecAcum[11], signo: true, totalConSigno: true, separador: true,
      formula: (i) => `Saldo final de ${MESES[i]} − saldo de partida${corte ? ` (${corte})` : ""} = ${usd(sf[i])} − ${usd(si[0])} = ${usd(crecAcum[i])}.` },
    { id: "cap", label: "Crecimiento acumulado (%)", valores: crecAcumPct, total: crecAcumPct[11], esPct: true, signo: true, totalConSigno: true,
      formula: (i) => `Saldo final de ${MESES[i]} ÷ saldo de partida − 1 = ${usd(sf[i])} ÷ ${usd(si[0])} − 1 = ${pct(crecAcumPct[i])}.` },
  ];

  // Liquidez requerida (con lo que se está editando, para ver el efecto al instante)
  const pctLiq = ordenadas.map((f) => valorDe(f, "pct_liquidez"));
  const liq = sf.map((v, i) => v * pctLiq[i]);
  const liquidez: DefFila[] = [
    { id: "sf", label: "Saldo final", valores: sf, total: sf[11], tenue: true, formula: (i) => `Saldo al cierre de ${MESES[i]}: ${usd(sf[i])}.` },
    { id: "pl", label: "% de liquidez requerida", valores: pctLiq, total: pctLiq[11], esPct: true,
      formula: (i) => `Parámetro de ${MESES[i]} (se edita arriba, en Parámetros): ${pct(pctLiq[i])}.` },
    { id: "lr", label: "Liquidez requerida", valores: liq, total: liq[11], clave: true,
      formula: (i) => `Saldo final × % de liquidez requerida = ${usd(sf[i])} × ${pct(pctLiq[i])} = ${usd(liq[i])}. Se suma con los otros productos en la Proyección de liquidez (Fondos disponibles).` },
  ];

  return (
    <>
      {consolidado ? null : <Parametros
        titulo={`Parámetros · ${producto.label}`} params={CAMPOS[producto.id]}
        valores={(c) => ordenadas.map((f) => valorDe(f, c))}
        fuente={() => null}
        editando={editando} cambios={cambios} guardando={guardando} textos={textos} msg={msg}
        onEditar={onEditar} onCancelar={onCancelar} onGuardar={onGuardar}
        onEscribir={onEscribir} onSoltar={onSoltar} onCopiarEnero={onCopiarEnero}
      />}
      <Tarjeta titulo={producto.label} derecha={<Botones opciones={consolidado ? VISTAS_PROD.filter((o) => o.id !== "liquidez") : VISTAS_PROD} valor={consolidado && vista === "liquidez" ? "saldo" : vista} onCambio={setVista} etiqueta={`Resultados de ${producto.label}`} />}>
        {(vista === "saldo" || (consolidado && vista === "liquidez")) && <TablaMeses key={`s-${producto.id}`} titulo="Movimiento del saldo" ultima="Total año" filas={mov} />}
        {vista === "crecimiento" && <TablaMeses key={`c-${producto.id}`} titulo="Crecimiento" ultima="Año" filas={crecimiento} />}
        {vista === "liquidez" && !consolidado && <TablaMeses key={`l-${producto.id}`} titulo="Liquidez requerida" ultima="Cierre" filas={liquidez} />}
        {vista === "analisis" && <AnalisisProducto producto={producto} det={det} detTodos={detTodos} liq={liq} pctLiq={pctLiq} consolidado={consolidado} />}
      </Tarjeta>
    </>
  );
}

function Mini({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: string; color?: string }) {
  return (
    <div className="rounded-lg px-4 py-3 flex flex-col gap-0.5" style={{ background: "#F6F8F7", border: "1px solid #E6EAE8" }}>
      <span className="text-[11px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[18px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[11px]" style={{ color: color ?? C.texto2 }}>{pie}</span>
    </div>
  );
}

function AnalisisProducto({ producto, det, detTodos, liq, pctLiq, consolidado }: {
  producto: (typeof PRODUCTOS)[number]; det: DetMes[]; detTodos: Datos["detalle"]; liq: number[]; pctLiq: number[]; consolidado: boolean;
}) {
  const k = producto.clave, esDPF = k === "dpf";
  const ini = det[0].saldoInicial, fin = det[11].saldoFinal, crec = fin - ini, crecPct = ini ? fin / ini - 1 : 0;
  const totalDe = (i: number, campo: "saldoInicial" | "saldoFinal") => detTodos.vista[i][campo] + detTodos.crecer[i][campo] + detTodos.dpf[i][campo];
  const partIni = totalDe(0, "saldoInicial") ? ini / totalDe(0, "saldoInicial") : 0;
  const partFin = totalDe(11, "saldoFinal") ? fin / totalDe(11, "saldoFinal") : 0;
  const intereses = suma(det.map((d) => interesDe(k, d)));
  const promedio = suma(det.map((d) => (d.saldoInicial + d.saldoFinal) / 2)) / 12;
  const costo = promedio ? intereses / promedio : 0;
  const entradas = det.map((d) => (esDPF ? d.renovaciones : d.depositos));
  const salidas = det.map((d) => Math.abs(esDPF ? d.cancelaciones : d.retiros));
  const netos = det.map((d) => d.saldoFinal - d.saldoInicial);
  const mesesPositivos = entradas.filter((v, i) => v > salidas[i]).length;
  const mejor = netos.reduce((m, v, i) => (v > netos[m] ? i : m), 0);
  const peor = netos.reduce((m, v, i) => (v < netos[m] ? i : m), 0);
  const nombreEntr = esDPF ? "las renovaciones y nuevos contratos" : "los depósitos";
  const nombreSal = esDPF ? "las cancelaciones" : "los retiros";
  const may = (t: string) => t[0].toUpperCase() + t.slice(1);
  const sinLiq = pctLiq.every((v) => v === 0);

  const frases = [
    `${producto.label} ${crec >= 0 ? "crece" : "baja"} ${pct(Math.abs(crecPct), 1)} en el año (${crec >= 0 ? "+" : "−"}${usd(Math.abs(crec))}) y cierra diciembre en ${usd(fin)}.`,
    mesesPositivos === 12 ? `${may(nombreEntr)} superan a ${nombreSal} los 12 meses.`
      : mesesPositivos === 0 ? `${may(nombreSal)} superan a ${nombreEntr} todos los meses.`
      : `${may(nombreEntr)} superan a ${nombreSal} en ${mesesPositivos} de 12 meses.`,
    `El mes de mayor crecimiento es ${MESES_LARGOS[mejor]} (${netos[mejor] >= 0 ? "+" : "−"}${usd(Math.abs(netos[mejor]))})${peor !== mejor ? ` y el más débil, ${MESES_LARGOS[peor]} (${netos[peor] >= 0 ? "+" : "−"}${usd(Math.abs(netos[peor]))})` : ""}.`,
    `Su participación en las captaciones pasa de ${pct(partIni, 1)} a ${pct(partFin, 1)}${Math.abs(partFin - partIni) < 0.0005 ? " (se mantiene)" : partFin > partIni ? " (gana peso)" : " (pierde peso)"}.`,
    consolidado ? "La liquidez requerida se calcula con los % de cada agencia: elija una agencia para verla." :
    sinLiq ? "Aún no tiene % de liquidez requerida: cárguelo en Parámetros con Editar." : `Requiere ${usd(liq[11])} de liquidez a diciembre (${pct(pctLiq[11])} del saldo).`,
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Mini titulo={`Saldo dic-${ejercicioEnUso()}`} valor={usd(fin)} pie={`${crec >= 0 ? "+" : "−"}${usd(Math.abs(crec))} (${crec >= 0 ? "+" : "−"}${pct(Math.abs(crecPct), 1)}) en el año`} color={crec >= 0 ? C.ok : C.alerta} />
        <Mini titulo="Participación en captaciones" valor={pct(partFin, 1)} pie={`${partFin >= partIni ? "+" : "−"}${(Math.abs(partFin - partIni) * 100).toFixed(1).replace(".", ",")} pts frente al inicio`} />
        <Mini titulo="Costo del producto" valor={pct(costo)} pie={`Intereses ${usd(intereses)} ÷ saldo promedio`} />
        <Mini titulo={`Liquidez requerida dic-${ejercicioEnUso()}`} valor={consolidado || sinLiq ? "—" : usd(liq[11])} pie={consolidado ? "" : sinLiq ? "Sin % cargado" : `${pct(pctLiq[11])} del saldo`} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-semibold">Evolución del saldo</h3>
            <span className="text-[11px]" style={{ color: C.texto2 }}>Desde el saldo de partida hasta diciembre</span>
          </div>
          <GraficaLinea valores={det.map((d) => d.saldoFinal)} inicial={ini} color={COLOR_PRODUCTO[k]} nombre={`Saldo de ${producto.label}`} />
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-semibold">Qué mueve el saldo</h3>
            <Leyenda items={[{ label: esDPF ? "Renovaciones y nuevos" : "Depósitos", color: SERIE.verde }, { label: esDPF ? "Cancelaciones" : "Retiros", color: SERIE.rojo }]} />
          </div>
          <GraficaEntradasSalidas entradas={entradas} salidas={salidas}
            etiquetaEntradas={esDPF ? "Renovaciones y nuevos" : "Depósitos"} etiquetaSalidas={esDPF ? "Cancelaciones" : "Retiros"} />
        </div>
      </div>
      <div className="rounded-lg px-4 py-3" style={{ background: "#F6F8F7", border: "1px solid #E6EAE8" }}>
        <h3 className="text-[12px] font-semibold mb-1.5" style={{ color: C.acento }}>Lectura</h3>
        <ul className="flex flex-col gap-1 text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
          {frases.map((f) => <li key={f} className="flex gap-2"><span style={{ color: C.acento }}>•</span><span>{f}</span></li>)}
        </ul>
      </div>
    </div>
  );
}
