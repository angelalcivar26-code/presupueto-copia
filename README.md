# Presupuesto Institucional 2027 — COAC Once de Junio

Herramienta web (Next.js 15 + Turso) para el Presupuesto Institucional 2027.

## Desarrollo local

```bash
npm install
cp .env.example .env        # completar TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
npm run dev                 # http://localhost:3000
```

## Despliegue en Vercel

1. Entrar a https://vercel.com con la cuenta de GitHub y elegir **Add New → Project**.
2. Importar el repositorio `angelalcivar26-code/ProyeccionFinanciera`.
3. Vercel detecta Next.js solo. No cambiar Build Command ni Output Directory.
4. En **Environment Variables** agregar (para Production, Preview y Development):
   - `TURSO_DATABASE_URL` — URL `libsql://...` de la base en Turso
   - `TURSO_AUTH_TOKEN` — token de la base
   - `ADMIN_USUARIO` y `ADMIN_CONTRASENA` — primer usuario del login (ver abajo)
   - `GMAIL_USUARIO` y `GMAIL_CLAVE_APLICACION` — envío de claves temporales (ver abajo)
5. Pulsar **Deploy**.

Cada `git push` a `main` vuelve a publicar la app automáticamente; cada rama o
pull request genera una URL de vista previa.

### Recomendaciones

- **Región:** en Project Settings → Functions, elegir la región de Vercel más
  cercana a la región de la base Turso (menos latencia en cada consulta).
- **Base de datos:** si la base es nueva, crear las tablas con `npm run db:init`
  (usa las variables del `.env` local).

## Inicio de sesión

Toda la herramienta (pantallas y API) exige iniciar sesión. Los usuarios están en la
tabla `usuarios` (`id_usuario`, `usuario`, `contrasena`); la contraseña se guarda
codificada con scrypt y sal aleatoria, nunca en texto plano. La sesión dura 12 horas.

- **Primer usuario:** con la tabla vacía, el primer intento de ingreso crea el usuario
  definido en `ADMIN_USUARIO` / `ADMIN_CONTRASENA`, como administrador. Después se pueden
  borrar esas variables.
- **Cambiar contraseña:** menú lateral → **Mi cuenta → Cambiar contraseña**.
- **Administrar usuarios** (solo administradores): menú lateral → **Administración → Usuarios**.
  Crear usuarios con contraseña temporal, restablecer contraseñas, dar o quitar el rol de
  administrador, desactivar/activar y eliminar. Siempre queda al menos un administrador activo.
  Al desactivar o restablecer, las sesiones abiertas de ese usuario se cierran en menos de un minuto.
- **Respaldo por terminal** (si ningún administrador puede ingresar), con el `.env`:
  `npm run usuario:crear -- <usuario> <contraseña> --admin`
- **¿Olvidó su contraseña?** En el inicio de sesión el usuario escribe su nombre de usuario y
  recibe en su correo (campo `correo`) una clave temporal de 10 caracteres que vence en 30 minutos.
  La clave temporal NO reemplaza la contraseña actual (si alguien la pide por otra persona, esa
  persona sigue ingresando normal). Al ingresar con ella, el sistema obliga a crear una contraseña
  nueva antes de usar la herramienta. Se puede pedir una vez cada 5 minutos por usuario.
- **Contraseñas puestas por otra persona** (usuario nuevo o restablecido por un administrador)
  también obligan a crear una propia al primer ingreso.

### Configurar Gmail para enviar los correos

1. Usar una cuenta de Gmail dedicada (p. ej. `sistema.coac@gmail.com`), no una personal.
2. En esa cuenta activar la **verificación en dos pasos** (myaccount.google.com → Seguridad).
3. Entrar a https://myaccount.google.com/apppasswords, crear una contraseña de aplicación
   (nombre: "Presupuesto Vercel") y copiar las 16 letras.
4. En Vercel → Settings → Environment Variables agregar `GMAIL_USUARIO` (la cuenta) y
   `GMAIL_CLAVE_APLICACION` (las 16 letras), y volver a desplegar.
5. En **Administración → Usuarios → Editar**, registrar el correo de cada usuario.
