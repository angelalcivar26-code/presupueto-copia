import { NextResponse } from "next/server";
import { exigirAdmin } from "../../../lib/autorizacion";
import { problemaContrasena } from "../../../lib/contrasenas";
import { anotarGuardado } from "../../../lib/bitacora";
import { esRol, buscarUsuario, crearUsuario, listarUsuarios, problemaCorreo, problemaNombreUsuario } from "../../../lib/usuarios";

const sinCache = { "Cache-Control": "no-store" };

/** Lista de usuarios (solo administradores). */
export async function GET() {
  const r = await exigirAdmin();
  if ("error" in r) return r.error;
  try {
    return NextResponse.json({ usuarios: await listarUsuarios(), yo: r.admin.id_usuario }, { headers: sinCache });
  } catch (e) {
    console.error("[api/usuarios GET]", e);
    return NextResponse.json({ error: "No se pudo leer la lista de usuarios." }, { status: 500 });
  }
}

/** Crear usuario: { usuario, nombre?, correo?, contrasena, es_admin? }. Deberá cambiar la contraseña al ingresar. */
export async function POST(req: Request) {
  const r = await exigirAdmin();
  if ("error" in r) return r.error;

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }

  const usuario = String(cuerpo.usuario ?? "").trim();
  const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 100);
  const correo = String(cuerpo.correo ?? "").trim();
  const contrasena = String(cuerpo.contrasena ?? "");
  // Perfil: { rol: "administrador" | "edicion" | "consulta" } (o es_admin, por compatibilidad)
  const rol = esRol(cuerpo.rol) ? cuerpo.rol : cuerpo.es_admin === true ? "administrador" : "edicion";
  const es_admin = rol === "administrador";
  const solo_consulta = rol === "consulta";

  const problema = problemaNombreUsuario(usuario) ?? problemaCorreo(correo) ?? problemaContrasena(contrasena);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  try {
    if (await buscarUsuario(usuario)) {
      return NextResponse.json({ error: `Ya existe un usuario "${usuario}".` }, { status: 409 });
    }
    const id = await crearUsuario({ usuario, nombre, correo, contrasena, es_admin, solo_consulta, debe_cambiar: true });
    await anotarGuardado(`Usuario «${usuario}» creado (perfil ${rol})`);
    return NextResponse.json({ ok: true, id_usuario: id, mensaje: `Usuario "${usuario}" creado.` });
  } catch (e) {
    console.error("[api/usuarios POST]", e);
    return NextResponse.json({ error: "No se pudo crear el usuario." }, { status: 500 });
  }
}
