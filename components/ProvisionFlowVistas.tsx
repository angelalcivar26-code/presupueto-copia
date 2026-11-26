"use client";

import { useState } from "react";
import { useDatos } from "../lib/useDatos";
import { C, MESES, usd, pct, suma, Indicador, FranjaIndicadores, Tarjeta, TablaMeses, type DefFila } from "./ActivosComun";
import { BotonesVista, ResumenPorAgencia } from "./PorAgencia";
import { EsqueletoTabla } from "./Carga";
import { useVerMes } from "./EgresosComun";
import {
  PRODUCTOS, NOMBRE_ESCENARIO, CUENTA_4402,
  type Escenario, type Producto, type RepartoAgencia, type ReferenciaCartera, type SupuestosMora,
} from "../lib/calc/provision-flow";

/**
 * PROVISIONES · modelo por flow rates (tramos de mora)
 *  - ModeloTramos: el escenario activo mes a mes (gasto 4402 por producto, reversiones 5604.10, recuperación 5604.05,
 *    provisión, saldo E, morosidad por días vs contable, cobertura); en Consolidado también por agencia.
 */
interface ProductoMes {
  total: number[]; castigos: number[]; provision: number[]; gastoNeto: number[]; gasto4402: number[]; reversion: number[];
  mora: number[]; saldoE: number[]; saldos: Record<string, number[]>; provisionInicio: number; provisionCorte: number;
}
export interface DatosFlow {
  disponible: boolean;
  escenario: Escenario; periodoCorte: string; mesesPuente: number;
  escenarios: Record<Escenario, { recuperacion: number[]; productos: Record<Producto, ProductoMes> }>;
  controlConstante: Record<Escenario, { gasto: number; provisionDic: number }>;
  lineas: Record<Producto, { saldo1499: number[]; noExplicada: number; castigosAcumulados: number[] }>;
  provisionGenerica: number;
  carteraRiesgo: number[]; carteraBruta: number[];
  resultadoEjercicio: number[];
  reparto?: RepartoAgencia | null;
  factorMora?: { usado: number; real: { factor: number; desde: string; hasta: string; meses: number } | null };
  cartera?: { referencia: ReferenciaCartera | null; supuestos: SupuestosMora };
  supuestos?: { castigoMensual: number; recuperacionAnual: Record<Escenario, number> };
  /** Ajuste al real: factor del ritmo de atraso con el que el modelo reproduce el gasto real al mes de la agencia. */
  ajuste?: { factor: number | null; gastoRealMes: number | null };
  error?: string;
}
const NOMBRE_PRODUCTO: Record<Producto, string> = { CONSUMO: "Consumo", MICROCREDITO: "Microcrédito", INMOBILIARIO: "Inmobiliario", PRODUCTIVO: "Productivo" };
const ORDEN_4402: Producto[] = ["PRODUCTIVO", "CONSUMO", "INMOBILIARIO", "MICROCREDITO"];
const MES_TXT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const sumar = (xs: number[][]) => MESES.map((_, i) => xs.reduce((t, x) => t + (x[i] ?? 0), 0));
const div = (a: number, b: number) => (b ? a / b : 0);

export const urlFlow = (agencia: string, ejercicio: number) => `/api/provision-flow?agencia=${encodeURIComponent(agencia)}&ejercicio=${ejercicio}`;

/** Series de un escenario (todas las líneas o una). */
export function seriesEscenario(d: DatosFlow, e: Escenario, solo?: Producto) {
  const ps = solo ? [solo] : PRODUCTOS;
  const esc = d.escenarios[e];
  const P = (k: keyof ProductoMes) => sumar(ps.map((p) => esc.productos[p][k] as number[]));
  const noExpl = ps.reduce((t, p) => t + (d.lineas[p]?.noExplicada ?? 0), 0);
  const provModelo = P("provision");
  const prov1499 = provModelo.map((v) => v + noExpl);
  const g4402 = P("gasto4402"), rev = P("reversion");
  const rec = solo ? MESES.map(() => 0) : esc.recuperacion;
  const mora = P("mora"), total = P("total");
  return {
    g4402, rev, rec, gastoNeto: P("gastoNeto"), castigos: P("castigos"), saldoE: P("saldoE"), mora, total,
    provModelo, noExpl, prov1499, efecto: g4402.map((g, i) => -g + rev[i] + rec[i]),
    moraDias: mora.map((m, i) => div(m, total[i])), cobertura: prov1499.map((p, i) => div(p, mora[i])),
    porProducto: Object.fromEntries(ps.map((p) => [p, esc.productos[p]])) as Partial<Record<Producto, ProductoMes>>,
  };
}

