import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { hashAudio } from './audio-hash';

@Injectable()
export class HashBackfillService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HashBackfillService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  onModuleInit() {
    if (process.env.PURGE_ENABLED === 'false' || process.env.HASH_BACKFILL_ENABLED === 'false') return;
    const run = () => this.run().catch((error) => this.logger.error(`Cálculo de huellas fallido: ${error}`));
    this.timers = [setTimeout(run, 60_000), setInterval(run, 15 * 60_000)];
    this.timers.forEach((timer) => timer.unref());
  }

  onModuleDestroy() {
    this.timers.forEach(clearTimeout);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.prisma.summary.findMany({
        where: { status: SummaryStatus.READY, audioSha256: null },
        select: { id: true, s3Key: true },
        orderBy: [{ hashAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      });
      for (const row of rows) {
        await this.prisma.summary.updateMany({
          where: { id: row.id, status: SummaryStatus.READY, audioSha256: null },
          data: { hashAttemptAt: new Date() },
        });
        try {
          const audioSha256 = await hashAudio(this.storage, row.s3Key);
          await this.prisma.summary.updateMany({
            where: { id: row.id, status: SummaryStatus.READY, audioSha256: null },
            data: { audioSha256 },
          });
        } catch (error) {
          this.logger.warn(`No se pudo calcular la huella del audio ${row.id}: ${error}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
