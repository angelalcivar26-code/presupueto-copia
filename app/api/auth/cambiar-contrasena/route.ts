import { NextResponse } from "next/server";
import { COOKIE_SESION, DURACION_SESION_S, crearToken, opcionesCookie } from "../../../../lib/sesion";
import { usuarioActual } from "../../../../lib/autorizacion";
import { problemaContrasena, verificarContrasena } from "../../../../lib/contrasenas";
import { actualizarContrasena } from "../../../../lib/usuarios";

export async function POST(req: Request) {
  const usuario = await usuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sesión expirada. Inicie sesión nuevamente." }, { status: 401 });

  let actual = "";
  let nueva = "";
  let confirmacion = "";
  try {
    const cuerpo = await req.json();
    actual = String(cuerpo?.actual ?? "");
    nueva = String(cuerpo?.nueva ?? "");
    confirmacion = String(cuerpo?.confirmacion ?? "");
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (!actual || !nueva || !confirmacion) {
    return NextResponse.json({ error: "Complete los tres campos." }, { status: 400 });
  }
  if (nueva !== confirmacion) {
    return NextResponse.json({ error: "La nueva contraseña y su confirmación no coinciden." }, { status: 400 });
  }
  if (nueva === actual) {
    return NextResponse.json({ error: "La nueva contraseña debe ser distinta de la actual." }, { status: 400 });
  }
  const problema = problemaContrasena(nueva);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  try {
    if (!(await verificarContrasena(actual, usuario.contrasena))) {
      return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
    }

    // Cierra las sesiones abiertas en otros equipos; esta se renueva abajo
    const version = await actualizarContrasena(usuario.id_usuario, nueva);

    const respuesta = NextResponse.json({ ok: true, mensaje: "Contraseña actualizada correctamente." });
    respuesta.cookies.set(COOKIE_SESION, await crearToken(usuario.id_usuario, usuario.usuario, version), opcionesCookie(DURACION_SESION_S));
    return respuesta;
  } catch (error) {
    console.error("[api/auth/cambiar-contrasena]", error);
    return NextResponse.json({ error: "No se pudo cambiar la contraseña. Intente de nuevo." }, { status: 500 });
  }
}
