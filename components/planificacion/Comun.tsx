"use client";

import { type ReactNode } from "react";
import { C } from "../ActivosComun";
import { colocacion, type Ctx, type ResultadoModelo, type BasePlan, type ProductoPlan, type Referencias, type TopesPlan } from "../../lib/calc/planificacion";
import { ejercicioEnUso } from "../../lib/seleccion";

/** Formatos, gráficos pequeños (SVG) y piezas comunes de Examen, Plan de metas y Simulador. */
export const usd = (v: number) => (v < 0 ? "(" : "") + "$" + Math.round(Math.abs(v)).toLocaleString("es-EC") + (v < 0 ? ")" : "");
export const mill = (v: number) => (v < 0 ? "−" : "") + "$" + (Math.abs(v) / 1e6).toFixed(Math.abs(v) >= 1e7 ? 1 : 2).replace(".", ",") + " M";
export const pc = (v: number, d = 1) => (v * 100).toFixed(d).replace(".", ",") + " %";
export const num2 = (v: number) => v.toFixed(2).replace(".", ",");
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const per = (p: string) => `${MES[Number(p.slice(5)) - 1]}-${p.slice(2, 4)}`;
/** Real de la agencia: último mes cargado en Históricos (estado de resultados acumulado del año y saldos de ese balance). */
export interface RealCargado { periodo: string; utilidad: number; roa: number; morosidad: number; cartera: number; captaciones: number }

export interface PuntoTray { p: string; cartera: number; mora: number; capt: number; utAcum: number; utMes?: number }
export interface DatosPlanificacion {
  bases: Record<string, BasePlan>;
  trayectoria: Record<string, PuntoTray[]>;
  asesores: Record<string, number>;
  plazosAgencia: Record<string, Partial<Record<ProductoPlan, number>>>;
  config: { referencias: Referencias; plazos: Record<ProductoPlan, number>; topes: TopesPlan; costoAsesor: number;
    metaInst?: number; cumplMeta?: number | null; ajustes?: Record<string, Record<string, Record<string, number>>>; incSal?: number; infl?: number };
  escenarios: { id: number; agencia: string; nombre: string; palancas: import("../../lib/calc/planificacion").Palancas | Record<string, unknown>; meta: number | null; creado: string; autor: string | null; estado: "Borrador" | "Aprobado" | "Reemplazado" }[];
  parametros?: Record<string, { mix: [number, number, number]; credito: Record<string, { tasa: number; pctRec: number; efect: number; recVenc: number; dist: number | null }>; vistaNeto: number | null }>;
  metasAsesor?: [number, number, number];
  error?: string;
}

/** Contexto del modelo para una oficina (Consolidado: asesores = suma de las agencias). */
export function contexto(d: DatosPlanificacion, agencia: string): Ctx | null {
  const base = d.bases[agencia]; if (!base) return null;
  const totalAses = Object.values(d.asesores).reduce((a, b) => a + b, 0);
  const asesores = agencia === "Consolidado" ? totalAses : d.asesores[agencia] ?? 0;
  const plazos = { ...d.config.plazos, ...(d.plazosAgencia[agencia] ?? {}) };
  const sinProd: Ctx = { base, asesores, plazos, ref: d.config.referencias, topes: d.config.topes, costoAsesor: d.config.costoAsesor, prodCoop: 0 };
  const cons = d.bases["Consolidado"];
  const prodCoop = cons && totalAses && agencia !== "Consolidado"
    ? colocacion({ ...sinProd, base: cons, plazos: d.config.plazos }, null).total / totalAses : 0;
  return { ...sinProd, prodCoop };
}

export function Semaforo({ e }: { e: "ok" | "avi" | "mal" }) {
  const t = { ok: ["✓ Cumple", C.ok, "#E6F1EA"], avi: ["! Cerca", "#8A5A12", "#FBF1DC"], mal: ["✕ No cumple", C.alerta, "#FBE4E1"] }[e];
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap" style={{ color: t[1], background: t[2] }}>{t[0]}</span>;
}

