import nodemailer, { type Mail } from "nodemailer";

/**
 * Envío de correos desde una cuenta de Gmail.
 *
 * Variables (en Vercel → Settings → Environment Variables):
 *   GMAIL_USUARIO          la cuenta que envía, p. ej. presupuesto.coac@gmail.com
 *   GMAIL_CLAVE_APLICACION contraseña de aplicación de 16 letras de esa cuenta (NO la contraseña normal)
 *   CORREO_REMITENTE       opcional: nombre que ve quien recibe (por defecto "COAC Once de Junio")
 *
 * Solo para pruebas locales: SMTP_HOST y SMTP_PORT apuntan a otro servidor de correo.
 */

export function correoConfigurado(): boolean {
  return !!(process.env.GMAIL_USUARIO && process.env.GMAIL_CLAVE_APLICACION) || !!process.env.SMTP_HOST;
}

let transporte: Mail | null = null;
function obtenerTransporte(): Mail {
  if (transporte) return transporte;
  if (process.env.SMTP_HOST) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 25),
      secure: false,
      ignoreTLS: true,
    });
  } else {
    transporte = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USUARIO,
        // Google muestra la clave con espacios ("abcd efgh ijkl mnop"); se aceptan igual
        pass: (process.env.GMAIL_CLAVE_APLICACION ?? "").replace(/\s+/g, ""),
      },
    });
  }
  return transporte;
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function enviarClaveTemporal(datos: {
  para: string;
  nombre: string;
  usuario: string;
  clave: string;
  minutos: number;
  urlIngreso: string;
}): Promise<void> {
  const remitente = process.env.CORREO_REMITENTE || "COAC Once de Junio";
  const desde = process.env.GMAIL_USUARIO || "no-responder@localhost";
  const n = escapar(datos.nombre);
  const u = escapar(datos.usuario);
  const c = escapar(datos.clave);
  const url = escapar(datos.urlIngreso);

  const texto = [
    `Hola ${datos.nombre}:`,
    "",
    `Recibimos una solicitud para restablecer la contraseña del usuario "${datos.usuario}".`,
    "",
    `Clave temporal: ${datos.clave}`,
    `Vence en ${datos.minutos} minutos y sirve una sola vez. Al ingresar, se le pedirá crear una contraseña nueva.`,
    "",
    `Ingresar: ${datos.urlIngreso}`,
    "",
    "Si usted no lo solicitó, ignore este mensaje: su contraseña actual sigue funcionando.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#EEF1EF;font-family:Arial,Helvetica,sans-serif;color:#111418">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #E3E6E4;border-radius:14px">
      <tr><td style="padding:28px 32px 8px">
        <div style="font-size:18px;font-weight:bold">COAC Once de Junio</div>
        <div style="width:32px;height:3px;background:#C38A03;margin-top:10px"></div>
      </td></tr>
      <tr><td style="padding:16px 32px 0;font-size:15px;line-height:1.5">
        <p style="margin:0 0 12px">Hola ${n}:</p>
        <p style="margin:0 0 20px">Recibimos una solicitud para restablecer la contraseña del usuario <b>${u}</b>. Use esta clave temporal para ingresar:</p>
      </td></tr>
      <tr><td align="center" style="padding:0 32px">
        <div style="font-family:'Courier New',monospace;font-size:26px;font-weight:bold;letter-spacing:3px;color:#005A28;background:#E8F4EC;border:1px solid #B9DEC6;border-radius:10px;padding:14px 20px;display:inline-block">${c}</div>
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-size:14px;line-height:1.5;color:#26302B">
        Vence en <b>${datos.minutos} minutos</b> y sirve una sola vez. Al ingresar, el sistema le pedirá crear una contraseña nueva.
      </td></tr>
      <tr><td align="center" style="padding:24px 32px">
        <a href="${url}" style="background:#005A28;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:8px;display:inline-block">Ingresar al sistema</a>
      </td></tr>
      <tr><td style="padding:0 32px 28px;font-size:12.5px;line-height:1.5;color:#6B7570;border-top:1px solid #EEF0EE">
        <p style="margin:16px 0 0">Si usted no solicitó este cambio, ignore este mensaje: su contraseña actual sigue funcionando y nadie más puede usar esta clave.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  await obtenerTransporte().sendMail({
    from: { name: remitente, address: desde },
    to: datos.para,
    subject: "Clave temporal de acceso — COAC Once de Junio",
    text: texto,
    html,
  });
}
