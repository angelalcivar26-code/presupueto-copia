"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { apiFetch } from "../../lib/useDatos";
import { useState, type ReactNode } from "react";
import { Download, AlertTriangle, BookOpen, X } from "lucide-react";
import { useDatos } from "../../lib/useDatos";
import { Actualizando, EsqueletoTabla } from "../../components/Carga";
import {
  MESES, AGENCIAS as AGENCIAS_BASE, C, FONDO, BORDE_EDICION, suma, usd, pct, etiquetaCorte, leerNumero,
  BotonesSeccion, ChipsMes, Indicador, FranjaIndicadores, Tarjeta, TablaMeses, Parametros, ETIQUETA_FUENTE,
  type DefFila, type Fuente,
} from "../../components/ActivosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { ResumenPorAgencia, BotonesVista } from "../../components/PorAgencia";
import { TransferenciasInternas } from "../../components/TransferenciasInternas";
import { ActivosDiferidos } from "../../components/ActivosDiferidos";

const AGENCIAS = [...AGENCIAS_BASE, "Consolidado"];

// =====================================================================
// CONFIGURACIÓN
// =====================================================================

type Pestana = "resumen" | "1901" | "1902" | "1904" | "1905" | "1906" | "1908" | "1990";
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "1901", label: "1901 · Inversiones en acciones" },
  { id: "1902", label: "1902 · Fondo de liquidez" },
  { id: "1904", label: "1904 · Gastos anticipados" },
  { id: "1905", label: "1905 · Gastos diferidos" },
  { id: "1906", label: "1906 · Materiales" },
  { id: "1908", label: "1908 · Transferencias internas" },
  { id: "1990", label: "1990 · Otros" },
];
/** 1904, 1905 y 1906 salen del registro de partidas (components/ActivosDiferidos). */
const DIFERIDOS = ["1904", "1905", "1906"] as const;
const esDiferido = (p: Pestana): p is (typeof DIFERIDOS)[number] => (DIFERIDOS as readonly string[]).includes(p);

type Concepto =
  | "fondo_liquidez_pct_vigente"
  | "gastos_anticipados_entradas" | "gastos_anticipados_salidas"
  | "materiales_entradas" | "materiales_salidas"
  | "transferencias_1908_entradas" | "transferencias_1908_salidas"
  | "cuentas_por_cobrar_variacion";
interface DefParametro { concepto: Concepto; label: string; esPct?: boolean }

const PARAMETROS: Record<"1902" | "1908", DefParametro[]> = {
  "1902": [{ concepto: "fondo_liquidez_pct_vigente", label: "% aporte vigente", esPct: true }],
  "1908": [
    { concepto: "transferencias_1908_entradas", label: "(+) Fondos remitidos a otras agencias" },
    { concepto: "transferencias_1908_salidas", label: "(−) Fondos devueltos por las agencias" },
  ],
};

// =====================================================================
// UTILIDADES
// =====================================================================

// =====================================================================
// TIPOS DE LA API
// =====================================================================

interface Rollforward { mes: number; saldoInicio: number; entradas: number; salidas: number; saldoFin: number }
interface MesFondo {
  mes: number; obligacionesFinMes: number; promedioObligacionesAprox: number;
  pctVigente: number; pctAplicado: number; aporteMensualActual: number;
  saldoInicial: number; ajuste: number; saldoFinal: number;
}
interface MesResumen { mes: number; c1901: number; c1902: number; c1904: number; c1905: number; c1906: number; c1908: number; c1990: number; c1999: number; total: number }
interface Datos {
  inversiones1901: number;
  fondoLiquidez1902: MesFondo[];
  gastosAnticipados1904: Rollforward[];
  materiales1906: Rollforward[];
  transferencias1908: Rollforward[];
  cuentasPorCobrar16: Rollforward[];
  resumen19: MesResumen[];
  fondoLiquidezInfo: {
    saldo1902Corte: number; aportesCorte?: number; rendimientosCorte?: number; obligacionesCorte: number; captacionesCorte: number; otras21: number;
    pctImplicitoCorte: number | null; meta: number; pctGuardado: boolean;
    rendimientoPorMes?: number[]; rendimiento?: { tasa: number; real: number | null; guardada: boolean; acumuladoCorte?: number | null; base1902?: number } | null;
  };
  corteCuentas: { c19: number | null; c1901: number; c1902: number; c1904: number; c1905: number; c1906: number; c1908: number; c1990: number; c1999: number; c16: number };
  corte?: { anio: number; mes: number };
  fuentes?: Partial<Record<Concepto, Fuente>>;
  subcuentas?: { codigo: string; nombre: string; saldo: number }[];
  error?: string;
}

/** Valores que usa hoy el motor para cada parámetro editable. */
function valoresActuales(d: Datos, c: Concepto): number[] {
  switch (c) {
    case "fondo_liquidez_pct_vigente": return d.fondoLiquidez1902.map((f) => f.pctVigente);
    case "gastos_anticipados_entradas": return d.gastosAnticipados1904.map((f) => f.entradas);
    case "gastos_anticipados_salidas": return d.gastosAnticipados1904.map((f) => f.salidas);
    case "materiales_entradas": return d.materiales1906.map((f) => f.entradas);
    case "materiales_salidas": return d.materiales1906.map((f) => f.salidas);
    case "transferencias_1908_entradas": return d.transferencias1908.map((f) => f.entradas);
    case "transferencias_1908_salidas": return d.transferencias1908.map((f) => f.salidas);
    case "cuentas_por_cobrar_variacion": return d.cuentasPorCobrar16.map((f) => f.entradas);
  }
}

// =====================================================================
// COMPONENTES COMUNES (mismos de Obligaciones con el público y Cartera)
// =====================================================================

// =====================================================================
// PÁGINA
// =====================================================================

