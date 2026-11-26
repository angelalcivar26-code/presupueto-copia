"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, useEjercicio, ejercicioEnUso } from "../../lib/seleccion";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useMemo, useState, Suspense } from "react";
import { ChevronRight, ChevronDown, Download, AlertTriangle } from "lucide-react";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { obtenerJSONCache, guardarJSONCache } from "../../lib/useDatos";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";

interface NodoFlujo {
  codigo: string;
  label: string;
  valores: number[];
  formulas?: string[];
  hijos?: NodoFlujo[];
}

type Vista = "valores" | "vertical";
type Pestana = "tabla" | "analisis";

const NOMBRES_MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];

// El arreglo raíz de la API siempre trae estas 7 filas en este orden.
const I = { saldoInicial: 0, fuentes: 1, usos: 2, reservas: 3, disponible: 4, prestamos: 5, saldoFinal: 6, holgura: 7 } as const;
// Filas que son saldos (no flujos): en "Total año" muestran un saldo, no una suma.
const TOTAL_PRIMER_MES = new Set<number>([I.saldoInicial]);
const TOTAL_ULTIMO_MES = new Set<number>([I.reservas, I.disponible, I.saldoFinal, I.holgura]);
const FILAS_CLAVE = new Set<number>([I.disponible, I.saldoFinal, I.holgura]);

// Paleta institucional (misma de Cartera, Activos, Balance y Resultados)
const C = {
  texto: "#111418",
  texto2: "#3D4843",
  texto3: "#26302B",
  tenue: "#7A847F",
  borde: "#DDE2DF",
  beige: "#E6EAE8",
  acento: "#005A28",
  acentoSuave: "#E3EEE7",
  ok: "#1E6B3A",
  okSuave: "#E3F1E7",
  aviso: "#B7791F",
  avisoSuave: "#FBF1DC",
  alerta: "#B42318",
  alertaSuave: "#FBE4E1",
};
const FONDO = "#EEF1EF";

// ---------- utilidades ----------
// Negativos entre paréntesis (convención contable)
function numero(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function usd(n: number): string {
  const s = "$" + Math.abs(Math.round(n)).toLocaleString("es-EC");
  return n < 0 ? `(${s})` : s;
}
function millones(n: number): string {
  const s = "$" + (Math.abs(n) / 1_000_000).toFixed(2).replace(".", ",") + " M";
  return n < 0 ? `(${s})` : s;
}
function pct(n: number, d = 1): string {
  return Math.abs(n).toFixed(d).replace(".", ",") + " %";
}
const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);
const esCero = (v: number[]) => v.every((x) => Math.round(x) === 0);

