"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useDatos } from "../../lib/useDatos";
import { useBasesPresupuesto } from "../../lib/useBasesPresupuesto";
import { EsqueletoTabla } from "../Carga";
import { C, F_TABLA, F_TEXTO, AGENCIAS, BotonF, cifra } from "../EgresosComun";
import {
  cifrasReal, cifrasPresupuesto, sumarCifras, GASTOS, INGRESOS, ingresos, gastos, gastosOperacion, utilidad, carteraBruta,
  consumo, interesSocios, costoCaptaciones, fondosSinColocar, costoSinColocar, gastoPrincipal, div,
  type Cifras, type RealOficina,
} from "../../lib/calc/analisis-agencia";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * ANÁLISIS DE AGENCIA: el real de la agencia (último mes de Históricos, llevado a 12 meses) junto al presupuesto 2027.
 * Cuatro subpestañas: Destino de los ingresos · Rentabilidad de la cartera · Captaciones y cartera · Comparación entre
 * agencias. Cada valor tiene su fórmula (ƒ al final de la fila) con los números que la forman.
 */

const CONS = "Consolidado";
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const per = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;

type Vista = "destino" | "rent" | "calce" | "agencias";
const VISTAS: { id: Vista; n: string }[] = [
  { id: "destino", n: "Destino de los ingresos" }, { id: "rent", n: "Rentabilidad de la cartera" },
  { id: "calce", n: "Captaciones y cartera" }, { id: "agencias", n: "Comparación entre agencias" },
];

// ---------- formatos ----------
const dec = (v: number, d: number) => Math.abs(v).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
const fPct = (v: number | null, d = 1) => (v === null ? "—" : v < 0 && Number((v * 100).toFixed(d)) !== 0 ? `(${dec(v * 100, d)} %)` : `${dec(v * 100, d)} %`);
const fPp = (v: number, d = 1) => (Number(dec(v * 100, d).replace(",", ".")) === 0 ? "—" : `${v > 0 ? "+" : "−"}${dec(v * 100, d)} pp`);
const fCien = (v: number | null) => (v === null ? "—" : v < 0 && Math.abs(v) >= 0.005 ? `($${dec(v, 2)})` : `$${dec(v, 2)}`);
/** Puntos porcentuales con signo: negativo entre paréntesis (como fPct). */
const fPpSigno = (v: number | null, d = 2) => (v === null ? "—" : v < 0 && Number((v * 100).toFixed(d)) !== 0 ? `(${dec(v * 100, d)} pp)` : `${dec(v * 100, d)} pp`);
const fVeces = (v: number | null) => (v === null ? "—" : dec(v, 2));
const fVar = (v: number) => `${v > 0 ? "+" : ""}${cifra(v)}`;

interface Lado { c: Cifras; real?: RealOficina | null }
interface Par { real: Lado; ppto: Lado }

/** Textos de la fórmula: cómo se obtuvo cada número en el real y en el presupuesto. */
function origenFlujo(l: Lado, cuenta: string, v: number, esReal: boolean) {
  if (!esReal) return `${cuenta} acumulado a dic-${String(ejercicioEnUso()).slice(2)} = ${cifra(v)}`;
  if (!l.real) return `Suma de las agencias (cada una llevada a 12 meses) = ${cifra(v)}`;
  return `${cuenta} acumulado a ${per(l.real.periodo)} ${cifra(v * l.real.k / 12)} × 12 ÷ ${l.real.k} = ${cifra(v)}`;
}
function origenSaldo(l: Lado, cuenta: string, v: number, esReal: boolean) {
  if (!esReal) return `Promedio de ${cuenta} de ene-27 a dic-27 (12 saldos) = ${cifra(v)}`;
  if (!l.real) return `Suma de los promedios de las agencias = ${cifra(v)}`;
  const y = Number(l.real.periodo.slice(0, 4));
  return `Promedio de ${cuenta} de dic-${String(y - 1).slice(2)} a ${per(l.real.periodo)} (${l.real.saldosPromediados} saldos) = ${cifra(v)}`;
}

// ---------- fila genérica de tabla con ƒ ----------
interface Fila {
  id: string; label: string; nivel: "sub" | "tot" | "grupo";
  r?: number | null; p?: number | null; fmt?: (v: number | null) => string; fmtVar?: (d: number) => string;
  mejor?: 1 | -1 | 0; barra?: boolean; rojoSiNeg?: boolean;
  formula?: { def: string; real: string[]; ppto: string[] };
}

