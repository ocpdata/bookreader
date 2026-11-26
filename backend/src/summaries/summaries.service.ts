import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { AudioStorageError, InvalidAudioError, StorageService } from '../storage/storage.service';
import { coverVersion, newCoverKey, normalizeCover } from '../covers/cover-image';
import { FoldersService } from '../folders/folders.service';
import { AudioInfo } from '../storage/storage.service';
import { TagsService } from '../tags/tags.service';
import { PurgeService } from './purge.service';
import { CategoriesService } from '../categories/categories.service';
import { hashAudio } from './audio-hash';
import { bookUrlFor } from './book-link';
import { DriveService } from './drive.service';
import { SharingService } from '../sharing/sharing.service';
import { DAY_MS, TRASH_RETENTION_DAYS } from './trash.constants';
import {
  AUDIO_TYPES,
  CreateSummaryDto,
  DuplicateQueryDto,
  DriveFileDto,
  ListSummariesQuery,
  MoveSummariesDto,
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
  category: { select: { id: true, name: true } },
  progress: { where: { userId } },
  tags: { include: { tag: true } },
  favorites: { where: { userId } },
});

interface RelationRows {
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  coverKey: string | null;
  progress: { positionSeconds: number; completed: boolean; updatedAt: Date }[];
  tags: { tag: { name: string } }[];
  favorites: unknown[];
}

// Cambia la URL anterior para no reutilizar portadas cacheadas antes de comprobar permisos compartidos.
const coverUrlOf = (id: string, key: string | null) =>
  key ? `/api/summaries/${id}/cover?v=${coverVersion(key)}&access=1` : null;

/** Aplana las relaciones: progreso como objeto o null, etiquetas como nombres y favorito como booleano. */
function present<T extends RelationRows>(summary: T) {
  const { progress, tags, favorites, coverKey, ...rest } = summary;
  const row = progress[0];
  return {
    ...rest,
    bookUrl: bookUrlFor(rest),
    // La clave de S3 es interna; el cliente solo ve la URL (con versión para invalidar la caché).
    coverUrl: coverUrlOf(summary.id, coverKey),
    progress: row ? { positionSeconds: row.positionSeconds, completed: row.completed, updatedAt: row.updatedAt } : null,
    tags: tags.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b, 'es')),
    favorite: favorites.length > 0,
  };
}

const sharedInclude = (userId: string) => ({
  user: { select: { name: true } },
  progress: { where: { userId } },
  favorites: { where: { userId } },
}) satisfies Prisma.SummaryInclude;

type SharedRow = Prisma.SummaryGetPayload<{ include: ReturnType<typeof sharedInclude> }>;

function presentShared(row: SharedRow) {
  const progress = row.progress[0];
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    summaryTitle: row.summaryTitle,
    narrator: row.narrator,
    description: row.description,
    isbn13: row.isbn13,
    bookUrl: bookUrlFor(row),
    durationSeconds: row.durationSeconds,
    progress: progress ? { positionSeconds: progress.positionSeconds, completed: progress.completed, updatedAt: progress.updatedAt } : null,
    tags: [],
    favorite: row.favorites.length > 0,
    categoryId: '',
    category: { id: '', name: 'Compartido' },
    folderId: null,
    coverUrl: coverUrlOf(row.id, row.coverKey),
    originalFilename: '',
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt,
    isOwner: false,
    ownerName: row.user.name,
  };
}

const emptyToNull = (value: string | undefined) => (value === undefined ? undefined : value || null);

