"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Formula } from "../ProvisionFlowParametros";
import { PCT_DISTRIBUCION_DEFAULT, RELACION_MORA_INTERES_NORMAL, CONCEPTO_INTERES_MORA, interesMoraDe, type FilaParametroOtrosPasivo } from "../../lib/calc/orquestador";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import { provisionFlowDe, factorMoraDe, CONCEPTO_FACTOR_MORA } from "../../lib/calc/provision-flow";
import type { Corrida } from "../../lib/calc/plan2027";
import {
  calcularRealidad, filasVersion, metaAsesores, promLinea, delMes, LINEAS_ESTUDIO, NOMBRE_LINEA,
  type HistoricoEstudio, type MesReal, type VersionCartera,
} from "../../lib/calc/estudio-agencia";
import { E, NUM, T, p1, p2, u, n2, sum, perCorto, CabeceraCuenta, Indicadores, SelectorIndicador, type Indicador, Lateral, BandaEfecto, Delta, entrada, Acciones, CabVersiones, useBorrador, BorradorLinks, type Enviar, type TipoDif } from "./EstudioComun";
import { ejercicioEnUso } from "../../lib/seleccion";
import { IdoneoCartera, NOMBRE_FUENTE } from "./IdoneoCartera";
import { calcularIdoneo, idoneoDeCampo, versionIdoneo, type CalculoIdoneo } from "../../lib/calc/idoneo-cartera";
import { AplicarIdoneoTodas } from "./IdoneoTodas";
import { CrecimientoPanel, MorosidadPanel, PasePanel } from "./MetasCartera";

/**
 * 14 · CARTERA DE CRÉDITOS: realidad (históricos), supuestos del presupuesto (Presupuesto · Ritmo real · Propuesta)
 * e impacto en 2027 con el motor del presupuesto.
 */
export function versionPres(am: AgenciaMotor): VersionCartera {
  const f = am.ins.paramsCredito;
  return {
    tasa: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.tasa_interes_anual)),
    e: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.tasa_efectividad_recup)),
    rv: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.tasa_recuperacion_vencida)),
    dist: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.pct_distribucion ?? PCT_DISTRIBUCION_DEFAULT[l])),
    p: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.pct_recuperacion_periodo)),
    q: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.pct_precancelacion ?? 0)),
    // pase a riesgo: el guardado; si está vacío, el que resulta de la fórmula anterior (% que vence × cuotas no cobradas)
    pase: LINEAS_ESTUDIO.map((l) => promLinea(f, l, (x) => x.pct_pase_riesgo ?? x.pct_recuperacion_periodo * (1 - x.tasa_efectividad_recup))),
    cumpl: am.ref.cumpl,
    ases: am.n0,
    fm: factorMoraDe(am.ins.parametrosOtrosPasivo),
    mora: interesMoraDe(am.ins.parametrosOtrosPasivo) ?? (am.ins.metasCredito.relacion_mora ?? RELACION_MORA_INTERES_NORMAL),
  };
}

export function insumosCartera(am: AgenciaMotor, pres: VersionCartera, v: VersionCartera) {
  const filas = filasVersion(am.ins.paramsCredito, pres, v);
  const cambiaCumpl = Math.abs(v.cumpl - pres.cumpl) > 1e-9;
  const fm = v.fm ?? pres.fm, cambiaFm = Math.abs(fm - pres.fm) > 1e-9;
  let opp: FilaParametroOtrosPasivo[] = am.ins.parametrosOtrosPasivo;
  if (cambiaCumpl) opp = [...opp.filter((x) => x.concepto !== "colocacion_pct_cumplimiento"), ...Array.from({ length: 12 }, (_, i) => ({ concepto: "colocacion_pct_cumplimiento", mes: i + 1, monto: v.cumpl }))];
  if (cambiaFm) opp = [...opp.filter((x) => x.concepto !== CONCEPTO_FACTOR_MORA), ...Array.from({ length: 12 }, (_, i) => ({ concepto: CONCEPTO_FACTOR_MORA, mes: i + 1, monto: fm }))];
  const mora = v.mora ?? pres.mora ?? 0, cambiaMora = v.mora !== undefined && Math.abs(mora - (pres.mora ?? 0)) > 1e-9;
  if (cambiaMora) opp = [...opp.filter((x) => x.concepto !== CONCEPTO_INTERES_MORA), ...Array.from({ length: 12 }, (_, i) => ({ concepto: CONCEPTO_INTERES_MORA, mes: i + 1, monto: mora }))];
  return { filas, opp, cumplimiento: cambiaCumpl ? Array(12).fill(v.cumpl) as number[] : null, factorMora: cambiaFm ? fm : null, interesMora: cambiaMora ? mora : null };
}

/** Lo real de la cartera de la agencia (mismo cálculo en el estudio y en «Aplicar idóneo a las 10 agencias»). */
export function realidadCartera(am: AgenciaMotor, h: HistoricoEstudio, pres: VersionCartera, excluir: string[] = []) {
  const meta = metaAsesores(am.ins.oficialesCredito, am.ins.metasCredito);
  const pRec = LINEAS_ESTUDIO.map((l) => promLinea(am.ins.paramsCredito, l, (x) => x.pct_recuperacion_periodo) || 1 / 36);
  // meses sin alivio: los mismos del Idóneo y de la provisión (desde el inicio de su ventana)
  const cfg = provisionFlowDe(am.ins.saldos)?.config;
  return { meta, real: calcularRealidad(h, { p: pRec, rv: pres.rv, meta, excluir, desde: cfg?.ventanaDesde ?? "", hasta: cfg?.ventanaHasta }) };
}
/** Líneas que se estudian: las activas o con colocación en el presupuesto. */
export const lineasActivas = (real: NonNullable<ReturnType<typeof calcularRealidad>>, pres: VersionCartera) =>
  LINEAS_ESTUDIO.map((_, i) => i).filter((i) => real.lineas[i].activa || pres.dist[i] > 0);
/** Corrida del presupuesto de la agencia con una versión de los supuestos de cartera. */
export const correrCartera = (am: AgenciaMotor, pres: VersionCartera, v: VersionCartera | null) => {
  if (!v) return null;
  const x = insumosCartera(am, pres, v);
  return correrVersion(am, { paramsCredito: x.filas, parametrosOtrosPasivo: x.opp, asesores: v.ases });
};
/** Idóneo de la agencia (null si faltan meses sin alivio). */
export function idoneoAgencia(am: AgenciaMotor, h: HistoricoEstudio): { pres: VersionCartera; calc: CalculoIdoneo | null; tasaReal: (number | null)[] } {
  const pres = versionPres(am);
  const { real } = realidadCartera(am, h, pres);
  if (!real) return { pres, calc: null, tasaReal: [] };
  return { pres, tasaReal: real.lineas.map((l) => l.tasa), calc: calcularIdoneo({ ms: real.meses, idx: lineasActivas(real, pres), pres, correr: (v) => correrCartera(am, pres, v), desde: provisionFlowDe(am.ins.saldos)?.config.ventanaDesde ?? "", paseRef: h.paseCoop }) };
}

