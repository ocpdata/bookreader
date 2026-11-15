import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/** El código se compara sin guiones ni mayúsculas: "br-ab12-cd34-ef56" y "BRAB12CD34EF56" son el mismo. */
export const normalizeInviteCode = (code: string) => code.replace(/[^a-z0-9]/gi, '').toUpperCase();
export const hashInviteCode = (code: string) => createHash('sha256').update(normalizeInviteCode(code)).digest('hex');

const INVALID = 'El código de invitación no es válido, caducó o ya se usó';

/** Invitaciones para el registro en modo "invite" (las crea el administrador con scripts/user-admin.js). */
@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Valida el código para ese correo sin consumirlo. */
  async validate(code: string | undefined, email: string) {
    if (!code || normalizeInviteCode(code).length < 8) throw new BadRequestException(INVALID);
    const invitation = await this.prisma.invitation.findUnique({ where: { codeHash: hashInviteCode(code) } });
    const usable =
      invitation &&
      invitation.uses < invitation.maxUses &&
      (!invitation.expiresAt || invitation.expiresAt.getTime() > Date.now()) &&
      (!invitation.email || invitation.email.toLowerCase() === email.toLowerCase());
    if (!usable) throw new BadRequestException(INVALID);
    return invitation;
  }

  /** Consume un uso de forma atómica (dentro de la misma transacción que crea la cuenta). */
  async consume(tx: Prisma.TransactionClient, invitationId: string) {
    const affected = await tx.$executeRaw`UPDATE invitations SET uses = uses + 1 WHERE id = ${invitationId} AND uses < max_uses`;
    if (affected !== 1) throw new BadRequestException(INVALID);
  }
}
