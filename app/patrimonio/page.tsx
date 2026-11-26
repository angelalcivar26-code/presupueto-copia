"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { leerMonto } from "../../lib/numeros";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useState } from "react";
import { Download, Pencil, ArrowRight, AlertTriangle } from "lucide-react";
import { EsqueletoTabla } from "../../components/Carga";
import {
  MESES, AGENCIAS as AGENCIAS_BASE, C, FONDO, BORDE_EDICION, suma, numero, usd, etiquetaCorte,
  TABLA, Columnas, Cabecera, BotonesSeccion, BotonF, Indicador, FranjaIndicadores, Tarjeta, TablaMeses,
  type DefFila,
} from "../../components/ActivosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

const AGENCIAS = [...AGENCIAS_BASE, "Consolidado"];

/**
 * PATRIMONIO (grupo 3). Estilo institucional (mismo de Cartera, Activos y Obligaciones).
 * Los cálculos no cambian: /api/patrimonio-detalle y parámetros en /api/otros-pasivo-parametros.
 */

// =====================================================================
// CAPITAL SOCIAL: parámetros (tabla otros_pasivo_parametros, un concepto por fila)
// =====================================================================

type Concepto = "capital_social_monto_aporte" | "capital_social_socios_nuevos" | "capital_social_socios_retirados" | "capital_social_devolucion_promedio" | "capital_social_capitalizacion_dividendos";
interface DefCampo { key: Concepto; label: string; usd: boolean; total: "promedio" | "suma" }
const CAMPOS: DefCampo[] = [
  { key: "capital_social_monto_aporte", label: "Aporte obligatorio por socio ($)", usd: true, total: "promedio" },
  { key: "capital_social_socios_nuevos", label: "Socios nuevos", usd: false, total: "suma" },
  { key: "capital_social_socios_retirados", label: "Socios retirados", usd: false, total: "suma" },
  { key: "capital_social_devolucion_promedio", label: "Devolución por retiro ($)", usd: true, total: "promedio" },
  { key: "capital_social_capitalizacion_dividendos", label: "Capitalización de dividendos ($)", usd: true, total: "suma" },
];
const SOCIOS_INICIAL = "capital_social_socios_inicial";
type Origen = "guardado" | "referencia" | "sin dato" | "estimado";
const DEVOLUCION: Concepto = "capital_social_devolucion_promedio";
interface Params { valores: Record<Concepto, number[]>; sociosInicial: number }

interface MesCapital { mes: number; saldoInicio: number; incrementos: number; retiros: number; capitalizacionDividendos: number; saldoFin: number; sociosTotal: number }
interface Datos {
  capitalSocial31: MesCapital[]; saldoReservas33: number; saldoOtrosAportes34: number; saldoSuperavit35: number; resultados36PorMes: number[];
  otrosAportes34PorMes?: number[]; superavit35PorMes?: number[];
  donacionesEfectivoPorMes?: number[]; revaluoTerrenosPorMes?: number[]; revaluoEdificiosPorMes?: number[];
  corte?: { anio: number; mes: number }; ajusteCierre?: number; saldo36Corte?: number; saldo31Corte?: number;
  parametrosUsados?: Record<string, { valores: number[]; origen: Origen }>;
  error?: string;
}
type Pestana = "resumen" | "capital" | "otras";
const cero12 = () => Array(12).fill(0) as number[];
/** Saldos mes a mes de 34 y 35 (con movimientos); si la ruta es antigua, el saldo fijo del balance. */
const s34 = (d: Datos) => d.otrosAportes34PorMes ?? Array(12).fill(d.saldoOtrosAportes34);
const s35 = (d: Datos) => d.superavit35PorMes ?? Array(12).fill(d.saldoSuperavit35);

