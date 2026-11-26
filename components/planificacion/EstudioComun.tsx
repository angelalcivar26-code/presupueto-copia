"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usd, pct, leerNumero } from "../ActivosComun";
import { apiFetch } from "../../lib/useDatos";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * Piezas del Estudio de agencia: paleta institucional, formatos, gráfico pequeño de tendencia, selector de vista,
 * tablas sobrias (Tahoma) y casillas de la Propuesta.
 */
export const E = {
  verde: "#005A28", verdeSuave: "#E6F0EA", oro: "#C38A03", oroSuave: "#FBF3E0",
  tinta: "#1F2A24", gris: "#5B6660", tenue: "#8A948F", linea: "#E3E7E4", fondo: "#F6F8F7", alerta: "#B42318", alertaSuave: "#FBEAE8",
};
export const NUM = { fontFamily: "Tahoma, Verdana, sans-serif", fontVariantNumeric: "tabular-nums" as const };

const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
export const p2 = (v: number | null | undefined) => (ok(v) ? pct(v, 2) : "—");
export const p1 = (v: number | null | undefined) => (ok(v) ? pct(v, 1) : "—");
export const u = (v: number | null | undefined) => (!ok(v) || Math.round(v) === 0 ? "—" : usd(v));
export const n2 = (v: number | null | undefined) => (ok(v) ? v.toFixed(2).replace(".", ",") : "—");
/** Millones / miles compactos: $4,91 M · $633 mil (negativos entre paréntesis). */
export const corto = (v: number | null | undefined) => {
  if (!ok(v)) return "—";
  const a = Math.abs(v), s = a >= 1e6 ? `$${(a / 1e6).toFixed(2).replace(".", ",")} M` : a >= 1e3 ? `$${Math.round(a / 1e3).toLocaleString("es-EC")} mil` : `$${Math.round(a)}`;
  return v < 0 ? `(${s})` : s;
};
export const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
export type TipoDif = "usd" | "pp" | "num";
export const difFmt = (d: number, t: TipoDif = "usd") =>
  t === "pp" ? `${d < 0 ? "(" : "+"}${(Math.abs(d) * 100).toFixed(2).replace(".", ",")} pp${d < 0 ? ")" : ""}`
  : t === "num" ? `${d < 0 ? "(" : "+"}${Math.abs(d).toFixed(2).replace(".", ",")}${d < 0 ? ")" : ""}`
  : d < 0 ? usd(d) : `+${usd(d)}`;

