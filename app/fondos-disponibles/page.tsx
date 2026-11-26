"use client";

import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { leerMonto } from "../../lib/numeros";
import { apiFetch, obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Pencil } from "lucide-react";
import { BotonesSeccion } from "../../components/ActivosComun";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

// =====================================================================
// FONDOS DISPONIBLES (cuenta 11), en pestañas: Resumen, Caja (1101), Depósitos para encaje (1102),
// Bancos (1103) y Proyección de liquidez. El total de la 11 sale del Flujo; el reparto va por reglas:
// Caja con el límite de la agencia, encaje = captaciones × %, Bancos el resto.
// =====================================================================

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#7A847F",
  beige: "#E6EAE8", borde: "#DDE2DF", crema: "#F3F5F4", cabeceraTexto: "#3D4843",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", okSuave: "#E3F1E7", aviso: "#6E4A0E", avisoSuave: "#FBF1DC", alerta: "#B42318",
};
const FONDO = "#EEF1EF";
const CHIP_ON = { background: C.acentoSuave, color: C.acento };
const CHIP_OFF = { background: "transparent", color: C.texto2 };

function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
const cifra = (v: number | null) => (v === null ? "" : Math.round(v) === 0 ? "—" : numero(v));
// Nombres cortos para que quepan en la tabla (el nombre completo va en la fórmula)
const CORTOS: Record<string, string> = { "1101": "Caja", "1102": "Depósitos para encaje", "1103": "Bancos", "1104": "Efectos de cobro inmediato", "1105": "Remesas en tránsito" };
const pct = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")} %`;
const pctTxt = pct;
const numDias = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-EC", { maximumFractionDigits: 1 });
const cifraParam = (v: number) => (v ? usd(v) : "—");
const pctCorto = (v: number) => `${(v * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} %`;

interface Cuenta11 { codigo: string; nombre: string; saldoCorte: number; regla: "caja" | "encaje" | "fija" | "resto"; valores: number[] }
interface Requeridos {
  limiteCaja: number | null; caja: number[]; encaje: number[]; pagosMes: number[]; diasHabiles: number[]; pagoDiario: number[];
  bancosOperativos: number[]; otras: number[]; total: number[]; excedente: number[]; diasCubiertosBancos: number[];
  diasCubiertosCorte: number | null; tasaInversiones: number | null; costoOportunidad: number[];
}
interface Datos {
  saldoInicialFlujo: number; saldoFinalFlujo: number[];
  liquidezRequerida: number[];
  corte: { total11: number; total13: number; saldo1103: number | null; total12: number };
  inversiones: number[]; extra16: number[]; fondos: number[]; cuentas11: Cuenta11[];
  conRegistroInversiones: boolean; titulosAlCorte: number | null;
  requeridos: Requeridos;
  parametrosFondos: { maxCajero: number; maxCajaFuerte: number; diasCobertura: number; guardado: boolean } | null;
  pctEncaje: number; captaciones: number[]; captacionesCorte: number | null;
  flujo?: { saldoInicial: number[]; entradas: number[]; salidas: number[]; saldoFinal: number[]; diferenciaMaxima: number };
  corteFecha: { anio: number; mes: number } | null; error?: string;
}

interface DefFila {
  id: string; label: string; inicial: number | null; valores: number[];
  grupo?: string; clave?: boolean; tenue?: boolean; sangria?: boolean; separador?: boolean; porcentaje?: boolean; dias?: boolean;
  formula?: (i: number) => string;
}

function ChipsMes({ valor, onChange }: { valor: number; onChange: (i: number) => void }) {
  return (
    <div role="group" aria-label="Mes de la fórmula" className="flex flex-wrap gap-0.5">
      {MESES.map((m, i) => (
        <button key={m} type="button" onClick={() => onChange(i)} aria-pressed={valor === i}
                className="w-[32px] h-[25px] rounded text-[11px] font-semibold" style={valor === i ? CHIP_ON : CHIP_OFF}>{m}</button>
      ))}
    </div>
  );
}

function Tabla({ filas, etiquetaInicial }: { filas: DefFila[]; etiquetaInicial: string }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(11);
  const fila = filas.find((f) => f.id === abierta) ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-[11px] border-collapse min-w-[1040px]">
        <colgroup>
          <col style={{ width: 234 }} />
          <col style={{ width: 104 }} />
          {MESES.map((m) => <col key={m} />)}
          <col style={{ width: 25 }} />
        </colgroup>
        <thead>
          <tr className="font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
            <th className="pl-4 text-left font-semibold">Concepto</th>
            <th className="px-2 text-right font-semibold whitespace-nowrap" style={{ background: C.crema }}>{etiquetaInicial}</th>
            {MESES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {filas.map((f, k) => {
            const fuerte = !!f.clave || !!f.grupo;
            const borde = f.grupo ? (k === 0 ? "none" : "1px solid #DDE2DF") : f.clave ? "1px solid #B9C3BD" : `1px solid ${C.beige}`;
            const fmt = (v: number | null) => (v === null ? "" : f.dias ? numDias(v) : f.porcentaje ? (Math.abs(v) < 0.00005 ? "—" : pct(v)) : cifra(v));
            const color = (v: number) => ((f.porcentaje || f.dias ? Math.abs(v) < 0.00005 : Math.round(v) === 0) ? C.tenue : v < 0 ? C.alerta : fuerte ? C.texto : f.tenue ? C.texto2 : C.texto3);
            return (
              <FilaConEspacio key={f.id} espacio={!!f.separador && k > 0}>
                <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: borde, height: 32, fontWeight: fuerte ? 600 : 400 }}>
                  <td className={f.sangria ? "pl-8" : "pl-4"}>
                    {f.grupo ? (
                      <span className="flex items-baseline gap-1.5 whitespace-nowrap overflow-hidden pr-2" title={`${f.grupo} · ${f.label}`}>
                        <span className="text-[12px] font-bold shrink-0" style={{ color: C.acento }}>{f.grupo}</span>
                        <span className="text-[11px] font-normal truncate" style={{ color: C.texto2 }}>· {f.label}</span>
                      </span>
                    ) : (
                      <span className="block whitespace-nowrap overflow-hidden text-ellipsis pr-2" title={f.label}
                            style={{ color: f.clave ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>{f.label}</span>
                    )}
                  </td>
                  <td className="px-2 text-right whitespace-nowrap" style={{ background: C.crema, color: f.inicial === null ? C.tenue : color(f.inicial) }}>{fmt(f.inicial)}</td>
                  {f.valores.map((v, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: color(v) }}>{fmt(v)}</td>
                  ))}
                  <td className="text-center">
                    {f.formula && (
                      <button type="button" onClick={() => setAbierta(abierta === f.id ? null : f.id)} aria-pressed={abierta === f.id}
                              title={`Fórmula de ${f.label}`} aria-label={`Fórmula de ${f.label}`}
                              className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
                              style={abierta === f.id ? CHIP_ON : { color: C.tenue }}>ƒ</button>
                    )}
                  </td>
                </tr>
              </FilaConEspacio>
            );
          })}
        </tbody>
      </table>
      {fila?.formula && (
        <div className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: `1px solid ${C.beige}`, background: C.crema }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[12px]">ƒ</span>
            <b className="text-[12px] flex-1">{fila.label}</b>
            <ChipsMes valor={mes} onChange={setMes} />
          </div>
          <p className="text-[12px]" style={{ color: C.texto3 }}><span className="font-semibold" style={{ color: C.acento }}>{MESES[mes]} · </span>{fila.formula(mes)}</p>
        </div>
      )}
    </div>
  );
}
function FilaConEspacio({ espacio, children }: { espacio: boolean; children: ReactNode }) {
  return (
    <>
      {espacio && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={15} /></tr>}
      {children}
    </>
  );
}

