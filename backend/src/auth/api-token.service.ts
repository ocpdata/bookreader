import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const MAX_TOKENS_PER_USER = 20;
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export const hashApiToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Tokens opacos por dispositivo para las apps compatibles con Audiobookshelf. En la base solo queda el hash. */
@Injectable()
export class ApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    const token = `brt_${randomBytes(32).toString('base64url')}`;
    await this.prisma.apiToken.create({
      data: { userId, tokenHash: hashApiToken(token), name: name.slice(0, 100) || 'Dispositivo', lastUsedAt: new Date() },
    });
    // Tope por usuario: al pasarlo se descartan los más antiguos (un mismo móvil que entra varias veces no acumula).
    const stale = await this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_TOKENS_PER_USER,
      select: { id: true },
    });
    if (stale.length) await this.prisma.apiToken.deleteMany({ where: { id: { in: stale.map((t) => t.id) } } });
    return token;
  }

  async resolve(token: string): Promise<{ userId: string } | null> {
    const row = await this.prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(token) } });
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return { userId: row.userId };
  }

  /** Dispositivos vinculados de un usuario (sin el hash: no sirve para nada, pero tampoco se expone). */
  list(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
  }

  /** Revoca un dispositivo del usuario; false si no existe o es de otro usuario. */
  async revokeById(userId: string, id: string) {
    const { count } = await this.prisma.apiToken.deleteMany({ where: { id, userId } });
    return count > 0;
  }

  revokeAll(userId: string) {
    return this.prisma.apiToken.deleteMany({ where: { userId } });
  }

  revoke(token: string) {
    return this.prisma.apiToken.deleteMany({ where: { tokenHash: hashApiToken(token) } });
  }
}
