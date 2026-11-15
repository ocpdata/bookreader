import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { accountDeletedMessage, accountExistsMessage, passwordChangedMessage, resetPasswordMessage, verifyEmailMessage } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { ApiTokenService } from './api-token.service';
import { EmailTokenService } from './email-token.service';
import { InvitationService } from './invitation.service';
import { PasswordService } from './password.service';
import { HOUR_MS, SlidingWindowLimiter } from './rate-limiter';
import { appUrl, registrationMode, TERMS_VERSION } from './registration.config';
import { RegisterDto } from './registration.dto';
import { SessionService } from './session.service';

const MAX_REGISTRATIONS_PER_IP_PER_HOUR = 10;
const MAX_REQUESTS_PER_IP_PER_HOUR = 10;
const MAX_MAILS_PER_ADDRESS_PER_HOUR = 3;
const PENDING_ACCOUNT_DAYS = 7;
const CLEANUP_EVERY_MS = HOUR_MS;

const INVALID_LINK = 'El enlace no es válido o caducó. Pide uno nuevo.';

/**
 * Registro con correo y contraseña. Las respuestas no revelan si un correo ya existe: el registro, el reenvío y
 * "olvidé mi contraseña" contestan lo mismo siempre, y es el correo el que dice qué pasó. Los envíos se limitan por
 * dirección (en silencio, para no delatar nada) y por IP.
 */