const mostrarValor = (usdCampo: boolean, v: number) =>
  usdCampo ? v.toLocaleString("es-EC", { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("es-EC");
const clonar = (p: Params): Params => ({ sociosInicial: p.sociosInicial, valores: Object.fromEntries(CAMPOS.map((c) => [c.key, [...p.valores[c.key]]])) as Record<Concepto, number[]> });

// =====================================================================
// PÁGINA
// =====================================================================

export default function PatrimonioPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const [origen, setOrigen] = useState<Origen>("guardado");
  const [origenDev, setOrigenDev] = useState<Origen>("guardado");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Params | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const url = `/api/patrimonio-detalle?agencia=${encodeURIComponent(agencia)}`;
  const consolidado = agencia === "Consolidado";

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    setCargando(true);
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((d: Datos) => {
        if (!vivo) return;
        if (d.error || !d.capitalSocial31) { setError(d.error ?? "No se pudo calcular el patrimonio."); return; }
        setDatos(d);
        // Se muestran los parámetros que de verdad usó el motor (guardados o, en Matriz, la referencia)
        const u = d.parametrosUsados ?? {};
        const val = (k: string) => (u[k]?.valores ?? Array(12).fill(0)).map((x) => Number(x) || 0);
        setParams({ valores: Object.fromEntries(CAMPOS.map((c) => [c.key, val(c.key)])) as Record<Concepto, number[]>, sociosInicial: val(SOCIOS_INICIAL)[0] });
        const origenes = [...CAMPOS.filter((c) => c.key !== DEVOLUCION).map((c) => u[c.key]?.origen), u[SOCIOS_INICIAL]?.origen];
        setOrigenDev(u[DEVOLUCION]?.origen ?? "estimado");
        setOrigen(origenes.includes("referencia") ? "referencia" : origenes.every((o) => o === "sin dato") ? "sin dato" : "guardado");
      })
      .catch(() => { if (vivo) setError("Error de conexión al cargar el patrimonio."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [url, version]);

  const cambios = editando && borrador && params
    ? (borrador.sociosInicial !== params.sociosInicial ? 1 : 0) +
      CAMPOS.reduce((n, c) => n + borrador.valores[c.key].filter((v, i) => Math.abs(v - params.valores[c.key][i]) > 1e-9).length, 0)
    : 0;

  function salirDeEdicion(): boolean {
    if (editando && cambios > 0 && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardar?")) return false;
    setEditando(false); setBorrador(null); setTextos({});
    return true;
  }
  function irA(t: Pestana) { if (t !== pestana && salirDeEdicion()) { setPestana(t); setMsg(null); } }
  function cambiarAgencia(a: string) { if (salirDeEdicion()) { setAgencia(a); setMsg(null); } }

  function escribir(clave: string, texto: string, aplicar: (v: number) => void) {
    setTextos((t) => ({ ...t, [clave]: texto }));
    const r = leerMonto(texto);
    if (!r.error && r.valor !== null) aplicar(r.valor);
  }
  function setMes(c: Concepto, i: number, v: number) {
    setBorrador((b) => (b ? { ...b, valores: { ...b.valores, [c]: b.valores[c].map((x, k) => (k === i ? v : x)) } } : b));
  }
  function copiarEnero(c: Concepto) {
    setBorrador((b) => (b ? { ...b, valores: { ...b.valores, [c]: Array(12).fill(b.valores[c][0]) } } : b));
    setTextos((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith(`${c}-`))));
  }

  async function guardar() {
    if (!borrador || !params) return;
    const malo = Object.entries(textos).find(([, t]) => leerMonto(t).error);
    if (malo) { setMsg({ t: `Revise la casilla con borde rojo: ${leerMonto(malo[1]).error}.`, e: true }); return; }
    // Validación antes de mandar a la base de datos
    for (const c of CAMPOS) {
      const malos = borrador.valores[c.key].map((v, i) => ({ v, i })).filter(({ v }) => v < 0 || (!c.usd && !Number.isInteger(v)));
      if (malos.length) { setMsg({ t: `${c.label}: revisa ${malos.map(({ i }) => MESES[i]).join(", ")} (${c.usd ? "no puede ser negativo" : "número entero de socios, sin negativos"}).`, e: true }); return; }
    }
    if (!Number.isInteger(borrador.sociosInicial) || borrador.sociosInicial < 0) { setMsg({ t: "Socios al inicio: número entero, sin negativos.", e: true }); return; }

    // Se guardan los conceptos que cambiaron; si los parámetros venían de la referencia, se guardan todos
    // para que desde ahora salgan de la base de datos.
    const aGuardar: { concepto: string; montosPorMes: number[] }[] = [];
    for (const c of CAMPOS) {
      const cambio = borrador.valores[c.key].some((v, i) => Math.abs(v - params.valores[c.key][i]) > 1e-9);
      // La devolución estimada no se congela: solo se guarda si la cambias
      if (cambio || (origen !== "guardado" && c.key !== DEVOLUCION)) aGuardar.push({ concepto: c.key, montosPorMes: borrador.valores[c.key] });
    }
    if (borrador.sociosInicial !== params.sociosInicial || origen !== "guardado") aGuardar.push({ concepto: SOCIOS_INICIAL, montosPorMes: Array(12).fill(borrador.sociosInicial) });

    setGuardando(true); setMsg(null);
    try {
      const respuestas = await Promise.all(aGuardar.map((g) => apiFetch("/api/otros-pasivo-parametros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, ejercicio: ejercicioEnUso(), ...g }),
      }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))));
      const fallo = respuestas.find((r) => !r.ok || r.d?.error);
      if (fallo) throw new Error(fallo.d?.error ?? "error al guardar");
      setEditando(false); setBorrador(null); setTextos({});
      setMsg({ t: "Parámetros guardados. Balance, Estado de resultados y Flujo ya usan los nuevos valores." });
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally {
      setGuardando(false);
    }
  }

  const corte = datos?.corte ? etiquetaCorte(datos.corte) : null;


  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      {/* Encabezado: título y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Patrimonio<AnioEjercicio /></h1>
        <button type="button" onClick={() => void exportarPantalla()} disabled={!datos} title="Exportar a Excel"
                className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50" style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Pestañas a la izquierda, agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones de patrimonio" className="flex gap-7 flex-1">
          {([{ id: "resumen" as Pestana, label: "Resumen" }, { id: "capital" as Pestana, label: "Capital social" }, { id: "otras" as Pestana, label: "Otras cuentas" }]).map((t) => {
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
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {/* Indicadores: solo en Resumen */}
      {pestana === "resumen" && datos && !cargando && <Indicadores datos={datos} />}

      {cargando ? (
        <EsqueletoTabla indicadores filas={6} />
      ) : error ? (
        <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      ) : !datos || !params ? null : pestana === "otras" ? (
        <OtrasCuentas soloLectura={consolidado} datos={datos} agencia={agencia} corte={corte} onGuardado={() => setVersion((v) => v + 1)} />
      ) : pestana === "resumen" ? (
        <Resumen datos={datos} corte={corte} onCapital={() => irA("capital")} onOtras={() => irA("otras")} />
      ) : (
        <CapitalSocial
          soloLectura={consolidado}
          datos={datos} p={editando && borrador ? borrador : params} origen={origen} origenDev={origenDev} corte={corte}
          editando={editando} cambios={cambios} guardando={guardando} textos={textos} msg={msg}
          onEditar={() => { setBorrador(clonar(params)); setTextos({}); setEditando(true); setMsg(null); }}
          onCancelar={() => { setEditando(false); setBorrador(null); setTextos({}); }}
          onGuardar={guardar}
          onEscribirMes={(c, i, t) => escribir(`${c}-${i}`, t, (v) => setMes(c, i, v))}
          onEscribirSocios={(t) => escribir("socios-inicial", t, (v) => setBorrador((b) => (b ? { ...b, sociosInicial: v } : b)))}
          onSoltar={(k) => setTextos((t) => { const n = { ...t }; delete n[k]; return n; })}
          onCopiarEnero={copiarEnero}
        />
      )}
    </div>
  );
}

function totalPatrimonio(d: Datos): number[] {
  const a34 = s34(d), a35 = s35(d);
  return MESES.map((_, i) => d.capitalSocial31[i].saldoFin + d.saldoReservas33 + a34[i] + a35[i] + d.resultados36PorMes[i]);
}

// =====================================================================
// INDICADORES
// =====================================================================

function Indicadores({ datos }: { datos: Datos }) {
  const tot = totalPatrimonio(datos);
  const cs = datos.capitalSocial31;
  const ini = cs[0].saldoInicio + datos.saldoReservas33 + datos.saldoOtrosAportes34 + datos.saldoSuperavit35 + (datos.saldo36Corte ?? 0);
  const varTot = tot[11] - ini;
  const varCs = cs[11].saldoFin - cs[0].saldoInicio;
  const resultadoAnio = datos.resultados36PorMes[11] - (datos.saldo36Corte ?? 0);
  return (
    <FranjaIndicadores>
      <Indicador titulo={`Patrimonio dic-${ejercicioEnUso()}`} valor={usd(tot[11])}
        pie={`${varTot >= 0 ? "Sube" : "Baja"} ${usd(Math.abs(varTot))} en el año`} />
      <Indicador titulo={`Capital social dic-${ejercicioEnUso()}`} valor={usd(cs[11].saldoFin)}
        pie={`${varCs >= 0 ? "Sube" : "Baja"} ${usd(Math.abs(varCs))} en el año`} />
      <Indicador titulo={`Socios dic-${ejercicioEnUso()}`} valor={Math.round(cs[11].sociosTotal).toLocaleString("es-EC")}
        pie="Socios activos al cierre del año" />
      <Indicador titulo={`Resultado del ejercicio ${ejercicioEnUso()}`} valor={usd(resultadoAnio)} color={resultadoAnio < 0 ? C.alerta : undefined}
        pie={resultadoAnio >= 0 ? "Utilidad acumulada a diciembre" : "Pérdida acumulada a diciembre"} />
    </FranjaIndicadores>
  );
}

// =====================================================================
// RESUMEN: las cinco cuentas del grupo 3
// =====================================================================

function Resumen({ datos, corte, onCapital, onOtras }: { datos: Datos; corte: string | null; onCapital: () => void; onOtras: () => void }) {
  const cs = datos.capitalSocial31;
  const fijo = (v: number) => Array(12).fill(v) as number[];
  const tot = totalPatrimonio(datos);
  const s36 = datos.saldo36Corte ?? 0;
  const ini36 = s36;
  const ini = cs[0].saldoInicio + datos.saldoReservas33 + datos.saldoOtrosAportes34 + datos.saldoSuperavit35 + ini36;
  const deBalance = `se mantiene el saldo del balance${corte ? ` a ${corte}` : ""}; no tiene movimiento en la proyección`;
  const ajuste = datos.ajusteCierre ?? 0;
  const filas: DefFila[] = [
    { id: "31", label: "31 · Capital social", valores: cs.map((x) => x.saldoFin), total: cs[11].saldoFin - cs[0].saldoInicio, totalConSigno: true, onClick: onCapital,
      formula: (i) => `Saldo final de ${MESES[i]} en la pestaña Capital social: ${usd(cs[i].saldoFin)}.` },
    { id: "33", label: "33 · Reservas", valores: fijo(datos.saldoReservas33), total: 0, formula: () => `${usd(datos.saldoReservas33)}: ${deBalance}.` },
    { id: "34", label: "34 · Otros aportes patrimoniales", valores: s34(datos), total: s34(datos)[11] - datos.saldoOtrosAportes34, totalConSigno: true, onClick: onOtras,
      formula: (i) => (Math.abs(s34(datos)[i] - datos.saldoOtrosAportes34) < 0.5 ? `${usd(datos.saldoOtrosAportes34)}: ${deBalance}.`
        : `Saldo del balance + donaciones acumuladas a ${MESES[i]} = ${usd(datos.saldoOtrosAportes34)} + ${usd(s34(datos)[i] - datos.saldoOtrosAportes34)} = ${usd(s34(datos)[i])} (ver Otras cuentas).`) },
    { id: "35", label: "35 · Superávit por valuaciones", valores: s35(datos), total: s35(datos)[11] - datos.saldoSuperavit35, totalConSigno: true, onClick: onOtras,
      formula: (i) => (Math.abs(s35(datos)[i] - datos.saldoSuperavit35) < 0.5 ? `${usd(datos.saldoSuperavit35)}: ${deBalance}.`
        : `Saldo del balance + revalúos acumulados a ${MESES[i]} = ${usd(datos.saldoSuperavit35)} + ${usd(s35(datos)[i] - datos.saldoSuperavit35)} = ${usd(s35(datos)[i])} (ver Otras cuentas).`) },
    { id: "36", label: "36 · Resultados", valores: datos.resultados36PorMes, total: datos.resultados36PorMes[11] - s36, totalConSigno: true, fuerte: true,
      formula: (i) => `Saldo de 36 en el balance${corte ? ` a ${corte}` : ""} + resultado del ejercicio ${ejercicioEnUso()} acumulado a ${MESES[i]} = ${usd(s36)} + ${usd(datos.resultados36PorMes[i] - s36)} = ${usd(datos.resultados36PorMes[i])}.` +
        (Math.abs(ajuste) >= 0.5 ? ` El saldo inicial incluye ${usd(ajuste)} del cierre simulado (resultado del año en curso que aún no se cierra a patrimonio).` : "") },
    { id: "36a", label: s36 >= 0 ? "3601 · Utilidades acumuladas" : "3602 · (Pérdidas acumuladas)", valores: fijo(s36), total: 0, sangria: true, totalNormal: true,
      formula: () => `Saldo de 36 en el balance${corte ? ` a ${corte}` : ""}: resultados de años anteriores` + (Math.abs(ajuste) >= 0.5 ? ` y ${usd(ajuste)} del resultado ${corte ? `de ${ejercicioEnUso() - 1} hasta ${corte}` : "del año en curso"} (cierre simulado)` : "") + `. No cambia en ${ejercicioEnUso()}.` },
    { id: "36b", label: `${(datos.resultados36PorMes[11] - s36) >= 0 ? "3603" : "3604"} · Resultado del ejercicio ${ejercicioEnUso()}`, valores: datos.resultados36PorMes.map((v) => v - s36), total: datos.resultados36PorMes[11] - s36, sangria: true, totalConSigno: true,
      formula: (i) => `Resultado acumulado de enero a ${MESES[i]} de ${ejercicioEnUso()}: ${usd(datos.resultados36PorMes[i] - s36)}. Es el mismo del Estado de resultados (el ejercicio empieza en cero cada año).` },
    { id: "tot", label: "Total patrimonio", valores: tot, total: tot[11] - ini, clave: true, totalConSigno: true,
      formula: (i) => `31 + 33 + 34 + 35 + 36 = ${usd(cs[i].saldoFin)} + ${usd(datos.saldoReservas33)} + ${usd(s34(datos)[i])} + ${usd(s35(datos)[i])} + ${usd(datos.resultados36PorMes[i])} = ${usd(tot[i])}. Llega al Balance como grupo 3.` },
  ];
  return (
    <Tarjeta titulo="Saldo por cuenta">
      <TablaMeses titulo="Cuenta" ultima="Var. año" filas={filas} />
    </Tarjeta>
  );
}

// =====================================================================
// CAPITAL SOCIAL: parámetros + movimiento
// =====================================================================

function CapitalSocial({ soloLectura, datos, p, origen, origenDev, corte, editando, cambios, guardando, textos, msg, onEditar, onCancelar, onGuardar, onEscribirMes, onEscribirSocios, onSoltar, onCopiarEnero }: {
  soloLectura?: boolean;
  datos: Datos; p: Params; origen: Origen; origenDev: Origen; corte: string | null;
  editando: boolean; cambios: number; guardando: boolean; textos: Record<string, string>; msg: { t: string; e?: boolean } | null;
  onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
  onEscribirMes: (c: Concepto, i: number, texto: string) => void; onEscribirSocios: (texto: string) => void;
  onSoltar: (k: string) => void; onCopiarEnero: (c: Concepto) => void;
}) {
  const cs = datos.capitalSocial31;
  const [verDev, setVerDev] = useState(false);
  const campoEstilo = editando ? { border: `1px solid ${BORDE_EDICION}`, background: "#FFFFFF" } : { border: "1px solid transparent", background: "transparent" };
  const aporte = p.valores.capital_social_monto_aporte;
  const nuevos = p.valores.capital_social_socios_nuevos;
  const retirados = p.valores.capital_social_socios_retirados;
  const devolucion = p.valores.capital_social_devolucion_promedio;
  const usd2 = (v: number) => "$" + v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const socios0 = p.sociosInicial;
  const sociosIni = (i: number) => (i === 0 ? socios0 : cs[i - 1].sociosTotal);

  const mov: DefFila[] = [
    { id: "soc", label: "Socios al cierre del mes", valores: cs.map((x) => x.sociosTotal), total: cs[11].sociosTotal, tenue: true,
      formula: (i) => `Socios al inicio + nuevos − retirados = ${numero(sociosIni(i))} + ${numero(nuevos[i])} − ${numero(retirados[i])} = ${numero(cs[i].sociosTotal)}. Informativo: no cambia el saldo en dólares.` },
    { id: "si", label: "Saldo inicial", valores: cs.map((x) => x.saldoInicio), total: cs[0].saldoInicio, separador: true,
      formula: (i) => (i === 0 ? `Enero arranca con el saldo de la cuenta 31 en el balance${corte ? ` a ${corte}` : ""}: ${usd(cs[0].saldoInicio)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(cs[i].saldoInicio)}.`) },
    { id: "inc", label: "(+) Aportes de socios nuevos", valores: cs.map((x) => x.incrementos), total: suma(cs.map((x) => x.incrementos)), color: "ok",
      formula: (i) => `Socios nuevos × aporte obligatorio = ${numero(nuevos[i])} × ${usd(aporte[i])} = ${usd(cs[i].incrementos)}. También entra al Flujo de efectivo.` },
    { id: "ret", label: "(−) Retiros de socios", valores: cs.map((x) => x.retiros), total: suma(cs.map((x) => x.retiros)), color: "alerta",
      formula: (i) => `Socios retirados × devolución promedio por retiro = ${numero(retirados[i])} × ${usd2(devolucion[i])} = ${usd(cs[i].retiros)}` +
        (origenDev === "estimado" ? ` (devolución estimada: saldo 31 ${usd(datos.saldo31Corte ?? 0)} ÷ ${numero(p.sociosInicial)} socios al inicio).` : " (valor guardado).") +
        " También sale en el Flujo de efectivo." },
    { id: "div", label: "(+) Capitalización de dividendos", valores: cs.map((x) => x.capitalizacionDividendos), total: suma(cs.map((x) => x.capitalizacionDividendos)), color: "ok",
      formula: (i) => `Monto que escribes en los parámetros: ${usd(cs[i].capitalizacionDividendos)}.` },
    { id: "sf", label: "Saldo final", valores: cs.map((x) => x.saldoFin), total: cs[11].saldoFin, clave: true,
      formula: (i) => `Saldo inicial + aportes − retiros + dividendos = ${usd(cs[i].saldoInicio)} + ${usd(cs[i].incrementos)} − ${usd(-cs[i].retiros)} + ${usd(cs[i].capitalizacionDividendos)} = ${usd(cs[i].saldoFin)}.` },
  ];

  return (
    <>
      {/* Parámetros (en Consolidado solo se muestra la nota) */}
      {soloLectura ? (
        null
      ) : (
      <Tarjeta titulo="Parámetros · Capital social" editando={editando}
        derecha={<>
          <label className="flex items-center gap-2 text-[12px] mr-2" style={{ color: C.texto2 }}>
            Socios al inicio
            {editando ? (
              <input value={textos["socios-inicial"] ?? String(socios0)} inputMode="numeric" aria-label="Socios al inicio del año"
                     onChange={(e) => onEscribirSocios(e.target.value)} onBlur={() => { if (!leerMonto(textos["socios-inicial"] ?? "").error) onSoltar("socios-inicial"); }}
                     className="w-[81px] h-9 rounded-md px-2 text-right text-[13px] font-semibold" style={textos["socios-inicial"] && leerMonto(textos["socios-inicial"]).error ? ERROR_CAMPO : campoEstilo} />
            ) : (
              <b className="text-[13px]" style={{ color: C.texto }}>{Math.round(socios0).toLocaleString("es-EC")}</b>
            )}
          </label>
          <BotonesSeccion editando={editando} cambios={cambios} guardando={guardando} onEditar={onEditar} onCancelar={onCancelar} onGuardar={onGuardar} />
        </>}>
        {editando && (
          <div className="flex items-center gap-2 mx-4 mt-3 px-3.5 py-2 rounded-md text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
            <Pencil size={14} /> Escribe el valor de cada mes · → copia enero a los 12 meses · luego Guardar.
          </div>
        )}
        {!editando && origen === "referencia" && (
          <div className="flex items-center gap-2 mx-4 mt-3 px-3.5 py-2 rounded-md text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
            <AlertTriangle size={14} /> Estos valores son la referencia del Excel, todavía no están guardados para Matriz. Al presionar Editar y Guardar quedan en la base de datos.
          </div>
        )}
        <div className={editando || origen === "referencia" ? "mt-2" : undefined}>
          <table className={TABLA}>
            <Columnas />
            <Cabecera titulo="Parámetro" ultima="Año" />
            <tbody>
              {CAMPOS.map((c) => {
                const vals = p.valores[c.key];
                const tot = c.total === "suma" ? suma(vals) : suma(vals) / 12;
                return (
                  <tr key={c.key} style={{ borderTop: `1px solid ${C.beige}`, height: editando ? 40 : 36 }}>
                    <td className="pl-4">
                      <span className="flex items-center gap-2 pr-2">
                        <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]" title={c.label} style={{ color: C.texto3 }}>
                          {c.label}
                          {c.key === DEVOLUCION && origenDev === "estimado" && !editando && (
                            <span className="ml-2 text-[10px] font-semibold px-1.5 py-px rounded" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>Estimado</span>
                          )}
                        </span>
                        {editando && (
                          <button type="button" onClick={() => onCopiarEnero(c.key)} title="Copiar enero a los 12 meses" aria-label={`Copiar enero de ${c.label} a los 12 meses`}
                                  className="w-7 h-7 rounded inline-flex items-center justify-center shrink-0" style={{ border: "1px solid #C9D0CC", color: C.texto }}><ArrowRight size={14} /></button>
                        )}
                      </span>
                    </td>
                    {vals.map((v, i) => {
                      const k = `${c.key}-${i}`;
                      return (
                        <td key={i} className="px-1 text-right">
                          {editando ? (
                            <input value={textos[k] ?? String(Math.round(v * 100) / 100).replace(".", ",")} inputMode="decimal" aria-label={`${c.label} en ${MESES[i]}`}
                                   onChange={(e) => onEscribirMes(c.key, i, e.target.value)} onBlur={() => { if (!leerMonto(textos[k] ?? "").error) onSoltar(k); }}
                                   aria-invalid={!!(textos[k] && leerMonto(textos[k]).error)} title={textos[k] ? leerMonto(textos[k]).error ?? undefined : undefined}
                                   className="w-full max-w-[70px] h-7 rounded px-1.5 text-right text-[11px]" style={textos[k] && leerMonto(textos[k]).error ? ERROR_CAMPO : campoEstilo} />
                          ) : (
                            <span style={{ color: v === 0 ? C.tenue : C.texto }}>{v === 0 ? "—" : mostrarValor(c.usd, v)}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 text-right font-semibold whitespace-nowrap" style={{ color: C.texto }}>
                      {tot === 0 ? "—" : `${c.total === "promedio" ? "prom. " : ""}${mostrarValor(c.usd, tot)}`}
                    </td>
                    {/* ƒ al final de la fila */}
                    <td className="text-center">
                      {c.key === DEVOLUCION && <BotonF abierto={verDev} onClick={() => setVerDev((v) => !v)} titulo="De dónde sale la devolución promedio" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* ƒ de la devolución promedio: al hacer clic, o solo al editar mientras sea un estimado */}
        {(verDev || (editando && origenDev === "estimado")) && (
          <div className="flex items-start gap-3 px-4 py-3 text-[12px]" style={{ background: C.crema, color: C.texto3, borderTop: `1px solid ${C.beige}` }}>
            <span className="font-mono text-[12px] leading-none mt-1" style={{ color: C.texto }}>ƒ</span>
            <span>
              <b style={{ color: C.texto }}>Devolución promedio por retiro</b> ·{" "}
              {origenDev === "estimado"
                ? <>estimado = saldo de la cuenta 31 ÷ socios al inicio = {usd(datos.saldo31Corte ?? 0)} ÷ {numero(p.sociosInicial)} = {usd2(devolucion[0])}. Para el dato real: total devuelto en certificados de los últimos 12 meses ÷ número de socios retirados; escríbelo aquí y guarda.</>
                : <>valor guardado en la base de datos ({usd2(devolucion[0])} en enero). Se multiplica por los socios retirados de cada mes.</>}
            </span>
          </div>
        )}
        {msg && <p className="px-4 py-3 text-[12px]" style={{ color: msg.e ? C.alerta : C.ok, borderTop: `1px solid ${C.beige}` }}>{msg.t}</p>}
      </Tarjeta>
      )}

      {/* Movimiento */}
      <Tarjeta titulo="Movimiento del saldo · 31 Capital social">
        <TablaMeses titulo="Capital social" ultima="Total año" filas={mov} />
      </Tarjeta>
    </>
  );
}

// =====================================================================
// OTRAS CUENTAS: 34 donaciones y 35 revalúos (con su contrapartida en el motor)
// =====================================================================

type ConceptoOtro = "patrimonio_donaciones_efectivo" | "patrimonio_revaluo_terrenos" | "patrimonio_revaluo_edificios";
const CAMPOS_OTROS: { key: ConceptoOtro; label: string; negativo: boolean; dato: (d: Datos) => number[] | undefined }[] = [
  { key: "patrimonio_donaciones_efectivo", label: "Donaciones en efectivo → 34", negativo: false, dato: (d) => d.donacionesEfectivoPorMes },
  { key: "patrimonio_revaluo_terrenos", label: "Revalúo de terrenos → 35", negativo: true, dato: (d) => d.revaluoTerrenosPorMes },
  { key: "patrimonio_revaluo_edificios", label: "Revalúo de edificios → 35", negativo: true, dato: (d) => d.revaluoEdificiosPorMes },
];

const ERROR_CAMPO = { border: "1px solid #B42318", background: "#FDF2F1" };

function OtrasCuentas({ soloLectura, datos, agencia, corte, onGuardado }: { soloLectura?: boolean; datos: Datos; agencia: string; corte: string | null; onGuardado: () => void }) {
  const guardados = Object.fromEntries(CAMPOS_OTROS.map((c) => [c.key, c.dato(datos) ?? cero12()])) as Record<ConceptoOtro, number[]>;
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Record<ConceptoOtro, number[]> | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const v = editando && borrador ? borrador : guardados;
  const cambios = editando && borrador ? CAMPOS_OTROS.reduce((n, c) => n + borrador[c.key].filter((x, i) => Math.abs(x - guardados[c.key][i]) > 1e-9).length, 0) : 0;
  const campoEstilo = { border: `1px solid ${BORDE_EDICION}`, background: "#FFFFFF" };

  async function guardar() {
    if (!borrador) return;
    if (Object.values(textos).some((t) => leerMonto(t).error)) { setMsg({ t: "Revise la casilla con borde rojo: use coma para decimales; el punto solo separa miles.", e: true }); return; }
    const malos = CAMPOS_OTROS.filter((c) => !c.negativo && borrador[c.key].some((x) => x < 0));
    if (malos.length) { setMsg({ t: `${malos[0].label}: no puede ser negativo.`, e: true }); return; }
    setGuardando(true); setMsg(null);
    try {
      const aGuardar = CAMPOS_OTROS.filter((c) => borrador[c.key].some((x, i) => Math.abs(x - guardados[c.key][i]) > 1e-9));
      const r = await Promise.all(aGuardar.map((c) => apiFetch("/api/otros-pasivo-parametros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencia, ejercicio: ejercicioEnUso(), concepto: c.key, montosPorMes: borrador[c.key] }),
      }).then(async (x) => ({ ok: x.ok, d: await x.json().catch(() => ({})) }))));
      const fallo = r.find((x) => !x.ok || x.d?.error);
      if (fallo) throw new Error(fallo.d?.error ?? "error al guardar");
      setEditando(false); setBorrador(null); setTextos({});
      setMsg({ t: "Guardado. Balance, Activos fijos y Flujo ya usan estos movimientos." });
      onGuardado();
    } catch (e) {
      setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally {
      setGuardando(false);
    }
  }

  const a34 = s34(datos), a35 = s35(datos);
  const ini34 = datos.saldoOtrosAportes34, ini35 = datos.saldoSuperavit35;
  const sIni = (arr: number[], ini: number) => arr.map((_, i) => (i === 0 ? ini : arr[i - 1]));
  const don = guardados.patrimonio_donaciones_efectivo, rt = guardados.patrimonio_revaluo_terrenos, re = guardados.patrimonio_revaluo_edificios;
  const desde = `saldo del balance${corte ? ` a ${corte}` : ""}`;
  const mov: DefFila[] = [
    { id: "34i", label: "Saldo inicial", valores: sIni(a34, ini34), total: ini34, formula: (i) => (i === 0 ? `Enero arranca con el ${desde}: ${usd(ini34)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(a34[i - 1])}.`) },
    { id: "34d", label: "(+) Donaciones en efectivo", valores: don, total: suma(don), color: "ok",
      formula: (i) => `Monto que escribes arriba: ${usd(don[i])}. Entra también al Flujo de efectivo como fuente de fondos.` },
    { id: "34f", label: "Saldo final 34", valores: a34, total: a34[11], clave: true, formula: (i) => `Saldo inicial + donaciones = ${usd(sIni(a34, ini34)[i])} + ${usd(don[i])} = ${usd(a34[i])}.` },
    { id: "35i", label: "Saldo inicial", valores: sIni(a35, ini35), total: ini35, separador: true, formula: (i) => (i === 0 ? `Enero arranca con el ${desde}: ${usd(ini35)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(a35[i - 1])}.`) },
    { id: "35t", label: "(±) Revalúo de terrenos", valores: rt, total: suma(rt), color: "ok",
      formula: (i) => `Monto que escribes arriba: ${usd(rt[i])}. El mismo valor sube el costo de Terrenos (1801); no mueve efectivo.` },
    { id: "35e", label: "(±) Revalúo de edificios", valores: re, total: suma(re), color: "ok",
      formula: (i) => `Monto que escribes arriba: ${usd(re[i])}. El mismo valor sube el costo de Edificios (1802) y desde ese mes se deprecia con el factor de la categoría; no mueve efectivo.` },
    { id: "35f", label: "Saldo final 35", valores: a35, total: a35[11], clave: true, formula: (i) => `Saldo inicial + revalúos = ${usd(sIni(a35, ini35)[i])} + ${usd(rt[i] + re[i])} = ${usd(a35[i])}.` },
  ];

  return (
    <>
      {soloLectura ? (
        null
      ) : (
      <Tarjeta titulo="Movimientos previstos · 34 y 35" editando={editando}
        derecha={<BotonesSeccion editando={editando} cambios={cambios} guardando={guardando}
          onEditar={() => { setBorrador(JSON.parse(JSON.stringify(guardados))); setTextos({}); setEditando(true); setMsg(null); }}
          onCancelar={() => { setEditando(false); setBorrador(null); setTextos({}); }} onGuardar={guardar} />}>
        {editando && (
          <div className="flex items-center gap-2 mx-4 mt-3 px-3.5 py-2 rounded-md text-[12px]" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
            <Pencil size={14} /> Escribe el monto solo en el mes en que ocurre · la donación entra al Flujo · el revalúo sube el activo (usa − para una desvalorización).
          </div>
        )}
        <div className={editando ? "mt-2" : undefined}>
          <table className={TABLA}>
            <Columnas />
            <Cabecera titulo="Movimiento" ultima="Año" />
            <tbody>
              {CAMPOS_OTROS.map((c) => (
                <tr key={c.key} style={{ borderTop: `1px solid ${C.beige}`, height: editando ? 40 : 36 }}>
                  <td className="pl-4 whitespace-nowrap text-[11px]" style={{ color: C.texto3 }}>{c.label}</td>
                  {v[c.key].map((x, i) => {
                    const k = `${c.key}-${i}`;
                    return (
                      <td key={i} className="px-1 text-right">
                        {editando ? (
                          <input value={textos[k] ?? (x ? String(x).replace(".", ",") : "")} inputMode="decimal" placeholder="0" aria-label={`${c.label} en ${MESES[i]}`}
                                 onChange={(e) => {
                                   const t = e.target.value.replace("−", "-");
                                   setTextos((y) => ({ ...y, [k]: t }));
                                   const lr = leerMonto(t);
                                   if (t.trim() === "" || t === "-") setBorrador((b) => (b ? { ...b, [c.key]: b[c.key].map((z, j) => (j === i ? 0 : z)) } : b));
                                   else if (!lr.error && lr.valor !== null) setBorrador((b) => (b ? { ...b, [c.key]: b[c.key].map((z, j) => (j === i ? lr.valor! : z)) } : b));
                                 }}
                                 onBlur={() => { if (!leerMonto(textos[k] ?? "").error) setTextos((y) => { const nn = { ...y }; delete nn[k]; return nn; }); }}
                                 aria-invalid={!!(textos[k] && leerMonto(textos[k]).error)} title={textos[k] ? leerMonto(textos[k]).error ?? undefined : undefined}
                                 className="w-full max-w-[70px] h-7 rounded px-1.5 text-right text-[11px]" style={textos[k] && leerMonto(textos[k]).error ? ERROR_CAMPO : campoEstilo} />
                        ) : (
                          <span style={{ color: x ? C.texto : C.tenue }}>{x ? numero(x) : "—"}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 text-right font-semibold" style={{ color: suma(v[c.key]) ? C.texto : C.tenue }}>{suma(v[c.key]) ? numero(suma(v[c.key])) : "—"}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg && <p className="px-4 py-3 text-[12px]" style={{ color: msg.e ? C.alerta : C.ok, borderTop: `1px solid ${C.beige}` }}>{msg.t}</p>}
      </Tarjeta>
      )}

      <Tarjeta titulo="Movimiento del saldo · 34 y 35">
        <TablaMeses titulo="Cuenta" ultima="Año" filas={mov} titulosAparte
          grupos={{ "34i": "34 · Otros aportes patrimoniales", "35i": "35 · Superávit por valuaciones" }} />
      </Tarjeta>
    </>
  );
}