/** Línea (o barras) de la trayectoria mensual con marcas de diciembre. */
export function Linea({ serie, campo, fmt, referencia, barras }: { serie: PuntoTray[]; campo: keyof PuntoTray; fmt: (v: number) => string; referencia?: number; barras?: boolean }) {
  const W = 300, H = 92, pad = 6, n = serie.length;
  if (n < 2) return null;
  const vals = serie.map((s) => Number(s[campo]) || 0);
  let mn = Math.min(...vals, referencia ?? Infinity), mx = Math.max(...vals, referencia ?? -Infinity);
  if (barras) { mn = Math.min(0, mn); mx = Math.max(0, mx); }
  const r = mx - mn || 1;
  const x = (i: number) => pad + (i / (n - 1)) * (W - 2 * pad), y = (v: number) => H - 14 - ((v - mn) / r) * (H - 24);
  const bw = Math.max(2, (W - 2 * pad) / n - 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
      {serie.map((s, i) => s.p.endsWith("-12") && (
        <g key={s.p}><line x1={x(i)} x2={x(i)} y1={4} y2={H - 14} stroke="#E6E2D8" /><text x={x(i)} y={H - 2} fontSize={9} textAnchor="middle" fill="#7A847F">{per(s.p)}</text></g>
      ))}
      {referencia !== undefined && <line x1={pad} x2={W - pad} y1={y(referencia)} y2={y(referencia)} stroke="#111418" strokeDasharray="3 3" />}
      {barras ? <>
        {serie.map((s, i) => { const v = vals[i]; return <rect key={s.p} x={x(i) - bw / 2} y={Math.min(y(v), y(0))} width={bw} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={1.5} fill={v < 0 ? "#C2654A" : C.acento}><title>{`${per(s.p)}: ${fmt(v)}`}</title></rect>; })}
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#B9C3BD" />
      </> : <>
        <polyline fill="none" stroke={C.acento} strokeWidth={2} strokeLinejoin="round" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={6} fill="transparent"><title>{`${per(serie[i].p)}: ${fmt(v)}`}</title></circle>)}
        <circle cx={x(n - 1)} cy={y(vals[n - 1])} r={3.5} fill={C.acento} stroke="#fff" strokeWidth={2} />
      </>}
    </svg>
  );
}

function etiquetas(l: string) { const w = l.split(" "); if (w.length <= 2) return [l, ""]; const k = Math.ceil(w.length / 2); return [w.slice(0, k).join(" "), w.slice(k).join(" ")]; }

/** Cascada del resultado: de los intereses de cartera a la utilidad. */
export function Cascada({ m }: { m: ResultadoModelo }) {
  const pasos: [string, number][] = ([
    ["Intereses de cartera", m.ingCart + m.ingOtrosCart], ["Inversiones y fondos internos", m.ingLiq + m.cobInt],
    ["Costo de captaciones", -m.costoCapt], ["Interés a otras oficinas", -m.pagInt - m.otrosGastosFin],
    ["Provisiones", -m.prov], ["Personal", -m.personal], ["Gastos generales", -m.generales], ["Otros ingresos y gastos", m.otrosIngresos - m.otrosGastos],
  ] as [string, number][]).filter(([, v]) => Math.abs(v) >= 500);
  return <Escalones inicio={null} pasos={pasos} final={["Utilidad", m.utilidad]} />;
}