@Injectable()
export class RegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegistrationService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: EmailTokenService,
    private readonly invitations: InvitationService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokenService,
    private readonly limiter: SlidingWindowLimiter,
  ) {}

  onModuleInit() {
    if (process.env.PURGE_ENABLED === 'false') return;
    this.timer = setInterval(() => this.cleanup().catch((e) => this.logger.error(`${e}`)), CLEANUP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private limitIp(kind: string, ip: string, max: number) {
    if (!this.limiter.allow(`${kind}:ip:${ip}`, max, HOUR_MS)) {
      throw new HttpException('Demasiados intentos. Inténtalo de nuevo en un rato.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** true si aún se pueden enviar correos a esa dirección esta hora. */
  private mayMail(email: string) {
    return this.limiter.allow(`mail:${email}`, MAX_MAILS_PER_ADDRESS_PER_HOUR, HOUR_MS);
  }

  /** Un fallo de SES no debe revelar si la cuenta existía ni romper la respuesta: se registra y se sigue. */
  private async safeSend(message: { subject: string; text: string; html?: string }, to: string) {
    try {
      await this.mail.send({ to, ...message });
    } catch (error) {
      this.logger.error(`No se pudo enviar el correo "${message.subject}": ${(error as Error).message}`);
    }
  }

  private async sendVerification(user: Pick<User, 'id' | 'name' | 'email'>) {
    const token = await this.tokens.create(user.id, 'VERIFY_EMAIL');
    await this.safeSend(verifyEmailMessage(user.name, appUrl(`/verificar?token=${token}`)), user.email!);
  }

  async register(dto: RegisterDto, ip: string) {
    if (registrationMode() === 'closed') throw new ForbiddenException('El registro no está disponible por ahora');
    this.limitIp('register', ip, MAX_REGISTRATIONS_PER_IP_PER_HOUR);
    this.passwords.assertAcceptable(dto.password, { email: dto.email, name: dto.name });

    const invitation = registrationMode() === 'invite' ? await this.invitations.validate(dto.inviteCode, dto.email) : null;

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) return this.notifyExisting(existing);

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        if (invitation) await this.invitations.consume(tx, invitation.id);
        return tx.user.create({
          data: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            status: UserStatus.PENDING,
            termsAcceptedAt: new Date(),
            termsVersion: TERMS_VERSION,
          },
        });
      });
    } catch (error) {
      // Otra petición creó la cuenta a la vez: se trata como una cuenta existente.
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (raced) return this.notifyExisting(raced);
      }
      throw error;
    }
    if (this.mayMail(dto.email)) await this.sendVerification(user);
  }

  /**
   * Alguien se registró con un correo que ya existe. Una cuenta activa recibe un aviso; una pendiente recibe de nuevo
   * el enlace de verificación. La contraseña de una cuenta pendiente nunca se pisa: si no, quien se adelante a
   * una persona podría quedarse con la cuenta que ella verifica.
   */
  private async notifyExisting(user: User) {
    if (!user.email || user.status === UserStatus.SUSPENDED || !this.mayMail(user.email)) return;
    if (user.status === UserStatus.PENDING) return this.sendVerification(user);
    await this.safeSend(accountExistsMessage(user.name, appUrl('/entrar'), appUrl('/olvide')), user.email);
  }

  async resendVerification(email: string, ip: string) {
    this.limitIp('resend', ip, MAX_REQUESTS_PER_IP_PER_HOUR);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === UserStatus.PENDING && this.mayMail(email)) await this.sendVerification(user);
  }

  async verifyEmail(token: string) {
    const consumed = await this.tokens.consume(token, 'VERIFY_EMAIL');
    if (!consumed) throw new BadRequestException(INVALID_LINK);
    await this.prisma.user.updateMany({
      where: { id: consumed.userId, status: UserStatus.PENDING },
      data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
    });
  }

  async forgotPassword(email: string, ip: string) {
    this.limitIp('forgot', ip, MAX_REQUESTS_PER_IP_PER_HOUR);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === UserStatus.SUSPENDED || !this.mayMail(email)) return;
    // Una cuenta sin verificar no tiene nada que recuperar: se le reenvía la verificación.
    if (user.status === UserStatus.PENDING) return this.sendVerification(user);
    const token = await this.tokens.create(user.id, 'RESET_PASSWORD');
    await this.safeSend(resetPasswordMessage(user.name, appUrl(`/restablecer?token=${token}`)), email);
  }

  /**
   * Fija la contraseña nueva con el enlace del correo. Alcanzar el enlace demuestra que el correo es de la persona,
   * así que también verifica la cuenta. Se cierran todas las sesiones y los dispositivos vinculados.
   */
  async resetPassword(token: string, password: string) {
    const pending = await this.tokens.peek(token, 'RESET_PASSWORD');
    if (!pending) throw new BadRequestException(INVALID_LINK);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: pending.userId } });
    if (user.status === UserStatus.SUSPENDED) throw new BadRequestException(INVALID_LINK);
    // La contraseña se valida antes de gastar el enlace: una contraseña débil no debe obligar a pedir otro.
    this.passwords.assertAcceptable(password, { email: user.email ?? undefined, name: user.name });

    const consumed = await this.tokens.consume(token, 'RESET_PASSWORD');
    if (!consumed) throw new BadRequestException(INVALID_LINK);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(password),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.sessions.destroyAll(user.id);
    await this.apiTokens.revokeAll(user.id);
    if (user.email) await this.safeSend(passwordChangedMessage(user.name, appUrl('/olvide')), user.email);
  }

  /** Confirma por correo que la cuenta se eliminó (se envía después del borrado, con los datos que se guardaron antes). */
  async notifyAccountDeleted(user: Pick<User, 'name' | 'email'>) {
    if (user.email) await this.safeSend(accountDeletedMessage(user.name), user.email);
  }

  /** Avisa por correo de que la contraseña cambió (la usa también el cambio de contraseña desde la cuenta). */
  async notifyPasswordChanged(user: Pick<User, 'name' | 'email'>) {
    if (user.email) await this.safeSend(passwordChangedMessage(user.name, appUrl('/olvide')), user.email);
  }

  /** Limpieza horaria: enlaces vencidos y cuentas que nunca se verificaron (no tienen datos). */
  async cleanup() {
    const tokens = await this.tokens.deleteExpired();
    const { count } = await this.prisma.user.deleteMany({
      where: { status: UserStatus.PENDING, createdAt: { lt: new Date(Date.now() - PENDING_ACCOUNT_DAYS * 24 * HOUR_MS) } },
    });
    if (tokens || count) this.logger.log(`Limpieza de registro: ${tokens} enlaces vencidos, ${count} cuentas sin verificar`);
  }
}
