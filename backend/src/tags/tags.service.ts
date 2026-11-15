import { Injectable } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_TAGS_PER_SUMMARY = 10;
export const MAX_TAG_LENGTH = 50;

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca o crea las etiquetas del usuario. La comparación la hace MySQL con su colación
   * (ignora mayúsculas y acentos): "Ventas" y "ventas" resuelven a la misma etiqueta.
   */
  private async resolveIds(userId: string, names: string[]): Promise<string[]> {
    const ids = new Set<string>();
    for (const name of names) {
      let tag = await this.prisma.tag.findFirst({ where: { userId, name } });
      if (!tag) {
        try {
          tag = await this.prisma.tag.create({ data: { userId, name } });
        } catch (error) {
          // Otra petición la creó a la vez: se usa esa.
          if ((error as { code?: string }).code !== 'P2002') throw error;
          tag = await this.prisma.tag.findFirstOrThrow({ where: { userId, name } });
        }
      }
      ids.add(tag.id);
    }
    return [...ids];
  }

  /** Reemplaza las etiquetas de un audio (lista vacía = quitarlas todas) y limpia las huérfanas. */
  async replaceForSummary(summaryId: string, userId: string, names: string[]) {
    const tagIds = await this.resolveIds(userId, names);
    await this.prisma.$transaction([
      this.prisma.summaryTag.deleteMany({ where: { summaryId } }),
      this.prisma.summaryTag.createMany({ data: tagIds.map((tagId) => ({ summaryId, tagId })) }),
    ]);
    await this.prisma.tag.deleteMany({ where: { userId, summaries: { none: {} } } });
  }

  /** Etiquetas del usuario con su número de audios, para autocompletar y filtrar. */
  async suggest(userId: string, query?: string) {
    const term = query?.replace(/[\\%_]/g, '\\$&');
    const tags = await this.prisma.tag.findMany({
      where: {
        userId,
        ...(term ? { name: { contains: term } } : {}),
        summaries: { some: { summary: { status: SummaryStatus.READY } } },
      },
      include: {
        summaries: { where: { summary: { status: SummaryStatus.READY } }, select: { summaryId: true } },
      },
    });
    return tags
      .map((tag) => ({ name: tag.name, count: tag.summaries.length }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  }
}
