import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, leerToken } from "./lib/sesion";
import { estadoSesion, sesionSoloConsulta } from "./lib/usuarios";
import { CABECERA_BITACORA } from "./lib/bitacora";
import { CABECERA_EJERCICIO } from "./lib/ejercicio-pedido";
import { describir, pantallaDe } from "./lib/bitacora-descripcion";

/**
 * Protege toda la herramienta: sin sesión válida, las pantallas llevan a /login
 * y las rutas /api responden 401.
 *
 * Además de la firma, revisa en la base que el usuario siga activo y que su sesión no haya
 * sido cerrada (cambio o restablecimiento de contraseña). Esa revisión se recuerda 30 s
 * para no consultar la base en cada clic.
 */

const PUBLICAS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/restablecer"]);

// Con contraseña por cambiar (clave temporal o puesta por un administrador) solo se permite esto:
const PERMITIDAS_AL_CAMBIAR = new Set(["/cuenta/contrasena", "/api/auth/sesion", "/api/auth/cambiar-contrasena"]);

async function sesionValida(req: NextRequest) {
  const sesion = await leerToken(req.cookies.get(COOKIE_SESION)?.value).catch(() => null);
  if (!sesion) return null;
  try {
    const estado = await estadoSesion(sesion.id, sesion.v);
    return estado === "invalida" ? null : { ...sesion, debeCambiar: estado === "debe_cambiar", soloConsulta: sesionSoloConsulta(sesion.id) };
  } catch (e) {
    console.error("[middleware] no se pudo verificar la sesión", e);
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLICAS.has(pathname)) {
    if (pathname === "/login" && (await sesionValida(req))) return NextResponse.redirect(new URL("/inicio", req.url));
    return NextResponse.next();
  }

  const sesion = await sesionValida(req);
  if (sesion) {
    // Perfil de consulta: puede ver todo, pero ninguna escritura llega a la base.
    const escribe = pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)
      && !pathname.startsWith("/api/auth/") && pathname !== "/api/sincronizar";
    if (sesion.soloConsulta && escribe) {
      return NextResponse.json({ error: "Su perfil es de solo consulta: no puede guardar cambios." }, { status: 403 });
    }
    if (!sesion.debeCambiar || PERMITIDAS_AL_CAMBIAR.has(pathname)) {
      // Cabeceras que solo pone este middleware (bitácora y ejercicio del pedido): si llegan de afuera, se quitan.
      const h = new Headers(req.headers);
      h.delete(CABECERA_BITACORA);
      h.delete(CABECERA_EJERCICIO);
      const ejQuery = Number(req.nextUrl.searchParams.get("ejercicio"));
      if (Number.isInteger(ejQuery) && ejQuery > 2000) h.set(CABECERA_EJERCICIO, String(ejQuery));
      if (!escribe) {
        if (!pathname.startsWith("/api/")) return NextResponse.next();
        return NextResponse.next({ request: { headers: h } });
      }
      // Bitácora: se describe el guardado; se anota solo si cambia datos (ver lib/bitacora.ts).
      try {
        let cuerpo: Record<string, unknown> | null = null;
        const largo = Number(req.headers.get("content-length") ?? 0);
        if (/json/i.test(req.headers.get("content-type") ?? "") && largo < 2_000_000) {
          const j = await req.clone().json().catch(() => null);
          if (j && typeof j === "object" && !Array.isArray(j)) cuerpo = j as Record<string, unknown>;
        }
        const d = describir(req.method, pathname, req.nextUrl.searchParams, cuerpo);
        // El año que trae el guardado manda sobre el de la pantalla.
        if (d.ejercicio) h.set(CABECERA_EJERCICIO, String(d.ejercicio));
        h.set(CABECERA_BITACORA, encodeURIComponent(JSON.stringify({
          id_pedido: crypto.randomUUID(), usuario: sesion.usuario, pantalla: pantallaDe(req.headers.get("referer")), ...d,
        })));
      } catch { /* sin descripción, el guardado sigue igual */ }
      return NextResponse.next({ request: { headers: h } });
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Debe crear una contraseña nueva para continuar." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/cuenta/contrasena", req.url));
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sesión expirada. Inicie sesión nuevamente." },
      { status: 401, headers: { "x-sesion": "requerida" } },
    );
  }

  const destino = new URL("/login", req.url);
  if (pathname !== "/" && pathname !== "/inicio") destino.searchParams.set("siguiente", pathname + search);
  const r = NextResponse.redirect(destino);
  r.cookies.delete(COOKIE_SESION);
  return r;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|assets/).*)"],
};
