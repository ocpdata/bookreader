import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, userId: true },
    });
    return rows.map(({ userId: owner, ...category }) => ({
      ...category,
      isCustom: owner !== null,
    }));
  }

  async assertAccessible(db: Db, userId: string, categoryId: string) {
    const exists = await db.category.findFirst({
      where: { id: categoryId, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('La categoría no existe');
  }

  async create(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const exists = await tx.category.findFirst({
        where: { name, OR: [{ userId: null }, { userId }] },
        select: { id: true },
      });
      if (exists)
        throw new ConflictException('Ya existe una categoría con ese nombre');
      const category = await tx.category.create({
        data: { name, userId },
        select: { id: true, name: true },
      });
      return { ...category, isCustom: true };
    });
  }

  async remove(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const category = await tx.category.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Categoría no encontrada');
      const used = await tx.summary.count({ where: { categoryId: id } });
      if (used)
        throw new ConflictException(
          'No puedes eliminar una categoría con audios asociados, incluidos los pendientes y los de la papelera',
        );
      await tx.category.delete({ where: { id } });
    });
  }
}