/** Selector de vista dentro de una cuenta. */
function Vistas<T extends string>({ valor, opciones, onChange }: { valor: T; opciones: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg p-0.5" style={{ background: E.fondo, border: `1px solid ${E.linea}` }}>
      {opciones.map((o) => {
        const on = o.id === valor;
        return (
          <button key={o.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.id)}
            className="h-8 px-4 rounded-md text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#005A28]/40"
            style={{ background: on ? "#fff" : "transparent", color: on ? E.verde : E.gris, fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(31,42,36,.08)" : undefined }}>{o.label}</button>
        );
      })}
    </div>
  );
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const perCorto = (p: string) => `${MES[Number(p.slice(5)) - 1]}-${p.slice(2, 4)}`;

/** Tabla sobria: cabecera tenue, filas con línea fina, cifras en Tahoma alineadas a la derecha. */
export const T = {
  tabla: "w-full border-collapse text-[12px]",
  th: "py-2 px-2 text-right font-normal whitespace-nowrap",
  thIzq: "py-2 pl-0 pr-2 text-left font-normal",
  td: "py-2 px-2 text-right whitespace-nowrap",
  tdIzq: "py-2 pl-0 pr-2 text-left",
  cab: { color: E.tenue, borderBottom: `1px solid ${E.linea}` },
  fila: { borderBottom: `1px solid ${E.linea}` },
};

/** Fila de grupo (línea de crédito o producto) dentro de una tabla. */
export function Grupo({ titulo, columnas }: { titulo: string; columnas: number }) {
  return <tr><td colSpan={columnas} className="pt-4 pb-1 text-[12px] font-semibold" style={{ color: E.oro }}>{titulo}</td></tr>;
}

/** Diferencia frente al presupuesto: verde si mejora, rojo si empeora (mejor = +1 más es mejor, −1 menos es mejor). */
export function Delta({ d, tipo = "usd", mejor = 1 }: { d: number; tipo?: TipoDif; mejor?: 1 | -1 | 0 }) {
  if (Math.abs(d) < (tipo === "usd" ? 0.5 : 1e-6)) return <span style={{ color: E.tenue }}>—</span>;
  const bueno = mejor === 0 ? null : d * mejor > 0;
  return <span style={{ color: bueno === null ? E.gris : bueno ? E.verde : E.alerta, ...NUM }}>{difFmt(d, tipo)}</span>;
}

/** Casilla de la Propuesta (en % o en número); se aplica al salir de la casilla o con Enter. */
export function entrada(v: number, alCambiar: (x: number) => void, esPct = true, clave = "", distinta = false) {
  return (
    <input key={`${clave}${v}`} defaultValue={esPct ? (v * 100).toFixed(2).replace(".", ",") : v.toFixed(2).replace(".", ",")} aria-label="Propuesta"
      onBlur={(e) => { const n = leerNumero(e.target.value); if (n !== null) alCambiar(Math.max(0, esPct ? n / 100 : n)); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-[84px] h-8 rounded-md px-2 text-right text-[12px] outline-none focus:ring-2 focus:ring-[#C38A03]/40"
      style={{ ...NUM, border: `1px solid ${distinta ? E.oro : E.linea}`, background: distinta ? E.oroSuave : "#fff", color: E.tinta }} />
  );
}

/** Botones para llevar una versión al presupuesto. */
/** La propuesta parte del presupuesto: «Aplicar propuesta» solo se habilita cuando se cambió algo. */
export function Acciones({ guardando, editada = true, onReal, onPropuesta, children }: { guardando: boolean; editada?: boolean; onReal: () => void; onPropuesta: () => void; children?: ReactNode }) {
  return (
    <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4" style={{ borderTop: `1px solid ${E.linea}` }}>
      {children}
      <button type="button" disabled={guardando} onClick={onReal} className="h-9 px-4 rounded-md text-[13px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${E.verde}`, color: E.verde, background: "#fff" }}>Aplicar ritmo real</button>
      <button type="button" disabled={guardando || !editada} onClick={onPropuesta} title={editada ? undefined : "Escriba un valor en la columna Propuesta para aplicarlo"} className="h-9 px-4 rounded-md text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: E.verde }}>Aplicar propuesta</button>
    </div>
  );
}

/** Envía un cambio al presupuesto de la agencia (con copia para deshacer). */
export type Enviar = (cuerpo: Record<string, unknown>, origen: string, confirmar: string) => Promise<boolean>;

/** Columnas de las tres versiones (Presupuesto · Ritmo real · Propuesta). */
export function CabVersiones({ anioReal, primera = "Concepto", extra, sin, antes, idoneo, rotuloReal }: { anioReal: number; primera?: string; extra?: string; sin?: string; antes?: string; idoneo?: boolean; rotuloReal?: string }) {
  return (
    <thead><tr style={T.cab}>
      <th className={T.thIzq}>{primera}</th>
      {antes && <th className={T.th}>{antes}</th>}
      <th className={T.th}>Presupuesto {ejercicioEnUso()}</th>
      <th className={T.th}>{rotuloReal ?? `Ritmo real ${anioReal}`}{sin ? ` sin ${sin}` : ""}</th>
      {idoneo && <th className={T.th} style={{ color: E.verde }}>Idóneo</th>}
      <th className={T.th} style={{ color: E.oro }}>Propuesta</th>
      {extra && <th className={T.th}>{extra}</th>}
    </tr></thead>
  );
}

/** Encabezado de una cuenta: código, nombre y selector de vista a la derecha. */
export function CabeceraCuenta<V extends string>({ codigo, nombre, vista, onVista, izquierda, extra = [] }: { codigo: string; nombre: string; vista: V; onVista: (v: V) => void; izquierda?: ReactNode; extra?: { id: V; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <h2 className="sr-only">{codigo} {nombre}</h2>
      <div className="flex-1 min-w-0 sm:min-w-max">{izquierda}</div>
      <Vistas<V> valor={vista} onChange={onVista} opciones={[{ id: "realidad" as V, label: "Realidad" }, { id: "supuestos" as V, label: "Supuestos" }, { id: "impacto" as V, label: `Impacto ${ejercicioEnUso()}` }, ...extra]} />
    </div>
  );
}

/** Selector del indicador del gráfico (mismo estilo que las pestañas de vista). */
export function SelectorIndicador({ lista, sel, onSel }: { lista: { id: string; label: string }[]; sel: string; onSel: (v: string) => void }) {
  return <Vistas valor={sel} onChange={onSel} opciones={lista.map((o) => ({ id: o.id, label: o.label }))} />;
}

export interface Indicador { id: string; label: string; serie: { p: string; v: number | null }[]; fmt: (v: number | null) => string; mejor: 1 | -1 | 0; pp?: boolean }

/** Tamaño real de un elemento (para dibujar el gráfico a su medida, sin estirar textos). */
export function useMedida<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [m, setM] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; setM((x) => (Math.abs(x.w - r.width) < 1 && Math.abs(x.h - r.height) < 1 ? x : { w: r.width, h: r.height })); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, m] as const;
}

/** Un indicador a la vez: selector (mismo estilo que Realidad · Supuestos · Impacto) y un gráfico que llena su espacio. */
export function Indicadores({ lista, sel: selExt }: { lista: Indicador[]; sel?: string }) {
  const [selInt, setSel] = useState(lista[0]?.id ?? "");
  const sel = selExt ?? selInt;
  const [hover, setHover] = useState<number | null>(null);
  const [ref, { w: W, h: H }] = useMedida<HTMLDivElement>();
  const ind = lista.find((x) => x.id === sel) ?? lista[0];
  const pts = ind ? ind.serie.filter((x): x is { p: string; v: number } => x.v !== null && Number.isFinite(x.v)) : [];
  const der = 10, arr = 10, aba = 22;
  const vals = pts.map((x) => x.v);
  let mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 1;
  if (!(mx > mn)) { mn -= Math.abs(mn) * 0.1 || 1; mx += Math.abs(mx) * 0.1 || 1; }
  const pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
  const x = (k: number) => izq + (pts.length > 1 ? (k / (pts.length - 1)) * (W - izq - der) : (W - izq - der) / 2);
  const y = (v: number) => arr + (1 - (v - mn) / (mx - mn)) * (H - arr - aba);
  const ticks = Array.from({ length: 4 }, (_, k) => mn + ((mx - mn) * k) / 3);
  // decimales suficientes para que las marcas del eje no se repitan (p. ej. $10,2 mil · $10,4 mil)
  const paso = (mx - mn) / 3, dec = (unidad: number) => Math.min(3, Math.max(0, Math.ceil(-Math.log10(paso / unidad))));
  const fx = (v: number, unidad: number, suf: string) => `$${(v / unidad).toFixed(dec(unidad)).replace(".", ",")}${suf}`;
  const big = Math.max(Math.abs(mn), Math.abs(mx));
  const eje = (v: number) => (ind?.pp ? `${(v * 100).toFixed(Math.max(1, dec(0.01))).replace(".", ",")} %` : big >= 1e6 ? fx(v, 1e6, " M") : big >= 1e3 ? fx(v, 1e3, " mil") : fx(v, 1, ""));
  // margen izquierdo a la medida de la marca más larga del eje
  const izq = Math.max(52, 14 + 6.2 * Math.max(...ticks.map((t) => eje(t).length)));
  const ult = pts.length - 1, sel2 = hover ?? ult, actual = pts[sel2];
  const dv = pts.length ? pts[ult].v - pts[0].v : 0, malo = ind && ind.mejor !== 0 && Math.abs(dv) > 1e-9 && dv * ind.mejor < 0;
  const color = malo ? E.alerta : E.verde;
  const linea = pts.map((p, k) => `${x(k)},${y(p.v)}`).join(" ");
  const etiqueta = actual && ind ? `${perCorto(actual.p)}  ${ind.fmt(actual.v)}` : "";
  const ew = etiqueta.length * 6.6 + 16, ex = actual ? Math.min(Math.max(x(sel2) - ew / 2, izq), W - der - ew) : 0, ey = actual ? Math.max(arr, y(actual.v) - 34) : 0;
  return (
    <div className="flex flex-col gap-3 flex-1 min-w-0">
      {selExt === undefined && lista.length > 1 && <div><Vistas valor={ind?.id ?? ""} onChange={(v) => { setSel(v); setHover(null); }} opciones={lista.map((o) => ({ id: o.id, label: o.label }))} /></div>}
      <div ref={ref} className="flex-1 min-h-[200px] relative">
        {ind && W > 0 && H > 0 && pts.length > 0 && (
          <svg width={W} height={H} role="img" className="absolute inset-0" aria-label={`${ind.label}: ${ind.fmt(pts[0].v)} en ${perCorto(pts[0].p)} y ${ind.fmt(pts[ult].v)} en ${perCorto(pts[ult].p)}`}
            style={{ display: "block", fontFamily: NUM.fontFamily }} onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); const k = Math.round(((e.clientX - b.left - izq) / (W - izq - der)) * Math.max(1, ult)); setHover(Math.max(0, Math.min(ult, k))); }}>
            {ticks.map((t, k) => <g key={k}><line x1={izq} x2={W - der} y1={y(t)} y2={y(t)} stroke="#EEF1EF" /><text x={izq - 8} y={y(t) + 4} fontSize={11} fill={E.tenue} textAnchor="end">{eje(t)}</text></g>)}
            {mn < 0 && mx > 0 && <line x1={izq} x2={W - der} y1={y(0)} y2={y(0)} stroke="#B9C3BD" />}
            <polygon points={`${x(0)},${H - aba} ${linea} ${x(ult)},${H - aba}`} fill={color} opacity={0.06} />
            <polyline points={linea} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && <line x1={x(sel2)} x2={x(sel2)} y1={arr} y2={H - aba} stroke={E.tenue} strokeDasharray="3 4" />}
            <circle cx={x(sel2)} cy={y(actual.v)} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
            {hover !== null && <g><rect x={ex} y={ey} width={ew} height={24} rx={5} fill="#fff" stroke={E.linea} /><text x={ex + ew / 2} y={ey + 16} fontSize={12} fill={E.tinta} textAnchor="middle">{etiqueta}</text></g>}
            {pts.map((p, k) => <text key={p.p} x={x(k)} y={H - 6} fontSize={11} fill={E.tenue} textAnchor="middle">{perCorto(p.p).slice(0, 3)}</text>)}
          </svg>
        )}
      </div>
    </div>
  );
}