export default function OtrosActivosPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [version, setVersion] = useState(0);
  const url = `/api/otros-activos-detalle?agencia=${encodeURIComponent(agencia)}`;
  const consolidado = agencia === "Consolidado";
  const { datos, cargando, actualizando, error } = useDatos<Datos>(
    url, version,
    (d) => (d.fondoLiquidez1902 ? null : "No se pudo calcular."),
  );

  // Edición de parámetros (una pestaña a la vez)
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Partial<Record<Concepto, number[]>>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);

  const params = pestana === "1902" || pestana === "1908" ? PARAMETROS[pestana] : [];
  const cambios = datos ? params.reduce((n, p) => {
    const b = borrador[p.concepto];
    if (!b) return n;
    const o = valoresActuales(datos, p.concepto);
    return n + b.filter((v, i) => Math.abs(v - o[i]) > 1e-9).length;
  }, 0) : 0;

  function salirDeEdicion(): boolean {
    if (editando && cambios > 0 && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardar?")) return false;
    setEditando(false); setBorrador({}); setTextos({});
    return true;
  }
  function irA(t: Pestana) { if (t !== pestana && salirDeEdicion()) { setPestana(t); setMsg(null); } }
  function cambiarAgencia(a: string) { if (salirDeEdicion()) { setAgencia(a); setMsg(null); } }

  function empezarEdicion() {
    if (!datos || actualizando || consolidado) return;
    setBorrador(Object.fromEntries(params.map((p) => [p.concepto, [...valoresActuales(datos, p.concepto)]])));
    setTextos({}); setEditando(true); setMsg(null);
  }
  function escribir(p: DefParametro, mes: number, texto: string) {
    setTextos((t) => ({ ...t, [`${p.concepto}-${mes}`]: texto }));
    const v = leerNumero(texto);
    if (v === null) return;
    setBorrador((b) => ({ ...b, [p.concepto]: (b[p.concepto] ?? Array(12).fill(0)).map((x, i) => (i === mes ? (p.esPct ? v / 100 : v) : x)) }));
  }
  function copiarEnero(p: DefParametro) {
    setBorrador((b) => { const arr = b[p.concepto] ?? Array(12).fill(0); return { ...b, [p.concepto]: arr.map(() => arr[0]) }; });
    setTextos((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith(`${p.concepto}-`))));
  }
  async function guardar() {
    if (!datos) return;
    for (const p of params) {
      const b = borrador[p.concepto] ?? [];
      if (p.esPct) {
        const malos = b.map((v, i) => (v < 0 || v > 1 ? MESES[i] : null)).filter(Boolean);
        if (malos.length) { setMsg({ t: `${p.label}: revisa ${malos.join(", ")} (entre 0 % y 100 %).`, e: true }); return; }
      }
    }
    setGuardando(true); setMsg(null);
    try {
      for (const p of params) {
        const b = borrador[p.concepto];
        if (!b) continue;
        const o = valoresActuales(datos, p.concepto);
        const cambio = b.some((v, i) => Math.abs(v - o[i]) > 1e-9);
        // Se guarda si cambió algo o si hoy sale de la referencia (así queda propio de la agencia)
        if (!cambio) continue;
        const r = await apiFetch("/api/otros-pasivo-parametros", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agencia, concepto: p.concepto, montosPorMes: b }),
        });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error ?? `error ${r.status}`);
      }
      setEditando(false); setBorrador({}); setTextos({});
      setMsg({ t: "Parámetros guardados. Balance, Estado de resultados y Flujo ya usan los nuevos valores." });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally {
      setGuardando(false);
    }
  }

  const corte = datos?.corte ? etiquetaCorte(datos.corte) : null;


  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50";

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      {/* Encabezado: título; a la derecha, saldos de partida y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Otros activos<AnioEjercicio /></h1>
        <Actualizando visible={actualizando} />
        {pestana === "resumen" && (
          <button type="button" onClick={() => void exportarPantalla()} disabled={!datos} title="Exportar a Excel" className={accion} style={{ color: C.acento }}>
            <Download size={16} /> Exportar
          </button>
        )}
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Cuentas" className="flex flex-wrap gap-x-7 flex-1">
          {PESTANAS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={pestana === t.id} onClick={() => irA(t.id)}
                    className="pt-2 pb-2.5 -mb-px text-[13px]"
                    style={{ color: pestana === t.id ? C.acento : C.texto2, fontWeight: pestana === t.id ? 600 : 400, borderBottom: `2px solid ${pestana === t.id ? C.acento : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => cambiarAgencia(e.target.value)}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {/* Indicadores */}
      {datos && !cargando && !error && (pestana === "resumen" ? <IndicadoresResumen d={datos} corte={corte} /> : pestana === "1902" ? <IndicadoresFondo d={datos} corte={corte} /> : null)}

      {cargando ? (
        <EsqueletoTabla indicadores={false} filas={8} />
      ) : error ? (
        <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      ) : pestana === "1908" ? (
        <TransferenciasInternas key={agencia} agencia={agencia} />
      ) : esDiferido(pestana) ? (
        <ActivosDiferidos key={`${agencia}-${pestana}`} agencia={agencia} grupo={pestana} />
      ) : !datos ? null : pestana === "resumen" ? (
        <Resumen d={datos} corte={corte} onElegir={irA} consolidado={consolidado} />
      ) : pestana === "1901" || pestana === "1990" ? (
        <CuentaFija pestana={pestana} d={datos} corte={corte} />
      ) : (
        <div className="flex flex-col gap-5 pb-6">
          {consolidado ? null : pestana === "1902" ? (
            <>
              <ParametroFondo key={`fondo-${agencia}`} d={datos} agencia={agencia} onGuardado={() => setVersion((v) => v + 1)} />
              <ParametroRendimiento key={`rend-${agencia}`} d={datos} agencia={agencia} corte={corte} onGuardado={() => setVersion((v) => v + 1)} />
            </>
          ) : (
          <Parametros
            titulo={`Parámetros · ${PESTANAS.find((p) => p.id === pestana)!.label}`} params={params}
            valores={(c) => (editando && borrador[c]) ? borrador[c]! : valoresActuales(datos, c)}
            fuente={(c) => c === "fondo_liquidez_pct_vigente" ? (datos.fondoLiquidezInfo.pctGuardado ? "guardado" : null) : datos.fuentes?.[c] ?? null}
            editando={editando} cambios={cambios} guardando={guardando} textos={textos} msg={msg}
            onEditar={empezarEdicion} onCancelar={() => { setEditando(false); setBorrador({}); setTextos({}); }} onGuardar={guardar}
            onEscribir={escribir} onSoltar={(k) => setTextos((t) => { const n = { ...t }; delete n[k]; return n; })} onCopiarEnero={copiarEnero}
          />
          )}
          {pestana === "1902" ? <MovimientoFondo d={datos} corte={corte} agencia={agencia} /> : <MovimientoCuenta pestana={pestana} d={datos} corte={corte} />}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// INDICADORES
// =====================================================================

function IndicadoresResumen({ d, corte }: { d: Datos; corte: string | null }) {
  const cc = d.corteCuentas;
  const ini = cc.c1901 + cc.c1902 + cc.c1904 + cc.c1905 + cc.c1906 + cc.c1908 + cc.c1990 + cc.c1999;
  const fin = d.resumen19[11].total;
  const varAnio = fin - ini;
  const fl = d.fondoLiquidez1902;
  return (
    <FranjaIndicadores>
      <Indicador titulo={`Otros activos dic-${ejercicioEnUso()}`} valor={usd(fin)}
        pie={`${varAnio >= 0 ? "Suben" : "Bajan"} ${usd(Math.abs(varAnio))} frente al corte${corte ? ` (${corte})` : ""}`} />
      <Indicador titulo={`Fondo de liquidez dic-${ejercicioEnUso()}`} valor={usd(d.resumen19[11].c1902)}
        pie={`Aportes ${usd(fl[11].saldoFinal)} + rendimientos ${usd(d.resumen19[11].c1902 - fl[11].saldoFinal)}`} />
      <Indicador titulo={`Transferencias internas dic-${ejercicioEnUso()}`} valor={usd(d.transferencias1908[11].saldoFin)}
        pie={`Remitido en el año ${usd(suma(d.transferencias1908.map((f) => f.entradas)))}`} />
      <Indicador titulo={`Gastos anticipados dic-${ejercicioEnUso()}`} valor={usd(d.resumen19[11].c1904)}
        pie={`Al corte ${usd(d.corteCuentas.c1904)}`} />
    </FranjaIndicadores>
  );
}

function IndicadoresFondo({ d, corte }: { d: Datos; corte: string | null }) {
  const info = d.fondoLiquidezInfo;
  const fl = d.fondoLiquidez1902;
  const aporteNeto = suma(fl.map((f) => f.ajuste));
  const promPct = suma(fl.map((f) => f.pctAplicado)) / 12;
  return (
    <FranjaIndicadores>
      <Indicador titulo={`Fondo de liquidez a ${corte ?? "corte"}`} valor={usd(info.saldo1902Corte)}
        pie={`Aportes ${usd(info.aportesCorte ?? info.saldo1902Corte)} · rendimientos ${usd(info.rendimientosCorte ?? 0)}`} />
      <Indicador titulo="% implícito al corte" valor={info.pctImplicitoCorte === null ? "—" : pct(info.pctImplicitoCorte)}
        pie="ƒ saldo 1902 ÷ obligaciones con el público" />
      <Indicador titulo={`% aporte ${ejercicioEnUso()}`} valor={pct(promPct)}
        pie={`Meta ${pct(info.meta)} · ${info.pctGuardado ? "escrito para la agencia" : "valor por defecto"}`} />
      <Indicador titulo="Aporte neto del año" valor={usd(aporteNeto)}
        pie={aporteNeto >= 0 ? "Sale de caja hacia el fondo" : "Reintegro que entra a caja"} />
    </FranjaIndicadores>
  );
}

// =====================================================================
// RESUMEN
// =====================================================================

function Resumen({ d, corte, onElegir, consolidado }: { d: Datos; corte: string | null; onElegir: (p: Pestana) => void; consolidado?: boolean }) {
  const [vista, setVista] = useState<"cuentas" | "agencias">("cuentas");
  const r = d.resumen19;
  const cc = d.corteCuentas;
  const de = corte ? ` a ${corte}` : "";
  const fila = (id: string, label: string, clave: keyof MesResumen, ini: number, formula: (i: number) => string, destino?: Pestana): DefFila => ({
    id, label, valores: r.map((x) => x[clave]), total: r[11][clave] - ini, totalConSigno: true, formula,
    onClick: destino ? () => onElegir(destino) : undefined,
  });
  const iniTotal = cc.c1901 + cc.c1902 + cc.c1904 + cc.c1905 + cc.c1906 + cc.c1908 + cc.c1990 + cc.c1999;
  const filas: DefFila[] = [
    fila("1901", "1901 · Inversiones en acciones", "c1901", cc.c1901,
      () => `Sin movimiento en el año: se mantiene en el saldo del balance${de} = ${usd(cc.c1901)}.`, "1901"),
    fila("1902", "1902 · Fondo de liquidez", "c1902", cc.c1902,
      (i) => `Saldo final de la pestaña Fondo de liquidez: ${usd(r[i].c1902)}. Parte de ${usd(cc.c1902)} al corte y se mueve con el aporte o reintegro de cada mes.`, "1902"),
    fila("1904", "1904 · Gastos y pagos anticipados", "c1904", cc.c1904,
      (i) => `Saldo final de la pestaña Gastos anticipados: ${usd(r[i].c1904)}.`, "1904"),
    fila("1905", "1905 · Gastos diferidos", "c1905", cc.c1905,
      (i) => `Saldo final de la pestaña Gastos diferidos: ${usd(r[i].c1905)}.`, "1905"),
    fila("1906", "1906 · Materiales, mercaderías e insumos", "c1906", cc.c1906,
      (i) => `Saldo final de la pestaña Materiales: ${usd(r[i].c1906)}.`, "1906"),
    fila("1908", "1908 · Transferencias internas", "c1908", cc.c1908,
      (i) => `Saldo final de la pestaña Transferencias internas: ${usd(r[i].c1908)}.`, "1908"),
    fila("1990", "1990 · Otros", "c1990", cc.c1990,
      () => `Sin movimiento en el año: se mantiene en el saldo del balance${de} = ${usd(cc.c1990)}.`, "1990"),
    fila("1999", "1999 · (−) Provisión otros activos", "c1999", cc.c1999,
      () => `Sin movimiento en el año: se mantiene en el saldo del balance${de} = ${usd(cc.c1999)}.`, "1990"),
    { id: "19", codigo: "19", label: "Total otros activos", valores: r.map((x) => x.total), total: r[11].total - iniTotal, clave: true, totalConSigno: true,
      formula: (i) => `1901 + 1902 + 1904 + 1905 + 1906 + 1908 + 1990 + 1999 = ${usd(r[i].c1901)} + ${usd(r[i].c1902)} + ${usd(r[i].c1904)} + ${usd(r[i].c1905)} + ${usd(r[i].c1906)} + ${usd(r[i].c1908)} + ${usd(r[i].c1990)} ${r[i].c1999 < 0 ? "−" : "+"} ${usd(Math.abs(r[i].c1999))} = ${usd(r[i].total)}. Llega al Balance como grupo 19.` },
  ];
  const otras19 = cc.c19 === null ? null : cc.c19 - iniTotal;
  return (
    <Tarjeta titulo={vista === "cuentas" ? "Saldos por cuenta" : "Saldos por agencia · 19"}
      derecha={consolidado ? (
        <BotonesVista etiqueta="Vista de saldos" valor={vista} onChange={setVista}
          opciones={[{ id: "cuentas", label: "Por cuenta" }, { id: "agencias", label: "Por agencia" }]} />
      ) : undefined}>
      {consolidado && vista === "agencias" ? (
        <ResumenPorAgencia<Datos> url={(a) => `/api/otros-activos-detalle?agencia=${encodeURIComponent(a)}`} conceptos={[
          { id: "19", label: "Total 19", valores: (x) => x.resumen19.map((m) => m.total) },
          { id: "1902", label: "1902", valores: (x) => x.resumen19.map((m) => m.c1902) },
          { id: "1904", label: "1904", valores: (x) => x.resumen19.map((m) => m.c1904) },
          { id: "1905", label: "1905", valores: (x) => x.resumen19.map((m) => m.c1905) },
          { id: "1906", label: "1906", valores: (x) => x.resumen19.map((m) => m.c1906) },
          { id: "1908", label: "1908", valores: (x) => x.resumen19.map((m) => m.c1908) },
        ]} />
      ) : <TablaMeses titulo="Cuenta" ultima="Var. año" filas={filas} />}
      {vista === "cuentas" && otras19 !== null && Math.abs(otras19) >= 1 && (
        <p className="px-4 py-3 text-[12px] flex items-start gap-2" style={{ color: C.texto3, borderTop: `1px solid ${C.beige}` }}>
          <AlertTriangle size={15} className="shrink-0 mt-[1px]" style={{ color: C.aviso }} />
          <span>
            El balance{de} tiene {usd(cc.c19!)} en el grupo 19 y estas cuentas suman {usd(iniTotal)}.
            Quedan <b>{usd(otras19)}</b> en otras subcuentas del 19 que no se proyectan y no llegan al Balance.
          </span>
        </p>
      )}
    </Tarjeta>
  );
}

// =====================================================================
// PARÁMETRO DEL FONDO DE LIQUIDEZ: un solo % para todo el año (editable)
// =====================================================================

function ParametroFondo({ d, agencia, onGuardado }: { d: Datos; agencia: string; onGuardado: () => void }) {
  const info = d.fondoLiquidezInfo;
  const vals = d.fondoLiquidez1902.map((f) => f.pctVigente);
  const actual = vals[0] ?? 0;
  const varia = vals.some((v) => Math.abs(v - actual) > 1e-9);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);

  function empezar() { setTexto((actual * 100).toFixed(2).replace(".", ",")); setEditando(true); setMsg(null); }
  async function guardar() {
    const v = leerNumero(texto);
    if (v === null || v < 0 || v > 100) { setMsg({ t: "Escribe un % entre 0 y 100 (ej. 5,90).", e: true }); return; }
    setGuardando(true); setMsg(null);
    try {
      // El mismo % para los 12 meses de 2027
      const r = await apiFetch("/api/otros-pasivo-parametros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, concepto: "fondo_liquidez_pct_vigente", montosPorMes: Array(12).fill(v / 100) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      setEditando(false);
      setMsg({ t: "Guardado. El aporte, el Balance y el Flujo ya lo usan." });
      onGuardado();
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally { setGuardando(false); }
  }

  const nuevo = leerNumero(texto);
  const cambio = editando && nuevo !== null && Math.abs(nuevo / 100 - actual) > 1e-9;
  // Una sola fila: nombre del parámetro, valor, etiqueta y botones a la derecha
  return (
    <section className="tarjeta overflow-hidden"
             style={editando ? { borderColor: BORDE_EDICION, boxShadow: `0 0 0 2px ${C.acentoSuave}` } : undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">% de aporte vigente {ejercicioEnUso()}</h2>
        {editando ? (
          <span className="flex items-center gap-1.5">
            <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" autoFocus aria-label="% de aporte vigente"
                   onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
                   className="w-[72px] h-9 rounded-md px-2.5 text-right text-[14px] font-semibold" style={{ border: `1px solid ${BORDE_EDICION}` }} />
            <span className="text-[14px] font-semibold">%</span>
          </span>
        ) : (
          <b className="text-[16px]">{pct(actual)}</b>
        )}
        {!editando && (
          <span className="text-[10px] font-semibold px-1.5 py-px rounded" style={info.pctGuardado
            ? { background: ETIQUETA_FUENTE.guardado.fondo, color: ETIQUETA_FUENTE.guardado.color }
            : { background: C.crema, color: C.texto2 }}>{info.pctGuardado ? "Guardado" : "Valor por defecto"}</span>
        )}
        {varia && !editando && (
          <span className="text-[12px] flex items-center gap-1.5" style={{ color: "#6E4A0E" }}>
            <AlertTriangle size={14} /> Hay meses con otro % ({pct(Math.min(...vals))} a {pct(Math.max(...vals))}); al guardar quedan todos iguales.
          </span>
        )}
        {msg && <span className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</span>}
        <span className="flex-1" />
        <BotonesSeccion editando={editando} cambios={cambio || varia ? 1 : 0} guardando={guardando}
          onEditar={empezar} onCancelar={() => { setEditando(false); setMsg(null); }} onGuardar={guardar} />
      </div>
    </section>
  );
}

// =====================================================================
// RENDIMIENTO DEL FIDEICOMISO (53040505): tasa anual editable; por defecto la real del año
// =====================================================================

function ParametroRendimiento({ d, agencia, corte, onGuardado }: { d: Datos; agencia: string; corte: string | null; onGuardado: () => void }) {
  const r = d.fondoLiquidezInfo.rendimiento ?? null;
  const actual = r?.tasa ?? 0;
  const anual = suma(d.fondoLiquidezInfo.rendimientoPorMes ?? []);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);

  function empezar() { setTexto((actual * 100).toFixed(2).replace(".", ",")); setEditando(true); setMsg(null); }
  async function enviar(montos: number[] | null) {
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/otros-pasivo-parametros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, concepto: "fondo_liquidez_tasa_rendimiento", montosPorMes: montos ?? Array(12).fill(0), ...(montos ? {} : { borrar: true }) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      setEditando(false);
      setMsg({ t: "Guardado. El Estado de resultados y el Balance ya lo usan." });
      onGuardado();
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally { setGuardando(false); }
  }
  function guardar() {
    const v = leerNumero(texto);
    if (v === null || v < 0 || v > 30) { setMsg({ t: "Escribe una tasa anual entre 0 y 30 (ej. 3,20).", e: true }); return; }
    enviar(Array(12).fill(v / 100));
  }
  const nuevo = leerNumero(texto);
  const cambio = editando && nuevo !== null && Math.abs(nuevo / 100 - actual) > 1e-9;
  return (
    <section className="tarjeta overflow-hidden"
             style={editando ? { borderColor: BORDE_EDICION, boxShadow: `0 0 0 2px ${C.acentoSuave}` } : undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">Rendimiento anual del fideicomiso</h2>
        {editando ? (
          <span className="flex items-center gap-1.5">
            <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" autoFocus aria-label="Tasa anual de rendimiento"
                   onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
                   className="w-[72px] h-9 rounded-md px-2.5 text-right text-[14px] font-semibold" style={{ border: `1px solid ${BORDE_EDICION}` }} />
            <span className="text-[14px] font-semibold">%</span>
          </span>
        ) : (
          <b className="text-[16px]">{pct(actual)}</b>
        )}
        {!editando && (
          <span className="text-[10px] font-semibold px-1.5 py-px rounded" style={r?.guardada
            ? { background: ETIQUETA_FUENTE.guardado.fondo, color: ETIQUETA_FUENTE.guardado.color }
            : { background: C.crema, color: C.texto2 }}>{r?.guardada ? "Guardado" : "Real del año"}</span>
        )}
        {!editando && (
          <span className="text-[12px]" style={{ color: C.texto3 }}>
            {r?.real != null ? `Real a ${corte ?? "corte"}: ${pct(r.real)}` : "Sin rendimiento real en el histórico"} · 53040505 en {ejercicioEnUso()} {usd(anual)}
          </span>
        )}
        {r?.guardada && !editando && (
          <button type="button" onClick={() => enviar(null)} disabled={guardando}
                  className="text-[12px] font-semibold underline" style={{ color: C.acento }}>Usar la real</button>
        )}
        {msg && <span className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</span>}
        <span className="flex-1" />
        <BotonesSeccion editando={editando} cambios={cambio ? 1 : 0} guardando={guardando}
          onEditar={empezar} onCancelar={() => { setEditando(false); setMsg(null); }} onGuardar={guardar} />
      </div>
    </section>
  );
}

// =====================================================================
// 1902 · FONDO DE LIQUIDEZ (metodología COSEDE)
// =====================================================================

type VistaFondo = "resumen" | "aporte" | "rendimiento";

/** Cifras del rendimiento del fideicomiso que comparten la tabla y la metodología. */
function cifrasRendimiento(d: Datos) {
  const info = d.fondoLiquidezInfo;
  const fl = d.fondoLiquidez1902;
  const rend0 = info.rendimientosCorte ?? 0;
  const mes = (info.rendimientoPorMes ?? Array(12).fill(0)) as number[];
  const acum1902: number[] = [];
  mes.reduce((a, v, i) => (acum1902[i] = a + v), rend0);
  // valor sobre el que se calcula cada mes: 1902 al corte + lo ya ganado en el año (no baja con el reintegro)
  const base = mes.map((v, i) => info.saldo1902Corte + acum1902[i] - v - rend0);
  const tasa = mes.map((v, i) => (base[i] > 0 ? (v * 12) / base[i] : 0));
  const anio: number[] = [];
  mes.reduce((a, v, i) => (anio[i] = a + v), 0);
  const saldoFin = fl.map((f, i) => f.saldoFinal + acum1902[i]);
  const saldoIni = fl.map((_, i) => (i === 0 ? info.saldo1902Corte : saldoFin[i - 1]));
  return { rend0, mes, acum1902, base, tasa, anio, saldoFin, saldoIni };
}

function MovimientoFondo({ d, corte, agencia }: { d: Datos; corte: string | null; agencia: string }) {
  const [vista, setVista] = useState<VistaFondo>("resumen");
  const [verMetodo, setVerMetodo] = useState(false);
  const [metodo, setMetodo] = useState<"aporte" | "rendimiento">("aporte");
  const cambiarVista = (v: VistaFondo) => { setVista(v); if (v !== "resumen") setMetodo(v); };
  const fl = d.fondoLiquidez1902;
  const info = d.fondoLiquidezInfo;
  const de = corte ?? "el corte";
  const oblig = fl.map((f) => f.obligacionesFinMes);
  const captaciones = oblig.map((v) => v - info.otras21);
  const r = cifrasRendimiento(d);
  const aj = fl.map((f) => f.ajuste);

  const resumen: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: r.saldoIni, total: r.saldoIni[0],
      formula: (i) => (i === 0 ? `Saldo de la 1902 en el balance a ${de}: aportes ${usd(info.aportesCorte ?? 0)} + rendimientos ${usd(r.rend0)} = ${usd(info.saldo1902Corte)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(r.saldoIni[i])}.`) },
    { id: "aj", label: "(+/−) Aporte adicional o reintegro", valores: aj, total: suma(aj), signo: true,
      formula: (i) => `Vista Aporte: ${usd(aj[i])}. Positivo sale de caja; negativo es un reintegro que entra a caja.` },
    { id: "rm", label: "(+) Rendimiento del mes", valores: r.mes, total: suma(r.mes),
      formula: (i) => `Vista Rendimiento: ${usd(r.mes[i])}. Ingreso del Estado de resultados que se queda en el fondo (no es efectivo).` },
    { id: "sf", label: "Saldo final", valores: r.saldoFin, total: r.saldoFin[11], clave: true,
      formula: (i) => `${usd(r.saldoIni[i])} ${aj[i] < 0 ? "−" : "+"} ${usd(Math.abs(aj[i]))} + ${usd(r.mes[i])} = ${usd(r.saldoFin[i])}. Llega al Balance.` },
    { id: "ap", label: "Aportes al fondo", valores: fl.map((f) => f.saldoFinal), total: fl[11].saldoFinal, tenue: true, separador: true,
      formula: (i) => `Saldo final de la vista Aporte: ${usd(fl[i].saldoFinal)}.` },
    { id: "re", label: "Rendimientos acumulados", valores: r.acum1902, total: r.acum1902[11], tenue: true,
      formula: (i) => `Rendimientos al corte ${usd(r.rend0)} + los de ${ejercicioEnUso()} hasta ${MESES[i]} ${usd(r.anio[i])} = ${usd(r.acum1902[i])}.` },
  ];

  const aporte: DefFila[] = [
    { id: "obl", label: "Obligaciones con el público", valores: oblig, total: oblig[11],
      formula: (i) => `Captaciones proyectadas (vista + crecer + plazo fijo) + otras cuentas del grupo 21 que se mantienen en su saldo a ${de} = ${usd(captaciones[i])} + ${usd(info.otras21)} = ${usd(oblig[i])}.` },
    { id: "prom", label: "Promedio base · paso 1", valores: fl.map((f) => f.promedioObligacionesAprox), total: null,
      formula: (i) => i === 0
        ? `Enero usa el grupo 21 del balance a ${de}: ${usd(info.obligacionesCorte)}. Solo hay saldos de fin de mes, así que el promedio diario se aproxima con los meses anteriores.`
        : i === 1
          ? `(Grupo 21 a ${de} + cierre de enero) ÷ 2 = (${usd(info.obligacionesCorte)} + ${usd(oblig[0])}) ÷ 2 = ${usd(fl[1].promedioObligacionesAprox)}.`
          : `(Cierre de ${MESES[i - 2]} + cierre de ${MESES[i - 1]}) ÷ 2 = (${usd(oblig[i - 2])} + ${usd(oblig[i - 1])}) ÷ 2 = ${usd(fl[i].promedioObligacionesAprox)}.` },
    { id: "pct", label: "% aplicado", valores: fl.map((f) => f.pctAplicado), total: suma(fl.map((f) => f.pctAplicado)) / 12, esPct: true, tenue: true,
      formula: (i) => fl[i].pctVigente > info.meta
        ? `El % escrito (${pct(fl[i].pctVigente)}) supera la meta de la metodología: se aplica el tope de ${pct(info.meta)}.`
        : `% vigente ${pct(fl[i].pctVigente)} (el mismo para todas las cooperativas; sube 0,5 puntos cada enero hasta la meta de ${pct(info.meta)}). Se edita arriba.` },
    { id: "req", label: "Aporte requerido · paso 2", valores: fl.map((f) => f.aporteMensualActual), total: fl[11].aporteMensualActual, clave: true,
      formula: (i) => `Promedio base × % aplicado = ${usd(fl[i].promedioObligacionesAprox)} × ${pct(fl[i].pctAplicado)} = ${usd(fl[i].aporteMensualActual)}.` },
    { id: "si", label: "Saldo inicial de aportes", valores: fl.map((f) => f.saldoInicial), total: fl[0].saldoInicial, separador: true,
      formula: (i) => (i === 0 ? `Enero arranca con los aportes al fondo (19028601) en el balance a ${de}: ${usd(info.aportesCorte ?? info.saldo1902Corte)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(fl[i].saldoInicial)}.`) },
    { id: "aj", label: "(+/−) Aporte adicional o reintegro · paso 3", valores: aj, total: suma(aj), signo: true,
      formula: (i) => (i === 0
        ? `Aporte requerido de enero − aportes al fondo (19028601) a ${de} = ${usd(fl[0].aporteMensualActual)} − ${usd(info.aportesCorte ?? info.saldo1902Corte)} = ${usd(fl[0].ajuste)}.`
        : `Aporte requerido de ${MESES[i]} − aporte requerido de ${MESES[i - 1]} = ${usd(fl[i].aporteMensualActual)} − ${usd(fl[i - 1].aporteMensualActual)} = ${usd(fl[i].ajuste)}.`)
        + ` Positivo = aporte adicional (sale de caja); negativo = reintegro (entra a caja). Llega al Flujo como "Aportes al Fondo de Liquidez".` },
    { id: "sf", label: "Saldo final de aportes · paso 4", valores: fl.map((f) => f.saldoFinal), total: fl[11].saldoFinal, clave: true,
      formula: (i) => `Saldo inicial + aporte o reintegro = ${usd(fl[i].saldoInicial)} ${fl[i].ajuste < 0 ? "−" : "+"} ${usd(Math.abs(fl[i].ajuste))} = ${usd(fl[i].saldoFinal)}.` },
  ];

  const rendimiento: DefFila[] = [
    { id: "base", label: "Valor del fondo · paso 1", valores: r.base, total: null,
      formula: (i) => i === 0
        ? `Saldo de la 1902 a ${de} (aportes + rendimientos): ${usd(info.saldo1902Corte)}.`
        : `Saldo 1902 a ${de} + rendimientos ganados en ${ejercicioEnUso()} hasta ${MESES[i - 1]} = ${usd(info.saldo1902Corte)} + ${usd(r.anio[i - 1])} = ${usd(r.base[i])}.` },
    { id: "tasa", label: "Tasa anual", valores: r.tasa, total: suma(r.tasa) / 12, esPct: true, tenue: true,
      formula: () => info.rendimiento?.guardada ? "Tasa escrita arriba para la agencia." : `Tasa real del año a ${de}: rendimiento acumulado ÷ meses × 12 ÷ saldo 1902. Se edita arriba.` },
    { id: "rm", label: "Rendimiento del mes · paso 2", valores: r.mes, total: suma(r.mes), clave: true,
      formula: (i) => `Valor del fondo × tasa anual ÷ 12 = ${usd(r.base[i])} × ${pct(r.tasa[i])} ÷ 12 = ${usd(r.mes[i])}. Llega al Estado de resultados (53040505).` },
    { id: "anio", label: "Acumulado del año", valores: r.anio, total: r.anio[11], tenue: true,
      formula: (i) => `Suma de enero a ${MESES[i]}: ${usd(r.anio[i])}. Es la cifra acumulada que reporta el BCE y la del Estado de resultados.` },
  ];

  const vistas: [VistaFondo, string][] = [["resumen", "Fondo de liquidez"], ["aporte", "Aporte"], ["rendimiento", "Rendimiento"]];
  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex items-end gap-2 px-4 min-h-[52px]" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div role="tablist" aria-label="Vista del fondo" className="flex gap-6 flex-1">
          {vistas.map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={vista === id} onClick={() => cambiarVista(id)} className="pb-3 pt-4 -mb-px text-[13px]"
              style={{ color: vista === id ? C.texto : C.texto2, fontWeight: vista === id ? 600 : 400, borderBottom: `2px solid ${vista === id ? C.acento : "transparent"}` }}>{l}</button>
          ))}
        </div>
        <button type="button" onClick={() => setVerMetodo((v) => !v)} aria-expanded={verMetodo}
                className="self-center h-8 px-3 rounded-lg text-[12.5px] font-medium flex items-center gap-1.5"
                style={verMetodo ? { background: C.acentoSuave, color: C.acento, border: `1px solid ${BORDE_EDICION}` } : { background: "#FFFFFF", color: C.acento, border: "1px solid #C9D0CC" }}>
          <BookOpen size={15} /> Metodología
        </button>
      </div>
      {verMetodo && (() => {
        const selector = (
          <BotonesVista etiqueta="Metodología" valor={metodo} onChange={setMetodo}
            opciones={[{ id: "aporte", label: "Cálculo del aporte" }, { id: "rendimiento", label: "Rendimiento" }]} />
        );
        return metodo === "rendimiento"
          ? <MetodologiaRendimiento d={d} corte={corte} agencia={agencia} selector={selector} onCerrar={() => setVerMetodo(false)} />
          : <MetodologiaFondo d={d} corte={corte} agencia={agencia} selector={selector} onCerrar={() => setVerMetodo(false)} />;
      })()}
      {vista === "resumen" && <TablaMeses titulo="Cuenta 1902" ultima="Año" filas={resumen} />}
      {vista === "aporte" && <TablaMeses titulo="Aporte" ultima="Año" filas={aporte} />}
      {vista === "rendimiento" && <TablaMeses titulo="Rendimiento" ultima="Año" filas={rendimiento} />}
    </section>
  );
}

