import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { OWNER_ID } from '../accounts/account-eraser';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveLimits } from '../quota/quota.service';
import { ListAdminUsersQuery } from './admin.dto';
import { LoginRateLimiter } from './login-rate-limiter';
import { PasswordService } from './password.service';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  async requireAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Se requiere una cuenta administradora activa');
    }
    return user;
  }

  async listUsers(userId: string, query: ListAdminUsersQuery = {}) {
    await this.requireAdmin(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const order = query.order ?? 'desc';
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.plan ? { plan: query.plan } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q } }, { email: { contains: query.q } }] } : {}),
    };
    // El id desempata para que la paginación sea estable.
    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === 'name'
        ? [{ name: order }, { id: 'asc' }]
        : query.sort === 'lastLogin'
          ? [{ lastLoginAt: { sort: order, nulls: 'last' } }, { id: 'asc' }]
          : [{ createdAt: order }, { id: 'asc' }];

    const [users, total, byStatus, byRole, byPlan] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          plan: true,
          planExpiresAt: true,
          createdAt: true,
          lastLoginAt: true,
          storageLimitBytes: true,
          maxAudios: true,
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['plan'], _count: { _all: true } }),
    ]);
    // Uso de la página: todo lo que tiene el usuario (también pendientes y papelera), como la cuota.
    const usage = await this.prisma.summary.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((user) => user.id) } },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    });
    const usageOf = new Map(usage.map((row) => [row.userId, row]));
    return {
      users: users.map((user) => {
        const used = usageOf.get(user.id);
        const limits = effectiveLimits(user);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          isOwner: user.id === OWNER_ID,
          plan: user.plan,
          planExpiresAt: user.planExpiresAt,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          usedBytes: Number(used?._sum.sizeBytes ?? 0),
          audios: used?._count._all ?? 0,
          limitBytes: limits.limitBytes,
          maxAudios: limits.maxAudios,
          customQuota: user.storageLimitBytes !== null || user.maxAudios !== null,
        };
      }),
      page,
      pageSize,
      total,
      summary: {
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
        byRole: Object.fromEntries(byRole.map((row) => [row.role, row._count._all])),
        byPlan: Object.fromEntries(byPlan.map((row) => [row.plan, row._count._all])),
      },
    };
  }

  async changeRole(actorId: string, targetId: string, role: UserRole, password: string, ip: string) {
    const actor = await this.requireAdmin(actorId);
    if (actorId !== OWNER_ID) throw new ForbiddenException('Solo el propietario puede cambiar roles');
    if (targetId === OWNER_ID) throw new ForbiddenException('No se puede cambiar el rol del propietario');
    const key = actor.email ?? actor.id;
    if (this.limiter.isBlocked(ip, key)) {
      throw new HttpException('Demasiados intentos. Inténtalo de nuevo en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!(await this.passwords.verify(password, actor.passwordHash))) {
      this.limiter.recordFailure(ip, key);
      throw new BadRequestException('La contraseña no es correcta');
    }
    this.limiter.reset(ip, key);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: actorId } });
      if (!currentActor || currentActor.status !== UserStatus.ACTIVE || currentActor.role !== UserRole.ADMIN || currentActor.passwordHash !== actor.passwordHash) {
        throw new ForbiddenException('La cuenta propietaria cambió; vuelve a intentarlo');
      }
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetId} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Usuario no encontrado');
      if (target.role === role) throw new BadRequestException('El usuario ya tiene ese rol');
      if (role === UserRole.ADMIN && target.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Solo se puede nombrar administrador a una cuenta activa');
      }
      const previousRole = target.role;
      await tx.user.update({ where: { id: targetId }, data: { role } });
      await tx.adminRoleChange.create({ data: { actorId, targetId, previousRole, newRole: role } });
      return { id: targetId, role };
    });
  }
}
