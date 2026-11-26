"use client";

import { useEffect, useState } from "react";

interface Sesion { usuario: string; nombre: string | null; es_admin: boolean; debe_cambiar: boolean }

function iniciales(texto: string): string {
  const partes = texto.trim().split(/[\s._-]+/).filter(Boolean);
  const letras = partes.length >= 2 ? partes[0][0] + partes[1][0] : texto.slice(0, 2);
  return letras.toUpperCase();
}

/** 0 a 4: largo, largo holgado, letras + números, mayúsculas y minúsculas o símbolos. */
function puntaje(c: string): number {
  if (!c) return 0;
  let p = 0;
  if (c.length >= 8) p++;
  if (c.length >= 12) p++;
  if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(c) && /\d/.test(c)) p++;
  if ((/[a-záéíóúñ]/.test(c) && /[A-ZÁÉÍÓÚÑ]/.test(c)) || /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(c)) p++;
  return c.length < 8 ? Math.min(p, 1) : p;
}
const NIVELES = [
  { texto: "", color: "#E3E6E4" },
  { texto: "Débil", color: "#C0392B" },
  { texto: "Aceptable", color: "#C38A03" },
  { texto: "Buena", color: "#3F8F5A" },
  { texto: "Fuerte", color: "#005A28" },
];

function IconoOjo({ abierto }: { abierto: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!abierto && <path d="M3 3l18 18" />}
    </svg>
  );
}

