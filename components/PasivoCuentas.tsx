"use client";

import AnioEjercicio from "./AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../lib/seleccion";
import { useState } from "react";
import { apiFetch, useDatos } from "../lib/useDatos";
import { Actualizando, EsqueletoTabla } from "./Carga";
import { AvisoConsolidado } from "./AvisoConsolidado";
import { ResumenPorAgencia, BotonesVista } from "./PorAgencia";
import {
  MESES, AGENCIAS as AGENCIAS_BASE, C, FONDO, suma, usd, etiquetaCorte, leerNumero,
  Indicador, FranjaIndicadores, Tarjeta, TablaMeses, Parametros, type DefFila, type Fuente,
} from "./ActivosComun";

/**
 * Pasivos fuera de las captaciones, una página por grupo (mismo estilo que Otros activos):
 *  - 25 Cuentas por pagar: saldo ± incrementos y pagos del mes (editables por agencia).
 *  - 26 Obligaciones financieras: créditos externos (hoy sin crédito vigente).
 *  - 29 Otros pasivos: 2908 transferencias internas recibidas (editables) + 2990 otros (constante).
 * Todas leen /api/pasivo-detalle, el mismo cálculo que llega al Balance y al Flujo.
 */
const AGENCIAS = [...AGENCIAS_BASE, "Consolidado"];
interface Rollforward { mes: number; saldoInicio: number; entradas: number; salidas: number; saldoFin: number; polizasAlta?: number; polizasPago?: number }
type Concepto = "cuentas_por_pagar_incrementos" | "cuentas_por_pagar_pagos" | "transferencias_2908_incrementos" | "transferencias_2908_disminuciones";
interface Datos {
  cuentasPorPagar25: Rollforward[]; creditosExternos26: Rollforward[]; transferencias2908: Rollforward[]; otros2990: number;
  corte?: { anio: number; mes: number };
  subcuentas?: { codigo: string; nombre: string; saldo: number }[];
  fuentes?: Partial<Record<Concepto, Fuente>>;
  error?: string;
}
type GrupoPasivo = "25" | "26" | "29";
interface DefParam { concepto: Concepto; label: string }

const CONFIG: Record<GrupoPasivo, { titulo: string; entra: string; sale: string; params: DefParam[] }> = {
  "25": { titulo: "Cuentas por pagar", entra: "(+) Incrementos", sale: "(−) Pagos", params: [
    { concepto: "cuentas_por_pagar_incrementos", label: "(+) Incrementos del mes" },
    { concepto: "cuentas_por_pagar_pagos", label: "(−) Pagos del mes" },
  ] },
  "26": { titulo: "Obligaciones financieras", entra: "(+) Nuevos créditos", sale: "(−) Pagos de capital", params: [] },
  "29": { titulo: "Otros pasivos", entra: "(+) Fondos recibidos de otras agencias", sale: "(−) Devoluciones", params: [
    { concepto: "transferencias_2908_incrementos", label: "(+) Fondos recibidos de otras agencias" },
    { concepto: "transferencias_2908_disminuciones", label: "(−) Devoluciones" },
  ] },
};

const rfDe = (d: Datos, g: GrupoPasivo) => (g === "25" ? d.cuentasPorPagar25 : g === "26" ? d.creditosExternos26 : d.transferencias2908);
const saldos29 = (d: Datos) => d.transferencias2908.map((f) => f.saldoFin + (d.otros2990 ?? 0));
const saldosDe = (d: Datos, g: GrupoPasivo) => (g === "29" ? saldos29(d) : rfDe(d, g).map((f) => f.saldoFin));
const corteDe = (d: Datos, g: GrupoPasivo) => (g === "29" ? d.transferencias2908[0].saldoInicio + (d.otros2990 ?? 0) : rfDe(d, g)[0].saldoInicio);

function valoresActuales(d: Datos, c: Concepto): number[] {
  switch (c) {
    case "cuentas_por_pagar_incrementos": return d.cuentasPorPagar25.map((f) => f.entradas);
    case "cuentas_por_pagar_pagos": return d.cuentasPorPagar25.map((f) => f.salidas);
    case "transferencias_2908_incrementos": return d.transferencias2908.map((f) => f.entradas);
    case "transferencias_2908_disminuciones": return d.transferencias2908.map((f) => f.salidas);
  }
}