// =====================================================================
// METODOLOGÍA DEL RENDIMIENTO DEL FIDEICOMISO (53040505)
// =====================================================================

function MetodologiaRendimiento({ d, corte, agencia, selector, onCerrar }: { d: Datos; corte: string | null; agencia: string; selector?: ReactNode; onCerrar: () => void }) {
  const [mes, setMes] = useState(0);
  const info = d.fondoLiquidezInfo;
  const r = cifrasRendimiento(d);
  const rr = info.rendimiento ?? null;
  const de = corte ?? "el corte";
  const mesesCorte = d.corte?.mes ?? 12;
  const acum = rr?.acumuladoCorte ?? null;
  const base = rr?.base1902 ?? info.saldo1902Corte;
  const real = acum !== null && base > 0 ? (acum / mesesCorte) * 12 / base : null;
  const nombreMes = MESES_LARGOS[mes];
  const f = d.fondoLiquidez1902[mes];
  return (
    <div style={{ borderBottom: `1px solid ${C.borde}` }}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ background: C.acentoSuave }}>
        <BookOpen size={17} color={C.acento} />
        <b className="text-[14px]" style={{ color: C.acento }}>Metodología · {agencia}</b>
        {selector}
        <span className="flex-1" />
        <span className="text-[12px]" style={{ color: C.texto2 }}>Ver el ejemplo de</span>
        <ChipsMes valor={mes} onChange={setMes} />
        <button type="button" onClick={onCerrar} aria-label="Cerrar metodología" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white"><X size={16} color={C.texto2} /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div className="px-5 py-4 flex flex-col gap-1.5">
          <b className="text-[13px]">¿Qué es el rendimiento?</b>
          <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
            Los recursos del Fondo de liquidez se invierten y generan rendimientos que pertenecen a cada cooperativa. Cada mes el Banco Central informa el
            reintegro y el <b>rendimiento acumulado</b>; contabilidad registra la diferencia del mes como ingreso en la <b>53040505</b> contra la 1902.
            El dinero no llega a caja: se queda en el fondo y hace crecer la 1902.
          </p>
        </div>
        <div className="px-5 py-4 flex flex-col gap-1.5 lg:border-l" style={{ borderColor: C.beige }}>
          <b className="text-[13px]">¿De dónde sale la tasa?</b>
          <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
            {rr?.guardada
              ? <>Se usa la tasa escrita para la agencia: <b>{pct(rr.tasa)}</b>. Con “Usar la real” vuelve a la del año.</>
              : <>Es la tasa real del año: el rendimiento acumulado al corte se lleva a un año y se divide para el saldo de la 1902.
                  Se actualiza sola con cada balance que se carga; también se puede escribir arriba.</>}
          </p>
          {real !== null && acum !== null && (
            <div className="flex flex-col gap-1 mt-1">
              <Linea concepto={`Rendimiento acumulado a ${de} (530405)`} valor={usd(acum)} />
              <Linea signo="÷" concepto={`Meses transcurridos`} valor={String(mesesCorte)} />
              <Linea signo="×" concepto="Meses del año" valor="12" />
              <Linea signo="÷" concepto={`Saldo 1902 a ${de}`} valor={usd(base)} />
              <Linea concepto="Tasa anual real" valor={pct(real)} total />
            </div>
          )}
        </div>
      </div>

      <PasoMetodo n={1} titulo="Valor del fondo"
        regla={<>Es el <b>saldo de la 1902 al corte</b> (aportes + rendimientos) más los rendimientos que se van ganando en el año, porque se capitalizan:
          el rendimiento de un mes también rinde en los siguientes.</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto={`Saldo 1902 a ${de}`} valor={usd(info.saldo1902Corte)} />
        <Linea signo="+" concepto={mes === 0 ? "Rendimientos ya ganados en el año" : `Rendimientos de enero a ${MESES_LARGOS[mes - 1]}`} valor={usd(mes === 0 ? 0 : r.anio[mes - 1])} />
        <Linea concepto={`Valor del fondo para ${nombreMes}`} valor={usd(r.base[mes])} total />
      </PasoMetodo>

      <PasoMetodo n={2} titulo="Rendimiento del mes"
        regla={<><b>Rendimiento = valor del fondo × tasa anual ÷ 12.</b> Llega al Estado de resultados en la 53040505 (Utilidades financieras).</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto="Valor del fondo (paso 1)" valor={usd(r.base[mes])} />
        <Linea signo="×" concepto="Tasa anual" valor={pct(r.tasa[mes])} />
        <Linea signo="÷" concepto="Meses del año" valor="12" />
        <Linea concepto={`Rendimiento de ${nombreMes}`} valor={usd(r.mes[mes])} total />
      </PasoMetodo>

      <PasoMetodo n={3} titulo="Registro contable y efecto en los estados" ultimo
        regla={<>Débito 1902 (rendimientos del fideicomiso) · Crédito 53040505. Sube el activo y la utilidad por el mismo valor; el Flujo de efectivo
          no cambia porque el dinero sigue en el fondo. El saldo de la 1902 suma el aporte o reintegro del mes y el rendimiento.</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto={mes === 0 ? `Saldo 1902 a ${de}` : `Saldo 1902 al cierre de ${MESES_LARGOS[mes - 1]}`} valor={usd(r.saldoIni[mes])} />
        <Linea signo={f.ajuste >= 0 ? "+" : "−"} concepto={f.ajuste >= 0 ? "Aporte adicional" : "Reintegro"} valor={usd(Math.abs(f.ajuste))} />
        <Linea signo="+" concepto="Rendimiento del mes (paso 2)" valor={usd(r.mes[mes])} />
        <Linea concepto={`Saldo 1902 al cierre de ${nombreMes}`} valor={usd(r.saldoFin[mes])} total />
      </PasoMetodo>
    </div>
  );
}

// =====================================================================
// METODOLOGÍA DEL APORTE AL FONDO DE LIQUIDEZ (explicación con los datos de la agencia)
// =====================================================================

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Un paso: a la izquierda lo que dice la metodología; a la derecha el cálculo con las cifras de la herramienta. */
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
      <span className="tabla-cifras whitespace-nowrap" style={{ fontFamily: "Tahoma, 'Segoe UI', sans-serif" }}>{valor}</span>
    </div>
  );
}

