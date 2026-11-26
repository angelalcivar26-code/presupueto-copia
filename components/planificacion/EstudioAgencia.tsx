"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useDatos, apiFetch } from "../../lib/useDatos";
import { EsqueletoTabla } from "../Carga";
import { FranjaIndicadores, Indicador } from "../ActivosComun";
import { correrVersion, type AgenciaMotor } from "../../lib/calc/plan-motor";
import type { Corrida, Mundo } from "../../lib/calc/plan2027";
import type { HistoricoEstudio } from "../../lib/calc/estudio-agencia";
import { E, NUM, u, p2, corto, difFmt, useMedida, type Enviar } from "./EstudioComun";
import { useCartera, insumosCartera, DetalleCartera } from "./EstudioCartera";
import { useCaptaciones, DetalleCaptaciones } from "./EstudioCaptaciones";
import { useGastos, DetalleGastos } from "./EstudioGastos";
import { useIntereses, DetalleIntereses } from "./EstudioIntereses";
import { useOtros, DetalleOtros } from "./EstudioOtros";
import { useIngresos51, DetalleIngresos51 } from "./EstudioIngresos51";
import { CUENTAS_COMPARACION, DetalleComparacion } from "./EstudioComparacion";
import { ejercicioEnUso } from "../../lib/seleccion";

/**
 * ESTUDIO DE AGENCIA: la utilidad 2027 de la agencia en tres versiones (Presupuesto · Ritmo real · Propuesta) y,
 * debajo, sus cuentas una tras otra; cada cuenta se abre en Realidad, Supuestos e Impacto 2027.
 * Todas las cifras salen del mismo motor del presupuesto.
 */
export function EstudioAgencia({ M, ag }: { M: Mundo; ag: string }) {
  const am = M.motor?.[ag]?.am as AgenciaMotor | undefined;
  const h = useDatos<HistoricoEstudio>(am ? `/api/estudio-agencia?agencia=${encodeURIComponent(ag)}` : null, 0);
  if (ag === "Consolidado") return <Vacio>El estudio se hace por agencia. Elija una agencia en la parte superior.</Vacio>;
  if (!am) return <Vacio>No se pudo leer el presupuesto {ejercicioEnUso()} de {ag}.</Vacio>;
  if (h.error) return <Vacio alerta>{h.error}</Vacio>;
  if (!h.datos) return <EsqueletoTabla filas={8} />;
  return <Estudio am={am} h={h.datos} ag={ag} motor={M.motor} />;
}

function Vacio({ children, alerta }: { children: ReactNode; alerta?: boolean }) {
  return <div className="tarjeta px-6 py-8 text-[14px]" style={{ color: alerta ? E.alerta : E.gris }}>{children}</div>;
}

