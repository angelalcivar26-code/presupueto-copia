"use client";

import { useCallback, useEffect, useState } from "react";
import { BotonRespaldo } from "../../../components/BotonRespaldo";

interface Usuario {
  id_usuario: number;
  usuario: string;
  nombre: string | null;
  correo: string | null;
  es_admin: boolean;
  rol?: Rol;
  activo: boolean;
  creado_en: string | null;
}

type Rol = "administrador" | "edicion" | "consulta";
const ROLES: { valor: Rol; etiqueta: string; descripcion: string }[] = [
  { valor: "administrador", etiqueta: "Administrador", descripcion: "Edita todo y gestiona usuarios, ejercicios y respaldos" },
  { valor: "edicion", etiqueta: "Edición", descripcion: "Registra y modifica los datos del presupuesto" },
  { valor: "consulta", etiqueta: "Consulta", descripcion: "Solo ve la información; no puede guardar cambios" },
];
const rolDe = (u: Usuario): Rol => u.rol ?? (u.es_admin ? "administrador" : "edicion");

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

const claseInput =
  "h-10 px-3 rounded-lg border border-[#D5DAD7] bg-white text-[13px] text-[#111418] outline-none focus:border-[#005A28] focus:ring-2 focus:ring-[#005A28]/20";
const claseBotonPrincipal =
  "h-10 px-4 rounded-lg bg-[#005A28] text-white text-[13px] font-semibold hover:bg-[#004820] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
const claseBotonSecundario =
  "h-8 px-2.5 rounded-md border border-[#D5DAD7] bg-white text-[12px] text-[#0B0F0D] hover:bg-[#EEF3EF] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

