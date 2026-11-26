import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_SESION, leerToken } from "./sesion";
import { buscarUsuarioPorId, type Usuario } from "./usuarios";

/** Usuario de la sesión actual, leído de la base (null si la sesión no vale o el usuario ya no está activo). */
export async function usuarioActual(): Promise<Usuario | null> {
  const sesion = await leerToken((await cookies()).get(COOKIE_SESION)?.value);
  if (!sesion) return null;
  const u = await buscarUsuarioPorId(sesion.id);
  if (!u || !u.activo || u.version_sesion !== sesion.v) return null;
  return u;
}

/** Para rutas de administración: devuelve el administrador, o la respuesta de error lista para enviar. */
export async function exigirAdmin(motivo = "gestionar usuarios"): Promise<{ admin: Usuario } | { error: NextResponse }> {
  const u = await usuarioActual();
  if (!u) return { error: NextResponse.json({ error: "Sesión expirada. Inicie sesión nuevamente." }, { status: 401, headers: { "x-sesion": "requerida" } }) };
  if (!u.es_admin) return { error: NextResponse.json({ error: `Solo un administrador puede ${motivo}.` }, { status: 403 }) };
  return { admin: u };
}
