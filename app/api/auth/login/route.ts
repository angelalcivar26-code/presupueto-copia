import { NextResponse } from "next/server";
import { verificarContrasena, codificarContrasena } from "../../../../lib/contrasenas";
import { asegurarUsuarioInicial, buscarUsuario, claveTemporalVigente, usarClaveTemporal } from "../../../../lib/usuarios";
import { COOKIE_SESION, DURACION_SESION_S, crearToken, opcionesCookie } from "../../../../lib/sesion";

// Hash de relleno: si el usuario no existe se compara igual, para no delatar qué usuarios existen
let hashRelleno: Promise<string> | null = null;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let usuario = "";
  let contrasena = "";
  try {
    const cuerpo = await req.json();
    usuario = String(cuerpo?.usuario ?? "").trim();
    contrasena = String(cuerpo?.contrasena ?? "");
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  if (!usuario || !contrasena) {
    return NextResponse.json({ error: "Ingrese usuario y contraseña." }, { status: 400 });
  }

  try {
    if (!(await asegurarUsuarioInicial())) {
      return NextResponse.json(
        { error: "Aún no hay usuarios. Configure ADMIN_USUARIO y ADMIN_CONTRASENA en Vercel y vuelva a desplegar." },
        { status: 503 },
      );
    }

    const encontrado = await buscarUsuario(usuario);
    if (!hashRelleno) hashRelleno = codificarContrasena("relleno-sin-uso");
    const ok = await verificarContrasena(contrasena, encontrado?.contrasena ?? (await hashRelleno));
    // Si no es su contraseña, puede ser la clave temporal que se le envió por correo
    const conTemporal = !ok && !!encontrado && claveTemporalVigente(encontrado)
      && (await verificarContrasena(contrasena, encontrado.clave_temporal!));

    if (!encontrado || (!ok && !conTemporal)) {
      await esperar(600); // frena intentos repetidos
      return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
    }
    if (!encontrado.activo) {
      return NextResponse.json({ error: "Este usuario está desactivado. Consulte al administrador." }, { status: 403 });
    }

    // Con la clave temporal: pasa a ser su contraseña de un solo uso y debe crear una nueva
    const version = conTemporal ? await usarClaveTemporal(encontrado) : encontrado.version_sesion;
    const debeCambiar = conTemporal || encontrado.debe_cambiar;

    const respuesta = NextResponse.json({ ok: true, usuario: encontrado.usuario, debe_cambiar: debeCambiar });
    respuesta.cookies.set(COOKIE_SESION, await crearToken(encontrado.id_usuario, encontrado.usuario, version), opcionesCookie(DURACION_SESION_S));
    return respuesta;
  } catch (error) {
    console.error("[api/auth/login]", error);
    return NextResponse.json({ error: "No se pudo iniciar sesión. Intente de nuevo." }, { status: 500 });
  }
}