/** Metodología: cómo los supuestos de cartera del presupuesto mueven el modelo, frente a lo real de la agencia. */
function SupuestosCartera({ c }: { c: { referencia: ReferenciaCartera | null; supuestos: SupuestosMora } }) {
  const ref = c.referencia!; const lim = (x: number) => Math.max(0.2, Math.min(3, x));
  const lineas = (["CONSUMO", "MICROCREDITO", "INMOBILIARIO", "PRODUCTIVO"] as Producto[]).filter((p) => ref.pase[p] !== undefined && c.supuestos.pase[p] !== undefined);
  const p2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2).replace(".", ",")} %`);
  return (
    <div className="flex flex-col gap-2 mt-3 leading-relaxed">
      <p className="m-0">
        <b>Supuestos de cartera.</b> El modelo está calibrado con el comportamiento real de la agencia ({ref.desde} a {ref.hasta}). Si el presupuesto supone otro pase a riesgo,
        la entrada a la mora (desde vigente) cambia en la misma proporción; si supone otra recuperación de cartera vencida, cambia lo que rueda a los tramos más profundos.
        Con los supuestos iguales a lo real, la provisión es la del modelo calibrado.
      </p>
      <table className="max-w-[640px] text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead><tr style={{ color: C.texto2 }}><th className="text-left font-semibold py-1">Línea</th><th className="text-right font-semibold px-3">Pase a riesgo real</th><th className="text-right font-semibold px-3">En el presupuesto</th><th className="text-right font-semibold pl-3">Entrada a la mora ×</th></tr></thead>
        <tbody>
          {lineas.map((p) => (
            <tr key={p} style={{ borderTop: `1px solid ${C.beige}` }}>
              <td className="py-1 pr-3">{NOMBRE_PRODUCTO[p]}</td><td className="px-3 text-right">{p2(ref.pase[p])}</td><td className="px-3 text-right">{p2(c.supuestos.pase[p])}</td>
              <td className="pl-3 text-right">{lim((c.supuestos.pase[p] ?? 0) / (ref.pase[p] || 1)).toFixed(2).replace(".", ",")}</td>
            </tr>
          ))}
          <tr style={{ borderTop: `1px solid ${C.beige}` }}>
            <td className="py-1 pr-3">Recuperación de cartera vencida (% de las cuotas vencidas)</td><td className="px-3 text-right">{p2(ref.cv ?? null)}</td>
            <td className="px-3 text-right">{lineas.map((p) => p2((c.supuestos.rv[p] ?? 0) / (ref.factorVencida || 1))).filter((x, i, a) => a.indexOf(x) === i).join(" · ")}</td><td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Metodología: de dónde salen los castigos y la 5604.05 de la agencia, con sus cifras. */
function MetodoReparto({ r, sup, e, castigosAnio, recAnio }: { r: RepartoAgencia; sup: { castigoMensual: number; recuperacionAnual: Record<Escenario, number> }; e: Escenario; castigosAnio: number; recAnio: number }) {
  const real = r.criterio === "real", per = real && r.desde && r.hasta ? `${MES_TXT[Number(r.desde.slice(5)) - 1]}-${r.desde.slice(2, 4)} a ${MES_TXT[Number(r.hasta.slice(5)) - 1]}-${r.hasta.slice(2, 4)}` : "";
  const fila = (a: string, b: string, c: string, fuerte = false) => (
    <tr style={{ borderTop: `1px solid ${C.beige}`, fontWeight: fuerte ? 600 : 400 }}><td className="py-1 pr-3">{a}</td><td className="py-1 px-3 text-right whitespace-nowrap">{b}</td><td className="py-1 pl-3 text-right whitespace-nowrap">{c}</td></tr>
  );
  return (
    <div className="flex flex-col gap-3 mt-2 leading-relaxed">
      <p className="m-0">
        La cooperativa define dos supuestos en Escenarios: el <b>castigo mensual</b> ({usd(sup.castigoMensual)}, {usd(sup.castigoMensual * 12)} al año) y la <b>recuperación anual de cartera castigada</b> del escenario ({NOMBRE_ESCENARIO[e]}: {usd(sup.recuperacionAnual[e])}).
        {real
          ? <> El castigo se reparte según la <b>cartera calificada E</b> de cada agencia (ya provisionada al 100 %): castiga quien tiene E, así ninguna acumula cartera E sin castigar. La recuperación de castigados, según lo que cada agencia <b>realmente recuperó en los últimos 12 meses</b> ({per}, 5604.05).</>
          : <> Esta agencia no tiene históricos suficientes de los últimos 12 meses: su parte se calcula con su saldo en calificación E.</>}
      </p>
      <table className="max-w-[640px] text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead><tr style={{ color: C.texto2 }}><th className="text-left font-semibold py-1">Concepto</th><th className="text-right font-semibold px-3">Castigos</th><th className="text-right font-semibold pl-3">Recuperación 5604.05</th></tr></thead>
        <tbody>
          {real && fila(`Real de la agencia (${per})`, usd(r.castigos.agencia ?? 0), usd(r.recuperacion.agencia ?? 0))}
          {real && fila("Real de la cooperativa (10 agencias)", usd(r.castigos.cooperativa ?? 0), usd(r.recuperacion.cooperativa ?? 0))}
          {fila(real ? "Parte de la agencia (castigos: por su saldo en E)" : "Parte por saldo en E", pct(r.castigos.parte, 1), pct(r.recuperacion.parte, 1))}
          {fila("Supuesto de la cooperativa para el año", usd(sup.castigoMensual * 12), usd(sup.recuperacionAnual[e]))}
          {fila("De la agencia en el presupuesto", usd(castigosAnio), usd(recAnio), true)}
        </tbody>
      </table>
      <p className="m-0">
        <b>Dónde llega:</b> los castigos salen del tramo E (con tope en su saldo) y restan por el mismo monto de la cartera en riesgo (14) y de la provisión (1499);
        no afectan la utilidad. La recuperación entra cada mes en partes iguales a Otros ingresos (5604.05) y al flujo de efectivo, y sube la utilidad.

      </p>
    </div>
  );
}

// =====================================================================
interface Cuenta44 { codigo: string; label: string; valores: number[] }

/**
 * Provisión del presupuesto que llega al Estado de resultados (grupo 44): 4402 por línea de crédito (modelo por tramos,
 * escenario activo) y las demás provisiones del grupo 44 (cuentas por cobrar, otros activos), tomadas del Estado de resultados.
 */
export function ModeloTramos({ agencia, ejercicio, otras44 = [] }: { agencia: string; ejercicio: number; otras44?: Cuenta44[] }) {
  const { datos: d, cargando, error } = useDatos<DatosFlow>(urlFlow(agencia, ejercicio), 0, (x) => (x.carteraBruta ? null : "No se pudo calcular la provisión por tramos."));
  const [vista, setVista] = useState<"meses" | "agencias">("meses");
  const [metodo, setMetodo] = useState(false);
  const ver = useVerMes();
  if (cargando) return <EsqueletoTabla filas={8} />;
  if (error || !d) return <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>;
  if (!d.disponible || !d.escenarios) return (
    <p className="text-[13px]" style={{ color: C.texto2 }}>Esta agencia no tiene corte de Calificación de Cartera cargado: la provisión se calcula con el % sobre la cartera. Cárgalo en Cartera de crédito → Provisión.</p>
  );
  // el escenario activo (se elige en Cartera de crédito → Provisión → Escenarios)
  const e = d.escenario;
  const s = seriesEscenario(d, e);
  const consolidado = agencia === "Consolidado";
  // las demás provisiones del grupo 44: todo lo que no es 4402 (ni sus subcuentas por línea, que ya salen del modelo)
  const otras = otras44.filter((x) => { const c = x.codigo.replace(/\D/g, ""); return c.length >= 4 && c.startsWith("44") && !c.startsWith("4402") && x.valores.some((v) => Math.round(v) !== 0); });
  const total44 = MESES.map((_, i) => s.g4402[i] + otras.reduce((t, x) => t + (x.valores[i] ?? 0), 0));
  const anio44 = suma(total44), anio4402 = suma(s.g4402);
  const porLinea = ORDEN_4402.map((p) => ({ p, v: suma(d.escenarios[e].productos[p].gasto4402) })).sort((a, b) => b.v - a.v);
  const carteraProm = suma(s.total) / 12;

  const filas: DefFila[] = [];
  for (const p of ORDEN_4402) {
    const x = d.escenarios[e].productos[p];
    if (!x.gasto4402.some((v) => Math.round(v) !== 0)) continue;
    filas.push({ id: `g-${p}`, label: `${CUENTA_4402[p]} · Crédito ${NOMBRE_PRODUCTO[p].toLowerCase()}`, valores: x.gasto4402, total: suma(x.gasto4402),
      formula: (i) => `Provisión por tramos de ${MESES[i]} − la del mes anterior + castigos = ${usd(x.provision[i])} − ${usd(i === 0 ? x.provisionInicio : x.provision[i - 1])} + ${usd(x.castigos[i])} = ${usd(x.gastoNeto[i])}.` });
  }
  filas.push({ id: "g4402", label: "4402 · Cartera de créditos", valores: s.g4402, total: anio4402, clave: true });
  for (const x of otras) filas.push({ id: `o-${x.codigo}`, label: `${x.codigo} · ${x.label}`, valores: x.valores, total: suma(x.valores), formula: () => "Tomado del presupuesto (Estado de resultados)." });
  if (otras.length) filas.push({ id: "t44", label: "Total provisiones · 44", valores: total44, total: anio44, clave: true });

  return (
    <div className="flex flex-col gap-4">
      <FranjaIndicadores>
        <Indicador titulo="Provisiones del año · 44" valor={usd(anio44)} pie={`Promedio mensual ${usd(anio44 / 12)}`} />
        <Indicador titulo="Cartera de créditos · 4402" valor={usd(anio4402)} pie={anio44 ? `${pct(div(anio4402, anio44), 1)} de las provisiones` : " "} />
        <Indicador titulo="Línea con más provisión" valor={porLinea[0]?.v ? NOMBRE_PRODUCTO[porLinea[0].p] : "—"} pie={porLinea[0]?.v && anio4402 ? `${usd(porLinea[0].v)} · ${pct(div(porLinea[0].v, anio4402), 1)} de la 4402` : " "} />
        <Indicador titulo="Costo del riesgo" valor={pct(div(anio4402, carteraProm), 2)} pie="Gasto 4402 ÷ cartera promedio del año" />
      </FranjaIndicadores>
      {!consolidado && d.reparto && d.supuestos && (
        <div className="rounded-md px-4 py-2.5 text-[12px]" style={{ background: "#F6F8F7", border: `1px solid ${C.borde}`, color: C.texto3 }}>
          <button type="button" aria-expanded={metodo} onClick={() => setMetodo((x) => !x)} className="font-semibold hover:underline" style={{ color: C.acento }}>
            {metodo ? "▾" : "▸"} Cómo se calcula la provisión de {agencia}
          </button>
          {metodo && d.factorMora && (
            <p className="m-0 mt-3 leading-relaxed">
              <b>Factor de mora de la agencia: {d.factorMora.usado.toFixed(2).replace(".", ",")}</b>. Multiplica la entrada a la mora (tramos de 1–30 y 31–60 días; inmobiliario A2 y A3) de las tasas de la cooperativa:
              con más de 1 le entra más cartera a mora que al promedio y necesita más provisión (4402); con menos de 1, menos.
              {d.factorMora.real ? <> Con su Calificación de Cartera ({d.factorMora.real.desde} a {d.factorMora.real.hasta}), el ritmo real de la agencia es <b>{d.factorMora.real.factor.toFixed(2).replace(".", ",")}</b>.</> : null}
              {" "}Se cambia en Planificación → Estudio de agencia → 14 → Supuestos → Provisión.
            </p>
          )}
          {metodo && d.cartera?.referencia && <SupuestosCartera c={d.cartera} />}
          {metodo && <MetodoReparto r={d.reparto} sup={d.supuestos} e={e} castigosAnio={suma(s.castigos)} recAnio={suma(s.rec)} />}
        </div>
      )}
      <Tarjeta titulo={vista === "meses" ? `Provisiones en resultados · escenario ${NOMBRE_ESCENARIO[e]}` : `Gasto 4402 por agencia · escenario ${NOMBRE_ESCENARIO[e]}`}
        derecha={consolidado ? <BotonesVista etiqueta="Vista" valor={vista} onChange={setVista} opciones={[{ id: "meses", label: "Mes a mes" }, { id: "agencias", label: "Por agencia" }]} /> : undefined}>
        {consolidado && vista === "agencias" ? (
          <ResumenPorAgencia<DatosFlow> url={(a) => urlFlow(a, ejercicio)} conceptos={[
            { id: "g", label: "Gasto 4402", valores: (x) => (x.disponible ? seriesEscenario(x, e).g4402 : Array(12).fill(0)), tipo: "suma" },
          ]} />
        ) : (
          <TablaMeses titulo="Cuenta" ultima="Año" filas={filas.map((f) => ({ ...f, valores: f.esPct ? f.valores : ver(f.valores) }))} />
        )}
      </Tarjeta>
    </div>
  );
}
