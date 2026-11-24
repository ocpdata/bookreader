/** Correos transaccionales en español: texto plano (obligatorio) y HTML sencillo. Todo dato de usuario se escapa. */

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string, extraAction?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('');
  const actions = [action, extraAction].filter((item): item is { label: string; url: string } => !!item);
  const button = actions.map((item) =>
    `<p style="margin:24px 0"><a href="${escape(item.url)}" style="background:#1565c0;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escape(item.label)}</a></p>
<p style="margin:0 0 16px;color:#555;font-size:13px">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escape(item.url)}</span></p>`
  ).join('');
  const small = footer ? `<p style="margin:24px 0 0;color:#777;font-size:12px">${escape(footer)}</p>` : '';
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#222;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escape(heading)}</h1>${body}${button}${small}</div>`;
}

const text = (lines: (string | undefined)[]) => lines.filter((l) => l !== undefined).join('\n');

export function shareInvitationMessage(ownerName: string, scope: 'LIBRARY' | 'ITEMS', url: string) {
  const description = scope === 'LIBRARY' ? 'su biblioteca de audios, incluidos los que añada después' : 'una selección fija de sus audios';
  const loginUrl = new URL('/entrar?from=share', url).toString();
  const registerUrl = new URL('/registro?from=share', url).toString();
  const paragraphs = [
    `${ownerName} quiere compartir contigo ${description} en BookBrief.`,
    'Usa el mismo correo al que llegó esta invitación. Si aún no tienes cuenta, crea una y verifica tu correo primero. La primera prueba gratuita dura 30 días desde la verificación.',
    'Tienes 7 días para aceptar o rechazar. No tendrás acceso a los audios hasta aceptar; el propietario puede revocar el acceso.',
  ];
  return {
    subject: 'Invitación para compartir audios en BookBrief',
    text: text([...paragraphs, '', `Ya tengo cuenta: ${loginUrl}`, `Crear cuenta de prueba: ${registerUrl}`, '', 'Si no esperabas esta invitación, puedes ignorarla.']),
    html: layout('Te invitaron a escuchar', paragraphs, { label: 'Ya tengo cuenta', url: loginUrl }, 'Si no esperabas esta invitación, puedes ignorarla.', { label: 'Crear cuenta de prueba', url: registerUrl }),
  };
}

export function verifyEmailMessage(name: string, url: string) {
  return {
    subject: 'Verifica tu correo en BookBrief',
    text: text([
      `Hola ${name},`,
      '',
      'Para activar tu cuenta de BookBrief, abre este enlace (vale 24 horas):',
      url,
      '',
      'Si no creaste una cuenta, ignora este correo: no se activará nada.',
    ]),
    html: layout(`Hola ${name}`, ['Para activar tu cuenta de BookBrief, verifica tu correo. El enlace vale 24 horas.'], { label: 'Verificar mi correo', url }, 'Si no creaste una cuenta, ignora este correo: no se activará nada.'),
  };
}

export function resetPasswordMessage(name: string, url: string) {
  return {
    subject: 'Restablece tu contraseña de BookBrief',
    text: text([
      `Hola ${name},`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña. Abre este enlace (vale 1 hora):',
      url,
      '',
      'Si no la pediste, ignora este correo: tu contraseña sigue igual.',
    ]),
    html: layout(`Hola ${name}`, ['Recibimos una solicitud para restablecer tu contraseña. El enlace vale 1 hora.'], { label: 'Elegir una contraseña nueva', url }, 'Si no la pediste, ignora este correo: tu contraseña sigue igual.'),
  };
}

export function accountExistsMessage(name: string, loginUrl: string, resetUrl: string) {
  return {
    subject: 'Ya tienes una cuenta en BookBrief',
    text: text([
      `Hola ${name},`,
      '',
      'Alguien intentó crear una cuenta con este correo, pero ya tienes una en BookBrief.',
      `Puedes entrar aquí: ${loginUrl}`,
      `Si olvidaste tu contraseña: ${resetUrl}`,
      '',
      'Si no fuiste tú, no tienes que hacer nada.',
    ]),
    html: layout(`Hola ${name}`, ['Alguien intentó crear una cuenta con este correo, pero ya tienes una en BookBrief.', 'Si olvidaste tu contraseña, puedes restablecerla.'], { label: 'Entrar a BookBrief', url: loginUrl }, `Si no fuiste tú, no tienes que hacer nada. Restablecer contraseña: ${resetUrl}`),
  };
}

export function passwordChangedMessage(name: string, resetUrl: string) {
  return {
    subject: 'Tu contraseña de BookBrief cambió',
    text: text([
      `Hola ${name},`,
      '',
      'La contraseña de tu cuenta de BookBrief acaba de cambiar y se cerraron tus otras sesiones y apps vinculadas.',
      `Si no fuiste tú, restablécela de inmediato: ${resetUrl}`,
    ]),
    html: layout(`Hola ${name}`, ['La contraseña de tu cuenta de BookBrief acaba de cambiar y se cerraron tus otras sesiones y apps vinculadas.', 'Si no fuiste tú, restablécela de inmediato.'], { label: 'Restablecer mi contraseña', url: resetUrl }),
  };
}

export function accountDeletedMessage(name: string) {
  return {
    subject: 'Eliminamos tu cuenta de BookBrief',
    text: text([
      `Hola ${name},`,
      '',
      'Tu cuenta de BookBrief y todo su contenido (audios, portadas, carpetas, marcadores y progreso) se eliminaron a petición tuya.',
      'Las copias técnicas de los archivos pueden tardar hasta 14 días en desaparecer por completo.',
      '',
      'Si no fuiste tú, responde a este correo cuanto antes.',
    ]),
    html: layout(`Hola ${name}`, ['Tu cuenta de BookBrief y todo su contenido (audios, portadas, carpetas, marcadores y progreso) se eliminaron a petición tuya.', 'Las copias técnicas de los archivos pueden tardar hasta 14 días en desaparecer por completo.'], undefined, 'Si no fuiste tú, responde a este correo cuanto antes.'),
  };
}