function TablaFilas({ filas, cabReal, cabPpto, conBarras }: { filas: Fila[]; cabReal: ReactNode; cabPpto: ReactNode; conBarras?: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const maxBarra = Math.max(1e-9, ...filas.filter((f) => f.barra).map((f) => Math.max(Math.abs(f.r ?? 0), Math.abs(f.p ?? 0))));
  const cols = conBarras ? 6 : 5;
  return (
    <table className="w-full table-fixed border-collapse text-[12px]" style={F_TABLA}>
      <colgroup><col /><col style={{ width: 170 }} /><col style={{ width: 170 }} /><col style={{ width: 150 }} />{conBarras && <col style={{ width: 170 }} />}<col style={{ width: 44 }} /></colgroup>
      <thead>
        <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
          <th className="pl-5 py-2.5 text-left font-semibold align-bottom" style={{ color: C.texto, ...F_TEXTO }}>Concepto</th>
          <th className="px-3 py-2.5 text-right font-semibold align-bottom leading-tight">{cabReal}</th>
          <th className="px-3 py-2.5 text-right font-semibold align-bottom leading-tight">{cabPpto}</th>
          <th className="px-3 py-2.5 text-right font-semibold align-bottom">Variación</th>
          {conBarras && <th />}
          <th />
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => {
          if (f.nivel === "grupo") return (
            <tr key={f.id} style={{ borderTop: `1px solid ${C.beige}`, background: "#FAFBFA", height: 30 }}>
              <td colSpan={cols} className="pl-5 text-[10.5px] font-semibold tracking-[0.06em] uppercase" style={{ color: C.tenue, ...F_TEXTO }}>{f.label}</td>
            </tr>
          );
          const tot = f.nivel === "tot", fmt = f.fmt ?? ((v: number | null) => (v === null ? "—" : cifra(v)));
          const r = f.r ?? null, p = f.p ?? null;
          const d = r !== null && p !== null ? p - r : null;
          const colorVar = d === null || Math.abs(d) < 1e-6 || !f.mejor ? C.texto3 : d * f.mejor > 0 ? C.ok : C.alerta;
          const col = (v: number | null) => (v !== null && v < 0 && (tot || f.rojoSiNeg) ? C.alerta : tot ? C.texto : C.texto3);
          const on = abierta === f.id;
          return (
            <Fragment key={f.id}>
              <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: tot ? "1px solid #C9D0CC" : `1px solid ${C.beige}`, height: tot ? 36 : 34 }}>
                <td style={{ paddingLeft: tot ? 16 : 36, color: tot ? C.texto : C.texto3, fontWeight: tot ? 600 : 400, ...F_TEXTO }}>{f.label}</td>
                <td className="px-3 text-right whitespace-nowrap" style={{ color: col(r), fontWeight: tot ? 600 : 400 }}>{fmt(r)}</td>
                <td className="px-3 text-right whitespace-nowrap" style={{ color: col(p), fontWeight: tot ? 600 : 400 }}>{fmt(p)}</td>
                <td className="px-3 text-right whitespace-nowrap" style={{ color: d === null || Math.abs(d) < 1e-6 ? C.cero : colorVar, fontWeight: tot ? 600 : 400 }}>
                  {d === null || Math.abs(d) < 1e-6 ? "—" : (f.fmtVar ?? fVar)(d)}
                </td>
                {conBarras && (
                  <td className="px-3">
                    {f.barra && (
                      <div className="flex flex-col gap-[3px]">
                        <span className="h-2 rounded-sm" style={{ width: `${(Math.abs(r ?? 0) / maxBarra) * 100}%`, background: "#C9D0CC" }} />
                        <span className="h-2 rounded-sm" style={{ width: `${(Math.abs(p ?? 0) / maxBarra) * 100}%`, background: "#5E9C76" }} />
                      </div>
                    )}
                  </td>
                )}
                <td className="text-center">{f.formula && <BotonF abierto={on} onClick={() => setAbierta(on ? null : f.id)} />}</td>
              </tr>
              {on && f.formula && <PanelFormula colSpan={cols} f={f.formula} />}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PanelFormula({ colSpan, f }: { colSpan: number; f: { def: string; real: string[]; ppto: string[] } }) {
  return (
    <tr style={{ background: "#F7F9F8", borderTop: `1px solid ${C.beige}` }}>
      <td colSpan={colSpan} className="pl-9 pr-5 py-2.5 text-[11.5px] leading-relaxed" style={{ color: C.texto2, ...F_TEXTO }}>
        <div className="font-semibold mb-1" style={{ color: C.acento }}>{f.def}</div>
        <div className="grid gap-x-6 gap-y-0.5" style={{ gridTemplateColumns: "max-content 1fr" }}>
          <span style={{ color: C.tenue }}>Real</span><span>{f.real.map((x, i) => <div key={i}>{x}</div>)}</span>
          <span style={{ color: C.tenue }}>Presupuesto</span><span>{f.ppto.map((x, i) => <div key={i}>{x}</div>)}</span>
        </div>
      </td>
    </tr>
  );
}

// ---------- Cada $100 de ingreso ----------
const COLOR: Record<string, string> = {
  ip: "#AFC6DC", pv: "#E8D3A6", g1: "#B5D5BF", g3: "#CFE3D3", g4: "#D9DDCB", g5: "#DCD3E3", g2: "#E9DCCD", g6: "#CFDADF", g7: "#E1E3E2", og: "#EBD9D7", ut: "#9FCFAE",
};
function CadaCien({ par }: { par: Par }) {
  const [tip, setTip] = useState<{ x: number; y: number; t: ReactNode } | null>(null);
  const tira = (c: Cifras) => {
    const i = ingresos(c), u = utilidad(c);
    const segs = GASTOS.filter((g) => c[g.k] > 0).map((g) => ({ k: g.k as string, n: g.n, cuenta: g.cuenta, v: c[g.k], p: (c[g.k] / i) * 100 }));
    if (u > 0) segs.push({ k: "ut", n: "Utilidad", cuenta: "5 − 4", v: u, p: (u / i) * 100 });
    return { segs, gasta: (gastos(c) / i) * 100, tot: Math.max(100, (gastos(c) / i) * 100) };
  };
  if (ingresos(par.real.c) <= 0 || ingresos(par.ppto.c) <= 0) return null;
  const filas = [{ n: "Real", t: tira(par.real.c) }, { n: `Presupuesto ${ejercicioEnUso()}`, t: tira(par.ppto.c) }];
  const MX = Math.max(...filas.map((f) => f.t.tot));
  return (
    <div className="px-5 pt-2 pb-5 flex flex-col gap-3.5" style={{ borderBottom: `1px solid ${C.beige}`, ...F_TEXTO }} onMouseLeave={() => setTip(null)}>
      {filas.map(({ n, t }) => (
        <div key={n} className="grid items-center gap-3.5" style={{ gridTemplateColumns: "130px 1fr" }}>
          <div className="text-[12.5px]" style={{ color: C.texto2 }}>
            {n}
            {t.gasta > 100 && <div className="text-[12px] mt-0.5" style={{ color: C.alerta }}>Gasta ${dec(t.gasta, 1)}</div>}
          </div>
          <div className="relative">
            <div className="flex h-11 rounded-md overflow-hidden" style={{ width: `${(t.tot / MX) * 100}%` }}>
              {t.segs.map((s) => {
                const w = s.p / MX;
                return (
                  <div key={s.k} className="flex flex-col justify-center px-2 overflow-hidden whitespace-nowrap text-[11.5px] leading-tight hover:brightness-95"
                       style={{ width: `${(s.p / t.tot) * 100}%`, background: COLOR[s.k], color: C.texto3, borderRight: "2px solid #fff" }}
                       onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, t: (
                         <>
                           <b style={{ color: C.texto }}>{s.n}</b> <span style={{ color: C.tenue }}>({s.cuenta})</span><br />
                           {n}<br />
                           ${dec(s.p, 1)} de cada $100 de ingreso · {dec(s.p, 1)} % de los ingresos<br />
                           {cifra(s.v)} al año
                         </>
                       ) })}>
                    {w > 0.035 && <b className="text-[12.5px] font-semibold">${dec(s.p, 1)}</b>}
                    {w > 0.11 && <span>{s.n}</span>}
                  </div>
                );
              })}
            </div>
            {MX > 100 && <div className="absolute -top-1.5 -bottom-1.5" style={{ left: `${(100 / MX) * 100}%`, borderLeft: `2px dashed ${C.tenue}` }} />}
          </div>
        </div>
      ))}
      {tip && (
        <div className="fixed z-[60] pointer-events-none rounded-lg bg-white px-3 py-2 text-[12px] leading-relaxed shadow-lg"
             style={{ left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1600) - 330), top: tip.y + 16, border: `1px solid ${C.borde}`, color: C.texto3 }}>
          {tip.t}
        </div>
      )}
    </div>
  );
}

