"use client";

import { ejercicioEnUso } from "../../lib/seleccion";
import { apiFetch } from "../../lib/useDatos";
import { useEffect, useState, useCallback, useMemo } from "react";
import { FileSpreadsheet, X, CheckCircle2, AlertCircle, AlertTriangle, Save, RefreshCw, Trash2 } from "lucide-react";
import { C, FONDO, Indicador, Tarjeta } from "../../components/ActivosComun";
import { CargaProvision } from "../../components/CargaProvision";
import { CargaHistoricos } from "../../components/CargaHistoricos";
import { CargaRecuperacion } from "../../components/CargaRecuperacion";
import { CargaDiferidos } from "../../components/CargaDiferidos";
import { BalancePartida } from "../../components/BalancePartida";
import ZonaArchivos from "../../components/ZonaArchivos";
import { matrizDe, mensajeOtraPestana } from "../../lib/detectar-archivo";
import { parsearActivosFijos, type ResultadoParseoActivos } from "../../lib/activos-fijos-parser";
import {
  useEstadoSincronizacion,
  useEscucharSincronizacion,
  notificarCambioArchivo,
} from "../../lib/cache-sistema";

// =====================================================================
// ESTILO INSTITUCIONAL (mismo de Cartera, Activos, Obligaciones y Patrimonio)
// =====================================================================

const P = { ...C, okSuave: "#E3F1E7", alertaSuave: "#FBE4E1" };
const TABLA = "w-full table-fixed text-[11px] border-collapse";
const CABECERA = { background: "#FFFFFF", color: C.cabeceraTexto, borderBottom: "2px solid #DDE2DF", height: 32 };
const CAMPO = "h-9 px-2.5 text-[13px] rounded-md bg-white";
const BORDE_CAMPO = "1px solid #C9D0CC";

