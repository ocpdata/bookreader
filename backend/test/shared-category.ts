import { PrismaClient } from '@prisma/client';

export async function sharedCategory(prisma: PrismaClient, name: string) {
  return prisma.category.upsert({ where: { sharedName: name }, update: {}, create: { name, sharedName: name } });
}