// ---------- vistas ----------
function filasDestino(par: Par, enPct: boolean): Fila[] {
  const R = par.real.c, P = par.ppto.c, iR = ingresos(R), iP = ingresos(P);
  const val = (c: Cifras, v: number) => (enPct ? div(v, ingresos(c)) : v);
  const fmt = enPct ? (v: number | null) => fPct(v) : undefined;
  const fmtVar = enPct ? (d: number) => fPp(d) : undefined;
  const linea = (id: string, label: string, cuenta: string, f: (c: Cifras) => number, mejor: 1 | -1, nivel: "sub" | "tot", barra = false): Fila => ({
    id, label, nivel, r: val(R, f(R)), p: val(P, f(P)), fmt, fmtVar, mejor, barra, rojoSiNeg: nivel === "tot",
    formula: enPct ? {
      def: `${label} (${cuenta}) ÷ ingresos (51 + 52 + 53 + 54 + 55 + 56)`,
      real: [`${cifra(f(R))} ÷ ${cifra(iR)} = ${fPct(div(f(R), iR))}`],
      ppto: [`${cifra(f(P))} ÷ ${cifra(iP)} = ${fPct(div(f(P), iP))}`],
    } : {
      def: `${label}: cuenta ${cuenta}`,
      real: [origenFlujo(par.real, cuenta, f(R), true)],
      ppto: [origenFlujo(par.ppto, cuenta, f(P), false)],
    },
  });
  const out: Fila[] = [{ id: "gi", label: "Ingresos", nivel: "grupo" }];
  for (const g of INGRESOS) out.push(linea(g.k, g.n, g.cuenta, (c) => c[g.k], 1, "sub"));
  out.push(enPct ? { id: "ti", label: "Total ingresos", nivel: "tot", r: 1, p: 1, fmt } : linea("ti", "Total ingresos", "51 + 52 + 53 + 54 + 55 + 56", ingresos, 1, "tot"));
  out.push({ id: "gg", label: "En qué se consumen", nivel: "grupo" });
  for (const g of [...GASTOS].sort((a, b) => P[b.k] - P[a.k])) out.push(linea(g.k, g.n, g.cuenta, (c) => c[g.k], -1, "sub", true));
  out.push(linea("tg", "Total consumido", "41 + 42 + 43 + 44 + 45 + 47 + 48", gastos, -1, "tot"));
  out.push(linea("ut", "Utilidad del ejercicio", "ingresos − gastos", utilidad, 1, "tot"));
  return out;
}

