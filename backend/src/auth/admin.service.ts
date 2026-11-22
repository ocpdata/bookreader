import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { OWNER_ID } from '../accounts/account-eraser';
import { PrismaService } from '../prisma/prisma.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { PasswordService } from './password.service';

const PAGE_SIZE = 50;

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

  async listUsers(userId: string, page: number) {
    await this.requireAdmin(userId);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Página no válida');
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, email: true, role: true, status: true },
      }),
      this.prisma.user.count(),
    ]);
    return {
      users: users.map(({ id, name, email, role, status }) => ({ id, name, email, role, status, isOwner: id === OWNER_ID })),
      page,
      pageSize: PAGE_SIZE,
      total,
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
