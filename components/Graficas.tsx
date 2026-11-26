"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Gráficas livianas en SVG (sin librerías): línea, barras de entradas/salidas y barras apiladas.
 * Marcas finas, un solo eje, cuadrícula tenue, leyenda cuando hay 2+ series y detalle al pasar el mouse.
 */

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const T = { texto: "#111418", texto2: "#3D4843", tenue: "#7A847F", grilla: "#E6EAE8", base: "#C3CAC6", superficie: "#FFFFFF" };

export const SERIE = { verde: "#178a52", azul: "#2a78d6", dorado: "#c98500", rojo: "#c4372f" };

function corto(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",")} M`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} mil`;
  return `${s}${Math.round(a)}`;
}
/** Etiqueta del eje con los decimales que pide el paso entre marcas (así no se repiten "9,3 M"). */
function eje(v: number, paso: number): string {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  const unidad = a >= 1e6 || paso >= 1e6 ? 1e6 : a >= 1e3 || paso >= 1e3 ? 1e3 : 1;
  const sufijo = unidad === 1e6 ? " M" : unidad === 1e3 ? " mil" : "";
  const dec = Math.min(2, Math.max(0, Math.ceil(-Math.log10(paso / unidad) - 1e-9)));
  return `${s}${(a / unidad).toFixed(dec).replace(".", ",")}${sufijo}`;
}
const usd = (v: number) => (v < 0 ? "−$" : "$") + Math.abs(Math.round(v)).toLocaleString("es-EC");

