import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.PURGE_ENABLED === 'false') return;
    this.timer = setInterval(() => this.deleteExpired().catch((e) => this.logger.error(`${e}`)), CLEANUP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** El token solo existe en la cookie del usuario; en la base queda únicamente su hash. */
  async create(userId: string, userAgent?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 255) },
    });
    return { token, expiresAt };
  }

  /** Devuelve el usuario de una sesión vigente y la renueva (ventana deslizante) como máximo una vez al día. */
  async resolve(token: string): Promise<{ userId: string } | null> {
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    if (Date.now() - session.lastSeenAt.getTime() > DAY_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS) },
      });
    }
    return { userId: session.userId };
  }

  async destroy(token: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** Cierra todas las sesiones del usuario salvo la actual (por ejemplo, tras cambiar la contraseña). */
  async destroyOthers(userId: string, keepToken: string) {
    await this.prisma.session.deleteMany({ where: { userId, tokenHash: { not: hashToken(keepToken) } } });
  }

  /** Cierra todas las sesiones del usuario (por ejemplo, al restablecer la contraseña o suspender la cuenta). */
  async destroyAll(userId: string) {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  async deleteExpired() {
    const { count } = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (count) this.logger.log(`Sesiones caducadas eliminadas: ${count}`);
    return count;
  }
}
