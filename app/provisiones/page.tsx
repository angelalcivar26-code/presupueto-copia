"use client";

import { useAgencia, useEjercicio } from "../../lib/seleccion";
import { cargarJSON, apiFetch } from "../../lib/useDatos";
import { Fragment, Suspense, useState } from "react";
import {
  C, F_TABLA, PAGINA, PAGINA_STYLE, cifra, usd, pct, Encabezado, BotonTexto, Bloque,
  useResultados, urlResultados, usePrecargaEgresos, buscarNodo, descargarCsv, type FilaExport,
} from "../../components/EgresosComun";
import { EsqueletoTabla } from "../../components/Carga";
import { AvisoConsolidado } from "../../components/AvisoConsolidado";
import { ModeloTramos, seriesEscenario, urlFlow, type DatosFlow } from "../../components/ProvisionFlowVistas";

/**
 * PROVISIONES (grupo 44), con el modelo por tramos de mora.
 * - Provisión: el escenario activo mes a mes (gasto 4402 por línea, reversiones, recuperación, provisión 1499, castigos, mora y cobertura).
 * - Real frente al modelo: lo real del año de las 10 agencias frente al modelo, y los supuestos del presupuesto frente a lo real (con «Usar lo real»).
 */

const div = (a: number, b: number) => (b ? a / b : 0);
const suma = (x: number[]) => x.reduce((a, b) => a + b, 0);

function ProvisionesContenido() {
  const [ejercicio] = useEjercicio();
  type PestanaProv = "modelo" | "real";
  const [pestana, setPestana] = useState<PestanaProv>("modelo");
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  usePrecargaEgresos(agencia, ejercicio);
  const { egresos } = useResultados(agencia, ejercicio);
  const n44 = buscarNodo(egresos, "44");

  function exportar() {
    const filas: FilaExport[] = [];
    for (const h of n44?.hijos ?? []) filas.push({ codigo: h.codigo, cuenta: h.label, montos: h.valores });
    if (n44) filas.push({ codigo: "44", cuenta: "Total provisiones", montos: n44.valores });
    descargarCsv(`Provisiones - ${agencia} ${ejercicio}`, filas, ejercicio);
  }

  return (
    <div className={PAGINA} style={PAGINA_STYLE}>
      <Encabezado
        titulo="Provisiones"
        pestanas={[{ id: "modelo", label: "Provisión" }, { id: "real", label: "Real frente al modelo" }]}
        activa={pestana} onPestana={(id) => setPestana(id as PestanaProv)}
        agencia={agencia} onAgencia={setAgencia} conConsolidado
        onExportar={exportar}
        enlace={agencia === "Consolidado" ? undefined : { href: "/cartera", texto: "Parámetros en Cartera de crédito → Provisión" }}
      />
      {pestana !== "real" && <AvisoConsolidado url={urlResultados(agencia, ejercicio)} agencia={agencia} />}
      {pestana === "modelo" ? <ModeloTramos key={agencia} agencia={agencia} ejercicio={ejercicio} otras44={n44?.hijos ?? []} />
        : <RealVsModelo ejercicio={ejercicio} />}
    </div>
  );
}

