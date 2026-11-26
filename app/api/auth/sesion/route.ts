import { NextResponse } from "next/server";
import { usuarioActual } from "../../../../lib/autorizacion";
import { rolDe } from "../../../../lib/usuarios";

/** Usuario de la sesión actual (para el menú: nombre y si es administrador). */
export async function GET() {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: "Sin sesión." }, { status: 401, headers: { "x-sesion": "requerida" } });
  return NextResponse.json(
    { id: u.id_usuario, usuario: u.usuario, nombre: u.nombre, correo: u.correo, es_admin: u.es_admin, solo_consulta: u.solo_consulta, rol: rolDe(u), debe_cambiar: u.debe_cambiar },
    { headers: { "Cache-Control": "no-store" } },
  );
}
