"use client";

import { useAgencia, ejercicioEnUso } from "../../../lib/seleccion";
import { apiFetch } from "../../../lib/useDatos";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AvisoConsolidado } from "../../../components/AvisoConsolidado";

/**
 * DOCUMENTO IMPRESO · ANEXO DE CARTERA DE CRÉDITO  (/reportes/cartera?agencia=Matriz)
 *
 * No guarda cifras propias: cada vez que se abre vuelve a pedir los datos a las
 * mismas rutas que usa la pantalla de Cartera (mismo motor), así que cualquier
 * cambio en metas, asesores, tasas, provisión, producción o balances ya sale aquí.
 * Solo las notas del analista se guardan aparte (tabla notas_reporte).
 *
 * Impresión: hoja A4 horizontal, una sección por hoja. Si una hoja no entra,
 * se reduce su escala hasta que entra (nunca se parte en dos hojas).
 * En el diálogo de impresión: Destino "Guardar como PDF", Márgenes "Ninguno",
 * y activar "Gráficos de fondo" para que salgan los colores.
 */

const NUM_ANEXO = "2";
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const AGENCIAS = ["Matriz", "El Guabo", "Piñas", "Machala II", "Ponce Enríquez", "Balsas", "Santa Rosa", "Las Lajas", "Naranjal", "Catamayo", "Consolidado"];
type Linea = "PRODUCTIVO" | "CONSUMO" | "INMOBILIARIO" | "MICROCREDITO";
const LINEAS: { id: Linea; label: string }[] = [
  { id: "PRODUCTIVO", label: "Productivo" }, { id: "CONSUMO", label: "Consumo" },
  { id: "INMOBILIARIO", label: "Inmobiliario" }, { id: "MICROCREDITO", label: "Microcrédito" },
];
const RANGO_LABEL: Record<string, string> = { JUNIOR: "Junior", SENIOR: "Senior", MASTER: "Master" };
const VERDE = "#2F6B4F", ROJO = "#B42318", GRIS = "#7A7167";

// ---------- tipos de las APIs ----------
interface DetalleMesLinea {
  mes: number;
  porVencer: { saldoInicial: number; prestamosAConceder: number; recuperacionPrestamos: number; incrementosRiesgo: number; saldoFinal: number };
  enRiesgo: { saldoInicial: number; incrementosRiesgo: number; recuperacionRiesgo: number; saldoFinal: number };
  provision: number; ingresoPorInteres: number;
  tasas: { metaColocacionAgencia: number; pctDistribucion: number; pctRecuperacionPeriodo: number; tasaEfectividadRecuperacion: number;
    tasaRecuperacionCarteraVencida: number; tasaInteresAnual: number; ratioProvision: number; pctProvisionInicial?: number };
}
interface ProduccionMes { operacionesIniciales: number; operacionesAConceder: number; creditosCancelados: number; creditosAlFin: number; oficialesRequeridos: number | null; montoPromedio: number | null }
interface Cartera {
  detalle: Record<Linea, DetalleMesLinea[]>;
  produccion?: Record<Linea, ProduccionMes[]>;
  entradasProduccion?: { asesoresActivos: number; minimoOperaciones: number; parametros: Record<Linea, { operacionesIniciales: number; creditosPorOficial: number }> };
  corte?: { anio: number; mes: number };
  error?: string;
}
/** En Consolidado la API trae los asesores de las 10 agencias con su `agencia`. */
interface Oficial { usuario: string; rango: string; activo: number; agencia?: string }
interface Metas { meta_junior: number; meta_senior: number; meta_master: number; minimo_operaciones: number; relacion_mora: number }

// ---------- formato ----------
function n(v: number, d = 0): string {
  const r = Number(v.toFixed(d));
  return (r < 0 ? "−" : "") + Math.abs(r).toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const p = (v: number, d = 2) => n(v * 100, d) + " %";
const usd = (v: number) => (v < 0 ? "−$" : "$") + n(Math.abs(v));
const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);

