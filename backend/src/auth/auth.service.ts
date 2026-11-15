import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { ApiTokenService } from './api-token.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

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
  ) {}

  /** Comprueba correo y contraseña con límite de intentos y error genérico; no crea ninguna sesión. */
  async verifyCredentials(rawEmail: string, password: string, ip: string) {
    const email = normalizeEmail(rawEmail);
    if (this.limiter.isBlocked(ip, email)) {
      throw new HttpException('Demasiados intentos. Inténtalo de nuevo en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await this.passwords.verify(password, user?.passwordHash ?? null);
    if (!user || !valid) {
      this.limiter.recordFailure(ip, email);
      // Nunca se registra la contraseña; el mensaje al cliente es el mismo exista o no el usuario.
      this.logger.warn(`Inicio de sesión fallido (${ip})`);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    this.limiter.reset(ip, email);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return user;
  }

  async login(rawEmail: string, password: string, ip: string, userAgent?: string) {
    const user = await this.verifyCredentials(rawEmail, password, ip);
    const session = await this.sessions.create(user.id, userAgent);
    return { session, user: { id: user.id, name: user.name, email: user.email } };
  }

  /** Login de una app compatible: devuelve un token de dispositivo en vez de abrir una sesión web. */
  async loginDevice(rawEmail: string, password: string, ip: string, deviceName: string) {
    const user = await this.verifyCredentials(rawEmail, password, ip);
    return { token: await this.apiTokens.create(user.id, deviceName), user };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, name: user.name, email: user.email };
  }

  /** Cambia la contraseña y cierra el resto de sesiones del usuario (la actual se conserva). */
  async changePassword(userId: string, sessionToken: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(current, user.passwordHash))) {
      // 400 y no 401: el 401 significa "no hay sesión válida" y el cliente cierra la sesión al recibirlo.
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    this.passwords.assertAcceptable(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.sessions.destroyOthers(userId, sessionToken);
    // Los dispositivos vinculados también deben volver a iniciar sesión con la contraseña nueva.
    await this.apiTokens.revokeAll(userId);
  }
}
