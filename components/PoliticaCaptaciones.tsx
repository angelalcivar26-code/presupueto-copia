"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/useDatos";
import { C, Tarjeta, usd, pct, leerNumero } from "./ActivosComun";
import { Formula } from "./ProvisionFlowParametros";
import { EsqueletoTabla } from "./Carga";
import { calcularCaptaciones } from "../lib/calc/captaciones";
import type { FilaParametroCaptaciones } from "../lib/calc/orquestador";
import { aplicarPolitica, tasaDPFMes, validarPolitica, type PoliticaCaptaciones } from "../lib/calc/politica-captaciones";

/**
 * OBLIGACIONES CON EL PÚBLICO → Política: una regla para las 10 agencias (crecimiento, tasas, vencimientos de DPF).
 * Muestra lo real de cada agencia, el presupuesto guardado y cómo queda con la política; "Aplicar" reemplaza los
 * parámetros de captaciones de todas las agencias en una sola escritura.
 */
interface Agencia { agencia: string; corte: { anio: number; mes: number }; saldos: { vista: number; crecer: number; dpf: number; a30: number }; venc: number; filas: FilaParametroCaptaciones[] }
interface Estado { politica: PoliticaCaptaciones; guardada: boolean; agencias: Agencia[] }
interface Real { gDPF: number | null; gAh: number | null; costoDPF: number | null; desde: string; hasta: string; dpf0: number; dpf1: number; ah0: number; ah1: number; int3: number; saldo3: number;
  /** Costo de ahorro a la vista (41011505) y de Crecer (41011535) en los mismos meses; null sin cuentas de 8 dígitos. */
  costoV: number | null; costoC: number | null; iV: number; sV: number; iC: number; sC: number }
interface Proy { dpf: number; ahorro: number; total: number; intDPF: number; intAh: number }

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nomMes = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]}-${p.slice(2, 4)}`;
const anterior = (p: string, n = 1) => { const i = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 - n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; };
const signo = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v), 1)}`);
const a12 = (fs: FilaParametroCaptaciones[], p: string, k: keyof FilaParametroCaptaciones) =>
  Array.from({ length: 12 }, (_, i) => Number(fs.find((f) => f.producto === p && f.mes === i + 1)?.[k]) || 0);

/** El mismo motor del presupuesto (lib/calc/captaciones.ts); el interés de DPF como en el Estado de resultados. */
function proyectar(a: Agencia, fs: FilaParametroCaptaciones[]): Proy {
  const r = calcularCaptaciones({
    saldoInicialVista: a.saldos.vista, paramsVista: { tasaInteresAnual: a12(fs, "VISTA", "tasa_interes_anual"), pctIngresosPeriodo: a12(fs, "VISTA", "pct_ingresos"), pctRetirosPeriodo: a12(fs, "VISTA", "pct_retiros") },
    saldoInicialCrecer: a.saldos.crecer, paramsCrecer: { tasaInteresAnual: a12(fs, "CRECER", "tasa_interes_anual"), pctIngresosPeriodo: a12(fs, "CRECER", "pct_ingresos"), pctRetirosPeriodo: a12(fs, "CRECER", "pct_retiros") },
    saldoInicialDPF: a.saldos.dpf, paramsDPF: { pctCancelaciones: a12(fs, "DPF", "pct_cancelaciones"), ratioRenovaciones: a12(fs, "DPF", "ratio_renovaciones") },
  });
  const tD = a12(fs, "DPF", "tasa_interes_anual");
  const intDPF = r.dpf.reduce((t, m, i) => t + (m.saldoInicial + m.saldoFinal) / 2 * tD[i] / 12, 0);
  const cap = (xs: typeof r.vista) => xs.reduce((t, m) => t + Number((m.detalle as Record<string, number>).capitalizacionInteres ?? 0), 0);
  const dpf = r.dpf[11].saldoFinal, ahorro = r.vista[11].saldoFinal + r.crecer[11].saldoFinal;
  return { dpf, ahorro, total: dpf + ahorro, intDPF, intAh: cap(r.vista) + cap(r.crecer) };
}

