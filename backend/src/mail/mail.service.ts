import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export interface MailMessage {
  to: string;
  subject: string;
  /** Versión en texto plano (obligatoria: la leen los clientes sin HTML y mejora la entregabilidad). */
  text: string;
  html?: string;
}

/**
 * Envío de correo transaccional. En producción usa Amazon SES; en desarrollo y pruebas el mensaje
 * solo se registra (nunca se envía nada real). El destinatario y los enlaces no se escriben en los
 * registros de producción.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly driver = process.env.MAIL_DRIVER ?? (process.env.NODE_ENV === 'production' ? 'ses' : 'log');
  private readonly from = process.env.MAIL_FROM ?? 'BookBrief <no-responder@localhost>';
  private readonly configurationSet = process.env.SES_CONFIGURATION_SET;
  private ses?: SESv2Client;

  async send(message: MailMessage): Promise<void> {
    if (this.driver !== 'ses') {
      this.logger.log(`[correo simulado] a ${message.to}: ${message.subject}\n${message.text}`);
      return;
    }
    this.ses ??= new SESv2Client({ region: process.env.AWS_REGION });
    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        ConfigurationSetName: this.configurationSet,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
    );
    this.logger.log(`Correo enviado: "${message.subject}"`);
  }
}
