import { NextResponse } from "next/server";
import { anotarGuardado } from "../../../../lib/bitacora";
import { exigirAdmin } from "../../../../lib/autorizacion";
import { problemaContrasena } from "../../../../lib/contrasenas";
import {
  esRol, ROLES, actualizarContrasena, actualizarDatos, buscarUsuarioPorId, contarOtrosAdminsActivos, eliminarUsuario, problemaCorreo,
} from "../../../../lib/usuarios";

type Params = { params: Promise<{ id: string }> };

async function idDe(params: Params["params"]): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Modificar usuario: { nombre?, correo?, es_admin?, activo?, contrasena? }
 * - contrasena: restablece la contraseña (cierra sus sesiones; deberá cambiarla al ingresar).
 * - Un administrador no puede quitarse a sí mismo el rol ni desactivarse.
 * - Siempre debe quedar al menos un administrador activo.
 */
export async function PATCH(req: Request, { params }: Params) {
  const r = await exigirAdmin();
  if ("error" in r) return r.error;
  const id = await idDe(params);
  if (!id) return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }

  try {
    const u = await buscarUsuarioPorId(id);
    if (!u) return NextResponse.json({ error: "El usuario no existe." }, { status: 404 });
    const esYo = id === r.admin.id_usuario;

    const cambios: { nombre?: string | null; correo?: string | null; es_admin?: boolean; solo_consulta?: boolean; activo?: boolean } = {};
    if ("nombre" in cuerpo) cambios.nombre = String(cuerpo.nombre ?? "").slice(0, 100);
    if ("correo" in cuerpo) {
      cambios.correo = String(cuerpo.correo ?? "").trim();
      const problema = problemaCorreo(cambios.correo);
      if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    }
    if (typeof cuerpo.es_admin === "boolean") cambios.es_admin = cuerpo.es_admin;
    if (esRol(cuerpo.rol)) { cambios.es_admin = cuerpo.rol === "administrador"; cambios.solo_consulta = cuerpo.rol === "consulta"; }
    if (typeof cuerpo.activo === "boolean") cambios.activo = cuerpo.activo;

    if (esYo && (cambios.es_admin === false || cambios.activo === false)) {
      return NextResponse.json({ error: "No puede quitarse el rol de administrador ni desactivar su propio usuario." }, { status: 400 });
    }
    const dejaDeSerAdminActivo = u.es_admin && u.activo && (cambios.es_admin === false || cambios.activo === false);
    if (dejaDeSerAdminActivo && (await contarOtrosAdminsActivos(id)) === 0) {
      return NextResponse.json({ error: "Debe quedar al menos un administrador activo." }, { status: 400 });
    }

    let mensaje = "Cambios guardados.";
    if (typeof cuerpo.contrasena === "string") {
      if (esYo) return NextResponse.json({ error: "Para su propia contraseña use Mi cuenta → Cambiar contraseña." }, { status: 400 });
      const problema = problemaContrasena(cuerpo.contrasena);
      if (problema) return NextResponse.json({ error: problema }, { status: 400 });
      await actualizarContrasena(id, cuerpo.contrasena, true);
      mensaje = `Contraseña de "${u.usuario}" restablecida. Sus sesiones abiertas se cerrarán en menos de un minuto.`;
    }

    await actualizarDatos(id, cambios);
    if (cambios.activo === false) mensaje = `Usuario "${u.usuario}" desactivado. Ya no puede ingresar y sus sesiones abiertas se cerrarán en menos de un minuto.`;
    if (cambios.activo === true) mensaje = `Usuario "${u.usuario}" activado.`;
    if (cambios.es_admin === true) mensaje = `"${u.usuario}" ahora es administrador.`;
    if (cambios.es_admin === false) mensaje = `"${u.usuario}" ya no es administrador.`;
    if (esRol(cuerpo.rol)) mensaje = `Perfil de "${u.usuario}": ${ROLES.find((x) => x.valor === cuerpo.rol)!.etiqueta}. Se aplica en menos de un minuto.`;
    if (("nombre" in cuerpo || "correo" in cuerpo) && cambios.es_admin === undefined && cambios.activo === undefined && typeof cuerpo.contrasena !== "string") {
      mensaje = `Datos de "${u.usuario}" actualizados.`;
    }

    await anotarGuardado(`Usuario «${u.usuario}»: ${mensaje}`);
    return NextResponse.json({ ok: true, mensaje });
  } catch (e) {
    console.error("[api/usuarios PATCH]", e);
    return NextResponse.json({ error: "No se pudo modificar el usuario." }, { status: 500 });
  }
}

/** Eliminar usuario (no el propio, ni el último administrador activo). */
export async function DELETE(_req: Request, { params }: Params) {
  const r = await exigirAdmin();
  if ("error" in r) return r.error;
  const id = await idDe(params);
  if (!id) return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });
  if (id === r.admin.id_usuario) return NextResponse.json({ error: "No puede eliminar su propio usuario." }, { status: 400 });

  try {
    const u = await buscarUsuarioPorId(id);
    if (!u) return NextResponse.json({ error: "El usuario no existe." }, { status: 404 });
    if (u.es_admin && u.activo && (await contarOtrosAdminsActivos(id)) === 0) {
      return NextResponse.json({ error: "Debe quedar al menos un administrador activo." }, { status: 400 });
    }
    await eliminarUsuario(id);
    await anotarGuardado(`Usuario «${u.usuario}» eliminado`);
    return NextResponse.json({ ok: true, mensaje: `Usuario "${u.usuario}" eliminado.` });
  } catch (e) {
    console.error("[api/usuarios DELETE]", e);
    return NextResponse.json({ error: "No se pudo eliminar el usuario." }, { status: 500 });
  }
}
