import { getDbDirecto } from "./turso";
import { codificarContrasena } from "./contrasenas";

/**
 * Tabla usuarios: id_usuario, usuario, contrasena (codificada con scrypt, ver lib/contrasenas.ts),
 * más nombre, correo, es_admin, activo, version_sesion, creado_en y los datos de la clave temporal
 * (clave_temporal codificada igual que la contraseña, con vencimiento; debe_cambiar obliga a
 * crear una contraseña nueva al ingresar).
 * La tabla y las columnas nuevas se crean solas (no borran datos).
 *
 * version_sesion: sube cada vez que cambia la contraseña o se desactiva al usuario;
 * las sesiones abiertas con una versión anterior dejan de valer (ver middleware.ts).
 */

export interface Usuario {
  id_usuario: number;
  usuario: string;
  nombre: string | null;
  correo: string | null;
  contrasena: string;
  debe_cambiar: boolean;
  clave_temporal: string | null;
  clave_temporal_expira: string | null;
  ultimo_restablecimiento: string | null;
  es_admin: boolean;
  /** Perfil de solo consulta: ve todo, no guarda nada (el servidor rechaza cualquier escritura). */
  solo_consulta: boolean;
  activo: boolean;
  version_sesion: number;
  creado_en: string | null;
}

/**
 * Perfiles de la herramienta:
 *  - administrador: todo, más usuarios, ejercicios y respaldo;
 *  - edicion: registra y modifica datos del presupuesto;
 *  - consulta: solo ve (p. ej. Gerencia).
 */
type Rol = "administrador" | "edicion" | "consulta";
export const ROLES: { valor: Rol; etiqueta: string; descripcion: string }[] = [
  { valor: "administrador", etiqueta: "Administrador", descripcion: "Edita todo y gestiona usuarios, ejercicios y respaldos" },
  { valor: "edicion", etiqueta: "Edición", descripcion: "Registra y modifica los datos del presupuesto" },
  { valor: "consulta", etiqueta: "Consulta", descripcion: "Solo ve la información; no puede guardar cambios" },
];
export function rolDe(u: { es_admin: boolean; solo_consulta: boolean }): Rol {
  return u.es_admin ? "administrador" : u.solo_consulta ? "consulta" : "edicion";
}
export function esRol(v: unknown): v is Rol {
  return v === "administrador" || v === "edicion" || v === "consulta";
}

/** Datos que se pueden mostrar (sin la contraseña). */
type UsuarioPublico = Pick<Usuario, "id_usuario" | "usuario" | "nombre" | "correo" | "es_admin" | "solo_consulta" | "activo" | "creado_en"> & { rol: Rol };

const COLUMNAS_NUEVAS: [string, string][] = [
  ["nombre", "TEXT"],
  ["es_admin", "INTEGER NOT NULL DEFAULT 0"],
  ["activo", "INTEGER NOT NULL DEFAULT 1"],
  ["version_sesion", "INTEGER NOT NULL DEFAULT 1"],
  ["creado_en", "TEXT"],
  ["correo", "TEXT"],
  ["debe_cambiar", "INTEGER NOT NULL DEFAULT 0"],
  ["clave_temporal", "TEXT"],
  ["clave_temporal_expira", "TEXT"],
  ["ultimo_restablecimiento", "TEXT"],
  ["solo_consulta", "INTEGER NOT NULL DEFAULT 0"],
];

let tablaLista: Promise<void> | null = null;
function asegurarTablaUsuarios(): Promise<void> {
  if (!tablaLista) {
    tablaLista = (async () => {
      const db = getDbDirecto();
      await db.execute(
        `CREATE TABLE IF NOT EXISTS usuarios (
          id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario    TEXT NOT NULL UNIQUE COLLATE NOCASE,
          contrasena TEXT NOT NULL
        )`,
      );
      const info = await db.execute("PRAGMA table_info(usuarios)");
      const existentes = new Set(info.rows.map((f) => String(f.name)));
      for (const [col, tipo] of COLUMNAS_NUEVAS) {
        if (!existentes.has(col)) {
          try { await db.execute(`ALTER TABLE usuarios ADD COLUMN ${col} ${tipo}`); } catch { /* otro servidor la agregó */ }
        }
      }
      // Siempre debe haber al menos un administrador: si no hay, lo es el primer usuario creado
      await db.execute(
        `UPDATE usuarios SET es_admin = 1
          WHERE id_usuario = (SELECT MIN(id_usuario) FROM usuarios)
            AND NOT EXISTS (SELECT 1 FROM usuarios WHERE es_admin = 1)`,
      );
    })().catch((e) => { tablaLista = null; throw e; });
  }
  return tablaLista;
}

