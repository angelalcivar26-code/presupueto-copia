"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LOGO_LOGIN, NOMBRE_INSTITUCION, NOMBRE_SISTEMA, NOMBRE_MARCA, FUENTE_MARCA } from "../../lib/marca";

function destinoSeguro(valor: string | null): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/login")) return "/inicio";
  return valor;
}

const claseInput =
  "h-11 px-3 rounded-lg border border-[#D5DAD7] bg-white text-[14px] text-[#111418] outline-none focus:border-[#005A28] focus:ring-2 focus:ring-[#005A28]/20";
const claseBoton =
  "h-11 rounded-lg bg-[#005A28] text-white text-[14px] font-semibold hover:bg-[#004820] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
const claseEnlace = "text-[12px] font-semibold text-[#005A28] hover:underline";

function AvisoError({ texto }: { texto: string }) {
  return (
    <p role="alert" className="text-[12px] text-[#9B1C1C] bg-[#FDECEC] border border-[#F5C2C2] rounded-lg px-3 py-2">
      {texto}
    </p>
  );
}

function FormularioIngreso({ usuarioInicial, onOlvido }: { usuarioInicial: string; onOlvido: (usuario: string) => void }) {
  const params = useSearchParams();
  const [usuario, setUsuario] = useState(usuarioInicial);
  const [contrasena, setContrasena] = useState("");
  const [verContrasena, setVerContrasena] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function ingresar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, contrasena }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(datos.error ?? "No se pudo iniciar sesión.");
        setEnviando(false);
        return;
      }
      // Recarga completa: así la herramienta arranca con la sesión ya activa
      window.location.href = datos.debe_cambiar ? "/cuenta/contrasena" : destinoSeguro(params.get("siguiente"));
    } catch {
      setError("No hay conexión con el servidor. Intente de nuevo.");
      setEnviando(false);
    }
  }

  return (
    <>
      <h1 className="text-[14px] font-semibold text-[#26302B] mb-5">Iniciar sesión</h1>
      <form onSubmit={ingresar} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Usuario</span>
          <input type="text" autoComplete="username" autoFocus={!usuarioInicial} required value={usuario}
            onChange={(e) => setUsuario(e.target.value)} className={claseInput} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Contraseña</span>
          <div className="relative">
            <input type={verContrasena ? "text" : "password"} autoComplete="current-password" autoFocus={!!usuarioInicial}
              required value={contrasena} onChange={(e) => setContrasena(e.target.value)} className={`${claseInput} w-full pr-20`} />
            <button type="button" onClick={() => setVerContrasena(!verContrasena)}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-semibold text-[#005A28] hover:underline">
              {verContrasena ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </label>

        {error && <AvisoError texto={error} />}

        <button type="submit" disabled={enviando || !usuario || !contrasena} className={`mt-1 ${claseBoton}`}>
          {enviando ? "Ingresando…" : "Ingresar"}
        </button>

        <button type="button" onClick={() => onOlvido(usuario)} className={`${claseEnlace} self-center`}>
          ¿Olvidó su contraseña?
        </button>
      </form>
    </>
  );
}

function FormularioOlvido({ usuarioInicial, onVolver }: { usuarioInicial: string; onVolver: (usuario: string) => void }) {
  const [usuario, setUsuario] = useState(usuarioInicial);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/auth/restablecer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) setError(datos.error ?? "No se pudo procesar la solicitud.");
      else setEnviado(datos.mensaje);
    } catch {
      setError("No hay conexión con el servidor. Intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="w-12 h-12 rounded-full bg-[#E8F4EC] flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005A28" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <h1 className="mt-3 text-[14px] font-bold text-[#111418]">Revise su correo</h1>
        <p className="mt-2 text-[13px] text-[#4A554F] leading-relaxed">{enviado}</p>
        <p className="mt-2 text-[12px] text-[#6B7570] leading-relaxed">
          La clave vence en 30 minutos. Ingrésela en el campo <b>Contraseña</b>; luego el sistema le pedirá crear una nueva.
        </p>
        <button type="button" onClick={() => onVolver(usuario)} className={`mt-5 w-full ${claseBoton}`}>
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-[14px] font-semibold text-[#26302B]">Restablecer contraseña</h1>
      <p className="mt-1.5 mb-5 text-[12px] text-[#4A554F] leading-relaxed">
        Ingrese su usuario y le enviaremos una clave temporal al correo registrado.
      </p>
      <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Usuario</span>
          <input type="text" autoComplete="username" autoFocus required value={usuario}
            onChange={(e) => setUsuario(e.target.value)} className={claseInput} />
        </label>

        {error && <AvisoError texto={error} />}

        <button type="submit" disabled={enviando || !usuario.trim()} className={`mt-1 ${claseBoton}`}>
          {enviando ? "Enviando…" : "Enviar clave temporal"}
        </button>
        <button type="button" onClick={() => onVolver(usuario)} className={`${claseEnlace} self-center`}>
          ← Volver a iniciar sesión
        </button>
      </form>
    </>
  );
}

function Contenido() {
  const [vista, setVista] = useState<"ingreso" | "olvido">("ingreso");
  const [usuario, setUsuario] = useState("");
  return vista === "ingreso" ? (
    <FormularioIngreso key="ingreso" usuarioInicial={usuario} onOlvido={(u) => { setUsuario(u); setVista("olvido"); }} />
  ) : (
    <FormularioOlvido key="olvido" usuarioInicial={usuario} onVolver={(u) => { setUsuario(u); setVista("ingreso"); }} />
  );
}

export default function PaginaLogin() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4" style={{ background: "#EEF1EF" }}>
      <div className="w-full max-w-[342px] bg-white rounded-2xl border border-[#E3E6E4] shadow-sm px-8 py-9">
        <div className="flex flex-col items-center text-center mb-7 pb-6 border-b border-[#EEF0EE]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_LOGIN} alt={NOMBRE_INSTITUCION} width={72} height={60} className="w-[72px] h-auto" />
          <span className="mt-4 text-[22px] font-semibold text-[#111418] leading-tight" style={{ fontFamily: FUENTE_MARCA }}>{NOMBRE_MARCA}</span>
          <span className="mt-1.5 text-[12px] font-medium text-[#4A554F]">{NOMBRE_SISTEMA}</span>
        </div>
        <Suspense fallback={null}>
          <Contenido />
        </Suspense>
      </div>
    </div>
  );
}