function BotonPrimario({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0" style={{ background: C.acento }}>
      {children}
    </button>
  );
}
function BotonSecundario({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-9 px-3.5 rounded-md bg-white text-[12px] font-semibold hover:bg-[#F3F5F4]"
            style={{ border: BORDE_CAMPO, color: C.texto }}>{children}</button>
  );
}
function BotonEliminar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Eliminar carga" title="Eliminar"
            className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[#FBE4E1]" style={{ color: C.alerta }}>
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
/** Mensaje de control: verde (ok), ámbar (aviso) o rojo (alerta). */
function Aviso({ tipo, children }: { tipo: "ok" | "aviso" | "alerta"; children: React.ReactNode }) {
  const e = tipo === "ok" ? { fondo: P.okSuave, color: C.ok, icono: <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> }
    : tipo === "aviso" ? { fondo: C.avisoSuave, color: "#6E4A0E", icono: <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> }
    : { fondo: P.alertaSuave, color: C.alerta, icono: <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> };
  return <div className="flex items-start gap-2 px-3.5 py-2 rounded-md text-[12px]" style={{ background: e.fondo, color: e.color }}>{e.icono}<span>{children}</span></div>;
}
function ArchivoElegido({ archivo, onQuitar, leyendo }: { archivo: File; onQuitar: () => void; leyendo?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-md" style={{ background: C.crema, border: `1px solid ${C.beige}` }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <FileSpreadsheet className="w-4 h-4 shrink-0" style={{ color: C.acento }} />
        <span className="text-[13px] font-semibold truncate">{archivo.name}</span>
        <span className="text-[12px] shrink-0" style={{ color: C.texto2 }}>{(archivo.size / 1024 / 1024).toFixed(2)} MB{leyendo ? " · leyendo…" : ""}</span>
      </div>
      <button type="button" onClick={onQuitar} aria-label="Quitar archivo" className="w-7 h-7 rounded flex items-center justify-center hover:bg-[#FBE4E1]" style={{ color: C.texto2 }}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
function Modal({ titulo, children, onCancelar, onConfirmar, ocupado }: { titulo: string; children: React.ReactNode; onCancelar: () => void; onConfirmar: () => void; ocupado?: boolean }) {
  return (
    <div className="estilo-institucional fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,20,24,0.32)" }}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 flex flex-col gap-3" style={{ border: "1px solid #D5DBD7", color: C.texto }}>
        <p className="text-[14px] font-semibold">{titulo}</p>
        <p className="text-[12px]" style={{ color: C.texto2 }}>{children}</p>
        <div className="flex justify-end gap-2 pt-1">
          <BotonSecundario onClick={onCancelar}>Cancelar</BotonSecundario>
          <button type="button" onClick={onConfirmar} disabled={ocupado}
                  className="h-9 px-3.5 rounded-md text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-60" style={{ background: C.alerta }}>
            <Trash2 className="w-4 h-4" /> {ocupado ? "Eliminando..." : "Sí, eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// PÁGINA: Carga de datos, una pestaña por tipo de archivo. Lo que se sube aquí alimenta a todas las secciones.
// =====================================================================

const SECCIONES = [
  { id: "bal", label: "Balances" },
  { id: "er", label: "Estados de resultados" },
  { id: "co", label: "Cuentas de orden" },
  { id: "partida", label: "Balance de partida" },
  { id: "activos", label: "Activos fijos" },
  { id: "provision", label: "Calificación de cartera" },
  { id: "recuperacion", label: "Recuperación de cartera" },
  { id: "diferidos", label: "Activos diferidos" },
] as const;
type Seccion = (typeof SECCIONES)[number]["id"];

export default function CargaDatosPage() {
  const [seccion, setSeccion] = useState<Seccion>("bal");
  const { estado, sincronizar, ultimaSincronizacion } = useEstadoSincronizacion();
  const sincronizando = estado === "sincronizando" || estado === "cargando_cache";
  const hora = ultimaSincronizacion ? new Date(ultimaSincronizacion).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: P.texto, fontVariantNumeric: "tabular-nums" }}>
      {/* Encabezado: título y Actualizar datos */}
      <div className="flex flex-wrap items-center gap-3 min-h-9">
        <h1 className="flex-1 min-w-[216px] text-[22px] font-semibold leading-tight">Carga de datos</h1>
        <button type="button" onClick={() => sincronizar()} disabled={sincronizando}
                title="Vuelve a leer los datos desde la base de datos y actualiza toda la herramienta"
                className="h-9 px-2.5 rounded text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#E3EEE7] disabled:opacity-60" style={{ color: P.acento }}>
          <RefreshCw className={`w-4 h-4 ${sincronizando ? "animate-spin" : ""}`} />
          {sincronizando ? "Actualizando datos..." : hora ? `Actualizar datos · ${hora}` : "Actualizar datos"}
        </button>
      </div>

      {/* Tipo de archivo */}
      <div className="flex flex-wrap items-end gap-3 -mt-1 overflow-x-auto" style={{ borderBottom: "1px solid #D3D9D5" }}>
        <div role="tablist" aria-label="Tipo de archivo" className="flex gap-6 flex-1">
          {SECCIONES.map((o) => {
            const activa = seccion === o.id;
            return (
              <button key={o.id} type="button" role="tab" aria-selected={activa} onClick={() => setSeccion(o.id)}
                      className="pt-2 pb-2.5 -mb-px text-[13px] whitespace-nowrap"
                      style={{ color: activa ? P.acento : P.texto2, fontWeight: activa ? 600 : 400, borderBottom: `2px solid ${activa ? P.acento : "transparent"}` }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {seccion === "bal" ? <CargaHistoricos key="BAL" tipo="BAL" />
        : seccion === "er" ? <CargaHistoricos key="ER" tipo="ER" />
        : seccion === "co" ? <CargaHistoricos key="CO" tipo="CO" />
        : seccion === "partida" ? <BalancePartida />
        : seccion === "activos" ? <CargaActivosFijos />
        : seccion === "provision" ? <CargaProvision />
        : seccion === "recuperacion" ? <CargaRecuperacion />
        : <CargaDiferidos />}
    </div>
  );
}

// =====================================================================
// ACTIVOS FIJOS: subir el reporte del sistema, limpiarlo, revisar y guardar
// =====================================================================

interface CargaActivos {
  ejercicio: number; fechaCorte: string; bienes: number; agencias: number;
  valorContable: number; depAcumulada: number; depMensual: number; cargadoEn: string;
}

const fmtUSD = (n: number) => "$" + Math.round(n).toLocaleString("es-EC");
const fmtUSD2 = (n: number) => "$" + n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFechaCorta = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const fmtFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} de ${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(m) - 1]} de ${y}`;
};

function CargaActivosFijos() {
  const [archivo, setArchivo] = useState<File | null>(null);
  // varios archivos (o un .zip): se revisan y guardan de uno en uno
  const [cola, setCola] = useState<File[]>([]);
  const [totalCola, setTotalCola] = useState(0);
  const [errores, setErrores] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoParseoActivos | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [ejercicio, setEjercicio] = useState(ejercicioEnUso);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ t: string; e?: boolean } | null>(null);

  const [cargas, setCargas] = useState<CargaActivos[]>([]);
  const [confirmarEliminar, setConfirmarEliminar] = useState<CargaActivos | null>(null);

  const cargarLista = useCallback(async () => {
    try {
      const res = await apiFetch("/api/activos-fijos-registro");
      const data = await res.json();
      if (res.ok) setCargas(data.cargas ?? []);
    } catch { /* la lista se puede recargar luego */ }
  }, []);
  const ticketSyncAF = useEscucharSincronizacion();
  useEffect(() => { cargarLista(); }, [cargarLista, ticketSyncAF]);

  /** Lee el siguiente archivo de la cola que sea un reporte de activos fijos; los demás se informan y no se guardan. */
  async function siguiente(lista: File[]) {
    setResultado(null); setArchivo(null);
    const errs: string[] = [];
    let k = 0;
    for (; k < lista.length; k++) {
      const f = lista[k];
      setLeyendo(true);
      try {
        const datos = await f.arrayBuffer();
        const r = parsearActivosFijos(matrizDe(datos));
        if (!r.bienes.length || !r.fechaCorte) { errs.push(mensajeOtraPestana(f.name, datos, "Activos fijos", r.errores[0] ?? "no se encontraron bienes ni la fecha de corte.")); continue; }
        setArchivo(f); setResultado(r); break;
      } catch { errs.push(`${f.name}: no se pudo leer. Verifique que sea un Excel (.xlsx o .xls).`); }
    }
    setLeyendo(false);
    setErrores((e) => [...e, ...errs]);
    setCola(lista.slice(k + 1));
  }
  function procesar(lista: File[]) {
    setMensaje(null); setErrores([]); setTotalCola(lista.length);
    siguiente(lista);
  }
  function quitar() {
    setMensaje(null);
    if (cola.length) siguiente(cola); else { setArchivo(null); setResultado(null); }
  }

  const existente = resultado?.fechaCorte ? cargas.find((c) => c.ejercicio === ejercicio && c.fechaCorte === resultado.fechaCorte) : undefined;

  async function guardar() {
    if (!resultado?.fechaCorte) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const res = await apiFetch("/api/activos-fijos-registro", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ejercicio, fechaCorte: resultado.fechaCorte, bienes: resultado.bienes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");
      setMensaje({ t: `Se guardaron ${data.guardados.toLocaleString("es-EC")} bienes con corte al ${fmtFecha(resultado.fechaCorte)} para el ejercicio ${ejercicio}.` });
      notificarCambioArchivo("subida", `Activos fijos corte ${fmtFecha(resultado.fechaCorte)}`);
      cargarLista();
      if (cola.length) siguiente(cola); else { setArchivo(null); setResultado(null); }
    } catch (e) {
      setMensaje({ t: e instanceof Error ? e.message : "Error de conexión al guardar.", e: true });
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(c: CargaActivos) {
    const res = await apiFetch(`/api/activos-fijos-registro?ejercicio=${c.ejercicio}&fechaCorte=${c.fechaCorte}`, { method: "DELETE" });
    setConfirmarEliminar(null);
    if (res.ok) {
      cargarLista();
      notificarCambioArchivo("eliminacion", `Activos fijos corte ${fmtFecha(c.fechaCorte)}`);
    } else setMensaje({ t: "No se pudo eliminar la carga.", e: true });
  }

  // Resumen por agencia para la vista previa
  const porAgencia = useMemo(() => {
    const m = new Map<string, { bienes: number; costo: number; dep: number; depMes: number; depreciados: number }>();
    for (const b of resultado?.bienes ?? []) {
      const r = m.get(b.agencia) ?? { bienes: 0, costo: 0, dep: 0, depMes: 0, depreciados: 0 };
      r.bienes++; r.costo += b.valor_contable; r.dep += b.dep_acumulada; r.depMes += b.dep_mensual;
      if (b.vida_util_meses > 0 && b.valor_contable - b.dep_acumulada <= b.valor_residual + 0.01) r.depreciados++;
      m.set(b.agencia, r);
    }
    return [...m.entries()].sort((a, b) => b[1].costo - a[1].costo);
  }, [resultado]);
  const tot = porAgencia.reduce((t, [, r]) => ({
    bienes: t.bienes + r.bienes, costo: t.costo + r.costo, dep: t.dep + r.dep, depMes: t.depMes + r.depMes, depreciados: t.depreciados + r.depreciados,
  }), { bienes: 0, costo: 0, dep: 0, depMes: 0, depreciados: 0 });
  const cuadra = resultado?.totalGeneral
    ? Math.abs(tot.costo - resultado.totalGeneral.contable) <= 1 && Math.abs(tot.dep - resultado.totalGeneral.depAcumulada) <= 1
    : null;
  const bloqueado = !resultado || resultado.errores.length > 0 || !resultado.fechaCorte || resultado.bienes.length === 0;

  return (
    <>
      {/* ---------- Subir archivo ---------- */}
      <Tarjeta titulo="Reporte de depreciación de activos fijos">
        <div className="p-4">
          {!archivo ? (
            leyendo ? <p className="py-6 text-center text-[13px] font-semibold">Leyendo…</p>
              : <ZonaArchivos texto="Subir reporte de depreciación de activos fijos" onArchivos={procesar} />
          ) : (
            <div className="flex flex-col gap-2">
              {totalCola > 1 && <span className="text-[12px] font-semibold" style={{ color: P.texto2 }}>Archivo {totalCola - cola.length} de {totalCola}</span>}
              <ArchivoElegido archivo={archivo} onQuitar={quitar} leyendo={leyendo} />
            </div>
          )}
        </div>
        {errores.length > 0 && (
          <ul className="px-4 pb-3 text-[12px] flex flex-col gap-0.5" style={{ color: P.alerta }}>
            {errores.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </Tarjeta>

      {mensaje && <Aviso tipo={mensaje.e ? "alerta" : "ok"}>{mensaje.t}</Aviso>}

      {/* ---------- Revisión antes de guardar ---------- */}
      {resultado && (
        <>
          {(resultado.errores.length > 0 || resultado.advertencias.length > 0) && (
            <div className="flex flex-col gap-1.5">
              {resultado.errores.map((t, i) => <Aviso key={`e${i}`} tipo="alerta">{t}</Aviso>)}
              {resultado.advertencias.map((t, i) => <Aviso key={`w${i}`} tipo="aviso">{t}</Aviso>)}
            </div>
          )}

          {resultado.bienes.length > 0 && (
            <>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <Indicador titulo="Fecha de corte" valor={resultado.fechaCorte ? fmtFechaCorta(resultado.fechaCorte) : "No encontrada"} pie="Leída del encabezado del reporte" />
                <Indicador titulo="Bienes" valor={tot.bienes.toLocaleString("es-EC")} pie={`${porAgencia.length} agencias · ${tot.depreciados.toLocaleString("es-EC")} ya depreciados`} />
                <Indicador titulo="Valor contable" valor={fmtUSD(tot.costo)} pie={`Depreciación acumulada ${fmtUSD(tot.dep)}`} />
                <Indicador titulo="Cuadre con el reporte" valor={cuadra === null ? "Sin total" : cuadra ? "Cuadra" : "No cuadra"}
                  color={cuadra === null ? P.aviso : cuadra ? P.ok : P.alerta}
                  pie={resultado.totalGeneral ? `Total General del archivo: ${fmtUSD2(resultado.totalGeneral.contable)}` : "El archivo no trae Total General"} />
              </div>

              <Tarjeta titulo="Resumen por agencia">
                <table className={TABLA}>
                  <thead>
                    <tr className="text-[11px] font-semibold" style={CABECERA}>
                      <th className="pl-4 text-left font-semibold">Agencia</th>
                      <th className="px-3 text-right font-semibold">Bienes</th>
                      <th className="px-3 text-right font-semibold">Valor contable</th>
                      <th className="px-3 text-right font-semibold">Dep. acumulada</th>
                      <th className="px-3 text-right font-semibold">Valor en libros</th>
                      <th className="px-3 text-right font-semibold">Dep. mensual</th>
                      <th className="pr-4 text-right font-semibold">Ya depreciados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porAgencia.map(([nombre, r]) => (
                      <tr key={nombre} style={{ borderTop: `1px solid ${P.beige}`, height: 32 }}>
                        <td className="pl-4" style={{ color: P.texto3 }}>{nombre}</td>
                        <td className="px-3 text-right">{r.bienes.toLocaleString("es-EC")}</td>
                        <td className="px-3 text-right">{fmtUSD(r.costo)}</td>
                        <td className="px-3 text-right">({fmtUSD(r.dep)})</td>
                        <td className="px-3 text-right font-semibold">{fmtUSD(r.costo - r.dep)}</td>
                        <td className="px-3 text-right">{fmtUSD(r.depMes)}</td>
                        <td className="pr-4 text-right" style={{ color: P.texto2 }}>{r.depreciados.toLocaleString("es-EC")}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold" style={{ borderTop: "1px solid #B9C3BD", height: 32 }}>
                      <td className="pl-4">Total</td>
                      <td className="px-3 text-right">{tot.bienes.toLocaleString("es-EC")}</td>
                      <td className="px-3 text-right">{fmtUSD(tot.costo)}</td>
                      <td className="px-3 text-right">({fmtUSD(tot.dep)})</td>
                      <td className="px-3 text-right">{fmtUSD(tot.costo - tot.dep)}</td>
                      <td className="px-3 text-right">{fmtUSD(tot.depMes)}</td>
                      <td className="pr-4 text-right">{tot.depreciados.toLocaleString("es-EC")}</td>
                    </tr>
                  </tbody>
                </table>
              </Tarjeta>
            </>
          )}

          <section className="tarjeta px-4 py-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12px]" style={{ color: P.texto2 }}>
              Ejercicio del presupuesto
              <input value={ejercicio} onChange={(e) => setEjercicio(Number(e.target.value.replace(/\D/g, "")) || 0)} inputMode="numeric"
                     aria-label="Ejercicio" className={`${CAMPO} w-20 text-right font-semibold`} style={{ border: BORDE_CAMPO, color: P.texto }} />
            </label>
            <span className="flex-1 min-w-[216px] text-[12px]" style={{ color: P.texto2 }}>
              {existente
                ? <>Ya existe una carga con corte al {fmtFecha(existente.fechaCorte)} ({existente.bienes.toLocaleString("es-EC")} bienes). <b style={{ color: P.aviso }}>Se reemplazará completa.</b></>
                : resultado.fechaCorte ? <>Se guardará como una nueva carga con corte al {fmtFecha(resultado.fechaCorte)}.</> : null}
            </span>
            <BotonSecundario onClick={quitar}>{cola.length ? "Omitir este archivo" : "Cancelar"}</BotonSecundario>
            <BotonPrimario onClick={guardar} disabled={bloqueado || guardando}>
              <Save className="w-4 h-4" /> {guardando ? "Guardando..." : existente ? "Reemplazar carga" : "Guardar en la base de datos"}
            </BotonPrimario>
          </section>
        </>
      )}

      {/* ---------- Cargas realizadas ---------- */}
      <Tarjeta titulo="Cargas realizadas">
        {cargas.length === 0 ? (
          <div className="p-8 text-center text-[12px]" style={{ color: P.texto2 }}>Todavía no se ha cargado ningún reporte de activos fijos.</div>
        ) : (
          <table className={TABLA}>
            <colgroup><col style={{ width: 90 }} /><col /><col /><col /><col /><col /><col style={{ width: 63 }} /></colgroup>
            <thead>
              <tr className="text-[11px] font-semibold" style={CABECERA}>
                <th className="pl-4 text-left font-semibold">Ejercicio</th>
                <th className="px-3 text-left font-semibold">Fecha de corte</th>
                <th className="px-3 text-right font-semibold">Bienes</th>
                <th className="px-3 text-right font-semibold">Valor contable</th>
                <th className="px-3 text-right font-semibold">Dep. acumulada</th>
                <th className="px-3 text-left font-semibold">Cargado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cargas.map((c, i) => (
                <tr key={`${c.ejercicio}-${c.fechaCorte}`} className="hover:bg-[#F5F7F6]" style={{ borderTop: `1px solid ${P.beige}`, height: 32 }}>
                  <td className="pl-4 font-semibold">{c.ejercicio}</td>
                  <td className="px-3" style={{ color: P.texto3 }}>
                    {fmtFecha(c.fechaCorte)}
                    {i === 0 && <span className="ml-2 text-[10px] font-semibold px-1.5 py-px rounded" style={{ background: P.okSuave, color: P.ok }}>Vigente</span>}
                  </td>
                  <td className="px-3 text-right">{Number(c.bienes).toLocaleString("es-EC")}</td>
                  <td className="px-3 text-right">{fmtUSD(Number(c.valorContable))}</td>
                  <td className="px-3 text-right">{fmtUSD(Number(c.depAcumulada))}</td>
                  <td className="px-3" style={{ color: P.texto2 }}>{new Date(String(c.cargadoEn).replace(" ", "T") + "Z").toLocaleString("es-EC")}</td>
                  <td className="text-center"><BotonEliminar onClick={() => setConfirmarEliminar(c)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>

      {confirmarEliminar && (
        <Modal titulo={`¿Eliminar la carga con corte al ${fmtFecha(confirmarEliminar.fechaCorte)}?`}
               onCancelar={() => setConfirmarEliminar(null)} onConfirmar={() => eliminar(confirmarEliminar)}>
          Se borran de la base de datos los {Number(confirmarEliminar.bienes).toLocaleString("es-EC")} bienes de esa carga (ejercicio {confirmarEliminar.ejercicio}). No se puede deshacer.
        </Modal>
      )}
    </>
  );
}