// ---------- selector chico (igual que en Activos fijos) ----------
function Pastillas<T extends string>({ opciones, valor, onChange, etiqueta }: {
  opciones: { id: T; label: string }[]; valor: T; onChange: (v: T) => void; etiqueta: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex p-[3px] gap-0.5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #D5DBD7" }}>
      {opciones.map((o) => {
        const on = valor === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={on}
                  className="h-7 px-2.5 rounded text-[12px] transition-colors"
                  style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { background: "transparent", color: C.texto2 }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- selector de mes en chips ----------
function ChipsMes({ valor, onChange, etiqueta }: { valor: number; onChange: (i: number) => void; etiqueta: string }) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-0.5">
      {NOMBRES_MES.map((m, i) => (
        <button key={m} type="button" onClick={() => onChange(i)} aria-pressed={valor === i}
                className="w-[32px] h-[25px] rounded text-[11px] font-semibold"
                style={valor === i ? { background: C.acentoSuave, color: C.acento } : { background: "transparent", color: C.texto2 }}>
          {m}
        </button>
      ))}
    </div>
  );
}

// ---------- indicador (tarjeta limpia, igual que Cartera) ----------
function Indicador({ titulo, valor, pie, color }: { titulo: string; valor: string; pie: React.ReactNode; color?: string }) {
  return (
    <div className="tarjeta px-5 py-4 flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: C.texto2 }}>{titulo}</span>
      <span className="text-[23px] font-semibold leading-tight" style={{ color: C.texto }}>{valor}</span>
      <span className="text-[12px]" style={{ color: color ?? C.texto2, fontWeight: color ? 600 : 400 }}>{pie}</span>
    </div>
  );
}

// ---------- fila recursiva ----------
function Fila({
  nodo, indiceRaiz, nivel, vista, fuentes, fuentesAnio, ocultarCeros, filaAbierta, onAbrirFormula, mesFormula, onMesFormula,
}: {
  nodo: NodoFlujo; indiceRaiz: number; nivel: number; vista: Vista;
  fuentes: number[]; fuentesAnio: number; ocultarCeros: boolean;
  filaAbierta: string | null; onAbrirFormula: (id: string) => void;
  mesFormula: number; onMesFormula: (i: number) => void;
}) {
  const [abierto, setAbierto] = useState(nivel === 0);
  const hijos = (nodo.hijos ?? []).filter((h) => !(ocultarCeros && esCero(h.valores)));
  const tieneHijos = hijos.length > 0;
  const raiz = nivel === 0;
  const clave = raiz && FILAS_CLAVE.has(indiceRaiz);
  const idFila = `${indiceRaiz}-${nivel}-${nodo.label}`;
  const formulaAbierta = filaAbierta === idFila;
  const peso = raiz ? 600 : 400;

  // Total año: suma en flujos; saldo de enero o diciembre en filas de saldo
  const esSaldoInicio = raiz && TOTAL_PRIMER_MES.has(indiceRaiz);
  const esSaldoFin = raiz && TOTAL_ULTIMO_MES.has(indiceRaiz);
  const totalV = esSaldoInicio ? nodo.valores[0] : esSaldoFin ? nodo.valores[11] : suma(nodo.valores);
  const baseTotal = esSaldoInicio ? fuentes[0] : esSaldoFin ? fuentes[11] : fuentesAnio;

  const texto = (x: number, base: number) => {
    if (Math.round(x) === 0) return { txt: "—", color: C.tenue };
    if (vista === "vertical") {
      if (!base) return { txt: "—", color: C.tenue };
      return { txt: x < 0 ? `(${pct((x / base) * 100)})` : pct((x / base) * 100), color: C.texto };
    }
    return { txt: numero(x), color: C.texto };
  };
  const total = texto(totalV, baseTotal);

  return (
    <>
      {/* Disponible y Saldo final: espacio blanco antes, para leerlos como resultado */}
      {clave && <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={15} /></tr>}
      <tr
        className="hover:bg-[#F5F7F6]"
        style={{
          borderTop: clave ? "1px solid #B9C3BD" : raiz ? (indiceRaiz === 0 ? "none" : "1px solid #DDE2DF") : `1px solid ${C.beige}`,
          height: 32,
          fontWeight: peso,
        }}
      >
        <td className="pr-2" style={{ paddingLeft: 14 + nivel * 20, cursor: tieneHijos ? "pointer" : "default" }}
            onClick={() => tieneHijos && setAbierto((a) => !a)}>
          <span className="flex items-center gap-1.5 min-w-0">
            {tieneHijos ? (
              abierto ? <ChevronDown size={13} className="shrink-0" color={C.acento} /> : <ChevronRight size={13} className="shrink-0" color={C.acento} />
            ) : raiz ? (
              <span className="shrink-0" style={{ width: 12, display: "inline-block" }} />
            ) : null}
            <span className={`truncate ${raiz ? "text-[12px] font-bold" : "text-[11px]"}`} title={nodo.label}
                  style={{ color: raiz ? (tieneHijos ? C.acento : C.texto) : C.texto3 }}>
              {raiz ? nodo.label.charAt(0) + nodo.label.slice(1).toLowerCase() : nodo.label}
            </span>
          </span>
        </td>
        {nodo.valores.map((v, i) => {
          const c = texto(v, fuentes[i]);
          return (
            <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: c.color }}>
              {c.txt}
            </td>
          );
        })}
        <td className="pl-2 pr-3 text-right whitespace-nowrap font-semibold" style={{ color: total.color }}>
          {total.txt}
        </td>
        <td className="text-center">
          {nodo.formulas && (
            <button type="button" onClick={() => onAbrirFormula(idFila)}
                    aria-label={`Ver cómo se calcula ${nodo.label}`} aria-expanded={formulaAbierta}
                    title="Ver cómo se calcula esta fila"
                    className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
                    style={formulaAbierta ? { background: C.acentoSuave, color: C.acento } : { color: C.tenue }}>
              ƒ
            </button>
          )}
        </td>
      </tr>

      {formulaAbierta && nodo.formulas && (
        <tr style={{ background: "#F3F5F4" }}>
          <td colSpan={15} className="px-4 py-3" style={{ borderTop: `1px solid ${C.beige}` }}>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2" style={{ paddingLeft: nivel * 22 }}>
              <ChipsMes valor={mesFormula} onChange={onMesFormula} etiqueta="Mes de la fórmula" />
              <p className="flex-1 min-w-[288px] text-[12px] leading-relaxed" style={{ color: C.texto3 }}>
                <span className="font-semibold" style={{ color: C.acento }}>{NOMBRES_MES[mesFormula]} · </span>
                {nodo.formulas[mesFormula]}
              </p>
            </div>
          </td>
        </tr>
      )}

      {tieneHijos && abierto &&
        hijos.map((h, i) => (
          <Fila key={`${h.label}-${i}`} nodo={h} indiceRaiz={indiceRaiz} nivel={nivel + 1} vista={vista}
                fuentes={fuentes} fuentesAnio={fuentesAnio} ocultarCeros={ocultarCeros}
                filaAbierta={filaAbierta} onAbrirFormula={onAbrirFormula}
                mesFormula={mesFormula} onMesFormula={onMesFormula} />
        ))}
    </>
  );
}

// ---------- gráfico: cascada del mes ----------
function Cascada({ si, f, u, p, sf }: { si: number; f: number; u: number; p: number; sf: number }) {
  const tope = Math.max(si + f, si, sf, 1);
  const y = (v: number) => (Math.max(v, 0) / tope) * 100; // % de la altura útil
  const pasos = [
    { nombre: "Saldo inicial", desde: 0, hasta: si, color: "#9AA3A0", valor: millones(si), txt: C.texto3 },
    { nombre: "+ Fuentes", desde: si, hasta: si + f, color: C.ok, valor: "+" + millones(f), txt: C.ok },
    { nombre: "− Usos", desde: si + f - u, hasta: si + f, color: C.alerta, valor: "−" + millones(u), txt: C.alerta },
    { nombre: "− Préstamos", desde: sf, hasta: sf + p, color: C.aviso, valor: "−" + millones(p), txt: "#7A4F0E" },
    { nombre: "Saldo final", desde: 0, hasta: sf, color: C.acento, valor: millones(sf), txt: C.acento },
  ];
  return (
    <div className="relative h-[225px]">
      <div className="absolute left-0 right-0 bottom-[31px] top-[20px]">
        <div className="absolute left-0 right-0 bottom-0 h-px" style={{ background: C.borde }} />
        {pasos.map((s, k) => {
          const bajo = y(Math.min(s.desde, s.hasta));
          const alto = Math.max(y(Math.max(s.desde, s.hasta)) - bajo, 0.8);
          return (
            <div key={s.nombre}>
              <div className="absolute rounded" style={{ left: `${3 + k * 19.5}%`, width: "15%", bottom: `${bajo}%`, height: `${alto}%`, background: s.color }} />
              <div className="absolute text-center text-[11px] font-semibold whitespace-nowrap"
                   style={{ left: `${3 + k * 19.5}%`, width: "15%", bottom: `calc(${bajo + alto}% + 4px)`, color: s.txt }}>
                {s.valor}
              </div>
            </div>
          );
        })}
      </div>
      {pasos.map((s, k) => (
        <div key={s.nombre} className="absolute bottom-0 text-center text-[11px] leading-tight"
             style={{ left: `${3 + k * 19.5}%`, width: "15%", color: C.texto2 }}>
          {s.nombre}
        </div>
      ))}
    </div>
  );
}

// ---------- gráfico: saldo final vs encaje ----------
function LineaSaldoEncaje({ saldo, encaje }: { saldo: number[]; encaje: number[] }) {
  const W = 620, H = 200, x0 = 48, x1 = 604, yTop = 18, yBase = 166;
  const max = Math.max(...saldo, ...encaje, 1) * 1.08;
  const px = (i: number) => x0 + (i * (x1 - x0)) / 11;
  const py = (v: number) => yBase - (Math.max(v, 0) / max) * (yBase - yTop);
  const lin = (v: number[]) => v.map((x, i) => `${px(i).toFixed(1)},${py(x).toFixed(1)}`).join(" ");
  const area = `${lin(saldo)} ${[...encaje].map((x, i) => `${px(i).toFixed(1)},${py(x).toFixed(1)}`).reverse().join(" ")}`;
  const paso = max > 20_000_000 ? 10_000_000 : max > 8_000_000 ? 5_000_000 : max > 3_000_000 ? 2_000_000 : 1_000_000;
  const marcas = Array.from({ length: Math.floor(max / paso) + 1 }, (_, k) => k * paso);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label="Saldo final mensual comparado con el encaje mínimo">
      {marcas.map((m) => (
        <g key={m}>
          <line x1={x0} x2={x1} y1={py(m)} y2={py(m)} stroke={m === 0 ? C.borde : C.beige} strokeWidth={1} />
          <text x={x0 - 6} y={py(m) + 3} textAnchor="end" fontSize={10} fill={C.texto2}>{m === 0 ? "0" : `${m / 1_000_000} M`}</text>
        </g>
      ))}
      <polygon points={area} fill={C.acentoSuave} opacity={0.6} />
      <polyline points={lin(encaje)} fill="none" stroke={C.texto2} strokeWidth={1.6} strokeDasharray="5 4" />
      <polyline points={lin(saldo)} fill="none" stroke={C.acento} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(11)} cy={py(saldo[11])} r={3.5} fill={C.acento} />
      <text x={px(11) - 4} y={py(saldo[11]) - 8} textAnchor="end" fontSize={10.5} fontWeight={600} fill={C.acento}>{millones(saldo[11])}</text>
      <text x={px(0) + 4} y={py(saldo[0]) - 8} fontSize={10.5} fontWeight={600} fill={C.acento}>{millones(saldo[0])}</text>
      {NOMBRES_MES.map((m, i) => i % 2 === 0 && (
        <text key={m} x={px(i)} y={188} textAnchor="middle" fontSize={10} fill={C.texto2}>{m}</text>
      ))}
    </svg>
  );
}

