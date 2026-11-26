import "dotenv/config";
import { crearUsuario, buscarUsuario, actualizarContrasena, actualizarDatos, problemaNombreUsuario } from "../lib/usuarios";
import { problemaContrasena } from "../lib/contrasenas";

/**
 * Crea un usuario, o le restablece la contraseña si ya existe (y lo reactiva).
 * Uso:  npm run usuario:crear -- <usuario> <contraseña> [--admin]
 * Sirve de respaldo si ningún administrador puede ingresar a la pantalla de Usuarios.
 */
async function main() {
  const args = process.argv.slice(2);
  const esAdmin = args.includes("--admin");
  const [usuario, contrasena] = args.filter((a) => a !== "--admin");
  if (!usuario || !contrasena) {
    console.error("Uso: npm run usuario:crear -- <usuario> <contraseña> [--admin]");
    process.exit(1);
  }
  const problema = problemaNombreUsuario(usuario) ?? problemaContrasena(contrasena);
  if (problema) {
    console.error(problema);
    process.exit(1);
  }
  const existente = await buscarUsuario(usuario);
  if (existente) {
    await actualizarContrasena(existente.id_usuario, contrasena);
    await actualizarDatos(existente.id_usuario, { activo: true, ...(esAdmin ? { es_admin: true } : {}) });
    console.log(`Contraseña restablecida para "${existente.usuario}"${esAdmin ? " (administrador)" : ""}.`);
  } else {
    const id = await crearUsuario({ usuario, contrasena, es_admin: esAdmin });
    console.log(`Usuario "${usuario}" creado (id_usuario ${id})${esAdmin ? " como administrador" : ""}.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
