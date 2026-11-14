import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
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
};

/** Fracción de la duración a partir de la cual el audio se considera terminado. */
const COMPLETE_RATIO = 0.95;

const withProgress = (userId: string) => ({ category: true, progress: { where: { userId } } });

/** Cada fila trae el progreso del usuario como lista de 0 o 1 elementos; se expone como objeto o null. */
function present<T extends { progress: { positionSeconds: number; completed: boolean; updatedAt: Date }[] }>(
  summary: T,
) {
  const { progress, ...rest } = summary;
  const row = progress[0];
  return {
    ...rest,
    progress: row ? { positionSeconds: row.positionSeconds, completed: row.completed, updatedAt: row.updatedAt } : null,
  };
}

const emptyToNull = (value: string | undefined) => (value === undefined ? undefined : value || null);

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  list(userId: string, { search, categoryId, sort }: ListSummariesQuery) {
    const where: Prisma.SummaryWhereInput = { userId, status: SummaryStatus.READY };
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      // La colación utf8mb4 de MySQL ignora mayúsculas y acentos. Prisma no escapa
      // los comodines de LIKE, así que se escapan aquí para buscar texto literal.
      const term = search.replace(/[\\%_]/g, '\\$&');
      where.OR = [
        { title: { contains: term } },
        { author: { contains: term } },
        { summaryTitle: { contains: term } },
      ];
    }
    return this.prisma.summary
      .findMany({ where, include: withProgress(userId), orderBy: ORDER_BY[sort ?? 'recent'] })
      .then((rows) => rows.map(present));
  }

  /** Un audio ajeno se trata igual que uno inexistente (404) para no revelar que existe. */
  async get(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({ where: { id, userId }, include: withProgress(userId) });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    return this.fillMissingDuration(present(row));
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
      include: withProgress(userId),
    });
    const uploadUrl = await this.storage.createUploadUrl(s3Key, dto.contentType, dto.sizeBytes);
    return { summary: present(summary), upload: { url: uploadUrl, headers: { 'Content-Type': dto.contentType } } };
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

    const updated = await this.prisma.summary.update({
      where: { id: summary.id },
      data: { status: SummaryStatus.READY, durationSeconds },
      include: withProgress(userId),
    });
    return present(updated);
  }

  async update(id: string, userId: string, dto: UpdateSummaryDto) {
    await this.get(id, userId);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const updated = await this.prisma.summary.update({
      where: { id },
      data: {
        title: dto.title,
        author: dto.author,
        summaryTitle: emptyToNull(dto.summaryTitle),
        narrator: emptyToNull(dto.narrator),
        description: emptyToNull(dto.description),
        categoryId: dto.categoryId,
      },
      include: withProgress(userId),
    });
    return present(updated);
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