function filasRentabilidad(par: Par): Fila[] {
  const R = par.real.c, P = par.ppto.c;
  const cien = (id: string, label: string, cuenta: string, f: (c: Cifras) => number, signo: 1 | -1, nivel: "sub" | "tot"): Fila => {
    const v = (c: Cifras) => { const x = div(signo * f(c) * 100, carteraBruta(c)); return x; };
    const txt = (c: Cifras) => { const x = v(c); return `${cifra(f(c))} ÷ ${cifra(carteraBruta(c))} × 100 = ${fCien(x === null ? null : Math.abs(x))}${signo < 0 ? " (se resta)" : ""}`; };
    return {
      id, label, nivel, r: v(R), p: v(P), fmt: fCien, fmtVar: (d) => `${d > 0 ? "+" : "−"}$${dec(d, 2)}`, mejor: 1,
      formula: { def: `${label} (${cuenta}) ÷ cartera bruta promedio × 100`, real: [txt(R), origenSaldo(par.real, "la cartera bruta", carteraBruta(R), true)], ppto: [txt(P), origenSaldo(par.ppto, "la cartera bruta", carteraBruta(P), false)] },
    };
  };
  const tasa = (id: string, label: string, def: string, num: (c: Cifras) => number, den: (c: Cifras) => number, nd: string, mejor: 1 | -1): Fila => {
    const v = (c: Cifras) => div(num(c), den(c));
    return {
      id, label, nivel: "sub", r: v(R), p: v(P), fmt: (x) => fPct(x, 2), fmtVar: (d) => fPp(d, 2), mejor,
      formula: { def, real: [`${cifra(num(R))} ÷ ${cifra(den(R))} = ${fPct(v(R), 2)}`, origenSaldo(par.real, nd, den(R), true)], ppto: [`${cifra(num(P))} ÷ ${cifra(den(P))} = ${fPct(v(P), 2)}`, origenSaldo(par.ppto, nd, den(P), false)] },
    };
  };
  const rend = (c: Cifras) => div(c.i5104, c.porVencer), costo = (c: Cifras) => costoCaptaciones(c);
  const dif = (c: Cifras) => { const a = rend(c), b = costo(c); return a === null || b === null ? null : a - b; };
  return [
    cien("ig", "Intereses ganados", "51", (c) => c.ig, 1, "sub"),
    cien("ip", "Costo de fondeo", "41", (c) => c.ip, -1, "sub"),
    cien("mf", "Margen financiero", "51 − 41", (c) => c.ig - c.ip, 1, "tot"),
    cien("pv", "Provisiones", "44", (c) => c.pv, -1, "sub"),
    cien("mr", "Margen después del riesgo", "51 − 41 − 44", (c) => c.ig - c.ip - c.pv, 1, "tot"),
    cien("go", "Gastos de operación", "45", gastosOperacion, -1, "sub"),
    cien("ot", "Comisiones y otros ingresos netos", "52 + 53 + 54 + 55 + 56 − 42 − 43 − 47 − 48", (c) => c.cs + c.oi - c.og, 1, "sub"),
    cien("res", "Resultado", "ingresos − gastos", utilidad, 1, "tot"),
    { id: "gt", label: "Tasas implícitas", nivel: "grupo" },
    tasa("rend", "Rendimiento de la cartera por vencer", "Intereses de cartera (5104) ÷ cartera por vencer promedio", (c) => c.i5104, (c) => c.porVencer, "la cartera por vencer", 1),
    tasa("costo", "Costo de las captaciones", "Intereses pagados a los socios (41 − 41059005) ÷ captaciones promedio (21)", interesSocios, (c) => c.cap, "las captaciones (21)", -1),
    {
      id: "dif", label: "Diferencial", nivel: "tot", r: dif(R), p: dif(P), fmt: (x) => fPpSigno(x), fmtVar: (d) => fPp(d, 2), mejor: 1,
      formula: { def: "Rendimiento de la cartera por vencer − costo de las captaciones",
        real: [`${fPct(rend(R), 2)} − ${fPct(costo(R), 2)} = ${fPpSigno(dif(R))}`],
        ppto: [`${fPct(rend(P), 2)} − ${fPct(costo(P), 2)} = ${fPpSigno(dif(P))}`] },
    },
  ];
}

