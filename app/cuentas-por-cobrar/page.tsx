"use client";

import { exportarPantalla } from "../../lib/exportar-excel";
import AnioEjercicio from "../../components/AnioEjercicio";
import { useAgencia, ejercicioEnUso } from "../../lib/seleccion";
import { useDatos } from "../../lib/useDatos";
import { useState } from "react";
import { Download } from "lucide-react";
import { Actualizando, EsqueletoTabla } from "../../components/Carga";
import {
  MESES, AGENCIAS as AGENCIAS_BASE, C, FONDO, usd, pct, etiquetaCorte,
  Indicador, FranjaIndicadores, Tarjeta, TablaMeses, type DefFila,
} from "../../components/ActivosComun";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { ResumenPorAgencia, BotonesVista } from "../../components/PorAgencia";

const AGENCIAS = [...AGENCIAS_BASE, "Consolidado"];

/**
 * CUENTAS POR COBRAR (grupo 16). Igual que el Excel (Agencia_Modelo, fila 149):
 *   relación = saldo de la 16 del balance de partida ÷ cartera por vencer del balance de partida (fija, no se edita)
 *   saldo final de cada mes = relación × cartera por vencer proyectada (Cartera de crédito)
 * La 1602 (intereses por cobrar de inversiones) va aparte: la mueve el registro de Inversiones.
 * Total 16 = cuentas por cobrar de cartera y otras + 1602, el mismo valor del Balance.
 * Consolidado: suma mes a mes de las 10 agencias (cada una con su propia relación).
 */

interface Rollforward { mes: number; saldoInicio: number; entradas: number; salidas: number; saldoFin: number }
interface Datos {
  cuentasPorCobrar16: Rollforward[];
  cuentasPorCobrarInfo?: { base16: number; c1602: number; carteraPorVencerCorte: number; carteraPorVencerPorMes: number[]; interes1602PorMes: number[];
    devengado1602PorMes?: number[]; vencido1602PorMes?: number[]; retencion1602PorMes?: number[] };
  corteCuentas: { c16: number };
  corte?: { anio: number; mes: number };
  error?: string;
}

