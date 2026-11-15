import { Injectable } from '@nestjs/common';
import { EmailTokenPurpose } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;

/** Vigencia del enlace según su propósito: verificar el correo es menos delicado que restablecer la contraseña. */
export const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOUR_MS,
  RESET_PASSWORD: HOUR_MS,
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Enlaces de un solo uso enviados por correo. El token solo viaja en el correo; en la base queda su hash. */
@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea un token nuevo e invalida los anteriores del mismo propósito que no se hayan usado. */
  async create(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
      this.prisma.emailToken.create({
        data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) },
      }),
    ]);
    return token;
  }

  /** Comprueba que el token existe, no caducó ni se usó (sin consumirlo). */
  async peek(token: string, purpose: EmailTokenPurpose) {
    return this.prisma.emailToken.findFirst({
      where: { tokenHash: hash(token), purpose, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    });
  }

  /**
   * Consume el token de forma atómica: dos peticiones simultáneas con el mismo enlace nunca lo canjean las dos.
   * Devuelve el usuario al que pertenece, o null si no es válido.
   */
  async consume(token: string, purpose: EmailTokenPurpose): Promise<{ userId: string } | null> {
    const found = await this.peek(token, purpose);
    if (!found) return null;
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: found.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? { userId: found.userId } : null;
  }

  async deleteExpired() {
    const { count } = await this.prisma.emailToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 24 * HOUR_MS) } }, { usedAt: { lt: new Date(Date.now() - 24 * HOUR_MS) } }] },
    });
    return count;
  }
}
