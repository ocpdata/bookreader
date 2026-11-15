#!/usr/bin/env node
// Envía un correo de prueba por Amazon SES con la misma configuración que la API, para comprobar el dominio,
// el remitente y los permisos de la VM. Uso en la VM:
//   cd /var/app/bookreader/current/backend && node --env-file=/var/app/bookreader/shared/api.env scripts/mail-test.js correo@dominio.com
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Uso: node scripts/mail-test.js <correo>');
  process.exit(1);
}

const from = process.env.MAIL_FROM;
if (!from) {
  console.error('Falta MAIL_FROM en el entorno.');
  process.exit(1);
}

new SESv2Client({ region: process.env.AWS_REGION })
  .send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
      Content: {
        Simple: {
          Subject: { Data: 'Prueba de correo de BookReader', Charset: 'UTF-8' },
          Body: {
            Text: {
              Data: 'Si lees esto, el envío de correo de BookReader funciona (dominio verificado y permisos correctos).',
              Charset: 'UTF-8',
            },
          },
        },
      },
    }),
  )
  .then((res) => console.log(`Enviado a ${to}. MessageId: ${res.MessageId}`))
  .catch((error) => {
    console.error(`No se pudo enviar: ${error.name}: ${error.message}`);
    process.exit(1);
  });