function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: ReactNode; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: color ?? C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: C.texto2 }}>{pie}</span>
    </div>
  );
}

function Control({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3.5 py-2 rounded-md text-[12px]"
         style={ok ? { background: C.okSuave, color: C.ok } : { background: C.avisoSuave, color: C.aviso }}>
      {ok ? <CheckCircle2 size={15} className="shrink-0 mt-px" /> : <AlertTriangle size={15} className="shrink-0 mt-px" />}
      <span>{children}</span>
    </div>
  );
}

type Pestana = "resumen" | "caja" | "encaje" | "bancos" | "liquidez";
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: "resumen", label: "Resumen" }, { id: "caja", label: "1101 · Caja" }, { id: "encaje", label: "1102 · Depósitos para encaje" },
  { id: "bancos", label: "1103 · Bancos" }, { id: "liquidez", label: "Proyección de liquidez" },
];

export default function FondosDisponiblesPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const ticketSync = useEscucharSincronizacion();
  const url = `/api/fondos-disponibles?agencia=${encodeURIComponent(agencia)}`;
  // Lo guardado en el navegador por una versión anterior puede venir sin los campos nuevos: se ignora
  const valido = (d: Datos | null | undefined) => (d && d.fondos && d.requeridos && d.captaciones ? d : null);
  const cached = valido(obtenerJSONCache<Datos>(url));
  const [datos, setDatos] = useState<Datos | null>(() => cached ?? null);
  const [cargando, setCargando] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = valido(obtenerJSONCache<Datos>(url));
    if (enCache) { setDatos(enCache); setCargando(false); } else { setDatos(null); setCargando(true); }
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((d: Datos) => {
        if (!vivo) return;
        if (d.error || !valido(d)) { if (!enCache) setError(d.error ?? "No se pudieron calcular los fondos disponibles."); }
        else { guardarJSONCache(url, d); setDatos(d); }
      })
      .catch(() => { if (vivo && !enCache) setError("Error de conexión al cargar los fondos disponibles."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [url, ticketSync, recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  const corte = datos?.corteFecha ? `${MESES[datos.corteFecha.mes - 1].toLowerCase()}-${String(datos.corteFecha.anio).slice(2)}` : "corte";
  const ctx = datos ? { d: datos, corte, agencia, onGuardado: () => setRecarga((x) => x + 1) } : null;

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Fondos disponibles<AnioEjercicio /></h1>
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha, en la misma línea */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones de fondos disponibles" className="flex gap-7 flex-1">
          {PESTANAS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={pestana === t.id} onClick={() => setPestana(t.id)}
                    className="pt-2 pb-2.5 -mb-px text-[13px]"
                    style={{ color: pestana === t.id ? C.acento : C.texto2, fontWeight: pestana === t.id ? 600 : 400, borderBottom: `2px solid ${pestana === t.id ? C.acento : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => setAgencia(e.target.value)}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {cargando ? <EsqueletoTabla filas={9} />
        : error ? <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
        : ctx ? (
          pestana === "resumen" ? <Resumen {...ctx} />
          : pestana === "caja" ? <Caja {...ctx} />
          : pestana === "encaje" ? <Encaje {...ctx} />
          : pestana === "bancos" ? <Bancos {...ctx} />
          : <Liquidez {...ctx} />
        ) : null}
    </div>
  );
}

interface Ctx { d: Datos; corte: string; agencia: string; onGuardado: () => void }
const cuenta = (d: Datos, c: string) => d.cuentas11.find((x) => x.codigo === c) ?? null;
const ceros = () => MESES.map(() => 0);

/** Botones de vista dentro del encabezado de la tarjeta (mismo estilo que Inversiones y Cartera). */
function Segmentado<T extends string>({ opciones, valor, onChange, bloqueado }: { opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; bloqueado?: boolean }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 p-1 rounded-lg" style={{ background: C.crema }}>
      {opciones.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id} disabled={bloqueado && valor !== o.id} onClick={() => onChange(o.id)}
                className="h-8 px-3.5 rounded-md text-[12px] transition-colors disabled:opacity-50"
                style={valor === o.id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tarjeta con título a la izquierda y, a la derecha, los botones de vista y (si aplica) Editar. */
function TarjetaVista({ titulo, derecha, editando, children, idBotones }: { titulo: string; derecha: ReactNode; editando?: boolean; children: ReactNode; idBotones?: string }) {
  return (
    <section className="tarjeta overflow-hidden flex flex-col" style={editando ? { borderColor: "#8DB39B", boxShadow: `0 0 0 2px ${C.acentoSuave}` } : undefined}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
        <h2 className="text-[14px] font-semibold flex-1">{titulo}</h2>
        {derecha}
        {idBotones && <span id={idBotones} className="contents" />}
      </div>
      {children}
    </section>
  );
}

// =====================================================================
// RESUMEN: desglose de la 11 por grupo + requerido y excedente
// =====================================================================
function Resumen({ d, corte }: Ctx) {
  const [vista, setVista] = useState<"saldos" | "requerido">("saldos");
  const r = d.requeridos;
  const c1101 = cuenta(d, "1101"), c1102 = cuenta(d, "1102");

  const fl = d.flujo;
  const orden = ["1102", "1101", "1104", "1105", "1103"];
  const subcuentas = [...d.cuentas11].sort((a, b) => (orden.indexOf(a.codigo) + 99 * +(orden.indexOf(a.codigo) < 0)) - (orden.indexOf(b.codigo) + 99 * +(orden.indexOf(b.codigo) < 0)));
  const sinEncaje = d.fondos.map((f, i) => f - (c1102?.valores[i] ?? 0));
  const filasSaldos: DefFila[] = [
    ...(fl ? [
      { id: "fsi", grupo: "Flujo de caja", label: "saldo inicial", inicial: null, valores: fl.saldoInicial,
        formula: (i: number) => (i === 0 ? `Cuenta 11 del balance de partida (${corte}): ${usd(fl.saldoInicial[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(fl.saldoInicial[i])}.`) },
      { id: "fen", label: "(+) Entradas de efectivo", inicial: null, valores: fl.entradas, sangria: true,
        formula: (i: number) => `Total de entradas del Flujo de efectivo en ${MESES[i]}: ${usd(fl.entradas[i])}. El detalle por cuenta está en Flujo de efectivo → Detalle.` },
      { id: "fsa", label: "(−) Salidas de efectivo", inicial: null, valores: fl.salidas.map((v) => -v), sangria: true, tenue: true,
        formula: (i: number) => `Total de salidas del Flujo de efectivo en ${MESES[i]}: ${usd(fl.salidas[i])}.` },
    ] as DefFila[] : []),
    { id: "t11", label: "Saldo final · fondos disponibles (11)", inicial: d.corte.total11, valores: d.fondos, clave: true,
      formula: (i) => `Saldo inicial + entradas − salidas del Flujo de efectivo = cuenta 11 del Balance en ${MESES[i]}: ${usd(d.fondos[i])}.` },
    ...subcuentas.map((c, k) => ({
      id: c.codigo, grupo: k === 0 ? "Distribución" : undefined, separador: k === 0, sangria: k > 0,
      label: k === 0 ? (CORTOS[c.codigo] ?? c.nombre).toLowerCase() : CORTOS[c.codigo] ?? c.nombre, inicial: c.saldoCorte, valores: c.valores,
      formula: (i: number) => `${c.nombre} en ${MESES[i]}: ${usd(c.valores[i])}. `
        + (c.regla === "encaje" ? "Captaciones × % de encaje (pestaña Depósitos para encaje)."
          : c.regla === "caja" ? "Saldo del corte sin pasar el límite de la agencia (pestaña Caja)."
          : c.regla === "resto" ? "Lo que queda de la 11 después de encaje, caja y otras (pestaña Bancos)."
          : "Mantiene el saldo del corte."),
    } as DefFila)),
    { id: "sde", label: "Saldo disponible sin encaje", inicial: d.corte.total11 - (c1102?.saldoCorte ?? 0), valores: sinEncaje, clave: true,
      formula: (i) => `Fondos disponibles − encaje = caja + bancos + otras = ${usd(d.fondos[i])} − ${usd(c1102?.valores[i] ?? 0)} = ${usd(sinEncaje[i])}.`
        + (sinEncaje[i] < 0 ? " Negativo: la colocación y los pagos del mes no caben en la liquidez." : "") },
  ];

  const filasReq: DefFila[] = [
    { id: "rc", grupo: "Fondos requeridos", label: r.limiteCaja === null ? "caja (sin límite)" : "caja (límite)", inicial: r.limiteCaja, valores: r.caja,
      formula: (i) => r.limiteCaja === null ? `Sin límite registrado se toma la caja proyectada: ${usd(r.caja[i])}. Regístralo en la pestaña Caja.`
        : `Monto máximo de cajeros + monto máximo de caja fuerte = ${usd(r.caja[i])}.` },
    { id: "re", label: `Encaje BCE (${pctCorto(d.pctEncaje)})`, inicial: null, valores: r.encaje, sangria: true,
      formula: (i) => `Captaciones proyectadas (21) × ${pctCorto(d.pctEncaje)} = ${usd(r.encaje[i])}.` },
    { id: "rb", label: `Bancos operativos (${numDias(d.parametrosFondos?.diasCobertura ?? 5)} días)`, inicial: null, valores: r.bancosOperativos, sangria: true,
      formula: (i) => `Pago diario (${usd(r.pagoDiario[i])}) × ${numDias(d.parametrosFondos?.diasCobertura ?? 5)} días hábiles = ${usd(r.bancosOperativos[i])}. Detalle en la pestaña Bancos.` },
    ...(r.otras.some((v) => Math.abs(v) >= 0.5) ? [{ id: "ro", label: "Efectos de cobro y remesas", inicial: null, valores: r.otras, sangria: true,
      formula: (i: number) => `Subcuentas que mantienen su saldo del corte: ${usd(r.otras[i])}.` } as DefFila] : []),
    { id: "rt", label: "Total requerido", inicial: null, valores: r.total, clave: true,
      formula: (i) => `Caja + encaje + bancos operativos + otras = ${usd(r.total[i])}.` },
    { id: "xf", grupo: "Comparación", separador: true, label: "fondos disponibles (11)", inicial: d.corte.total11, valores: d.fondos },
    { id: "xr", label: "(−) Total requerido", inicial: null, valores: r.total.map((v) => -v), tenue: true, sangria: true },
    { id: "xe", label: "Excedente (déficit)", inicial: null, valores: r.excedente, clave: true,
      formula: (i) => `Fondos disponibles − requerido = ${usd(d.fondos[i])} − ${usd(r.total[i])} = ${usd(r.excedente[i])}. `
        + (r.excedente[i] >= 0 ? "Dinero que podría invertirse. Informativo: no cambia el Balance." : "Déficit: los fondos no cubren lo requerido en este mes.") },
    { id: "xc", label: "Costo de oportunidad del mes", inicial: null, valores: r.costoOportunidad, tenue: true, sangria: true,
      formula: (i) => r.tasaInversiones === null ? "Sin títulos vigentes en Inversiones no hay tasa de referencia."
        : `Excedente × tasa promedio de las inversiones vigentes (${pctTxt(r.tasaInversiones)}) ÷ 12 = ${usd(r.costoOportunidad[i])}.` },
  ];
  const costoAnio = r.costoOportunidad.reduce((t, v) => t + v, 0);
  const promExc = r.excedente.reduce((t, v) => t + v, 0) / 12;

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Fondos disponibles dic-${ejercicioEnUso()}`} valor={usd(d.fondos[11])} color={d.fondos[11] < 0 ? C.alerta : undefined}
          pie={`${d.fondos[11] >= d.corte.total11 ? "Suben" : "Bajan"} ${usd(Math.abs(d.fondos[11] - d.corte.total11))} frente a ${corte}`} />
        <Indicador titulo={`Caja dic-${ejercicioEnUso()}`} valor={c1101 ? usd(c1101.valores[11]) : "—"} pie={r.limiteCaja === null ? "Sin límite registrado" : `Límite ${usd(r.limiteCaja)}`} />
        <Indicador titulo={`Encaje dic-${ejercicioEnUso()}`} valor={c1102 ? usd(c1102.valores[11]) : usd(r.encaje[11])} pie={`${pctCorto(d.pctEncaje)} de las captaciones`} />
        <Indicador titulo={`Disponible sin encaje dic-${ejercicioEnUso()}`} valor={usd(d.fondos[11] - (c1102?.valores[11] ?? 0))}
          color={d.fondos.some((f, i) => f - (c1102?.valores[i] ?? 0) < 0) ? C.alerta : undefined}
          pie={(() => { const k = d.fondos.findIndex((f, i) => f - (c1102?.valores[i] ?? 0) < 0); return k >= 0 ? `Negativo desde ${MESES[k].toLowerCase()}-${ejercicioEnUso()}` : vista === "requerido" ? `Excedente promedio ${usd(promExc)} · costo ${r.tasaInversiones === null ? "—" : usd(costoAnio)}` : "Caja + bancos"; })()} />
      </div>
      <TarjetaVista titulo={vista === "saldos" ? "Fondos disponibles" : "Requerido y excedente"}
        derecha={<Segmentado opciones={[{ id: "saldos", label: "Saldos" }, { id: "requerido", label: "Requerido y excedente" }]} valor={vista} onChange={setVista} />}>
        {vista === "saldos" ? <Tabla key="s" filas={filasSaldos} etiquetaInicial={`Inicial ${corte}`} /> : <Tabla key="r" filas={filasReq} etiquetaInicial={`Inicial ${corte}`} />}
        {vista === "saldos" && d.fondos.some((v) => v < 0) && (
          <p className="px-4 py-3 text-[12px] flex items-center gap-2" style={{ color: C.alerta, borderTop: `1px solid ${C.beige}` }}>
            <AlertTriangle size={15} /> En {MESES.filter((_, i) => d.fondos[i] < 0).join(", ")} los fondos disponibles salen negativos: el Flujo de efectivo no alcanza a cubrir las salidas.
          </p>
        )}
      </TarjetaVista>
    </>
  );
}

// =====================================================================
// CAJA (1101)
// =====================================================================
function Caja({ d, corte, agencia, onGuardado }: Ctx) {
  const [vista, setVista] = useState<"proyeccion" | "parametros">("proyeccion");
  const [editando, setEditando] = useState(false);
  const c = cuenta(d, "1101");
  const r = d.requeridos;
  const pf = d.parametrosFondos;
  const lim = r.limiteCaja;
  const sobre = c && lim !== null ? c.saldoCorte - lim : null;
  const filas: DefFila[] = [
    ...(lim !== null ? [
      { id: "lc", grupo: "Límite", label: "cajeros automáticos", inicial: pf?.maxCajero ?? 0, valores: MESES.map(() => pf?.maxCajero ?? 0), tenue: true },
      { id: "lf", label: "Caja fuerte", inicial: pf?.maxCajaFuerte ?? 0, valores: MESES.map(() => pf?.maxCajaFuerte ?? 0), tenue: true, sangria: true },
      { id: "lt", label: "Límite de caja", inicial: lim, valores: MESES.map(() => lim), clave: true },
    ] as DefFila[] : []),
    { id: "cp", grupo: lim !== null ? "Proyección" : undefined, separador: lim !== null, label: lim !== null ? "caja" : "Caja",
      inicial: c?.saldoCorte ?? 0, valores: c?.valores ?? ceros(), clave: lim === null,
      formula: (i) => !c ? "La agencia no tiene caja en el balance de partida."
        : lim === null ? `Sin límite registrado: se mantiene el saldo del corte (${usd(c.saldoCorte)}).`
        : `Saldo del corte (${usd(c.saldoCorte)}) sin pasar el límite (${usd(lim)}) = ${usd(c.valores[i])}.` },
  ];
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Caja al corte ${corte}`} valor={c ? usd(c.saldoCorte) : "—"} pie={agencia} />
        <Indicador titulo="Límite de caja" valor={lim === null ? "—" : usd(lim)} pie={lim === null ? "Sin montos máximos registrados" : "Cajeros + caja fuerte"} />
        <Indicador titulo={`Caja dic-${ejercicioEnUso()}`} valor={c ? usd(c.valores[11]) : "—"} pie="Lo que va al Balance" />
        <Indicador titulo="Sobre el límite al corte" valor={sobre === null ? "—" : sobre > 0 ? usd(sobre) : "Dentro"} color={sobre !== null && sobre > 0 ? C.alerta : undefined}
          pie={sobre !== null && sobre > 0 ? "Desde enero se proyecta en Bancos" : "Sin excedente de caja"} />
      </div>
      <TarjetaVista titulo={vista === "proyeccion" ? "Caja" : "Límites de caja por agencia"} editando={editando} idBotones={vista === "parametros" ? "botones-fondos" : undefined}
        derecha={<Segmentado opciones={[{ id: "proyeccion", label: "Proyección" }, { id: "parametros", label: "Parámetros" }]} valor={vista} onChange={setVista} bloqueado={editando} />}>
        {vista === "proyeccion" ? <Tabla key="c" filas={filas} etiquetaInicial={`Inicial ${corte}`} />
          : <EditorParametros seccion="caja" agencia={agencia} onEditando={setEditando} onGuardado={onGuardado} />}
      </TarjetaVista>
    </>
  );
}

// =====================================================================
// DEPÓSITOS PARA ENCAJE (1102)
// =====================================================================
function Encaje({ d, corte, agencia, onGuardado }: Ctx) {
  const [vista, setVista] = useState<"proyeccion" | "parametros">("proyeccion");
  const [editando, setEditando] = useState(false);
  const c = cuenta(d, "1102");
  const valores = c?.valores ?? d.requeridos.encaje;
  const filas: DefFila[] = [
    { id: "k21", label: "Captaciones proyectadas", inicial: d.captacionesCorte, valores: d.captaciones,
      formula: (i) => `Obligaciones con el público proyectadas en ${MESES[i]}: ${usd(d.captaciones[i])} (sección Obligaciones con el público).` },
    { id: "kp", label: "% de encaje BCE", inicial: null, valores: MESES.map(() => d.pctEncaje), porcentaje: true, tenue: true },
    { id: "k02", label: c ? "Depósitos para encaje" : "Encaje requerido", inicial: c?.saldoCorte ?? null, valores, clave: true,
      formula: (i) => `${usd(d.captaciones[i])} × ${pctCorto(d.pctEncaje)} = ${usd(valores[i])}. Es el mismo valor de "Reservas de liquidez requeridas (encaje BCE)" del Flujo de efectivo.`
        + (c ? "" : " La agencia no tiene saldo en la 1102: el encaje queda dentro de Bancos.") },
  ];
  const dif = c && d.captacionesCorte ? c.saldoCorte / d.captacionesCorte : null;
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo="% de encaje BCE" valor={pctCorto(d.pctEncaje)} pie="Sobre las captaciones proyectadas" />
        <Indicador titulo={`Encaje al corte ${corte}`} valor={c ? usd(c.saldoCorte) : "—"} pie={dif === null ? "Sin saldo en la 1102" : `${pctCorto(dif)} de las captaciones del corte`} />
        <Indicador titulo={`Captaciones dic-${ejercicioEnUso()}`} valor={usd(d.captaciones[11])} pie="Obligaciones con el público" />
        <Indicador titulo={`Encaje dic-${ejercicioEnUso()}`} valor={usd(valores[11])} pie={c ? "Lo que va al Balance" : "Informativo: queda en Bancos"} />
      </div>
      <TarjetaVista titulo={vista === "proyeccion" ? "Depósitos para encaje" : "Parámetro de encaje"} editando={editando} idBotones={vista === "parametros" ? "botones-fondos" : undefined}
        derecha={<Segmentado opciones={[{ id: "proyeccion", label: "Proyección" }, { id: "parametros", label: "Parámetros" }]} valor={vista} onChange={setVista} bloqueado={editando} />}>
        {vista === "proyeccion" ? <Tabla key="e" filas={filas} etiquetaInicial={`Inicial ${corte}`} />
          : <EditorParametros seccion="encaje" agencia={agencia} onEditando={setEditando} onGuardado={onGuardado} />}
      </TarjetaVista>
    </>
  );
}

// =====================================================================
// BANCOS (1103)
// =====================================================================
function Bancos({ d, corte, agencia, onGuardado }: Ctx) {
  const [vista, setVista] = useState<"proyeccion" | "parametros">("proyeccion");
  const [editando, setEditando] = useState(false);
  const r = d.requeridos;
  const b = cuenta(d, "1103");
  const caja = cuenta(d, "1101"), enc = cuenta(d, "1102");
  const otras = d.cuentas11.filter((c) => c.regla === "fija");
  const dias = d.parametrosFondos?.diasCobertura ?? 5;
  const filas: DefFila[] = [
    { id: "bf", grupo: "Saldo", label: "fondos disponibles", inicial: d.corte.total11, valores: d.fondos },
    ...(caja ? [{ id: "bc", label: "(−) Caja", inicial: -caja.saldoCorte, valores: caja.valores.map((v) => -v), tenue: true, sangria: true } as DefFila] : []),
    ...(enc ? [{ id: "be", label: "(−) Depósitos para encaje", inicial: -enc.saldoCorte, valores: enc.valores.map((v) => -v), tenue: true, sangria: true } as DefFila] : []),
    ...otras.map((o) => ({ id: `bo${o.codigo}`, label: `(−) ${CORTOS[o.codigo] ?? o.nombre}`, inicial: -o.saldoCorte, valores: o.valores.map((v) => -v), tenue: true, sangria: true } as DefFila)),
    { id: "bb", label: "Bancos", inicial: b?.saldoCorte ?? 0, valores: b?.valores ?? ceros(), clave: true,
      formula: (i) => `Fondos disponibles − caja − encaje − otras = ${usd(b?.valores[i] ?? 0)}. Es lo que va al Balance y la base del interés de bancos (5101).`
        + ((b?.valores[i] ?? 0) < 0 ? " Negativo: el Flujo de efectivo no deja fondos suficientes para cubrir caja y encaje; es el faltante del mes." : "") },
    { id: "pp", grupo: "Pagos", separador: true, label: "pagos operativos del mes", inicial: null, valores: r.pagosMes,
      formula: (i) => `Gastos de personal + gastos operativos en efectivo + intereses pagados de ${MESES[i]} (del Flujo de efectivo) = ${usd(r.pagosMes[i])}.` },
    { id: "pd", label: "Pago por día hábil", inicial: null, valores: r.pagoDiario, sangria: true, tenue: true,
      formula: (i) => `${usd(r.pagosMes[i])} ÷ ${r.diasHabiles[i]} días hábiles (lunes a viernes) = ${usd(r.pagoDiario[i])}.` },
    { id: "pm", label: `Mínimo en bancos (${numDias(dias)} días)`, inicial: null, valores: r.bancosOperativos, sangria: true,
      formula: (i) => `${usd(r.pagoDiario[i])} × ${numDias(dias)} días = ${usd(r.bancosOperativos[i])}.` },
    { id: "pc", label: "Días de pagos que cubren los bancos", inicial: r.diasCubiertosCorte, valores: r.diasCubiertosBancos, dias: true, clave: true,
      formula: (i) => `Saldo de bancos ÷ pago diario = ${usd(b?.valores[i] ?? 0)} ÷ ${usd(r.pagoDiario[i])} = ${numDias(r.diasCubiertosBancos[i])} días (mínimo definido: ${numDias(dias)}).` },
  ];
  const prom = r.pagosMes.reduce((t, v) => t + v, 0) / 12;
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Bancos dic-${ejercicioEnUso()}`} valor={b ? usd(b.valores[11]) : "—"} color={b && b.valores[11] < 0 ? C.alerta : undefined} pie={`Al corte ${corte}: ${b ? usd(b.saldoCorte) : "—"}`} />
        <Indicador titulo="Pagos operativos al mes" valor={usd(prom)} pie={`Promedio de ${ejercicioEnUso()}`} />
        <Indicador titulo="Días que cubren hoy" valor={r.diasCubiertosCorte === null ? "—" : numDias(r.diasCubiertosCorte)} pie={`Saldo de bancos al corte ${corte}`} />
        <Indicador titulo="Mínimo definido" valor={`${numDias(dias)} días`} pie="Días hábiles de pagos" />
      </div>
      <TarjetaVista titulo={vista === "proyeccion" ? "Bancos" : "Parámetro de bancos"} editando={editando} idBotones={vista === "parametros" ? "botones-fondos" : undefined}
        derecha={<Segmentado opciones={[{ id: "proyeccion", label: "Proyección" }, { id: "parametros", label: "Parámetros" }]} valor={vista} onChange={setVista} bloqueado={editando} />}>
        {vista === "proyeccion" ? <Tabla key="b" filas={filas} etiquetaInicial={`Inicial ${corte}`} />
          : <EditorParametros seccion="bancos" agencia={agencia} onEditando={setEditando} onGuardado={onGuardado} />}
      </TarjetaVista>
    </>
  );
}

// =====================================================================
// PROYECCIÓN DE LIQUIDEZ (11 + 13, como el Excel) + controles
// =====================================================================
function Liquidez({ d, corte }: Ctx) {
  // Liquidez = fondos disponibles (11) + inversiones (13). El interés por cobrar de inversiones (16) queda fuera
  // de esta sección (pendiente de ubicar en Cuentas por cobrar).
  const L = d.fondos.map((f, i) => f + d.inversiones[i]);
  const inicialL = d.corte.total11 + d.corte.total13;
  const si = MESES.map((_, i) => (i === 0 ? inicialL : L[i - 1]));
  const partes: { id: string; label: string; inicial: number; valores: number[] }[] = [
    ...d.cuentas11.map((c) => ({ id: c.codigo, label: `${CORTOS[c.codigo] ?? c.nombre} (${c.codigo})`, inicial: c.saldoCorte, valores: c.valores })),
    { id: "13", label: "Inversiones financieras (13)", inicial: d.corte.total13, valores: d.inversiones },
  ];
  const filas: DefFila[] = [
    { id: "p-si", grupo: "Proyecciones", label: "saldo inicial", inicial: null, valores: si,
      formula: (i) => (i === 0 ? `11 + 13 del balance de partida (${corte}): ${usd(si[0])}.` : `Saldo de liquidez de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "p-lr", label: "Liquidez requerida", inicial: null, valores: d.liquidezRequerida, tenue: true,
      formula: (i) => `Suma de la liquidez requerida de los productos (Obligaciones con el público) = ${usd(d.liquidezRequerida[i])}. No incluye el encaje del BCE.` },
    { id: "p-sl", label: "Saldo de liquidez", inicial: inicialL, valores: L, clave: true,
      formula: (i) => `Fondos disponibles (11) + inversiones (13) = ${usd(d.fondos[i])} + ${usd(d.inversiones[i])} = ${usd(L[i])}.`
        + (L[i] < d.liquidezRequerida[i] ? " Está por debajo de la liquidez requerida." : ` Cubre ${(L[i] / (d.liquidezRequerida[i] || 1)).toFixed(1).replace(".", ",")} veces la liquidez requerida.`) },
    { id: "p-va", label: "Variación", inicial: null, valores: L.map((v, i) => v - si[i]) },
    ...partes.map((p, k) => ({
      id: `c-${p.id}`, grupo: k === 0 ? "Composición" : undefined, separador: k === 0, sangria: k > 0, porcentaje: true,
      label: k === 0 ? `${p.label.toLowerCase()} / total` : `${p.label} / total`,
      inicial: inicialL ? p.inicial / inicialL : 0, valores: p.valores.map((v, i) => (L[i] ? v / L[i] : 0)),
    } as DefFila)),
    { id: "c-tot", label: "Total", inicial: 1, valores: L.map(() => 1), clave: true, porcentaje: true },
    ...partes.map((p, k) => ({
      id: `e-${p.id}`, grupo: k === 0 ? "Estructura de la liquidez" : undefined, separador: k === 0, sangria: k > 0,
      label: k === 0 ? p.label.toLowerCase() : p.label, inicial: p.inicial, valores: p.valores,
    } as DefFila)),
    { id: "e-tot", label: "Total", inicial: inicialL, valores: L, clave: true },
  ];

  const difInicio = d.saldoInicialFlujo - inicialL;
  const dif13 = d.titulosAlCorte === null ? null : d.titulosAlCorte - d.corte.total13;
  const b = cuenta(d, "1103");
  const dif1103 = d.corte.saldo1103 === null || !b ? null : b.saldoCorte - d.corte.saldo1103;
  const minimo = L.reduce((m, v, i) => (v < L[m] ? i : m), 0);
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Liquidez dic-${ejercicioEnUso()}`} valor={usd(L[11])} color={L[11] < 0 ? C.alerta : undefined} pie="Fondos disponibles + inversiones" />
        <Indicador titulo={`Liquidez requerida dic-${ejercicioEnUso()}`} valor={usd(d.liquidezRequerida[11])} pie="Productos de Obligaciones con el público" />
        <Indicador titulo={`Inversiones dic-${ejercicioEnUso()}`} valor={usd(d.inversiones[11])} pie={d.conRegistroInversiones ? "Títulos registrados" : "Proporción del balance"} />
        <Indicador titulo="Mes más bajo" valor={usd(L[minimo])} color={L[minimo] < 0 ? C.alerta : undefined} pie={`${MESES[minimo]}-${ejercicioEnUso()}`} />
      </div>
      <TarjetaVista titulo="Proyección de liquidez" derecha={null}>
        <Tabla filas={filas} etiquetaInicial={`Inicial ${corte}`} />
      </TarjetaVista>
      <section className="tarjeta px-4 py-3 flex flex-col gap-2 mb-6">
        <h2 className="text-[14px] font-semibold mb-1">Controles</h2>
        <Control ok={Math.abs(difInicio) < 1}>
          {Math.abs(difInicio) < 1
            ? `El Flujo de efectivo arranca con 11 + 13 del balance de partida (${usd(inicialL)}).`
            : `El saldo inicial del Flujo (${usd(d.saldoInicialFlujo)}) no coincide con 11 + 13 del balance (${usd(inicialL)}): diferencia ${usd(difInicio)}.`}
        </Control>
        {dif13 !== null ? (
          <Control ok={Math.abs(dif13) < 1}>
            {Math.abs(dif13) < 1
              ? `Los títulos registrados en Inversiones cuadran con la 13 del balance (${usd(d.corte.total13)}).`
              : `Los títulos vigentes suman ${usd(d.titulosAlCorte!)} y la 13 del balance ${usd(d.corte.total13)}: diferencia ${usd(dif13)}. Revise el registro en Inversiones.`}
          </Control>
        ) : <Control ok>Sin títulos registrados en Inversiones: la 13 mantiene su proporción del balance de partida.</Control>}
        {dif1103 !== null && Math.abs(dif1103) >= 1 && (
          <Control ok={false}>Las subcuentas de la 11 no suman el total del balance: la 1103 se ajustó en {usd(dif1103)} para cuadrar.</Control>
        )}
        {Math.abs(d.corte.total12) >= 1 && (
          <Control ok={false}>La cuenta 12 (Operaciones interfinancieras) tiene {usd(d.corte.total12)} en el balance de partida y todavía no se proyecta.</Control>
        )}
        {L.some((v) => v < 0) && (
          <Control ok={false}>La liquidez sale negativa en {MESES.filter((_, i) => L[i] < 0).join(", ")}: el Flujo de efectivo tiene más salidas que entradas.</Control>
        )}
      </section>
    </>
  );
}

// =====================================================================
// PARÁMETROS (se guardan en la base): límites de caja, % de encaje, días de bancos
// =====================================================================
interface FilaParam { agenciaId: number; agencia: string; maxCajero: number; maxCajaFuerte: number; guardado: boolean; cajaCorte: number | null }
interface DatosParam { diasCobertura: number; pctEncaje: number; agencias: FilaParam[]; error?: string }

function EditorParametros({ seccion, agencia, onEditando, onGuardado }: { seccion: "caja" | "encaje" | "bancos"; agencia: string; onEditando: (v: boolean) => void; onGuardado: () => void }) {
  const url = "/api/parametros-fondos";
  const valido = (x: DatosParam | null | undefined) => (x && x.agencias && x.pctEncaje !== undefined ? x : null);
  const [datos, setDatos] = useState<DatosParam | null>(() => valido(obtenerJSONCache<DatosParam>(url)));
  const [borrador, setBorrador] = useState<DatosParam | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [destino, setDestino] = useState<HTMLElement | null>(null);

  useEffect(() => { setDestino(document.getElementById("botones-fondos")); }, []);
  useEffect(() => {
    apiFetch(url).then((r) => r.json()).then((x: DatosParam) => {
      if (x.error || !valido(x)) setMsg({ t: x.error ?? "No se pudieron leer los parámetros.", e: true }); else { guardarJSONCache(url, x); setDatos(x); }
    }).catch(() => setMsg({ t: "Error de conexión al cargar los parámetros.", e: true }));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onEditando(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!datos) return <EsqueletoTabla filas={seccion === "caja" ? 8 : 2} />;
  const editando = borrador !== null;
  const v = borrador ?? datos;
  const cambios = borrador
    ? borrador.agencias.filter((a) => { const o = datos.agencias.find((x) => x.agenciaId === a.agenciaId)!; return o.maxCajero !== a.maxCajero || o.maxCajaFuerte !== a.maxCajaFuerte; }).length
      + (borrador.diasCobertura !== datos.diasCobertura ? 1 : 0) + (borrador.pctEncaje !== datos.pctEncaje ? 1 : 0)
    : 0;

  const editar = () => { setBorrador(JSON.parse(JSON.stringify(datos))); setTextos({}); setMsg(null); onEditando(true); };
  const cancelar = () => { setBorrador(null); setTextos({}); onEditando(false); };
  async function guardar() {
    if (!borrador) return;
    const malo = Object.entries(textos).find(([, t]) => leerMonto(t).error);
    if (malo) { setMsg({ t: `${malo[0]}: ${leerMonto(malo[1]).error}.`, e: true }); return; }
    if (borrador.pctEncaje < 0 || borrador.pctEncaje > 100) { setMsg({ t: "El % de encaje debe estar entre 0 % y 100 %.", e: true }); return; }
    if (borrador.diasCobertura < 0 || borrador.diasCobertura > 31) { setMsg({ t: "Los días de cobertura deben estar entre 0 y 31.", e: true }); return; }
    if (borrador.agencias.some((a) => a.maxCajero < 0 || a.maxCajaFuerte < 0)) { setMsg({ t: "Los montos máximos de caja no pueden ser negativos.", e: true }); return; }
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        diasCobertura: borrador.diasCobertura, pctEncaje: borrador.pctEncaje,
        agencias: borrador.agencias.map((a) => ({ agenciaId: a.agenciaId, maxCajero: a.maxCajero, maxCajaFuerte: a.maxCajaFuerte })),
      }) });
      const x = await r.json();
      if (!r.ok || x.error) throw new Error(x.error ?? "No se pudo guardar.");
      setDatos(borrador); setBorrador(null); setTextos({}); onEditando(false);
      setMsg({ t: "Parámetros guardados. Fondos disponibles, el Flujo y el Balance ya usan estos valores." });
      setVersion((n) => n + 1);
      onGuardado();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : "Error de conexión.", e: true });
    } finally { setGuardando(false); }
  }

  // Formato Ecuador (lib/numeros.ts): lo que no se puede leer queda en rojo y no se aplica
  const entrada = (k: string, valor: number, cambiado: boolean, aplicar: (n: number) => void, ancho = 120, decimal = false) => {
    const error = textos[k] !== undefined ? leerMonto(textos[k]).error : null;
    return (
      <input value={textos[k] ?? (valor ? valor.toLocaleString("es-EC", { maximumFractionDigits: decimal ? 2 : 0 }) : "")} inputMode="decimal" placeholder="0" aria-label={k}
             aria-invalid={!!error} title={error ?? undefined}
             onChange={(e) => { const t = e.target.value; setTextos((x) => ({ ...x, [k]: t })); const r = leerMonto(t); if (!r.error) aplicar(r.valor ?? 0); }}
             onBlur={() => { if (!error) setTextos((x) => { const n = { ...x }; delete n[k]; return n; }); }}
             className="h-7 rounded px-2 text-right text-[12px]"
             style={{ width: ancho, border: `1px solid ${error ? "#B42318" : cambiado ? C.acento : "#C9D0CC"}`, background: error ? "#FDF2F1" : cambiado ? C.acentoSuave : "#FFFFFF" }} />
    );
  };
  const setAg = (id: number, campo: "maxCajero" | "maxCajaFuerte", n: number) =>
    setBorrador((b) => (b ? { ...b, agencias: b.agencias.map((a) => (a.agenciaId === id ? { ...a, [campo]: n } : a)) } : b));

  const th = "px-4 py-2.5 font-semibold";
  const tot = (a: FilaParam) => a.maxCajero + a.maxCajaFuerte;
  const botones = <BotonesSeccion editando={editando} cambios={cambios} guardando={guardando} onEditar={editar} onCancelar={cancelar} onGuardar={guardar} />;
  const aviso = seccion === "caja" ? "El límite de caja es la suma de los montos máximos de cajeros y de caja fuerte de cada agencia."
    : seccion === "encaje" ? "El % de encaje aplica a todas las agencias: lo usan la 1102 y las Reservas de liquidez requeridas del Flujo de efectivo."
    : "Los días de pagos que deben quedar en bancos aplican a todas las agencias.";

  return (
    <>
      {destino && createPortal(botones, destino)}
      {(editando || msg) && (
        <div className="flex flex-col gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
          {editando && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded text-[12px]" style={{ background: C.avisoSuave, color: C.aviso }}>
              <Pencil size={13} /> {aviso}
            </div>
          )}
          {msg && <p className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</p>}
        </div>
      )}
      {seccion === "caja" ? (
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ color: C.cabeceraTexto, boxShadow: `inset 0 -1px 0 ${C.beige}` }}>
              <th className={`${th} text-left`}>Agencia</th>
              <th className={`${th} text-right`}>Máximo cajeros automáticos</th>
              <th className={`${th} text-right`}>Máximo caja fuerte</th>
              <th className={`${th} text-right`}>Límite de caja</th>
              <th className={`${th} text-right`}>Caja al corte</th>
              <th className={`${th} text-right`}>Sobre el límite</th>
            </tr>
          </thead>
          <tbody>
            {v.agencias.map((a) => {
              const o = datos.agencias.find((x) => x.agenciaId === a.agenciaId)!;
              const lim = tot(a);
              const sobre = a.cajaCorte !== null && lim > 0 ? a.cajaCorte - lim : null;
              return (
                <tr key={a.agenciaId} style={{ borderTop: `1px solid ${C.beige}`, height: editando ? 38 : 34, fontWeight: a.agencia === agencia ? 600 : 400 }}>
                  <td className="px-4" style={{ color: C.texto }}>{a.agencia}</td>
                  <td className="px-4 text-right">{editando ? entrada(`Máximo cajeros ${a.agencia}`, a.maxCajero, a.maxCajero !== o.maxCajero, (n) => setAg(a.agenciaId, "maxCajero", n)) : cifraParam(a.maxCajero)}</td>
                  <td className="px-4 text-right">{editando ? entrada(`Máximo caja fuerte ${a.agencia}`, a.maxCajaFuerte, a.maxCajaFuerte !== o.maxCajaFuerte, (n) => setAg(a.agenciaId, "maxCajaFuerte", n)) : cifraParam(a.maxCajaFuerte)}</td>
                  <td className="px-4 text-right" style={{ color: lim ? C.texto : C.tenue }}>{lim ? usd(lim) : "Sin límite"}</td>
                  <td className="px-4 text-right" style={{ color: a.cajaCorte === null ? C.tenue : C.texto3 }}>{a.cajaCorte === null ? "Sin balance" : usd(a.cajaCorte)}</td>
                  <td className="px-4 text-right" style={{ color: sobre !== null && sobre > 0 ? C.alerta : C.tenue, fontWeight: sobre !== null && sobre > 0 ? 600 : undefined }}>
                    {sobre === null ? "—" : sobre > 0 ? usd(sobre) : "Dentro"}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: `1px solid ${C.borde}`, background: "#F8FAF9", height: 36 }} className="font-semibold">
              <td className="px-4">Total</td>
              <td className="px-4 text-right">{usd(v.agencias.reduce((t, a) => t + a.maxCajero, 0))}</td>
              <td className="px-4 text-right">{usd(v.agencias.reduce((t, a) => t + a.maxCajaFuerte, 0))}</td>
              <td className="px-4 text-right">{usd(v.agencias.reduce((t, a) => t + tot(a), 0))}</td>
              <td className="px-4 text-right">{usd(v.agencias.reduce((t, a) => t + (a.cajaCorte ?? 0), 0))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 text-[12px]" style={{ height: editando ? 44 : 40, color: C.texto3 }}>
          <span>{seccion === "encaje" ? "% de encaje BCE sobre las captaciones proyectadas" : "Días hábiles de pagos que deben quedar en bancos"}</span>
          <span className="font-semibold" style={{ color: C.texto }}>
            {seccion === "encaje"
              ? (editando ? entrada("% de encaje", v.pctEncaje, v.pctEncaje !== datos.pctEncaje, (n) => setBorrador((b) => (b ? { ...b, pctEncaje: n } : b)), 80, true) : `${v.pctEncaje.toLocaleString("es-EC", { maximumFractionDigits: 2 })} %`)
              : (editando ? entrada("Días de cobertura", v.diasCobertura, v.diasCobertura !== datos.diasCobertura, (n) => setBorrador((b) => (b ? { ...b, diasCobertura: n } : b)), 80, true) : `${numDias(v.diasCobertura)} días`)}
          </span>
        </div>
      )}
    </>
  );
}
