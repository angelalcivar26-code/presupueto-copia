import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Contraseñas codificadas con scrypt + sal aleatoria (nunca se guarda el texto original).
 * Formato guardado: scrypt$N$r$p$sal$hash  (sal y hash en base64).
 */

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

function derivar(contrasena: string, sal: Buffer, n: number, r: number, p: number, largo: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(contrasena.normalize("NFKC"), sal, largo, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, clave) => {
      if (err) reject(err);
      else resolve(clave);
    });
  });
}

export async function codificarContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(contrasena, sal, N, R, P, LARGO);
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function verificarContrasena(contrasena: string, guardada: string): Promise<boolean> {
  const partes = guardada.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, "base64");
  const obtenido = await derivar(contrasena, Buffer.from(salB64, "base64"), Number(n), Number(r), Number(p), esperado.length);
  return obtenido.length === esperado.length && timingSafeEqual(obtenido, esperado);
}

/** Reglas mínimas para una contraseña nueva. Devuelve el problema, o null si está bien. */
export function problemaContrasena(contrasena: string): string | null {
  if (contrasena.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (contrasena.length > 128) return "La contraseña no puede tener más de 128 caracteres.";
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(contrasena) || !/\d/.test(contrasena)) {
    return "La contraseña debe combinar letras y números.";
  }
  return null;
}

/** Clave temporal legible: 10 caracteres con letras y números, sin 0/O ni 1/l/I. */
export function generarClaveTemporal(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const chars = Array.from({ length: 10 }, () => todos[randomInt(todos.length)]);
  chars[randomInt(10)] = numeros[randomInt(numeros.length)];
  if (!chars.some((c) => letras.includes(c))) chars[0] = letras[randomInt(letras.length)];
  if (!chars.some((c) => numeros.includes(c))) chars[9] = numeros[randomInt(numeros.length)];
  return chars.join("");
}
