"use client";

import { ejercicioFueElegido, useEjercicio } from "../../lib/seleccion";
import { apiFetch, errorDeRespuesta } from "../../lib/useDatos";
import { MensajeError } from "../../components/GuardiaCambios";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, MoreHorizontal, Copy, Check } from "lucide-react";
import Link from "next/link";
import { useEscucharSincronizacion } from "../../lib/cache-sistema";
import { EsqueletoTabla } from "../../components/Carga";

/**
 * INICIO: pantalla limpia con el ejercicio en elaboración (abrir, avance y usar como base)
 * y la tarjeta para crear un ejercicio nuevo. Mismo estilo institucional que Cartera y Activos.
 */

interface Ejercicio {
  id: number;
  anio: number;
  nombre: string;
  estado: "activo" | "archivado";
  creado_en: string;
}

// Paleta institucional (misma de Cartera y Activos)
const C = {
  texto: "#111418", texto2: "#3D4843", texto3: "#26302B", tenue: "#C4CAC6",
  borde: "#D5DBD7", beige: "#E6EAE8", crema: "#F3F5F4",
  acento: "#005A28", acentoSuave: "#E3EEE7",
  ok: "#1E6B3A", okSuave: "#E3F1E7",
  aviso: "#B7791F", avisoSuave: "#FBF1DC",
  alerta: "#B42318", alertaSuave: "#FBE4E1",
};
const FONDO = "#EEF1EF";
const BORDE_EDICION = "#8DB39B";


// ---------- estado del ejercicio: qué secciones tienen datos en cada agencia (lectura directa de la base) ----------
interface Seccion { id: string; label: string; href: string; listas: string[]; faltan?: Record<string, string> }
interface Resumen { agencias: string[]; secciones: Seccion[] }

async function cargarResumen(anio: number): Promise<Resumen | null> {
  const d = await apiFetch(`/api/avance?ejercicio=${anio}`).then((r) => r.json()).catch(() => null);
  return d?.secciones ? d as Resumen : null;
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5">{children}</div>
    </div>
  );
}

const BOTON_SEC = "h-9 px-4 rounded-md bg-white text-[12px] font-semibold flex items-center gap-2 hover:bg-[#F3F5F4] disabled:opacity-50";
const BOTON_PRI = "h-9 px-4 rounded-md text-white text-[12px] font-semibold flex items-center gap-2 hover:opacity-90 disabled:opacity-50";

