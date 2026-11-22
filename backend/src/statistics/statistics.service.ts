import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AdminService } from '../auth/admin.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86400_000;
/** Tope por sincronización en línea: las apps informan el tiempo escuchado cada pocos segundos. */
const MAX_APP_CHUNK_MS = 30 * 60_000;
/** Tope por sesión sin conexión y antigüedad máxima aceptada para su fecha reportada. */
const MAX_APP_SESSION_MS = 24 * 3600_000;
const MAX_REPORTED_AGE_MS = 30 * DAY_MS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function periodStart(period: string | undefined, now = new Date()) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (!period || period === 'month') return new Date(today - 29 * DAY_MS);
  if (period === 'week') return new Date(today - 6 * DAY_MS);
  if (period === 'today') return new Date(today);
  throw new BadRequestException('Período no válido');
}

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  async record(
    userId: string,
    event: { id: string; summaryId: string; durationMs: number },
  ) {
    const summary = await this.prisma.summary.findFirst({
      where: {
        id: event.summaryId,
        userId,
        deletedAt: null,
        status: SummaryStatus.READY,
      },
      select: { id: true },
    });
    if (!summary) throw new NotFoundException('Audio no encontrado');
    const result = await this.prisma.listeningEvent.createMany({
      data: [{ ...event, userId }],
      skipDuplicates: true,
    });
    if (!result.count) {
      const existing = await this.prisma.listeningEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (
        existing.userId !== userId ||
        existing.summaryId !== event.summaryId ||
        existing.durationMs !== event.durationMs
      ) {
        throw new BadRequestException('Identificador de escucha ya utilizado');
      }
    }
  }

  /** Escucha incremental que informa una app conectada (timeListened de cada sincronización). */
  async recordAppChunk(userId: string, summaryId: string, seconds: number) {
    const durationMs = Math.round(Math.min(seconds * 1000, MAX_APP_CHUNK_MS));
    if (durationMs < 1000) return;
    await this.prisma.listeningEvent.create({
      data: { id: randomUUID(), userId, summaryId, durationMs },
    });
  }

  /**
   * Sesión grabada sin conexión: la app reenvía el total acumulado de la misma sesión (UUID del
   * cliente), así que solo se conserva el máximo reportado, nunca la suma de los reenvíos.
   */
  async recordAppSession(
    userId: string,
    summaryId: string,
    sessionId: string,
    seconds: number,
    reportedAtMs?: number,
  ) {
    if (!UUID_RE.test(sessionId)) return;
    const durationMs = Math.round(Math.min(seconds * 1000, MAX_APP_SESSION_MS));
    if (durationMs < 1000) return;
    const now = Date.now();
    const occurredAt = new Date(
      Math.min(now, Math.max(now - MAX_REPORTED_AGE_MS, reportedAtMs ?? now)),
    );
    const created = await this.prisma.listeningEvent.createMany({
      data: [{ id: sessionId, userId, summaryId, durationMs, occurredAt }],
      skipDuplicates: true,
    });
    if (created.count) return;
    const existing = await this.prisma.listeningEvent.findUniqueOrThrow({
      where: { id: sessionId },
    });
    // El identificador lo elige la app: si pertenece a otro usuario u otro audio, se ignora.
    if (existing.userId !== userId || existing.summaryId !== summaryId) return;
    if (durationMs > existing.durationMs) {
      await this.prisma.listeningEvent.update({
        where: { id: sessionId },
        data: { durationMs },
      });
    }
  }

  async personal(userId: string, period?: string) {
    const since = periodStart(period);
    const live = { userId, status: SummaryStatus.READY, deletedAt: null };
    const [saved, inProgress, finished, favorites, totals, events] =
      await Promise.all([
        this.prisma.summary.count({ where: live }),
        this.prisma.playbackProgress.count({
          where: {
            userId,
            completed: false,
            positionSeconds: { gt: 0 },
            summary: live,
          },
        }),
        this.prisma.playbackProgress.count({
          where: { userId, completed: true, summary: live },
        }),
        this.prisma.favorite.count({ where: { userId, summary: live } }),
        this.prisma.summary.aggregate({
          where: { userId },
          _sum: { sizeBytes: true },
          _count: { _all: true },
        }),
        this.prisma.listeningEvent.findMany({
          where: { userId, occurredAt: { gte: since } },
          select: {
            durationMs: true,
            occurredAt: true,
            summaryId: true,
            summary: { select: { title: true } },
          },
          orderBy: { occurredAt: 'asc' },
        }),
      ]);
    const days = new Map<string, number>();
    const titles = new Map<
      string,
      { id: string; title: string; durationMs: number }
    >();
    let durationMs = 0;
    for (const event of events) {
      durationMs += event.durationMs;
      const day = event.occurredAt.toISOString().slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + event.durationMs);
      const title = titles.get(event.summaryId) ?? {
        id: event.summaryId,
        title: event.summary.title,
        durationMs: 0,
      };
      title.durationMs += event.durationMs;
      titles.set(event.summaryId, title);
    }
    return {
      saved,
      inProgress,
      finished,
      favorites,
      storageBytes: Number(totals._sum.sizeBytes ?? 0),
      storageAudios: totals._count._all,
      durationMs,
      days: [...days].map(([date, durationMs]) => ({ date, durationMs })),
      titles: [...titles.values()].sort((a, b) => b.durationMs - a.durationMs),
    };
  }

  async overview(actorId: string, period?: string) {
    await this.admin.requireAdmin(actorId);
    const since = periodStart(period);
    const [registered, active, totals] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.listeningEvent.groupBy({
        by: ['userId'],
        where: { occurredAt: { gte: since } },
      }),
      this.prisma.listeningEvent.aggregate({
        where: { occurredAt: { gte: since } },
        _sum: { durationMs: true },
      }),
    ]);
    return {
      registered,
      activeListeners: active.length,
      durationMs: totals._sum.durationMs ?? 0,
    };
  }

  async adminUser(actorId: string, userId: string, period?: string) {
    await this.admin.requireAdmin(actorId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, lastLoginAt: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return { user, statistics: await this.personal(userId, period) };
  }
}
