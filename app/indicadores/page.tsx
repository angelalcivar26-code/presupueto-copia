"use client";
/**
 * INDICADORES DEL PRESUPUESTO: los indicadores financieros calculados con el Balance general y el Estado de resultados
 * proyectados, con las fórmulas de la herramienta de indicadores. Se agrupan por tipo (Rentabilidad, Calidad de activos,
 * Eficiencia, Liquidez y Crecimiento) y se ven de dos formas: mes a mes de una agencia, o todas las agencias en un mes.
 */
import AnioEjercicio from "../../components/AnioEjercicio";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBasesPresupuesto } from "../../lib/useBasesPresupuesto";
import { C, F_TABLA, F_TEXTO, PAGINA, PAGINA_STYLE, AGENCIAS, cifra } from "../../components/EgresosComun";
import { EsqueletoTabla } from "../../components/Carga";
import { sumarBases, indicadores, resultados, SUBGRUPOS_45, type Base } from "../../lib/calc/indicadores-presupuesto";
import { CATEGORIAS_PRESUPUESTO as CATEGORIAS, MESES, MESES_LARGO, CONSOLIDADO, valorDe, usd, pct, type Categoria, type Ind, type Serie } from "../../lib/indicadores-categorias";
import { ejercicioEnUso } from "../../lib/seleccion";
import { BotonF } from "../../components/ActivosComun";

const NUM = { ...F_TABLA, fontVariantNumeric: "tabular-nums" } as const;