const SELECT = `SELECT id_usuario, usuario, nombre, correo, contrasena, es_admin, solo_consulta, activo, version_sesion, creado_en,
  debe_cambiar, clave_temporal, clave_temporal_expira, ultimo_restablecimiento FROM usuarios`;

const texto = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function aUsuario(fila: Record<string, unknown> | undefined): Usuario | null {
  if (!fila) return null;
  return {
    id_usuario: Number(fila.id_usuario),
    usuario: String(fila.usuario),
    nombre: texto(fila.nombre),
    correo: texto(fila.correo),
    contrasena: String(fila.contrasena),
    debe_cambiar: Number(fila.debe_cambiar) === 1,
    clave_temporal: texto(fila.clave_temporal),
    clave_temporal_expira: texto(fila.clave_temporal_expira),
    ultimo_restablecimiento: texto(fila.ultimo_restablecimiento),
    es_admin: Number(fila.es_admin) === 1,
    solo_consulta: Number(fila.es_admin) !== 1 && Number(fila.solo_consulta) === 1,
    activo: Number(fila.activo) === 1,
    version_sesion: Number(fila.version_sesion) || 1,
    creado_en: texto(fila.creado_en),
  };
}

function aPublico(u: Usuario): UsuarioPublico {
  return { id_usuario: u.id_usuario, usuario: u.usuario, nombre: u.nombre, correo: u.correo, es_admin: u.es_admin, solo_consulta: u.solo_consulta, rol: rolDe(u), activo: u.activo, creado_en: u.creado_en };
}

export async function buscarUsuario(usuario: string): Promise<Usuario | null> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute({ sql: `${SELECT} WHERE usuario = ?`, args: [usuario.trim()] });
  return aUsuario(r.rows[0] as Record<string, unknown> | undefined);
}

export async function buscarUsuarioPorId(id: number): Promise<Usuario | null> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute({ sql: `${SELECT} WHERE id_usuario = ?`, args: [id] });
  return aUsuario(r.rows[0] as Record<string, unknown> | undefined);
}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute(`${SELECT} ORDER BY usuario COLLATE NOCASE`);
  return r.rows.map((f) => aPublico(aUsuario(f as Record<string, unknown>)!));
}

async function contarUsuarios(): Promise<number> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute("SELECT COUNT(*) AS total FROM usuarios");
  return Number(r.rows[0]?.total ?? 0);
}

/** Administradores activos, sin contar a uno (para no dejar la herramienta sin administrador). */
export async function contarOtrosAdminsActivos(exceptoId: number): Promise<number> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute({
    sql: "SELECT COUNT(*) AS total FROM usuarios WHERE es_admin = 1 AND activo = 1 AND id_usuario <> ?",
    args: [exceptoId],
  });
  return Number(r.rows[0]?.total ?? 0);
}