export default function InicioPage() {
  const router = useRouter();
  const [ejercicios, setEjercicios] = useState<Ejercicio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarArchivados, setMostrarArchivados] = useState(false);

  const [creando, setCreando] = useState(false);
  const [nuevoAnio, setNuevoAnio] = useState("");
  const [nuevoModo, setNuevoModo] = useState<"copiar" | "blanco">("copiar");
  const [anioOrigen, setAnioOrigen] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorEj, setErrorEj] = useState<string | null>(null);
  const [ejercicioEnUso, setEjercicioEnUso] = useEjercicio();
  /** Envía un cambio de ejercicio; si el servidor lo rechaza, muestra su mensaje y devuelve false. */
  async function enviar(url: string, init: RequestInit): Promise<boolean> {
    setErrorEj(null);
    try {
      const r = await apiFetch(url, init);
      const e = await errorDeRespuesta(r);
      if (e) { setErrorEj(e); return false; }
      return true;
    } catch { setErrorEj("No se pudo conectar con el servidor."); return false; }
  }

  const [menuId, setMenuId] = useState<number | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");

  const [confirmarArchivar, setConfirmarArchivar] = useState<Ejercicio | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState<Ejercicio | null>(null);

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const ticketSync = useEscucharSincronizacion();

  function cargar() {
    setCargando(true);
    apiFetch("/api/ejercicios")
      .then((r) => r.json())
      .then((data) => setEjercicios(data.ejercicios ?? []))
      .finally(() => setCargando(false));
  }
  useEffect(cargar, [ticketSync]);

  const activos = ejercicios.filter((e) => e.estado === "activo").sort((a, b) => b.anio - a.anio);
  const archivados = ejercicios.filter((e) => e.estado === "archivado").sort((a, b) => b.anio - a.anio);
  const ultimoActivo = activos[0] ?? null;

  useEffect(() => {
    if (!ultimoActivo) { setResumen(null); return; }
    cargarResumen(ultimoActivo.anio).then(setResumen).catch(() => setResumen(null));
  }, [ultimoActivo?.anio, ticketSync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sin un ejercicio elegido en este navegador, o si el elegido ya no está activo: el más reciente.
  useEffect(() => {
    if (!ultimoActivo) return;
    if (!ejercicioFueElegido() || !activos.some((e) => e.anio === ejercicioEnUso)) setEjercicioEnUso(ultimoActivo.anio);
  }, [ultimoActivo?.anio, activos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function abrirEjercicio(anio: number) {
    setEjercicioEnUso(anio);
    router.push(`/proyeccion-egresos?ejercicio=${anio}`);
  }

  function iniciarCreacion(origen: number | null) {
    const base = origen ?? ultimoActivo?.anio ?? 2026;
    setAnioOrigen(origen ?? ultimoActivo?.anio ?? null);
    setNuevoModo(origen || ultimoActivo ? "copiar" : "blanco");
    setNuevoAnio(String(base + 1));
    setCreando(true);
  }

  async function crearEjercicio() {
    const anio = Number(nuevoAnio);
    if (!anio || anio < 2000) return;
    setGuardando(true);
    try {
      const ok = await enviar("/api/ejercicios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anio,
          nombre: `Presupuesto ${anio}`,
          modo: nuevoModo,
          anioOrigen: nuevoModo === "copiar" ? anioOrigen ?? undefined : undefined,
        }),
      });
      if (!ok) return;
      setCreando(false);
      setNuevoAnio("");
      cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function guardarNombre(id: number) {
    if (!nuevoNombre.trim()) { setEditandoId(null); return; }
    await enviar("/api/ejercicios", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, nombre: nuevoNombre.trim() }),
    });
    setEditandoId(null);
    cargar();
  }

  async function archivar(ejercicio: Ejercicio) {
    await enviar("/api/ejercicios", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ejercicio.id, estado: "archivado" }),
    });
    setConfirmarArchivar(null);
    cargar();
  }

  async function restaurar(ejercicio: Ejercicio) {
    await enviar("/api/ejercicios", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ejercicio.id, estado: "activo" }),
    });
    cargar();
  }

  async function eliminarDefinitivo(ejercicio: Ejercicio) {
    await enviar(`/api/ejercicios?id=${ejercicio.id}`, { method: "DELETE" });
    setConfirmarEliminar(null);
    cargar();
  }

  // ---------- avance ----------
  // una agencia está completa cuando cumple lo que el cálculo necesita en todas las secciones
  const completas = resumen ? resumen.agencias.filter((a) => resumen.secciones.every((s) => s.listas.includes(a))).length : 0;
  const listo = resumen ? resumen.agencias.length > 0 && completas === resumen.agencias.length : false;

  return (
    <div className="estilo-institucional min-h-screen px-6 py-6 flex flex-col gap-5" style={{ background: FONDO, color: C.texto, fontVariantNumeric: "tabular-nums" }}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-tight">Presupuestos institucionales</h1>
        {!cargando && activos.length > 0 && !creando && (
          <button type="button" onClick={() => iniciarCreacion(null)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>
            <Plus size={15} /> Nuevo ejercicio</button>
        )}
      </div>
      <MensajeError texto={errorEj} />

      {cargando ? (
        <EsqueletoTabla indicadores={false} filas={4} />
      ) : (
        <div className={`grid grid-cols-1 xl:grid-cols-3 gap-4 ${creando ? "items-start" : "items-stretch"}`}>
          {/* Ejercicios activos: el más reciente ocupa dos columnas */}
          {activos.map((ej) => {
            const esPrincipal = ej.id === ultimoActivo?.id;
            return (
              <section key={ej.id} className={`tarjeta px-6 py-5 flex flex-col gap-5 ${esPrincipal ? `lg:flex-row lg:gap-8 ${creando ? "xl:col-span-2" : "xl:col-span-3"}` : ""}`}>
               <div className="flex-1 min-w-0 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {editandoId === ej.id ? (
                      <div className="flex items-center gap-2">
                        <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} autoFocus aria-label="Nombre del ejercicio"
                               onKeyDown={(e) => { if (e.key === "Enter") guardarNombre(ej.id); }}
                               className="flex-1 h-9 text-[14px] rounded-md px-3" style={{ border: `1px solid ${BORDE_EDICION}` }} />
                        <button type="button" onClick={() => setEditandoId(null)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
                        <button type="button" onClick={() => guardarNombre(ej.id)} className={BOTON_PRI} style={{ background: C.acento }}>Guardar</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-[20px] font-semibold leading-tight">{ej.nombre}</h2>
                        {ej.anio === ejercicioEnUso && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: "#E3EEE7", color: C.acento }}>En uso</span>
                        )}
                        {esPrincipal && resumen && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                                style={listo ? { background: C.okSuave, color: C.ok } : { background: C.avisoSuave, color: "#7A4F0E" }}>
                            {listo ? "Datos completos" : "En elaboración"}
                          </span>
                        )}
                      </div>
                    )}
                    <span className="text-[12px]" style={{ color: C.texto2 }}>
                      Ejercicio {ej.anio}
                      {esPrincipal && resumen && <> · {completas} de {resumen.agencias.length} agencias con todas las secciones</>}
                    </span>
                  </div>
                  <div className="relative">
                    <button type="button" aria-label="Más opciones" aria-expanded={menuId === ej.id}
                            onClick={() => setMenuId(menuId === ej.id ? null : ej.id)}
                            className="w-9 h-9 rounded-md bg-white flex items-center justify-center hover:bg-[#F3F5F4]" style={{ border: "1px solid #C9D0CC" }}>
                      <MoreHorizontal size={16} color={C.texto} />
                    </button>
                    {menuId === ej.id && (
                      <div className="absolute right-0 top-11 z-20 w-44 rounded-md bg-white shadow-lg py-1" style={{ border: `1px solid ${C.borde}` }}>
                        <button type="button" className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-[#F3F5F4]"
                                onClick={() => { setMenuId(null); setEditandoId(ej.id); setNuevoNombre(ej.nombre); }}>Editar nombre</button>
                        <button type="button" className="w-full text-left px-3.5 py-2 text-[12px] hover:bg-[#FBE4E1]" style={{ color: C.alerta }}
                                onClick={() => { setMenuId(null); setConfirmarArchivar(ej); }}>Eliminar</button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 mt-auto">
                  <button type="button" onClick={() => abrirEjercicio(ej.anio)} className={BOTON_PRI} style={{ background: C.acento }}>
                    Abrir ejercicio {ej.anio} <ArrowRight size={15} />
                  </button>
                  <button type="button" onClick={() => iniciarCreacion(ej.anio)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>
                    <Copy size={15} /> Usar como base para {ej.anio + 1}
                  </button>
                </div>
               </div>

                {/* Secciones del ejercicio: cuántas agencias tienen datos en cada una (clic para ir a la sección) */}
                {esPrincipal && resumen && (
                  <div className="lg:w-[52%] shrink-0 lg:pl-8 lg:border-l flex flex-col gap-2" style={{ borderColor: C.beige }}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.texto2 }}>Secciones · agencias completas</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                      {resumen.secciones.map((sec) => {
                        const n = sec.listas.length, total = resumen.agencias.length, ok = n === total;
                        const faltan = resumen.agencias.filter((a) => !sec.listas.includes(a));
                        return (
                          <Link key={sec.id} href={sec.href} className="flex items-center gap-2 h-8 text-[12.5px] hover:underline" style={{ borderBottom: `1px solid ${C.crema}`, color: C.texto }}
                                title={ok ? "Todas las agencias completas" : faltan.map((a) => `${a}: ${sec.faltan?.[a] ?? "sin datos"}`).join("\n")}>
                            {ok ? <Check size={14} color={C.ok} strokeWidth={2.4} className="shrink-0" />
                              : <span className="w-[14px] flex justify-center shrink-0"><span className="w-[7px] h-[7px] rounded-full" style={{ background: C.aviso }} /></span>}
                            <span className="flex-1 truncate">{sec.label}</span>
                            <span className="tabular-nums" style={{ color: ok ? C.texto2 : "#7A4F0E", fontWeight: ok ? 400 : 600 }}>{n}/{total}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {/* Crear un ejercicio nuevo */}
          {!creando ? (activos.length > 0 ? null :
            <button type="button" onClick={() => iniciarCreacion(null)}
                    className="tarjeta flex flex-col items-center justify-center gap-2.5 py-8 px-5 hover:bg-[#F7F9F8] text-center">
              <span className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: C.acentoSuave }}>
                <Plus size={20} color={C.acento} strokeWidth={2.2} />
              </span>
              <span className="text-[14px] font-semibold">Crear nuevo ejercicio</span>
              <span className="text-[12px] max-w-[234px] leading-snug" style={{ color: C.texto2 }}>Desde cero o copiando la estructura de un ejercicio anterior</span>
            </button>
          ) : (
            <section className="tarjeta p-5 flex flex-col gap-3" style={{ borderColor: BORDE_EDICION, boxShadow: `0 0 0 2px ${C.acentoSuave}` }}>
              <h2 className="text-[14px] font-semibold">Nuevo ejercicio</h2>
              <label className="flex flex-col gap-1.5 text-[12px]" style={{ color: C.texto2 }}>
                Año
                <input value={nuevoAnio} onChange={(e) => setNuevoAnio(e.target.value)} inputMode="numeric"
                       className="w-28 h-9 text-[13px] rounded-md px-3" style={{ border: "1px solid #C9D0CC", color: C.texto }} />
              </label>
              <p className="text-[12px]" style={{ color: C.texto2 }}>¿Cómo quieres empezar?</p>
              <label className="flex items-start gap-2 text-[12px] p-3 rounded-md cursor-pointer"
                     style={{ border: `1px solid ${nuevoModo === "copiar" ? C.acento : C.borde}`, background: nuevoModo === "copiar" ? "#F5F9F6" : "#FFFFFF" }}>
                <input type="radio" checked={nuevoModo === "copiar"} onChange={() => setNuevoModo("copiar")} disabled={!anioOrigen}
                       className="mt-0.5" style={{ accentColor: C.acento }} />
                <span>
                  <b className="font-semibold">Copiar estructura de {anioOrigen ?? "—"}</b><br />
                  <span style={{ color: C.texto2 }}>Mismas hojas y cuentas, mismo modo Directo/Prorrateado, montos en $0.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px] p-3 rounded-md cursor-pointer"
                     style={{ border: `1px solid ${nuevoModo === "blanco" ? C.acento : C.borde}`, background: nuevoModo === "blanco" ? "#F5F9F6" : "#FFFFFF" }}>
                <input type="radio" checked={nuevoModo === "blanco"} onChange={() => setNuevoModo("blanco")} className="mt-0.5" style={{ accentColor: C.acento }} />
                <span>
                  <b className="font-semibold">Empezar en blanco</b><br />
                  <span style={{ color: C.texto2 }}>Sin hojas ni cuentas; las vas creando desde cero.</span>
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCreando(false)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
                <button type="button" onClick={crearEjercicio} disabled={guardando || !nuevoAnio} className={BOTON_PRI} style={{ background: C.acento }}>
                  {guardando ? "Creando..." : `Crear ejercicio ${nuevoAnio || ""}`}
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Archivados */}
      {archivados.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setMostrarArchivados((v) => !v)} className="self-start text-[12px] font-semibold hover:underline" style={{ color: C.acento }}>
            {mostrarArchivados ? "Ocultar archivados" : `Ver archivados (${archivados.length})`}
          </button>
          {mostrarArchivados && (
            <div className="tarjeta overflow-hidden">
              {archivados.map((ej, i) => (
                <div key={ej.id} className="flex items-center justify-between px-5 py-3 text-[12px]" style={{ borderTop: i ? `1px solid ${C.beige}` : undefined }}>
                  <span style={{ color: C.texto }}>{ej.nombre}</span>
                  <div className="flex items-center gap-4">
                    <button type="button" onClick={() => restaurar(ej)} className="text-[12px] font-semibold hover:underline" style={{ color: C.acento }}>Restaurar</button>
                    <button type="button" onClick={() => setConfirmarEliminar(ej)} className="text-[12px] hover:underline" style={{ color: C.alerta }}>Eliminar definitivamente</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmarArchivar && (
        <Modal>
          <p className="text-[14px] font-semibold mb-2">¿Eliminar &quot;{confirmarArchivar.nombre}&quot;?</p>
          <p className="text-[12px] mb-4" style={{ color: C.texto2 }}>
            No se borra nada todavía: pasa a Archivados, donde puedes restaurarlo o eliminarlo definitivamente más tarde.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmarArchivar(null)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
            <button type="button" onClick={() => archivar(confirmarArchivar)} className={BOTON_PRI} style={{ background: C.texto }}>Sí, eliminar</button>
          </div>
        </Modal>
      )}

      {confirmarEliminar && (
        <Modal>
          <p className="text-[14px] font-semibold mb-2">¿Eliminar &quot;{confirmarEliminar.nombre}&quot; para siempre?</p>
          <p className="text-[12px] mb-4" style={{ color: C.alerta }}>
            Esto sí borra todas sus hojas, cuentas y valores de la base de datos. No se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmarEliminar(null)} className={BOTON_SEC} style={{ border: "1px solid #C9D0CC", color: C.texto }}>Cancelar</button>
            <button type="button" onClick={() => eliminarDefinitivo(confirmarEliminar)} className={BOTON_PRI} style={{ background: C.alerta }}>Sí, eliminar para siempre</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
