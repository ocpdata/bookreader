import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DAY_MS, PENDING_TTL_HOURS, PURGE_BATCH_SIZE, TRASH_RETENTION_DAYS } from './trash.constants';

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

export interface PurgeResult {
  trashExpired: number;
  pendingStale: number;
  failed: number;
}

/** Borrado definitivo de audios: primero el archivo en S3 y después la fila, nunca al revés. */
@Injectable()
export class PurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurgeService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    if (process.env.PURGE_ENABLED === 'false') return;
    const run = () => this.run().catch((error) => this.logger.error(`Purga fallida: ${error}`));
    const first = setTimeout(run, FIRST_RUN_DELAY_MS);
    const every = setInterval(run, RUN_EVERY_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  /**
   * Borra un audio de forma definitiva. Si S3 falla, la fila se conserva para reintentar; si el archivo
   * ya no existe, S3 lo trata como éxito. Devuelve false cuando no se pudo borrar.
   */
  async destroy(summary: { id: string; s3Key: string; coverKey?: string | null }): Promise<boolean> {
    try {
      await this.storage.deleteObject(summary.s3Key);
      if (summary.coverKey) await this.storage.deleteObject(summary.coverKey);
    } catch (error) {
      this.logger.error(`No se pudo borrar el archivo del audio ${summary.id}: ${error}`);
      return false;
    }
    await this.prisma.summary.delete({ where: { id: summary.id } });
    return true;
  }

  /** Papelera vencida y cargas pendientes abandonadas. `now` permite probarlo sin esperar. */
  async run(now = new Date()): Promise<PurgeResult> {
    const trashCutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS);
    const pendingCutoff = new Date(now.getTime() - PENDING_TTL_HOURS * 60 * 60 * 1000);

    const [expired, stale] = await Promise.all([
      this.prisma.summary.findMany({
        where: { deletedAt: { not: null, lt: trashCutoff } },
        select: { id: true, s3Key: true, coverKey: true },
        orderBy: { deletedAt: 'asc' },
        take: PURGE_BATCH_SIZE,
      }),
      this.prisma.summary.findMany({
        where: {
          status: SummaryStatus.PENDING,
          deletedAt: null,
          createdAt: { lt: pendingCutoff },
          OR: [{ uploadIssuedAt: null }, { uploadIssuedAt: { lt: pendingCutoff } }],
        },
        select: { id: true, s3Key: true, coverKey: true },
        orderBy: { createdAt: 'asc' },
        take: PURGE_BATCH_SIZE,
      }),
    ]);

    const result: PurgeResult = { trashExpired: 0, pendingStale: 0, failed: 0 };
    for (const row of expired) (await this.destroy(row)) ? result.trashExpired++ : result.failed++;
    for (const row of stale) {
      const claimTime = new Date();
      const claimed = await this.prisma.summary.updateMany({
        where: {
          id: row.id, status: SummaryStatus.PENDING, deletedAt: null, createdAt: { lt: pendingCutoff },
          OR: [{ uploadIssuedAt: null }, { uploadIssuedAt: { lt: pendingCutoff } }],
          AND: [{ OR: [{ purgeClaimedAt: null }, { purgeClaimedAt: { lt: new Date(now.getTime() - DAY_MS) } }] }],
        },
        data: { purgeClaimedAt: claimTime },
      });
      if (!claimed.count) continue;
      if (await this.destroy(row)) {
        result.pendingStale++;
      } else {
        result.failed++;
        await this.prisma.summary.updateMany({ where: { id: row.id, purgeClaimedAt: claimTime }, data: { purgeClaimedAt: null } });
      }
    }

    if (result.trashExpired || result.pendingStale || result.failed) {
      this.logger.log(
        `Purga: ${result.trashExpired} de la papelera, ${result.pendingStale} cargas pendientes, ${result.failed} fallidas`,
      );
    }
    return result;
  }
}
