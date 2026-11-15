import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** La sesión se renueva con cada uso: una app pausada días puede seguir pidiendo su audio. */
const SESSION_TTL_MS = 7 * DAY_MS;
const TOUCH_EVERY_MS = 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 50;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

@Injectable()
export class PlaySessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaySessionService.name);
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

  async create(userId: string, summaryId: string, deviceName: string | undefined, startTime: number) {
    const session = await this.prisma.playSession.create({
      data: {
        userId,
        summaryId,
        startTime,
        deviceName: deviceName?.slice(0, 100),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    const stale = await this.prisma.playSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SESSIONS_PER_USER,
      select: { id: true },
    });
    if (stale.length) await this.prisma.playSession.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    return session;
  }

  /** Sesión de un usuario (para sync y cierre); null si no existe, es de otro usuario o caducó. */
  async findOwned(id: string, userId: string) {
    const session = await this.prisma.playSession.findFirst({ where: { id, userId, expiresAt: { gt: new Date() } } });
    return session;
  }

  /**
   * Autoriza la URL pública del audio: el id aleatorio de la sesión es el secreto. Devuelve los datos
   * necesarios para servir el archivo, o null si la sesión caducó o el audio ya no está disponible.
   */
  async findForStreaming(id: string) {
    const session = await this.prisma.playSession.findFirst({
      where: { id, expiresAt: { gt: new Date() } },
      include: { summary: { select: { s3Key: true, contentType: true, sizeBytes: true, status: true, deletedAt: true } } },
    });
    if (!session || session.summary.deletedAt || session.summary.status !== SummaryStatus.READY) return null;
    if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - TOUCH_EVERY_MS) {
      await this.prisma.playSession.update({ where: { id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    }
    return session.summary;
  }

  async touch(id: string) {
    await this.prisma.playSession.updateMany({ where: { id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  }

  async deleteExpired() {
    const { count } = await this.prisma.playSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (count) this.logger.log(`Sesiones de reproducción caducadas eliminadas: ${count}`);
    return count;
  }
}