/** Lo real de la agencia: crecimiento de 12 meses al último balance y costo de DPF de los últimos 3 meses. */
function realDe(h: { bal: Record<string, Record<string, number>>; er: Record<string, Record<string, number>> } | null): Real | null {
  if (!h) return null;
  // último mes con balance y estado de resultados
  const ps = Object.keys(h.bal).filter((p) => (h.bal[p]["2103"] ?? 0) > 0 && typeof h.er[p]?.["410130"] === "number").sort();
  const u = ps[ps.length - 1];
  if (!u) return null;
  const ah = (b: Record<string, number> | undefined) => (b ? b["210135"] ?? b["2101"] ?? 0 : 0);
  const b1 = h.bal[u], b0 = h.bal[anterior(u, 12)];
  let i = 0, d = 0, iV = 0, sV = 0, iC = 0, sC = 0;
  const VISTA = ["21013505", "21013510", "21013535"];
  const vista = (b: Record<string, number> | undefined) => (b ? VISTA.reduce((t, k) => t + (b[k] ?? 0), 0) : 0);
  const tiene = (x: string, c: string) => typeof h.er[x]?.[c] === "number";
  const delMes = (p: string, c: string) => { const a = Number(h.er[p]?.[c] ?? 0); return p.endsWith("-01") ? a : a - Number(h.er[anterior(p)]?.[c] ?? 0); };
  for (let k = 0; k < 3; k++) {
    const p = anterior(u, k), p0 = anterior(p);
    const saldo = ((h.bal[p]?.["2103"] ?? 0) + (h.bal[p0]?.["2103"] ?? 0)) / 2;
    // el interés del mes sale del acumulado: hace falta el mes anterior (salvo enero)
    if (tiene(p, "410130") && (p.endsWith("-01") || tiene(p0, "410130")) && saldo > 0) { i += Math.abs(delMes(p, "410130")); d += saldo; }
    // ahorro a la vista y Crecer: solo con las cuentas de 8 dígitos en el ER y en los dos balances
    const conV = h.bal[p]?.["21013505"] !== undefined && h.bal[p0]?.["21013505"] !== undefined;
    if (conV && tiene(p, "41011505") && (p.endsWith("-01") || tiene(p0, "41011505"))) { iV += Math.abs(delMes(p, "41011505")); sV += (vista(h.bal[p]) + vista(h.bal[p0])) / 2; }
    const conC = h.bal[p]?.["21013515"] !== undefined && h.bal[p0]?.["21013515"] !== undefined;
    if (conC && tiene(p, "41011535") && (p.endsWith("-01") || tiene(p0, "41011535"))) { iC += Math.abs(delMes(p, "41011535")); sC += ((h.bal[p]?.["21013515"] ?? 0) + (h.bal[p0]?.["21013515"] ?? 0)) / 2; }
  }
  return {
    gDPF: b0?.["2103"] ? b1["2103"] / b0["2103"] - 1 : null, gAh: ah(b0) ? ah(b1) / ah(b0) - 1 : null,
    costoDPF: d > 0 ? i * 12 / d : null, desde: anterior(u, 12), hasta: u,
    dpf0: b0?.["2103"] ?? 0, dpf1: b1["2103"] ?? 0, ah0: ah(b0), ah1: ah(b1), int3: i, saldo3: d,
    costoV: sV > 1000 ? iV * 12 / sV : null, costoC: sC > 1000 ? iC * 12 / sC : null, iV, sV, iC, sC,
  };
}

const costos = (v: number | null, c: number | null, d: number | null) => [v, c, d].map((x) => (x === null ? "—" : pct(x))).join(" · ");

function Campo({ label, valor, onCambio, vacio, info }: { label: string; valor: number | null; onCambio: (v: number | null) => void; vacio?: string; info: string }) {
  const [t, setT] = useState(valor === null ? "" : (valor * 100).toFixed(2).replace(".", ","));
  return (
    <label className="flex flex-col gap-1 text-[12px]" style={{ color: C.texto2 }}>
      <span className="inline-flex items-center gap-1">{label}<Formula info>{info}</Formula></span>
      <span className="inline-flex items-center gap-1">
        <input value={t} placeholder={vacio} onChange={(e) => setT(e.target.value)} aria-label={label}
          onBlur={() => { if (!t.trim() && vacio) { onCambio(null); return; } const n = leerNumero(t); if (n !== null) onCambio(n / 100); }}
          className="h-8 w-[110px] rounded-md px-2 text-right text-[13px] bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }} />
        <span>%</span>
      </span>
    </label>
  );
}