export default function IndicadoresPage() {
  const ejercicio = ejercicioEnUso();
  const [cat, setCat] = useState<Categoria["id"]>("rentabilidad");
  const [modo, setModo] = useState<"mes" | "agencias">("mes");
  const [agencia, setAgencia] = useState(CONSOLIDADO);
  const [mes, setMes] = useState(11);
  const [menu, setMenu] = useState(false);
  const [errExp, setErrExp] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { bases, errores, listas } = useBasesPresupuesto(ejercicio);
  const completo = listas + errores.length >= AGENCIAS.length;

  // 12 meses de indicadores por agencia (y el Consolidado = suma de las agencias)
  const series = useMemo<Record<string, Serie>>(() => {
    const ags = AGENCIAS.filter((a) => bases[a]);
    const o: Record<string, Serie> = {};
    const de = (b: Base) => ({ base: b, ind: Array.from({ length: 12 }, (_, m) => indicadores(b, m)) });
    for (const a of ags) o[a] = de(bases[a]);
    if (ags.length) o[CONSOLIDADO] = de(sumarBases(ags.map((a) => bases[a])));
    return o;
  }, [bases]);
  const agencias = Object.keys(series);
  const categoria = CATEGORIAS.find((c) => c.id === cat)!;
  const sel = series[agencia] ?? series[CONSOLIDADO];

  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [menu]);

  async function exportar() {
    setMenu(false); setErrExp(null);
    try {
      const { exportarExcelIndicadores } = await import("../../lib/indicadores-export");
      await exportarExcelIndicadores({ ejercicio, mes, agencia: series[agencia] ? agencia : CONSOLIDADO, series });
    } catch (e) { setErrExp(e instanceof Error ? e.message : "No se pudo generar el archivo."); }
  }

  return (
    <div className={PAGINA} style={PAGINA_STYLE}>
      <div className="flex flex-col gap-4" style={F_TEXTO}>
        <h1 className="text-[22px] font-semibold leading-tight" style={{ color: C.texto }}>Indicadores del presupuesto<AnioEjercicio /></h1>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div role="tablist" className="flex gap-1 flex-wrap">
            {CATEGORIAS.map((c) => {
              const on = c.id === cat;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => setCat(c.id)}
                        className="h-9 px-3.5 rounded-lg text-[13px] whitespace-nowrap"
                        style={{ background: on ? C.acentoSuave : "transparent", color: on ? C.acento : C.texto2, fontWeight: on ? 600 : 400 }}>{c.label}</button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Agencia" value={agencia} onChange={(e) => setAgencia(e.target.value)}
                    className="h-9 px-2.5 text-[13px] rounded-lg bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>
              {[CONSOLIDADO, ...AGENCIAS].map((a) => <option key={a} value={a} disabled={completo && !series[a]}>{a}</option>)}
            </select>
            <select aria-label="Mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}
                    className="h-9 px-2.5 text-[13px] rounded-lg bg-white" style={{ border: `1px solid ${C.borde}`, color: C.texto }}>
              {MESES_LARGO.map((m, i) => <option key={m} value={i}>{m[0].toUpperCase() + m.slice(1)}</option>)}
            </select>
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenu((x) => !x)} disabled={!completo || !sel} aria-expanded={menu}
                      className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.acento }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
                Exportar
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 mt-1 z-20 bg-white rounded-lg py-1 min-w-[170px] shadow-lg" style={{ border: `1px solid ${C.borde}` }}>
                  <button type="button" role="menuitem" onClick={exportar} className="w-full text-left px-3.5 py-2 text-[13px] hover:bg-[#F4F6F5]" style={{ color: C.texto }}>Excel</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {errExp && <p role="alert" className="text-[12px]" style={{ color: C.alerta }}>{errExp}</p>}
      </div>

      {!completo ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px]" style={{ color: C.texto2, ...F_TEXTO }}>Calculando el presupuesto de las agencias ({listas} de {AGENCIAS.length})…</p>
          <EsqueletoTabla indicadores={false} filas={11} />
        </div>
      ) : !sel ? (
        <p className="text-[13px]" style={{ color: C.alerta, ...F_TEXTO }}>No se pudo calcular el presupuesto de las agencias.</p>
      ) : (
        <>
          {errores.length > 0 && <p className="text-[12px]" style={{ color: C.alerta, ...F_TEXTO }}>Sin datos de: {errores.join(", ")}.</p>}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
            {categoria.indicadores.slice(0, 4).map((ind) => <TarjetaInd key={ind.id} ind={ind} serie={sel} mes={mes} />)}
          </div>
          <section className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.borde}` }}>
            <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
              <h2 className="text-[14px] font-semibold" style={{ color: C.texto }}>
                {categoria.label} · {modo === "mes" ? (series[agencia] ? agencia : CONSOLIDADO) : `${MESES_LARGO[mes]} ${ejercicio}`}
              </h2>
              <div role="group" aria-label="Vista" className="flex p-0.5 rounded-lg" style={{ background: "#F1F2F1" }}>
                {([["mes", "Mes a mes"], ["agencias", "Comparar agencias"]] as const).map(([id, n]) => {
                  const on = id === modo;
                  return <button key={id} type="button" aria-pressed={on} onClick={() => setModo(id)} className="h-8 px-3.5 rounded-md text-[12.5px]"
                                 style={{ background: on ? "#fff" : "transparent", color: on ? C.texto : C.texto2, fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : undefined }}>{n}</button>;
                })}
              </div>
            </div>
            {modo === "mes"
              ? <MesAMes inds={categoria.indicadores.filter((i) => !i.soloComparar)} serie={sel} mes={mes} />
              : <CompararAgencias key={cat} inds={categoria.indicadores} series={series} agencias={agencias} mes={mes} />}
          </section>
          {modo === "agencias" && cat === "rentabilidad" && <TablaResultados series={series} agencias={agencias} mes={mes} ejercicio={ejercicio} />}
          {modo === "agencias" && cat === "eficiencia" && <TablaSubgrupos series={series} agencias={agencias} mes={mes} />}
        </>
      )}
    </div>
  );
}

// ---------- piezas ----------
const fmt = (ind: Ind, v: number | null) => (ind.formato === "usd" ? usd(v) : pct(v));

function TarjetaInd({ ind, serie, mes }: { ind: Ind; serie: Serie; mes: number }) {
  const vals = serie.ind.map((_, m) => valorDe(ind, serie, m));
  const v = vals[mes], ant = mes > 0 ? vals[mes - 1] : null;
  const dif = v !== null && ant !== null ? v - ant : null;
  const difTxt = dif === null ? null : ind.formato === "usd" ? `${dif >= 0 ? "+" : "−"}${usd(Math.abs(dif))}` : `${dif >= 0 ? "+" : "−"}${Math.abs(dif * 100).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pp`;
  return (
    <div className="bg-white rounded-2xl px-5 py-4 flex flex-col gap-1" style={{ border: `1px solid ${C.borde}`, ...F_TEXTO }}>
      <span className="text-[12.5px] font-semibold" style={{ color: C.texto2 }}>{ind.label}</span>
      <span className="text-[24px] font-bold leading-tight" style={{ ...NUM, fontFamily: F_TEXTO.fontFamily, color: v !== null && v < 0 ? C.alerta : C.texto }}>{fmt(ind, v)}</span>
      <span className="text-[12px]" style={{ color: C.tenue }}>{difTxt ? `${difTxt} frente a ${MESES[mes - 1].toLowerCase()}` : " "}</span>
    </div>
  );
}

function MesAMes({ inds, serie, mes }: { inds: Ind[]; serie: Serie; mes: number }) {
  // ƒ al final de la fila (como en las demás secciones): la fórmula se ve debajo de la tabla
  const [abierta, setAbierta] = useState<string | null>(null);
  const sel = inds.find((x) => x.id === abierta);
  return (
    <>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" style={{ ...NUM, minWidth: 1180 }}>
        <colgroup><col style={{ width: 250 }} />{MESES.map((m) => <col key={m} />)}<col style={{ width: 40 }} /></colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
            <th className="pl-5 py-2.5 text-left text-[11.5px] font-semibold" style={{ color: C.tenue }}>Indicador</th>
            {MESES.map((m, i) => <th key={m} className="px-1.5 py-2.5 text-right text-[11.5px] font-semibold" style={{ color: i === mes ? C.acento : C.tenue, background: i === mes ? "#F3F8F5" : undefined }}>{m}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {inds.map((ind) => {
            const vals = serie.ind.map((_, m) => valorDe(ind, serie, m));
            return (
              <tr key={ind.id} className="hover:bg-[#F8FAF9]" style={{ borderTop: `1px solid ${C.beige}` }}>
                <td className="pl-5 pr-3 py-2.5 text-[13px] font-medium" style={{ ...F_TEXTO, color: C.texto }}>{ind.label}</td>
                {vals.map((v, i) => (
                  <td key={i} className="px-1.5 text-right whitespace-nowrap"
                      style={{ color: v !== null && v < 0 ? C.alerta : C.texto3, fontWeight: i === mes ? 700 : 400, background: i === mes ? "#F3F8F5" : undefined }}>{fmt(ind, v)}</td>
                ))}
                <td className="text-center"><BotonF abierto={abierta === ind.id} onClick={() => setAbierta(abierta === ind.id ? null : ind.id)} titulo={`Fórmula de ${ind.label}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {sel && (
      <div className="flex items-baseline gap-3 px-5 py-3" style={{ borderTop: `1px solid ${C.beige}`, background: "#FAFBFA", ...F_TEXTO }}>
        <span className="font-mono text-[12px]" style={{ color: C.texto2 }}>ƒ</span>
        <b className="text-[12.5px]" style={{ color: C.texto }}>{sel.label}</b>
        <span className="text-[12.5px]" style={{ color: C.texto3 }}>{sel.formula}</span>
      </div>
    )}
    </>
  );
}

