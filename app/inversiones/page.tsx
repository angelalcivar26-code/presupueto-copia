"use client";

import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { leerMonto } from "../../lib/numeros";
import { apiFetch } from "../../lib/useDatos";
import { VentanaFormulario, SeccionForm, CampoForm, CAMPO, BORDE } from "../../components/VentanaFormulario";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Pencil, Check, Plus, Trash2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

// =====================================================================
// CONFIGURACIÓN (misma paleta y componentes de Cartera, Obligaciones y Patrimonio)
// =====================================================================

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

// Paleta institucional (misma de Cartera): texto casi negro, verde #005A28, fondo gris claro y tarjetas blancas.
const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#7A847F",
  borde: "#DDE2DF", beige: "#E6EAE8", crema: "#F3F5F4",
  cabecera: "#FFFFFF", cabeceraTexto: "#3D4843",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", aviso: "#B7791F", avisoSuave: "#FBF1DC", alerta: "#B42318",
};
const FONDO = "#EEF1EF";
const BORDE_EDICION = "#8DB39B";
/** Selecciones: verde institucional suave. */
const CHIP_ON = { background: C.acentoSuave, color: C.acento };
const CHIP_OFF = { background: "transparent", color: C.texto2 };

const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);
// Negativos entre paréntesis (convención contable)
function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
const etiquetaCorte = (c: { anio: number; mes: number }) => `${MESES[c.mes - 1].toLowerCase()}-${String(c.anio).slice(2)}`;
const cifra = (v: number) => (Math.round(v) === 0 ? "—" : numero(v));

const TABLA = "w-full table-fixed text-[11px] border-collapse";
function Columnas() {
  return (
    <colgroup>
      <col style={{ width: 225 }} />
      {MESES.map((m) => <col key={m} />)}
      <col style={{ width: 86 }} />
      <col style={{ width: 25 }} />
    </colgroup>
  );
}

function BotonesSeccion({ editando, cambios, guardando, onEditar, onCancelar, onGuardar }: {
  editando: boolean; cambios: number; guardando: boolean; onEditar: () => void; onCancelar: () => void; onGuardar: () => void;
}) {
  if (!editando) {
    return (
      <button type="button" onClick={onEditar} className="h-9 px-3.5 rounded-md bg-white text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#F3F5F4]"
              style={{ border: "1px solid #C9D0CC", color: C.texto }}>
        <Pencil size={13} /> Editar
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancelar} disabled={guardando} className="h-9 px-3.5 rounded-md bg-white text-[12px] font-semibold disabled:opacity-50"
              style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
      <button type="button" onClick={onGuardar} disabled={guardando || cambios === 0}
              className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.acento }}>
        <Check size={13} /> {guardando ? "Guardando..." : cambios ? `Guardar ${cambios} ${cambios === 1 ? "cambio" : "cambios"}` : "Guardar"}
      </button>
    </div>
  );
}

function BotonF({ abierto, onClick, titulo }: { abierto: boolean; onClick: () => void; titulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={abierto} title={titulo} aria-label={titulo}
            className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
            style={abierto ? CHIP_ON : { color: C.tenue }}>ƒ</button>
  );
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

function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: ReactNode; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}