// ---------- Real del año en curso frente al modelo (las 10 agencias, bajo pedido) ----------
interface MesReal { p: string; g4402: number | null; r560410: number | null; r560405: number | null; prov: number | null; riesgo: number | null; bruta: number | null; castigos: number | null }
interface AgReal { agencia: string; prov0: number | null; riesgo0: number | null; meses: MesReal[] }
type Diag = { fmUsado: number; fmReal: number | null; ref: { pase: Partial<Record<string, number>>; rv: number | null; cv?: number | null; factorVencida?: number | null; q?: number | null } | null; sup: { pase: Partial<Record<string, number>>; rv: Partial<Record<string, number>> } | null };
type FilaRM = { agencia: string; n: number; real: { g: number; rv: number; rec: number; cas: number; prov0: number; prov: number; riesgo: number; bruta: number }; mod: { g: number; rv: number; rec: number; cas: number } | null; meses: MesReal[]; diag: Diag | null };
function RealVsModelo({ ejercicio }: { ejercicio: number }) {
  const [filas, setFilas] = useState<FilaRM[] | null>(null);
  const [hasta, setHasta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  async function calcular() {
    setCargando(true);
    try {
      const real = await new Promise<{ hasta?: string; agencias?: AgReal[] } | null>((ok) => { cargarJSON<{ hasta?: string; agencias?: AgReal[] }>("/api/provision-real", ok).catch(() => ok(null)); });
      setHasta(real?.hasta ?? "");
      const r = await Promise.all((real?.agencias ?? []).map(async (a) => {
        const d = await new Promise<DatosFlow | null>((ok) => { cargarJSON<DatosFlow>(urlFlow(a.agencia, ejercicio), ok).catch(() => ok(null)); });
        const x = d?.disponible ? seriesEscenario(d, d.escenario) : null;
        const ms = a.meses.filter((m) => m.g4402 !== null), n = ms.length || 1, ult = ms[ms.length - 1];
        const S = (f: (m: MesReal) => number | null) => ms.reduce((t, m) => t + (f(m) ?? 0), 0) * 12 / n;
        return {
          agencia: a.agencia, n: ms.length, meses: a.meses,
          real: { g: S((m) => m.g4402), rv: S((m) => m.r560410), rec: S((m) => m.r560405), cas: S((m) => m.castigos), prov0: a.prov0 ?? 0, prov: ult?.prov ?? 0, riesgo: ult?.riesgo ?? 0, bruta: ult?.bruta ?? 0 },
          mod: x ? { g: suma(x.g4402), rv: suma(x.rev), rec: suma(x.rec), cas: suma(x.castigos) } : null,
          diag: d?.disponible ? { fmUsado: d.factorMora?.usado ?? 1, fmReal: d.factorMora?.real?.factor ?? null, ref: d.cartera?.referencia ?? null, sup: d.cartera?.supuestos ?? null } : null,
        };
      }));
      setFilas(r);
    } finally { setCargando(false); }
  }
  const th = "px-2 py-2 text-right font-semibold";
  const efecto = (o: { g: number; rv: number; rec: number }) => -o.g + o.rv + o.rec;
  const tot = (f: (x: FilaRM) => number) => (filas ?? []).reduce((t, x) => t + f(x), 0);
  const MES_TXT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return (
    <Bloque titulo="Provisión real del año frente al modelo" derecha={<BotonTexto onClick={calcular} disabled={cargando}>{cargando ? "Calculando..." : filas ? "Volver a calcular" : "Calcular las 10 agencias"}</BotonTexto>}>
      {!filas ? (
        <p className="text-[11px]" style={{ color: C.texto2 }}>
          Compara, por agencia, lo real de este año (Históricos: 4402, 5604.10, 5604.05, provisión 1499 y castigos), llevado a 12 meses, con lo que proyecta el modelo por tramos para {ejercicio}.
          Se calcula al presionar el botón.
        </p>
      ) : (
        <>
          <table className="w-full table-fixed border-collapse text-[11px]" style={F_TABLA}>
            <colgroup><col style={{ width: "12%" }} />{Array.from({ length: 10 }, (_, i) => <col key={i} />)}</colgroup>
            <thead>
              <tr style={{ color: C.texto2 }}>
                <th />
                <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Gasto 4402</th>
                <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Reversión 5604.10</th>
                <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Recuperación 5604.05</th>
                <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Castigos</th>
                <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Efecto en la utilidad</th>
              </tr>
              <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
                <th className="pl-1 py-2 text-left font-semibold">Agencia</th>
                {Array.from({ length: 5 }, (_, i) => <Fragment key={i}><th className={th}>Real</th><th className={th}>Modelo</th></Fragment>)}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const m = f.mod, er = efecto(f.real), em = m ? efecto(m) : null;
                const salto = em !== null && Math.abs(em - er) > Math.max(20000, 0.3 * Math.abs(er));
                return (
                  <Fragment key={f.agencia}>
                    <tr onClick={() => setAbierta(abierta === f.agencia ? null : f.agencia)} className="cursor-pointer hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${C.beige}`, height: 31, color: C.texto3 }}>
                      <td className="pl-1" style={{ color: C.texto }}>{f.agencia}</td>
                      <td className="px-2 text-right">{cifra(f.real.g)}</td><td className="px-2 text-right">{m ? cifra(m.g) : "—"}</td>
                      <td className="px-2 text-right">{cifra(f.real.rv)}</td><td className="px-2 text-right">{m ? cifra(m.rv) : "—"}</td>
                      <td className="px-2 text-right">{cifra(f.real.rec)}</td><td className="px-2 text-right">{m ? cifra(m.rec) : "—"}</td>
                      <td className="px-2 text-right">{cifra(f.real.cas)}</td><td className="px-2 text-right">{m ? cifra(m.cas) : "—"}</td>
                      <td className="px-2 text-right">{cifra(er)}</td>
                      <td className="px-2 text-right" style={{ color: salto ? C.alerta : C.texto, fontWeight: 600 }}>{em !== null ? cifra(em) : "—"}</td>
                    </tr>
                    {abierta === f.agencia && (
                      <tr><td colSpan={11} className="px-2 pb-3" style={{ background: "#F8FAF9" }}>
                        <table className="w-full border-collapse text-[11px] mt-2" style={F_TABLA}>
                          <thead><tr style={{ color: C.texto2 }}><th className="text-left py-1 font-semibold">{f.agencia} · mes a mes</th>{f.meses.map((x) => <th key={x.p} className="text-right font-semibold">{MES_TXT[Number(x.p.slice(5)) - 1]}</th>)}</tr></thead>
                          <tbody>
                            {([["Cartera en riesgo", (x: MesReal) => x.riesgo], ["Provisión 1499", (x: MesReal) => x.prov], ["Gasto 4402", (x: MesReal) => x.g4402], ["Reversión 5604.10", (x: MesReal) => x.r560410], ["Castigos (implícitos)", (x: MesReal) => x.castigos], ["Recuperación 5604.05", (x: MesReal) => x.r560405]] as [string, (x: MesReal) => number | null][]).map(([l, fn]) => (
                              <tr key={l} style={{ borderTop: `1px solid ${C.beige}`, color: C.texto3 }}><td className="py-1">{l}</td>{f.meses.map((x) => <td key={x.p} className="text-right">{fn(x) === null ? "—" : cifra(fn(x)!)}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="text-[11px] mt-2" style={{ color: C.texto2 }}>Provisión 1499: {usd(f.real.prov0)} en dic anterior → {usd(f.real.prov)} al cierre; cobertura {pct(div(f.real.prov, f.real.riesgo), 1)}. Castigos = provisión anterior + 4402 − 5604.10 − provisión del mes.</p>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.borde}`, height: 31, fontWeight: 600 }}>
                <td className="pl-1">Total</td>
                <td className="px-2 text-right">{cifra(tot((x) => x.real.g))}</td><td className="px-2 text-right">{cifra(tot((x) => x.mod?.g ?? 0))}</td>
                <td className="px-2 text-right">{cifra(tot((x) => x.real.rv))}</td><td className="px-2 text-right">{cifra(tot((x) => x.mod?.rv ?? 0))}</td>
                <td className="px-2 text-right">{cifra(tot((x) => x.real.rec))}</td><td className="px-2 text-right">{cifra(tot((x) => x.mod?.rec ?? 0))}</td>
                <td className="px-2 text-right">{cifra(tot((x) => x.real.cas))}</td><td className="px-2 text-right">{cifra(tot((x) => x.mod?.cas ?? 0))}</td>
                <td className="px-2 text-right">{cifra(tot((x) => efecto(x.real)))}</td><td className="px-2 text-right">{cifra(tot((x) => (x.mod ? efecto(x.mod) : 0)))}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] mt-2" style={{ color: C.texto2 }}>
            Real: {hasta ? `enero a ${MES_TXT[Number(hasta.slice(5)) - 1]} ${hasta.slice(0, 4)}` : "año en curso"}, llevado a 12 meses. Modelo: {ejercicio}, escenario activo. Efecto en la utilidad = − 4402 + 5604.10 + 5604.05.
            En rojo, las agencias donde el efecto del modelo se aparta mucho del real. Da clic en una agencia para ver su detalle mensual.
          </p>
          <SupuestosVsReal filas={filas} alAplicar={calcular} />
        </>
      )}
    </Bloque>
  );
}

// ---------- Por qué el modelo se aparta: supuestos del presupuesto frente a lo real de cada agencia ----------
const LIN_DIAG = [["CONSUMO", "Consumo"], ["MICROCREDITO", "Microcrédito"], ["INMOBILIARIO", "Inmobiliario"]] as const;
function SupuestosVsReal({ filas, alAplicar }: { filas: FilaRM[]; alAplicar: () => void }) {
  const [guardando, setGuardando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const con = filas.filter((f) => f.diag);
  if (!con.length) return null;
  const pc = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2).replace(".", ",")} %`);
  const fx = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2).replace(".", ","));
  const lim = (x: number) => Math.max(0.2, Math.min(3, x));
  // cuánto mueve la entrada a la mora el presupuesto frente a lo real (factor de mora × pase de Consumo)
  const entrada = (d: Diag) => {
    const r = d.ref?.pase.CONSUMO, p = d.sup?.pase.CONSUMO;
    return (d.fmUsado / (d.fmReal ?? d.fmUsado)) * (r && p !== undefined ? lim(p / r) : 1);
  };
  const lejos = (d: Diag) => Math.abs(entrada(d) - 1) > 0.15;
  const cuerpo = (d: Diag) => ({ provisionReal: { pase: Object.fromEntries(Object.entries(d.ref?.pase ?? {}).filter(([, v]) => typeof v === "number")), rv: d.ref?.cv ?? null, q: d.ref?.q ?? null }, ...(d.fmReal ? { factorMora: Math.round(d.fmReal * 100) / 100 } : {}) });
  const aplicar = async (lista: FilaRM[]) => {
    const nombres = lista.map((f) => f.agencia).join(", ");
    if (!window.confirm(`Se guardará en el presupuesto de ${nombres} el pase a riesgo por línea, la recuperación de cartera vencida, las precancelaciones con dinero (sin refinanciamientos) y el factor de mora reales de cada agencia (las tasas, la colocación y lo demás no cambian). Cada agencia guarda una copia para deshacer desde su Estudio de agencia. ¿Continuar?`)) return;
    setMsg(null);
    try {
      for (const f of lista) {
        setGuardando(f.agencia);
        const r = await apiFetch("/api/estudio-agencia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "aplicar", agencia: f.agencia, origen: "Provisión, supuestos reales", ...cuerpo(f.diag!) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(`${f.agencia}: ${j.error ?? `error ${r.status}`}`);
      }
      setMsg({ t: `Listo: ${nombres}. El presupuesto se recalcula en unos segundos; luego presiona «Volver a calcular».`, ok: true });
      alAplicar();
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : "No se pudo guardar", ok: false }); }
    finally { setGuardando(null); }
  };
  const th = "px-2 py-2 text-right font-semibold";
  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h4 className="m-0 text-[12px] font-semibold flex-1" style={{ color: C.texto }}>Supuestos del presupuesto frente a lo real de cada agencia</h4>
        <BotonTexto onClick={() => aplicar(con.filter((f) => lejos(f.diag!)))} disabled={!!guardando || !con.some((f) => lejos(f.diag!))}>Usar lo real en las agencias en rojo</BotonTexto>
        <BotonTexto onClick={() => aplicar(con)} disabled={!!guardando}>Usar lo real en todas</BotonTexto>
      </div>
      <table className="w-full border-collapse text-[11px]" style={F_TABLA}>
        <thead>
          <tr style={{ color: C.texto2 }}>
            <th />
            <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Factor de mora</th>
            {LIN_DIAG.map(([, n]) => <th key={n} colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Pase a riesgo {n}</th>)}
            <th colSpan={2} className="px-2 pt-2 text-center font-semibold" style={{ borderBottom: `1px solid ${C.beige}` }}>Recuperación de vencida (cuotas)</th>
            <th colSpan={2} />
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.borde}`, color: C.texto2 }}>
            <th className="pl-1 py-2 text-left font-semibold">Agencia</th>
            {Array.from({ length: 5 }, (_, i) => <Fragment key={i}><th className={th}>Presupuesto</th><th className={th}>Real</th></Fragment>)}
            <th className={th}>Entrada a la mora ×</th><th />
          </tr>
        </thead>
        <tbody>
          {con.map((f) => {
            const d = f.diag!, e = entrada(d), rvP = Object.values(d.sup?.rv ?? {}).filter((x): x is number => typeof x === "number");
            return (
              <tr key={f.agencia} style={{ borderTop: `1px solid ${C.beige}`, height: 31, color: C.texto3 }}>
                <td className="pl-1" style={{ color: C.texto }}>{f.agencia}</td>
                <td className="px-2 text-right">{fx(d.fmUsado)}</td><td className="px-2 text-right">{fx(d.fmReal)}</td>
                {LIN_DIAG.map(([l]) => <Fragment key={l}><td className="px-2 text-right">{pc(d.sup?.pase[l])}</td><td className="px-2 text-right">{pc(d.ref?.pase[l])}</td></Fragment>)}
                <td className="px-2 text-right">{pc(rvP.length ? rvP.reduce((a, x) => a + x, 0) / rvP.length / (d.ref?.factorVencida || 1) : null)}</td><td className="px-2 text-right">{pc(d.ref?.cv ?? null)}</td>
                <td className="px-2 text-right font-semibold" style={{ color: lejos(d) ? C.alerta : C.texto }}>{fx(e)}</td>
                <td className="px-2 text-right"><BotonTexto onClick={() => aplicar([f])} disabled={!!guardando}>{guardando === f.agencia ? "Guardando..." : "Usar lo real"}</BotonTexto></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <p className="text-[12px] m-0" style={{ color: msg.ok ? C.texto : C.alerta }}>{msg.t}</p>}
    </div>
  );
}


export default function ProvisionesPage() {
  return (
    <Suspense fallback={<div className="estilo-institucional min-h-screen px-6 py-6" style={{ background: "#EEF1EF" }}><EsqueletoTabla filas={10} /></div>}>
      <ProvisionesContenido />
    </Suspense>
  );
}