// ---------- datos por línea (todo sale de la API; aquí solo se ordena) ----------
function datosLinea(c: Cartera, l: Linea) {
  const f = c.detalle[l];
  const pr = c.produccion?.[l];
  const pvSF = f.map((x) => x.porVencer.saldoFinal), rSF = f.map((x) => x.enRiesgo.saldoFinal);
  const provi = f.map((x) => Math.abs(x.provision));
  const bruta = pvSF.map((v, i) => v + rSF[i]);
  return {
    tasa: f.map((x) => x.tasas.tasaInteresAnual), rec: f.map((x) => x.tasas.pctRecuperacionPeriodo),
    ef: f.map((x) => x.tasas.tasaEfectividadRecuperacion), rr: f.map((x) => x.tasas.tasaRecuperacionCarteraVencida),
    dist: f.map((x) => x.tasas.pctDistribucion), pprov: f.map((x) => x.tasas.ratioProvision),
    pvSI: f.map((x) => x.porVencer.saldoInicial), prest: f.map((x) => x.porVencer.prestamosAConceder),
    recu: f.map((x) => -Math.abs(x.porVencer.recuperacionPrestamos)), pase: f.map((x) => -Math.abs(x.porVencer.incrementosRiesgo)),
    pvSF, rSI: f.map((x) => x.enRiesgo.saldoInicial), rInc: f.map((x) => Math.abs(x.enRiesgo.incrementosRiesgo)),
    rRec: f.map((x) => -Math.abs(x.enRiesgo.recuperacionRiesgo)), rSF, provi, bruta,
    ing: f.map((x) => x.ingresoPorInteres),
    crec: pvSF.map((v) => (f[0].porVencer.saldoInicial ? v / f[0].porVencer.saldoInicial - 1 : 0)),
    mor: bruta.map((b, i) => (b ? rSF[i] / b : 0)), cob: rSF.map((r, i) => (r ? provi[i] / r : 0)),
    bruta0: f[0].porVencer.saldoInicial + f[0].enRiesgo.saldoInicial,
    ini: pr?.map((x) => x.operacionesIniciales) ?? null, aC: pr?.map((x) => x.operacionesAConceder) ?? null,
    canc: pr?.map((x) => -x.creditosCancelados) ?? null, fin: pr?.map((x) => x.creditosAlFin) ?? null,
    ofi: pr?.map((x) => x.oficialesRequeridos ?? 0) ?? null, monto: pr?.map((x) => x.montoPromedio ?? 0) ?? null,
  };
}

