import { NextResponse, after } from "next/server";
import { generarClaveTemporal } from "../../../../lib/contrasenas";
import { correoConfigurado, enviarClaveTemporal } from "../../../../lib/correo";
import { MINUTOS_CLAVE_TEMPORAL, buscarUsuario, guardarClaveTemporal } from "../../../../lib/usuarios";

/**
 * "¿Olvidó su contraseña?": recibe { usuario } y, si existe, está activo y tiene correo,
 * le envía una clave temporal. La respuesta es SIEMPRE la misma, para no revelar
 * qué usuarios existen ni qué correo tienen.
 */
const RESPUESTA = {
  ok: true,
  mensaje:
    "Si el usuario existe y tiene un correo registrado, en unos minutos recibirá una clave temporal. Revise también la carpeta de spam.",
};

export async function POST(req: Request) {
  let usuario = "";
  try {
    usuario = String((await req.json())?.usuario ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  if (!usuario) return NextResponse.json({ error: "Ingrese su usuario." }, { status: 400 });

  if (!correoConfigurado()) {
    return NextResponse.json(
      { error: "El envío de correos aún no está configurado. Pida a un administrador que restablezca su contraseña." },
      { status: 503 },
    );
  }

  const origen = new URL(req.url).origin;

  // El trabajo (y el envío) se hace después de responder: así la respuesta tarda lo mismo exista o no el usuario
  after(async () => {
    try {
      const u = await buscarUsuario(usuario);
      if (!u || !u.activo || !u.correo) return;
      const clave = generarClaveTemporal();
      if (!(await guardarClaveTemporal(u.id_usuario, clave))) return; // pidió otra hace menos de 5 minutos
      await enviarClaveTemporal({
        para: u.correo,
        nombre: u.nombre || u.usuario,
        usuario: u.usuario,
        clave,
        minutos: MINUTOS_CLAVE_TEMPORAL,
        urlIngreso: `${origen}/login`,
      });
      console.log(`[restablecer] clave temporal enviada a usuario ${u.id_usuario}`);
    } catch (e) {
      console.error("[restablecer] no se pudo enviar la clave temporal", e);
    }
  });

  return NextResponse.json(RESPUESTA);
}