export async function crearUsuario(datos: {
  usuario: string; contrasena: string; nombre?: string | null; correo?: string | null; es_admin?: boolean; solo_consulta?: boolean; debe_cambiar?: boolean;
}): Promise<number> {
  await asegurarTablaUsuarios();
  const r = await getDbDirecto().execute({
    sql: `INSERT INTO usuarios (usuario, contrasena, nombre, correo, es_admin, solo_consulta, activo, version_sesion, creado_en, debe_cambiar)
          VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    args: [
      datos.usuario.trim(), await codificarContrasena(datos.contrasena), datos.nombre?.trim() || null,
      datos.correo?.trim().toLowerCase() || null, datos.es_admin ? 1 : 0, !datos.es_admin && datos.solo_consulta ? 1 : 0,
      new Date().toISOString(), datos.debe_cambiar ? 1 : 0,
    ],
  });
  return Number(r.lastInsertRowid);
}

/**
 * Cambia la contraseña y cierra las demás sesiones de ese usuario. Devuelve la nueva versión de sesión.
 * debeCambiar: true cuando la puso otra persona (administrador o clave temporal) y el usuario
 * debe crear la suya al ingresar; false cuando el propio usuario la eligió.
 * Siempre anula cualquier clave temporal pendiente.
 */
export async function actualizarContrasena(id: number, contrasena: string, debeCambiar = false): Promise<number> {
  await asegurarTablaUsuarios();
  await getDbDirecto().execute({
    sql: `UPDATE usuarios SET contrasena = ?, version_sesion = version_sesion + 1, debe_cambiar = ?,
            clave_temporal = NULL, clave_temporal_expira = NULL
          WHERE id_usuario = ?`,
    args: [await codificarContrasena(contrasena), debeCambiar ? 1 : 0, id],
  });
  return (await buscarUsuarioPorId(id))?.version_sesion ?? 1;
}

export async function actualizarDatos(
  id: number, cambios: { nombre?: string | null; correo?: string | null; es_admin?: boolean; solo_consulta?: boolean; activo?: boolean },
): Promise<void> {
  await asegurarTablaUsuarios();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (cambios.nombre !== undefined) { sets.push("nombre = ?"); args.push(cambios.nombre?.trim() || null); }
  if (cambios.correo !== undefined) { sets.push("correo = ?"); args.push(cambios.correo?.trim().toLowerCase() || null); }
  if (cambios.es_admin !== undefined) { sets.push("es_admin = ?"); args.push(cambios.es_admin ? 1 : 0); }
  if (cambios.solo_consulta !== undefined) { sets.push("solo_consulta = ?"); args.push(cambios.solo_consulta ? 1 : 0); }
  if (cambios.activo !== undefined) {
    sets.push("activo = ?");
    args.push(cambios.activo ? 1 : 0);
    if (!cambios.activo) sets.push("version_sesion = version_sesion + 1"); // lo saca de inmediato
  }
  if (!sets.length) return;
  args.push(id);
  await getDbDirecto().execute({ sql: `UPDATE usuarios SET ${sets.join(", ")} WHERE id_usuario = ?`, args });
}

export async function eliminarUsuario(id: number): Promise<void> {
  await asegurarTablaUsuarios();
  await getDbDirecto().execute({ sql: "DELETE FROM usuarios WHERE id_usuario = ?", args: [id] });
}

// ---------------------------------------------------------------------
// Clave temporal por correo ("¿Olvidó su contraseña?")
// ---------------------------------------------------------------------
export const MINUTOS_CLAVE_TEMPORAL = 30;
const MINUTOS_ENTRE_SOLICITUDES = 5;

/**
 * Guarda una clave temporal (codificada) que vence en 30 minutos. NO toca la contraseña actual:
 * si otra persona pidió el restablecimiento, el usuario sigue ingresando con la suya.
 * Devuelve false si ya se pidió una hace menos de 5 minutos (evita llenar su correo).
 */
export async function guardarClaveTemporal(id: number, clave: string): Promise<boolean> {
  await asegurarTablaUsuarios();
  const ahora = new Date();
  const limite = new Date(ahora.getTime() - MINUTOS_ENTRE_SOLICITUDES * 60_000).toISOString();
  const r = await getDbDirecto().execute({
    sql: `UPDATE usuarios SET clave_temporal = ?, clave_temporal_expira = ?, ultimo_restablecimiento = ?
          WHERE id_usuario = ? AND (ultimo_restablecimiento IS NULL OR ultimo_restablecimiento < ?)`,
    args: [
      await codificarContrasena(clave), new Date(ahora.getTime() + MINUTOS_CLAVE_TEMPORAL * 60_000).toISOString(),
      ahora.toISOString(), id, limite,
    ],
  });
  return r.rowsAffected > 0;
}

export function claveTemporalVigente(u: Usuario): boolean {
  return !!u.clave_temporal && !!u.clave_temporal_expira && new Date(u.clave_temporal_expira).getTime() > Date.now();
}

/**
 * Ingreso con la clave temporal: pasa a ser su contraseña (de un solo uso), se borra la temporal,
 * se cierran otras sesiones y queda obligado a crear una nueva. Devuelve la nueva versión de sesión.
 */
export async function usarClaveTemporal(u: Usuario): Promise<number> {
  await getDbDirecto().execute({
    sql: `UPDATE usuarios SET contrasena = clave_temporal, clave_temporal = NULL, clave_temporal_expira = NULL,
            debe_cambiar = 1, version_sesion = version_sesion + 1
          WHERE id_usuario = ?`,
    args: [u.id_usuario],
  });
  return u.version_sesion + 1;
}

/** Validación simple de correo. Devuelve el problema, o null si está bien (vacío = sin correo). */
export function problemaCorreo(correo: string): string | null {
  const c = correo.trim();
  if (!c) return null;
  if (c.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return "El correo no tiene un formato válido.";
  return null;
}

/**
 * Primer usuario: si la tabla está vacía y en Vercel están ADMIN_USUARIO y ADMIN_CONTRASENA,
 * se crea ese usuario como administrador. Después estas variables ya no se usan.
 * Devuelve false si no hay usuarios y tampoco variables para crear el primero.
 */
export async function asegurarUsuarioInicial(): Promise<boolean> {
  if ((await contarUsuarios()) > 0) return true;
  const usuario = process.env.ADMIN_USUARIO?.trim();
  const contrasena = process.env.ADMIN_CONTRASENA;
  if (!usuario || !contrasena) return false;
  try {
    await crearUsuario({ usuario, contrasena, es_admin: true });
  } catch {
    // otro servidor lo creó al mismo tiempo
  }
  return true;
}

/** Reglas del nombre de usuario. Devuelve el problema, o null si está bien. */
export function problemaNombreUsuario(usuario: string): string | null {
  const u = usuario.trim();
  if (u.length < 3 || u.length > 40) return "El usuario debe tener entre 3 y 40 caracteres.";
  if (!/^[A-Za-z0-9._-]+$/.test(u)) return "El usuario solo puede tener letras sin tilde, números, punto, guion o guion bajo.";
  return null;
}

// ---------------------------------------------------------------------
// Estado de sesión (lo consulta el middleware en cada pedido, con memoria corta)
// ---------------------------------------------------------------------
const VIGENCIA_ESTADO_MS = 30_000;
const estados = new Map<number, { v: number; activo: boolean; debeCambiar: boolean; soloConsulta: boolean; t: number }>();

type EstadoSesion = "valida" | "debe_cambiar" | "invalida";

/** ¿Sigue valiendo una sesión de este usuario con esta versión? (máx. 30 s de retraso) */
export async function estadoSesion(id: number, version: number): Promise<EstadoSesion> {
  const valida = await sesionVigente(id, version);
  if (!valida) return "invalida";
  return estados.get(id)?.debeCambiar ? "debe_cambiar" : "valida";
}

/** ¿El usuario tiene perfil de solo consulta? Usa lo recordado por estadoSesion (llamar después de ella). */
export function sesionSoloConsulta(id: number): boolean {
  return estados.get(id)?.soloConsulta === true;
}

async function sesionVigente(id: number, version: number): Promise<boolean> {
  const guardado = estados.get(id);
  // Si la sesión trae una versión más nueva que la recordada (p. ej. recién cambió su contraseña),
  // se consulta de nuevo la base en vez de rechazarla.
  if (guardado && Date.now() - guardado.t < VIGENCIA_ESTADO_MS && version <= guardado.v) {
    return guardado.activo && guardado.v === version;
  }
  const u = await buscarUsuarioPorId(id);
  if (!u) { estados.delete(id); return false; }
  if (estados.size > 500) estados.clear();
  estados.set(id, { v: u.version_sesion, activo: u.activo, debeCambiar: u.debe_cambiar, soloConsulta: u.solo_consulta, t: Date.now() });
  return u.activo && u.version_sesion === version;
}