function MetodologiaFondo({ d, corte, agencia, selector, onCerrar }: { d: Datos; corte: string | null; agencia: string; selector?: ReactNode; onCerrar: () => void }) {
  const [mes, setMes] = useState(0);
  const fl = d.fondoLiquidez1902;
  const info = d.fondoLiquidezInfo;
  const f = fl[mes];
  const de = corte ?? "el corte";
  const oblig = fl.map((x) => x.obligacionesFinMes);
  const captacionesMes = (i: number) => oblig[i] - info.otras21;
  const nombreMes = MESES_LARGOS[mes];
  const anterior = mes === 0 ? null : fl[mes - 1];
  const aporteAnterior = mes === 0 ? (info.aportesCorte ?? info.saldo1902Corte) : anterior!.aporteMensualActual;
  const pctTxt = (v: number) => pct(v);
  const tope = f.pctVigente > info.meta;

  return (
    <div style={{ borderBottom: `1px solid ${C.borde}` }}>
      {/* Encabezado del panel */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ background: C.acentoSuave }}>
        <BookOpen size={17} color={C.acento} />
        <b className="text-[14px]" style={{ color: C.acento }}>Metodología · {agencia}</b>
        {selector}
        <span className="flex-1" />
        <span className="text-[12px]" style={{ color: C.texto2 }}>Ver el ejemplo de</span>
        <ChipsMes valor={mes} onChange={setMes} />
        <button type="button" onClick={onCerrar} aria-label="Cerrar metodología" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white"><X size={16} color={C.texto2} /></button>
      </div>

      {/* Qué es y de dónde sale el % */}
      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <div className="px-5 py-4 flex flex-col gap-1.5">
          <b className="text-[13px]">¿Qué es el aporte?</b>
          <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
            Cada cooperativa aporta al Fondo de Liquidez del sector financiero popular y solidario (fideicomiso administrado por COSEDE) un porcentaje de sus
            obligaciones con el público. El dinero aportado es de la cooperativa: se registra como <b>derechos fiduciarios en la cuenta 1902</b>.
            Cada mes el aporte se ajusta: si la base crece, se aporta la diferencia (sale de caja); si baja, se recibe un reintegro (entra a caja).
          </p>
        </div>
        <div className="px-5 py-4 flex flex-col gap-1.5 lg:border-l" style={{ borderColor: C.beige }}>
          <b className="text-[13px]">¿De dónde sale el %?</b>
          <p className="text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
            No lo calcula la cooperativa: lo fija la Junta de Política y Regulación Financiera (Resolución 176-2015-F y sus reformas) y es el mismo para todas las
            cooperativas del segmento. Sube 0,5 puntos cada enero hasta la meta de <b>{pctTxt(info.meta)}</b>. En la herramienta es editable en la tabla de
            Parámetros (hoy {pctTxt(f.pctVigente)} en {nombreMes}); conviene verificarlo con la resolución vigente.
          </p>
        </div>
      </div>

      <PasoMetodo n={1} titulo="Base: promedio de las obligaciones con el público"
        regla={<>La base es el <b>promedio de las obligaciones con el público (grupo 21)</b>. Como el presupuesto solo tiene saldos de fin de mes, el promedio se
          aproxima con los <b>dos cierres anteriores</b>: enero usa el saldo del balance al corte; febrero, el corte y enero; desde marzo, los dos meses previos.
          Cada cierre = captaciones proyectadas + las demás cuentas del 21 (fijas en su saldo del corte).</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        {mes === 0 ? (
          <Linea concepto={`Grupo 21 en el balance a ${de}`} valor={usd(info.obligacionesCorte)} total />
        ) : mes === 1 ? (
          <>
            <Linea concepto={`Grupo 21 en el balance a ${de}`} valor={usd(info.obligacionesCorte)} />
            <Linea signo="+" concepto={`Cierre de enero (captaciones ${usd(captacionesMes(0))} + otras del 21 ${usd(info.otras21)})`} valor={usd(oblig[0])} />
            <Linea signo="÷" concepto="Entre 2" valor="2" />
            <Linea concepto="Promedio base de febrero" valor={usd(f.promedioObligacionesAprox)} total />
          </>
        ) : (
          <>
            <Linea concepto={`Cierre de ${MESES_LARGOS[mes - 2]} (captaciones ${usd(captacionesMes(mes - 2))} + otras del 21 ${usd(info.otras21)})`} valor={usd(oblig[mes - 2])} />
            <Linea signo="+" concepto={`Cierre de ${MESES_LARGOS[mes - 1]} (captaciones ${usd(captacionesMes(mes - 1))} + otras del 21 ${usd(info.otras21)})`} valor={usd(oblig[mes - 1])} />
            <Linea signo="÷" concepto="Entre 2" valor="2" />
            <Linea concepto={`Promedio base de ${nombreMes}`} valor={usd(f.promedioObligacionesAprox)} total />
          </>
        )}
      </PasoMetodo>

      <PasoMetodo n={2} titulo="Aporte requerido del mes"
        regla={<><b>Aporte requerido = promedio base × % aplicado.</b> El % aplicado es el % vigente escrito en Parámetros, con tope en la meta de {pctTxt(info.meta)}.</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto="Promedio base (paso 1)" valor={usd(f.promedioObligacionesAprox)} />
        <Linea signo="×" concepto={tope ? `% aplicado (el vigente ${pctTxt(f.pctVigente)} supera la meta: se usa el tope)` : "% aplicado (vigente)"} valor={pctTxt(f.pctAplicado)} />
        <Linea concepto={`Aporte requerido de ${nombreMes}`} valor={usd(f.aporteMensualActual)} total />
      </PasoMetodo>

      <PasoMetodo n={3} titulo="Ajuste del mes: aporte adicional o reintegro"
        regla={<><b>Ajuste = aporte requerido del mes − aporte requerido del mes anterior.</b> Positivo: aporte adicional (sale de caja). Negativo: reintegro
          (entra a caja). En enero se compara con los <b>aportes al fondo al corte (19028601)</b>, sin los rendimientos del fideicomiso. Este valor llega al
          Flujo de efectivo como “Aportes al Fondo de Liquidez”.</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto={`Aporte requerido de ${nombreMes} (paso 2)`} valor={usd(f.aporteMensualActual)} />
        <Linea signo="−" concepto={mes === 0 ? `Aportes al fondo (19028601) a ${de}` : `Aporte requerido de ${MESES_LARGOS[mes - 1]}`} valor={usd(aporteAnterior)} />
        <Linea concepto={f.ajuste >= 0 ? "Aporte adicional (sale de caja)" : "Reintegro (entra a caja)"} valor={usd(f.ajuste)} total />
      </PasoMetodo>

      <PasoMetodo n={4} titulo="Registro contable: aportes en la 19028601" ultimo
        regla={<><b>Saldo final = saldo inicial + ajuste del mes.</b> Es lo aportado por la cooperativa al fideicomiso. La cuenta 1902 suma además los
          rendimientos del fideicomiso (vista Rendimiento). Cada agencia registra su propio aporte con su propia base.</>}>
        <span className="text-[12px] font-semibold mb-1" style={{ color: C.acento }}>Ejemplo · {nombreMes}</span>
        <Linea concepto={mes === 0 ? `Saldo inicial (19028601 a ${de})` : `Saldo inicial (cierre de ${MESES_LARGOS[mes - 1]})`} valor={usd(f.saldoInicial)} />
        <Linea signo={f.ajuste >= 0 ? "+" : "−"} concepto={f.ajuste >= 0 ? "Aporte adicional (paso 3)" : "Reintegro (paso 3)"} valor={usd(Math.abs(f.ajuste))} />
        <Linea concepto={`Aportes 19028601 al cierre de ${nombreMes}`} valor={usd(f.saldoFinal)} total />
      </PasoMetodo>
    </div>
  );
}

// =====================================================================
// 1904 · 1906 · 1908 · 16 (saldo ± movimientos)
// =====================================================================

const CUENTA_INFO: Record<"1904" | "1906" | "1908", { titulo: string; cuentas: string; entra: string; sale?: string }> = {
  "1904": { titulo: "Gastos y pagos anticipados", cuentas: "1904 + 1905", entra: "(+) Nuevos pagos anticipados", sale: "(−) Amortización del mes" },
  "1906": { titulo: "Materiales, mercaderías e insumos", cuentas: "1906", entra: "(+) Nuevas adquisiciones", sale: "(−) Consumo del mes" },
  "1908": { titulo: "Transferencias internas", cuentas: "1908", entra: "(+) Fondos remitidos a otras agencias", sale: "(−) Fondos devueltos por las agencias" },
};

function MovimientoCuenta({ pestana, d, corte }: { pestana: "1904" | "1906" | "1908"; d: Datos; corte: string | null }) {
  const info = CUENTA_INFO[pestana];
  const rf = pestana === "1904" ? d.gastosAnticipados1904 : pestana === "1906" ? d.materiales1906 : d.transferencias1908;
  const si = rf.map((f) => f.saldoInicio);
  const ent = rf.map((f) => f.entradas);
  const sal = rf.map((f) => f.salidas);
  const origen = `saldo del balance${corte ? ` a ${corte}` : ""} (cuenta ${info.cuentas})`;
  const filas: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: si, total: si[0],
      formula: (i) => (i === 0 ? `Enero arranca con el ${origen}: ${usd(si[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    info.sale
      ? { id: "ent", label: info.entra, valores: ent, total: suma(ent), color: "ok", formula: (i) => `Valor escrito arriba para ${MESES[i]}: ${usd(ent[i])}.` }
      : { id: "ent", label: info.entra, valores: ent, total: suma(ent), signo: true, formula: (i) => `Valor escrito arriba para ${MESES[i]}: ${usd(ent[i])}. Positivo sube el saldo; negativo lo baja.` },
    ...(info.sale ? [{ id: "sal", label: info.sale, valores: sal.map((v) => -v), total: -suma(sal), color: "alerta" as const,
      formula: (i: number) => `Valor escrito arriba para ${MESES[i]}: ${usd(sal[i])}.` }] : []),
    { id: "sf", label: "Saldo final", valores: rf.map((f) => f.saldoFin), total: rf[11].saldoFin, clave: true,
      formula: (i) => info.sale
        ? `Saldo inicial + entradas − salidas = ${usd(si[i])} + ${usd(ent[i])} − ${usd(sal[i])} = ${usd(rf[i].saldoFin)}.`
        : `Saldo inicial ± variación = ${usd(si[i])} ${ent[i] < 0 ? "−" : "+"} ${usd(Math.abs(ent[i]))} = ${usd(rf[i].saldoFin)}.` },
  ];
  return (
    <Tarjeta titulo={`Movimiento del saldo · ${info.titulo} (${info.cuentas})`}>
      <TablaMeses key={pestana} titulo={info.titulo} ultima="Total año" filas={filas} />
    </Tarjeta>
  );
}

// =====================================================================
// 1901 · INVERSIONES EN ACCIONES Y 1990 · OTROS (sin movimiento en el año)
// =====================================================================

function CuentaFija({ pestana, d, corte }: { pestana: "1901" | "1990"; d: Datos; corte: string | null }) {
  const cc = d.corteCuentas, r = d.resumen19, de = corte ? ` a ${corte}` : "";
  const filas: DefFila[] = pestana === "1901" ? [
    { id: "si", label: "Saldo inicial", valores: r.map(() => cc.c1901), total: cc.c1901, formula: () => `Saldo de la 1901 en el balance${de}: ${usd(cc.c1901)}.` },
    { id: "sf", label: "Saldo final · 1901", valores: r.map((x) => x.c1901), total: r[11].c1901, clave: true, formula: () => `Sin compras ni ventas de acciones en el año: el saldo se mantiene en ${usd(cc.c1901)}. Llega al Balance.` },
  ] : [
    { id: "1990", label: "1990 · Otros", valores: r.map((x) => x.c1990), total: r[11].c1990, formula: () => `Sin movimiento en el año: se mantiene en el saldo del balance${de} = ${usd(cc.c1990)}.` },
    { id: "1999", label: "1999 · (−) Provisión otros activos", valores: r.map((x) => x.c1999), total: r[11].c1999, formula: () => `Sin movimiento en el año: se mantiene en el saldo del balance${de} = ${usd(cc.c1999)}.` },
    { id: "neto", label: "Otros, neto de provisión", valores: r.map((x) => x.c1990 + x.c1999), total: r[11].c1990 + r[11].c1999, clave: true,
      formula: (i) => `1990 + 1999 = ${usd(r[i].c1990)} ${r[i].c1999 < 0 ? "−" : "+"} ${usd(Math.abs(r[i].c1999))} = ${usd(r[i].c1990 + r[i].c1999)}. Llega al Balance.` },
  ];
  const subs = (d.subcuentas ?? []).filter((x) => (pestana === "1901" ? /^1901/ : /^(1990|1999)/).test(x.codigo));
  const fin = pestana === "1901" ? r[11].c1901 : r[11].c1990 + r[11].c1999;
  const nombre = (t: string) => (t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t);
  return (
    <div className="flex flex-col gap-5 pb-6">
      <FranjaIndicadores>
        <Indicador titulo={`${pestana === "1901" ? "1901" : "1990 + 1999"} dic-${ejercicioEnUso()}`} valor={usd(fin)} pie={`Igual que al corte${corte ? ` (${corte})` : ""}`} />
        {pestana === "1901"
          ? <Indicador titulo={`Movimiento ${ejercicioEnUso()}`} valor={usd(0)} pie="Sin compras ni ventas de acciones" />
          : <><Indicador titulo="1990 · Otros" valor={usd(cc.c1990)} pie="Saldo del balance" /><Indicador titulo="1999 · Provisión" valor={usd(cc.c1999)} pie="Saldo del balance" /></>}
      </FranjaIndicadores>
      <Tarjeta titulo={pestana === "1901" ? "Inversiones en acciones (1901)" : "Otros (1990) y provisión (1999)"}>
        <TablaMeses titulo="Cuenta" ultima="Año / Dic" filas={filas} />
      </Tarjeta>
      {subs.length > 0 && (
        <Tarjeta titulo={`Composición${de}`}>
          <table className="w-full text-[12px] border-collapse">
            <thead><tr style={{ color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
              <th className="pl-4 text-left font-semibold">Cuenta</th><th className="pr-4 text-right font-semibold w-[160px]">Saldo</th>
            </tr></thead>
            <tbody>
              {subs.map((x) => (
                <tr key={x.codigo} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
                  <td className="pl-4"><span style={{ color: C.tenue }}>{x.codigo}</span> <span style={{ color: C.texto3 }}>{nombre(x.nombre)}</span></td>
                  <td className="pr-4 text-right">{usd(x.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </div>
  );
}