/** Cifras clave a la derecha del gráfico. */
export function Lateral({ items }: { items: { t: string; v: string; sub?: string; subColor?: string; color?: string }[] }) {
  return (
    <aside className="flex flex-col justify-between pl-5" style={{ flex: "1 1 210px", borderLeft: `1px solid ${E.linea}` }}>
      {items.map((x, k) => (
        <div key={x.t} className="py-2" style={{ borderBottom: k < items.length - 1 ? `1px solid ${E.linea}` : undefined }}>
          <div className="text-[12px]" style={{ color: E.gris }}>{x.t}</div>
          <div className="text-[16px] font-bold" style={{ color: x.color ?? E.tinta, ...NUM }}>{x.v}</div>
          {x.sub && <div className="text-[12px]" style={{ color: x.subColor ?? E.gris }}>{x.sub}</div>}
        </div>
      ))}
    </aside>
  );
}

/** Franja al pie de la cuenta: utilidad presupuestada, con la cuenta a ritmo real y el efecto. */
export function BandaEfecto({ pres, real, cuenta, detalle, onDetalle, titulo = `Utilidad ${ejercicioEnUso()}` }: { pres: number; real: number; cuenta: string; detalle: boolean; onDetalle: () => void; titulo?: string }) {
  const ef = real - pres;
  const cifra = (v: number) => <div className="text-[16px] font-bold" style={{ color: v < 0 ? E.alerta : E.tinta, ...NUM }}>{u(v)}</div>;
  return (
    <section aria-label={`Efecto de ${cuenta} en la utilidad ${ejercicioEnUso()}`} className="mt-auto rounded-[10px] px-5 py-3 grid items-center gap-5" style={{ background: E.fondo, gridTemplateColumns: "repeat(3, minmax(0, 1fr)) auto" }}>
      <div><div className="text-[12px]" style={{ color: E.gris }}>{titulo} presupuestado{titulo.startsWith("Utilidad") ? "a" : ""}</div>{cifra(pres)}</div>
      <div><div className="text-[12px]" style={{ color: E.gris }}>Con {cuenta} a ritmo real</div>{cifra(real)}</div>
      <div><div className="text-[12px]" style={{ color: E.gris }}>Efecto de {cuenta}</div><div className="text-[16px] font-bold" style={{ color: ef < 0 ? E.alerta : E.verde, ...NUM }}>{difFmt(ef)}</div></div>
      <button type="button" onClick={onDetalle} className="text-[13px] font-semibold hover:underline whitespace-nowrap" style={{ color: E.verde }}>{detalle ? "Ocultar el detalle mensual" : "Ver el detalle mensual"}</button>
    </section>
  );
}