@Injectable()
export class SummariesService {
  private readonly logger = new Logger(SummariesService.name);
  private readonly driveInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tags: TagsService,
    private readonly folders: FoldersService,
    private readonly quota: QuotaService,
    private readonly purge: PurgeService,
    private readonly categories: CategoriesService,
    private readonly drive: DriveService,
    private readonly sharing: SharingService,
  ) {}

  async list(
    userId: string,
    { search, categoryId, folderId, includeSubfolders, tag, favorite, status, sort }: ListSummariesQuery,
  ) {
    const where: Prisma.SummaryWhereInput = { userId, status: SummaryStatus.READY, deletedAt: null };
    if (categoryId) where.categoryId = categoryId;
    if (folderId === 'root') {
      where.folderId = null;
    } else if (folderId && includeSubfolders) {
      where.folderId = { in: await this.folders.withDescendantIds(userId, folderId) };
    } else if (folderId) {
      await this.folders.assertOwned(userId, folderId);
      where.folderId = folderId;
    }
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
    const ready = { userId, status: SummaryStatus.READY, deletedAt: null };
    const [continueRows, recent, favoriteRows, byCategory, total] = await Promise.all([
      // Audios empezados y no terminados, el último escuchado primero.
      this.prisma.playbackProgress.findMany({
        where: { userId, completed: false, hideFromContinue: false, positionSeconds: { gt: 0 }, summary: ready },
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

  async getReadable(id: string, userId: string) {
    const owned = await this.prisma.summary.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
    if (owned) return { ...await this.get(id, userId), isOwner: true };
    const row = await this.prisma.summary.findFirst({
      where: { id, status: SummaryStatus.READY, deletedAt: null, AND: [await this.sharing.readableWhere(userId)] },
      include: sharedInclude(userId),
    });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    return presentShared(await this.fillMissingDuration(row));
  }

  async listShared(userId: string) {
    const rows = await this.prisma.summary.findMany({
      where: {
        userId: { not: userId },
        status: SummaryStatus.READY,
        deletedAt: null,
        AND: [await this.sharing.readableWhere(userId)],
      },
      include: sharedInclude(userId),
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentShared);
  }

  private async load(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({
      where: { id, userId, deletedAt: null },
      include: withRelations(userId),
    });
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
    if (dto.uploadRequestId && !dto.requestedSha256) {
      throw new BadRequestException('La carga recuperable requiere la huella del archivo');
    }
    const ext = extname(dto.originalFilename).toLowerCase();
    if (!AUDIO_TYPES[dto.contentType].includes(ext)) {
      throw new BadRequestException('La extensión del archivo no coincide con su tipo (.mp3 o .m4a)');
    }
    if (dto.folderId) await this.folders.assertOwned(userId, dto.folderId);

    // Clave nueva por carga y prefijada por usuario: una URL prefirmada nunca sobrescribe un audio.
    const s3Key = `audios/${userId}/${randomUUID()}/audio${ext}`;
    // La comprobación de la cuota y el alta van juntas, bajo el bloqueo del usuario.
    let created = false;
    const summary = await this.quota.reserve(
      userId,
      dto.sizeBytes,
      async (tx) => {
        await this.categories.assertAccessible(tx, userId, dto.categoryId);
        created = true;
        return tx.summary.create({
          data: {
            userId,
            title: dto.title,
            author: dto.author,
            summaryTitle: dto.summaryTitle || null,
            narrator: dto.narrator || null,
            description: dto.description || null,
            isbn13: dto.isbn13 || null,
            categoryId: dto.categoryId,
            folderId: dto.folderId ?? null,
            s3Key,
            originalFilename: dto.originalFilename,
            sizeBytes: dto.sizeBytes,
            contentType: dto.contentType,
            uploadRequestId: dto.uploadRequestId,
            requestedSha256: dto.requestedSha256,
            uploadIssuedAt: new Date(),
          },
        });
      },
      dto.uploadRequestId ? async (tx) => {
        const existing = await tx.summary.findUnique({
          where: { userId_uploadRequestId: { userId, uploadRequestId: dto.uploadRequestId! } },
        });
        if (!existing) return null;
        if (existing.cancelRequestedAt) throw new ConflictException('Esta carga fue cancelada');
        if (existing.purgeClaimedAt) throw new ConflictException('Esta carga está siendo eliminada');
        if (existing.deletedAt || existing.title !== dto.title || existing.author !== dto.author ||
          existing.categoryId !== dto.categoryId || existing.folderId !== (dto.folderId ?? null) ||
          existing.originalFilename !== dto.originalFilename || existing.contentType !== dto.contentType ||
          existing.sizeBytes !== dto.sizeBytes || existing.requestedSha256 !== (dto.requestedSha256 ?? null) ||
          existing.summaryTitle !== (dto.summaryTitle || null) ||
          existing.narrator !== (dto.narrator || null) || existing.description !== (dto.description || null)) {
          throw new ConflictException('El identificador de carga ya corresponde a otro resumen');
        }
        if (existing.status === SummaryStatus.PENDING) {
          const renewed = await tx.summary.updateMany({
            where: { id: existing.id, status: SummaryStatus.PENDING, cancelRequestedAt: null, purgeClaimedAt: null },
            data: { uploadIssuedAt: new Date() },
          });
          if (!renewed.count) throw new ConflictException('Esta carga ya no está disponible');
          return tx.summary.findUniqueOrThrow({ where: { id: existing.id } });
        }
        return existing;
      } : undefined,
    );
    if (created && dto.tags?.length) await this.tags.replaceForSummary(summary.id, userId, dto.tags);
    if (summary.status === SummaryStatus.READY) return { summary: await this.load(summary.id, userId), upload: null };
    const uploadUrl = await this.storage.createUploadUrl(summary.s3Key, dto.contentType, dto.sizeBytes, dto.requestedSha256);
    const headers: Record<string, string> = { 'Content-Type': dto.contentType };
    if (dto.requestedSha256) headers['x-amz-checksum-sha256'] = Buffer.from(dto.requestedSha256, 'hex').toString('base64');
    return { summary: await this.load(summary.id, userId), upload: { url: uploadUrl, headers } };
  }

  async duplicates(userId: string, query: DuplicateQueryDto) {
    const base: Prisma.SummaryWhereInput = {
      userId, cancelRequestedAt: null,
      ...(query.uploadRequestId ? {
        OR: [{ uploadRequestId: null }, { uploadRequestId: { not: query.uploadRequestId } }],
      } : {}),
    };
    const select = { id: true, title: true, author: true, audioSha256: true, deletedAt: true, status: true } as const;
    const [hashMatches, titleMatches, unchecked] = await Promise.all([
      query.sha256 ? this.prisma.summary.findMany({
        where: { ...base, AND: [{ OR: [
          { audioSha256: query.sha256, status: SummaryStatus.READY },
          { requestedSha256: query.sha256, status: SummaryStatus.PENDING },
        ] }] },
        select, orderBy: { status: 'desc' }, take: 51,
      }) : [],
      query.title && query.author ? this.prisma.summary.findMany({
        where: { ...base, title: query.title, author: query.author }, select, take: 51,
      }) : [],
      this.prisma.summary.count({ where: { userId, status: SummaryStatus.READY, audioSha256: null } }),
    ]);
    const unique = new Map([...hashMatches, ...titleMatches].map((row) => [row.id, row]));
    const rows = [...unique.values()];
    return {
      matches: rows.slice(0, 50).map((row) => ({
        id: row.id, title: row.title, author: row.author,
        exact: Boolean(query.sha256 && row.audioSha256 === query.sha256),
        inTrash: Boolean(row.deletedAt), pending: row.status === SummaryStatus.PENDING,
      })),
      unchecked, truncated: rows.length > 50,
    };
  }

  private async withDriveLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    if (this.driveInFlight.has(userId)) throw new ConflictException('Ya hay una operación de Google Drive en curso');
    this.driveInFlight.add(userId);
    try {
      return await operation();
    } finally {
      this.driveInFlight.delete(userId);
    }
  }

  inspectDrive(userId: string, dto: DriveFileDto) {
    return this.withDriveLock(userId, () => this.drive.inspect(dto.fileId, dto.accessToken, dto.resourceKey));
  }

  importDrive(id: string, userId: string, dto: DriveFileDto) {
    return this.withDriveLock(userId, () => this.copyDrive(id, userId, dto));
  }

  private async copyDrive(id: string, userId: string, dto: DriveFileDto) {
    const summary = await this.get(id, userId);
    if (summary.status === SummaryStatus.READY) return summary;
    if (summary.cancelRequestedAt || summary.purgeClaimedAt) throw new ConflictException('Esta carga no está disponible');
    if (!summary.requestedSha256) throw new BadRequestException('La importación requiere una huella verificada');
    const file = await this.drive.metadata(dto.fileId, dto.accessToken, dto.resourceKey);
    // La versión de Drive sube con cualquier roce (abrir, mover, miniaturas), así que no se compara; la
    // integridad real la garantiza la huella SHA-256 al copiar. Aquí solo se descartan cambios evidentes.
    if (file.size !== summary.sizeBytes || file.name !== summary.originalFilename) {
      throw new ConflictException('El archivo de Drive cambió. Selecciónalo y comprueba los duplicados de nuevo.');
    }
    const stream = await this.drive.stream(dto.fileId, dto.accessToken, file.size, dto.resourceKey);
    try {
      await this.storage.putAudioStream(summary.s3Key, stream, summary.contentType, file.size, summary.requestedSha256);
    } catch (error) {
      stream.destroy();
      this.logger.warn(`No se pudo copiar el audio desde Drive: ${error instanceof Error ? error.name : 'error desconocido'}`);
      throw new BadGatewayException('No se pudo copiar el archivo de Drive a S3 o su contenido cambió. Vuelve a seleccionarlo y comprueba los duplicados.');
    }
    return this.complete(id, userId);
  }

  async cancelPending(id: string, userId: string) {
    const updated = await this.prisma.summary.updateMany({
      where: { id, userId, status: SummaryStatus.PENDING, deletedAt: null, cancelRequestedAt: null },
      data: { cancelRequestedAt: new Date() },
    });
    if (updated.count) return;
    const row = await this.prisma.summary.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    if (row.cancelRequestedAt && row.status === SummaryStatus.PENDING) return;
    throw new ConflictException('El audio ya se completó y no se puede cancelar la carga');
  }

  async complete(id: string, userId: string) {
    const summary = await this.get(id, userId);
    if (summary.status === SummaryStatus.READY) return summary;
    if (summary.cancelRequestedAt) throw new ConflictException('Esta carga fue cancelada');
    if (summary.purgeClaimedAt) throw new ConflictException('Esta carga está siendo eliminada');

    let size: number | null;
    try {
      size = await this.storage.getObjectSize(summary.s3Key);
    } catch (error) {
      this.logger.error(`No se pudo consultar el audio ${summary.id}: ${error}`);
      throw new BadGatewayException('No se pudo leer el archivo; inténtalo de nuevo');
    }
    if (size === null) throw new BadRequestException('El archivo aún no existe en S3');
    if (size !== summary.sizeBytes) throw new BadRequestException('El tamaño del archivo subido no coincide');

    let info: AudioInfo;
    try {
      info = await this.storage.getAudioInfo(summary.s3Key, summary.contentType, size);
    } catch (error) {
      if (error instanceof InvalidAudioError) throw new BadRequestException('El archivo no es un audio MP3 o M4A válido');
      const detail = error instanceof AudioStorageError && error.originalError ? error.originalError : error;
      this.logger.error(`No se pudo leer el audio ${summary.id}: ${detail}`);
      throw new BadGatewayException('No se pudo leer el archivo; inténtalo de nuevo');
    }

    let audioSha256: string;
    try {
      audioSha256 = await hashAudio(this.storage, summary.s3Key);
    } catch (error) {
      this.logger.error(`No se pudo calcular la huella del audio ${summary.id}: ${error}`);
      throw new BadGatewayException('No se pudo verificar el archivo; inténtalo de nuevo');
    }
    if (summary.requestedSha256 && summary.requestedSha256 !== audioSha256) {
      throw new BadRequestException('El archivo subido no coincide con la huella de la carga');
    }
    const updated = await this.prisma.summary.updateMany({
      where: { id: summary.id, userId, status: SummaryStatus.PENDING, cancelRequestedAt: null, purgeClaimedAt: null },
      data: { status: SummaryStatus.READY, durationSeconds: info.durationSeconds, audioSha256 },
    });
    if (!updated.count) {
      const current = await this.get(id, userId);
      if (current.status === SummaryStatus.READY) return current;
      throw new ConflictException('Esta carga fue cancelada');
    }
    // La portada incrustada es un extra: si no se puede procesar, el audio queda listo igualmente.
    if (info.picture) {
      await this.storeCover({ id: summary.id, s3Key: summary.s3Key, coverKey: null }, info.picture).catch((error) =>
        this.logger.warn(`Portada incrustada ignorada en ${summary.id}: ${error}`),
      );
    }
    return this.load(summary.id, userId);
  }

  async update(id: string, userId: string, dto: UpdateSummaryDto) {
    await this.get(id, userId);
    if (dto.folderId) await this.folders.assertOwned(userId, dto.folderId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (dto.categoryId)
        await this.categories.assertAccessible(tx, userId, dto.categoryId);
      await tx.summary.update({
        where: { id },
        data: {
          title: dto.title,
          author: dto.author,
          summaryTitle: emptyToNull(dto.summaryTitle),
          narrator: emptyToNull(dto.narrator),
          description: emptyToNull(dto.description),
          isbn13: emptyToNull(dto.isbn13),
          categoryId: dto.categoryId,
          folderId: dto.folderId,
        },
      });
    });
    if (dto.tags !== undefined) await this.tags.replaceForSummary(id, userId, dto.tags);
    return this.load(id, userId);
  }

  /** Todo o nada: si algún id no es un audio vivo del usuario, no se mueve ninguno. */
  async moveMany(userId: string, { ids, folderId }: MoveSummariesDto) {
    if (folderId === undefined) throw new BadRequestException('Indica folderId (null para la raíz)');
    if (folderId) await this.folders.assertOwned(userId, folderId);
    const unique = [...new Set(ids)];
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.summary.count({ where: { id: { in: unique }, userId, deletedAt: null } });
      if (found !== unique.length) throw new NotFoundException('Algún audio no existe');
      const { count } = await tx.summary.updateMany({ where: { id: { in: unique }, userId }, data: { folderId } });
      return { moved: count };
    });
  }

  private async findForCover(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({
      where: { id, userId, deletedAt: null, status: SummaryStatus.READY },
      select: { id: true, s3Key: true, coverKey: true, contentType: true, sizeBytes: true },
    });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    return row;
  }

  /** Guarda la portada ya normalizada con una clave nueva y retira la anterior (si falla, queda un objeto huérfano inofensivo). */
  private async storeCover(row: { id: string; s3Key: string; coverKey: string | null }, image: Buffer) {
    const normalized = await normalizeCover(image);
    const key = newCoverKey(row.s3Key);
    await this.storage.putObject(key, normalized, 'image/jpeg');
    await this.prisma.summary.update({ where: { id: row.id }, data: { coverKey: key } });
    if (row.coverKey) await this.dropCoverObject(row.coverKey);
  }

  private async dropCoverObject(key: string) {
    try {
      await this.storage.deleteObject(key);
    } catch (error) {
      this.logger.warn(`No se pudo borrar la portada anterior ${key}: ${error}`);
    }
  }

  async setCover(id: string, userId: string, image: Buffer) {
    const row = await this.findForCover(id, userId);
    await this.storeCover(row, image);
    return this.load(id, userId);
  }

  /** Vuelve a leer el audio y usa su portada incrustada. */
  async coverFromAudio(id: string, userId: string) {
    const row = await this.findForCover(id, userId);
    let info: AudioInfo;
    try {
      info = await this.storage.getAudioInfo(row.s3Key, row.contentType, row.sizeBytes);
    } catch {
      throw new BadGatewayException('No se pudo leer el audio');
    }
    if (!info.picture) throw new BadRequestException('El audio no tiene portada incrustada');
    await this.storeCover(row, info.picture);
    return this.load(id, userId);
  }

  async removeCover(id: string, userId: string) {
    const row = await this.findForCover(id, userId);
    if (!row.coverKey) return;
    await this.prisma.summary.update({ where: { id }, data: { coverKey: null } });
    await this.dropCoverObject(row.coverKey);
  }

  async openCover(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({
      where: { id, deletedAt: null, AND: [await this.sharing.readableWhere(userId)] },
      select: { coverKey: true, userId: true, status: true },
    });
    if (!row?.coverKey || (row.userId !== userId && row.status !== SummaryStatus.READY)) {
      throw new NotFoundException('El resumen no tiene portada');
    }
    try {
      return await this.storage.getObjectStream(row.coverKey);
    } catch {
      throw new NotFoundException('El resumen no tiene portada');
    }
  }

  async setFavorite(id: string, userId: string, favorite: boolean) {
    await this.getReadable(id, userId);
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
    const summary = await this.getReadable(id, userId);
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
    // Avanzar la posición devuelve el audio a "continuar escuchando" si se había ocultado desde una app.
    const data = { positionSeconds, completed, ...(dto.positionSeconds !== undefined ? { hideFromContinue: false } : {}) };
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
    await this.getReadable(id, userId);
    await this.prisma.playbackProgress.deleteMany({ where: { userId, summaryId: id } });
  }

  /** Mueve un audio a la papelera: sigue en S3 y en la base, pero deja de verse y de reproducirse. */
  async trash(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({
      where: { id, userId, status: SummaryStatus.READY, deletedAt: null },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Resumen no encontrado');
    await this.prisma.summary.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string, userId: string) {
    const row = await this.findTrashed(id, userId);
    await this.prisma.summary.update({ where: { id: row.id }, data: { deletedAt: null } });
    return this.load(row.id, userId);
  }

  async listTrash(userId: string) {
    const rows = await this.prisma.summary.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        author: true,
        sizeBytes: true,
        durationSeconds: true,
        deletedAt: true,
        category: { select: { name: true } },
      },
    });
    return rows.map(({ deletedAt, category, ...rest }) => ({
      ...rest,
      category: category.name,
      deletedAt,
      purgeAt: new Date(deletedAt!.getTime() + TRASH_RETENTION_DAYS * DAY_MS),
    }));
  }

  /** Borrado definitivo: solo de audios que ya están en la papelera. */
  async deleteForever(id: string, userId: string) {
    const row = await this.findTrashed(id, userId);
    if (!(await this.purge.destroy(row))) {
      throw new BadGatewayException('No se pudo eliminar el archivo; inténtalo de nuevo más tarde');
    }
  }

  async emptyTrash(userId: string) {
    const rows = await this.prisma.summary.findMany({
      where: { userId, deletedAt: { not: null } },
      select: { id: true, s3Key: true, coverKey: true },
    });
    let deleted = 0;
    for (const row of rows) if (await this.purge.destroy(row)) deleted++;
    return { deleted, failed: rows.length - deleted };
  }

  private async findTrashed(id: string, userId: string) {
    const row = await this.prisma.summary.findFirst({
      where: { id, userId, deletedAt: { not: null } },
      select: { id: true, s3Key: true, coverKey: true },
    });
    if (!row) throw new NotFoundException('Resumen no encontrado en la papelera');
    return row;
  }

  async playback(id: string, userId: string) {
    const summary = await this.readableAudio(id, userId);
    if (summary.userId === userId) {
      await this.fillMissingDuration(summary);
      return { url: await this.storage.createPlaybackUrl(summary.s3Key) };
    }
    return { url: `/api/summaries/${id}/audio` };
  }

  async readableAudio(id: string, userId: string) {
    const summary = await this.prisma.summary.findFirst({
      where: { id, deletedAt: null, AND: [await this.sharing.readableWhere(userId)] },
      select: { id: true, userId: true, s3Key: true, contentType: true, sizeBytes: true, status: true, durationSeconds: true },
    });
    if (!summary) throw new NotFoundException('Resumen no encontrado');
    if (summary.status !== SummaryStatus.READY) {
      throw new BadRequestException('El audio aún no está disponible');
    }
    return summary;
  }

}