// ---------- exportar CSV ----------

// ---------- flujo de caja sobre la cuenta 11 (Detalle por cuenta / Resumen por concepto) ----------
interface FilaFlujo11 {
  id: string; codigo: string; label: string; valores: number[];
  tipo: "saldo" | "total" | "grupo" | "linea" | "variacion" | "control";
  formula?: string;
}
interface Cuenta11 { detalle: FilaFlujo11[]; resumen: FilaFlujo11[]; diferenciaMaxima: number }
type VistaTabla = "resumen" | "detalle" | "fuentes";

// Filas de saldo: el "Total año" muestra el saldo de enero (inicial) o de diciembre (finales)
const SALDO_INICIO = new Set(["si", "r-si"]);
const SALDO_FIN = new Set(["sf", "sb", "df", "en", "se", "r-sf", "r-en", "r-se"]);

function TablaCuenta11({ filas, ocultarCeros, conCodigo }: { filas: FilaFlujo11[]; ocultarCeros: boolean; conCodigo: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  let visibles = filas.filter((f) => !(ocultarCeros && (f.tipo === "linea" || f.tipo === "variacion") && esCero(f.valores)));
  // Un grupo sin filas debajo (todo en cero) tampoco se muestra
  visibles = visibles.filter((f, k) => f.tipo !== "grupo" || (visibles[k + 1] && visibles[k + 1].tipo !== "grupo"));
  return (
    <div className={conCodigo ? "tabla-fija fija-2" : "tabla-fija"} style={{ "--col1": "70px" } as React.CSSProperties}>
      <table className="w-full table-fixed text-[11px] border-collapse min-w-[1250px]">
        <colgroup>
          {conCodigo && <col style={{ width: 70 }} />}
          <col style={{ width: conCodigo ? 250 : 300 }} />
          {NOMBRES_MES.map((m) => <col key={m} />)}
          <col style={{ width: 92 }} />
          <col style={{ width: 27 }} />
        </colgroup>
        <thead>
          <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.texto2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
            {conCodigo && <th className="pl-4 text-left font-semibold">Cuenta</th>}
            <th className={`${conCodigo ? "pl-2" : "pl-4"} pr-2 text-left font-semibold`}>Concepto</th>
            {NOMBRES_MES.map((m) => <th key={m} className="px-1 text-right font-semibold">{m}</th>)}
            <th className="pl-2 pr-3 text-right font-semibold whitespace-nowrap">Total año</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {visibles.map((f, k) => {
            const cols = 15 + (conCodigo ? 1 : 0);
            if (f.tipo === "grupo") {
              return (
                <tr key={f.id} style={{ borderTop: k ? "1px solid #DDE2DF" : "none", height: 32, background: "#F8FAF9" }}>
                  <td colSpan={cols} className="pl-4 text-[12px] font-bold" style={{ color: C.acento }}>{f.label}</td>
                </tr>
              );
            }
            const fuerte = f.tipo === "saldo" || f.tipo === "total" || f.tipo === "variacion";
            const total = SALDO_INICIO.has(f.id) ? f.valores[0] : SALDO_FIN.has(f.id) ? f.valores[11] : suma(f.valores);
            const color = (v: number) => (Math.round(v) === 0 ? C.tenue : v < 0 && f.tipo !== "linea" ? C.alerta : f.tipo === "control" ? C.texto2 : C.texto);
            const borde = f.tipo === "saldo" ? "1px solid #B9C3BD" : f.tipo === "total" || f.tipo === "variacion" ? "1px solid #DDE2DF" : `1px solid ${C.beige}`;
            const sangria = f.tipo === "linea" ? 26 : 14;
            return (
              <FilaConFormula key={f.id} abierta={abierta === f.id} formula={f.formula} cols={cols}>
                <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: k ? borde : "none", height: 32, fontWeight: fuerte ? 600 : 400 }}>
                  {conCodigo && <td className="pl-4 font-mono text-[11px]" style={{ color: C.texto2 }}>{f.codigo}</td>}
                  <td className="pr-2" style={{ paddingLeft: conCodigo ? (f.tipo === "linea" ? 8 : 8) : sangria }}>
                    <span className="block truncate" title={f.label}
                          style={{ color: f.tipo === "total" ? C.acento : f.tipo === "control" ? C.texto2 : fuerte ? C.texto : C.texto3, fontSize: fuerte ? 12 : 11 }}>
                      {f.label}
                    </span>
                  </td>
                  {f.valores.map((v, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap" style={{ color: color(v) }}>{Math.round(v) === 0 ? "—" : numero(v)}</td>
                  ))}
                  <td className="pl-2 pr-3 text-right whitespace-nowrap font-semibold" style={{ color: color(total) }}>{Math.round(total) === 0 ? "—" : numero(total)}</td>
                  <td className="text-center">
                    {f.formula && (
                      <button type="button" onClick={() => setAbierta(abierta === f.id ? null : f.id)} aria-expanded={abierta === f.id}
                              aria-label={`Ver cómo se calcula ${f.label}`} title="Ver cómo se calcula esta fila"
                              className="w-5 h-5 rounded inline-flex items-center justify-center font-mono text-[11px]"
                              style={abierta === f.id ? { background: C.acentoSuave, color: C.acento } : { color: C.tenue }}>ƒ</button>
                    )}
                  </td>
                </tr>
              </FilaConFormula>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function FilaConFormula({ abierta, formula, cols, children }: { abierta: boolean; formula?: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      {children}
      {abierta && formula && (
        <tr style={{ background: "#F3F5F4" }}>
          <td colSpan={cols} className="px-4 py-2.5 text-[12px]" style={{ color: C.texto3, borderTop: `1px solid ${C.beige}` }}>
            <span className="font-mono mr-2" style={{ color: C.acento }}>ƒ</span>{formula}
          </td>
        </tr>
      )}
    </>
  );
}


function FlujoEfectivoContenido() {
  const [ejercicio] = useEjercicio();
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [pestana, setPestana] = useState<Pestana>("tabla");
  const [vista, setVista] = useState<Vista>("valores");
  const [vistaTabla, setVistaTabla] = useState<VistaTabla>("resumen");
  const [ocultarCeros, setOcultarCeros] = useState(false);
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);
  const [mesFormula, setMesFormula] = useState(11);
  const [mesCascada, setMesCascada] = useState(11);
  const ticketSync = useEscucharSincronizacion();

  const url = `/api/flujo-efectivo?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;
  const cached = obtenerJSONCache<{ filas?: NodoFlujo[]; cuenta11?: Cuenta11 }>(url);

  const [filas, setFilas] = useState<NodoFlujo[] | null>(() => cached?.filas ?? null);
  const [c11, setC11] = useState<Cuenta11 | null>(() => cached?.cuenta11 ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // vivo: si cambia la agencia antes de que llegue la respuesta, la respuesta vieja se descarta
    let vivo = true;
    const enCache = obtenerJSONCache<{ filas?: NodoFlujo[]; cuenta11?: Cuenta11 }>(url);
    if (enCache?.filas) {
      setFilas(enCache.filas);
      setC11(enCache.cuenta11 ?? null);
    } else {
      setFilas(null);
    }
    setError(null);
    apiFetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!vivo) return;
        if (data.filas) {
          guardarJSONCache(url, data);
          setFilas(data.filas);
          setC11(data.cuenta11 ?? null);
        } else if (!enCache) {
          setError(data.error || "Error desconocido.");
        }
      })
      .catch(() => {
        if (vivo && !enCache) setError("Error de conexión.");
      });
    return () => { vivo = false; };
  }, [agencia, ejercicio, ticketSync]);

  const resumen = useMemo(() => {
    if (!filas || filas.length < 7) return null;
    const v = (k: number) => filas[k].valores;
    let SI = v(I.saldoInicial), F = v(I.fuentes), U = v(I.usos), R = v(I.reservas);
    let D = v(I.disponible), P = v(I.prestamos), SF = v(I.saldoFinal);
    let fuentesDetalle = filas[I.fuentes].hijos ?? [];
    // Tarjetas y análisis con el MISMO flujo que la tabla (cuenta 11). Antes salían del modelo anterior
    // («fuentes y usos»), por eso sus saldos y alertas no coincidían con la tabla principal.
    if (c11) {
      const r = (id: string) => c11.resumen.find((x) => x.id === id)?.valores ?? Array(12).fill(0) as number[];
      const colocacion = r("k5").map((x) => Math.abs(x));
      const sinEncaje = r("r-se");
      SI = r("r-si"); F = r("r-te"); SF = r("r-sf"); R = r("r-en");
      U = r("r-ts").map((x, i) => x - colocacion[i]); // salidas sin la colocación (va aparte en P)
      P = colocacion;
      D = sinEncaje.map((x, i) => x + colocacion[i]); // disponible después del encaje, antes de colocar
      fuentesDetalle = ["c1", "k1", "k2", "k3", "k4", "i1", "i2", "o1", "x6"]
        .map((id) => c11.resumen.find((x) => x.id === id))
        .filter((x): x is FilaFlujo11 => !!x && suma(x.valores) > 0)
        .map((x) => ({ codigo: x.codigo, label: x.label.replace(/^\(\+\)\s*/, ""), valores: x.valores }) as NodoFlujo);
    }
    const holgura = D.map((d, i) => d - P[i]);
    const negativos = holgura.filter((h) => h < 0).length;
    const netoMes = SI.map((_, i) => F[i] - U[i] - P[i]);
    const netoMin = Math.min(...netoMes), netoMax = Math.max(...netoMes);
    const caida = holgura[0] > 0 ? 1 - holgura[11] / holgura[0] : 0;
    const bajaMensual = (holgura[0] - holgura[11]) / 11;
    const mesesParaAgotar = bajaMensual > 0 && holgura[11] > 0 ? Math.ceil(holgura[11] / bajaMensual) : null;
    const cobertura = (i: number) => (P[i] ? D[i] / P[i] : null);
    const mayorFuente = [...fuentesDetalle].sort((a, b) => suma(b.valores) - suma(a.valores))[0];
    const alertas = (negativos > 0 ? 1 : 0) + (caida > 0.5 ? 1 : 0);
    return { SI, F, U, R, D, P, SF, holgura, negativos, netoMin, netoMax, caida, mesesParaAgotar, cobertura, mayorFuente, alertas };
  }, [filas, c11]);

  if (error) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.alerta }}>{error}</div>;
  }
  if (!filas || !resumen) {
    return <div className="estilo-institucional min-h-screen px-6 py-6 text-[13px]" style={{ background: FONDO, color: C.texto2 }}><EsqueletoTabla filas={12} /></div>;
  }

  const { SI, F, U, R, P, SF, holgura, negativos, netoMin, netoMax, caida, mesesParaAgotar, cobertura, mayorFuente, alertas } = resumen;
  const fuentesAnio = suma(F);
  const variacionSaldo = SI[0] ? (SF[11] / SI[0] - 1) * 100 : null;
  const cobDic = cobertura(11);

  const abrirFormula = (id: string) => setFilaAbierta((prev) => (prev === id ? null : id));
  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7]";
  const tabs: { id: Pestana; label: string }[] = [{ id: "tabla", label: "Tabla de datos" }, { id: "analisis", label: "Gráficos y análisis" }];

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>

      {/* Encabezado: título y Exportar */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Flujo de efectivo<AnioEjercicio /></h1>
        <button type="button" className={accion} style={{ color: C.acento }}
                onClick={() => void exportarPantalla({ agencia, ejercicio })}>
          <Download size={16} /> Exportar
        </button>
      </div>

      {/* Pestañas a la izquierda; agencia a la derecha */}
      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones del flujo" className="flex gap-7 flex-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={pestana === t.id} onClick={() => setPestana(t.id)}
                    className="pt-2 pb-2.5 -mb-px flex items-center gap-2 text-[13px]"
                    style={{ color: pestana === t.id ? C.acento : C.texto2, fontWeight: pestana === t.id ? 600 : 400, borderBottom: `2px solid ${pestana === t.id ? C.acento : "transparent"}` }}>
              {t.label}
              {t.id === "analisis" && alertas > 0 && (
                <span className="text-[11px] font-semibold px-1.5 rounded" style={{ background: C.avisoSuave, color: "#7A4F0E" }}>
                  {alertas} {alertas === 1 ? "alerta" : "alertas"}
                </span>
              )}
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

      {/* Indicadores: tarjetas limpias */}
      {c11 ? (() => {
        const fila = (id: string) => c11.resumen.find((f) => f.id === id)?.valores ?? Array(12).fill(0);
        const sf = fila("r-sf"), si = fila("r-si"), te = fila("r-te"), ts = fila("r-ts"), se = fila("r-se");
        const primerNeg = se.findIndex((v) => v < 0);
        return (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Indicador titulo={`Saldo final dic-${ejercicioEnUso()}`} valor={usd(sf[11])}
              pie={`Cuenta 11 · ${sf[11] >= si[0] ? "sube" : "baja"} ${usd(Math.abs(sf[11] - si[0]))} en el año`} color={sf[11] < 0 ? C.alerta : undefined} />
            <Indicador titulo="Entradas del año" valor={usd(suma(te))} pie={`${usd(suma(te) / 12)} al mes`} />
            <Indicador titulo="Salidas del año" valor={usd(suma(ts))} pie={`${usd(suma(ts) / 12)} al mes`} />
            <Indicador titulo={`Disponible sin encaje dic-${ejercicioEnUso()}`} valor={usd(se[11])}
              pie={primerNeg >= 0 ? `Negativo desde ${NOMBRES_MES[primerNeg].toLowerCase()}-${ejercicioEnUso()}` : "Positivo todo el año"}
              color={primerNeg >= 0 ? C.alerta : undefined} />
          </div>
        );
      })() : (
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Indicador titulo={`Saldo final dic-${ejercicioEnUso()}`} valor={usd(SF[11])}
          pie={variacionSaldo === null ? "—" : `${variacionSaldo >= 0 ? "Sube" : "Baja"} ${pct(variacionSaldo)} frente a enero`}
          color={(variacionSaldo ?? 0) < -25 ? C.alerta : undefined} />
        <Indicador titulo="Fuentes del año" valor={usd(fuentesAnio)}
          pie={mayorFuente && fuentesAnio ? `${mayorFuente.label}: ${pct((suma(mayorFuente.valores) / fuentesAnio) * 100)} de las fuentes` : "—"} />
        <Indicador titulo="Usos del año" valor={usd(suma(U))} pie={`Más ${usd(suma(P))} en préstamos a conceder`} />
        <Indicador titulo={holgura[11] >= 0 ? `Sobrante de liquidez dic-${ejercicioEnUso()}` : `Faltante de liquidez dic-${ejercicioEnUso()}`} valor={usd(holgura[11])}
          pie={negativos > 0
            ? `Falta liquidez desde ${NOMBRES_MES[holgura.findIndex((h) => h < 0)].toLowerCase()}-${ejercicioEnUso()}`
            : `La colocación cabe todo el año${cobDic !== null ? ` · cobertura ${cobDic.toFixed(2).replace(".", ",")} ×` : ""}`}
          color={holgura[11] < 0 ? C.alerta : undefined} />
      </div>
      )}

      {pestana === "tabla" ? (
        <section className="tarjeta overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ borderBottom: `1px solid ${C.beige}` }}>
            <h2 className="flex-1 text-[14px] font-semibold">
              {vistaTabla === "resumen" ? "Flujo de caja · resumen" : vistaTabla === "detalle" ? "Flujo de caja · detalle por cuenta" : "Fuentes y usos de capital"}
            </h2>
            {vistaTabla === "fuentes" && (
              <Pastillas etiqueta="Vista" valor={vista} onChange={setVista}
                opciones={[{ id: "valores", label: "Valores" }, { id: "vertical", label: "% de fuentes" }]} />
            )}
            <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: C.texto2 }}>
              <input type="checkbox" checked={ocultarCeros} onChange={(e) => setOcultarCeros(e.target.checked)}
                     className="w-4 h-4" style={{ accentColor: C.acento }} />
              Ocultar cuentas en cero
            </label>
            <div role="tablist" aria-label="Vista del flujo" className="flex flex-wrap gap-1 p-1 rounded-lg" style={{ background: "#F3F5F4" }}>
              {/* "Fuentes y usos" (versión anterior, 11 + 13) ya no se ofrece: solo queda como respaldo si falta el flujo nuevo */}
              {([["resumen", "Resumen"], ["detalle", "Detalle"]] as [VistaTabla, string][])
                .filter(() => c11)
                .map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={vistaTabla === id} onClick={() => setVistaTabla(id)}
                          className="h-8 px-3.5 rounded-md text-[12px] transition-colors"
                          style={vistaTabla === id ? { background: "#FFFFFF", color: C.acento, fontWeight: 600, boxShadow: "0 1px 2px rgba(17,20,24,0.08)" } : { color: C.texto2 }}>
                    {label}
                  </button>
                ))}
            </div>
          </div>
          {c11 && vistaTabla !== "fuentes" ? (
            <>
              <TablaCuenta11 key={vistaTabla} filas={c11[vistaTabla]} ocultarCeros={ocultarCeros} conCodigo={vistaTabla === "detalle"} />
              {Math.abs(c11.diferenciaMaxima) >= 1 && (
                <p className="px-4 py-3 text-[12px] flex items-center gap-2" style={{ color: C.alerta, borderTop: `1px solid ${C.beige}` }}>
                  <AlertTriangle size={15} /> El saldo final del flujo no coincide con la cuenta 11 del Balance (diferencia de hasta {usd(c11.diferenciaMaxima)}).
                </p>
              )}
            </>
          ) : (
          <div className="tabla-fija">
            <table className="w-full table-fixed text-[11px] border-collapse min-w-[1250px]">
              <colgroup>
                <col style={{ width: 270 }} />
                {NOMBRES_MES.map((m) => <col key={m} />)}
                <col style={{ width: 86 }} />
                <col style={{ width: 27 }} />
              </colgroup>
              <thead>
                <tr className="text-[11px] font-semibold" style={{ background: "#FFFFFF", color: C.texto2, borderBottom: "2px solid #DDE2DF", height: 34 }}>
                  <th className="pl-4 pr-2 text-left font-semibold">Concepto</th>
                  {NOMBRES_MES.map((m) => (
                    <th key={m} className="px-1 text-right font-semibold">{m}</th>
                  ))}
                  <th className="pl-2 pr-3 text-right font-semibold whitespace-nowrap">Total año</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 7).map((nodo, i) => (
                  <Fila key={`${nodo.label}-${i}`} nodo={nodo} indiceRaiz={i} nivel={0} vista={vista}
                        fuentes={F} fuentesAnio={fuentesAnio} ocultarCeros={ocultarCeros}
                        filaAbierta={filaAbierta} onAbrirFormula={abrirFormula}
                        mesFormula={mesFormula} onMesFormula={setMesFormula} />
                ))}
                {/* Holgura al final, sin franjas de color */}
                <tr aria-hidden="true" style={{ height: 13 }}><td colSpan={15} /></tr>
                <tr style={{ borderTop: "1px solid #B9C3BD", height: 36 }}>
                  <td className="pl-4 pr-2 text-[12px] font-bold truncate" style={{ color: C.texto }}
                      title="Disponible para concesión de créditos − Monto de préstamos a conceder">
                    Holgura de liquidez
                  </td>
                  {holgura.map((h, i) => (
                    <td key={i} className="px-1 text-right whitespace-nowrap font-semibold" style={{ color: h >= 0 ? C.ok : C.alerta }}>
                      {numero(h)}
                    </td>
                  ))}
                  <td className="pl-2 pr-3 text-right text-[11px] font-semibold whitespace-nowrap" style={{ color: negativos ? C.alerta : C.ok }}>
                    {negativos ? `${negativos}/12 en déficit` : "12/12 meses"}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          )}
        </section>
      ) : (
        <>
          {(negativos > 0 || caida > 0.5) && (
            <div role="note" className="tarjeta flex items-start gap-3 px-4 py-3 text-[12px]" style={{ color: C.texto3 }}>
              <AlertTriangle size={18} className="shrink-0 mt-px" color={negativos ? C.alerta : C.aviso} />
              <span>
                {negativos > 0 ? (
                  <><strong style={{ color: C.alerta }}>La holgura de liquidez es negativa en {negativos} de 12 meses.</strong> En esos meses se planea prestar más de lo disponible después del encaje.</>
                ) : (
                  <><strong style={{ color: "#7A4F0E" }}>La holgura de liquidez baja de {millones(holgura[0])} en enero a {millones(holgura[11])} en diciembre ({pct(caida * 100, 0)} menos).</strong>{" "}
                  Sigue siendo positiva los 12 meses{mesesParaAgotar ? `, pero a este ritmo se agotaría en unos ${mesesParaAgotar} meses después de diciembre` : ""}.</>
                )}{" "}
                {netoMax < 0
                  ? <>Cada mes sale más efectivo del que entra: entre {millones(-netoMax)} y {millones(-netoMin)} netos después de colocar créditos.</>
                  : null}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="tarjeta overflow-hidden flex flex-col">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
                <h2 className="flex-1 min-w-[180px] text-[14px] font-semibold">¿De dónde viene y a dónde va el efectivo?</h2>
                <ChipsMes valor={mesCascada} onChange={setMesCascada} etiqueta="Mes de la cascada" />
              </div>
              <div className="px-5 py-4">
                <Cascada si={SI[mesCascada]} f={F[mesCascada]} u={U[mesCascada]} p={P[mesCascada]} sf={SF[mesCascada]} />
              </div>
            </section>

            <section className="tarjeta overflow-hidden flex flex-col">
              <div className="flex flex-wrap items-center gap-4 px-4 py-3" style={{ borderBottom: `1px solid ${C.beige}` }}>
                <h2 className="flex-1 min-w-[180px] text-[14px] font-semibold">Saldo final frente al encaje mínimo</h2>
                <span className="flex items-center gap-1.5 text-[12px]" style={{ color: C.texto3 }}>
                  <span className="w-3.5 h-[3px] rounded" style={{ background: C.acento }} />Saldo final
                </span>
                <span className="flex items-center gap-1.5 text-[12px]" style={{ color: C.texto3 }}>
                  <span className="w-3.5" style={{ borderTop: `2px dashed ${C.texto2}` }} />Encaje (reservas)
                </span>
              </div>
              <div className="px-5 py-4">
                <LineaSaldoEncaje saldo={SF} encaje={R} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default function FlujoEfectivoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-[#3D4843]">Cargando flujo de efectivo...</div>}>
      <FlujoEfectivoContenido />
    </Suspense>
  );
}