export function PaginaPasivo({ grupo }: { grupo: GrupoPasivo }) {
  const cfg = CONFIG[grupo];
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [version, setVersion] = useState(0);
  const [sub, setSub] = useState<"resumen" | "2908" | "2990">("resumen");
  const urlDe = (a: string) => `/api/pasivo-detalle?agencia=${encodeURIComponent(a)}`;
  const url = urlDe(agencia);
  const consolidado = agencia === "Consolidado";
  const { datos: d, cargando, actualizando, error } = useDatos<Datos>(url, version, (x) => (x.cuentasPorPagar25 ? null : x.error ?? "No se pudo calcular."));

  // edición de los movimientos del mes (una sección a la vez)
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Partial<Record<Concepto, number[]>>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; e?: boolean } | null>(null);
  const params = cfg.params;
  const cambios = d ? params.reduce((n, p) => { const b = borrador[p.concepto]; if (!b) return n; const o = valoresActuales(d, p.concepto); return n + b.filter((v, i) => Math.abs(v - o[i]) > 1e-9).length; }, 0) : 0;
  const salir = () => { if (editando && cambios > 0 && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardar?")) return false; setEditando(false); setBorrador({}); setTextos({}); return true; };
  async function guardar() {
    if (!d) return;
    setGuardando(true); setMsg(null);
    try {
      for (const p of params) {
        const b = borrador[p.concepto]; if (!b) continue;
        const o = valoresActuales(d, p.concepto);
        if (!b.some((v, i) => Math.abs(v - o[i]) > 1e-9)) continue;
        const r = await apiFetch("/api/otros-pasivo-parametros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencia, concepto: p.concepto, montosPorMes: b }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error ?? `error ${r.status}`);
      }
      setEditando(false); setBorrador({}); setTextos({});
      setMsg({ t: "Guardado. Balance y Flujo ya usan los nuevos valores." });
      setVersion((v) => v + 1);
    } catch (e) { setMsg({ t: `No se pudo guardar: ${e instanceof Error ? e.message : "error"}`, e: true }); }
    finally { setGuardando(false); }
  }

  const corte = d?.corte ? etiquetaCorte(d.corte) : "el corte";
  const conParams = !consolidado && params.length > 0 && (grupo !== "29" || sub === "2908");

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">{cfg.titulo}<AnioEjercicio /></h1>
        <Actualizando visible={actualizando} />
        <label className="flex items-center gap-2 text-[13px]" style={{ color: C.texto2 }}>
          Agencia
          <select value={agencia} onChange={(e) => { if (salir()) { setAgencia(e.target.value); setMsg(null); } }}
                  className="h-9 min-w-[153px] px-2.5 text-[13px] rounded-md bg-white" style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <AvisoConsolidado url={url} agencia={agencia} />

      {cargando ? <EsqueletoTabla filas={6} /> : error || !d ? <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p> : <>
        <Indicadores d={d} grupo={grupo} corte={corte} />

        {grupo === "29" && (
          <div role="tablist" aria-label="Cuentas de otros pasivos" className="self-start">
            <BotonesVista etiqueta="Cuentas de otros pasivos" valor={sub} onChange={(v) => { if (salir()) setSub(v); }}
              opciones={[{ id: "resumen", label: "Resumen" }, { id: "2908", label: "Transferencias internas" }, { id: "2990", label: "Otros" }]} />
          </div>
        )}

        {conParams && (
          <Parametros titulo="Movimientos del mes" params={params}
            valores={(c) => (editando && borrador[c] ? borrador[c]! : valoresActuales(d, c))}
            fuente={(c) => d.fuentes?.[c] ?? null}
            editando={editando} cambios={cambios} guardando={guardando} textos={textos} msg={msg}
            onEditar={() => { setBorrador(Object.fromEntries(params.map((p) => [p.concepto, [...valoresActuales(d, p.concepto)]]))); setTextos({}); setEditando(true); setMsg(null); }}
            onCancelar={() => { setEditando(false); setBorrador({}); setTextos({}); }} onGuardar={guardar}
            onEscribir={(p, mes, texto) => { setTextos((t) => ({ ...t, [`${p.concepto}-${mes}`]: texto })); const v = leerNumero(texto); if (v === null) return; setBorrador((b) => ({ ...b, [p.concepto]: (b[p.concepto] ?? Array(12).fill(0)).map((x, i) => (i === mes ? v : x)) })); }}
            onSoltar={(k) => setTextos((t) => { const n = { ...t }; delete n[k]; return n; })}
            onCopiarEnero={(p) => { setBorrador((b) => { const a = b[p.concepto] ?? Array(12).fill(0); return { ...b, [p.concepto]: a.map(() => a[0]) }; }); setTextos((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith(`${p.concepto}-`)))); }}
          />
        )}

        <Movimiento d={d} grupo={grupo} sub={sub} corte={corte} consolidado={consolidado} urlDe={urlDe} onElegir={setSub} />
        {(grupo !== "29" || sub === "resumen") && <Composicion d={d} grupo={grupo} corte={corte} />}
      </>}
    </div>
  );
}

