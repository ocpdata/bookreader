import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GIB = 1024 ** 3;
const DEFAULT_STORAGE_LIMIT_BYTES = 2 * GIB;
const DEFAULT_MAX_AUDIOS = 500;

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const formatBytes = (bytes: number) =>
  bytes >= GIB ? `${(bytes / GIB).toFixed(2)} GB` : `${Math.max(0, bytes / 1024 ** 2).toFixed(1)} MB`;

type Tx = Prisma.TransactionClient;

export interface UsageSummary {
  usedBytes: number;
  limitBytes: number;
  audios: number;
  maxAudios: number;
  /** Parte de lo anterior que está en la papelera: sigue contando hasta que se elimina de forma definitiva. */
  trashBytes: number;
  trashAudios: number;
}

/**
 * Cuotas de almacenamiento y de número de audios por usuario. Cuenta todas las filas del usuario (también las
 * cargas pendientes, que ya reservan su espacio, y la papelera, cuyo archivo sigue en S3). Los valores por
 * defecto salen de DEFAULT_STORAGE_LIMIT_BYTES y DEFAULT_MAX_AUDIOS; cada cuenta puede tener los suyos
 * (`scripts/user-admin.js set-quota`). Las portadas (JPEG de hasta 800 px) no se descuentan.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async limits(db: Tx | PrismaService, userId: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { storageLimitBytes: true, maxAudios: true } });
    return {
      limitBytes: user.storageLimitBytes !== null ? Number(user.storageLimitBytes) : positive(process.env.DEFAULT_STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT_BYTES),
      maxAudios: user.maxAudios ?? positive(process.env.DEFAULT_MAX_AUDIOS, DEFAULT_MAX_AUDIOS),
    };
  }

  private async totals(db: Tx | PrismaService, userId: string, where: Prisma.SummaryWhereInput = {}) {
    const { _sum, _count } = await db.summary.aggregate({ where: { userId, ...where }, _sum: { sizeBytes: true }, _count: { _all: true } });
    return { bytes: Number(_sum.sizeBytes ?? 0), audios: _count._all };
  }

  async usage(userId: string): Promise<UsageSummary> {
    const [limits, all, trash] = await Promise.all([
      this.limits(this.prisma, userId),
      this.totals(this.prisma, userId),
      this.totals(this.prisma, userId, { deletedAt: { not: null } }),
    ]);
    return { usedBytes: all.bytes, limitBytes: limits.limitBytes, audios: all.audios, maxAudios: limits.maxAudios, trashBytes: trash.bytes, trashAudios: trash.audios };
  }

  /**
   * Ejecuta `create` solo si el audio nuevo cabe en la cuota. Las altas de un usuario se serializan con un
   * bloqueo sobre su fila: dos cargas simultáneas no pueden pasar la comprobación a la vez y excederla.
   */
  async reserve<T>(
    userId: string,
    addBytes: number,
    create: (tx: Tx) => Promise<T>,
    findExisting?: (tx: Tx) => Promise<T | null>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const existing = await findExisting?.(tx);
      if (existing) return existing;
      const [limits, used] = await Promise.all([this.limits(tx, userId), this.totals(tx, userId)]);
      if (used.audios >= limits.maxAudios) {
        throw new HttpException(
          { message: `Alcanzaste el máximo de ${limits.maxAudios} audios. Elimina alguno (y vacía la papelera) para subir más.`, code: 'QUOTA_AUDIOS' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      if (used.bytes + addBytes > limits.limitBytes) {
        throw new HttpException(
          {
            message: `No hay espacio suficiente: usas ${formatBytes(used.bytes)} de ${formatBytes(limits.limitBytes)} y este archivo ocupa ${formatBytes(addBytes)}. Elimina audios y vacía la papelera para liberar espacio.`,
            code: 'QUOTA_STORAGE',
          },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      return create(tx);
    });
  }
}