/** Filas de una tabla de 12 meses con ƒ en la etiqueta y panel de fórmula abajo. */
interface DefFila {
  id: string; label: string; valores: number[]; total: number | null; clave?: boolean; tenue?: boolean;
  color?: "ok" | "alerta"; // incrementos en verde, reducciones en rojo (como en Cartera)
  totalConSigno?: boolean;  // la última columna en verde si sube y en rojo si baja
  separador?: boolean; formula?: (i: number) => string; onClick?: () => void;
}
function TablaMeses({ titulo, ultima, filas, grupos }: {
  titulo: ReactNode; ultima: string; filas: DefFila[]; grupos?: Record<string, string>;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mes, setMes] = useState(11);
  const fila = filas.find((f) => f.id === abierta) ?? null;
  return (
    <div>
      <table className={TABLA}>
        <Columnas />
        <thead>
          <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
            <th className="pl-4 text-left font-semibold">{titulo}</th>
            {MESES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
            <th className="px-2 text-right font-semibold">{ultima}</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {filas.map((f, k) => {
            const grupo = grupos?.[f.id];
            // El título del grupo va en la misma fila (sin filas vacías) y con un espacio blanco antes del grupo siguiente.
            const borde = grupo ? (k === 0 ? "none" : "1px solid #DDE2DF") : f.clave ? "1px solid #B9C3BD" : f.separador ? "1px solid #DDE2DF" : `1px solid ${C.beige}`;
            const fuerte = !!grupo || !!f.clave;
            return (
              <FilaGrupo key={f.id} espacio={!!grupo && k > 0}>
                <tr onClick={f.onClick} className={f.onClick ? "cursor-pointer hover:bg-[#F5F7F6]" : "hover:bg-[#F5F7F6]"}
                    style={{ borderTop: borde, height: 32, fontWeight: fuerte ? 600 : 400 }}>
                  <td className="pl-4">
                    <span className="flex items-center gap-1.5 pr-2 min-w-0">
                      {grupo ? (
                        <span className="flex-1 min-w-0 flex items-baseline gap-1.5 whitespace-nowrap overflow-hidden" title={`${grupo} · ${f.label}`}>
                          <span className="text-[12px] font-bold shrink-0" style={{ color: C.acento }}>{grupo}</span>
                          <span className="text-[11px] font-normal truncate" style={{ color: C.texto2 }}>· {f.label.toLowerCase()}</span>
                        </span>
                      ) : (
                        <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]" title={f.label}
                              style={{ color: f.clave ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>{f.label}</span>
                      )}
                    </span>
                  </td>
                  {f.valores.map((v, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: Math.round(v) === 0 ? C.tenue : f.color ? C[f.color] : fuerte ? C.texto : f.tenue ? C.texto2 : C.texto3 }}>{cifra(v)}</td>
                  ))}
                  <td className="px-2 text-right whitespace-nowrap font-semibold" style={{ color: f.total === null || Math.round(f.total) === 0 ? C.tenue : f.color ? C[f.color] : f.totalConSigno ? (f.total > 0 ? C.ok : C.alerta) : C.texto }}>
                    {f.total === null ? "" : cifra(f.total)}
                  </td>
                  {/* ƒ al final de la fila, como en Cartera */}
                  <td className="text-center">
                    {f.formula && <BotonF abierto={abierta === f.id} onClick={() => setAbierta(abierta === f.id ? null : f.id)} titulo={`Fórmula de ${f.label}`} />}
                  </td>
                </tr>
              </FilaGrupo>
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
function FilaGrupo({ espacio, children }: { espacio: boolean; children: ReactNode }) {
  return (
    <>
      {espacio && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={15} /></tr>}
      {children}
    </>
  );
}

// =====================================================================
// INVERSIONES (cuenta 13): registro de títulos, renovación automática y liquidez
// =====================================================================

const SECTORES = ["Financiero popular y solidario", "Privado", "Público"];
interface Titulo {
  id?: number; institucion: string; sector: string; cuentaCodigo: string; cuentaNombre: string;
  fechaInicio: string; fechaFin: string; monto: number; tasaAnual: number; cancelaMes: number | null;
}
interface TituloCalc extends Titulo {
  planificada: boolean; dias: number; interesMensual: number; interesPeriodo: number; retencion: number; netoRenovar: number;
  capitalPorMes: number[]; interesPorMes: number[]; renovacionesEnAnio: number; interesAntesDeEnero: number; valorCancelado: number;
  agencia?: string;
}
interface Proyeccion {
  titulos: TituloCalc[]; capitalPorMes: number[]; porCuenta: Record<string, { nombre: string; valores: number[] }>;
  interesDevengadoPorMes: number[]; interesPendientePorMes: number[]; retencionAcumuladaPorMes: number[];
  nuevasPorMes: number[]; canceladasPorMes: number[]; capitalizadoPorMes: number[]; retencionPorMes: number[]; capitalAlCorte: number;
  interesPorCobrarInicial: number; variacion16PorMes: number[];
}
interface Datos {
  titulos: Titulo[]; parametros: { pctRetencion: number; baseDias: number }; proyeccion: Proyeccion;
  corte: { anio: number; mes: number }; fechaCorte: string; saldo13Corte: number | null;
  cuentas13: { codigo: string; nombre: string; saldoCorte: number | null }[]; error?: string;
}
type Pestana = "resumen" | "registro";

const fechaCorta = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const usd2 = (v: number) => { const s = "$" + Math.abs(v).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return v < 0 ? `(${s})` : s; };
const tituloVacio = (): Titulo => ({ institucion: "", sector: SECTORES[1], cuentaCodigo: "", cuentaNombre: "", fechaInicio: "", fechaFin: "", monto: 0, tasaAnual: 0, cancelaMes: null });

export default function InversionesPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [version, setVersion] = useState(0);
  const ticketSync = useEscucharSincronizacion();

  const url = `/api/inversiones?agencia=${encodeURIComponent(agencia)}`;
  const cached = obtenerJSONCache<Datos>(url);

  const [datos, setDatos] = useState<Datos | null>(() => cached ?? null);
  const [cargando, setCargando] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = obtenerJSONCache<Datos>(url);
    if (enCache) {
      setDatos(enCache);
      setCargando(false);
    } else {
      setDatos(null);
      setCargando(true);
    }
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((d: Datos) => {
        if (!vivo) return;
        if (d.error || !d.proyeccion) {
          if (!enCache) setError(d.error ?? "No se pudieron leer las inversiones.");
        } else {
          guardarJSONCache(url, d);
          setDatos(d);
        }
      })
      .catch(() => {
        if (vivo && !enCache) setError("Error de conexión al cargar las inversiones.");
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [agencia, version, ticketSync]);

  const corte = datos ? etiquetaCorte(datos.corte) : null;

  const tabs: { id: Pestana; label: string }[] = [{ id: "resumen", label: "Resumen" }, { id: "registro", label: "Registro de inversiones" }];

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      {/* Encabezado: título y, a la derecha, la fecha de los saldos de partida */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Inversiones<AnioEjercicio /></h1>
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones de inversiones" className="flex gap-7 flex-1">
          {tabs.map((t) => (
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

      {pestana === "resumen" && datos && !cargando && <Indicadores d={datos} />}

      {cargando ? <EsqueletoTabla filas={8} />
        : error ? <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
        : !datos ? null
        : pestana === "resumen" ? <Resumen d={datos} corte={corte} soloLectura={agencia === "Consolidado"} onRegistro={() => setPestana("registro")} />
        : <Registro d={datos} agencia={agencia} corte={corte} soloLectura={agencia === "Consolidado"} onCambio={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

// ---------------- indicadores ----------------
function Indicadores({ d }: { d: Datos }) {
  const p = d.proyeccion;
  const vig = p.titulos.filter((t) => !t.planificada);
  const plan = p.titulos.length - vig.length;
  const tasaProm = p.capitalAlCorte ? vig.reduce((a, t) => a + t.monto * t.tasaAnual, 0) / p.capitalAlCorte : 0;
  const varAnio = p.capitalPorMes[11] - p.capitalAlCorte;
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <Indicador titulo={`Inversiones dic-${ejercicioEnUso()}`} valor={usd(p.capitalPorMes[11])}
        pie={`${varAnio >= 0 ? "Suben" : "Bajan"} ${usd(Math.abs(varAnio))} en el año`} />
      <Indicador titulo={`Intereses ${ejercicioEnUso()} (5103)`} valor={usd(suma(p.interesDevengadoPorMes))} pie={`Retención ${usd(suma(p.retencionPorMes))}`} />
      <Indicador titulo="Tasa promedio al corte" valor={`${(tasaProm * 100).toFixed(2).replace(".", ",")} %`} pie="Ponderada por monto" />
      <Indicador titulo="Títulos" valor={String(p.titulos.length)}
        pie={`${vig.length} ${vig.length === 1 ? "vigente" : "vigentes"} al corte${plan ? ` · ${plan} ${plan === 1 ? "planificado" : "planificados"}` : ""}`} />
    </div>
  );
}

// ---------------- interés por título: sector e institución combinados ----------------
const sectorCorto = (x: string) => (x === "Financiero popular y solidario" ? "Popular y solidario" : x);
function TablaInteres({ titulos, agencias, abiertas, onAlternar, total }: {
  titulos: TituloCalc[]; agencias: string[]; abiertas: Set<string>; onAlternar: (a: string) => void; total: number[];
}) {
  const linea = `1px solid ${C.beige}`;
  // filas de títulos ordenadas por sector, institución y tasa; sector e institución en celdas combinadas
  const filas = (ts: TituloCalc[], k0: string) => {
    const o = [...ts].sort((a, b) => sectorCorto(a.sector).localeCompare(sectorCorto(b.sector)) || a.institucion.localeCompare(b.institucion) || b.tasaAnual - a.tasaAnual);
    return o.map((t, k) => {
      const primSector = k === 0 || sectorCorto(o[k - 1].sector) !== sectorCorto(t.sector);
      const primInst = primSector || o[k - 1].institucion !== t.institucion;
      const nSector = o.filter((x) => sectorCorto(x.sector) === sectorCorto(t.sector)).length;
      const nInst = o.filter((x) => sectorCorto(x.sector) === sectorCorto(t.sector) && x.institucion === t.institucion).length;
      return (
        <tr key={`${k0}-${t.id ?? k}`} className="hover:bg-[#F5F7F6]" style={{ height: 30, color: C.texto3 }}>
          {primSector && <td rowSpan={nSector} className="px-2 text-center align-middle" style={{ borderTop: linea, borderRight: linea, color: C.texto2 }}>{sectorCorto(t.sector)}</td>}
          {primInst && <td rowSpan={nInst} className="px-2 text-center align-middle" style={{ borderTop: linea, borderRight: linea, color: C.texto }}>{t.institucion}</td>}
          <td className="px-2 text-right whitespace-nowrap" style={{ borderTop: linea }} title={`${t.institucion} · ${fechaCorta(t.fechaInicio)} → ${fechaCorta(t.fechaFin)} · ${numero(t.monto)}`}>{(t.tasaAnual * 100).toFixed(2).replace(".", ",")} %</td>
          {t.interesPorMes.map((v, i) => <td key={i} className="px-1 text-right" style={{ borderTop: linea, color: Math.round(v) === 0 ? C.tenue : undefined }}>{cifra(v)}</td>)}
          <td className="px-2 text-right" style={{ borderTop: linea, color: C.texto }}>{cifra(suma(t.interesPorMes))}</td>
        </tr>
      );
    });
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[11px] min-w-[1000px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <colgroup><col style={{ width: 132 }} /><col style={{ width: 120 }} /><col style={{ width: 60 }} />{MESES.map((m) => <col key={m} />)}<col style={{ width: 86 }} /></colgroup>
        <thead>
          <tr className="font-semibold" style={{ color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
            <th className="pl-4 pr-2 text-left font-semibold">{agencias.length ? "Agencia / sector" : "Sector"}</th>
            <th className="px-2 text-center font-semibold">Institución</th><th className="px-2 text-right font-semibold">Tasa</th>
            {MESES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
            <th className="px-2 text-right font-semibold">Año</th>
          </tr>
        </thead>
        <tbody>
          {agencias.length ? agencias.map((a) => {
            const ts = titulos.filter((t) => (t.agencia ?? "—") === a);
            const v = MESES.map((_, i) => ts.reduce((x, t) => x + t.interesPorMes[i], 0));
            const ab = abiertas.has(a);
            return (
              <Fragment key={a}>
                <tr onClick={() => onAlternar(a)} className="cursor-pointer hover:bg-[#F5F7F6] font-semibold" style={{ borderTop: "1px solid #DDE2DF", height: 32, color: C.texto }}>
                  <td colSpan={3} className="pl-3 pr-2"><span className="inline-flex items-center gap-1.5">{ab ? <ChevronDown size={13} color={C.acento} /> : <ChevronRight size={13} color={C.acento} />}{a}</span></td>
                  {v.map((x, i) => <td key={i} className="px-1 text-right">{cifra(x)}</td>)}
                  <td className="px-2 text-right">{cifra(suma(v))}</td>
                </tr>
                {ab && filas(ts, a)}
              </Fragment>
            );
          }) : filas(titulos, "t")}
          <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 34, color: C.texto }}>
            <td colSpan={3} className="pl-4">Total interés (5103)</td>
            {total.map((x, i) => <td key={i} className="px-1 text-right">{cifra(x)}</td>)}
            <td className="px-2 text-right">{cifra(suma(total))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------- resumen ----------------
type Vista = "movimiento" | "interes" | "cuentas";
const VISTAS: { id: Vista; label: string }[] = [
  { id: "movimiento", label: "Inversiones" },
  { id: "interes", label: "Interés por título" },
  { id: "cuentas", label: "Saldo por cuenta" },
];

function Resumen({ d, corte, soloLectura, onRegistro }: { d: Datos; corte: string | null; soloLectura: boolean; onRegistro: () => void }) {
  const p = d.proyeccion;
  const [vista, setVista] = useState<Vista>("movimiento");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  if (!p.titulos.length) {
    return (
      <div className="tarjeta px-6 py-8 flex flex-col items-center gap-2 text-center">
        <span className="text-[14px] font-semibold">{soloLectura ? "Ninguna agencia tiene inversiones registradas" : "Esta agencia no tiene inversiones registradas"}</span>
        <span className="text-[12px] max-w-[504px]" style={{ color: C.texto2 }}>
          Mientras no haya títulos, el Balance mantiene la 13 con la proporción del balance de partida y el interés 5103 queda en cero.
        </span>
        {!soloLectura && <button type="button" onClick={onRegistro} className="mt-2 h-9 px-4 rounded-md text-white text-[12px] font-semibold" style={{ background: C.acento }}>Registrar inversiones</button>}
      </div>
    );
  }
  const si = MESES.map((_, i) => (i === 0 ? p.capitalAlCorte : p.capitalPorMes[i - 1]));
  const canc = MESES.map((_, i) => si[i] + p.nuevasPorMes[i] + p.capitalizadoPorMes[i] - p.capitalPorMes[i]);
  const movimiento: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: si, total: p.capitalAlCorte,
      formula: (i) => (i === 0 ? `Suma de los títulos vigentes al corte${corte ? ` (${corte})` : ""}: ${usd(p.capitalAlCorte)}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "nu", label: "(+) Nuevas inversiones", valores: p.nuevasPorMes, total: suma(p.nuevasPorMes), color: "ok",
      formula: (i) => `Títulos planificados que empiezan en ${MESES[i]} (fecha de inicio posterior al corte): ${usd(p.nuevasPorMes[i])}. Salen de fondos disponibles.` },
    { id: "ca", label: "(+) Interés capitalizado al renovar", valores: p.capitalizadoPorMes, total: suma(p.capitalizadoPorMes), color: "ok",
      formula: (i) => `Títulos que vencen en ${MESES[i]}: interés de todo el período (también los días antes de enero) − retención se suma al capital = ${usd(p.capitalizadoPorMes[i])}.` },
    { id: "cn", label: "(−) Cancelaciones", valores: canc.map((v) => -v), total: -suma(canc), color: "alerta",
      formula: (i) => `Títulos marcados "se cancela en" ${MESES[i]}: el capital vuelve a fondos disponibles = ${usd(canc[i])}.` },
    { id: "sf", label: "Saldo final", valores: p.capitalPorMes, total: p.capitalPorMes[11], clave: true,
      formula: (i) => `Saldo inicial + nuevas + interés capitalizado − cancelaciones = ${usd(si[i])} + ${usd(p.nuevasPorMes[i])} + ${usd(p.capitalizadoPorMes[i])} − ${usd(canc[i])} = ${usd(p.capitalPorMes[i])}. Llega al Balance como 13.` },
    { id: "in", label: "Interés devengado · 5103", valores: p.interesDevengadoPorMes, total: suma(p.interesDevengadoPorMes), separador: true,
      formula: (i) => `Suma de cada día del mes: capital × tasa ÷ ${d.parametros.baseDias}, de todos los títulos = ${usd(p.interesDevengadoPorMes[i])}. Llega al Estado de resultados (5103) aunque se cobre al vencer.` },
  ];
  // Consolidado: una fila por agencia que se abre para ver sus títulos (por sector e institución)
  const agenciasTit = soloLectura ? [...new Set(p.titulos.map((t) => t.agencia ?? "—"))] : [];
  const cuentas: DefFila[] = [
    ...Object.entries(p.porCuenta).map(([cod, c]) => ({ id: cod, label: `${cod} · ${c.nombre || "sin nombre"}`, valores: c.valores, total: c.valores[11] })),
    { id: "tot", label: "Total cuenta 13", valores: p.capitalPorMes, total: p.capitalPorMes[11], clave: true },
  ];
  return (
    <div className="flex flex-col gap-5 pb-6">
      <section className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
          {vista === "interes" && soloLectura && agenciasTit.length > 0 && (() => {
            const todas = agenciasTit.every((a) => abiertas.has(a));
            return (
              <button type="button" onClick={() => setAbiertas(todas ? new Set() : new Set(agenciasTit))} aria-label={todas ? "Cerrar todas" : "Abrir todas"} title={todas ? "Cerrar todas" : "Abrir todas"}
                className="w-8 h-8 rounded-md inline-flex items-center justify-center hover:bg-[#F3F5F4]" style={{ color: C.texto2 }}>
                {todas ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
              </button>
            );
          })()}
          <div role="tablist" aria-label="Detalle de inversiones" className="flex flex-wrap gap-1 p-1 rounded-lg" style={{ background: C.crema }}>
            {VISTAS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} onClick={() => setVista(v.id)}
                      className="h-8 px-3.5 rounded-md text-[12px] transition-colors"
                      style={vista === v.id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {vista === "movimiento" && <TablaMeses key="m" titulo="Inversiones" ultima="Año / Dic" filas={movimiento} />}
        {vista === "interes" && <TablaInteres titulos={p.titulos} agencias={soloLectura ? agenciasTit : []} abiertas={abiertas} total={p.interesDevengadoPorMes}
          onAlternar={(a) => setAbiertas((s0) => { const n = new Set(s0); if (n.has(a)) n.delete(a); else n.add(a); return n; })} />}
        {vista === "cuentas" && <TablaMeses key="c" titulo="Cuenta" ultima="Dic" filas={cuentas} />}
      </section>
    </div>
  );
}

// ---------------- registro ----------------
function Registro({ d, agencia, corte, soloLectura, onCambio }: { d: Datos; agencia: string; corte: string | null; soloLectura: boolean; onCambio: () => void }) {
  const p = d.proyeccion;
  const [form, setForm] = useState<Titulo | null>(null);
  const [tasaTxt, setTasaTxt] = useState(""); const [montoTxt, setMontoTxt] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [borrar, setBorrar] = useState<TituloCalc | null>(null);
  const [filtro, setFiltro] = useState<"vigentes" | "canceladas" | "todas">("vigentes");
  const [agrupar, setAgrupar] = useState<"agencia" | "sector" | "institucion">(soloLectura ? "agencia" : "sector");
  const [vence, setVence] = useState(""); // "" = todos · "corte" = vencidos al corte · "AAAA-MM" = vencen ese mes
  const [abiertosG, setAbiertosG] = useState<Set<string>>(new Set());
  const [editPar, setEditPar] = useState(false);
  const [ret, setRet] = useState(String(d.parametros.pctRetencion * 100).replace(".", ","));
  const [base, setBase] = useState(d.parametros.baseDias);
  // Al cambiar de agencia (o recargar), los parámetros mostrados vuelven a los guardados de esa agencia
  const [paramsDe, setParamsDe] = useState(`${agencia}|${d.parametros.pctRetencion}|${d.parametros.baseDias}`);
  const claveParams = `${agencia}|${d.parametros.pctRetencion}|${d.parametros.baseDias}`;
  if (paramsDe !== claveParams) {
    setParamsDe(claveParams);
    setRet(String(d.parametros.pctRetencion * 100).replace(".", ","));
    setBase(d.parametros.baseDias);
    setEditPar(false);
    setForm(null); // un formulario abierto de otra agencia no se guarda en esta
  }

  // vencimiento: el fin del período registrado; los que vencían antes del corte hay que revisarlos (¿se renovaron o se cancelaron?)
  const vencidoAlCorte = (t: TituloCalc) => t.fechaFin.slice(0, 10) <= d.fechaCorte;
  const base0 = vence === "" ? p.titulos : vence === "corte" ? p.titulos.filter(vencidoAlCorte) : p.titulos.filter((t) => t.fechaFin.slice(0, 7) === vence);
  const mesesVence = [...new Set(p.titulos.map((t) => t.fechaFin.slice(0, 7)))].sort();
  const nVencidos = p.titulos.filter(vencidoAlCorte).length;
  const nCanc = base0.filter((t) => t.cancelaMes).length;
  const nVig = base0.length - nCanc;
  const lista = filtro === "todas" ? base0 : base0.filter((t) => (filtro === "canceladas" ? !!t.cancelaMes : !t.cancelaMes));
  const enCanceladas = filtro === "canceladas";
  const tot = (fn: (t: TituloCalc) => number, l = lista) => l.reduce((a, t) => a + fn(t), 0);
  const montoLista = tot((t) => t.monto);
  const cuadre = d.saldo13Corte === null ? null : p.capitalAlCorte - d.saldo13Corte;

  function abrir(t?: TituloCalc) {
    const base = t ? { ...t } : tituloVacio();
    setForm({ id: base.id, institucion: base.institucion, sector: base.sector, cuentaCodigo: base.cuentaCodigo, cuentaNombre: base.cuentaNombre,
      fechaInicio: base.fechaInicio, fechaFin: base.fechaFin, monto: base.monto, tasaAnual: base.tasaAnual, cancelaMes: base.cancelaMes });
    setTasaTxt(t ? String(Math.round(t.tasaAnual * 10000) / 100).replace(".", ",") : "");
    setMontoTxt(t ? String(t.monto).replace(".", ",") : "");
    setMsg(null);
  }
  async function pedir(body: unknown) {
    const r = await apiFetch("/api/inversiones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
  }
  async function guardar() {
    if (!form) return;
    const lm = leerMonto(montoTxt), lt = leerMonto(tasaTxt);
    if (lm.error || lm.valor === null) { setMsg({ t: `Monto: ${lm.error ?? "escriba el monto"}.`, e: true }); return; }
    if (lm.valor <= 0) { setMsg({ t: "El monto debe ser mayor a 0.", e: true }); return; }
    if (lt.error || lt.valor === null) { setMsg({ t: `Tasa: ${lt.error ?? "escriba la tasa"}.`, e: true }); return; }
    if (lt.valor < 0 || lt.valor > 30) { setMsg({ t: "La tasa anual debe estar entre 0 % y 30 %.", e: true }); return; }
    const monto = lm.valor, tasa = lt.valor;
    if (guardando) return;
    setGuardando(true); setMsg(null);
    try {
      await pedir({ accion: "guardar", agencia, titulo: { ...form, monto, tasaAnual: tasa } });
      setForm(null); setMsg({ t: "Inversión guardada. Balance, Estado de resultados (5103) y Flujo ya la usan." }); onCambio();
    } catch (e) { setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setGuardando(false); }
  }
  async function eliminar(t: TituloCalc) {
    try { await pedir({ accion: "eliminar", agencia, id: t.id }); setBorrar(null); setMsg({ t: `Inversión de ${t.institucion} eliminada.` }); onCambio(); }
    catch (e) { setBorrar(null); setMsg({ t: `No se pudo eliminar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
  }
  async function guardarParametros() {
    const lr = leerMonto(ret);
    if (lr.error || lr.valor === null || lr.valor < 0 || lr.valor > 100) { setMsg({ t: `% de retención: ${lr.error ?? "debe estar entre 0 % y 100 %"}.`, e: true }); return; }
    if (guardando) return;
    setGuardando(true);
    try { await pedir({ accion: "parametros", agencia, pctRetencion: lr.valor, baseDias: base }); setEditPar(false); onCambio(); }
    catch (e) { setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setGuardando(false); }
  }

  const TH = "px-1.5 font-semibold whitespace-nowrap";

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* Parámetros (en Consolidado no se editan: son por agencia) */}
      {soloLectura ? null : (
      <div className="tarjeta flex flex-wrap items-center gap-4 px-4 py-3" style={editPar ? { borderColor: BORDE_EDICION, boxShadow: `0 0 0 2px ${C.acentoSuave}` } : undefined}>
        <span className="text-[14px] font-semibold flex-1">Parámetros de la agencia</span>
        <span className="text-[12px] flex items-center gap-2" style={{ color: C.texto2 }}>Retención sobre el interés
          {editPar ? <input value={ret} onChange={(e) => setRet(e.target.value)} inputMode="decimal" aria-label="Retención (%)" className="w-[63px] h-9 rounded-md px-2 text-right" style={{ border: `1px solid ${BORDE_EDICION}` }} />
            : <b style={{ color: C.texto }}>{(d.parametros.pctRetencion * 100).toFixed(2).replace(".", ",")} %</b>}
        </span>
        <span className="text-[12px] flex items-center gap-2" style={{ color: C.texto2 }}>Base
          {editPar ? (
            <select value={base} onChange={(e) => setBase(Number(e.target.value))} aria-label="Base de días" className="h-9 rounded-md px-2" style={{ border: `1px solid ${BORDE_EDICION}` }}>
              <option value={360}>360 días</option><option value={365}>365 días</option>
            </select>
          ) : <b style={{ color: C.texto }}>{d.parametros.baseDias} días</b>}
        </span>
        <BotonesSeccion editando={editPar} cambios={editPar ? 1 : 0} guardando={guardando}
          onEditar={() => setEditPar(true)} onCancelar={() => { setEditPar(false); setRet(String(d.parametros.pctRetencion * 100).replace(".", ",")); setBase(d.parametros.baseDias); }}
          onGuardar={guardarParametros} />
      </div>
      )}

      {form && !soloLectura && (
        <VentanaFormulario titulo={form.id ? "Editar inversión" : "Registrar inversión"} onCerrar={() => setForm(null)} onGuardar={guardar} guardando={guardando}
          error={msg?.e ? msg.t : null}
          pie={form.fechaInicio && form.fechaFin && form.fechaFin > form.fechaInicio
            ? `${Math.round((Date.parse(form.fechaFin) - Date.parse(form.fechaInicio)) / 86400000)} días · ${form.fechaInicio > d.fechaCorte ? "planificada: se fondea con fondos disponibles en su fecha de inicio" : "vigente al corte"}`
            : "Con fecha fin posterior a la de inicio se calculan los días."}>
          <SeccionForm t="Inversión">
            <CampoForm label="Institución" span={2}>
              <input value={form.institucion} onChange={(e) => setForm({ ...form, institucion: e.target.value })} className={CAMPO} style={BORDE} placeholder="Ej. Banco A" />
            </CampoForm>
            <CampoForm label="Sector" span={2}>
              <select value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} className={CAMPO} style={BORDE}>
                {SECTORES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </CampoForm>
            <CampoForm label="Cuenta contable (grupo 13)" span={4}>
              <select value={form.cuentaCodigo} className={CAMPO} style={BORDE}
                      onChange={(e) => { const c = d.cuentas13.find((x) => x.codigo === e.target.value); setForm({ ...form, cuentaCodigo: e.target.value, cuentaNombre: c?.nombre ?? "" }); }}>
                <option value="">Seleccionar...</option>
                {d.cuentas13.filter((c) => c.codigo.length >= 6).map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                {form.cuentaCodigo && !d.cuentas13.some((c) => c.codigo === form.cuentaCodigo) && <option value={form.cuentaCodigo}>{form.cuentaCodigo} · {form.cuentaNombre}</option>}
              </select>
            </CampoForm>
          </SeccionForm>
          <SeccionForm t="Plazo">
            <CampoForm label="Fecha inicio">
              <input type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} className={CAMPO} style={BORDE} />
            </CampoForm>
            <CampoForm label="Fecha fin">
              <input type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} className={CAMPO} style={BORDE} />
            </CampoForm>
            <CampoForm label="Se cancela en" span={2}>
              <select value={form.cancelaMes ?? ""} onChange={(e) => setForm({ ...form, cancelaMes: e.target.value ? Number(e.target.value) : null })} className={CAMPO} style={BORDE}>
                <option value="">No se cancela: se renueva siempre</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m} {ejercicioEnUso()}</option>)}</select>
            </CampoForm>
          </SeccionForm>
          <SeccionForm t="Valor y rendimiento">
            <CampoForm label="Monto (USD)" span={2}>
              <input value={montoTxt} onChange={(e) => setMontoTxt(e.target.value)} inputMode="decimal" className={`${CAMPO} text-right`} style={BORDE} placeholder="500000" />
            </CampoForm>
            <CampoForm label="Tasa anual (%)" span={2}>
              <input value={tasaTxt} onChange={(e) => setTasaTxt(e.target.value)} inputMode="decimal" className={`${CAMPO} text-right`} style={BORDE} placeholder="5,25" />
            </CampoForm>
          </SeccionForm>
        </VentanaFormulario>
      )}

      {/* Registro */}
      <section className="tarjeta overflow-hidden flex flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.beige}` }}>
          <div role="group" aria-label="Agrupar por" className="flex items-center gap-1 p-1 rounded-lg" style={{ background: C.crema }}>
            <span className="px-2 text-[12px]" style={{ color: C.texto2 }}>Agrupar por</span>
            {([...(soloLectura ? [["agencia", "Agencia"]] : []), ["sector", "Sector"], ["institucion", "Institución"]] as [typeof agrupar, string][]).map(([id, l]) => (
              <button key={id} type="button" aria-pressed={agrupar === id} onClick={() => { setAgrupar(id); setAbiertosG(new Set()); }} className="h-7 px-3 rounded-md text-[12px]"
                style={agrupar === id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>{l}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px]" style={{ color: C.texto2 }}>Vencen
            <select value={vence} onChange={(e) => { setVence(e.target.value); setAbiertosG(new Set(["*"])); }} className="h-8 px-2 text-[12px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
              <option value="">Todos los meses</option>
              {nVencidos > 0 && <option value="corte">Vencidos al corte ({nVencidos})</option>}
              {mesesVence.map((m) => <option key={m} value={m}>{MESES[Number(m.slice(5, 7)) - 1].toLowerCase()}-{m.slice(2, 4)} ({p.titulos.filter((t) => t.fechaFin.slice(0, 7) === m).length})</option>)}
            </select>
          </label>
          <span className="flex-1" />
          <div role="tablist" aria-label="Filtrar títulos" className="flex gap-1 p-1 rounded-lg" style={{ background: C.crema }}>
            {([["vigentes", "Vigentes", nVig], ["canceladas", "Canceladas", nCanc], ["todas", "Todas", base0.length]] as const).map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)}
                      className="h-7 px-3 rounded-md text-[12px] transition-colors flex items-center gap-1.5"
                      style={filtro === id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
                {label}<span className="text-[11px] font-semibold px-1.5 rounded" style={{ background: filtro === id ? C.acentoSuave : "#E6EAE8", color: filtro === id ? C.acento : C.texto2 }}>{n}</span>
              </button>
            ))}
          </div>
          {!form && !soloLectura && <button type="button" onClick={() => abrir()} className="h-8 px-3 rounded-lg text-white text-[12.5px] font-medium flex items-center gap-1.5" style={{ background: C.acento }}><Plus size={14} /> Registrar inversión</button>}
        </div>
        <div className="flex flex-col gap-3 empty:hidden px-4 pt-3 last:pb-3">
        {cuadre !== null && p.titulos.length > 0 && Math.abs(cuadre) >= 1 && (
          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-md text-[12px] font-semibold" style={{ background: C.avisoSuave, color: "#6E4A0E" }}>
            <span className="flex-1">{`No cuadra con el balance: cuenta 13 a ${corte} = ${usd(d.saldo13Corte!)} · títulos vigentes = ${usd(p.capitalAlCorte)} · diferencia ${usd(cuadre)}`}</span>
            {nVencidos > 0 && vence !== "corte" && (
              <button type="button" className="underline" onClick={() => { setVence("corte"); setFiltro("todas"); setAbiertosG(new Set(["*"])); }}>Ver los {nVencidos} vencidos al corte</button>
            )}
          </div>
        )}
        {msg && !(form && msg.e) && <p className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</p>}
        </div>

        {p.titulos.length === 0 ? (
          <p className="px-4 py-4 text-[12px]" style={{ color: C.texto2 }}>Sin títulos registrados en {agencia}.</p>
        ) : lista.length === 0 ? (
          <p className="px-4 py-5 text-[12px]" style={{ color: C.texto2 }}>
            {vence ? "No hay títulos con ese vencimiento en esta lista."
              : enCanceladas
              ? soloLectura ? `No hay inversiones que se cancelen en ${ejercicioEnUso()}.` : `No hay inversiones que se cancelen en ${ejercicioEnUso()}. Para cancelar una, edítela con el lápiz y elija el mes en «Se cancela en»: pasará a esta lista y su valor volverá a fondos disponibles ese mes.`
              : `Todas las inversiones registradas se cancelan en ${ejercicioEnUso()}: están en la lista de Canceladas.`}
          </p>
        ) : (() => {
          const claveG = (t: TituloCalc) => (agrupar === "agencia" ? t.agencia ?? "—" : agrupar === "sector" ? sectorCorto(t.sector) : t.institucion);
          const grupos = [...new Set(lista.map(claveG))].sort().map((g) => ({ g, ts: lista.filter((t) => claveG(t) === g).sort((a, b) => sectorCorto(a.sector).localeCompare(sectorCorto(b.sector)) || a.institucion.localeCompare(b.institucion) || a.fechaFin.localeCompare(b.fechaFin)) }));
          const abierto = (g: string) => abiertosG.has("*") || abiertosG.has(g);
          const todos = grupos.every((x) => abierto(x.g));
          const verAg = soloLectura && agrupar !== "agencia";
          const verSector = agrupar !== "sector";
          const sum = (ts: TituloCalc[], fn: (t: TituloCalc) => number) => ts.reduce((a, t) => a + fn(t), 0);
          const tasaP = (ts: TituloCalc[]) => { const m = sum(ts, (t) => t.monto); return m ? `${(sum(ts, (t) => t.monto * t.tasaAnual) / m * 100).toFixed(2).replace(".", ",")} %` : "—"; };
          const neto = (t: TituloCalc) => (enCanceladas ? t.valorCancelado : t.netoRenovar);
          const nCols = 13 + (verAg ? 1 : 0) + (verSector ? 1 : 0);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse min-w-[1000px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
                    <th className={`${TH} pl-4 text-left`}>{agrupar === "agencia" ? "Agencia / institución" : agrupar === "sector" ? "Sector / institución" : "Institución"}</th>
                    {verAg && <th className={`${TH} text-left`}>Agencia</th>}
                    {verSector && <th className={`${TH} text-left`}>Sector</th>}
                    <th className={`${TH} text-left`}>Cuenta</th><th className={`${TH} text-left`}>Inicio</th><th className={`${TH} text-left`}>Fin</th><th className={`${TH} text-right`}>Días</th>
                    <th className={`${TH} text-right`}>Monto</th><th className={`${TH} text-right`}>Tasa</th><th className={`${TH} text-right`}>Int. mensual</th>
                    <th className={`${TH} text-right`}>Int. período</th><th className={`${TH} text-right`}>Retención</th><th className={`${TH} text-right`}>{enCanceladas ? "Valor devuelto" : "Neto renovar"}</th>
                    <th className={`${TH} pl-4 text-left`}>Cancela</th>
                    <th className="w-[64px] pr-2 text-right">
                      <button type="button" onClick={() => setAbiertosG(todos ? new Set() : new Set(["*"]))} aria-label={todos ? "Contraer todo" : "Expandir todo"} title={todos ? "Contraer todo" : "Expandir todo"}
                        className="w-6 h-6 rounded-md inline-flex items-center justify-center hover:bg-[#F3F5F4]" style={{ color: C.texto2 }}>
                        {todos ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map(({ g, ts }) => {
                    const ab = abierto(g);
                    return (
                      <Fragment key={g}>
                        <tr onClick={() => setAbiertosG((s0) => { const n = new Set(s0.has("*") ? grupos.map((x) => x.g) : s0); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
                          className="cursor-pointer hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 32, fontWeight: ab ? 600 : 400 }}>
                          <td className="pl-3 pr-2 whitespace-nowrap" colSpan={1 + (verAg ? 1 : 0) + (verSector ? 1 : 0) + 4}>
                            <span className="inline-flex items-center gap-1.5" style={{ color: C.texto }}>
                              {ab ? <ChevronDown size={13} color={C.acento} /> : <ChevronRight size={13} color={C.acento} />}{g}
                              <span className="font-normal" style={{ color: C.tenue }}>{ts.length}</span>
                            </span>
                          </td>
                          <td className="px-1.5 text-right">{numero(sum(ts, (t) => t.monto))}</td>
                          <td className="px-1.5 text-right whitespace-nowrap">{tasaP(ts)}</td>
                          <td className="px-1.5 text-right">{usd2(sum(ts, (t) => t.interesMensual))}</td>
                          <td className="px-1.5 text-right">{usd2(sum(ts, (t) => t.interesPeriodo))}</td>
                          <td className="px-1.5 text-right" style={{ color: C.alerta }}>{usd2(-sum(ts, (t) => t.retencion))}</td>
                          <td className="px-1.5 text-right">{usd2(sum(ts, neto))}</td>
                          <td colSpan={2} />
                        </tr>
                        {ab && ts.map((t, k) => {
                          const venc = vencidoAlCorte(t);
                          return (
                            <tr key={t.id ?? `${g}${k}`} className="group hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 30, color: C.texto3 }}>
                              <td className="pl-8 pr-2 whitespace-nowrap">{t.institucion}{t.planificada && <span className="ml-2 text-[10.5px] font-semibold px-1.5 py-px rounded" style={CHIP_ON}>Planificada</span>}</td>
                              {verAg && <td className="px-1.5 whitespace-nowrap">{t.agencia}</td>}
                              {verSector && <td className="px-1.5 whitespace-nowrap" title={t.sector}>{sectorCorto(t.sector)}</td>}
                              <td className="px-1.5 whitespace-nowrap" title={t.cuentaNombre}>{t.cuentaCodigo}</td>
                              <td className="px-1.5 whitespace-nowrap">{fechaCorta(t.fechaInicio)}</td>
                              <td className="px-1.5 whitespace-nowrap" style={venc ? { color: "#9A5B00", fontWeight: 600 } : undefined}
                                  title={venc ? `Venció antes del corte (${corte}): revisar si se renovó o se canceló` : undefined}>{fechaCorta(t.fechaFin)}</td>
                              <td className="px-1.5 text-right">{t.dias}</td>
                              <td className="px-1.5 text-right">{numero(t.monto)}</td>
                              <td className="px-1.5 text-right whitespace-nowrap">{(t.tasaAnual * 100).toFixed(2).replace(".", ",")} %</td>
                              <td className="px-1.5 text-right">{usd2(t.interesMensual)}</td><td className="px-1.5 text-right">{usd2(t.interesPeriodo)}</td>
                              <td className="px-1.5 text-right" style={{ color: C.alerta }}>{usd2(-t.retencion)}</td>
                              <td className="px-1.5 text-right" title={enCanceladas ? "Capital + interés − retención que vuelve a fondos disponibles en el mes de cancelación" : undefined}>{usd2(neto(t))}</td>
                              <td className="pl-4 pr-1.5 whitespace-nowrap" style={{ color: t.cancelaMes ? C.acento : C.tenue }}>{t.cancelaMes ? `${MESES[t.cancelaMes - 1]}-27` : "—"}</td>
                              <td className="pr-2 text-right whitespace-nowrap">
                                {!soloLectura && <span className="opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                  <button type="button" onClick={() => abrir(t)} aria-label={`Editar ${t.institucion}`} className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#E3EEE7]"><Pencil size={14} color={C.texto2} /></button>
                                  <button type="button" onClick={() => setBorrar(t)} aria-label={`Eliminar ${t.institucion}`} className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#FBE4E1]"><Trash2 size={14} color={C.alerta} /></button>
                                </span>}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", background: "#FFFFFF", height: 34 }}>
                    <td className="pl-4" colSpan={nCols - 8}>Total ({lista.length} {enCanceladas ? (lista.length === 1 ? "cancelada" : "canceladas") : filtro === "vigentes" ? (lista.length === 1 ? "vigente" : "vigentes") : "títulos"})</td>
                    <td className="px-1.5 text-right">{numero(montoLista)}</td>
                    <td className="px-1.5 text-right whitespace-nowrap">{tasaP(lista)}</td>
                    <td className="px-1.5 text-right">{usd2(tot((t) => t.interesMensual))}</td><td className="px-1.5 text-right">{usd2(tot((t) => t.interesPeriodo))}</td>
                    <td className="px-1.5 text-right" style={{ color: C.alerta }}>{usd2(-tot((t) => t.retencion))}</td><td className="px-1.5 text-right">{usd2(tot(neto))}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </section>

      {borrar && !soloLectura && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">
            <p className="text-[14px] font-semibold mb-2">¿Eliminar la inversión en {borrar.institucion} por {usd(borrar.monto)}?</p>
            <p className="text-[12px] mb-4" style={{ color: C.texto2 }}>Deja de sumar a la cuenta 13 y al interés 5103 de {agencia}.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBorrar(null)} className="h-9 px-4 rounded-md bg-white text-[12px] font-semibold" style={{ border: "1px solid #C9D0CC" }}>Cancelar</button>
              <button type="button" onClick={() => eliminar(borrar)} className="h-9 px-4 rounded-md text-white text-[12px] font-semibold" style={{ background: C.alerta }}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}