function Indicadores({ d, grupo, corte }: { d: Datos; grupo: GrupoPasivo; corte: string }) {
  const s = saldosDe(d, grupo), ini = corteDe(d, grupo), fin = s[11], rf = rfDe(d, grupo);
  const ent = suma(rf.map((f) => f.entradas + (f.polizasAlta ?? 0))), sal = suma(rf.map((f) => f.salidas + (f.polizasPago ?? 0)));
  return (
    <FranjaIndicadores>
      <Indicador titulo={`${grupo} a dic-27`} valor={usd(fin)} pie={`${fin >= ini ? "Sube" : "Baja"} ${usd(Math.abs(fin - ini))} desde ${corte}`} />
      <Indicador titulo={`Saldo a ${corte}`} valor={usd(ini)} pie="Balance de partida" />
      <Indicador titulo={grupo === "29" ? `Fondos recibidos ${ejercicioEnUso()}` : grupo === "26" ? `Nuevos créditos ${ejercicioEnUso()}` : `Incrementos ${ejercicioEnUso()}`} valor={usd(ent)} pie={grupo === "29" ? "Transferencias internas (2908)" : `Promedio mensual ${usd(ent / 12)}`} />
      <Indicador titulo={grupo === "29" ? `Devoluciones ${ejercicioEnUso()}` : grupo === "26" ? `Pagos de capital ${ejercicioEnUso()}` : `Pagos ${ejercicioEnUso()}`} valor={usd(sal)} pie={grupo === "25" ? "Salen de fondos disponibles" : grupo === "29" ? "Transferencias internas (2908)" : "Salen de fondos disponibles"} />
    </FranjaIndicadores>
  );
}

