/**
 * Sesión de usuario: cookie firmada (HMAC-SHA256), sin guardar nada en la base.
 * Usa solo Web Crypto, así funciona igual en el middleware (Edge) y en las rutas API (Node).
 *
 * La firma usa SESSION_SECRET; si no está definida, se usa TURSO_AUTH_TOKEN
 * (también es secreto y ya está configurado en Vercel).
 */

export const COOKIE_SESION = "sesion_p27";
export const DURACION_SESION_S = 12 * 60 * 60; // 12 horas

interface Sesion {
  id: number;
  usuario: string;
  v: number;   // version_sesion del usuario al iniciar sesión
  exp: number; // segundos Unix
}

function secreto(): string {
  const s = process.env.SESSION_SECRET || process.env.TURSO_AUTH_TOKEN;
  if (s) return s;
  if (process.env.NODE_ENV !== "production") return "solo-desarrollo-local";
  throw new Error("Falta SESSION_SECRET (o TURSO_AUTH_TOKEN) para firmar las sesiones.");
}

const codificador = new TextEncoder();

function aB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(texto: string): Uint8Array<ArrayBuffer> {
  const b = texto.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b + "===".slice((b.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

let clave: Promise<CryptoKey> | null = null;
function claveHmac(): Promise<CryptoKey> {
  if (!clave) {
    clave = crypto.subtle.importKey(
      "raw",
      codificador.encode(secreto()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return clave;
}

export async function crearToken(id: number, usuario: string, v: number): Promise<string> {
  const datos: Sesion = { id, usuario, v, exp: Math.floor(Date.now() / 1000) + DURACION_SESION_S };
  const cuerpo = aB64url(codificador.encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign("HMAC", await claveHmac(), codificador.encode(cuerpo));
  return `${cuerpo}.${aB64url(new Uint8Array(firma))}`;
}

/** Devuelve la sesión si el token es auténtico y no ha vencido; si no, null. */
export async function leerToken(token: string | undefined | null): Promise<Sesion | null> {
  if (!token) return null;
  const [cuerpo, firma] = token.split(".");
  if (!cuerpo || !firma) return null;
  try {
    const valido = await crypto.subtle.verify("HMAC", await claveHmac(), deB64url(firma), codificador.encode(cuerpo));
    if (!valido) return null;
    const datos = JSON.parse(new TextDecoder().decode(deB64url(cuerpo))) as Sesion;
    if (typeof datos.id !== "number" || typeof datos.usuario !== "string" || typeof datos.v !== "number") return null;
    if (datos.exp < Math.floor(Date.now() / 1000)) return null;
    return datos;
  } catch {
    return null;
  }
}

export function opcionesCookie(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