// borradores por agencia, leídos una vez del servidor y compartidos por las cuentas de la página
const borradoresSrv = new Map<string, Promise<Record<string, unknown>>>();
function leerBorradores(agencia: string) {
  let p = borradoresSrv.get(agencia);
  if (!p) {
    p = apiFetch(`/api/estudio-borradores?agencia=${encodeURIComponent(agencia)}`).then((r) => r.json()).then((j) => (j?.borradores ?? {}) as Record<string, unknown>).catch(() => { borradoresSrv.delete(agencia); return {}; });
    borradoresSrv.set(agencia, p);
  }
  return p;
}

/**
 * Borrador de la Propuesta guardado en la base (por agencia y cuenta): se mantiene al cambiar de sección, recargar
 * o abrir la herramienta desde otro equipo. Solo se borra al aplicarlo al presupuesto o con "Volver al ritmo real".
 * No toca el presupuesto ni obliga a recalcular nada.
 */
export function useBorrador<T>(agencia: string, cuenta: string, valido: (x: unknown) => x is T): [T | null, (v: T | null) => void, boolean] {
  const clave = `${agencia}|${cuenta}`;
  const [mem, setMem] = useState<Record<string, T | null>>({});
  const [srv, setSrv] = useState<Record<string, Record<string, unknown>>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    let vivo = true;
    leerBorradores(agencia).then((b) => { if (vivo) setSrv((m) => ({ ...m, [agencia]: b })); });
    return () => { vivo = false; };
  }, [agencia]);
  const cargado = agencia in srv;
  const desdeSrv = srv[agencia]?.[cuenta];
  const valor = clave in mem ? mem[clave] : valido(desdeSrv) ? desdeSrv : null;
  const poner = (v: T | null) => {
    setMem((m) => ({ ...m, [clave]: v }));
    // la copia compartida también se actualiza (otra cuenta de la página la vuelve a leer igual)
    leerBorradores(agencia).then((b) => { if (v === null) delete b[cuenta]; else b[cuenta] = v; });
    clearTimeout(timers.current[clave]);
    timers.current[clave] = setTimeout(() => {
      apiFetch("/api/estudio-borradores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencia, cuenta, datos: v }) }).catch(() => undefined);
    }, v === null ? 0 : 600);
  };
  return [valor, poner, cargado];
}

/** Aviso de borrador guardado y enlace para volver al ritmo real (al pie de Supuestos). */
export function BorradorLinks({ editada, onReal }: { editada: boolean; onReal: () => void }) {
  if (!editada) return null;
  return (
    <span className="inline-flex items-center gap-3 text-[12px]" style={{ color: E.tenue }}>
      Cambios sin aplicar
      <button type="button" className="text-[13px] font-semibold hover:underline" style={{ color: E.verde }}
        onClick={() => { if (window.confirm("Se descartan los cambios de la propuesta: vuelve a lo que está en el presupuesto. ¿Continuar?")) onReal(); }}>Descartar</button>
      <span aria-hidden>·</span>
    </span>
  );
}