export function Escalones({ inicio, pasos, final }: { inicio: [string, number] | null; pasos: [string, number][]; final: [string, number] }) {
  const W = 980, H = 236, top = 18, base = 190;
  const n = pasos.length + 1 + (inicio ? 1 : 0), paso = (W - 40) / n, bw = paso - 16;
  const niveles = [0, inicio ? inicio[1] : 0]; let acc = inicio ? inicio[1] : 0;
  pasos.forEach(([, v]) => { acc += v; niveles.push(acc); }); niveles.push(final[1]);
  const mx = Math.max(...niveles), mn = Math.min(...niveles), r = mx - mn || 1;
  const y = (v: number) => top + (mx - v) / r * (base - top);
  const items: ReactNode[] = []; let k = 0; acc = 0;
  const barra = (lbl: string, a: number, z: number, color: string, txt: string, fuerte = false) => {
    const x = 20 + k * paso + 8, [l1, l2] = etiquetas(lbl); k++;
    items.push(<g key={lbl + k}>
      <rect x={x} y={Math.min(y(a), y(z))} width={bw} height={Math.max(2, Math.abs(y(a) - y(z)))} rx={4} fill={color}><title>{`${lbl}: ${usd(z - a)}`}</title></rect>
      <text x={x + bw / 2} y={Math.min(y(a), y(z)) - 5} fontSize={11} textAnchor="middle" fontWeight={fuerte ? 800 : 700}>{txt}</text>
      <text x={x + bw / 2} y={base + 16} fontSize={10.5} textAnchor="middle" fill="#3D4843" fontWeight={fuerte ? 700 : 400}>{l1}</text>
      {l2 && <text x={x + bw / 2} y={base + 29} fontSize={10.5} textAnchor="middle" fill="#3D4843">{l2}</text>}
    </g>);
  };
  if (inicio) { barra(inicio[0], 0, inicio[1], inicio[1] < 0 ? "#B42318" : "#1E6B3A", mill(inicio[1])); acc = inicio[1]; }
  pasos.forEach(([l, v]) => { barra(l, acc, acc + v, v >= 0 ? C.acento : "#C2654A", (v >= 0 && inicio ? "+" : "") + mill(v)); acc += v; });
  barra(final[0], 0, final[1], final[1] >= 0 ? "#1E6B3A" : "#B42318", mill(final[1]), true);
  return <svg viewBox={`0 0 ${W} ${H + 6}`} width="100%" role="img"><line x1={20} x2={W - 20} y1={y(0)} y2={y(0)} stroke="#B9C3BD" />{items}</svg>;
}

/** Fila Hoy | Plan | Cambio (mejor = 1: subir es bueno; -1: bajar es bueno; 0: neutro). */
export function FilaComp({ l, a, m, fmt = usd, mejor = 1, tipo }: { l: ReactNode; a: number; m: number; fmt?: (v: number) => string; mejor?: number; tipo?: "sub" | "tot" }) {
  const dx = m - a, nada = Math.abs(dx) < (fmt === usd ? 0.5 : 1e-6);
  const col = nada || mejor === 0 ? C.texto2 : dx * mejor >= 0 ? C.ok : C.alerta;
  return (
    <tr style={{ borderTop: tipo === "tot" ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: 34, fontWeight: tipo === "tot" ? 700 : 400 }}>
      <td className="pl-4 pr-2" style={{ color: tipo === "sub" ? C.texto2 : C.texto3 }}>{l}</td>
      <td className="px-3 text-right whitespace-nowrap tabla-cifras">{fmt(a)}</td>
      <td className="px-3 text-right whitespace-nowrap tabla-cifras font-semibold">{fmt(m)}</td>
      <td className="pr-4 pl-3 text-right whitespace-nowrap tabla-cifras" style={{ color: col }}>{nada ? "—" : `${dx > 0 ? "+" : "−"}${fmt === usd ? usd(Math.abs(dx)) : fmt(Math.abs(dx))}`}</td>
    </tr>
  );
}
export function CabeceraComp({ a = "Ritmo actual", b = `Plan ${ejercicioEnUso()}`, c = "Cambio" }: { a?: string; b?: string; c?: string }) {
  return (
    <thead><tr style={{ color: C.texto2, height: 36, borderBottom: "2px solid #DDE2DF" }}>
      <th className="pl-4 text-left font-semibold">Concepto</th><th className="px-3 text-right font-semibold">{a}</th><th className="px-3 text-right font-semibold">{b}</th><th className="pr-4 text-right font-semibold">{c}</th>
    </tr></thead>
  );
}
export const BOTON = "h-8 px-3 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap";
export const BOTON_STYLE = { border: "1px solid #C9D0CC", background: "#FFFFFF", color: C.texto };

/** Estilos de impresión: solo el informe, sin menú ni controles. */
export const ESTILO_IMPRESION = `@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body > div > :not(:has(main)), .no-print { display: none !important; }
  main > div { padding: 0 !important; gap: 12px !important; }
  body, main { background: #FFFFFF !important; }
  .informe { border: 0 !important; box-shadow: none !important; max-width: none !important; }
  .informe .sec { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
