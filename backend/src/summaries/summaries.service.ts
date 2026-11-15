import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TagsService } from '../tags/tags.service';
import {
  AUDIO_TYPES,
  CreateSummaryDto,
  ListSummariesQuery,
  SaveProgressDto,
  SortOption,
  UpdateSummaryDto,
} from './summaries.dto';

const ORDER_BY: Record<SortOption, Prisma.SummaryOrderByWithRelationInput[]> = {
  recent: [{ createdAt: 'desc' }],
  title: [{ title: 'asc' }, { createdAt: 'desc' }],
  duration: [{ durationSeconds: 'desc' }, { createdAt: 'desc' }],
  // "listened" se ordena en memoria (la fecha de escucha está en otra tabla); este es el desempate.
  listened: [{ createdAt: 'desc' }],
};

/** Tamaño de las secciones de la pantalla de inicio. */
const HOME_CONTINUE_LIMIT = 10;
const HOME_SECTION_LIMIT = 8;

/** Fracción de la duración a partir de la cual el audio se considera terminado. */
const COMPLETE_RATIO = 0.95;

const withRelations = (userId: string) => ({
  category: true,
  progress: { where: { userId } },
  tags: { include: { tag: true } },
  favorites: { where: { userId } },
});

interface RelationRows {
  progress: { positionSeconds: number; completed: boolean; updatedAt: Date }[];
  tags: { tag: { name: string } }[];
  favorites: unknown[];
}

/** Aplana las relaciones: progreso como objeto o null, etiquetas como nombres y favorito como booleano. */
function present<T extends RelationRows>(summary: T) {
  const { progress, tags, favorites, ...rest } = summary;
  const row = progress[0];
  return {
    ...rest,
    progress: row ? { positionSeconds: row.positionSeconds, completed: row.completed, updatedAt: row.updatedAt } : null,
    tags: tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, 'es')),
    favorite: favorites.length > 0,
  };
}