function filasCalce(par: Par): Fila[] {
  const R = par.real.c, P = par.ppto.c;
  const saldo = (id: string, label: string, cuenta: string, f: (c: Cifras) => number, mejor: 1 | -1 | 0 = 0, nivel: "sub" | "tot" = "sub"): Fila => ({
    id, label, nivel, r: f(R), p: f(P), mejor,
    formula: { def: `${label}: saldo promedio de ${cuenta}`, real: [origenSaldo(par.real, cuenta, f(R), true)], ppto: [origenSaldo(par.ppto, cuenta, f(P), false)] },
  });
  const flujo = (id: string, label: string, cuenta: string, f: (c: Cifras) => number, mejor: 1 | -1 | 0, cuentaReal = cuenta): Fila => ({
    id, label, nivel: "sub", r: f(R), p: f(P), mejor,
    formula: { def: `${label}: cuenta ${cuenta}`, real: [origenFlujo(par.real, cuentaReal, f(R), true)], ppto: [origenFlujo(par.ppto, cuenta, f(P), false)] },
  });
  const sinCol = (c: Cifras) => `${cifra(c.cap)} + ${cifra(c.recibe)} − ${cifra(c.envia)} − ${cifra(carteraBruta(c))} = ${cifra(fondosSinColocar(c))}`;
  const costoTxt = (c: Cifras) => `${cifra(Math.max(0, fondosSinColocar(c)))} × ${fPct(costoCaptaciones(c), 2)} = ${cifra(costoSinColocar(c))}`;
  const veces = (c: Cifras) => div(c.cap, carteraBruta(c));
  const part = (c: Cifras) => div(costoSinColocar(c), interesSocios(c));
  return [
    { id: "g1", label: "Fondeo y colocación", nivel: "grupo" },
    saldo("cap", "Captaciones", "21", (c) => c.cap),
    saldo("dpf", "Depósitos a plazo", "2103", (c) => c.dpf),
    saldo("rec", "Recibido de otras oficinas", "2908", (c) => c.recibe),
    saldo("env", "Entregado a otras oficinas", "1908", (c) => c.envia),
    saldo("cb", "Cartera bruta", "la cartera bruta (14 sin provisión)", carteraBruta, 1),
    {
      id: "sc", label: "Fondos sin colocar", nivel: "tot", r: fondosSinColocar(R), p: fondosSinColocar(P), mejor: -1,
      formula: { def: "Captaciones (21) + recibido de otras oficinas (2908) − entregado a otras oficinas (1908) − cartera bruta", real: [sinCol(R)], ppto: [sinCol(P)] },
    },
    {
      id: "veces", label: "Captaciones por cada $1 de cartera", nivel: "sub", r: veces(R), p: veces(P), fmt: fVeces, fmtVar: (d) => `${d > 0 ? "+" : "−"}${dec(d, 2)}`, mejor: 0,
      formula: { def: "Captaciones promedio (21) ÷ cartera bruta promedio", real: [`${cifra(R.cap)} ÷ ${cifra(carteraBruta(R))} = ${fVeces(veces(R))}`], ppto: [`${cifra(P.cap)} ÷ ${cifra(carteraBruta(P))} = ${fVeces(veces(P))}`] },
    },
    { id: "g2", label: "Costo", nivel: "grupo" },
    {
      id: "costo", label: "Costo de las captaciones", nivel: "sub", r: costoCaptaciones(R), p: costoCaptaciones(P), fmt: (x) => fPct(x, 2), fmtVar: (d) => fPp(d, 2), mejor: -1,
      formula: { def: "Intereses pagados a los socios (41 − 41059005) ÷ captaciones promedio (21)", real: [`${cifra(interesSocios(R))} ÷ ${cifra(R.cap)} = ${fPct(costoCaptaciones(R), 2)}`], ppto: [`${cifra(interesSocios(P))} ÷ ${cifra(P.cap)} = ${fPct(costoCaptaciones(P), 2)}`] },
    },
    flujo("is", "Intereses pagados a los socios", "41 − 41059005", interesSocios, -1),
    flujo("ipi", "Interés pagado a otras oficinas", "41059005", (c) => c.ipInt, -1),
    flujo("ici", "Interés cobrado a otras oficinas", "5190", (c) => c.icInt, 1, "51909005"),
    { id: "csc", label: "Costo de los fondos sin colocar", nivel: "tot", r: costoSinColocar(R), p: costoSinColocar(P), mejor: -1,
      formula: { def: "Fondos sin colocar × costo de las captaciones (si los fondos sin colocar son negativos, el costo es 0)", real: [costoTxt(R)], ppto: [costoTxt(P)] } },
    { id: "part", label: "Parte de los intereses pagados a los socios", nivel: "sub", r: part(R), p: part(P), fmt: (x) => fPct(x), fmtVar: (d) => fPp(d), mejor: -1,
      formula: { def: "Costo de los fondos sin colocar ÷ intereses pagados a los socios", real: [`${cifra(costoSinColocar(R))} ÷ ${cifra(interesSocios(R))} = ${fPct(part(R))}`], ppto: [`${cifra(costoSinColocar(P))} ÷ ${cifra(interesSocios(P))} = ${fPct(part(P))}`] } },
  ];
}

