import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const MAX_APP_PASSWORDS_PER_USER = 10;
// Sin caracteres que se confunden al leerlos o teclearlos (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LENGTH = 5;

const normalize = (code: string) => code.replace(/[^a-z0-9]/gi, '').toUpperCase();
const hashCode = (code: string) => createHash('sha256').update(normalize(code)).digest('hex');

/**
 * Códigos de aplicación: contraseñas largas y aleatorias, una por dispositivo, para las apps compatibles con
 * Audiobookshelf (que solo saben pedir correo y contraseña). Sirven únicamente en ese acceso, nunca en la web, y se
 * pueden revocar una a una. En la base solo queda el hash; el código se muestra una sola vez al crearlo.
 */
@Injectable()
export class AppPasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string) {
    const active = await this.prisma.appPassword.count({ where: { userId } });
    if (active >= MAX_APP_PASSWORDS_PER_USER) {
      throw new BadRequestException(`Ya tienes ${MAX_APP_PASSWORDS_PER_USER} códigos de aplicación; revoca alguno para crear otro`);
    }
    const code = Array.from({ length: GROUPS }, () =>
      Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
    ).join('-');
    const row = await this.prisma.appPassword.create({
      data: { userId, name: name.trim().slice(0, 100) || 'Dispositivo', codeHash: hashCode(code) },
    });
    return { id: row.id, name: row.name, code, createdAt: row.createdAt };
  }

  list(userId: string) {
    return this.prisma.appPassword.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
  }

  async revoke(userId: string, id: string) {
    const { count } = await this.prisma.appPassword.deleteMany({ where: { id, userId } });
    return count > 0;
  }

  revokeAll(userId: string) {
    return this.prisma.appPassword.deleteMany({ where: { userId } });
  }

  /** true si el código es uno vigente de esa cuenta. */
  async verify(userId: string, code: string) {
    if (normalize(code).length !== GROUPS * GROUP_LENGTH) return false;
    const row = await this.prisma.appPassword.findUnique({ where: { codeHash: hashCode(code) } });
    if (!row || row.userId !== userId) return false;
    await this.prisma.appPassword.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return true;
  }
}