/** Estado de la cuenta 14: versiones y corridas con solo los cambios de cartera. */
export function useCartera(am: AgenciaMotor, h: HistoricoEstudio) {
  const pres = useMemo(() => versionPres(am), [am]);
  // por defecto entran todos los meses; en el detalle mensual se puede dejar fuera alguno
  const [excluir, setExcluir] = useState<string[]>([]);
  const { meta, real } = useMemo(() => realidadCartera(am, h, pres, excluir), [am, h, pres, excluir]);
  const vReal: VersionCartera | null = useMemo(() => (real ? {
    tasa: pres.tasa.map((x, i) => real.lineas[i].tasa ?? x),
    e: pres.e.map((x, i) => real.lineas[i].e ?? x),
    // con el reporte de recuperación: % que vence, precancelaciones y recuperación de vencida de la agencia
    // recuperación de vencida como el reporte: % de las cuotas vencidas del mes que se cobra
    rv: pres.rv.map((x, i) => (real.rep?.cv && real.lineas[i].activa ? real.rep.cv : x)),
    p: pres.p.map((x, i) => (real.rep && real.lineas[i].activa ? real.rep.p : x)),
    q: pres.q.map((x, i) => (real.rep && real.lineas[i].activa ? real.rep.q : x)),
    pase: pres.pase.map((x, i) => real.lineas[i].pase ?? x),
    mora: real.mora ?? pres.mora,
    dist: [...pres.dist], // política de la cooperativa: el ritmo real conserva la distribución del presupuesto
    cumpl: real.cumpl ?? pres.cumpl,
    ases: pres.ases, // los activos hoy
    // factor de mora calibrado con la calificación de cartera de la agencia (últimos 12 meses)
    fm: 1, // con el ritmo de atraso propio de la agencia, lo real es sin meta
  } : null), [pres, real]);
  const [propEd, setPropBorrador] = useBorrador<VersionCartera>(am.A.nombre, "14", (x): x is VersionCartera => {
    const v = x as VersionCartera;
    return !!v && (["tasa", "e", "rv", "dist", "p", "q", "pase"] as const).every((k) => Array.isArray(v[k]) && v[k].length === LINEAS_ESTUDIO.length) && typeof v.cumpl === "number" && typeof v.ases === "number";
  });
  // borradores anteriores sin factor de mora: con el del presupuesto
  // borradores guardados antes de pasar la recuperación de vencida a la medida del reporte: rv estaba sobre el saldo en
  // riesgo; se convierte a % de las cuotas vencidas con la relación real de la agencia (cuotas ÷ saldo)
  // todo borrador nuevo se guarda con la recuperación de vencida en % de las cuotas vencidas
  const setProp = (v: VersionCartera | null) => setPropBorrador(v ? { ...v, rvU: "cuotas" } : null);
  const conv = real?.rep?.cv && real.rep.rv > 0 ? real.rep.cv / real.rep.rv : 1;
  const prop = propEd ? { ...propEd, fm: typeof propEd.fm === "number" ? propEd.fm : pres.fm, rv: propEd.rvU === "cuotas" ? propEd.rv : propEd.rv.map((x) => x * conv), rvU: "cuotas" as const } : pres;
  const correr = useCallback((v: VersionCartera | null) => correrCartera(am, pres, v), [am, pres]);
  // idóneo con los meses sin alivio (todos los meses, aunque en el detalle se deje alguno fuera)
  const idoneo = useMemo(() => {
    const r = excluir.length ? realidadCartera(am, h, pres).real : real;
    return r ? calcularIdoneo({ ms: r.meses, idx: lineasActivas(r, pres), pres, correr, desde: provisionFlowDe(am.ins.saldos)?.config.ventanaDesde ?? "", paseRef: h.paseCoop }) : null;
  }, [am, h, pres, real, excluir, correr]);
  const Rr = useMemo(() => correr(vReal), [am, pres, vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => correr(prop), [am, pres, prop]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Resultado de la cartera: intereses de cartera + recuperación y reversión (5604) − gasto de provisión − costo de asesores adicionales. */
  const resultado = (R: Corrida | null) => (R ? R.er.ingCart + R.er.ingMora + (R.er.cta?.["5604"] ?? R.er.reversion) - R.er.provCart - (R.kpi.ases - pres.ases) * am.costoAsesor : 0);
  // lo real de los últimos 12 meses (o los que haya, llevados a 12) para comparar con 2027
  const real12 = useMemo(() => {
    if (!real) return null;
    const ms = real.meses.slice(-12), n = ms.length, ult = ms[n - 1], k = 12 / n;
    const S = (f: (m: MesReal) => number) => ms.reduce((t, m) => t + f(m), 0) * k;
    const cartLin = LINEAS_ESTUDIO.map((_, i) => ult.pv[i] + ult.r[i]), cart = sum(cartLin), riesgo = sum(ult.r);
    const interes = S((m) => sum(m.int.map((x) => x ?? 0)) + (m.intMora ?? 0));
    const provision = S((m) => m.gasto4402 ?? 0);
    const r5604 = S((m) => (m.rev ?? 0) + (delMes(h.er, m.p, "560405") ?? 0));
    return { n, desde: ms[0].p, hasta: ult.p, colocacion: S((m) => sum(m.col)), cart, cartLin, mora: cart ? riesgo / cart : null, interes, provision,
      provStock: ult.prov, cobertura: riesgo > 1 ? ult.prov / riesgo : null, castigos: S((m) => m.cas), r5604, resultado: interes + r5604 - provision };
  }, [real, h]);
  return { pres, meta, real, real12, vReal, prop, setProp, editada: propEd !== null, Rr, Rx, excluir, setExcluir, correr, resultado, idoneo };
}
type EstadoCartera = ReturnType<typeof useCartera>;

type Campo = "tasa" | "p" | "e" | "q" | "pase" | "rv" | "dist";
/** Margen de tolerancia de las precancelaciones frente al ritmo real: fuera de este rango se marca en rojo. */
const MARGEN_PREC: [number, number] = [0.8, 1.2];
// mismos nombres que en Cartera → Tasas y recuperación
const CAMPOS: { k: Campo; label: string; formula: ReactNode }[] = [
  { k: "tasa", label: "Tasa de interés anual (base 360)", formula: <>Tasa del producto × 365 ÷ 360 (ej.: 15,50 % → 15,72 %): el sistema de cartera cobra el interés por días sobre un año de 360, y esa es la tasa que registra la contabilidad. Ritmo real = interés de la línea (5104) del período × 12 ÷ meses ÷ cartera por vencer promedio.</> },
  { k: "p", label: "Porcentaje de recuperación por período", formula: <>Parte de la cartera por vencer que vence cada mes (1 ÷ plazo promedio en meses). Ritmo real = capital que vence ÷ cartera por vencer del mes anterior (reporte de recuperación); sin reporte se mantiene el del presupuesto.</> },
  { k: "e", label: "Tasa de recuperación de cartera por vencer", formula: <>Parte de las cuotas que vencen en el mes que se cobra. Ritmo real = recuperación neta ÷ capital que vence (reporte de recuperación, cartera vigente; es el de la agencia, igual para todas las líneas). Sin reporte sale — y se mantiene el del presupuesto.</> },
  { k: "q", label: "Precancelación de cartera por vencer", formula: <>% de la cartera por vencer que el socio paga completa antes de tiempo cada mes. Baja la cartera y entra a caja, pero no es recuperación: va en su propia línea. Ritmo real = (precancelados − refinanciados, reestructurados y novaciones) de la cartera vigente ÷ cartera por vencer del mes anterior (reporte de recuperación). Los refinanciamientos no se cuentan: cancelan y vuelven a colocar el mismo saldo. Sin reporte se mantiene el del presupuesto.</> },
  { k: "pase", label: "Pase a cartera en riesgo mensual", formula: <>% de la cartera por vencer que pasa a no devenga o vencida cada mes. En contabilidad pasa todo el saldo de la operación, no solo la cuota impaga. Ritmo real = (variación de la cartera en riesgo + recuperación de vencida + castigos de la línea) ÷ cartera por vencer del mes anterior. Presupuesto vacío = % que vence × (1 − recuperación por vencer).</> },
  { k: "rv", label: "Recuperación de cartera vencida", formula: <>Es la columna «% Neto Recuperado» de la cartera vencida en el reporte de recuperación: valor neto recuperado ÷ capital vencido por cobrar del mes. Ritmo real = suma del valor neto recuperado del período ÷ suma del capital vencido (promedio ponderado de los meses). Por dentro, el presupuesto lo convierte al % del saldo en riesgo que baja cada mes con la relación real de la agencia (solo lo neto). Las precancelaciones de créditos vencidos no entran aquí: van aparte, a su ritmo real × el margen de precancelaciones. Sin reporte se mantiene el del presupuesto.</> },
  { k: "dist", label: "Distribución de la colocación", formula: <>Parte de la colocación del mes que va a la línea (Cartera → Colocación → Distribución por línea). Sin valores guardados: 80 % Consumo y 20 % Microcrédito, según la política. El ritmo real la conserva.</> },
];

type Vista = "realidad" | "supuestos" | "impacto" | "crecimiento" | "idoneo" | "morosidad";

export function DetalleCartera({ c, am, Rp, ag, enviar, guardando, motor }: { c: EstadoCartera; am: AgenciaMotor; Rp: Corrida; ag: string; enviar: Enviar; guardando: boolean; motor?: Record<string, { am?: unknown }> }) {
  const [vista, setVista] = useState<Vista>("realidad");
  const [detalle, setDetalle] = useState(false);
  const [ind, setInd] = useState("");
  const [grupo, setGrupo] = useState("col");
  const [linea, setLinea] = useState(-1);
  const [comoProv, setComoProv] = useState(false);
  const { pres, meta, real, vReal, prop, setProp, editada, Rr, Rx, excluir, setExcluir } = c;
  if (!real || !vReal || !prop || !Rr || !Rx) return <p className="text-[13px] py-4" style={{ color: E.gris }}>{ag} no tiene balances mensuales cargados en Históricos.</p>;

  const idx = lineasActivas(real, pres);
  const ventanaSinAlivio = provisionFlowDe(am.ins.saldos)?.config.ventanaDesde ?? "";
  const rotuloReal = ventanaSinAlivio && real.desde >= ventanaSinAlivio ? `Real ${perCorto(real.desde)} a ${perCorto(real.hasta)} (sin alivio)` : undefined;
  const ms = real.ventana, msB = real.base;
  const sinMeses = real.excluidos.map((x) => perCorto(x).slice(0, 3)).join(", ");
  const alternar = (per: string) => setExcluir(excluir.includes(per) ? excluir.filter((x) => x !== per) : [...excluir, per]);
  const L = (m: MesReal, f: (m: MesReal, i: number) => number) => (linea < 0 ? idx.reduce((t, i) => t + f(m, i), 0) : f(m, linea));
  const tasaMes = (m: MesReal) => { const v = linea < 0 ? idx.map((i) => m.int[i]) : [m.int[linea]]; if (v.some((x) => x === null)) return null; const pr = L(m, (x, i) => (x.pv0[i] + x.pv[i]) / 2); return pr > 1000 ? (sum(v as number[]) * 12) / pr : null; };
  const cobMes = (m: MesReal) => { const rr = sum(idx.map((i) => m.r[i])); return rr > 1 ? m.prov / rr : null; };
  const moraMes = (m: MesReal) => { const cb = L(m, (x, i) => x.pv[i] + x.r[i]); return cb ? L(m, (x, i) => x.r[i]) / cb : null; };

  const editar = (f: (v: VersionCartera) => void) => { const nv: VersionCartera = { tasa: [...prop.tasa], e: [...prop.e], rv: [...prop.rv], dist: [...prop.dist], p: [...prop.p], q: [...prop.q], pase: [...prop.pase], cumpl: prop.cumpl, ases: prop.ases, fm: prop.fm, mora: prop.mora, qvReal: prop.qvReal }; f(nv); setProp(nv); };
  const aplicar = async (v: VersionCartera, origen: string) => {
    const x = insumosCartera(am, pres, v);
    const notaAses = v.ases !== pres.ases ? ` El número de asesores (${v.ases}) no se guarda: es solo una simulación; si se aprueba, regístralos en Cartera → Metas y en Nómina.` : "";
    if (!x.cumplimiento && x.factorMora === null && x.interesMora === null && !x.filas.some((f, i) => JSON.stringify(f) !== JSON.stringify(am.ins.paramsCredito[i]))) { window.alert(`El presupuesto ya tiene estos supuestos.${notaAses}`); return; }
    const extra = [x.cumplimiento ? "el cumplimiento de la meta de colocación" : "", x.factorMora !== null ? `la meta de mejora del ritmo de atraso (${((1 - x.factorMora) * 100).toFixed(0)} %)` : "",
      x.interesMora !== null ? `el interés de mora (${(x.interesMora * 100).toFixed(2)} % del interés de cartera)` : ""].filter(Boolean).join(" y ");
    if (await enviar({ filas: x.filas, cumplimiento: x.cumplimiento, factorMora: x.factorMora, interesMora: x.interesMora }, `Cartera, ${origen}`, `Se reemplazarán los parámetros de crédito${extra ? ` y ${extra}` : ""} de ${ag} por los del ${origen}.${notaAses}`)) setProp(null);
  };

  // columna Idóneo de Supuestos: recuperación por vencer, pase a riesgo y recuperación de vencida (las demás no llevan)
  const celdaIdoneo = (campo: string, i: number) => {
    const f = idoneoDeCampo(c.idoneo, campo, i);
    if (!f || f.idoneo === null) return <td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>;
    return (
      <td className={T.td} style={{ color: f.noAlcanza ? E.alerta : E.verde, fontWeight: 600 }}>
        <span className="inline-flex items-center gap-1 justify-end">{p2(f.idoneo)}
          <Formula info derecha>{f.fuente ? NOMBRE_FUENTE[f.fuente] : ""}{f.fuente === "real" ? ": su real de los meses sin alivio ya es el mejor nivel." : f.fuente === "mejor" ? ": la mitad del camino entre su real y el promedio de sus 2 mejores meses sin alivio." : f.fuente === "tope" ? ": el mejor mes sin alivio." : f.fuente === "equilibrio" ? `: el nivel con el que la utilidad ${ejercicioEnUso()} de la agencia queda en cero.` : ""}{f.noAlcanza ? " Ni así se cubre la pérdida: se pide lo máximo que ya logró." : ""}{f.limitado ? " Limitado para que la provisión no baje más de 25 % frente a su real." : ""} El detalle está en la vista Idóneo.</Formula>
        </span>
      </td>
    );
  };
  const todasBtn = motor ? <AplicarIdoneoTodas motor={motor} /> : null;

  const filasMes: { label: string; f: (m: MesReal) => number | null; fmt: (v: number | null) => string; per: string; fuerte?: boolean; formula?: ReactNode }[] = [
    { label: "Cartera por vencer", f: (m) => L(m, (x, i) => x.pv[i]), fmt: u, per: u(L(ms[ms.length - 1], (x, i) => x.pv[i])) },
    { label: "Cartera en riesgo", f: (m) => L(m, (x, i) => x.r[i]), fmt: u, per: u(L(ms[ms.length - 1], (x, i) => x.r[i])) },
    { label: "Cartera bruta", f: (m) => L(m, (x, i) => x.pv[i] + x.r[i]), fmt: u, per: u(L(ms[ms.length - 1], (x, i) => x.pv[i] + x.r[i])), fuerte: true },
    { label: "Morosidad", f: moraMes, fmt: p1, per: p1(moraMes(ms[ms.length - 1])) },
    { label: "Colocación", f: (m) => L(m, (x, i) => x.col[i]), fmt: u, per: u(sum(msB.map((m) => L(m, (x, i) => x.col[i])))), fuerte: true, formula: <>Cartera por vencer del mes − la del mes anterior + recuperación neta + precancelaciones con dinero + pase a riesgo. Los refinanciamientos, reestructurados y novaciones no se cuentan como colocación nueva.</> },
    { label: "Capital que vence", f: (m) => L(m, (x, i) => x.due[i]), fmt: u, per: u(sum(msB.map((m) => L(m, (x, i) => x.due[i])))) },
    { label: "Pase a riesgo", f: (m) => L(m, (x, i) => x.mig[i]), fmt: u, per: u(sum(msB.map((m) => L(m, (x, i) => x.mig[i])))), formula: <>Variación de la cartera en riesgo + recuperación de vencida + castigos.</> },
    { label: "Recuperación de cartera por vencer", f: (m) => (m.rep && m.rep.capital > 0 ? m.rep.neto / m.rep.capital : null), fmt: p1, per: p1(real.rep?.e ?? null), formula: <>Recuperación neta ÷ capital que vence (reporte de recuperación, cartera vigente de la agencia).</> },
    ...(linea < 0 ? [
      { label: "Precancelación de cartera por vencer", f: (m: MesReal) => m.rep?.prec ?? null, fmt: u, per: u(sum(msB.map((m) => m.rep?.prec ?? 0))), formula: <>Precancelados − refinanciados, reestructurados y novaciones (cartera vigente, reporte de recuperación).</> },
      { label: "Refinanciados, reestructurados y novaciones", f: (m: MesReal) => m.rep?.refin ?? null, fmt: u, per: u(sum(msB.map((m) => m.rep?.refin ?? 0))), formula: <>Columna Refin-Reest-Nov del reporte. No es cobro ni colocación nueva: no entra en el presupuesto.</> },
    ] : []),
    { label: "Pase a riesgo mensual", f: (m) => { const b = L(m, (x, i) => x.pv0[i]); return b > 1000 ? L(m, (x, i) => x.mig[i]) / b : null; }, fmt: p2, per: p2(linea < 0 ? (() => { const b = sum(msB.map((m) => L(m, (x, i) => x.pv0[i]))); return b > 1000 ? sum(msB.map((m) => L(m, (x, i) => x.mig[i]))) / b : null; })() : real.lineas[linea].pase) },
    { label: "Interés cobrado", f: (m) => { const v = linea < 0 ? idx.map((i) => m.int[i]) : [m.int[linea]]; return v.some((x) => x === null) ? null : sum(v as number[]); }, fmt: u, per: u(sum(msB.map((m) => sum((linea < 0 ? idx.map((i) => m.int[i]) : [m.int[linea]]).map((x) => x ?? 0))))) },
    { label: "Tasa efectiva", f: tasaMes, fmt: p2, per: linea < 0 ? "" : p2(real.lineas[linea].tasa) },
    ...(linea < 0 ? [
      { label: "Provisión de cartera (1499)", f: (m: MesReal) => m.prov, fmt: u, per: u(ms[ms.length - 1].prov), fuerte: true },
      { label: "Cobertura de la cartera en riesgo", f: cobMes, fmt: p1, per: p1(cobMes(ms[ms.length - 1])), formula: <>Provisión (1499) ÷ cartera en riesgo.</> },
      { label: "Gasto de provisión (4402)", f: (m: MesReal) => m.gasto4402, fmt: u, per: u(sum(msB.map((m) => m.gasto4402 ?? 0))) },
      { label: "Reversión de provisión (560410)", f: (m: MesReal) => m.rev, fmt: u, per: u(sum(msB.map((m) => m.rev ?? 0))) },
      { label: "Castigos", f: (m: MesReal) => m.cas, fmt: u, per: u(sum(msB.map((m) => m.cas))), formula: <>Provisión del mes anterior + gasto 4402 − reversión 560410 − provisión del mes, si es positivo.</> },
    ] : []),
  ];

  const r12 = c.real12;
  const impacto: { label: string; f: (R: Corrida) => number; fmt: (v: number) => string; tipo: TipoDif; mejor: 1 | -1 | 0; fuerte?: boolean; sub?: boolean; formula?: ReactNode; real?: number | null }[] = [
    { label: "Asesores de crédito", f: (R) => R.kpi.ases, fmt: (v) => String(Math.round(v)), tipo: "num", mejor: 0, real: pres.ases },
    { label: "Colocación del año", f: (R) => R.col.colMes * 12, fmt: u, tipo: "usd", mejor: 1, real: r12?.colocacion },
    { label: "Colocación mensual por asesor", f: (R) => R.col.porAsesor, fmt: u, tipo: "usd", mejor: 1, sub: true, real: r12 && pres.ases ? r12.colocacion / 12 / pres.ases : null },
    { label: "Costo de asesores adicionales", f: (R) => (R.kpi.ases - pres.ases) * am.costoAsesor, fmt: u, tipo: "usd", mejor: -1, sub: true, formula: <>Asesores adicionales × costo anual de un asesor Junior (450105). Con menos asesores es negativo (ahorro).</> },
    { label: "Cartera bruta a diciembre", f: (R) => R.bal.cart, fmt: u, tipo: "usd", mejor: 1, fuerte: true, real: r12?.cart },
    ...idx.map((i) => ({ label: NOMBRE_LINEA[i], f: (R: Corrida) => (R.lin?.[i] ? R.lin[i].pv + R.lin[i].r : 0), fmt: u, tipo: "usd" as const, mejor: 1 as const, sub: true, real: r12?.cartLin[i] })),
    { label: "Morosidad a diciembre", f: (R) => R.kpi.mora, fmt: p2, tipo: "pp", mejor: -1, real: r12?.mora },
    { label: "Intereses de cartera", f: (R) => R.er.ingCart + R.er.ingMora, fmt: u, tipo: "usd", mejor: 1, real: r12?.interes },
    { label: "Gasto de provisión de cartera", f: (R) => R.er.provCart, fmt: u, tipo: "usd", mejor: -1, real: r12?.provision, formula: <>Gasto 4402 del presupuesto más el que agrega la mora de cada versión (tramos de mora con su cobro y recuperación).</> },
    { label: "Provisión de cartera a diciembre", f: (R) => R.bal.prov, fmt: u, tipo: "usd", mejor: 0, real: r12?.provStock },
    { label: "Cobertura de la cartera en riesgo", f: (R) => (R.bal.v > 1 ? R.bal.prov / R.bal.v : 0), fmt: p1, tipo: "pp", mejor: 1, real: r12?.cobertura, formula: <>Provisión de cartera ÷ cartera en riesgo, a diciembre.</> },
    { label: "Castigos del año", f: (R) => R.castigos ?? 0, fmt: u, tipo: "usd", mejor: 0, real: r12?.castigos },
    { label: "Recuperación de castigados y reversión (5604)", f: (R) => R.er.cta?.["5604"] ?? R.er.reversion, fmt: u, tipo: "usd", mejor: 1, real: r12?.r5604 },
    { label: "Intereses de cartera menos provisiones", f: c.resultado, fmt: u, tipo: "usd", mejor: 1, fuerte: true, real: r12?.resultado, formula: <>Intereses de cartera + recuperación y reversión (5604) − gasto de provisión − costo de asesores adicionales. No es la utilidad: no descuenta el costo de los depósitos ni los gastos de operación.</> },
  ];

  // meta de los asesores con otro número: los que entran o salen son Junior
  const metaDe = (n: number) => meta + (n - pres.ases) * am.ins.metasCredito.meta_junior;
  const gruposSup = [{ id: "col", label: "Colocación" }, ...idx.map((i) => ({ id: String(i), label: NOMBRE_LINEA[i] })), { id: "prov", label: "Provisión" }];
  // provisión: resultado del modelo de tramos de mora (Cartera → Provisión) con los supuestos de cada versión
  const ultM = ms[ms.length - 1];
  const filasProv: { label: string; pres: number; real: number | null; prop: number; fmt: (v: number | null) => string; formula: ReactNode }[] = [
    { label: "Cobertura de la cartera en riesgo a diciembre", pres: Rp.bal.v > 1 ? Rp.bal.prov / Rp.bal.v : 0, real: cobMes(ultM), prop: Rx.bal.v > 1 ? Rx.bal.prov / Rx.bal.v : 0, fmt: p1,
      formula: <>Provisión (1499) ÷ cartera en riesgo. Ritmo real: al cierre de {perCorto(ultM.p)}.</> },
    { label: "Gasto neto de provisión mensual", pres: (Rp.er.provCart - Rp.er.reversion) / 12, real: sum(msB.map((m) => (m.gasto4402 ?? 0) - (m.rev ?? 0))) / Math.max(1, msB.length), prop: (Rx.er.provCart - Rx.er.reversion) / 12, fmt: u,
      formula: <>Gasto de provisión (4402) − reversión (560410), promedio mensual.</> },
    { label: "Castigos mensuales", pres: (Rp.castigos ?? 0) / 12, real: sum(msB.map((m) => m.cas)) / Math.max(1, msB.length), prop: (Rx.castigos ?? 0) / 12, fmt: u,
      formula: <>Presupuesto: castigo mensual de la cooperativa repartido según el saldo en calificación E de la agencia (Cartera → Provisión). Ritmo real: provisión del mes anterior + gasto 4402 − reversión 560410 − provisión del mes.</> },
  ];
  const grupoSel = gruposSup.some((g) => g.id === grupo) ? grupo : "col";
  const inds: Indicador[] = [
              { id: "cart", label: "Cartera bruta", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: sum(idx.map((i) => m.pv[i] + m.r[i])) })) },
              { id: "mora", label: "Morosidad", mejor: -1, pp: true, fmt: p2, serie: ms.map((m) => { const cb = sum(idx.map((i) => m.pv[i] + m.r[i])); return { p: m.p, v: cb ? sum(idx.map((i) => m.r[i])) / cb : null }; }) },
              { id: "col", label: "Colocación", mejor: 1, fmt: u, serie: ms.map((m) => ({ p: m.p, v: sum(idx.map((i) => m.col[i])) })) },
              { id: "prov", label: "Provisión", mejor: 0, fmt: u, serie: ms.map((m) => ({ p: m.p, v: m.prov })) },
              { id: "cob", label: "Cobertura", mejor: 1, pp: true, fmt: p1, serie: ms.map((m) => ({ p: m.p, v: cobMes(m) })) },
              { id: "tasa", label: "Tasa efectiva", mejor: 0, pp: true, fmt: p2, serie: ms.map((m) => { const v = idx.map((i) => m.int[i]); const pr = sum(idx.map((i) => (m.pv0[i] + m.pv[i]) / 2)); return { p: m.p, v: v.some((x) => x === null) || pr < 1000 ? null : (sum(v as number[]) * 12) / pr }; }) },
            ];
  const indSel = inds.some((x) => x.id === ind) ? ind : inds[0].id;
  const enlace = "text-[13px] font-semibold hover:underline";
  return (
    <div className="flex flex-col gap-4 flex-1">
      <CabeceraCuenta<Vista> codigo="14" nombre="Cartera de créditos" vista={vista} onVista={setVista} extra={motor ? [{ id: "crecimiento", label: "Crecimiento" }, { id: "idoneo", label: "Idóneo" }, { id: "morosidad", label: "Morosidad" }] : [{ id: "idoneo", label: "Idóneo" }]} izquierda={vista === "realidad" ? <SelectorIndicador lista={inds} sel={indSel} onSel={setInd} /> : vista === "supuestos" ? <SelectorIndicador lista={gruposSup} sel={grupoSel} onSel={setGrupo} /> : null} />

      {vista === "crecimiento" && motor && <CrecimientoPanel motor={motor} />}
      {vista === "morosidad" && motor && <div className="flex flex-col gap-4"><MorosidadPanel motor={motor} /><PasePanel motor={motor} /></div>}
      {vista === "idoneo" && (
        <IdoneoCartera am={am} ms={real.meses} idx={idx} pres={pres} correr={c.correr} guardando={guardando} calculo={c.idoneo}
          onAplicar={(v) => aplicar(v, "idóneo")} todas={todasBtn} />
      )}
      {vista === "realidad" && <>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-col" style={{ flex: "999 1 520px", minWidth: 0 }}>
            <Indicadores lista={inds} sel={indSel} />
          </div>
          {(() => {
            const cb = (m: MesReal) => sum(idx.map((i) => m.pv[i] + m.r[i])), f = ms[0], l = ms[ms.length - 1];
            const tasaM = (m: MesReal) => { const v = idx.map((i) => m.int[i]); const pr = sum(idx.map((i) => (m.pv0[i] + m.pv[i]) / 2)); return v.some((x) => x === null) || pr < 1000 ? null : (sum(v as number[]) * 12) / pr; };
            const t0 = tasaM(f), t1 = tasaM(l);
            const d = sum(msB.map((m) => sum(m.pv0))), g = sum(msB.map((m) => sum(m.mig)));
            const dCart = cb(l) - cb(f);
            return <Lateral items={[
              { t: "Cartera bruta", v: u(cb(l)), sub: `${dCart >= 0 ? "Sube" : "Baja"} ${u(Math.abs(dCart))} desde ${perCorto(f.p)}`, subColor: dCart >= 0 ? E.verde : E.alerta },
              { t: "Colocación mensual promedio", v: u(real.colMes), sub: meta > 0 ? `${p1(real.cumpl)} de la meta de ${u(meta)}` : undefined },
              { t: "Recuperación de cartera por vencer", v: p1(real.rep?.e ?? null), sub: real.rep ? `Pase a riesgo ${p2(g / Math.max(1, d))} al mes` : "Sin reporte de recuperación" },
              { t: "Tasa efectiva de cartera", v: p2(t1), sub: t0 !== null && t1 !== null ? `${t1 >= t0 ? "Sube" : "Baja"} ${(Math.abs(t1 - t0) * 100).toFixed(2).replace(".", ",")} pp desde ${perCorto(f.p)}` : undefined },
            ]} />;
          })()}
        </div>
        <BandaEfecto pres={c.resultado(Rp)} real={c.resultado(Rr)} cuenta="la cartera" titulo={`Resultado de la cartera ${ejercicioEnUso()}`} detalle={detalle} onDetalle={() => setDetalle((x) => !x)} />
        {detalle && <>
          <div className="flex flex-wrap gap-1">
            {[-1, ...idx].map((i) => (
              <button key={i} type="button" onClick={() => setLinea(i)} className="h-7 px-3 rounded-full text-[12px]"
                style={{ background: linea === i ? E.verdeSuave : "transparent", color: linea === i ? E.verde : E.gris, fontWeight: linea === i ? 600 : 400, border: `1px solid ${linea === i ? "transparent" : E.linea}` }}>{i < 0 ? "Todas las líneas" : NOMBRE_LINEA[i]}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}><th className={T.thIzq} /> {ms.map((m) => <th key={m.p} className={T.th}>{perCorto(m.p)}</th>)}<th className={T.th} style={{ color: E.tinta }}>Período</th></tr></thead>
              <tbody>{filasMes.map((r) => (
                <tr key={r.label} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400 }}>
                  <td className={`${T.tdIzq} min-w-[160px]`} style={{ color: E.tinta, fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
                  {ms.map((m) => { const v = r.f(m); return <td key={m.p} className={T.td} style={{ color: v !== null && v < 0 ? E.alerta : E.tinta, opacity: excluir.includes(m.p) ? 0.4 : 1 }}>{r.fmt(v)}</td>; })}
                  <td className={T.td} style={{ color: E.tinta, fontWeight: 600 }}>{r.per}</td>
                </tr>))}
                <tr>
                  <td className={T.tdIzq} style={{ color: E.gris, fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">Entra en el ritmo real<Formula>Por defecto entran todos los meses. Puedes dejar fuera un mes con un ajuste de una sola vez (por ejemplo, el paso a vencida al terminar los alivios financieros).</Formula></span></td>
                  {ms.map((m) => <td key={m.p} className={T.td}><input type="checkbox" aria-label={`Incluir ${perCorto(m.p)} en el ritmo real`} checked={!excluir.includes(m.p)} onChange={() => alternar(m.p)} className="w-4 h-4 accent-[#005A28]" /></td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className={T.tabla} style={NUM}>
              <thead><tr style={T.cab}>
                <th className={T.thIzq}>Año</th>
                {["Meses", "Colocación", "Colocación mensual", "Tasa efectiva", "Recuperación por vencer", "Cartera al cierre", "Morosidad al cierre"].map((t) => <th key={t} className={T.th}>{t}</th>)}
              </tr></thead>
              <tbody>{real.anual.map((a) => (
                <tr key={a.anio} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontWeight: 600 }}>{a.anio}</td><td className={T.td}>{a.meses}</td><td className={T.td}>{u(a.colocacion)}</td><td className={T.td}>{u(a.colMes)}</td>
                  <td className={T.td}>{p2(a.tasa)}</td><td className={T.td}>{p1(a.e)}</td><td className={T.td}>{u(a.cartera)}</td><td className={T.td}>{p2(a.mora)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </>}
      </>}

      {vista === "supuestos" && <>
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} rotuloReal={rotuloReal} primera="Supuesto" sin={sinMeses} idoneo />
            <tbody>
              {grupoSel === "prov" ? [
                <tr key="fm" style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">Meta de mejora del ritmo de atraso<Formula>Cuánto se reduce el paso de la cartera al día a 1–30 días y de 1–30 a 31–60 días (inmobiliario A2 y A3), frente al ritmo propio de la agencia. Es la misma meta de Cartera → Provisión → Presupuesto; mueve la provisión, el gasto 4402 y la utilidad.</Formula></span></td>
                  <td className={T.td}>{p1(1 - pres.fm)}</td><td className={T.td} style={{ color: E.tenue }}>{p1(0)}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                  <td className={T.td}>{entrada(1 - prop.fm, (x) => editar((v) => { v.fm = 1 - Math.max(-0.5, Math.min(0.5, x)); }), true, "fm", Math.abs(prop.fm - pres.fm) > 1e-9)}</td>
                </tr>,
                ...filasProv.map((f) => (
                <tr key={f.label} style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{f.label}<Formula>{f.formula}</Formula></span></td>
                  <td className={T.td}>{f.fmt(f.pres)}</td><td className={T.td}>{f.fmt(f.real)}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                  <td className={T.td} style={{ color: E.tinta, fontWeight: 600 }}>{f.fmt(f.prop)}</td>
                </tr>
              ))] : grupoSel === "col" ? <>
                <tr style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">Asesores de crédito<Formula>Asesores activos de Cartera → Metas. En la propuesta es solo una simulación: los nuevos entran como Junior, con su meta y su costo de personal (450105); si se reducen, salen primero los Junior. No se guarda en el presupuesto al aplicar.</Formula></span></td>
                  <td className={T.td}>{pres.ases}</td><td className={T.td}>{vReal.ases}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                  <td className={T.td}>{entrada(prop.ases, (x) => editar((v) => { v.ases = Math.round(x); }), false, "ases", prop.ases !== pres.ases)}</td>
                </tr>
                <tr style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>Meta de los asesores</td>
                  <td className={T.td}>{u(meta)}</td><td className={T.td} style={{ color: E.tenue }}>{u(meta)}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                  <td className={T.td} style={{ color: E.tinta }}>{u(metaDe(prop.ases))}</td>
                </tr>
                <tr style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">Cumplimiento de la meta<Formula>Ritmo real = colocación mensual promedio del período ({u(real.colMes)}) ÷ meta de los asesores del presupuesto.</Formula></span></td>
                  <td className={T.td}>{p2(pres.cumpl)}</td><td className={T.td}>{p2(real.cumpl)}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                  <td className={T.td}>{entrada(prop.cumpl, (x) => editar((v) => { v.cumpl = x; }), true, "cumpl", Math.abs(prop.cumpl - pres.cumpl) > 1e-9)}</td>
                </tr>
                <tr style={T.fila}>
                  <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">Interés de mora (% del interés de cartera)
                    <span className="text-[11px]" style={{ color: E.gris }}>{am.ins.interesMora?.origen === "automatico" ? "· automático (real)" : am.ins.interesMora?.origen === "manual" ? "· escrito a mano" : am.ins.interesMora?.origen === "institucional" ? "· institucional (sin datos)" : ""}</span><Formula>Automático: si no se escribe otro valor, el presupuesto usa el real de la agencia, calculado de sus estados de resultados cargados (junio al último mes) y se actualiza solo al subir nuevos balances. Interés de mora que se cobra por cada $100 de interés normal de la cartera. Real = cuenta 5104.50 ÷ interés de cartera sin mora (las 4 líneas con su parte refinanciada y reestructurada), en los meses sin alivio. Es un % para que acompañe a la cartera: si el interés normal sube, la mora sube igual. Se guarda para toda la agencia.</Formula></span></td>
                  <td className={T.td}>{p2(pres.mora ?? 0)}</td><td className={T.td}>{real.mora === null ? "—" : p2(real.mora)}</td>{celdaIdoneo("mora", 0)}
                  <td className={T.td}>{entrada(prop.mora ?? 0, (x) => editar((v) => { v.mora = Math.max(0, Math.min(0.5, x)); }), true, "mora", Math.abs((prop.mora ?? 0) - (pres.mora ?? 0)) > 1e-9)}</td>
                </tr>
              </> : (() => { const i = Number(grupoSel); const qR = real.rep && real.rep.q > 0 && real.lineas[i].activa ? real.rep.q : null; return CAMPOS.flatMap((k) => [(
                  <tr key={`${i}${k.k}`} style={T.fila}>
                    <td className={T.tdIzq} style={{ fontFamily: "inherit" }}><span className="inline-flex items-center gap-1">{k.label}<Formula>{k.formula}</Formula></span></td>
                    <td className={T.td}>{p2(pres[k.k][i])}</td>
                    <td className={T.td} style={{ color: k.k === "dist" || (!real.rep && (k.k === "rv" || k.k === "q" || k.k === "p")) || (k.k === "pase" && real.lineas[i].pase === null) ? E.tenue : E.tinta }}>{(k.k === "e" && real.lineas[i].e === null) || (k.k === "tasa" && real.lineas[i].tasa === null) || (k.k === "pase" && real.lineas[i].pase === null) ? "—" : p2(vReal[k.k][i])}</td>{celdaIdoneo(k.k, i)}
                    <td className={T.td}>{entrada(prop[k.k][i], (x) => editar((v) => { v[k.k][i] = k.k === "tasa" ? x : Math.max(0, Math.min(1, x)); }), true, `${k.k}${i}`, Math.abs(prop[k.k][i] - pres[k.k][i]) > 1e-9)}</td>
                  </tr>
                ), ...(k.k === "q" && qR ? [(() => {
                  const fuera = (x: number) => x < MARGEN_PREC[0] - 1e-9 || x > MARGEN_PREC[1] + 1e-9;
                  const mPres = pres.q[i] / qR, mProp = prop.q[i] / qR;
                  return (
                    <tr key={`${i}qm`} style={T.fila}>
                      <td className={T.tdIzq} style={{ fontFamily: "inherit", paddingLeft: 24, color: E.gris }}><span className="inline-flex items-center gap-1">Margen de precancelaciones (% del ritmo real)<Formula>Cuánto se precancela frente a lo real: 100 % = el mismo ritmo de {real.desde.slice(0, 4)} (≈ {u(qR * real.lineas[i].pvFin)} al mes en {NOMBRE_LINEA[i]} con la cartera por vencer de {perCorto(real.hasta)}); 80 % = un 20 % menos. Se aplica igual a las precancelaciones de la cartera vencida. Fuera de {Math.round(MARGEN_PREC[0] * 100)} %–{Math.round(MARGEN_PREC[1] * 100)} % se marca en rojo. Se guarda como el % de precancelaciones de la línea.</Formula></span></td>
                      <td className={T.td} style={{ color: fuera(mPres) ? E.alerta : E.gris }}>{p1(mPres)}</td>
                      <td className={T.td} style={{ color: E.gris }}>{p1(1)}</td><td className={T.td} style={{ color: E.tenue, fontFamily: "inherit" }}>—</td>
                      <td className={T.td}><span className="inline-flex items-center gap-1 justify-end" style={{ color: fuera(mProp) ? E.alerta : undefined }}>{entrada(mProp, (x) => editar((v) => { v.q[i] = Math.max(0, Math.min(1, qR * x)); }), true, `qm${i}`, Math.abs(prop.q[i] - pres.q[i]) > 1e-9)}{fuera(mProp) && <span title="Fuera del margen de tolerancia" style={{ color: E.alerta, fontSize: 10 }}>●</span>}</span></td>
                    </tr>
                  );
                })()] : [])]); })()}
            </tbody>
          </table>
        </div>
        {grupoSel === "prov" && <div>
          <button type="button" className="text-[12px] font-semibold hover:underline inline-flex items-center gap-1" style={{ color: E.verde }} aria-expanded={comoProv} onClick={() => setComoProv((x) => !x)}>
            {comoProv ? "▾" : "▸"} Qué puede mejorar {ag}
          </button>
          {comoProv && <Palancas c={c} idx={idx} />}
        </div>}
        {!real.rep && grupoSel !== "col" && grupoSel !== "prov" && <p className="text-[12px]" style={{ color: E.gris }}>Sin reporte de recuperación de cartera para {ag}: el porcentaje de recuperación por período, la recuperación por vencer, las precancelaciones y la recuperación en riesgo conservan los del presupuesto. Súbelo en Carga de datos → Recuperación de cartera.</p>}
        <Acciones guardando={guardando} editada={editada} onReal={() => aplicar(vReal, "ritmo real")} onPropuesta={() => aplicar(prop, "propuesta")}>
          <BorradorLinks editada={editada} onReal={() => setProp(null)} />
          <button type="button" className={`${enlace}`} style={{ color: E.verde }} onClick={() => setProp({ ...vReal, tasa: [...vReal.tasa], e: [...vReal.e], rv: [...vReal.rv], dist: [...vReal.dist], p: [...vReal.p], q: [...vReal.q], pase: [...vReal.pase] })}>Partir del real</button>
          {c.idoneo && <button type="button" className={enlace} style={{ color: E.verde }} onClick={() => { const v = versionIdoneo(c.idoneo!); setProp({ ...v, tasa: [...v.tasa], e: [...v.e], rv: [...v.rv], dist: [...v.dist], p: [...v.p], q: [...v.q], pase: [...v.pase] }); }}>Partir del idóneo</button>}

        </Acciones>
      </>}

      {vista === "impacto" && (
        <div className="overflow-x-auto">
          <table className={T.tabla} style={NUM}>
            <CabVersiones anioReal={real.anio} rotuloReal={rotuloReal} extra="Propuesta vs presupuesto" sin={sinMeses} antes={r12 ? (r12.n === 12 ? "Real últimos 12 meses" : `Real ${r12.n} meses × 12`) : undefined} />
            <tbody>{impacto.map((r, k) => (
              <tr key={k} style={{ ...T.fila, fontWeight: r.fuerte ? 600 : 400, background: r.label === "Intereses de cartera menos provisiones" ? E.fondo : undefined }}>
                <td className={`${T.tdIzq} ${r.sub ? "pl-5" : ""}`} style={{ fontFamily: "inherit", color: r.sub ? E.gris : E.tinta }}><span className="inline-flex items-center gap-1">{r.label}{r.formula && <Formula>{r.formula}</Formula>}</span></td>
                {r12 && <td className={T.td} style={{ color: E.gris }}>{r.real === undefined || r.real === null ? "—" : r.fmt(r.real)}</td>}
                <td className={T.td}>{r.fmt(r.f(Rp))}</td><td className={T.td}>{r.fmt(r.f(Rr))}</td>
                <td className={T.td} style={{ color: E.tinta, fontWeight: 600 }}>{r.fmt(r.f(Rx))}</td>
                <td className={T.td}><Delta d={r.f(Rx) - r.f(Rp)} tipo={r.tipo} mejor={r.mejor} /></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Qué decirle a la agencia: desde su comportamiento real (ritmo real), cuánto mueven la provisión, la morosidad y la
 * utilidad 2027 las mejoras en pase a riesgo y recuperación de cartera vencida (mismo motor del presupuesto).
 */
function Palancas({ c, idx }: { c: EstadoCartera; idx: number[] }) {
  const { vReal, correr, Rr, setProp, prop, resultado } = c;
  const casos = useMemo(() => {
    if (!vReal || !Rr) return [];
    const v = (f: (x: VersionCartera) => void) => { const x: VersionCartera = { ...vReal, pase: [...vReal.pase], rv: [...vReal.rv] }; f(x); return x; };
    // detalle corto en una línea: solo las líneas con pase a riesgo; la recuperación de vencida es la de la agencia (igual en todas)
    const conPase = idx.filter((i) => vReal.pase[i] >= 0.001);
    const CORTO = ["Prod.", "Consumo", "Inmob.", "Micro"];
    const n = (x: number) => (x * 100).toFixed(2).replace(".", ",");
    const pase = (k: number) => conPase.map((i) => `${CORTO[i]} ${n(vReal.pase[i])} → ${n(vReal.pase[i] * k)} %`).join(" · ");
    const rv0 = vReal.rv[idx[0] ?? 1] ?? 0;
    // la mejora de la recuperación: 1 punto más de las cuotas vencidas del mes (la medida del reporte)
    const subeRv = (y: number) => y + 0.01;
    const detRv = `${n(rv0)} → ${n(rv0 + 0.01)} % de las cuotas vencidas del mes`;
    const lista: { label: string; detalle: string; v: VersionCartera }[] = [
      { label: "Pase a riesgo −10 %", detalle: pase(0.9), v: v((x) => { x.pase = x.pase.map((y) => y * 0.9); }) },
      { label: "Pase a riesgo −20 %", detalle: pase(0.8), v: v((x) => { x.pase = x.pase.map((y) => y * 0.8); }) },
      { label: "Recuperación de vencida +1 punto", detalle: detRv, v: v((x) => { x.rv = x.rv.map(subeRv); }) },
      { label: "Pase −20 % y recuperación +1 punto", detalle: "", v: v((x) => { x.pase = x.pase.map((y) => y * 0.8); x.rv = x.rv.map(subeRv); }) },
    ];
    return lista.map((k) => ({ ...k, R: correr(k.v) }));
  }, [vReal, Rr]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!vReal || !Rr || !casos.length) return null;
  const gasto = (R: Corrida) => R.er.provCart - R.er.reversion;
  const mejor = casos.reduce((a, k) => (k.R && (!a.R || resultado(k.R) > resultado(a.R)) ? k : a), casos[0]);
  // la mejora está en la propuesta si su pase a riesgo y su recuperación de vencida son los de la propuesta
  const igual = (a: number[] | undefined, b: number[]) => !!a && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  const enUso = (v: VersionCartera) => igual(prop?.pase, v.pase) && igual(prop?.rv, v.rv);
  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="overflow-x-auto">
        <table className={T.tabla} style={NUM}>
          <thead><tr style={T.cab}>
            <th className={T.thIzq}>Mejora</th>
            <th className={T.th}>Provisión</th><th className={T.th}>Mora dic</th><th className={T.th}>Resultado de cartera</th><th className={T.th}>Δ resultado</th><th className={T.th} />
          </tr></thead>
          <tbody>
            <tr style={T.fila}>
              <td className={T.tdIzq} style={{ fontFamily: "inherit", color: E.gris }}>Seguir como hoy (ritmo real)</td>
              <td className={T.td}>{u(gasto(Rr))}</td><td className={T.td}>{p2(Rr.kpi.mora)}</td><td className={T.td}>{u(resultado(Rr))}</td><td className={T.td} /><td className={T.td} />
            </tr>
            {casos.map((k) => k.R && (
              <tr key={k.label} style={{ ...T.fila, background: k === mejor ? E.fondo : undefined }}>
                <td className={T.tdIzq} style={{ fontFamily: "inherit" }}>
                  <span className="whitespace-nowrap">{k.label}</span>
                  {k.detalle && <span className="whitespace-nowrap text-[11px] ml-2" style={{ color: E.tenue }}>{k.detalle}</span>}
                </td>
                <td className={T.td}>{u(gasto(k.R))}</td><td className={T.td}>{p2(k.R.kpi.mora)}</td><td className={T.td}>{u(resultado(k.R))}</td>
                <td className={T.td}><Delta d={resultado(k.R) - resultado(Rr)} tipo="usd" mejor={1} /></td>
                <td className={T.td}>
                  {enUso(k.v) ? (
                    <span className="inline-flex items-center h-7 px-2.5 rounded-md text-[12px] font-semibold whitespace-nowrap" style={{ background: E.oroSuave, color: E.oro }}>En la propuesta</span>
                  ) : (
                    <button type="button" title="Cambia solo el pase a riesgo y la recuperación de vencida de la Propuesta; lo demás de la Propuesta se mantiene (no guarda en el presupuesto)" aria-label={`Usar en la propuesta: ${k.label}`}
                      onClick={() => { if (prop) setProp({ ...prop, pase: [...k.v.pase], rv: [...k.v.rv] }); }}
                      className="h-7 px-2.5 rounded-md text-[12px] font-semibold whitespace-nowrap hover:bg-[#E6F0EA]" style={{ color: E.verde, border: `1px solid ${E.linea}`, background: "#fff" }}>
                      Usar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