/** Agencias en filas, indicadores en columnas; se ordena con clic en el encabezado (el Consolidado queda al final). */
function CompararAgencias({ inds, series, agencias, mes }: { inds: Ind[]; series: Record<string, Serie>; agencias: string[]; mes: number }) {
  const [orden, setOrden] = useState<{ id: string; asc: boolean } | null>(null);
  const val = (ind: Ind, a: string) => valorDe(ind, series[a], mes, series[CONSOLIDADO]);
  const lista = agencias.filter((a) => a !== CONSOLIDADO);
  const indOrden = orden ? inds.find((x) => x.id === orden.id) : undefined;
  const ordenadas = !orden || !indOrden ? lista
    : [...lista].sort((a, b) => ((val(indOrden, a) ?? -Infinity) - (val(indOrden, b) ?? -Infinity)) * (orden.asc ? 1 : -1));
  const fila = (a: string, fuerte: boolean) => (
    <tr key={a} className="hover:bg-[#F8FAF9]" style={{ borderTop: fuerte ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: fuerte ? 40 : 36 }}>
      <td className="pl-5 text-[13px]" style={{ ...F_TEXTO, color: C.texto, fontWeight: fuerte ? 700 : 400 }}>{a}</td>
      {inds.map((ind) => {
        const v = val(ind, a);
        return <td key={ind.id} className="px-3 text-right whitespace-nowrap" style={{ color: v === null ? C.cero : v < 0 ? C.alerta : C.texto3, fontWeight: fuerte ? 700 : 400 }}>{fmt(ind, v)}</td>;
      })}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]" style={{ ...NUM, minWidth: 180 + inds.length * 120 }}>
        <colgroup><col style={{ width: 170 }} />{inds.map((i) => <col key={i.id} />)}</colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
            <th className="pl-5 py-2.5 text-left text-[11.5px] font-semibold" style={{ color: C.tenue }}>Agencia</th>
            {inds.map((ind) => {
              const on = orden?.id === ind.id;
              return (
                <th key={ind.id} className="px-3 py-2.5 text-right align-bottom text-[11.5px] font-semibold leading-tight">
                  <button type="button" className="text-right leading-tight hover:underline" style={{ color: on ? C.acento : C.tenue, fontWeight: 600 }}
                          onClick={() => setOrden(on && !orden!.asc ? null : { id: ind.id, asc: on })}>
                    {ind.label}{on ? (orden!.asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((a) => fila(a, false))}
          {series[CONSOLIDADO] && fila(CONSOLIDADO, true)}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.borde}` }}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
        <h2 className="text-[14px] font-semibold" style={{ color: C.texto }}>{titulo}</h2>{extra}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

/** Estado de resultados resumido con las agencias en columnas (acumulado al mes elegido). */
function TablaResultados({ series, agencias, mes, ejercicio }: { series: Record<string, Serie>; agencias: string[]; mes: number; ejercicio: number }) {
  const cols = [...agencias.filter((a) => a !== CONSOLIDADO), ...(series[CONSOLIDADO] ? [CONSOLIDADO] : [])];
  const porAg = cols.map((a) => resultados(series[a].base, mes));
  const lineas = porAg[porAg.length - 1];
  return (
    <Panel titulo={`Estado de resultados acumulado a ${MESES_LARGO[mes]} ${ejercicio}`}>
      <table className="w-full border-collapse text-[12px]" style={{ ...NUM, minWidth: 220 + cols.length * 100 }}>
        <colgroup><col style={{ width: 220 }} />{cols.map((a) => <col key={a} />)}</colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
            <th className="pl-5 py-2.5 text-left text-[11.5px] font-semibold" style={{ color: C.tenue }}>Cuenta</th>
            {cols.map((a) => <th key={a} className="px-2 py-2.5 text-right text-[11.5px] font-semibold leading-tight" style={{ color: a === CONSOLIDADO ? C.texto : C.tenue }}>{a}</th>)}
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={l.id} className="hover:bg-[#F8FAF9]" style={{ borderTop: l.total ? "1px solid #D3D9D5" : `1px solid ${C.beige}`, height: 32, background: l.fuerte ? "#F7F9F8" : undefined }}>
              <td className={l.total ? "pl-5" : "pl-8"} title={l.codigo ? `Cuenta ${l.codigo}` : undefined}
                  style={{ ...F_TEXTO, fontSize: 12.5, color: l.total ? C.texto : C.texto3, fontWeight: l.total ? 600 : 400 }}>{l.label}</td>
              {porAg.map((r, k) => {
                const v = r[i].v;
                return <td key={cols[k]} className="px-2 text-right whitespace-nowrap"
                           style={{ color: Math.round(v) === 0 ? C.cero : v < 0 ? (l.total ? C.alerta : C.texto3) : C.texto, fontWeight: l.total || cols[k] === CONSOLIDADO ? 600 : 400 }}>
                  {l.total ? usd(v) : cifra(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Gastos de operación por subgrupo y agencia, en dólares o como porcentaje de los ingresos de la agencia. */
function TablaSubgrupos({ series, agencias, mes }: { series: Record<string, Serie>; agencias: string[]; mes: number }) {
  const [enPct, setEnPct] = useState(false);
  const todas = [...agencias.filter((a) => a !== CONSOLIDADO), ...(series[CONSOLIDADO] ? [CONSOLIDADO] : [])];
  const v = (a: string, k: keyof Base) => {
    const b = series[a].base, x = (b[k] as number[])[mes];
    return enPct ? (b.i5[mes] ? x / b.i5[mes] : null) : x;
  };
  const unidad = (
    <div role="group" aria-label="Unidad" className="flex p-0.5 rounded-lg" style={{ background: "#F1F2F1" }}>
      {[["usd", "Dólares"], ["pct", "% de ingresos"]].map(([id, n]) => {
        const on = (id === "pct") === enPct;
        return <button key={id} type="button" aria-pressed={on} onClick={() => setEnPct(id === "pct")} className="h-8 px-3.5 rounded-md text-[12.5px]"
                       style={{ background: on ? "#fff" : "transparent", color: on ? C.texto : C.texto2, fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : undefined }}>{n}</button>;
      })}
    </div>
  );
  return (
    <Panel titulo="Gastos de operación por subgrupo" extra={unidad}>
      <table className="w-full border-collapse text-[12px]" style={{ ...NUM, minWidth: 180 + 8 * 115 }}>
        <colgroup><col style={{ width: 170 }} />{SUBGRUPOS_45.map((s) => <col key={s.codigo} />)}<col /></colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, ...F_TEXTO }}>
            <th className="pl-5 py-2.5 text-left text-[11.5px] font-semibold" style={{ color: C.tenue }}>Agencia</th>
            {SUBGRUPOS_45.map((s) => <th key={s.codigo} className="px-2 py-2.5 text-right text-[11.5px] font-semibold leading-tight" style={{ color: C.tenue }} title={`Cuenta ${s.codigo}`}>{s.n}</th>)}
            <th className="px-2 py-2.5 text-right text-[11.5px] font-semibold" style={{ color: C.texto }} title="Cuenta 45">Total</th>
          </tr>
        </thead>
        <tbody>
          {todas.map((a) => {
            const c = a === CONSOLIDADO;
            const fila = SUBGRUPOS_45.map((s) => v(a, s.k));
            const total = v(a, "e45");
            const max = Math.max(...fila.map((x) => x ?? -Infinity));
            return (
              <tr key={a} className="hover:bg-[#F8FAF9]" style={{ borderTop: c ? "1px solid #B9C3BD" : `1px solid ${C.beige}`, height: c ? 38 : 34 }}>
                <td className="pl-5 text-[13px]" style={{ ...F_TEXTO, color: C.texto, fontWeight: c ? 700 : 400 }}>{a}</td>
                {fila.map((x, i) => (
                  <td key={i} className="px-2 text-right whitespace-nowrap" style={{ color: x === null || Math.abs(x) < (enPct ? 0.00005 : 0.5) ? C.cero : C.texto3, fontWeight: c || x === max ? 600 : 400 }}>
                    {enPct ? pct(x) : usd(x)}</td>
                ))}
                <td className="px-2 text-right whitespace-nowrap" style={{ color: C.texto, fontWeight: 600 }}>{enPct ? pct(total) : usd(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