/** Contraseña temporal: 10 caracteres con letras y números (sin 0/O ni 1/l para evitar confusiones). */
function generarTemporal(): string {
  const letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const azar = new Uint32Array(10);
  crypto.getRandomValues(azar);
  const chars = Array.from(azar, (n) => todos[n % todos.length]);
  chars[azar[0] % 10] = numeros[azar[1] % numeros.length];
  if (!chars.some((c) => letras.includes(c))) chars[(azar[0] + 1) % 10] = letras[azar[2] % letras.length];
  return chars.join("");
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

function Etiqueta({ texto, tono }: { texto: string; tono: "verde" | "dorado" | "gris" | "rojo" }) {
  const estilos = {
    verde: "bg-[#E8F4EC] text-[#0B5A2A] border-[#B9DEC6]",
    dorado: "bg-[#FBF3E0] text-[#7A5600] border-[#EBD39A]",
    gris: "bg-[#F1F3F2] text-[#4A554F] border-[#DDE1DF]",
    rojo: "bg-[#FDECEC] text-[#9B1C1C] border-[#F5C2C2]",
  }[tono];
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${estilos}`}>{texto}</span>;
}

function FormularioNuevo({ onCreado, onCancelar }: { onCreado: (msg: string) => void; onCancelar: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState(() => generarTemporal());
  const [rol, setRol] = useState<Rol>("edicion");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, nombre, correo, contrasena, rol }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo crear el usuario."); return; }
      onCreado(`${d.mensaje} Contraseña temporal: ${contrasena} — entréguesela; al ingresar, el sistema le pedirá crear la suya.`);
    } catch {
      setError("No hay conexión con el servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={crear} className="bg-white rounded-2xl border border-[#E3E6E4] px-6 py-5 mb-5">
      <h2 className="text-[14px] font-bold text-[#111418] mb-4">Nuevo usuario</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Usuario *</span>
          <input className={claseInput} value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="ej. mperez" autoComplete="off" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Nombre completo</span>
          <input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej. María Pérez" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Correo</span>
          <input type="email" className={claseInput} value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="para recuperar su contraseña" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[#26302B]">Contraseña temporal *</span>
          <div className="flex gap-2">
            <input className={`${claseInput} flex-1 min-w-0 font-mono`} value={contrasena} onChange={(e) => setContrasena(e.target.value)} autoComplete="off" />
            <button type="button" className={`${claseBotonSecundario} h-10`} onClick={() => setContrasena(generarTemporal())}>Generar</button>
          </div>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 mt-4 max-w-md">
        <span className="text-[12px] font-semibold text-[#26302B]">Perfil *</span>
        <select className={claseInput} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
          {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta} — {r.descripcion}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="mt-3 text-[12px] text-[#9B1C1C]">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button type="submit" className={claseBotonPrincipal} disabled={enviando || !usuario || !contrasena}>
          {enviando ? "Creando…" : "Crear usuario"}
        </button>
        <button type="button" className="h-10 px-4 rounded-lg text-[13px] text-[#26302B] hover:bg-[#EEF3EF]" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function EditarDatos({ u, onListo, onCancelar }: { u: Usuario; onListo: (msg: string) => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(u.nombre ?? "");
  const [correo, setCorreo] = useState(u.correo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch(`/api/usuarios/${u.id_usuario}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, correo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      onListo(d.mensaje ?? "Datos actualizados.");
    } catch {
      setError("No hay conexión con el servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-wrap items-end gap-2 py-1">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-[#26302B]">Nombre completo</span>
        <input className={`${claseInput} h-8 w-[180px] text-[12px]`} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-[#26302B]">Correo</span>
        <input type="email" className={`${claseInput} h-8 w-[216px] text-[12px]`} value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="off" />
      </label>
      <button type="submit" className={`${claseBotonSecundario} !bg-[#005A28] !text-white !border-[#005A28]`} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" className={claseBotonSecundario} onClick={onCancelar}>Cancelar</button>
      {error && <span role="alert" className="text-[12px] text-[#9B1C1C] w-full">{error}</span>}
    </form>
  );
}

function Restablecer({ u, onListo, onCancelar }: { u: Usuario; onListo: (msg: string) => void; onCancelar: () => void }) {
  const [contrasena, setContrasena] = useState(() => generarTemporal());
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch(`/api/usuarios/${u.id_usuario}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contrasena }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo restablecer."); return; }
      onListo(`${d.mensaje} Nueva contraseña temporal: ${contrasena}`);
    } catch {
      setError("No hay conexión con el servidor.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-[12px] text-[#26302B]">Nueva contraseña temporal para <b>{u.usuario}</b>:</span>
      <input className={`${claseInput} h-8 w-[144px] font-mono text-[12px]`} value={contrasena} onChange={(e) => setContrasena(e.target.value)} autoComplete="off" />
      <button type="button" className={claseBotonSecundario} onClick={() => setContrasena(generarTemporal())}>Generar</button>
      <button type="button" className={`${claseBotonSecundario} !bg-[#005A28] !text-white !border-[#005A28]`} disabled={enviando || !contrasena} onClick={guardar}>
        {enviando ? "Guardando…" : "Restablecer"}
      </button>
      <button type="button" className={claseBotonSecundario} onClick={onCancelar}>Cancelar</button>
      {error && <span role="alert" className="text-[12px] text-[#9B1C1C] w-full">{error}</span>}
    </div>
  );
}

export default function AdministracionUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [yo, setYo] = useState<number | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [creando, setCreando] = useState(false);
  const [restableciendo, setRestableciendo] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/usuarios");
      if (r.status === 403) { setSinPermiso(true); return; }
      const d = await r.json();
      if (!r.ok) { setAviso({ tipo: "error", texto: d.error ?? "No se pudo cargar la lista." }); return; }
      setUsuarios(d.usuarios);
      setYo(d.yo);
    } catch {
      setAviso({ tipo: "error", texto: "No hay conexión con el servidor." });
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(u: Usuario, cambios: Partial<Pick<Usuario, "activo">> & { rol?: Rol }) {
    setAviso(null);
    setOcupado(u.id_usuario);
    try {
      const r = await fetch(`/api/usuarios/${u.id_usuario}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const d = await r.json().catch(() => ({}));
      setAviso({ tipo: r.ok ? "ok" : "error", texto: d.mensaje ?? d.error ?? "Listo." });
      if (r.ok) await cargar();
    } catch {
      setAviso({ tipo: "error", texto: "No hay conexión con el servidor." });
    } finally {
      setOcupado(null);
    }
  }

  async function eliminar(u: Usuario) {
    if (!window.confirm(`¿Eliminar al usuario "${u.usuario}"? Esta acción no se puede deshacer.\n\nSi solo quiere impedir que ingrese, use "Desactivar".`)) return;
    setAviso(null);
    setOcupado(u.id_usuario);
    try {
      const r = await fetch(`/api/usuarios/${u.id_usuario}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      setAviso({ tipo: r.ok ? "ok" : "error", texto: d.mensaje ?? d.error ?? "Listo." });
      if (r.ok) await cargar();
    } catch {
      setAviso({ tipo: "error", texto: "No hay conexión con el servidor." });
    } finally {
      setOcupado(null);
    }
  }

  if (sinPermiso) {
    return (
      <div className="px-8 py-8">
        <h1 className="text-[20px] font-bold text-[#111418]">Usuarios</h1>
        <p className="mt-3 text-[13px] text-[#26302B]">Solo un administrador puede gestionar usuarios.</p>
      </div>
    );
  }

  const activos = usuarios?.filter((u) => u.activo).length ?? 0;

  return (
    <div className="px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111418]">Usuarios</h1>
          <p className="text-[13px] text-[#26302B] mt-1">
            {usuarios ? `${usuarios.length} usuario${usuarios.length === 1 ? "" : "s"} · ${activos} activo${activos === 1 ? "" : "s"}` : "Cargando…"}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <BotonRespaldo clase={claseBotonSecundario} />
          {!creando && (
            <button type="button" className={claseBotonPrincipal} onClick={() => { setCreando(true); setAviso(null); }}>
              + Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {aviso && (
        <div
          role={aviso.tipo === "error" ? "alert" : "status"}
          className={`mb-5 text-[13px] rounded-lg px-4 py-3 border flex items-start justify-between gap-3 ${
            aviso.tipo === "ok" ? "text-[#0B5A2A] bg-[#E8F4EC] border-[#B9DEC6]" : "text-[#9B1C1C] bg-[#FDECEC] border-[#F5C2C2]"
          }`}
        >
          <span className="break-words">{aviso.texto}</span>
          <button type="button" aria-label="Cerrar aviso" className="shrink-0 font-bold opacity-60 hover:opacity-100" onClick={() => setAviso(null)}>×</button>
        </div>
      )}

      {creando && (
        <FormularioNuevo
          onCancelar={() => setCreando(false)}
          onCreado={(msg) => { setCreando(false); setAviso({ tipo: "ok", texto: msg }); cargar(); }}
        />
      )}

      <div className="bg-white rounded-2xl border border-[#E3E6E4] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold tracking-[0.04em] text-[#26302B] border-b border-[#E3E6E4]">
              <th className="px-5 py-3">USUARIO</th>
              <th className="px-3 py-3">NOMBRE Y CORREO</th>
              <th className="px-3 py-3">PERFIL</th>
              <th className="px-3 py-3">ESTADO</th>
              <th className="px-3 py-3">CREADO</th>
              <th className="px-5 py-3 text-right">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {!usuarios && (
              <tr><td colSpan={6} className="px-5 py-6 text-[#4A554F]">Cargando usuarios…</td></tr>
            )}
            {usuarios?.map((u) => {
              const esYo = u.id_usuario === yo;
              const bloqueado = ocupado === u.id_usuario;
              return (
                <tr key={u.id_usuario} className={`border-b border-[#EEF0EE] last:border-0 align-top ${u.activo ? "" : "bg-[#FAFAFA]"}`}>
                  <td className="px-5 py-3">
                    <span className={`font-semibold ${u.activo ? "text-[#111418]" : "text-[#7A847F]"}`}>{u.usuario}</span>
                    {esYo && <span className="ml-1.5 text-[11px] text-[#4A554F]">(usted)</span>}
                    {editando === u.id_usuario && (
                      <div className="mt-2">
                        <EditarDatos
                          u={u}
                          onCancelar={() => setEditando(null)}
                          onListo={(msg) => { setEditando(null); setAviso({ tipo: "ok", texto: msg }); cargar(); }}
                        />
                      </div>
                    )}
                    {restableciendo === u.id_usuario && (
                      <div className="mt-2">
                        <Restablecer
                          u={u}
                          onCancelar={() => setRestableciendo(null)}
                          onListo={(msg) => { setRestableciendo(null); setAviso({ tipo: "ok", texto: msg }); }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block text-[#26302B]">{u.nombre ?? "—"}</span>
                    {u.correo
                      ? <span className="block text-[11px] text-[#6B7570] break-all">{u.correo}</span>
                      : <span className="block text-[11px] text-[#A06A00]" title="Sin correo no puede recuperar su contraseña desde el inicio de sesión">Sin correo</span>}
                  </td>
                  <td className="px-3 py-3">
                    <select aria-label={`Perfil de ${u.usuario}`} className="h-8 px-2 rounded-lg border border-[#D5DAD7] bg-white text-[12px] disabled:opacity-60"
                      value={rolDe(u)} disabled={esYo || bloqueado} title={esYo ? "No puede cambiar su propio perfil" : ROLES.find((r) => r.valor === rolDe(u))?.descripcion}
                      onChange={(e) => cambiar(u, { rol: e.target.value as Rol })}>
                      {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.etiqueta}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">{u.activo ? <Etiqueta texto="Activo" tono="verde" /> : <Etiqueta texto="Inactivo" tono="rojo" />}</td>
                  <td className="px-3 py-3 text-[#4A554F] whitespace-nowrap">{fecha(u.creado_en)}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className={claseBotonSecundario} disabled={bloqueado}
                        onClick={() => { setEditando(u.id_usuario); setRestableciendo(null); setAviso(null); }}>
                        Editar
                      </button>
                      <button type="button" className={claseBotonSecundario} disabled={esYo || bloqueado}
                        title={esYo ? "Use Mi cuenta → Cambiar contraseña" : undefined}
                        onClick={() => { setRestableciendo(u.id_usuario); setEditando(null); setAviso(null); }}>
                        Restablecer contraseña
                      </button>
                      <button type="button" className={claseBotonSecundario} disabled={esYo || bloqueado}
                        onClick={() => cambiar(u, { activo: !u.activo })}>
                        {u.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button type="button" className={`${claseBotonSecundario} !text-[#9B1C1C] hover:!bg-[#FDECEC]`} disabled={esYo || bloqueado}
                        onClick={() => eliminar(u)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