// ---------- piezas de la hoja ----------
function Fila({ label, vals, fmt, total, clave, total2, color }: {
  label: string; vals: number[]; fmt: (v: number) => string; total: string; clave?: boolean; total2?: boolean; color?: string;
}) {
  return (
    <tr className={clave ? "clave" : total2 ? "total" : ""}>
      <th>{label}</th>
      {vals.map((v, i) => <td key={i} style={color && Math.abs(v) > 1e-9 ? { color } : undefined}>{Math.abs(v) < 1e-9 ? "—" : fmt(v)}</td>)}
      <td className="tot">{total}</td>
    </tr>
  );
}
function Sec({ num, children }: { num: number; children: ReactNode }) {
  return <tr className="sec"><th colSpan={14}><span className="num">{num}</span>{children}</th></tr>;
}
function Tabla12({ children, ultima = "Año / Dic" }: { children: ReactNode; ultima?: string }) {
  return (
    <table>
      <thead><tr><td>Concepto</td>{MESES.map((m) => <td key={m}>{m}</td>)}<td>{ultima}</td></tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
function Kpis({ items }: { items: [string, string, string, string][] }) {
  return (
    <div className="kpis">
      {items.map(([t, v, s, c]) => <div key={t} className="kpi"><span className="kt">{t}</span><span className="kv">{v}</span><span className="kp" style={{ color: c }}>{s}</span></div>)}
    </div>
  );
}

/** Una hoja A4 horizontal. Si el contenido no entra, se reduce la escala (zoom) hasta que entra. */
function Hoja({ titulo, agencia, corte, generado, pagina, total, nota, onNota, firmas, consolidado, children }: {
  titulo: string; agencia: string; corte: string; generado: string; pagina: number; total: number;
  nota: string; onNota: (t: string) => void; firmas?: boolean;
  /** Consolidado: las notas se registran por agencia; aquí no se editan. */
  consolidado?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.zoom = "1";
    el.style.height = "100%";
    const disponible = el.clientHeight, necesario = el.scrollHeight;
    if (necesario > disponible) {
      const z = Math.max(0.6, (disponible / necesario) * 0.99);
      el.style.zoom = String(z);
    }
  });
  return (
    <section className="hoja">
      <div className="contenido" ref={ref}>
        <div className="top">
          <div>
            <div className="inst">COAC Once de Junio Ltda. · Presupuesto institucional {ejercicioEnUso()} · Anexo {NUM_ANEXO}</div>
            <h1>{titulo}</h1>
          </div>
          <div className="meta">Agencia <b>{agencia}</b> · cifras en USD<br />Punto de partida: <b>balance a {corte}</b><br />Generado {generado}</div>
        </div>
        {children}
        <div className="pie">
          <div className="nota">
            <b>Notas del analista</b>
            {consolidado ? (
              <div className="nota-texto" />
            ) : (
              <div className="nota-texto" contentEditable suppressContentEditableWarning spellCheck
                   data-vacio="Escribe aquí el comentario (se guarda solo; no se imprime si queda vacío)"
                   onBlur={(e) => onNota(e.currentTarget.innerText)}>{nota}</div>
            )}
          </div>
          {firmas !== false && (
            <div className="firmas">
              <div className="firma">Elaborado por<br />Analista financiero</div>
              <div className="firma">Revisado por<br />Contadora general</div>
              <div className="firma">Aprobado por<br />Gerencia general</div>
            </div>
          )}
        </div>
        <div className="foot">
          <span>Fuente: herramienta Presupuesto {ejercicioEnUso()} · cada cifra se calcula con las fórmulas de la herramienta (ícono ƒ en Cartera)</span>
          <span>Anexo {NUM_ANEXO} · página {pagina} de {total}</span>
        </div>
      </div>
    </section>
  );
}

// =====================================================================
// PÁGINA
// =====================================================================

export default function ReporteCarteraPage() {
  const [montado, setMontado] = useState(false);
  const [agencia, setAgencia] = useAgencia(); // compartida entre pantallas (lib/seleccion.ts)
  const [cartera, setCartera] = useState<Cartera | null>(null);
  const [oficiales, setOficiales] = useState<Oficial[]>([]);
  const [metas, setMetas] = useState<Metas | null>(null);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [generado, setGenerado] = useState("");
  // La vista previa de Google AI Studio corre dentro de un marco (iframe) que no deja abrir el diálogo de impresión.
  // En ese caso el reporte se abre en una pestaña propia y se imprime desde ahí.
  const [enMarco, setEnMarco] = useState(false);
  const [imprimirAlCargar, setImprimirAlCargar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get("agencia");
    if (a && AGENCIAS.includes(a)) setAgencia(a);
    let marco = true;
    try { marco = window.self !== window.top; } catch { marco = true; }
    setEnMarco(marco);
    setImprimirAlCargar(params.get("imprimir") === "1" && !marco);
    setMontado(true);
  }, [setAgencia]);

  useEffect(() => {
    if (!montado) return;
    let vivo = true;
    setCargando(true); setError(null);
    const q = `agencia=${encodeURIComponent(agencia)}`;
    Promise.all([
      apiFetch(`/api/cartera-credito?${q}`).then((r) => r.json()),
      apiFetch(`/api/oficiales-credito?${q}`).then((r) => r.json()),
      apiFetch("/api/metas-credito-institucional").then((r) => r.json()),
      // Consolidado: las notas son por agencia; no se piden.
      agencia === "Consolidado" ? Promise.resolve({ notas: {} })
        : apiFetch(`/api/notas-reporte?${q}&reporte=cartera`).then((r) => r.json()).catch(() => ({ notas: {} })),
    ])
      .then(([c, o, m, nt]) => {
        if (!vivo) return;
        if (c.error || !c.detalle) throw new Error(c.error ?? "No se pudo calcular la cartera.");
        setCartera(c); setOficiales(o.oficiales ?? []); setMetas(m.error ? null : m); setNotas(nt.notas ?? {});
        const d = new Date();
        setGenerado(`${d.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}`);
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "Error de conexión."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [agencia, montado]);

  // Si se abrió con ?imprimir=1 (desde la vista previa), abre el diálogo cuando las hojas ya están dibujadas
  const yaImprimio = useRef(false);
  useEffect(() => {
    if (!imprimirAlCargar || yaImprimio.current || cargando || !cartera) return;
    yaImprimio.current = true;
    window.setTimeout(() => window.print(), 700); // deja que las hojas terminen de ajustarse
  }, [imprimirAlCargar, cargando, cartera]);

  function imprimir() {
    setAviso(null); setEnlace(null);
    if (!enMarco) { window.print(); return; }
    const url = `${window.location.origin}${window.location.pathname}?agencia=${encodeURIComponent(agencia)}&imprimir=1`;
    const w = window.open(url, "_blank");
    if (w) setAviso("Se abrió el anexo en una pestaña nueva; el diálogo de impresión aparece ahí.");
    else { setAviso("La vista previa no deja abrir pestañas. Copia este enlace y pégalo en una pestaña nueva del navegador:"); setEnlace(url); }
  }

  function guardarNota(seccion: string, texto: string) {
    if (agencia === "Consolidado") return; // solo lectura
    const limpio = texto.trim();
    if ((notas[seccion] ?? "") === limpio) return;
    setNotas((x) => ({ ...x, [seccion]: limpio }));
    apiFetch("/api/notas-reporte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agencia, reporte: "cartera", seccion, texto: limpio }) })
      .catch(() => undefined);
  }
  function cambiarAgencia(a: string) {
    setAgencia(a);
    window.history.replaceState(null, "", `?agencia=${encodeURIComponent(a)}`);
  }

  if (!montado) return null;

  const barra = (
    <div className="barra">
      <a href="/cartera" className="btn">← Volver a Cartera</a>
      <span className="barra-titulo">Anexo de cartera de crédito · vista de impresión</span>
      <select value={agencia} onChange={(e) => cambiarAgencia(e.target.value)} aria-label="Agencia" className="sel">
        {AGENCIAS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <button type="button" className="btn primario" onClick={imprimir} disabled={!cartera || cargando}>
        {enMarco ? "Abrir para imprimir / PDF" : "Imprimir / Guardar PDF"}
      </button>
      <span className="ayuda">
        {aviso ?? (enMarco
          ? "La vista previa del editor no permite imprimir: el botón abre el anexo en una pestaña propia y lanza la impresión."
          : "En el diálogo: Destino Guardar como PDF · Márgenes Ninguno · activar Gráficos de fondo")}
        {enlace && (
          <>
            {" "}<a href={enlace} target="_blank" rel="noreferrer" className="enlace">{enlace}</a>{" "}
            <button type="button" className="btn mini" onClick={() => navigator.clipboard?.writeText(enlace).then(() => setAviso("Enlace copiado. Pégalo en una pestaña nueva del navegador:")).catch(() => undefined)}>Copiar enlace</button>
          </>
        )}
      </span>
    </div>
  );

  let hojas: ReactNode = null;
  if (cartera && !cargando) {
    const corte = cartera.corte ? `${MESES_LARGOS[cartera.corte.mes - 1]} ${cartera.corte.anio}` : "—";
    const D = Object.fromEntries(LINEAS.map((l) => [l.id, datosLinea(cartera, l.id)])) as Record<Linea, ReturnType<typeof datosLinea>>;
    const tot = (k: "pvSF" | "rSF" | "prest" | "recu" | "provi" | "ing") => MESES.map((_, i) => LINEAS.reduce((a, l) => a + D[l.id][k][i], 0));
    const pvT = tot("pvSF"), rT = tot("rSF"), provT = tot("provi"), prestT = tot("prest"), ingT = tot("ing");
    const brutaT = pvT.map((v, i) => v + rT[i]);
    const bruta0T = LINEAS.reduce((a, l) => a + D[l.id].bruta0, 0);
    const morT = brutaT.map((b, i) => (b ? rT[i] / b : 0)), cobT = rT.map((r, i) => (r ? provT[i] / r : 0));
    const opsT = LINEAS.reduce((a, l) => a + (D[l.id].aC ? suma(D[l.id].aC!) : 0), 0);
    const relMora = metas?.relacion_mora ?? 0;
    const activos = oficiales.filter((o) => Number(o.activo) === 1);
    const metaRango: Record<string, number> = { JUNIOR: metas?.meta_junior ?? 0, SENIOR: metas?.meta_senior ?? 0, MASTER: metas?.meta_master ?? 0 };
    const metaAgencia = activos.reduce((a, o) => a + (metaRango[o.rango] ?? 0), 0);
    const TOTAL = 2 + LINEAS.length;
    const comun = { agencia, corte, generado, total: TOTAL, consolidado: agencia === "Consolidado" };

    hojas = (
      <>
        {/* ---------- 1 · Resumen ---------- */}
        <Hoja titulo="Cartera de crédito · Resumen" {...comun} pagina={1} firmas={false} nota={notas.resumen ?? ""} onNota={(t) => guardarNota("resumen", t)}>
          <Kpis items={[
            ["Cartera bruta · Dic", usd(brutaT[11]), `${brutaT[11] >= bruta0T ? "▲" : "▼"} ${p(Math.abs(bruta0T ? brutaT[11] / bruta0T - 1 : 0), 1)} en el año`, brutaT[11] >= bruta0T ? VERDE : ROJO],
            [`Colocación ${ejercicioEnUso()}`, usd(suma(prestT)), `${usd(metaAgencia)} al mes · ${activos.length} asesores`, GRIS],
            ["Morosidad · Dic", p(morT[11]), `desde ${p(morT[0])} en enero`, morT[11] <= morT[0] ? VERDE : ROJO],
            ["Cobertura · Dic", p(cobT[11]), "meta 100 %", cobT[11] >= 1 ? VERDE : ROJO],
            [`Intereses ${ejercicioEnUso()}`, usd(suma(ingT)), relMora ? `+ ${p(relMora, 0)} por mora en el Estado de resultados` : "sin interés de mora", GRIS],
          ]} />
          <h2>1 · Cartera por línea <span>· saldos a diciembre {ejercicioEnUso()} y movimiento del año</span></h2>
          <table>
            <thead><tr><td>Línea</td><td>Cartera bruta inicial</td><td>Colocación año</td><td>Recuperación año</td><td>Por vencer Dic</td><td>En riesgo Dic</td><td>Cartera bruta Dic</td><td>Participación</td><td>Morosidad Dic</td><td>% provisión Dic</td><td>Intereses año</td><td>Operaciones año</td></tr></thead>
            <tbody>
              {LINEAS.map((l) => {
                const d = D[l.id];
                return (
                  <tr key={l.id}>
                    <th>{l.label}</th><td>{n(d.bruta0)}</td>
                    <td style={{ color: suma(d.prest) ? VERDE : undefined }}>{suma(d.prest) ? n(suma(d.prest)) : "—"}</td>
                    <td style={{ color: ROJO }}>{n(suma(d.recu))}</td><td>{n(d.pvSF[11])}</td><td>{n(d.rSF[11])}</td>
                    <td className="tot">{n(d.bruta[11])}</td><td>{p(brutaT[11] ? d.bruta[11] / brutaT[11] : 0, 1)}</td>
                    <td>{p(d.mor[11])}</td><td>{p(d.pprov[11])}</td><td>{n(suma(d.ing))}</td><td>{d.aC ? n(suma(d.aC)) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <th>Total cartera</th><td>{n(bruta0T)}</td><td>{n(suma(prestT))}</td><td>{n(suma(tot("recu")))}</td><td>{n(pvT[11])}</td><td>{n(rT[11])}</td>
                <td className="tot">{n(brutaT[11])}</td><td>100 %</td><td>{p(morT[11])}</td><td>{p(brutaT[11] ? provT[11] / brutaT[11] : 0)}</td><td>{n(suma(ingT))}</td><td>{n(opsT)}</td>
              </tr>
            </tbody>
          </table>
          <h2>2 · Evolución mensual de la cartera total</h2>
          <Tabla12>
            <Fila label="Cartera por vencer" vals={pvT} fmt={n} total={n(pvT[11])} />
            <Fila label="Cartera en riesgo" vals={rT} fmt={n} total={n(rT[11])} />
            <Fila label="Cartera bruta" vals={brutaT} fmt={n} total={n(brutaT[11])} clave />
            <Fila label="(−) Provisión acumulada" vals={provT.map((v) => -v)} fmt={n} total={n(-provT[11])} color={ROJO} />
            <Fila label="Cartera neta" vals={brutaT.map((b, i) => b - provT[i])} fmt={n} total={n(brutaT[11] - provT[11])} clave />
            <Fila label="(+) Colocación del mes" vals={prestT} fmt={n} total={n(suma(prestT))} color={VERDE} />
            <Fila label="Ingresos por intereses (sin mora)" vals={ingT} fmt={n} total={n(suma(ingT))} />
            <Fila label="Morosidad" vals={morT} fmt={(v) => p(v)} total={p(morT[11])} />
            <Fila label="Cobertura de provisión" vals={cobT} fmt={(v) => p(v)} total={p(cobT[11])} />
          </Tabla12>
        </Hoja>

        {/* ---------- 2 · Supuestos ---------- */}
        <Hoja titulo="Cartera de crédito · Supuestos" {...comun} pagina={2} firmas={false} nota={notas.supuestos ?? ""} onNota={(t) => guardarNota("supuestos", t)}>
          <div className="dos">
            <div>
              <h2>3 · Asesores de crédito <span>· activos, meta mensual según rango</span></h2>
              <table>
                <thead><tr><td>Asesor</td><td className="izq">Rango</td><td>Meta mensual</td></tr></thead>
                <tbody>
                  {activos.map((o) => <tr key={`${o.agencia ?? ""}-${o.usuario}`}><th>{o.usuario}{o.agencia ? ` · ${o.agencia}` : ""}</th><td className="izq">{RANGO_LABEL[o.rango] ?? o.rango}</td><td>{n(metaRango[o.rango] ?? 0)}</td></tr>)}
                  <tr className="total"><th>Meta de colocación mensual</th><td className="izq">{activos.length} asesores</td><td>{n(metaAgencia)}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <h2>4 · Metas por rango</h2>
              <table>
                <thead><tr><td>Rango</td><td>Asesores</td><td>Meta por asesor</td><td>Meta del rango</td></tr></thead>
                <tbody>
                  {["JUNIOR", "SENIOR", "MASTER"].map((r) => {
                    const c = activos.filter((o) => o.rango === r).length;
                    return <tr key={r}><th>{RANGO_LABEL[r]}</th><td>{c}</td><td>{n(metaRango[r])}</td><td>{n(c * metaRango[r])}</td></tr>;
                  })}
                  <tr className="total"><th>Total</th><td>{activos.length}</td><td /><td>{n(metaAgencia)}</td></tr>
                </tbody>
              </table>
              <h2>5 · Parámetros institucionales</h2>
              <table>
                <thead><tr><td>Parámetro</td><td>Valor</td></tr></thead>
                <tbody>
                  <tr><th>Mínimo de operaciones por asesor al mes</th><td>{n(metas?.minimo_operaciones ?? 0)}</td></tr>
                  <tr><th>Interés de mora sobre el ingreso de cartera</th><td>{p(relMora)}</td></tr>
                </tbody>
              </table>
              <h2>6 · Condiciones por línea <span>· enero; si cambian en el año se ven en el anexo de cada línea</span></h2>
              <table>
                <thead><tr><td>Línea</td><td>Tasa anual</td><td>% recuperación</td><td>Efectividad</td><td>Recup. en riesgo</td><td>% provisión inicial</td><td>Operaciones vigentes</td><td>Créditos por oficial</td></tr></thead>
                <tbody>
                  {LINEAS.map((l) => {
                    const d = D[l.id], pp = cartera.entradasProduccion?.parametros[l.id];
                    const ini = cartera.detalle[l.id][0].tasas.pctProvisionInicial;
                    return (
                      <tr key={l.id}><th>{l.label}</th><td>{p(d.tasa[0])}</td><td>{p(d.rec[0])}</td><td>{p(d.ef[0], 0)}</td><td>{p(d.rr[0])}</td>
                        <td>{ini !== undefined ? p(ini) : "—"}</td><td>{pp?.operacionesIniciales ? n(pp.operacionesIniciales) : "—"}</td><td>{pp?.creditosPorOficial ? n(pp.creditosPorOficial) : "—"}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <h2>7 · Distribución de la colocación <span>· % de la meta que va a cada línea</span></h2>
          <Tabla12 ultima="Promedio">
            {LINEAS.map((l) => <Fila key={l.id} label={l.label} vals={D[l.id].dist} fmt={(v) => p(v, 0)} total={p(suma(D[l.id].dist) / 12, 0)} />)}
            <Fila label="Total" vals={MESES.map((_, i) => LINEAS.reduce((a, l) => a + D[l.id].dist[i], 0))} fmt={(v) => p(v, 0)}
                  total={p(LINEAS.reduce((a, l) => a + suma(D[l.id].dist), 0) / 12, 0)} total2 />
          </Tabla12>
        </Hoja>

        {/* ---------- 3 a 6 · una hoja por línea ---------- */}
        {LINEAS.map((l, idx) => {
          const d = D[l.id];
          const cpo = cartera.entradasProduccion?.parametros[l.id]?.creditosPorOficial ?? 0;
          const opsAnio = d.aC ? suma(d.aC) : 0;
          return (
            <Hoja key={l.id} titulo={`Cartera de crédito · ${l.label}`} {...comun} pagina={3 + idx}
                  nota={notas[l.id] ?? ""} onNota={(t) => guardarNota(l.id, t)}>
              <Kpis items={[
                ["Cartera bruta · Dic", usd(d.bruta[11]), `${d.bruta[11] >= d.bruta0 ? "▲" : "▼"} ${p(Math.abs(d.bruta0 ? d.bruta[11] / d.bruta0 - 1 : 0), 1)} en el año`, d.bruta[11] >= d.bruta0 ? VERDE : ROJO],
                [`Colocación ${ejercicioEnUso()}`, usd(suma(d.prest)), opsAnio ? `${n(opsAnio)} operaciones` : "sin colocación asignada", GRIS],
                ["Morosidad · Dic", p(d.mor[11]), `desde ${p(d.mor[0])} en enero`, d.mor[11] <= d.mor[0] ? VERDE : ROJO],
                ["Ingresos por intereses", usd(suma(d.ing)), `acumulado ${ejercicioEnUso()}`, GRIS],
                ["Oficiales requeridos · Dic", d.ofi && cpo ? n(d.ofi[11], 1) : "—", d.fin ? `${n(d.fin[11])} créditos vigentes` : "sin datos de producción", GRIS],
              ]} />
              <Tabla12>
                <Sec num={1}>Condiciones de otorgamiento y recuperación</Sec>
                <Fila label="Tasa de interés anual (base 360)" vals={d.tasa} fmt={(v) => p(v)} total={p(d.tasa[11])} />
                <Fila label="% recuperación por período" vals={d.rec} fmt={(v) => p(v)} total={p(d.rec[11])} />
                <Fila label="Efectividad de la recuperación" vals={d.ef} fmt={(v) => p(v)} total={p(d.ef[11])} />
                <Fila label="Recuperación de cartera en riesgo" vals={d.rr} fmt={(v) => p(v)} total={p(d.rr[11])} />
                <Fila label="% de la meta asignado a la línea" vals={d.dist} fmt={(v) => p(v)} total={p(d.dist[11])} />

                <Sec num={2}>Producción · número de operaciones</Sec>
                {d.ini && d.aC && d.canc && d.fin && d.ofi && d.monto ? (
                  <>
                    <Fila label="Operaciones iniciales" vals={d.ini} fmt={n} total={n(d.ini[0])} />
                    <Fila label="(+) Operaciones a conceder" vals={d.aC} fmt={n} total={n(opsAnio)} color={VERDE} />
                    <Fila label="(−) Créditos cancelados" vals={d.canc} fmt={n} total={n(suma(d.canc))} color={ROJO} />
                    <Fila label="Créditos al fin del período" vals={d.fin} fmt={n} total={n(d.fin[11])} clave />
                    <Fila label={cpo ? `Oficiales requeridos (${n(cpo)} créditos c/u)` : "Oficiales requeridos"} vals={cpo ? d.ofi : d.ofi.map(() => 0)} fmt={(v) => n(v, 1)} total={cpo ? n(d.ofi[11], 1) : "—"} />
                    <Fila label="Monto promedio por operación" vals={d.monto} fmt={(v) => "$" + n(v)} total={opsAnio ? "$" + n(suma(d.prest) / opsAnio) : "—"} />
                  </>
                ) : <tr><th colSpan={14} className="aviso">Sin datos de producción: completa Cartera → Metas → Producción.</th></tr>}

                <Sec num={3}>Cartera por vencer</Sec>
                <Fila label="Saldo inicial" vals={d.pvSI} fmt={n} total={n(d.pvSI[0])} />
                <Fila label="(+) Préstamos a conceder" vals={d.prest} fmt={n} total={n(suma(d.prest))} color={VERDE} />
                <Fila label="(−) Recuperación de préstamos" vals={d.recu} fmt={n} total={n(suma(d.recu))} color={ROJO} />
                <Fila label="(−) Pase a cartera en riesgo" vals={d.pase} fmt={n} total={n(suma(d.pase))} color={ROJO} />
                <Fila label="Saldo final" vals={d.pvSF} fmt={n} total={n(d.pvSF[11])} clave />
                <Fila label="% crecimiento acumulado" vals={d.crec} fmt={(v) => p(v)} total={p(d.crec[11])} />

                <Sec num={4}>Cartera en riesgo</Sec>
                <Fila label="Saldo inicial" vals={d.rSI} fmt={n} total={n(d.rSI[0])} />
                <Fila label="(+) Pase desde cartera por vencer" vals={d.rInc} fmt={n} total={n(suma(d.rInc))} color={ROJO} />
                <Fila label="(−) Recuperación de cartera en riesgo" vals={d.rRec} fmt={n} total={n(suma(d.rRec))} color={VERDE} />
                <Fila label="Saldo final" vals={d.rSF} fmt={n} total={n(d.rSF[11])} clave />

                <Sec num={5}>Provisión y relaciones proyectadas</Sec>
                <Fila label="% de provisión" vals={d.pprov} fmt={(v) => p(v)} total={p(d.pprov[11])} />
                <Fila label="(−) Provisión acumulada" vals={d.provi.map((v) => -v)} fmt={n} total={n(-d.provi[11])} color={ROJO} />
                <Fila label="Morosidad" vals={d.mor} fmt={(v) => p(v)} total={p(d.mor[11])} />
                <Fila label="Cobertura de provisión" vals={d.cob} fmt={(v) => p(v)} total={p(d.cob[11])} />
                <Fila label="Ingresos por intereses" vals={d.ing} fmt={n} total={n(suma(d.ing))} />
              </Tabla12>
            </Hoja>
          );
        })}
      </>
    );
  }

  return createPortal(
    <div className="reporte-raiz">
      <style>{CSS}</style>
      {barra}
      <div className="aviso-cons"><AvisoConsolidado url={`/api/cartera-credito?agencia=${encodeURIComponent(agencia)}`} agencia={agencia} /></div>
      {cargando ? <p className="estado">Calculando el anexo de {agencia}...</p>
        : error ? <p className="estado error">{error}</p>
        : <div className="hojas">{hojas}</div>}
    </div>,
    document.body
  );
}

// =====================================================================
// ESTILOS (pantalla = vista previa; impresión = A4 horizontal, una hoja por sección)
// =====================================================================

const CSS = `
.reporte-raiz{position:fixed;inset:0;z-index:60;overflow:auto;background:#E9E5DF;font-family:Inter,Arial,sans-serif;color:#1F1B16}
.barra{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 20px;background:#FFFFFF;border-bottom:1px solid #E7E1D8}
.barra-titulo{flex:1;font-size:13px;font-weight:600}
.btn{height:32px;padding:0 14px;border-radius:999px;border:1px solid #E7E1D8;background:#FFFFFF;font-size:12.5px;font-weight:600;color:#3A342D;display:inline-flex;align-items:center;text-decoration:none;cursor:pointer}
.btn.primario{background:#B54A26;border-color:#B54A26;color:#FFFFFF}.btn:disabled{opacity:.5}
.sel{height:32px;padding:0 10px;border-radius:999px;border:1px solid #E7E1D8;font-size:12.5px;font-weight:600;background:#FFFFFF}
.ayuda{width:100%;font-size:11px;color:#7A7167}
.enlace{color:#B54A26;word-break:break-all}.btn.mini{height:24px;padding:0 10px;font-size:11px;margin-left:4px}
.aviso-cons{padding:12px 20px 0}.aviso-cons:empty{display:none}
.estado{padding:40px;font-size:13px;color:#7A7167}.estado.error{color:#B42318}
.hojas{display:flex;flex-direction:column;align-items:center;gap:18px;padding:24px 0 60px}

/* ---- la hoja: A4 horizontal ---- */
.hoja{width:297mm;height:210mm;background:#FFFFFF;box-shadow:0 2px 10px rgba(31,27,22,.12);padding:8mm 10mm;overflow:hidden;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:7.7pt;line-height:1.3;font-variant-numeric:tabular-nums}
.contenido{height:100%;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #B54A26;padding-bottom:5px}
.inst{font-size:7.3pt;letter-spacing:1.4px;text-transform:uppercase;color:#7A7167;font-weight:600}
.hoja h1{font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:500;font-size:17pt;margin:1px 0 0;line-height:1.15}
.meta{text-align:right;font-size:7.6pt;color:#7A7167;line-height:1.5}.meta b{color:#1F1B16}
.kpis{display:flex;margin:6px 0;border:1px solid #E7E1D8;border-radius:8px;padding:5px 0}
.kpi{flex:1;padding:0 12px;display:flex;flex-direction:column;gap:1px;border-right:1px solid #F1EDE6}.kpi:last-child{border-right:none}
.kt{font-size:6.5pt;letter-spacing:1px;text-transform:uppercase;color:#7A7167;font-weight:600}.kv{font-size:12pt;font-weight:700}.kp{font-size:6.9pt}
.hoja h2{font-size:8.6pt;margin:8px 0 4px;font-weight:700}.hoja h2 span{font-weight:400;color:#7A7167;font-size:7.4pt}
.hoja table{width:100%;border-collapse:collapse;font-size:7.7pt}
.hoja thead td{font-size:6.6pt;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#4A433B;background:#EFEDEA;padding:4px 5px;text-align:right}
.hoja thead td:first-child,.hoja td.izq{text-align:left}
.hoja tbody th{text-align:left;font-weight:400;color:#3A342D;padding:1px 6px 1px 14px;white-space:nowrap;border-top:1px solid #F1EDE6}
.hoja tbody td{text-align:right;padding:1px 5px;border-top:1px solid #F1EDE6;white-space:nowrap}
.hoja tr.sec th{background:#F6F3EE;font-weight:700;color:#1F1B16;padding:2px 6px;border-top:1px solid #E7E1D8}
.hoja th.aviso{color:#B7791F;font-style:italic}
.num{display:inline-block;width:13px;height:13px;border-radius:50%;background:#B54A26;color:#FFFFFF;font-size:6.8pt;text-align:center;line-height:13px;margin-right:6px}
.hoja tr.clave th,.hoja tr.clave td{font-weight:700;color:#1F1B16;border-top:1px solid #E7E1D8}
.hoja tr.total th,.hoja tr.total td{font-weight:700;background:#F6F3EE;border-top:1px solid #E7E1D8}
.hoja td.tot{font-weight:700;border-left:1px solid #E7E1D8}
.dos{display:flex;gap:14px}.dos>div{flex:1;min-width:0}
.pie{display:flex;gap:14px;margin-top:auto;padding-top:8px}
.nota{flex:1;border:1px solid #E7E1D8;border-radius:8px;padding:4px 10px;font-size:7.3pt;color:#3A342D;line-height:1.4;min-height:36px}
.nota b{color:#B54A26;font-size:6.6pt;letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:2px}
.nota-texto{outline:none;white-space:pre-wrap;min-height:14px}
.nota-texto:empty:before{content:attr(data-vacio);color:#B8AEA2}
.nota-texto:focus{background:#FBF8F3}
.firmas{display:flex;gap:16px}.firma{width:140px;border-top:1px solid #1F1B16;margin-top:18px;padding-top:3px;font-size:6.8pt;color:#7A7167;text-align:center}
.foot{margin-top:5px;display:flex;justify-content:space-between;font-size:6.6pt;color:#B8AEA2}

/* ---- impresión ---- */
@media print {
  @page { size: A4 landscape; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #FFFFFF !important; }
  body > *:not(.reporte-raiz) { display: none !important; }
  .reporte-raiz { position: static; overflow: visible; background: #FFFFFF; }
  .barra, .estado, .aviso-cons { display: none !important; }
  .hojas { display: block; padding: 0; }
  .hoja { box-shadow: none; margin: 0; break-after: page; page-break-after: always; break-inside: avoid; }
  .hoja:last-child { break-after: auto; page-break-after: auto; }
  .nota-texto:empty:before { content: ""; }
  .nota-texto:focus { background: transparent; }
}
`;