function Requisito({ cumple, texto }: { cumple: boolean; texto: string }) {
  return (
    <li className={`flex items-center gap-2 text-[11px] transition-colors ${cumple ? "text-[#0B5A2A]" : "text-[#6B7570]"}`}>
      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors ${cumple ? "bg-[#005A28]" : "border border-[#C9CFCC]"}`}>
        {cumple && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
        )}
      </span>
      {texto}
    </li>
  );
}

function CampoContrasena({
  id, etiqueta, valor, onCambio, autoComplete, error,
}: { id: string; etiqueta: string; valor: string; onCambio: (v: string) => void; autoComplete: string; error?: boolean }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold text-[#26302B]">{etiqueta}</label>
      <div className="relative">
        <input
          id={id}
          type={ver ? "text" : "password"}
          autoComplete={autoComplete}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          aria-invalid={error || undefined}
          className={`w-full h-10 pl-3 pr-11 rounded-lg border bg-white text-[14px] text-[#111418] outline-none transition-colors focus:ring-2 ${
            error ? "border-[#D97979] focus:border-[#C0392B] focus:ring-[#C0392B]/15" : "border-[#D5DAD7] focus:border-[#005A28] focus:ring-[#005A28]/20"
          }`}
        />
        <button
          type="button"
          onClick={() => setVer(!ver)}
          aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-md text-[#6B7570] hover:text-[#005A28] hover:bg-[#EEF3EF]"
        >
          <IconoOjo abierto={ver} />
        </button>
      </div>
    </div>
  );
}

export default function CambiarContrasena() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    fetch("/api/auth/sesion").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSesion(d)).catch(() => undefined);
  }, []);

  const reqLargo = nueva.length >= 8;
  const reqMezcla = /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(nueva) && /\d/.test(nueva);
  const reqDistinta = nueva.length > 0 && nueva !== actual;
  const reqCoincide = confirmacion.length > 0 && nueva === confirmacion;
  const todoOk = actual.length > 0 && reqLargo && reqMezcla && reqDistinta && reqCoincide;
  const nivel = NIVELES[puntaje(nueva)];

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!todoOk) return;
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/cambiar-contrasena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva, confirmacion }),
      });
      const datos = await r.json().catch(() => ({}));
      if (r.ok) {
        setListo(true);
        setSesion((s) => (s ? { ...s, debe_cambiar: false } : s));
        setActual("");
        setNueva("");
        setConfirmacion("");
      } else {
        setError(datos.error ?? "No se pudo cambiar la contraseña.");
      }
    } catch {
      setError("No hay conexión con el servidor. Intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  const nombreVisible = sesion?.nombre || sesion?.usuario || "";
  const obligatorio = !!sesion?.debe_cambiar;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-[414px]">
        <div className="bg-white rounded-2xl border border-[#E3E6E4] shadow-[0_1px_3px_rgba(17,20,24,0.04)] overflow-hidden">
          {/* Encabezado: título y cuenta en una sola fila */}
          <div className="px-6 py-4 border-b border-[#EEF0EE] flex items-center gap-3 min-h-[65px]">
            <span className="w-10 h-10 rounded-full bg-[#005A28] text-white text-[13px] font-bold flex items-center justify-center shrink-0">
              {sesion ? iniciales(nombreVisible) : ""}
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-[#111418] leading-tight">Cambiar contraseña</h1>
              <p className="text-[12px] text-[#6B7570] truncate">
                {sesion ? `${nombreVisible}${sesion.nombre ? ` (@${sesion.usuario})` : ""} · ${sesion.es_admin ? "Administrador" : "Usuario"}` : "\u00a0"}
              </p>
            </div>
          </div>

          {listo ? (
            <div className="px-6 py-8 flex flex-col items-center text-center">
              <span className="w-14 h-14 rounded-full bg-[#E8F4EC] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#005A28" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              </span>
              <h2 className="mt-4 text-[15px] font-bold text-[#111418]">Contraseña actualizada</h2>
              <p className="mt-2 text-[13px] text-[#4A554F] max-w-[288px]">
                Úsela desde su próximo ingreso. Si tenía la sesión abierta en otro equipo, se cerrará en menos de un minuto.
              </p>
              <div className="flex gap-2 mt-6">
                {/* Recarga completa: la herramienta vuelve a cargar sus datos con la sesión ya habilitada */}
                <a href="/inicio" className="h-10 px-4 rounded-lg bg-[#005A28] text-white text-[13px] font-semibold hover:bg-[#004820] flex items-center">
                  Ir al inicio
                </a>
                <button type="button" onClick={() => setListo(false)} className="h-10 px-4 rounded-lg text-[13px] text-[#26302B] hover:bg-[#EEF3EF]">
                  Cambiarla otra vez
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={guardar} className="px-6 py-5 flex flex-col gap-3.5" noValidate>
              <input type="text" autoComplete="username" value={sesion?.usuario ?? ""} className="hidden" readOnly />

              {obligatorio && (
                <div role="status" className="text-[12px] leading-relaxed text-[#7A5600] bg-[#FBF3E0] border border-[#EBD39A] rounded-lg px-3 py-2.5">
                  Por seguridad, cree su propia contraseña para continuar. En el primer campo escriba la
                  clave temporal con la que ingresó.
                </div>
              )}
              <CampoContrasena id="actual" etiqueta={obligatorio ? "Clave temporal" : "Contraseña actual"} valor={actual} onCambio={setActual} autoComplete="current-password" />

              <div className="flex flex-col gap-2">
                <CampoContrasena id="nueva" etiqueta="Nueva contraseña" valor={nueva} onCambio={setNueva} autoComplete="new-password" />
                <div className="flex items-center gap-3" aria-live="polite">
                  <div className="flex-1 grid grid-cols-4 gap-1.5">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className="h-1.5 rounded-full transition-colors"
                        style={{ background: puntaje(nueva) >= i ? nivel.color : "#E3E6E4" }} />
                    ))}
                  </div>
                  <span className="w-[63px] text-right text-[11px] font-semibold" style={{ color: nivel.color }}>{nivel.texto}</span>
                </div>
              </div>

              <CampoContrasena
                id="confirmacion" etiqueta="Confirmar nueva contraseña" valor={confirmacion} onCambio={setConfirmacion}
                autoComplete="new-password" error={confirmacion.length > 0 && !reqCoincide}
              />

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 bg-[#F6F8F7] rounded-lg px-4 py-2.5">
                <Requisito cumple={reqLargo} texto="Mínimo 8 caracteres" />
                <Requisito cumple={reqMezcla} texto="Letras y números" />
                <Requisito cumple={reqDistinta} texto="Distinta de la actual" />
                <Requisito cumple={reqCoincide} texto="Confirmación coincide" />
              </ul>

              {error && (
                <p role="alert" className="text-[12px] text-[#9B1C1C] bg-[#FDECEC] border border-[#F5C2C2] rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={enviando || !todoOk}
                className="mt-1 h-10 rounded-lg bg-[#005A28] text-white text-[13px] font-semibold hover:bg-[#004820] disabled:bg-[#9DB8A7] disabled:cursor-not-allowed transition-colors"
              >
                {enviando ? "Guardando…" : "Guardar nueva contraseña"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
