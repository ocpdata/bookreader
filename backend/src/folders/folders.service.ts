import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFolderDto, MAX_FOLDER_NAME, UpdateFolderDto } from './folders.dto';

/** Niveles de anidación permitidos (una carpeta en la raíz es el nivel 1). */
export const MAX_FOLDER_DEPTH = 5;
export const MAX_FOLDERS_PER_USER = 200;

type Tx = Prisma.TransactionClient;
interface FolderRow {
  id: string;
  parentId: string | null;
  name: string;
}

const DUPLICATE = 'Ya existe una carpeta con ese nombre en esa ubicación';

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Las escrituras de carpetas de un usuario se serializan con un bloqueo sobre su fila: así las
   * comprobaciones de nombre único, ciclos, profundidad y tope no compiten entre peticiones.
   */
  private async locked<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      return work(tx);
    });
  }

  private loadAll(db: Tx | PrismaService, userId: string): Promise<FolderRow[]> {
    return db.folder.findMany({ where: { userId }, select: { id: true, parentId: true, name: true } });
  }

  /** Carpetas del usuario con su número de audios directos; el cliente arma el árbol. */
  async list(userId: string) {
    const [folders, counts] = await Promise.all([
      this.loadAll(this.prisma, userId),
      this.prisma.summary.groupBy({
        by: ['folderId'],
        where: { userId, status: SummaryStatus.READY, deletedAt: null, folderId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const byFolder = new Map(counts.map((c) => [c.folderId, c._count._all]));
    return folders
      .map((f) => ({ ...f, count: byFolder.get(f.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /** Una carpeta ajena se trata como inexistente (404). */
  async assertOwned(userId: string, folderId: string) {
    const exists = await this.prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Carpeta no encontrada');
  }

  /** La carpeta y todas sus descendientes. */
  async withDescendantIds(userId: string, folderId: string): Promise<string[]> {
    const all = await this.loadAll(this.prisma, userId);
    if (!all.some((f) => f.id === folderId)) throw new NotFoundException('Carpeta no encontrada');
    return subtreeIds(all, folderId);
  }

  async create(userId: string, dto: CreateFolderDto) {
    const parentId = dto.parentId ?? null;
    return this.locked(userId, async (tx) => {
      const all = await this.loadAll(tx, userId);
      if (all.length >= MAX_FOLDERS_PER_USER) {
        throw new BadRequestException(`Alcanzaste el máximo de ${MAX_FOLDERS_PER_USER} carpetas`);
      }
      if (parentId !== null) {
        if (!all.some((f) => f.id === parentId)) throw new NotFoundException('Carpeta no encontrada');
        if (depthOf(all, parentId) + 1 > MAX_FOLDER_DEPTH) {
          throw new BadRequestException(`Las carpetas admiten como máximo ${MAX_FOLDER_DEPTH} niveles`);
        }
      }
      await this.assertNameFree(tx, userId, parentId, dto.name);
      return tx.folder.create({
        data: { userId, parentId, name: dto.name },
        select: { id: true, parentId: true, name: true },
      });
    });
  }

  async update(id: string, userId: string, dto: UpdateFolderDto) {
    return this.locked(userId, async (tx) => {
      const all = await this.loadAll(tx, userId);
      const folder = all.find((f) => f.id === id);
      if (!folder) throw new NotFoundException('Carpeta no encontrada');

      const parentId = dto.parentId === undefined ? folder.parentId : dto.parentId;
      const name = dto.name ?? folder.name;
      if (parentId !== folder.parentId) {
        if (parentId !== null) {
          if (!all.some((f) => f.id === parentId)) throw new NotFoundException('Carpeta no encontrada');
          if (subtreeIds(all, id).includes(parentId)) {
            throw new BadRequestException('No puedes mover una carpeta dentro de sí misma ni de sus subcarpetas');
          }
        }
        const depth = (parentId === null ? 0 : depthOf(all, parentId)) + heightOf(all, id);
        if (depth > MAX_FOLDER_DEPTH) {
          throw new BadRequestException(`Las carpetas admiten como máximo ${MAX_FOLDER_DEPTH} niveles`);
        }
      }
      if (parentId !== folder.parentId || name !== folder.name) {
        await this.assertNameFree(tx, userId, parentId, name, id);
      }
      return tx.folder.update({ where: { id }, data: { parentId, name }, select: { id: true, parentId: true, name: true } });
    });
  }

  /**
   * Borra la carpeta sin destruir nada: sus audios (también los de la papelera) y subcarpetas
   * suben a la carpeta padre. Una subcarpeta cuyo nombre ya existe arriba se renombra "X (2)".
   */
  async remove(id: string, userId: string) {
    return this.locked(userId, async (tx) => {
      const all = await this.loadAll(tx, userId);
      const folder = all.find((f) => f.id === id);
      if (!folder) throw new NotFoundException('Carpeta no encontrada');

      const children = all.filter((f) => f.parentId === id);
      for (const child of children) {
        const name = await this.freeName(tx, userId, folder.parentId, child.name);
        await tx.folder.update({ where: { id: child.id }, data: { parentId: folder.parentId, name } });
      }
      const moved = await tx.summary.updateMany({ where: { userId, folderId: id }, data: { folderId: folder.parentId } });
      await tx.folder.delete({ where: { id } });
      return { movedFolders: children.length, movedAudios: moved.count };
    });
  }

  private async nameTaken(tx: Tx, userId: string, parentId: string | null, name: string, exceptId?: string) {
    // La comparación la hace MySQL con su colación: ignora mayúsculas y acentos.
    const clash = await tx.folder.findFirst({
      where: { userId, parentId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    return clash !== null;
  }

  private async assertNameFree(tx: Tx, userId: string, parentId: string | null, name: string, exceptId?: string) {
    if (await this.nameTaken(tx, userId, parentId, name, exceptId)) throw new ConflictException(DUPLICATE);
  }

  private async freeName(tx: Tx, userId: string, parentId: string | null, name: string) {
    if (!(await this.nameTaken(tx, userId, parentId, name))) return name;
    for (let n = 2; ; n++) {
      const suffix = ` (${n})`;
      const candidate = name.slice(0, MAX_FOLDER_NAME - suffix.length) + suffix;
      if (!(await this.nameTaken(tx, userId, parentId, candidate))) return candidate;
    }
  }
}

function childrenOf(all: FolderRow[], id: string) {
  return all.filter((f) => f.parentId === id);
}

function subtreeIds(all: FolderRow[], id: string): string[] {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) ids.push(...childrenOf(all, ids[i]).map((f) => f.id));
  return ids;
}

/** Nivel de una carpeta: 1 si está en la raíz. */
function depthOf(all: FolderRow[], id: string): number {
  let depth = 0;
  for (let cur: FolderRow | undefined = all.find((f) => f.id === id); cur; depth++) {
    cur = cur.parentId ? all.find((f) => f.id === cur!.parentId) : undefined;
  }
  return depth;
}

/** Niveles que ocupa la carpeta con sus descendientes (1 si no tiene subcarpetas). */
function heightOf(all: FolderRow[], id: string): number {
  return 1 + Math.max(0, ...childrenOf(all, id).map((c) => heightOf(all, c.id)));
}