const emptyToNull = (value: string | undefined) => (value === undefined ? undefined : value || null);

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tags: TagsService,
  ) {}

  async list(userId: string, { search, categoryId, tag, favorite, status, sort }: ListSummariesQuery) {
    const where: Prisma.SummaryWhereInput = { userId, status: SummaryStatus.READY };
    if (categoryId) where.categoryId = categoryId;
    // La colación utf8mb4 de MySQL ignora mayúsculas y acentos, también en la igualdad de etiquetas.
    if (tag) where.tags = { some: { tag: { name: tag } } };
    if (favorite) where.favorites = { some: { userId } };
    if (status === 'finished') where.progress = { some: { userId, completed: true } };
    if (status === 'unfinished') where.NOT = { progress: { some: { userId, completed: true } } };
    if (search) {
      // Prisma no escapa los comodines de LIKE: se escapan aquí para buscar texto literal.
      const term = search.replace(/[\\%_]/g, '\\$&');
      where.OR = [
        { title: { contains: term } },
        { author: { contains: term } },
        { summaryTitle: { contains: term } },
        { tags: { some: { tag: { name: { contains: term } } } } },
      ];
    }
    const rows = (
      await this.prisma.summary.findMany({
        where,
        include: withRelations(userId),
        orderBy: ORDER_BY[sort ?? 'recent'],
      })
    ).map(present);

    if (sort === 'listened') {
      // Lo último que escuchaste primero; lo que nunca se escuchó, al final (más reciente antes).
      const listenedAt = (s: (typeof rows)[number]) => s.progress?.updatedAt.getTime() ?? -1;
      rows.sort((a, b) => listenedAt(b) - listenedAt(a));
    }
    return rows;
  }

  /** Datos de la pantalla de inicio en una sola consulta: qué retomar, lo nuevo, favoritos y categorías. */
  async home(userId: string) {
    const ready = { userId, status: SummaryStatus.READY };
    const [continueRows, recent, favoriteRows, byCategory, total] = await Promise.all([
      // Audios empezados y no terminados, el último escuchado primero.
      this.prisma.playbackProgress.findMany({
        where: { userId, completed: false, positionSeconds: { gt: 0 }, summary: ready },
        orderBy: { updatedAt: 'desc' },
        take: HOME_CONTINUE_LIMIT,
        include: { summary: { include: withRelations(userId) } },
      }),
      this.prisma.summary.findMany({
        where: ready,
        orderBy: { createdAt: 'desc' },
        take: HOME_SECTION_LIMIT,
        include: withRelations(userId),
      }),
      // Favoritos: el marcado más recientemente primero.
      this.prisma.favorite.findMany({
        where: { userId, summary: ready },
        orderBy: { createdAt: 'desc' },
        take: HOME_SECTION_LIMIT,
        include: { summary: { include: withRelations(userId) } },
      }),
      this.prisma.summary.groupBy({ by: ['categoryId'], where: ready, _count: { _all: true } }),
      this.prisma.summary.count({ where: ready }),
    ]);

    const names = await this.prisma.category.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId) } } });
    const categories = byCategory
      .map((c) => ({
        id: c.categoryId,
        name: names.find((n) => n.id === c.categoryId)?.name ?? '',
        count: c._count._all,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));

    return {
      total,
      continueListening: continueRows.map((row) => present(row.summary)),
      recent: recent.map(present),
      favorites: favoriteRows.map((row) => present(row.summary)),
      categories,
    };
  }

  /** Un audio ajeno se trata igual que uno inexistente (404) para no revelar que existe. */
  async get(id: string, userId: string) {
    return this.fillMissingDuration(await this.load(id, userId));
  }

  private async load(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({ where: { id, userId }, include: withRelations(userId) });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    return present(row);
  }

  /** Audios anteriores a este campo: la duración se calcula al abrirlos y se guarda (mejor esfuerzo). */
  private async fillMissingDuration<T extends { id: string; status: SummaryStatus; durationSeconds: number | null; s3Key: string; contentType: string; sizeBytes: number }>(
    summary: T,
  ): Promise<T> {
    if (summary.status !== SummaryStatus.READY || summary.durationSeconds !== null) return summary;
    try {
      const durationSeconds = await this.storage.getAudioDurationSeconds(
        summary.s3Key,
        summary.contentType,
        summary.sizeBytes,
      );
      await this.prisma.summary.update({ where: { id: summary.id }, data: { durationSeconds } });
      return { ...summary, durationSeconds };
    } catch {
      return summary;
    }
  }

  async create(userId: string, dto: CreateSummaryDto) {
    const ext = extname(dto.originalFilename).toLowerCase();
    if (!AUDIO_TYPES[dto.contentType].includes(ext)) {
      throw new BadRequestException('La extensión del archivo no coincide con su tipo (.mp3 o .m4a)');
    }
    await this.assertCategory(dto.categoryId);

    // Clave nueva por carga y prefijada por usuario: una URL prefirmada nunca sobrescribe un audio.
    const s3Key = `audios/${userId}/${randomUUID()}/audio${ext}`;
    const summary = await this.prisma.summary.create({
      data: {
        userId,
        title: dto.title,
        author: dto.author,
        summaryTitle: dto.summaryTitle || null,
        narrator: dto.narrator || null,
        description: dto.description || null,
        categoryId: dto.categoryId,
        s3Key,
        originalFilename: dto.originalFilename,
        sizeBytes: dto.sizeBytes,
        contentType: dto.contentType,
      },
    });
    if (dto.tags?.length) await this.tags.replaceForSummary(summary.id, userId, dto.tags);
    const uploadUrl = await this.storage.createUploadUrl(s3Key, dto.contentType, dto.sizeBytes);
    return { summary: await this.load(summary.id, userId), upload: { url: uploadUrl, headers: { 'Content-Type': dto.contentType } } };
  }

  async complete(id: string, userId: string) {
    const summary = await this.get(id, userId);
    if (summary.status === SummaryStatus.READY) return summary;

    const size = await this.storage.getObjectSize(summary.s3Key);
    if (size === null) throw new BadRequestException('El archivo aún no existe en S3');
    if (size !== summary.sizeBytes) throw new BadRequestException('El tamaño del archivo subido no coincide');

    let durationSeconds: number;
    try {
      durationSeconds = await this.storage.getAudioDurationSeconds(summary.s3Key, summary.contentType, size);
    } catch {
      throw new BadRequestException('El archivo no es un audio MP3 o M4A válido');
    }

    await this.prisma.summary.update({
      where: { id: summary.id },
      data: { status: SummaryStatus.READY, durationSeconds },
    });
    return this.load(summary.id, userId);
  }

  async update(id: string, userId: string, dto: UpdateSummaryDto) {
    await this.get(id, userId);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    await this.prisma.summary.update({
      where: { id },
      data: {
        title: dto.title,
        author: dto.author,
        summaryTitle: emptyToNull(dto.summaryTitle),
        narrator: emptyToNull(dto.narrator),
        description: emptyToNull(dto.description),
        categoryId: dto.categoryId,
      },
    });
    if (dto.tags !== undefined) await this.tags.replaceForSummary(id, userId, dto.tags);
    return this.load(id, userId);
  }

  async setFavorite(id: string, userId: string, favorite: boolean) {
    await this.get(id, userId);
    if (favorite) {
      await this.prisma.favorite.upsert({
        where: { userId_summaryId: { userId, summaryId: id } },
        update: {},
        create: { userId, summaryId: id },
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId, summaryId: id } });
    }
    return { favorite };
  }

  async saveProgress(id: string, userId: string, dto: SaveProgressDto) {
    const summary = await this.get(id, userId);
    if (summary.status !== SummaryStatus.READY) {
      throw new BadRequestException('El audio aún no está disponible');
    }
    if (dto.positionSeconds === undefined && dto.completed === undefined) {
      throw new BadRequestException('Indica positionSeconds o completed');
    }

    const existing = summary.progress;
    let positionSeconds = dto.positionSeconds ?? existing?.positionSeconds ?? 0;
    if (summary.durationSeconds) positionSeconds = Math.min(positionSeconds, summary.durationSeconds);

    // "Terminado" es persistente: solo cambia al llegar al final, o de forma explícita.
    const reachedEnd = !!summary.durationSeconds && positionSeconds >= summary.durationSeconds * COMPLETE_RATIO;
    const completed = dto.completed ?? (reachedEnd || (existing?.completed ?? false));

    const where = { userId_summaryId: { userId, summaryId: id } };
    const data = { positionSeconds, completed };
    let row;
    try {
      row = await this.prisma.playbackProgress.upsert({ where, update: data, create: { userId, summaryId: id, ...data } });
    } catch (error) {
      // Dos guardados simultáneos pueden competir por crear la fila: el segundo la actualiza.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      row = await this.prisma.playbackProgress.update({ where, data });
    }
    return { positionSeconds: row.positionSeconds, completed: row.completed, updatedAt: row.updatedAt };
  }

  async resetProgress(id: string, userId: string) {
    await this.get(id, userId);
    await this.prisma.playbackProgress.deleteMany({ where: { userId, summaryId: id } });
  }

  async playback(id: string, userId: string) {
    const summary = await this.get(id, userId);
    if (summary.status !== SummaryStatus.READY) {
      throw new BadRequestException('El audio aún no está disponible');
    }
    return { url: await this.storage.createPlaybackUrl(summary.s3Key) };
  }

  private async assertCategory(categoryId: string) {
    const exists = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!exists) throw new BadRequestException('La categoría no existe');
  }
}