export function PoliticaCaptaciones({ onAplicado }: { onAplicado: () => void }) {
  const [d, setD] = useState<Estado | null>(null);
  const [reales, setReales] = useState<Record<string, Real | null>>({});
  const [p, setP] = useState<PoliticaCaptaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [version, setVersion] = useState(0);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    apiFetch("/api/politica-captaciones").then((r) => r.json()).then(async (j: Estado & { error?: string }) => {
      if (n !== pedido.current) return;
      if (j.error) { setError(j.error); return; }
      setD(j); setP(j.politica);
      const hs = await Promise.all(j.agencias.map((a) => apiFetch(`/api/estudio-agencia?agencia=${encodeURIComponent(a.agencia)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      if (n === pedido.current) setReales(Object.fromEntries(j.agencias.map((a, i) => [a.agencia, realDe(hs[i])])));
    }).catch(() => n === pedido.current && setError("Error de conexión."));
  }, [version]);

  if (error) return <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>;
  if (!d || !p) return <EsqueletoTabla filas={10} />;
  const errorP = validarPolitica(p);
  const filas = d.agencias.map((a) => {
    const antes = proyectar(a, a.filas), con = proyectar(a, aplicarPolitica(a.filas, p, a.venc));
    const ini = a.saldos.dpf + a.saldos.vista + a.saldos.crecer;
    return { a, ini, antes, con, real: reales[a.agencia] ?? null };
  });
  const S = (f: (x: (typeof filas)[number]) => number) => filas.reduce((t, x) => t + f(x), 0);
  const coop = { ini: S((x) => x.ini), dpf0: S((x) => x.a.saldos.dpf), antes: S((x) => x.antes.total), con: S((x) => x.con.total), intAntes: S((x) => x.antes.intDPF + x.antes.intAh), intCon: S((x) => x.con.intDPF + x.con.intAh) };
  const corte = d.agencias[0]?.corte;
  const corteTxt = corte ? `${MES[corte.mes - 1]}-${String(corte.anio).slice(2)}` : "corte";
  const r0 = Object.values(reales).find((r) => r);
  const realTxt = r0 ? `${nomMes(r0.desde)} a ${nomMes(r0.hasta)}` : "12 meses";
  // real de la cooperativa: cocientes de las sumas de las agencias
  const rs = Object.values(reales).filter((r): r is Real => !!r);
  const R = (f: (r: Real) => number) => rs.reduce((t, r) => t + f(r), 0);
  const realCoop = { gDPF: R((r) => r.dpf0) ? R((r) => r.dpf1) / R((r) => r.dpf0) - 1 : null, gAh: R((r) => r.ah0) ? R((r) => r.ah1) / R((r) => r.ah0) - 1 : null,
    costo: R((r) => r.saldo3) ? R((r) => r.int3) * 12 / R((r) => r.saldo3) : null,
    costoV: R((r) => r.sV) > 1000 ? R((r) => r.iV) * 12 / R((r) => r.sV) : null, costoC: R((r) => r.sC) > 1000 ? R((r) => r.iC) * 12 / R((r) => r.sC) : null };
  const set = (k: keyof PoliticaCaptaciones) => (v: number | null) => setP({ ...p, [k]: v } as PoliticaCaptaciones);

  async function aplicar() {
    setGuardando(true); setMsg(null);
    try {
      const r = await apiFetch("/api/politica-captaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "aplicar", politica: p }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      setMsg({ t: "Política aplicada a las 10 agencias. Balance, Estado de resultados y Flujo ya usan los nuevos parámetros." });
      setConfirmar(false); setVersion((v) => v + 1); onAplicado();
    } catch (e) {
      setMsg({ t: `No se pudo aplicar: ${e instanceof Error ? e.message : "error"}`, e: true });
    } finally { setGuardando(false); }
  }

  const TH = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const TD = "px-3 py-1.5 text-right tabla-cifras whitespace-nowrap";
  return (
    <div className="flex flex-col gap-5">
      <Tarjeta titulo={<span className="inline-flex items-center gap-1">Política de captaciones<Formula info>
        Una sola regla para las 10 agencias. DPF: cada mes vence la parte del saldo que el balance tiene a 1–30 días; de lo que vence se renueva lo necesario para crecer el % anual (renovación = 1 + crecimiento mensual ÷ vencimiento). La tasa sube de forma gradual de enero a diciembre. Ahorro a la vista y Crecer: se conservan los retiros reales y los depósitos se fijan para crecer el % anual (depósitos = (1 + crecimiento mensual) ÷ (1 + tasa ÷ 12) − 1 + retiros). Aplicar reemplaza los parámetros de las 10 agencias; cada agencia se puede ajustar después en su producto.
      </Formula></span>} sub={d.guardada ? "Guardada" : "Sin aplicar todavía"}
        derecha={confirmar ? (
          <span className="inline-flex gap-2">
            <button type="button" onClick={() => setConfirmar(false)} className="h-8 px-3 rounded-md text-[12px]" style={{ border: `1px solid ${C.borde}` }}>Cancelar</button>
            <button type="button" onClick={aplicar} disabled={guardando} className="h-8 px-3 rounded-md text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: C.acento }}>{guardando ? "Aplicando…" : "Confirmar"}</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} disabled={!!errorP} className="h-8 px-3 rounded-md text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: C.acento }}>Aplicar a las 10 agencias</button>
        )}>
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-wrap gap-6">
            <Campo label="DPF: crecimiento anual" valor={p.crecDPF} onCambio={set("crecDPF")} info="Cuánto crece el saldo de DPF de diciembre a diciembre." />
            <Campo label="Ahorro a la vista: crecimiento anual" valor={p.crecVista} onCambio={set("crecVista")} info="Cuánto crece el saldo de ahorro a la vista en el año." />
            <Campo label="Crecer: crecimiento anual" valor={p.crecCrecer} onCambio={set("crecCrecer")} info="Cuánto crece el saldo de Crecer en el año." />
          </div>
          <div className="flex flex-wrap gap-6">
            <Campo label="Tasa DPF en enero" valor={p.tasaDPFIni} onCambio={set("tasaDPFIni")} info="Tasa anual con la que se causa el interés de DPF en enero." />
            <Campo label="Tasa DPF en diciembre" valor={p.tasaDPFFin} onCambio={set("tasaDPFFin")} info="La tasa sube de forma pareja cada mes hasta este valor (si es igual a la de enero, queda fija)." />
            <Campo label="Tasa ahorro a la vista" valor={p.tasaVista} vacio="la de cada agencia" onCambio={set("tasaVista")} info="Vacío: se mantiene la tasa de cada agencia." />
            <Campo label="Tasa Crecer" valor={p.tasaCrecer} vacio="la de cada agencia" onCambio={set("tasaCrecer")} info="Vacío: se mantiene la tasa de cada agencia." />
            <Campo label="DPF que vence al mes" valor={p.vencDPF} vacio="del balance" onCambio={set("vencDPF")} info="Vacío: lo de cada agencia a 1–30 días en el balance del corte (210305 ÷ 2103)." />
          </div>
          {errorP && <p className="text-[12px]" style={{ color: C.alerta }}>{errorP}</p>}
          {msg && <p className="text-[12px]" style={{ color: msg.e ? C.alerta : C.ok }}>{msg.t}</p>}
          <p className="text-[12px]" style={{ color: C.texto2 }}>
            Tasa DPF por mes: {Array.from({ length: 12 }, (_, i) => `${MES[i]} ${pct(tasaDPFMes(p, i + 1))}`).join(" · ")}
          </p>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Real frente al presupuesto" sub={`Saldos al ${corteTxt}; real de ${realTxt}`}>
        <div className="overflow-x-auto">
          <table className="text-[12px] min-w-full">
            <thead><tr style={{ color: C.tenue }}>
              <th className="px-3 py-2 text-left font-medium">Agencia</th>
              <th className={TH}>Captaciones {corteTxt}</th>
              <th className={TH}>Real DPF 12 m</th><th className={TH}>Real ahorro 12 m</th>
              <th className={TH}>Crecimiento 2027: guardado → política</th>
              <th className={TH}>Vence DPF al mes</th>
              <th className={TH}>Costo real 3 m: vista · Crecer · DPF</th>
              <th className={TH}>Intereses 2027: guardado → política</th>
            </tr></thead>
            <tbody>
              {filas.map((x) => (
                <tr key={x.a.agencia} style={{ borderTop: `1px solid ${C.borde}` }}>
                  <td className="px-3 py-1.5">{x.a.agencia}</td>
                  <td className={TD}>{usd(x.ini)}</td>
                  <td className={TD}>{signo(x.real?.gDPF ?? null)}</td>
                  <td className={TD}>{signo(x.real?.gAh ?? null)}</td>
                  <td className={TD}>{signo(x.antes.total / x.ini - 1)} → <b>{signo(x.con.total / x.ini - 1)}</b></td>
                  <td className={TD}>{pct(p.vencDPF ?? x.a.venc, 1)}</td>
                  <td className={TD}>{costos(x.real?.costoV ?? null, x.real?.costoC ?? null, x.real?.costoDPF ?? null)}</td>
                  <td className={TD}>{usd(x.antes.intDPF + x.antes.intAh)} → <b>{usd(x.con.intDPF + x.con.intAh)}</b></td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${C.borde}`, fontWeight: 600 }}>
                <td className="px-3 py-1.5">Cooperativa</td>
                <td className={TD}>{usd(coop.ini)}</td>
                <td className={TD}>{signo(realCoop.gDPF)}</td><td className={TD}>{signo(realCoop.gAh)}</td>
                <td className={TD}>{signo(coop.antes / coop.ini - 1)} → {signo(coop.con / coop.ini - 1)}</td>
                <td className={TD} /><td className={TD}>{costos(realCoop.costoV, realCoop.costoC, realCoop.costo)}</td>
                <td className={TD}>{usd(coop.intAntes)} → {usd(coop.intCon)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-[12px]" style={{ color: C.texto2 }}>
          Con la política, los intereses de captaciones de 2027 cambian {usd(coop.intCon - coop.intAntes)} frente al presupuesto guardado.
        </p>
      </Tarjeta>
    </div>
  );
}