function Estudio({ am, h, ag, motor }: { am: AgenciaMotor; h: HistoricoEstudio; ag: string; motor?: Mundo["motor"] }) {
  const [verResp, setVerResp] = useState(0);
  const resp = useDatos<{ respaldos: { id: number; creado: string; origen: string }[] }>(`/api/estudio-agencia?agencia=${encodeURIComponent(ag)}&vista=respaldos`, verResp);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [sel, setSel] = useState("resumen");

  const cart = useCartera(am, h), capt = useCaptaciones(am, h), gast = useGastos(am, h), inte = useIntereses(am, h), otros = useOtros(am, h), ing = useIngresos51(am, h);
  const Rp = useMemo(() => correrVersion(am, {}), [am]);
  // la agencia completa: cartera, captaciones y gastos de operación juntos
  const juntas = (vc: typeof cart.vReal, vk: typeof capt.vReal, vg: typeof gast.vReal, vi: typeof inte.vReal, vo: typeof otros.prop, vb: typeof ing.vReal): Corrida | null => {
    if (!vc || !vk) return null;
    const x = insumosCartera(am, cart.pres, vc), g = vg ? gast.insumos(vg) : null;
    const f1 = vi ? inte.escalar(g?.filas ?? am.ins.filasPresupuesto, vi) : g?.filas;
    const f2 = vo ? otros.agregar(f1 ?? am.ins.filasPresupuesto, vo) : f1;
    const filas = vb ? ing.escalar(f2 ?? am.ins.filasPresupuesto, vb) : f2;
    return correrVersion(am, { paramsCredito: x.filas, parametrosOtrosPasivo: x.opp, paramsCaptaciones: capt.filas(vk), ...(filas ? { filasPresupuesto: filas } : {}), ...(g ? { empleados: g.empleados } : {}) });
  };
  const Rr = useMemo(() => juntas(cart.vReal, capt.vReal, gast.vReal, inte.vReal, otros.vReal, ing.vReal), [am, cart.vReal, capt.vReal, gast.vReal, inte.vReal, otros.vReal, ing.vReal]); // eslint-disable-line react-hooks/exhaustive-deps
  const Rx = useMemo(() => juntas(cart.prop, capt.prop, gast.prop, inte.prop, otros.prop, ing.prop), [am, cart.prop, capt.prop, gast.prop, inte.prop, otros.prop, ing.prop]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (cuerpo: Record<string, unknown>) => {
    const r = await apiFetch("/api/estudio-agencia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencia: ag, ...cuerpo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `Error ${r.status}`);
  };
  const enviar: Enviar = async (cuerpo, origen, confirmar) => {
    if (!window.confirm(`${confirmar} Se guarda una copia para deshacer. ¿Continuar?`)) return false;
    setGuardando(true); setMsg(null);
    try {
      await post({ accion: "aplicar", origen, ...cuerpo });
      setMsg({ t: `Aplicado al presupuesto de ${ag}: ${origen}. El presupuesto ${ejercicioEnUso()} se recalcula en unos segundos.`, ok: true });
      setVerResp((n) => n + 1); return true;
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : "No se pudo guardar", ok: false }); return false; }
    finally { setGuardando(false); }
  };
  const deshacer = async () => {
    if (!window.confirm(`Se vuelve a los parámetros que ${ag} tenía antes del último cambio. ¿Continuar?`)) return;
    setGuardando(true); setMsg(null);
    try { await post({ accion: "deshacer" }); setMsg({ t: "Se restauraron los parámetros anteriores.", ok: true }); setVerResp((n) => n + 1); }
    catch (e) { setMsg({ t: e instanceof Error ? e.message : "No se pudo restaurar", ok: false }); }
    finally { setGuardando(false); }
  };

  const anioReal = cart.real?.anio ?? capt.real?.anio ?? 2026;
  const ultResp = resp.datos?.respaldos?.[0];
  const ultC = cart.real?.meses[cart.real.meses.length - 1];
  const cartReal = ultC ? ultC.pv.reduce((a, x) => a + x, 0) + ultC.r.reduce((a, x) => a + x, 0) : null;
  const moraReal = ultC && cartReal ? ultC.r.reduce((a, x) => a + x, 0) / cartReal : null;
  const k = capt.real, ultK = k?.meses[k.meses.length - 1];

  const efectos: Record<string, number | null> = { "14": cart.Rr ? cart.resultado(cart.Rr) - cart.resultado(Rp) : null, "21": capt.Rr ? capt.Rr.kpi.util - Rp.kpi.util : null, "41": inte.Rr ? inte.Rr.kpi.util - Rp.kpi.util : null, "45": gast.Rr ? gast.Rr.kpi.util - Rp.kpi.util : null, "51": ing.Rr ? ing.Rr.kpi.util - Rp.kpi.util : null,
    ...Object.fromEntries(Object.entries(otros.efReal).map(([k, R]) => [k, R ? R.kpi.util - Rp.kpi.util : null])) };
  const detalles: Record<string, ReactNode> = {
    "14": <DetalleCartera c={cart} am={am} Rp={Rp} ag={ag} enviar={enviar} guardando={guardando} motor={motor} />,
    "21": <DetalleCaptaciones c={capt} am={am} Rp={Rp} ag={ag} enviar={enviar} guardando={guardando} />,
    "41": <DetalleIntereses c={inte} Rp={Rp} ag={ag} enviar={enviar} guardando={guardando} />,
    "45": <DetalleGastos c={gast} am={am} Rp={Rp} ag={ag} enviar={enviar} guardando={guardando} />,
    "51": <DetalleIngresos51 c={ing} Rp={Rp} ag={ag} enviar={enviar} guardando={guardando} />,
    ...Object.fromEntries(["52", "54", "56", "47"].map((k) => [k, <DetalleOtros key={k} c={otros} Rp={Rp} ag={ag} cuenta={k} enviar={enviar} guardando={guardando} />])),
    // cuentas sin supuestos propios: real frente a presupuesto, sin editar
    ...Object.fromEntries(CUENTAS_COMPARACION.map((k) => [k, <DetalleComparacion key={k} h={h} ag={ag} cuenta={k} nombre={GRUPOS.flatMap((g) => g.cuentas).find((x) => x.c === k)?.n ?? ""} />])),
  };
  // tarjetas: utilidad, ROA, morosidad y eficiencia 2027 con la propuesta del estudio (o el presupuesto si aún no hay)
  const X = Rx ?? Rp;
  const pie = (d: number, tipo: "usd" | "pp", mejor: 1 | -1) => {
    if (Math.abs(d) < (tipo === "usd" ? 0.5 : 1e-6)) return { pie: `Igual al presupuesto ${ejercicioEnUso()}`, color: undefined };
    return { pie: `${difFmt(d, tipo)} frente al presupuesto ${ejercicioEnUso()}`, color: d * mejor > 0 ? E.verde : E.alerta };
  };
  const tarjetas = [
    { titulo: `Utilidad ${ejercicioEnUso()} · propuesta`, valor: u(X.kpi.util), ...pie(X.kpi.util - Rp.kpi.util, "usd", 1) },
    { titulo: `ROA ${ejercicioEnUso()}`, valor: p2(X.kpi.roa), ...pie(X.kpi.roa - Rp.kpi.roa, "pp", 1) },
    { titulo: `Morosidad a diciembre ${ejercicioEnUso()}`, valor: p2(X.kpi.mora), ...pie(X.kpi.mora - Rp.kpi.mora, "pp", -1) },
    { titulo: `Eficiencia ${ejercicioEnUso()}`, valor: p2(X.kpi.efic), ...pie(X.kpi.efic - Rp.kpi.efic, "pp", -1) },
  ];
  const grupoDe = (c: string) => GRUPOS.find((g) => g.cuentas.some((x) => x.c === c))?.id ?? null;
  const [abiertos, setAbiertos] = useState<string[]>(["activo"]);
  const elegir = (c: string) => { setSel(c); const g = grupoDe(c); if (g) setAbiertos([g]); }; // queda abierto solo el grupo de la cuenta elegida
  const actual = GRUPOS.flatMap((g) => g.cuentas).find((x) => x.c === sel);

  return (
    <div className="flex flex-col gap-4">
      {/* La agencia en 2027: propuesta del estudio frente al presupuesto */}
      <FranjaIndicadores>
        {tarjetas.map((t) => <Indicador key={t.titulo} titulo={t.titulo} valor={t.valor} pie={t.pie} color={t.color} />)}
      </FranjaIndicadores>

      <div className="flex flex-wrap items-stretch gap-4">
        <nav aria-label="Cuentas de la agencia" className="tarjeta flex flex-col gap-0.5 p-2.5 box-border" style={{ flex: "1 1 260px", maxWidth: 290 }}>
          <button type="button" onClick={() => setSel("resumen")} className="text-left rounded-lg px-3 py-2 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#005A28]/40"
            style={{ background: sel === "resumen" ? E.verdeSuave : "transparent", color: sel === "resumen" ? E.verde : E.tinta }}>Resumen de la agencia</button>
          {GRUPOS.map((g, k) => {
            const on = abiertos.includes(g.id);
            return (
              <div key={g.id} style={{ borderTop: k ? `1px solid ${E.fondo}` : undefined }}>
                <button type="button" aria-expanded={on} onClick={() => setAbiertos(on ? abiertos.filter((y) => y !== g.id) : [g.id])}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-semibold text-left outline-none focus-visible:ring-2 focus-visible:ring-[#005A28]/40 rounded-md" style={{ color: E.gris }}>
                  <ChevronDown size={14} style={{ transform: on ? undefined : "rotate(-90deg)", transition: "transform .15s" }} />
                  <span className="flex-1">{g.nombre}{!on && <span className="font-normal" style={{ color: E.tenue }}> {g.cuentas.length} cuentas</span>}</span>
                </button>
                {on && g.cuentas.map((x) => {
                  const act = sel === x.c, e = efectos[x.c];
                  return (
                    <button key={x.c} type="button" onClick={() => elegir(x.c)} className="w-full flex items-baseline gap-2.5 rounded-lg pl-8 pr-3 py-1.5 text-[13px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#005A28]/40"
                      style={{ background: act ? E.verdeSuave : "transparent", color: act ? E.verde : e !== undefined ? E.tinta : E.gris, fontWeight: act ? 600 : 400 }}>
                      <span className="w-[18px] font-bold" style={{ color: E.oro, ...NUM }}>{x.c}</span>
                      <span className="flex-1">{x.n}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="mt-auto pt-3.5 px-3 pb-1.5 flex flex-col gap-2" style={{ borderTop: `1px solid ${E.fondo}` }}>
            <div className="flex text-[12px]" style={{ color: E.gris }}><span className="flex-1">Cuentas estudiadas</span><span style={{ color: E.tinta, ...NUM }}>{Object.keys(detalles).length} de {TOTAL}</span></div>
            <div className="h-1.5 rounded-full relative" style={{ background: "#F1F3F2" }}><div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Object.keys(detalles).length / TOTAL) * 100}%`, background: E.verde }} /></div>
          </div>
        </nav>

        <main className="tarjeta flex flex-col gap-3 px-6 pt-4 pb-5 box-border" style={{ flex: "999 1 640px", minWidth: 0 }}>
          {sel === "resumen"
            ? <ResumenAgencia pres={Rp.kpi.util} real={Rr?.kpi.util ?? null} pasos={GRUPOS.flatMap((g) => g.cuentas).filter((x) => typeof efectos[x.c] === "number").map((x) => ({ label: `${x.c} ${x.n}`, codigo: x.c, nombre: x.n, v: efectos[x.c] as number }))} anioReal={anioReal}
                kpis={[{ t: "Cartera bruta", v: corto(cartReal) }, { t: "Morosidad", v: p2(moraReal), alerta: true }, { t: "Captaciones", v: corto(ultK?.total) }, { t: "Captación ÷ cartera", v: cartReal && ultK ? (ultK.total / cartReal).toFixed(2).replace(".", ",") : "—" }]} />
            : detalles[sel] ?? (
              <>
                <h2 className="m-0 text-[16px] font-semibold" style={{ color: E.tinta }}><span style={{ color: E.oro, ...NUM }}>{sel}</span> {actual?.n}</h2>
                <p className="text-[14px] m-0" style={{ color: E.gris }}>Esta cuenta todavía no tiene estudio.</p>
              </>
            )}
        </main>
      </div>

      {(msg || ultResp) && (
        <div className="flex flex-wrap items-center gap-3 px-1 text-[13px]">
          <span className="flex-1" style={{ color: msg ? (msg.ok ? E.verde : E.alerta) : E.gris }}>
            {msg?.t ?? (ultResp ? `Último cambio aplicado: ${ultResp.origen}, ${new Date(ultResp.creado).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" })}.` : "")}
          </span>
          {ultResp && <button type="button" disabled={guardando} onClick={deshacer} className="h-9 px-4 rounded-md text-[13px] font-semibold disabled:opacity-50" style={{ color: E.gris, border: `1px solid ${E.linea}`, background: "#fff" }}>Deshacer el último cambio</button>}
        </div>
      )}
    </div>
  );
}

/** Cuentas de la agencia en orden contable, agrupadas. */
const GRUPOS: { id: string; nombre: string; cuentas: { c: string; n: string }[] }[] = [
  { id: "activo", nombre: "Activo", cuentas: [{ c: "11", n: "Fondos disponibles" }, { c: "14", n: "Cartera de créditos" }, { c: "16", n: "Cuentas por cobrar" }, { c: "18", n: "Propiedades y equipo" }, { c: "19", n: "Otros activos" }] },
  { id: "pasivo", nombre: "Pasivo", cuentas: [{ c: "21", n: "Obligaciones con el público" }, { c: "25", n: "Cuentas por pagar" }, { c: "29", n: "Otros pasivos" }] },
  { id: "patrimonio", nombre: "Patrimonio", cuentas: [{ c: "31", n: "Capital social" }, { c: "33", n: "Reservas" }, { c: "36", n: "Resultados" }] },
  { id: "gastos", nombre: "Gastos", cuentas: [{ c: "41", n: "Intereses causados" }, { c: "44", n: "Provisiones" }, { c: "45", n: "Gastos de operación" }, { c: "47", n: "Otros gastos y pérdidas" }] },
  { id: "ingresos", nombre: "Ingresos", cuentas: [{ c: "51", n: "Intereses y descuentos ganados" }, { c: "52", n: "Comisiones ganadas" }, { c: "54", n: "Ingresos por servicios" }, { c: "56", n: "Otros ingresos" }] },
];
const TOTAL = GRUPOS.reduce((t, g) => t + g.cuentas.length, 0);

/** Resumen: puente de la utilidad 2027 (presupuesto → efecto de cada cuenta estudiada → ritmo real) y cifras de la agencia. */
// nombres cortos para las etiquetas del gráfico
const CORTO_CTA: Record<string, string> = {
  "11": "Fondos disponibles", "14": "Cartera", "16": "Cuentas por cobrar", "18": "Propiedades", "19": "Otros activos", "21": "Captaciones", "25": "Cuentas por pagar",
  "29": "Otros pasivos", "41": "Intereses causados", "44": "Provisiones", "45": "Gastos de operación", "47": "Otros gastos", "51": "Intereses ganados",
  "52": "Comisiones", "54": "Servicios", "56": "Otros ingresos",
};
/** Parte un texto en líneas de hasta n caracteres (sin cortar palabras), máximo 2 líneas. */
function partir(t: string, n: number): string[] {
  const out: string[] = [];
  for (const w of t.split(" ")) {
    const ult = out[out.length - 1];
    if (ult !== undefined && (ult + " " + w).length <= n) out[out.length - 1] = ult + " " + w; else out.push(w);
  }
  return out.length > 2 ? [out[0], out.slice(1).join(" ")] : out;
}

function ResumenAgencia({ pres, real, pasos, anioReal, kpis }: { pres: number; real: number | null; pasos: { label: string; codigo?: string; v: number }[]; anioReal: number; kpis: { t: string; v: string; alerta?: boolean }[] }) {
  const resto = real === null ? 0 : real - pres - pasos.reduce((a, x) => a + x.v, 0);
  const barras: { label: string; codigo?: string; ini: number; fin: number; total?: boolean }[] = [{ label: `Presupuesto ${ejercicioEnUso()}`, ini: 0, fin: pres, total: true }];
  let run = pres;
  for (const p of [...pasos, ...(Math.abs(resto) >= 1 ? [{ label: "Efecto combinado", codigo: undefined, v: resto }] : [])]) {
    barras.push({ label: p.codigo ? CORTO_CTA[p.codigo] ?? p.label : p.label, codigo: p.codigo, ini: run, fin: run + p.v }); run += p.v;
  }
  if (real !== null) barras.push({ label: `Ritmo real ${anioReal}`, ini: 0, fin: real, total: true });
  const [ref, { w: W, h: H }] = useMedida<HTMLDivElement>();
  const arr = 24, aba = 54;
  const vals = barras.flatMap((b) => [b.ini, b.fin]), mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), r = mx - mn || 1;
  const y = (v: number) => arr + (1 - (v - mn) / r) * (H - arr - aba);
  const paso = (W - 40) / barras.length, bw = Math.min(56, paso * 0.42), cx = (k: number) => 20 + paso * k + paso / 2;
  // con barras angostas, las cifras van abreviadas ($1,18 M · $52 mil) para que no se monten
  const angosto = paso < 100;
  const cifra = (v: number, total?: boolean) => (angosto ? (total || v < 0 ? corto(v) : `+${corto(v)}`) : total ? u(v) : difFmt(v));
  const chars = Math.max(6, Math.floor((paso - 6) / 6.4));
  return (
    <>
      <h2 className="m-0 text-[16px] font-semibold" style={{ color: E.tinta }}>Del presupuesto al ritmo real</h2>
      <div ref={ref} className="flex-1 min-h-[220px] relative">
      {W > 0 && H > 0 && <svg width={W} height={H} className="absolute inset-0" role="img" aria-label={barras.map((b) => `${b.label}: ${u(b.total ? b.fin : b.fin - b.ini)}`).join("; ")} style={{ display: "block", fontFamily: NUM.fontFamily }}>
        <line x1={10} x2={W - 10} y1={y(0)} y2={y(0)} stroke={E.tenue} />
        {barras.map((b, k) => {
          const d = b.fin - b.ini, top = y(Math.max(b.ini, b.fin)), alto = Math.max(2, Math.abs(y(b.ini) - y(b.fin)));
          const color = b.total ? (b.fin < 0 ? E.alerta : E.verde) : d < 0 ? E.alerta : "#2E7D4F";
          const etiqueta = cifra(b.total ? b.fin : d, b.total);
          const lineas = partir(b.label, chars);
          const ty = b.total && b.fin < 0 ? top + alto + 15 : top - 7;
          return (
            <g key={k}>
              {k > 0 && <line x1={cx(k - 1) + bw / 2} x2={cx(k) - bw / 2} y1={y(b.ini)} y2={y(b.ini)} stroke="#B9C3BD" strokeDasharray="3 4" />}
              <rect x={cx(k) - bw / 2} y={top} width={bw} height={alto} rx={4} fill={color} />
              <text x={cx(k)} y={ty} fontSize={angosto ? 11.5 : 12.5} fontWeight={700} fill={b.total ? (b.fin < 0 ? E.alerta : E.tinta) : d < 0 ? E.alerta : "#1F7A45"} textAnchor="middle">{etiqueta}</text>
              <text x={cx(k)} y={H - aba + 16} fontSize={11.5} textAnchor="middle" style={{ fontFamily: "'Segoe UI', sans-serif" }}>
                {b.codigo && <tspan x={cx(k)} fontWeight={700} fill={E.oro}>{b.codigo}</tspan>}
                {lineas.map((l, i) => <tspan key={i} x={cx(k)} dy={i === 0 && !b.codigo ? 0 : 14} fill={b.total ? E.tinta : E.gris} fontWeight={b.total ? 600 : 400}>{l}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>}
      </div>
      <div className="grid gap-5 rounded-[10px] px-5 py-3 mt-auto" style={{ background: E.fondo, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {kpis.map((k) => (
          <div key={k.t}><div className="text-[12px]" style={{ color: E.gris }}>{k.t}</div><div className="text-[16px] font-bold" style={{ color: k.alerta ? E.alerta : E.tinta, ...NUM }}>{k.v}</div></div>
        ))}
      </div>
    </>
  );
}