export default function CuentasPorCobrarPage() {
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const urlDe = (a: string) => `/api/otros-activos-detalle?agencia=${encodeURIComponent(a)}`;
  const url = urlDe(agencia);
  // Consolidado: "Por agencia" muestra cuánto aporta cada agencia, sin filtrar una por una
  const [vista, setVista] = useState<"movimiento" | "agencias">("movimiento");
  const { datos, cargando, actualizando, error } = useDatos<Datos>(
    url, 0,
    (d) => (d.cuentasPorCobrar16 && d.cuentasPorCobrarInfo ? null : "No se pudo calcular."),
  );
  const corte = datos?.corte ? etiquetaCorte(datos.corte) : null;

  const calc = datos?.cuentasPorCobrarInfo ? (() => {
    const inf = datos.cuentasPorCobrarInfo!;
    const rf = datos.cuentasPorCobrar16;
    const pv = inf.carteraPorVencerPorMes;
    const si = rf.map((f) => f.saldoInicio);
    const vari = rf.map((f) => f.entradas);
    const sf = rf.map((f) => f.saldoFin);
    const relCorte = inf.carteraPorVencerCorte ? inf.base16 / inf.carteraPorVencerCorte : 0;
    const rel = pv.map((v, i) => (v ? sf[i] / v : 0));
    const i1602 = inf.interes1602PorMes;
    const total = sf.map((v, i) => v + i1602[i]);
    // 1602: saldo inicial + devengado − vencido + retención = saldo final
    const z = Array(12).fill(0) as number[];
    const dev = inf.devengado1602PorMes ?? z, venc = inf.vencido1602PorMes ?? z, ret = inf.retencion1602PorMes ?? z;
    const ini1602 = i1602.map((_, i) => (i === 0 ? inf.c1602 : i1602[i - 1]));
    return { inf, pv, si, vari, sf, relCorte, rel, i1602, total, dev, venc, ret, ini1602 };
  })() : null;


  const accion = "h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-50";
  const consolidado = agencia === "Consolidado";

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Cuentas por cobrar<AnioEjercicio /></h1>
        <Actualizando visible={actualizando} />
        <button type="button" onClick={() => void exportarPantalla()} disabled={!calc} title="Exportar a Excel" className={accion} style={{ color: C.acento }}>
          <Download size={16} /> Exportar
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 -mt-1" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Secciones" className="flex gap-7 flex-1">
          <button type="button" role="tab" aria-selected className="pt-2 pb-2.5 -mb-px text-[13px]"
                  style={{ color: C.acento, fontWeight: 600, borderBottom: `2px solid ${C.acento}` }}>Proyección</button>
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

      {cargando ? (
        <EsqueletoTabla indicadores filas={6} />
      ) : error ? (
        <p className="text-[13px]" style={{ color: C.alerta }}>{error}</p>
      ) : !calc || !datos ? null : (() => {
        const { inf, pv, si, vari, sf, relCorte, rel, i1602, total, dev, venc, ret, ini1602 } = calc;
        const sumaA = (v: number[]) => v.reduce((a, b) => a + b, 0);
        const ini16 = datos.corteCuentas.c16;
        const varAnio = total[11] - ini16;
        const filas: DefFila[] = [
          { id: "pv", label: "Cartera por vencer", valores: pv, total: pv[11],
            formula: (i) => `Saldo final de la cartera por vencer de ${MESES[i]} (Cartera de crédito): ${usd(pv[i])}.` },
          { id: "rel", label: "Relación con la cartera por vencer", valores: rel, total: rel[11], esPct: true,
            formula: () => consolidado
              ? `Cada agencia usa su propia relación (saldo de su 16 ÷ su cartera por vencer del balance de partida); aquí se ve la relación que resulta de la suma: saldo final ÷ cartera por vencer.`
              : `Saldo de la 16 sin la 1602 ÷ cartera por vencer del balance${corte ? ` a ${corte}` : ""}: ${usd(inf.base16)} ÷ ${usd(inf.carteraPorVencerCorte)} = ${pct(relCorte, 4)}. Es fija todo el año y no se edita.` },
          { id: "si", label: "Saldo inicial", valores: si, total: si[0],
            formula: (i) => (i === 0 ? `Saldo de la 16 sin la 1602 en el balance${corte ? ` a ${corte}` : ""}: ${usd(si[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(si[i])}.`) },
          { id: "var", label: "(+/−) Variación del mes", valores: vari, total: vari.reduce((a, b) => a + b, 0),
            formula: (i) => `Saldo final − saldo inicial = ${usd(sf[i])} − ${usd(si[i])} = ${usd(vari[i])}. Si sube, sale efectivo en el Flujo; si baja, entra.` },
          { id: "sf", codigo: "16 sin 1602", label: "Saldo final", valores: sf, total: sf[11], clave: true,
            formula: (i) => consolidado
              ? `Suma de las agencias: ${usd(sf[i])}.`
              : `Relación × cartera por vencer = ${pct(relCorte, 4)} × ${usd(pv[i])} = ${usd(sf[i])}.` },
          { id: "i1602", label: "Saldo inicial", valores: ini1602, total: ini1602[0],
            formula: (i) => (i === 0 ? `Saldo de la 1602 en el balance${corte ? ` a ${corte}` : ""}: ${usd(ini1602[0])}.` : `Saldo final de ${MESES[i - 1]}: ${usd(ini1602[i])}.`) },
          { id: "dev", label: "(+) Interés devengado de inversiones", valores: dev, total: sumaA(dev),
            formula: (i) => `Interés que ganan en ${MESES[i]} los títulos del registro de Inversiones (capital × tasa ÷ base de días, día a día): ${usd(dev[i])}. Es el mismo valor de la 5103.` },
          { id: "venc", label: "(−) Interés vencido", valores: venc.map((x) => -x), total: -sumaA(venc),
            formula: (i) => `Interés de los títulos que vencen en ${MESES[i]}: al renovarse se suma al capital (13) y al cancelarse se cobra en efectivo (11). Pendiente anterior + devengado − pendiente al cierre = ${usd(venc[i])}.` },
          { id: "ret", label: "(+) Retención en la fuente", valores: ret, total: sumaA(ret),
            formula: (i) => `Retención sobre el interés que vence en ${MESES[i]} (interés vencido × % de retención de Inversiones): ${usd(ret[i])}. Queda por cobrar como crédito tributario.` },
          { id: "f1602", codigo: "1602", label: "Saldo final", valores: i1602, total: i1602[11], clave: true,
            formula: (i) => `Saldo inicial + devengado − vencido + retención = ${usd(ini1602[i])} + ${usd(dev[i])} − ${usd(venc[i])} + ${usd(ret[i])} = ${usd(i1602[i])}.` },
          { id: "tot", codigo: "16", label: "Total cuentas por cobrar", valores: total, total: total[11], clave: true, separador: true,
            formula: (i) => `Cuentas por cobrar de cartera y otras + 1602 = ${usd(sf[i])} + ${usd(i1602[i])} = ${usd(total[i])}. Es el valor de la 16 en el Balance.` },
        ];
        return (
          <>
            <FranjaIndicadores>
              <Indicador titulo={`Saldo a ${corte ?? "corte"}`} valor={usd(ini16)} pie="Balance de partida (grupo 16)" />
              <Indicador titulo={`Cuentas por cobrar dic-${ejercicioEnUso()}`} valor={usd(total[11])} pie={`${varAnio >= 0 ? "Suben" : "Bajan"} ${usd(Math.abs(varAnio))} en el año`} />
              <Indicador titulo="Relación con la cartera por vencer" valor={pct(consolidado ? rel[11] : relCorte)} pie={consolidado ? "Resultado de la suma de agencias" : "Del balance de partida, fija"} />
              <Indicador titulo={`Cartera por vencer dic-${ejercicioEnUso()}`} valor={usd(pv[11])} pie="De Cartera de crédito" />
            </FranjaIndicadores>

            <Tarjeta titulo="Cuentas por cobrar · 16"
              derecha={consolidado ? (
                <BotonesVista etiqueta="Vista" valor={vista} onChange={setVista}
                  opciones={[{ id: "movimiento", label: "Movimiento" }, { id: "agencias", label: "Por agencia" }]} />
              ) : undefined}>
              {consolidado && vista === "agencias" ? (
                <ResumenPorAgencia<Datos> url={urlDe} conceptos={[
                  { id: "tot", label: "Total 16", valores: (d) => d.cuentasPorCobrar16.map((f, i) => f.saldoFin + (d.cuentasPorCobrarInfo?.interes1602PorMes[i] ?? 0)) },
                  { id: "cart", label: "Cartera y otras", valores: (d) => d.cuentasPorCobrar16.map((f) => f.saldoFin) },
                  { id: "var", label: "Variación del mes", valores: (d) => d.cuentasPorCobrar16.map((f) => f.entradas), tipo: "suma" },
                  { id: "i1602", label: "1602", valores: (d) => d.cuentasPorCobrarInfo?.interes1602PorMes ?? Array(12).fill(0) },
                ]} />
              ) : (
                <TablaMeses titulo="Concepto" ultima="Año" titulosAparte filas={filas}
                  grupos={{ pv: "Cuentas por cobrar de cartera y otras", i1602: "Intereses por cobrar de inversiones · 1602" }} />
              )}
            </Tarjeta>
          </>
        );
      })()}
    </div>
  );
}
