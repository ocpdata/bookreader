const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CATEGORIES = [
  'Desarrollo personal',
  'Ventas',
  'Negocios',
  'Finanzas',
  'Liderazgo',
  'Productividad',
  'Tecnología',
  'Psicología',
  'Historia',
  'Otros',
];

async function main() {
  for (const name of CATEGORIES) {
    await prisma.category.upsert({ where: { sharedName: name }, update: {}, create: { name, sharedName: name } });
  }
}

main().finally(() => prisma.$disconnect());
