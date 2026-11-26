import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserPlan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const GIB = 1024 ** 3;
const DEFAULT_STORAGE_LIMIT_BYTES = 2 * GIB;
const DEFAULT_MAX_AUDIOS = 500;
const TRIAL_STORAGE_LIMIT_BYTES = 2 * GIB;
const TRIAL_MAX_AUDIOS = 25;
const PREMIUM_STORAGE_LIMIT_BYTES = 10 * GIB;
const PREMIUM_MAX_AUDIOS = 500;

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
  plan: UserPlan;
  planExpiresAt: Date | null;
  /** true cuando la prueba o el plan de pago vencieron: se puede escuchar y borrar, pero no subir. */
  uploadsBlocked: boolean;
}

/**
 * Límites efectivos de una cuenta. Los del plan (FOUNDER conserva los valores clásicos del servicio) y, por encima,
 * la cuota propia que fije la administración.
 */
export function effectiveLimits(user: { storageLimitBytes: bigint | null; maxAudios: number | null; plan: UserPlan }) {
  const planLimits =
    user.plan === UserPlan.NONE || user.plan === UserPlan.TRIAL
      ? { limitBytes: TRIAL_STORAGE_LIMIT_BYTES, maxAudios: TRIAL_MAX_AUDIOS }
      : user.plan === UserPlan.PREMIUM
        ? {
            limitBytes: positive(process.env.PREMIUM_STORAGE_LIMIT_BYTES, PREMIUM_STORAGE_LIMIT_BYTES),
            maxAudios: positive(process.env.PREMIUM_MAX_AUDIOS, PREMIUM_MAX_AUDIOS),
          }
        : {
            limitBytes: positive(process.env.DEFAULT_STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT_BYTES),
            maxAudios: positive(process.env.DEFAULT_MAX_AUDIOS, DEFAULT_MAX_AUDIOS),
          };
  return {
    limitBytes: user.storageLimitBytes !== null ? Number(user.storageLimitBytes) : planLimits.limitBytes,
    maxAudios: user.maxAudios ?? planLimits.maxAudios,
  };
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
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storageLimitBytes: true, maxAudios: true, plan: true, planExpiresAt: true },
    });
    const { limitBytes, maxAudios } = effectiveLimits(user);
    return {
      limitBytes,
      maxAudios,
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      uploadsBlocked:
        user.plan === UserPlan.NONE ||
        (user.planExpiresAt !== null && user.planExpiresAt.getTime() < Date.now()),
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
    return {
      usedBytes: all.bytes,
      limitBytes: limits.limitBytes,
      audios: all.audios,
      maxAudios: limits.maxAudios,
      trashBytes: trash.bytes,
      trashAudios: trash.audios,
      plan: limits.plan,
      planExpiresAt: limits.planExpiresAt,
      uploadsBlocked: limits.uploadsBlocked,
    };
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
      if (limits.uploadsBlocked) {
        throw new HttpException(
          {
            message:
              limits.plan === UserPlan.NONE
                ? 'Completa una suscripción Premium para empezar a subir audios.'
                : limits.plan === UserPlan.TRIAL
                  ? 'Tu prueba gratuita terminó. Puedes seguir escuchando y descargando tus audios, pero para subir nuevos necesitas una suscripción.'
                  : 'Tu plan venció. Renueva la suscripción para volver a subir audios.',
            code: 'PLAN_EXPIRED',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
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
