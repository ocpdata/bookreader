import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  ShareScope,
  ShareStatus,
  SummaryStatus,
  UserStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { isEmail, isUUID } from 'class-validator';
import { HOUR_MS, SlidingWindowLimiter } from '../auth/rate-limiter';
import { MailService } from '../mail/mail.service';
import { shareInvitationMessage } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShareDto, MAX_SHARE_ITEMS } from './sharing.dto';

const DAY_MS = 24 * HOUR_MS;
const include = {
  owner: { select: { name: true } },
  items: {
    orderBy: { summaryId: 'asc' as const },
    include: {
      summary: {
        select: { title: true, author: true, status: true, deletedAt: true },
      },
    },
  },
} satisfies Prisma.ShareInclude;
type ShareRow = Prisma.ShareGetPayload<{ include: typeof include }>;
type Db = Prisma.TransactionClient;
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface Share {
  id: string;
  email: string;
  ownerName: string;
  scope: ShareScope;
  status: ShareStatus;
  createdAt: Date;
  expiresAt: Date;
  summaryIds: string[];
  summaries: { id: string; title: string; author: string }[];
}

@Injectable()
export class SharingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharingService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly limiter: SlidingWindowLimiter,
  ) {}

  private transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    // En MySQL REPEATABLE READ, una lectura previa al bloqueo podría conservar un estado obsoleto.
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  onModuleInit() {
    if (process.env.PURGE_ENABLED === 'false') return;
    this.timer = setInterval(
      () =>
        this.cleanup().catch(() =>
          this.logger.error('No se pudieron limpiar las invitaciones'),
        ),
      HOUR_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Retiene 30 días desde caducidad o decisión terminal; nunca elimina permisos ACCEPTED por edad. */
  async cleanup() {
    const cutoff = new Date(Date.now() - 30 * DAY_MS);
    const result = await this.transaction(async (tx) => {
      const attempts = await tx.shareMailAttempt.deleteMany({
        where: { createdAt: { lte: cutoff } },
      });
      const shares = await tx.share.deleteMany({
        where: {
          OR: [
            { status: ShareStatus.PENDING, expiresAt: { lte: cutoff } },
            {
              status: { in: [ShareStatus.REJECTED, ShareStatus.REVOKED] },
              updatedAt: { lte: cutoff },
            },
          ],
        },
      });
      return { shares: shares.count, mailAttempts: attempts.count };
    });
    if (result.shares || result.mailAttempts)
      this.logger.log(
        `Limpieza de compartición: ${result.shares} invitaciones, ${result.mailAttempts} intentos`,
      );
    return result;
  }

  isEnabled(): boolean {
    return process.env.SHARING_ENABLED === 'true';
  }

  private assertEnabled() {
    if (!this.isEnabled())
      throw new ForbiddenException(
        'La compartición no está disponible por ahora',
      );
  }

  private present(row: ShareRow): Share {
    return {
      id: row.id,
      email: row.email,
      ownerName: row.owner.name,
      scope: row.scope,
      status: row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      summaryIds: row.items.map((item) => item.summaryId),
      summaries:
        row.status === ShareStatus.ACCEPTED ||
        (row.status === ShareStatus.PENDING &&
          row.expiresAt.getTime() > Date.now())
          ? row.items
              .filter(
                (item) =>
                  item.summary.status === SummaryStatus.READY &&
                  !item.summary.deletedAt,
              )
              .map((item) => ({
                id: item.summaryId,
                title: item.summary.title,
                author: item.summary.author,
              }))
          : [],
    };
  }

  private async user(db: Db, userId: string, verified = true) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      (verified && (!user.email || !user.emailVerifiedAt))
    ) {
      throw new ForbiddenException(
        'Necesitas una cuenta activa con correo verificado para compartir',
      );
    }
    return user;
  }

  /** Solo origen de configuración, nunca Host/Origin de la petición ni tokens en el enlace. */
  private invitationUrl() {
    try {
      const base = new URL(
        process.env.APP_PUBLIC_URL ?? 'http://localhost:5500',
      );
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        (process.env.NODE_ENV === 'production' &&
          (!process.env.APP_PUBLIC_URL || base.protocol !== 'https:'))
      ) {
        throw new Error('Origen inseguro');
      }
      return new URL('/compartidos', base.origin).toString();
    } catch {
      this.logger.error(
        'APP_PUBLIC_URL no es un origen seguro para las invitaciones',
      );
      throw new ServiceUnavailableException(
        'No se pudo preparar el correo de invitación',
      );
    }
  }

  private limit(key: string, max: number) {
    if (!this.limiter.allow(key, max, HOUR_MS)) {
      throw new HttpException(
        'Demasiadas invitaciones. Inténtalo de nuevo en un rato.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async mailLimits(
    tx: Db,
    userId: string,
    email: string,
    ip: string,
    now: Date,
  ) {
    const [hour, day] = await Promise.all([
      tx.shareMailAttempt.count({
        where: {
          share: { ownerId: userId },
          createdAt: { gt: new Date(now.getTime() - HOUR_MS) },
        },
      }),
      tx.shareMailAttempt.count({
        where: {
          share: { ownerId: userId },
          createdAt: { gt: new Date(now.getTime() - DAY_MS) },
        },
      }),
    ]);
    if (hour >= 20 || day >= 100)
      throw new HttpException(
        'Alcanzaste el límite de invitaciones',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.limit(`shares:ip:${ip}`, 30);
    this.limit(
      `shares:mail:${createHash('sha256').update(email).digest('hex')}`,
      3,
    );
  }

  private activeKey(
    userId: string,
    email: string,
    scope: ShareScope,
    summaryIds: string[],
  ) {
    return createHash('sha256')
      .update(JSON.stringify([userId, email, scope, [...summaryIds].sort()]))
      .digest('hex');
  }

  private async validateSelection(
    tx: Db,
    userId: string,
    scope: ShareScope,
    summaryIds: string[],
  ) {
    if (scope === ShareScope.LIBRARY) return;
    if (!summaryIds.length)
      throw new BadRequestException(
        'La selección ya no contiene audios disponibles',
      );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM summaries WHERE user_id = ${userId} AND id IN (${Prisma.join(summaryIds)}) FOR UPDATE`,
    );
    const valid = await tx.summary.count({
      where: {
        id: { in: summaryIds },
        userId,
        status: SummaryStatus.READY,
        deletedAt: null,
      },
    });
    if (valid !== summaryIds.length)
      throw new BadRequestException(
        'La selección debe contener solo audios propios disponibles',
      );
  }

  async create(
    userId: string,
    dto: CreateShareDto,
    ip = 'desconocida',
  ): Promise<Share> {
    this.assertEnabled();
    const email = normalizeEmail(dto.email);
    const rawIds = dto.summaryIds === undefined ? [] : dto.summaryIds;
    if (
      !isEmail(email) ||
      email.length > 255 ||
      !Object.values(ShareScope).includes(dto.scope) ||
      !Array.isArray(rawIds) ||
      rawIds.length > MAX_SHARE_ITEMS ||
      rawIds.some((id) => typeof id !== 'string' || !isUUID(id)) ||
      new Set(rawIds.map((id) => id.toLowerCase())).size !== rawIds.length ||
      (dto.scope === ShareScope.LIBRARY && rawIds.length !== 0) ||
      (dto.scope === ShareScope.ITEMS && rawIds.length === 0)
    ) {
      throw new BadRequestException(
        'Elige LIBRARY sin ids o ITEMS con una selección válida de hasta 200 audios',
      );
    }
    const summaryIds = rawIds.map((id) => id.toLowerCase());
    const url = this.invitationUrl();
    const key = this.activeKey(userId, email, dto.scope, summaryIds);
    const row = await this.transaction(async (tx) => {
      // Serializa duplicados y cuotas entre todas las instancias sin consultar cuentas destinatarias.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const owner = await this.user(tx, userId);
      if (normalizeEmail(owner.email!) === email)
        throw new BadRequestException('No puedes compartir contigo mismo');
      const now = new Date();
      await tx.share.updateMany({
        where: {
          ownerId: userId,
          status: ShareStatus.PENDING,
          expiresAt: { lte: now },
          activeKey: { not: null },
        },
        data: { activeKey: null },
      });
      if (
        await tx.share.findUnique({
          where: { activeKey: key },
          select: { id: true },
        })
      ) {
        throw new ConflictException(
          'Ya existe una invitación vigente con ese ámbito y selección',
        );
      }
      const active = await tx.share.count({
        where: {
          ownerId: userId,
          OR: [
            { status: ShareStatus.ACCEPTED },
            { status: ShareStatus.PENDING, expiresAt: { gt: now } },
          ],
        },
      });
      if (active >= 100) {
        throw new HttpException(
          'Alcanzaste el límite de invitaciones',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.validateSelection(tx, userId, dto.scope, summaryIds);
      await this.mailLimits(tx, userId, email, ip, now);
      return tx.share.create({
        data: {
          ownerId: userId,
          email,
          scope: dto.scope,
          activeKey: key,
          expiresAt: new Date(now.getTime() + 7 * DAY_MS),
          items: summaryIds.length
            ? { create: summaryIds.map((summaryId) => ({ summaryId })) }
            : undefined,
          mailAttempts: { create: {} },
        },
        include,
      });
    });

    // SES no participa en la transacción. Mientras no confirme, la invitación no es accionable.
    try {
      await this.mail.send({
        to: email,
        ...shareInvitationMessage(row.owner.name, row.scope, url),
      });
      await this.prisma.share.updateMany({
        where: { id: row.id, status: ShareStatus.PENDING },
        data: { deliveredAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo entregar la invitación ${row.id}: ${(error as Error).name ?? 'Error'}`,
      );
      try {
        await this.prisma.share.updateMany({
          where: { id: row.id, status: ShareStatus.PENDING },
          data: { status: ShareStatus.REVOKED, activeKey: null },
        });
      } catch {
        this.logger.error(
          `No se pudo cancelar la invitación no entregada ${row.id}`,
        );
      }
      throw new ServiceUnavailableException(
        'No se pudo entregar el correo de invitación. Inténtalo de nuevo.',
      );
    }
    return this.present(
      await this.prisma.share.findUniqueOrThrow({
        where: { id: row.id },
        include,
      }),
    );
  }

  async sent(userId: string): Promise<Share[]> {
    await this.user(this.prisma, userId, false);
    return (
      await this.prisma.share.findMany({
        where: { ownerId: userId },
        include,
        orderBy: { createdAt: 'desc' },
      })
    ).map((row) => this.present(row));
  }

  async received(userId: string): Promise<Share[]> {
    const user = await this.user(this.prisma, userId);
    // No vincula cuentas al listar y no expone invitaciones aceptadas por una cuenta anterior.
    return (
      await this.prisma.share.findMany({
        where: {
          email: normalizeEmail(user.email!),
          deliveredAt: { not: null },
          OR: [{ recipientId: null }, { recipientId: userId }],
        },
        include,
        orderBy: { createdAt: 'desc' },
      })
    ).map((row) => this.present(row));
  }

  async accept(userId: string, id: string): Promise<Share> {
    this.assertEnabled();
    return this.decide(userId, id, ShareStatus.ACCEPTED);
  }

  async reject(userId: string, id: string): Promise<Share> {
    return this.decide(userId, id, ShareStatus.REJECTED);
  }

  /** Un reenvío exitoso renueva siete días. Si falla, conserva el plazo y entrega anteriores. */
  async resend(userId: string, id: string, ip = 'desconocida'): Promise<Share> {
    this.assertEnabled();
    const url = this.invitationUrl();
    const previous = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await this.user(tx, userId);
      await tx.$queryRaw`SELECT id FROM shares WHERE id = ${id} FOR UPDATE`;
      const row = await tx.share.findUnique({ where: { id }, include });
      if (!row || row.ownerId !== userId)
        throw new NotFoundException('Invitación no encontrada');
      if (row.status !== ShareStatus.PENDING || !row.deliveredAt)
        throw new ConflictException('La invitación no admite reenvío');
      const now = new Date();
      if (row.expiresAt <= now) {
        const active = await tx.share.count({
          where: {
            ownerId: userId,
            OR: [
              { status: ShareStatus.ACCEPTED },
              { status: ShareStatus.PENDING, expiresAt: { gt: now } },
            ],
          },
        });
        if (active >= 100)
          throw new HttpException(
            'Alcanzaste el límite de invitaciones',
            HttpStatus.TOO_MANY_REQUESTS,
          );
      }
      const key = this.activeKey(
        userId,
        row.email,
        row.scope,
        row.items.map((item) => item.summaryId),
      );
      await tx.share.updateMany({
        where: {
          ownerId: userId,
          status: ShareStatus.PENDING,
          expiresAt: { lte: now },
          id: { not: id },
        },
        data: { activeKey: null },
      });
      const duplicate = await tx.share.findUnique({
        where: { activeKey: key },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== id)
        throw new ConflictException(
          'Ya existe otra invitación vigente con ese ámbito y selección',
        );
      await this.validateSelection(
        tx,
        userId,
        row.scope,
        row.items.map((item) => item.summaryId),
      );
      await this.mailLimits(tx, userId, row.email, ip, now);
      await tx.share.update({
        where: { id },
        data: {
          activeKey: key,
          deliveredAt: null,
          expiresAt: new Date(now.getTime() + 7 * DAY_MS),
          mailAttempts: { create: {} },
        },
      });
      return row;
    });
    try {
      await this.mail.send({
        to: previous.email,
        ...shareInvitationMessage(previous.owner.name, previous.scope, url),
      });
      await this.prisma.share.updateMany({
        where: { id, status: ShareStatus.PENDING },
        data: { deliveredAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo reenviar la invitación ${id}: ${(error as Error).name ?? 'Error'}`,
      );
      try {
        await this.transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
          await tx.share.updateMany({
            where: { id, status: ShareStatus.PENDING, deliveredAt: null },
            data: {
              expiresAt: previous.expiresAt,
              deliveredAt: previous.deliveredAt,
              activeKey:
                previous.expiresAt.getTime() > Date.now()
                  ? previous.activeKey
                  : null,
            },
          });
        });
      } catch {
        this.logger.error(
          `No se pudo restaurar la invitación ${id} tras el fallo de reenvío`,
        );
      }
      throw new ServiceUnavailableException(
        'No se pudo reenviar el correo de invitación. Inténtalo de nuevo.',
      );
    }
    return this.present(
      await this.prisma.share.findUniqueOrThrow({ where: { id }, include }),
    );
  }

  private async decide(
    userId: string,
    id: string,
    status: 'ACCEPTED' | 'REJECTED',
  ): Promise<Share> {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await this.user(tx, userId);
      await tx.$queryRaw`SELECT id FROM shares WHERE id = ${id} FOR UPDATE`;
      const row = await tx.share.findUnique({ where: { id }, include });
      if (
        !row ||
        row.email !== normalizeEmail(user.email!) ||
        row.ownerId === userId ||
        (row.recipientId !== null && row.recipientId !== userId) ||
        !row.deliveredAt
      ) {
        throw new NotFoundException('Invitación no encontrada');
      }
      if (
        row.status !== ShareStatus.PENDING ||
        row.expiresAt.getTime() <= Date.now()
      ) {
        throw new ConflictException(
          'La invitación ya no está pendiente o caducó',
        );
      }
      return this.present(
        await tx.share.update({
          where: { id },
          data: {
            status,
            recipientId: userId,
            ...(status === ShareStatus.REJECTED ? { activeKey: null } : {}),
          },
          include,
        }),
      );
    });
  }

  async revoke(userId: string, id: string): Promise<Share> {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shares WHERE id = ${id} FOR UPDATE`;
      const row = await tx.share.findUnique({ where: { id }, include });
      if (!row || row.ownerId !== userId)
        throw new NotFoundException('Invitación no encontrada');
      if (row.status === ShareStatus.REVOKED) return this.present(row);
      if (row.status === ShareStatus.REJECTED)
        throw new ConflictException('La invitación fue rechazada');
      return this.present(
        await tx.share.update({
          where: { id },
          data: { status: ShareStatus.REVOKED, activeKey: null },
          include,
        }),
      );
    });
  }

  /** Solo permisos: el consumidor agrega READY/deletedAt. Nunca almacena ni cachea permisos aceptados. */
  async readableWhere(userId: string): Promise<Prisma.SummaryWhereInput> {
    if (!this.isEnabled()) return { userId };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !user.emailVerifiedAt ||
      !user.email
    )
      return { userId };
    const accepted: Prisma.ShareWhereInput = {
      recipientId: userId,
      email: normalizeEmail(user.email),
      status: ShareStatus.ACCEPTED,
      deliveredAt: { not: null },
    };
    return {
      OR: [
        { userId },
        {
          user: {
            sharesSent: { some: { ...accepted, scope: ShareScope.LIBRARY } },
          },
        },
        {
          shareItems: {
            some: { share: { ...accepted, scope: ShareScope.ITEMS } },
          },
        },
      ],
    };
  }

  async canRead(userId: string, summaryId: string): Promise<boolean> {
    return !!(await this.prisma.summary.findFirst({
      where: { AND: [{ id: summaryId }, await this.readableWhere(userId)] },
      select: { id: true },
    }));
  }
}