function Movimiento({ d, grupo, sub, corte, consolidado, urlDe, onElegir }: {
  d: Datos; grupo: GrupoPasivo; sub: "resumen" | "2908" | "2990"; corte: string; consolidado: boolean; urlDe: (a: string) => string; onElegir: (s: "2908" | "2990") => void;
}) {
  const [vista, setVista] = useState<"meses" | "agencias">("meses");
  const cfg = CONFIG[grupo];
  const derecha = consolidado ? <BotonesVista etiqueta="Vista" valor={vista} onChange={setVista} opciones={[{ id: "meses", label: "Por mes" }, { id: "agencias", label: "Por agencia" }]} /> : undefined;

  if (consolidado && vista === "agencias") {
    return (
      <Tarjeta titulo={`Saldos por agencia · ${grupo}`} derecha={derecha}>
        <ResumenPorAgencia<Datos> url={urlDe} conceptos={grupo === "29" ? [
          { id: "29", label: "Total 29", valores: (x) => saldos29(x) },
          { id: "2908", label: "2908", valores: (x) => x.transferencias2908.map((f) => f.saldoFin) },
          { id: "2990", label: "2990", valores: (x) => x.transferencias2908.map(() => x.otros2990 ?? 0) },
        ] : [{ id: grupo, label: grupo, valores: (x) => saldosDe(x, grupo) }]} />
      </Tarjeta>
    );
  }

  if (grupo === "29" && sub === "resumen") {
    const t = d.transferencias2908.map((f) => f.saldoFin), o = t.map(() => d.otros2990 ?? 0), tot = saldos29(d);
    const t0 = d.transferencias2908[0].saldoInicio, o0 = d.otros2990 ?? 0;
    const filas: DefFila[] = [
      { id: "2908", label: "2908 · Transferencias internas recibidas", valores: t, total: t[11] - t0, totalConSigno: true, onClick: () => onElegir("2908"),
        formula: (i) => `Saldo final de Transferencias internas: ${usd(t[i])}.` },
      { id: "2990", label: "2990 · Otros", valores: o, total: 0, totalConSigno: true, onClick: () => onElegir("2990"),
        formula: () => `Sin movimiento en el año: se mantiene en el saldo del balance a ${corte} = ${usd(o0)}.` },
      { id: "29", label: "Total otros pasivos · 29", valores: tot, total: tot[11] - (t0 + o0), clave: true, totalConSigno: true,
        formula: (i) => `2908 + 2990 = ${usd(t[i])} + ${usd(o[i])} = ${usd(tot[i])}. Llega al Balance como grupo 29.` },
    ];
    return <Tarjeta titulo="Otros pasivos (29)" derecha={derecha}><TablaMeses titulo="Cuenta" ultima="Var. año" filas={filas} /></Tarjeta>;
  }

  if (grupo === "29" && sub === "2990") {
    const v = d.otros2990 ?? 0, arr = MESES.map(() => v);
    return (
      <Tarjeta titulo="Otros (2990)" derecha={derecha}>
        <TablaMeses titulo="Otros" ultima="Año / Dic" filas={[
          { id: "si", label: "Saldo inicial", valores: arr, total: v, formula: () => `Saldo del balance a ${corte}: ${usd(v)}.` },
          { id: "sf", label: "Saldo final", valores: arr, total: v, clave: true, formula: () => `Sin movimiento en el año: se mantiene en ${usd(v)}.` },
        ]} />
      </Tarjeta>
    );
  }

  const rf = rfDe(d, grupo);
  const si = rf.map((f) => f.saldoInicio), ent = rf.map((f) => f.entradas), sal = rf.map((f) => f.salidas);
  // pólizas pagadas en cuotas (Otros activos → Gastos anticipados): lo que queda por pagar y las cuotas pagadas
  const pa = rf.map((f) => f.polizasAlta ?? 0), pp = rf.map((f) => f.polizasPago ?? 0);
  const conPolizas = grupo === "25" && pa.some((v) => Math.abs(v) > 0.5);
  const nombre = grupo === "29" ? "Transferencias internas recibidas (2908)" : `${cfg.titulo} (${grupo})`;
  const filas: DefFila[] = [
    { id: "si", label: "Saldo inicial", valores: si, total: si[0], formula: (i) => (i === 0 ? `Saldo del balance a ${corte}: ${usd(si[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
    { id: "en", label: cfg.entra, valores: ent, total: suma(ent), color: "ok", formula: (i) => `${cfg.entra.replace(/^\(\+\) /, "")} de ${MESES[i]}: ${usd(ent[i])}.` },
    { id: "sa", label: cfg.sale, valores: sal.map((v) => -v), total: -suma(sal), color: "alerta", formula: (i) => `${cfg.sale.replace(/^\(−\) /, "")} de ${MESES[i]}: ${usd(sal[i])}.` },
    ...(conPolizas ? [
      { id: "pa", label: "(+) Pólizas por pagar en cuotas", valores: pa, total: suma(pa), color: "ok" as const,
        formula: (i: number) => `Pólizas que empiezan en ${MESES[i]} y se pagan en cuotas: el valor menos la cuota inicial queda por pagar a la aseguradora (${usd(pa[i])}). Sale del registro de Otros activos → Gastos anticipados.` },
      { id: "pp", label: "(−) Cuotas de pólizas pagadas", valores: pp.map((v) => -v), total: -suma(pp), color: "alerta" as const,
        formula: (i: number) => `Cuotas de pólizas que se pagan en ${MESES[i]}: ${usd(pp[i])}. Salen de fondos disponibles.` },
    ] : []),
    { id: "sf", label: "Saldo final", valores: rf.map((f) => f.saldoFin), total: rf[11].saldoFin, clave: true,
      formula: (i) => `Saldo inicial + ${cfg.entra.replace(/^\(\+\) /, "").toLowerCase()} − ${cfg.sale.replace(/^\(−\) /, "").toLowerCase()}${conPolizas ? " + pólizas por pagar − cuotas pagadas" : ""} = ${usd(si[i])} + ${usd(ent[i])} − ${usd(sal[i])}${conPolizas ? ` + ${usd(pa[i])} − ${usd(pp[i])}` : ""} = ${usd(rf[i].saldoFin)}. Llega al Balance (${grupo === "29" ? "2908" : grupo}).` },
  ];
  return <Tarjeta titulo={nombre} derecha={derecha}><TablaMeses titulo="Movimiento" ultima="Año / Dic" filas={filas} /></Tarjeta>;
}

/** Composición del grupo en el balance de partida (subcuentas de 4 dígitos). */
function Composicion({ d, grupo, corte }: { d: Datos; grupo: GrupoPasivo; corte: string }) {
  const filas = (d.subcuentas ?? []).filter((s) => s.codigo.startsWith(grupo));
  if (!filas.length) return null;
  const total = suma(filas.map((s) => s.saldo));
  return (
    <Tarjeta titulo={`Composición a ${corte}`}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr style={{ color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 }}>
            <th className="pl-4 text-left font-semibold">Cuenta</th><th className="px-4 text-right font-semibold">Saldo</th><th className="pr-4 text-right font-semibold w-[96px]">Peso</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((s) => (
            <tr key={s.codigo} style={{ borderTop: `1px solid ${C.beige}`, height: 32 }}>
              <td className="pl-4"><span style={{ color: C.tenue }}>{s.codigo}</span> <span style={{ color: C.texto3 }}>{limpiar(s.nombre)}</span></td>
              <td className="px-4 text-right">{usd(s.saldo)}</td>
              <td className="pr-4 text-right" style={{ color: C.texto2 }}>{total ? `${(s.saldo / total * 100).toFixed(1).replace(".", ",")} %` : "—"}</td>
            </tr>
          ))}
          <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 34 }}>
            <td className="pl-4">Total {grupo}</td><td className="px-4 text-right">{usd(total)}</td><td className="pr-4 text-right">100 %</td>
          </tr>
        </tbody>
      </table>
    </Tarjeta>
  );
}

/** "OBLIGACIONES PATRONALES" → "Obligaciones patronales". */
function limpiar(s: string) {
  if (!s || s !== s.toUpperCase()) return s;
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
