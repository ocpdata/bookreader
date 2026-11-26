import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserPlan, UserRole, UserStatus } from '@prisma/client';
import { OWNER_ID } from '../accounts/account-eraser';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';
import { SetPlanDto, SetQuotaDto } from './admin.dto';
import { ApiTokenService } from './api-token.service';
import { AppPasswordService } from './app-password.service';
import { SessionService } from './session.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Acciones de administración sobre una cuenta: suspender y reactivar, plan y cuota (lo mismo que hace
 * `scripts/user-admin.js`). Cada una queda en `admin_user_actions` con quién la hizo y sobre quién.
 */
@Injectable()
export class AdminUserActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokenService,
    private readonly appPasswords: AppPasswordService,
  ) {}

  private async load(actorId: string, targetId: string) {
    const actor = await this.admin.requireAdmin(actorId);
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    return { actor, target };
  }

  private record(actorId: string, targetId: string, action: string, detail?: string) {
    return this.prisma.adminUserAction.create({ data: { actorId, targetId, action, detail: detail?.slice(0, 500) || null } });
  }

  async setStatus(actorId: string, targetId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    const { actor, target } = await this.load(actorId, targetId);
    if (status === UserStatus.SUSPENDED) {
      if (target.id === actor.id) throw new ForbiddenException('No puedes suspender tu propia cuenta');
      if (target.id === OWNER_ID) throw new ForbiddenException('No se puede suspender al propietario');
      if (target.role === UserRole.ADMIN && actor.id !== OWNER_ID) {
        throw new ForbiddenException('Solo el propietario puede suspender a un administrador');
      }
      if (target.status === UserStatus.SUSPENDED) throw new BadRequestException('La cuenta ya está suspendida');
      await this.prisma.user.update({ where: { id: target.id }, data: { status: UserStatus.SUSPENDED } });
      // La cuenta suspendida no puede seguir usando sesiones, apps vinculadas ni códigos de aplicación.
      await this.sessions.destroyAll(target.id);
      await this.apiTokens.revokeAll(target.id);
      await this.appPasswords.revokeAll(target.id);
      await this.record(actor.id, target.id, 'SUSPEND', reason ? `Motivo: ${reason}` : undefined);
      return { id: target.id, status: UserStatus.SUSPENDED };
    }
    if (target.status !== UserStatus.SUSPENDED) throw new BadRequestException('La cuenta no está suspendida');
    // Una cuenta que nunca verificó su correo vuelve a pendiente, no a activa.
    const next = target.emailVerifiedAt ? UserStatus.ACTIVE : UserStatus.PENDING;
    await this.prisma.user.update({ where: { id: target.id }, data: { status: next } });
    await this.record(actor.id, target.id, 'REACTIVATE', reason ? `Motivo: ${reason}` : undefined);
    return { id: target.id, status: next };
  }

  async setPlan(actorId: string, targetId: string, dto: SetPlanDto) {
    const { actor, target } = await this.load(actorId, targetId);
    if (dto.plan === UserPlan.TRIAL && !dto.days) throw new BadRequestException('La prueba gratuita requiere indicar los días');
    const planExpiresAt = dto.days ? new Date(Date.now() + dto.days * DAY_MS) : null;
    await this.prisma.user.update({ where: { id: target.id }, data: { plan: dto.plan, planExpiresAt } });
    await this.record(
      actor.id,
      target.id,
      'SET_PLAN',
      `${target.plan} → ${dto.plan}${dto.days ? `, ${dto.days} días` : ', sin vencimiento'}`,
    );
    return { id: target.id, plan: dto.plan, planExpiresAt };
  }

  async setQuota(actorId: string, targetId: string, dto: SetQuotaDto) {
    const { actor, target } = await this.load(actorId, targetId);
    const hasValue = dto.storageGb !== undefined || dto.maxAudios !== undefined;
    if (dto.reset && hasValue) throw new BadRequestException('Restablecer la cuota no se combina con valores nuevos');
    if (!dto.reset && !hasValue) throw new BadRequestException('Indica el almacenamiento, el número de audios o restablecer');
    const data = dto.reset
      ? { storageLimitBytes: null, maxAudios: null }
      : {
          ...(dto.storageGb !== undefined ? { storageLimitBytes: BigInt(Math.floor(dto.storageGb * 1024 ** 3)) } : {}),
          ...(dto.maxAudios !== undefined ? { maxAudios: dto.maxAudios } : {}),
        };
    const updated = await this.prisma.user.update({ where: { id: target.id }, data });
    await this.record(
      actor.id,
      target.id,
      'SET_QUOTA',
      dto.reset
        ? 'Cuota restablecida a la del plan'
        : [dto.storageGb !== undefined ? `${dto.storageGb} GB` : '', dto.maxAudios !== undefined ? `${dto.maxAudios} audios` : ''].filter(Boolean).join(', '),
    );
    return {
      id: target.id,
      storageLimitBytes: updated.storageLimitBytes === null ? null : Number(updated.storageLimitBytes),
      maxAudios: updated.maxAudios,
    };
  }
}