function pasos(min: number, max: number, n = 4): number[] {
  if (min === max) { max = min + 1; }
  const bruto = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? bruto;
  const ini = Math.floor(min / paso) * paso, fin = Math.ceil(max / paso) * paso;
  const out: number[] = [];
  for (let v = ini; v <= fin + paso / 2; v += paso) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function useAncho<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setAncho(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

export function Leyenda({ items }: { items: { label: string; color: string; forma?: "linea" | "barra" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: T.texto2 }}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.forma === "linea"
            ? <span className="w-3.5 h-[2px] rounded" style={{ background: it.color }} />
            : <span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, ancho, children }: { x: number; ancho: number; children: ReactNode }) {
  const izq = x > ancho - 190;
  return (
    <div className="absolute top-1 pointer-events-none z-10 rounded-md px-2.5 py-2 text-[11px] leading-[1.45] whitespace-nowrap"
         style={{ left: izq ? undefined : x + 12, right: izq ? ancho - x + 12 : undefined, background: T.superficie, color: T.texto,
                  border: "1px solid #D5DBD7", boxShadow: "0 4px 14px rgba(17,20,24,0.10)" }}>
      {children}
    </div>
  );
}

const ALTO = 210, M = { arriba: 14, abajo: 26, izq: 52, der: 14 };

/** Línea de 12 meses, con el punto de partida (saldo inicial) a la izquierda. */
export function GraficaLinea({ valores, inicial, color = SERIE.verde, nombre }: { valores: number[]; inicial: number; color?: string; nombre: string }) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const puntos = [inicial, ...valores];
  const lo = Math.min(...puntos), hi = Math.max(...puntos);
  const margen = (hi - lo) * 0.15 || Math.abs(hi) * 0.02 || 1;
  const ticks = pasos(lo - margen, hi + margen);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const w = ancho - M.izq - M.der, h = ALTO - M.arriba - M.abajo;
  const px = (i: number) => M.izq + (w * i) / 12; // 0 = inicial, 1..12 = meses
  const py = (v: number) => M.arriba + h - ((v - y0) / (y1 - y0 || 1)) * h;
  const linea = puntos.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join("");
  const area = `${linea}L${px(12)},${M.arriba + h}L${px(0)},${M.arriba + h}Z`;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={ancho} height={ALTO} role="img" aria-label={`${nombre}: de ${usd(inicial)} a ${usd(valores[11])} en el año`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.izq} x2={ancho - M.der} y1={py(t)} y2={py(t)} stroke={T.grilla} strokeWidth={1} />
            <text x={M.izq - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill={T.tenue}>{eje(t, ticks[1] - ticks[0])}</text>
          </g>
        ))}
        <path d={area} fill={color} opacity={0.08} />
        <path d={linea} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <text x={px(0)} y={ALTO - 8} textAnchor="start" fontSize={10} fill={T.tenue}>Inicio</text>
        {MESES.map((m, i) => (i % 2 === 1 || ancho > 520) && <text key={m} x={px(i + 1)} y={ALTO - 8} textAnchor="middle" fontSize={10} fill={T.tenue}>{m}</text>)}
        <circle cx={px(0)} cy={py(inicial)} r={3.5} fill={T.superficie} stroke={color} strokeWidth={2} />
        <circle cx={px(12)} cy={py(valores[11])} r={4} fill={color} stroke={T.superficie} strokeWidth={2} />
        <text x={px(12) - 6} y={py(valores[11]) - 9} textAnchor="end" fontSize={10.5} fontWeight={600} fill={T.texto}>{corto(valores[11])}</text>
        {hover !== null && (
          <g>
            <line x1={px(hover)} x2={px(hover)} y1={M.arriba} y2={M.arriba + h} stroke={T.base} strokeWidth={1} />
            <circle cx={px(hover)} cy={py(puntos[hover])} r={4.5} fill={color} stroke={T.superficie} strokeWidth={2} />
          </g>
        )}
        {/* Zonas de hover más anchas que la marca */}
        {puntos.map((_, i) => (
          <rect key={i} x={px(i) - w / 24} y={M.arriba} width={w / 12} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={px(hover)} ancho={ancho}>
          <div className="font-semibold">{hover === 0 ? "Saldo de partida" : MESES[hover - 1]}</div>
          <div>{usd(puntos[hover])}</div>
          {hover > 0 && (
            <div style={{ color: puntos[hover] >= puntos[hover - 1] ? "#1E6B3A" : "#B42318" }}>
              {puntos[hover] >= puntos[hover - 1] ? "+" : ""}{usd(puntos[hover] - puntos[hover - 1])} vs. mes anterior
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/** Barras de entradas (arriba de cero) y salidas (abajo de cero) por mes; el neto va en el detalle. */
export function GraficaEntradasSalidas({ entradas, salidas, etiquetaEntradas, etiquetaSalidas }: {
  entradas: number[]; salidas: number[]; etiquetaEntradas: string; etiquetaSalidas: string;
}) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const sal = salidas.map((v) => -Math.abs(v));
  const ticks = pasos(Math.min(0, ...sal), Math.max(0, ...entradas));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const w = ancho - M.izq - M.der, h = ALTO - M.arriba - M.abajo;
  const banda = w / 12, barra = Math.min(22, banda * 0.5);
  const cx = (i: number) => M.izq + banda * i + banda / 2;
  const py = (v: number) => M.arriba + h - ((v - y0) / (y1 - y0 || 1)) * h;
  const cero = py(0);
  const r = 3;
  const barraRedonda = (x: number, yTope: number, yBase: number, arriba: boolean) => {
    const alto = Math.abs(yBase - yTope);
    if (alto < 0.5) return "";
    const rr = Math.min(r, alto, barra / 2);
    return arriba
      ? `M${x},${yBase}V${yTope + rr}Q${x},${yTope} ${x + rr},${yTope}H${x + barra - rr}Q${x + barra},${yTope} ${x + barra},${yTope + rr}V${yBase}Z`
      : `M${x},${yBase}V${yTope - rr}Q${x},${yTope} ${x + rr},${yTope}H${x + barra - rr}Q${x + barra},${yTope} ${x + barra},${yTope - rr}V${yBase}Z`;
  };
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={ancho} height={ALTO} role="img" aria-label={`${etiquetaEntradas} y ${etiquetaSalidas} por mes`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.izq} x2={ancho - M.der} y1={py(t)} y2={py(t)} stroke={t === 0 ? T.base : T.grilla} strokeWidth={1} />
            <text x={M.izq - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill={T.tenue}>{eje(t, ticks[1] - ticks[0])}</text>
          </g>
        ))}
        {MESES.map((m, i) => (
          <g key={m} opacity={hover === null || hover === i ? 1 : 0.45}>
            <path d={barraRedonda(cx(i) - barra / 2, py(entradas[i]), cero - 1, true)} fill={SERIE.verde} />
            <path d={barraRedonda(cx(i) - barra / 2, py(sal[i]), cero + 1, false)} fill={SERIE.rojo} />
            {(i % 2 === 0 || ancho > 520) && <text x={cx(i)} y={ALTO - 8} textAnchor="middle" fontSize={10} fill={T.tenue}>{m}</text>}
            <rect x={M.izq + banda * i} y={M.arriba} width={banda} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={cx(hover)} ancho={ancho}>
          <div className="font-semibold">{MESES[hover]}</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: SERIE.verde }} />{etiquetaEntradas}: {usd(entradas[hover])}</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: SERIE.rojo }} />{etiquetaSalidas}: {usd(-Math.abs(salidas[hover]))}</div>
          <div className="font-semibold mt-0.5" style={{ color: entradas[hover] + sal[hover] >= 0 ? "#1E6B3A" : "#B42318" }}>
            Neto: {entradas[hover] + sal[hover] >= 0 ? "+" : ""}{usd(entradas[hover] + sal[hover])}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/** Barras apiladas por mes (composición del total), con 2 px de separación entre segmentos. */
export function GraficaApilada({ series }: { series: { label: string; color: string; valores: number[] }[] }) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totales = MESES.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.valores[i]), 0));
  const ticks = pasos(0, Math.max(...totales));
  const y1 = ticks[ticks.length - 1];
  const w = ancho - M.izq - M.der, h = ALTO - M.arriba - M.abajo;
  const banda = w / 12, barra = Math.min(30, banda * 0.6);
  const cx = (i: number) => M.izq + banda * i + banda / 2;
  const py = (v: number) => M.arriba + h - (v / (y1 || 1)) * h;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={ancho} height={ALTO} role="img" aria-label={`Composición mensual: ${series.map((s) => s.label).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.izq} x2={ancho - M.der} y1={py(t)} y2={py(t)} stroke={t === 0 ? T.base : T.grilla} strokeWidth={1} />
            <text x={M.izq - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill={T.tenue}>{eje(t, ticks[1] - ticks[0])}</text>
          </g>
        ))}
        {MESES.map((m, i) => {
          let acum = 0;
          return (
            <g key={m} opacity={hover === null || hover === i ? 1 : 0.45}>
              {series.map((s, k) => {
                const v = Math.max(0, s.valores[i]);
                const yA = py(acum + v), yB = py(acum);
                acum += v;
                const alto = Math.max(0, yB - yA - (k > 0 ? 2 : 0)); // 2 px de separación entre segmentos
                const ultimo = k === series.length - 1;
                return <rect key={s.label} x={cx(i) - barra / 2} y={yA} width={barra} height={alto} rx={ultimo ? 3 : 0} fill={s.color} />;
              })}
              {(i % 2 === 0 || ancho > 520) && <text x={cx(i)} y={ALTO - 8} textAnchor="middle" fontSize={10} fill={T.tenue}>{m}</text>}
              <rect x={M.izq + banda * i} y={M.arriba} width={banda} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip x={cx(hover)} ancho={ancho}>
          <div className="font-semibold">{MESES[hover]} · {usd(totales[hover])}</div>
          {[...series].reverse().map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
              {s.label}: {usd(s.valores[hover])} ({totales[hover] ? ((s.valores[hover] / totales[hover]) * 100).toFixed(1).replace(".", ",") : "0"} %)
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}