function Comparacion({ datos, sel }: { datos: { ag: string; par: Par }[]; sel: string }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const filas = [...datos.filter((d) => d.ag !== CONS)].sort((a, b) => (consumo(b.par.ppto.c) ?? 0) - (consumo(a.par.ppto.c) ?? 0));
  const cons = datos.find((d) => d.ag === CONS);
  const fila = (d: { ag: string; par: Par }, total = false) => {
    const R = d.par.real.c, P = d.par.ppto.c, gp = gastoPrincipal(P), on = abierta === d.ag;
    const cR = consumo(R), cP = consumo(P), rp = div(utilidad(P) * 100, carteraBruta(P)), vc = div(P.cap, carteraBruta(P));
    const rojo = (v: number | null, lim: number) => (v !== null && v > lim ? C.alerta : total ? C.texto : C.texto3);
    return (
      <Fragment key={d.ag}>
        <tr className="hover:bg-[#F5F7F6]" style={{ borderTop: total ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: total ? 36 : 34, background: d.ag === sel && !total ? "#F3F8F5" : undefined, fontWeight: total ? 600 : 400 }}>
          <td className="pl-5" style={{ color: C.texto, ...F_TEXTO }}>{d.ag}</td>
          <td className="px-3 text-right" style={{ color: rojo(cR, 1) }}>{fPct(cR)}</td>
          <td className="px-3 text-right" style={{ color: rojo(cP, 1) }}>{fPct(cP)}</td>
          <td className="px-3 text-right" style={{ color: rp !== null && rp < 0 ? C.alerta : total ? C.texto : C.texto3 }}>{fCien(rp)}</td>
          <td className="px-3 text-right" style={{ color: total ? C.texto : C.texto3 }}>{fVeces(vc)}</td>
          <td className="px-3 text-right whitespace-nowrap" style={{ color: C.texto3, ...F_TEXTO }}>{total ? "" : `${gp.n} · ${fPct(div(gp.v, ingresos(P)))}`}</td>
          <td className="text-center"><BotonF abierto={on} onClick={() => setAbierta(on ? null : d.ag)} /></td>
        </tr>
        {on && (
          <tr style={{ background: "#F7F9F8", borderTop: `1px solid ${C.beige}` }}>
            <td colSpan={7} className="pl-9 pr-5 py-2.5 text-[11.5px] leading-relaxed" style={{ color: C.texto2, ...F_TEXTO }}>
              <div className="grid gap-x-6 gap-y-1" style={{ gridTemplateColumns: "max-content 1fr" }}>
                <span className="font-semibold" style={{ color: C.acento }}>Consumo de ingresos</span>
                <span>Gastos (4) ÷ ingresos (5) · real {cifra(gastos(R))} ÷ {cifra(ingresos(R))} = {fPct(cR)} · presupuesto {cifra(gastos(P))} ÷ {cifra(ingresos(P))} = {fPct(cP)}</span>
                <span className="font-semibold" style={{ color: C.acento }}>Resultado por $100 de cartera</span>
                <span>Utilidad {ejercicioEnUso()} ÷ cartera bruta promedio {ejercicioEnUso()} × 100 · {cifra(utilidad(P))} ÷ {cifra(carteraBruta(P))} × 100 = {fCien(rp)}</span>
                <span className="font-semibold" style={{ color: C.acento }}>Captaciones por $1 de cartera</span>
                <span>Captaciones promedio {ejercicioEnUso()} (21) ÷ cartera bruta promedio {ejercicioEnUso()} · {cifra(P.cap)} ÷ {cifra(carteraBruta(P))} = {fVeces(vc)}</span>
                {!total && <><span className="font-semibold" style={{ color: C.acento }}>Gasto principal {ejercicioEnUso()}</span>
                <span>El gasto más alto del presupuesto (sin otros gastos y pérdidas) ÷ ingresos · {gp.n} ({gp.cuenta}) {cifra(gp.v)} ÷ {cifra(ingresos(P))} = {fPct(div(gp.v, ingresos(P)))}</span></>}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  const th = "px-3 py-2.5 text-right font-semibold align-bottom leading-tight";
  const sub = (t: string) => <span className="block font-normal text-[11px]" style={{ color: C.tenue }}>{t}</span>;
  return (
    <table className="w-full table-fixed border-collapse text-[12px]" style={F_TABLA}>
      <colgroup><col style={{ width: 160 }} /><col /><col /><col /><col /><col style={{ width: 240 }} /><col style={{ width: 44 }} /></colgroup>
      <thead>
        <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
          <th className="pl-5 py-2.5 text-left font-semibold align-bottom" style={{ color: C.texto, ...F_TEXTO }}>Agencia</th>
          <th className={th}>Consumo de ingresos{sub("real")}</th>
          <th className={th}>Consumo de ingresos{sub(`presupuesto ${ejercicioEnUso()}`)}</th>
          <th className={th}>Resultado por $100 de cartera{sub(`presupuesto ${ejercicioEnUso()}`)}</th>
          <th className={th}>Captaciones por $1 de cartera{sub(`presupuesto ${ejercicioEnUso()}`)}</th>
          <th className={th}>Gasto principal {ejercicioEnUso()}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {filas.map((d) => fila(d))}
        {cons && fila(cons, true)}
      </tbody>
    </table>
  );
}

// ---------- componente ----------
export function AnalisisAgencia({ ag }: { ag: string }) {
  const real = useDatos<{ oficinas: Record<string, RealOficina>; error?: string }>("/api/analisis-agencia", 0);
  const pres = useBasesPresupuesto(ejercicioEnUso());
  const [vista, setVista] = useState<Vista>("destino");
  const [enPct, setEnPct] = useState(false);

  const datos = useMemo(() => {
    if (!real.datos?.oficinas || !pres.completo) return null;
    const lista = AGENCIAS.filter((a) => real.datos!.oficinas[a] && pres.bases[a]).map((a) => ({
      ag: a, par: { real: { c: cifrasReal(real.datos!.oficinas[a]), real: real.datos!.oficinas[a] }, ppto: { c: cifrasPresupuesto(pres.bases[a]) } } as Par,
    }));
    if (!lista.length) return [];
    lista.push({ ag: CONS, par: { real: { c: sumarCifras(lista.map((x) => x.par.real.c)), real: null }, ppto: { c: sumarCifras(lista.map((x) => x.par.ppto.c)) } } });
    return lista;
  }, [real.datos, pres.completo, pres.bases]);

  if (real.error) return <p className="text-[13px]" style={{ color: C.alerta }}>{real.error}</p>;
  if (!datos) return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px]" style={{ color: C.texto2, ...F_TEXTO }}>Leyendo el real y el presupuesto de las agencias ({pres.listas} de {AGENCIAS.length})…</p>
      <EsqueletoTabla filas={10} />
    </div>
  );
  // Solo la agencia elegida: si no tiene datos se dice, nunca se muestran las cifras de otra agencia con su nombre.
  const sel = datos.find((d) => d.ag === ag);
  if (!sel) return <p className="text-[13px]" style={{ color: C.texto2 }}>{datos.length ? `${ag} todavía no tiene históricos ni presupuesto para comparar. Se cargan en Carga de datos → Balances y Estados de resultados.` : "Todavía no hay históricos. Se cargan en Carga de datos → Balances y Estados de resultados."}</p>;
  const r = sel.par.real.real;
  const cabReal = (base: string) => <>Real{r ? ` ${r.periodo.slice(0, 4)}` : ""}<span className="block font-normal text-[11px]" style={{ color: C.tenue }}>{base}</span></>;
  const ritmo = r ? `ritmo anual ene–${MES[r.k - 1]}` : "ritmo anual";
  const saldos = r ? `promedio dic–${MES[r.k - 1]}` : "saldo promedio";

  return (
    <div className="bg-white rounded-xl overflow-hidden" style={{ border: `1px solid ${C.borde}` }}>
      <div className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap" style={F_TEXTO}>
        <div role="tablist" className="flex gap-1.5 flex-wrap">
          {VISTAS.map((v) => {
            const on = v.id === vista;
            return <button key={v.id} type="button" role="tab" aria-selected={on} onClick={() => setVista(v.id)} className="h-8 px-3 rounded-md text-[13px]"
                           style={on ? { background: C.acentoSuave, color: C.acento, fontWeight: 600 } : { color: C.texto2 }}>{v.n}</button>;
          })}
        </div>
        {vista === "destino" && (
          <div role="group" aria-label="Unidad" className="flex gap-0.5 p-0.5 rounded-md bg-white" style={{ border: "1px solid #D5DBD7" }}>
            {[["usd", "Dólares"], ["pct", "% de ingresos"]].map(([id, n]) => {
              const on = (id === "pct") === enPct;
              return <button key={id} type="button" aria-pressed={on} onClick={() => setEnPct(id === "pct")} className="h-7 px-3 rounded text-[12px]"
                             style={{ background: on ? "#E6F0EA" : "transparent", color: on ? C.acento : C.texto2, fontWeight: on ? 600 : 400 }}>{n}</button>;
            })}
          </div>
        )}
      </div>
      {vista === "destino" && <><CadaCien par={sel.par} /><TablaFilas key={`d${sel.ag}${enPct}`} filas={filasDestino(sel.par, enPct)} cabReal={cabReal(ritmo)} cabPpto={`Presupuesto ${ejercicioEnUso()}`} conBarras /></>}
      {vista === "rent" && <TablaFilas key={`r${sel.ag}`} filas={filasRentabilidad(sel.par)} cabReal={cabReal(`cartera ${saldos}`)} cabPpto={`Presupuesto ${ejercicioEnUso()}`} />}
      {vista === "calce" && <TablaFilas key={`c${sel.ag}`} filas={filasCalce(sel.par)} cabReal={cabReal(saldos)} cabPpto={`Presupuesto ${ejercicioEnUso()}`} />}
      {vista === "agencias" && <Comparacion datos={datos} sel={sel.ag} />}
    </div>
  );
}
