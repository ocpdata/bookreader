import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { ApiTokenService } from './api-token.service';
import { AppPasswordService } from './app-password.service';
import { PasswordService } from './password.service';
import { ReauthService } from './reauth.service';
import { RegistrationService } from './registration.service';
import { TERMS_VERSION } from './registration.config';
import { SessionService } from './session.service';
import { AccountEraser, OWNER_ID } from '../accounts/account-eraser';

const NO_PASSWORD = 'Tu cuenta entra con Google y no tiene contraseña. Puedes crear una con «Olvidé mi contraseña».';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginRateLimiter,
    private readonly apiTokens: ApiTokenService,
    private readonly appPasswords: AppPasswordService,
    private readonly reauth: ReauthService,
    private readonly registration: RegistrationService,
    private readonly eraser: AccountEraser,
  ) {}

  /**
   * Comprueba correo y contraseña con límite de intentos y error genérico; no crea ninguna sesión. Con
   * `allowAppPassword` (acceso de las apps) también vale un código de aplicación de la cuenta.
   */
  async verifyCredentials(rawEmail: string, password: string, ip: string, allowAppPassword = false) {
    const email = normalizeEmail(rawEmail);
    if (this.limiter.isBlocked(ip, email)) {
      throw new HttpException('Demasiados intentos. Inténtalo de nuevo en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    let valid = await this.passwords.verify(password, user?.passwordHash ?? null);
    if (!valid && user && allowAppPassword) valid = await this.appPasswords.verify(user.id, password);
    if (!user || !valid) {
      this.limiter.recordFailure(ip, email);
      // Nunca se registra la contraseña; el mensaje al cliente es el mismo exista o no el usuario.
      this.logger.warn(`Inicio de sesión fallido (${ip})`);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    this.limiter.reset(ip, email);
    // Solo después de comprobar la contraseña se dice por qué no puede entrar (no delata cuentas a quien no la conoce).
    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('Verifica tu correo para entrar: te enviamos un enlace al registrarte.');
    }
    if (user.status === UserStatus.SUSPENDED) throw new ForbiddenException('Tu cuenta está suspendida.');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return user;
  }

  async login(rawEmail: string, password: string, ip: string, userAgent?: string) {
    const user = await this.verifyCredentials(rawEmail, password, ip);
    const session = await this.sessions.create(user.id, userAgent);
    return { session, user: this.present(user) };
  }

  /** Lo que la web necesita saber de la persona; `needsTerms` es true si no aceptó la versión vigente de los términos. */
  private present(user: { id: string; name: string; email: string | null; termsVersion: string | null; role: UserRole; passwordHash: string | null }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      needsTerms: user.termsVersion !== TERMS_VERSION,
      role: user.role,
      isOwner: user.id === OWNER_ID,
      // false en las cuentas creadas con Google: no pueden confirmar con contraseña hasta crear una.
      hasPassword: Boolean(user.passwordHash),
    };
  }

  /** Login de una app compatible: devuelve un token de dispositivo en vez de abrir una sesión web. */
  async loginDevice(rawEmail: string, password: string, ip: string, deviceName: string) {
    const user = await this.verifyCredentials(rawEmail, password, ip, true);
    return { token: await this.apiTokens.create(user.id, deviceName), user };
  }

  async me(userId: string) {
    return this.present(await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }));
  }

  /** Registra la aceptación de la versión vigente de los términos y del aviso de privacidad. */
  async acceptTerms(userId: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } });
    return this.present(user);
  }

  /**
   * Elimina la cuenta y todos sus datos, tras confirmar la contraseña (con el mismo límite de intentos que el acceso).
   * Un error de contraseña es un 400, no un 401: el cliente cerraría la sesión al verlo.
   */
  async deleteAccount(userId: string, password: string | undefined, ip: string) {
    if (userId === OWNER_ID) throw new ForbiddenException('La cuenta propietaria no se puede eliminar desde la web');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (password) {
      const key = user.email ?? user.id;
      if (this.limiter.isBlocked(ip, key)) {
        throw new HttpException('Demasiados intentos. Inténtalo de nuevo en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (!(await this.passwords.verify(password, user.passwordHash))) {
        this.limiter.recordFailure(ip, key);
        throw new BadRequestException('La contraseña no es correcta');
      }
      this.limiter.reset(ip, key);
    } else if (!this.reauth.consume(userId)) {
      // Sin contraseña, la confirmación es volver a identificarse con Google poco antes.
      throw new BadRequestException('Confirma tu identidad con Google antes de eliminar la cuenta');
    }
    await this.eraser.deleteAccount(userId);
    await this.registration.notifyAccountDeleted(user);
  }

  /** Cambia la contraseña y cierra el resto de sesiones del usuario (la actual se conserva). */
  async changePassword(userId: string, sessionToken: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) throw new BadRequestException(NO_PASSWORD);
    if (!(await this.passwords.verify(current, user.passwordHash))) {
      // 400 y no 401: el 401 significa "no hay sesión válida" y el cliente cierra la sesión al recibirlo.
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    this.passwords.assertAcceptable(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.sessions.destroyOthers(userId, sessionToken);
    // Los dispositivos vinculados también deben volver a iniciar sesión con la contraseña nueva.
    await this.apiTokens.revokeAll(userId);
    await this.appPasswords.revokeAll(userId);
    await this.registration.notifyPasswordChanged(user);
  }
}
