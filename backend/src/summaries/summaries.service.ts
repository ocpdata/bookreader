import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AUDIO_TYPES, CreateSummaryDto, ListSummariesQuery, UpdateSummaryDto } from './summaries.dto';

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  list({ search, categoryId }: ListSummariesQuery) {
    const where: Prisma.SummaryWhereInput = { status: SummaryStatus.READY };
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      // La colación utf8mb4 de MySQL ignora mayúsculas y acentos. Prisma no escapa
      // los comodines de LIKE, así que se escapan aquí para buscar texto literal.
      const term = search.replace(/[\\%_]/g, '\\$&');
      where.OR = [{ title: { contains: term } }, { author: { contains: term } }];
    }
    return this.prisma.summary.findMany({
      where,
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const summary = await this.prisma.summary.findUnique({ where: { id }, include: { category: true } });
    if (!summary) throw new NotFoundException('Resumen no encontrado');
    return summary;
  }

  async create(dto: CreateSummaryDto) {
    const ext = extname(dto.originalFilename).toLowerCase();
    if (!AUDIO_TYPES[dto.contentType].includes(ext)) {
      throw new BadRequestException('La extensión del archivo no coincide con su tipo (.mp3 o .m4a)');
    }
    await this.assertCategory(dto.categoryId);

    // Clave nueva por carga: una URL prefirmada nunca sobrescribe un audio existente.
    const s3Key = `audios/${randomUUID()}/audio${ext}`;
    const summary = await this.prisma.summary.create({
      data: {
        title: dto.title,
        author: dto.author,
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

  async complete(id: string) {
    const summary = await this.get(id);
    if (summary.status === SummaryStatus.READY) return summary;

    const size = await this.storage.getObjectSize(summary.s3Key);
    if (size === null) throw new BadRequestException('El archivo aún no existe en S3');
    if (size !== summary.sizeBytes) throw new BadRequestException('El tamaño del archivo subido no coincide');

    return this.prisma.summary.update({
      where: { id },
      data: { status: SummaryStatus.READY },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateSummaryDto) {
    await this.get(id);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    return this.prisma.summary.update({
      where: { id },
      data: {
        title: dto.title,
        author: dto.author,
        description: dto.description === undefined ? undefined : dto.description || null,
        categoryId: dto.categoryId,
      },
      include: { category: true },
    });
  }

  async playback(id: string) {
    const summary = await this.get(id);
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
