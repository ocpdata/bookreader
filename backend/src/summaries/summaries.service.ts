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
  SortOption,
  UpdateSummaryDto,
} from './summaries.dto';

const ORDER_BY: Record<SortOption, Prisma.SummaryOrderByWithRelationInput[]> = {
  recent: [{ createdAt: 'desc' }],
  title: [{ title: 'asc' }, { createdAt: 'desc' }],
  duration: [{ durationSeconds: 'desc' }, { createdAt: 'desc' }],
};

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
    return this.prisma.summary.findMany({
      where,
      include: { category: true },
      orderBy: ORDER_BY[sort ?? 'recent'],
    });
  }

  /** Un audio ajeno se trata igual que uno inexistente (404) para no revelar que existe. */
  async get(id: string, userId: string) {
    const summary = await this.prisma.summary.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!summary) throw new NotFoundException('Resumen no encontrado');
    return this.fillMissingDuration(summary);
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
      include: { category: true },
    });
    const uploadUrl = await this.storage.createUploadUrl(s3Key, dto.contentType, dto.sizeBytes);
    return { summary, upload: { url: uploadUrl, headers: { 'Content-Type': dto.contentType } } };
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

    return this.prisma.summary.update({
      where: { id: summary.id },
      data: { status: SummaryStatus.READY, durationSeconds },
      include: { category: true },
    });
  }

  async update(id: string, userId: string, dto: UpdateSummaryDto) {
    await this.get(id, userId);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    return this.prisma.summary.update({
      where: { id },
      data: {
        title: dto.title,
        author: dto.author,
        summaryTitle: emptyToNull(dto.summaryTitle),
        narrator: emptyToNull(dto.narrator),
        description: emptyToNull(dto.description),
        categoryId: dto.categoryId,
      },
      include: { category: true },
    });
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
