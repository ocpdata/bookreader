import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatisticsService } from '../statistics/statistics.service';
import { SummariesService } from '../summaries/summaries.service';
import { LIBRARY_ID } from './abs.constants';
import {
  ItemRow,
  authorIdOf,
  authorizePayload,
  bookmarkOf,
  itemInclude,
  itemOf,
  libraryOf,
  narratorIdOf,
  playSessionOf,
  progressOf,
  userOf,
} from './abs.mapper';
import { filterItems, sortItems, toInt } from './abs-query';
import { PlaySessionService } from './play-session.service';

const COMPLETE_RATIO = 0.95;
const MAX_POSITION_SECONDS = 7 * 24 * 3600;
const MAX_LOCAL_SESSIONS = 200;
const MAX_BOOKMARK_TITLE = 255;
const MAX_BOOKMARKS_PER_ITEM = 200;

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export interface ProgressUpdate {
  currentTime?: number;
  isFinished?: boolean;
  hideFromContinueListening?: boolean;
}

@Injectable()
export class AbsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummariesService,
    private readonly playSessions: PlaySessionService,
    private readonly statistics: StatisticsService,
  ) {}

  private readonly live = (userId: string) => ({ userId, status: SummaryStatus.READY, deletedAt: null });

  allItems(userId: string): Promise<ItemRow[]> {
    return this.prisma.summary.findMany({ where: this.live(userId), include: itemInclude(userId) });
  }

  /** Un audio ajeno o inexistente es un 404, igual que en el resto de la API. */
  async item(userId: string, id: string): Promise<ItemRow> {
    const row = await this.prisma.summary.findFirst({ where: { id, ...this.live(userId) }, include: itemInclude(userId) });
    if (!row) throw new NotFoundException('Elemento no encontrado');
    return row;
  }

  async progressList(userId: string) {
    const rows = await this.prisma.playbackProgress.findMany({
      where: { userId, summary: { status: SummaryStatus.READY, deletedAt: null } },
      include: { summary: { select: { id: true, durationSeconds: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((p) => progressOf(p.summary, p));
  }

  async userPayload(userId: string, token?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return userOf(user, await this.progressList(userId), token, await this.bookmarks(userId));
  }

  // ---- Marcadores -------------------------------------------------------------------------------------

  /** Marcadores del usuario (de un audio o de todos) en el formato de las apps; no incluye audios en la papelera. */
  async bookmarks(userId: string, itemId?: string) {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, ...(itemId ? { summaryId: itemId } : {}), summary: { status: SummaryStatus.READY, deletedAt: null } },
      orderBy: [{ summaryId: 'asc' }, { timeSeconds: 'asc' }],
    });
    return rows.map(bookmarkOf);
  }

  private readBookmark(body: Record<string, unknown>) {
    const time = num(body.time);
    if (time === undefined || time < 0 || time > MAX_POSITION_SECONDS) throw new BadRequestException('Tiempo del marcador no válido');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length > MAX_BOOKMARK_TITLE) throw new BadRequestException('El título del marcador es demasiado largo');
    // Milisegundos: la posición identifica el marcador y debe ser idéntica al editarlo o borrarlo.
    return { time: Math.round(time * 1000) / 1000, title: title || 'Marcador' };
  }

  async createBookmark(userId: string, itemId: string, body: Record<string, unknown>) {
    await this.item(userId, itemId);
    const { time, title } = this.readBookmark(body);
    if ((await this.prisma.bookmark.count({ where: { userId, summaryId: itemId } })) >= MAX_BOOKMARKS_PER_ITEM) {
      throw new BadRequestException('Este audio ya tiene el máximo de marcadores');
    }
    try {
      return bookmarkOf(await this.prisma.bookmark.create({ data: { userId, summaryId: itemId, timeSeconds: time, title } }));
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new BadRequestException('Ya existe un marcador en ese momento');
      throw error;
    }
  }

  async updateBookmark(userId: string, itemId: string, body: Record<string, unknown>) {
    await this.item(userId, itemId);
    const { time, title } = this.readBookmark(body);
    const where = { userId_summaryId_timeSeconds: { userId, summaryId: itemId, timeSeconds: time } };
    if (!(await this.prisma.bookmark.findUnique({ where }))) throw new NotFoundException('Marcador no encontrado');
    return bookmarkOf(await this.prisma.bookmark.update({ where, data: { title } }));
  }

  async deleteBookmark(userId: string, itemId: string, rawTime: string) {
    await this.item(userId, itemId);
    const time = Number(rawTime);
    if (!Number.isFinite(time)) throw new BadRequestException('Tiempo del marcador no válido');
    const { count } = await this.prisma.bookmark.deleteMany({
      where: { userId, summaryId: itemId, timeSeconds: Math.round(time * 1000) / 1000 },
    });
    if (!count) throw new NotFoundException('Marcador no encontrado');
  }

  async authorize(userId: string, token?: string) {
    return authorizePayload(await this.userPayload(userId, token));
  }

  // ---- Biblioteca -------------------------------------------------------------------------------------

  async libraryItems(userId: string, query: Record<string, unknown>) {
    const limit = toInt(query.limit, 0);
    const page = toInt(query.page, 0);
    const desc = query.desc === '1' || query.desc === 'true';
    const sort = str(query.sort) ?? 'addedAt';
    const filterBy = str(query.filter);
    const minified = query.minified !== '0';

    const sorted = sortItems(filterItems(await this.allItems(userId), filterBy), sort, desc);
    const slice = limit > 0 ? sorted.slice(page * limit, page * limit + limit) : sorted;
    return {
      results: slice.map((row) => itemOf(row, !minified)),
      total: sorted.length,
      limit,
      page,
      sortBy: sort,
      sortDesc: desc,
      filterBy: filterBy ?? '',
      mediaType: 'book',
      minified,
      collapseseries: false,
      include: str(query.include) ?? '',
    };
  }

  /** Estanterías de inicio: lo que se está escuchando, lo último agregado y lo ya terminado. */
  async personalized(userId: string, limit: number) {
    const rows = await this.allItems(userId);
    const byRecent = (a: ItemRow, b: ItemRow) => (b.progress[0]?.updatedAt.getTime() ?? 0) - (a.progress[0]?.updatedAt.getTime() ?? 0);
    const continueListening = rows
      .filter((r) => r.progress[0] && !r.progress[0].completed && r.progress[0].positionSeconds > 0 && !r.progress[0].hideFromContinue)
      .sort(byRecent);
    const recent = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const listenAgain = rows.filter((r) => r.progress[0]?.completed).sort(byRecent);

    const shelf = (id: string, label: string, key: string, list: ItemRow[]) => ({
      id,
      label,
      labelStringKey: key,
      type: 'book',
      entities: list.slice(0, limit).map((r) => itemOf(r)),
      total: list.length,
    });
    return [
      shelf('continue-listening', 'Continuar escuchando', 'LabelContinueListening', continueListening),
      shelf('recently-added', 'Agregados recientemente', 'LabelRecentlyAdded', recent),
      shelf('listen-again', 'Escuchar de nuevo', 'LabelListenAgain', listenAgain),
    ].filter((s) => s.total > 0);
  }

  async itemsInProgress(userId: string) {
    const rows = (await this.allItems(userId))
      .filter((r) => r.progress[0] && !r.progress[0].completed && r.progress[0].positionSeconds > 0 && !r.progress[0].hideFromContinue)
      .sort((a, b) => b.progress[0].updatedAt.getTime() - a.progress[0].updatedAt.getTime());
    return rows.map((r) => ({ ...itemOf(r), progressLastUpdate: r.progress[0].updatedAt.getTime() }));
  }

  async batchGet(userId: string, ids: string[]) {
    const rows = await this.prisma.summary.findMany({
      where: { id: { in: ids.slice(0, 200) }, ...this.live(userId) },
      include: itemInclude(userId),
    });
    return rows.map((r) => itemOf(r, true));
  }

  private groupCounts(values: (string | null | undefined)[]) {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }

  async filterData(userId: string) {
    const rows = await this.allItems(userId);
    return {
      authors: this.authorsOf(rows).map((a) => ({ id: a.id, name: a.name })),
      genres: this.groupCounts(rows.map((r) => r.category.name)).map(([name]) => name),
      tags: this.groupCounts(rows.flatMap((r) => r.tags.map((t) => t.tag.name))).map(([name]) => name),
      series: [],
      narrators: this.groupCounts(rows.map((r) => r.narrator)).map(([name]) => name),
      languages: [],
      publishers: [],
      publishedDecades: [],
    };
  }

  private authorsOf(rows: ItemRow[]) {
    const authors = new Map<string, { id: string; name: string; numBooks: number; addedAt: number; updatedAt: number }>();
    for (const r of rows) {
      const id = authorIdOf(r.author);
      const current = authors.get(id);
      authors.set(id, {
        id,
        name: current?.name ?? r.author,
        numBooks: (current?.numBooks ?? 0) + 1,
        addedAt: Math.min(current?.addedAt ?? Infinity, r.createdAt.getTime()),
        updatedAt: Math.max(current?.updatedAt ?? 0, r.updatedAt.getTime()),
      });
    }
    return [...authors.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async authors(userId: string) {
    const authors = this.authorsOf(await this.allItems(userId)).map((a) => ({
      ...a,
      lastFirst: a.name,
      description: null,
      imagePath: null,
    }));
    return { authors, results: authors, total: authors.length, limit: 0, page: 0 };
  }

  async author(userId: string, id: string) {
    const rows = (await this.allItems(userId)).filter((r) => authorIdOf(r.author) === id);
    if (!rows.length) throw new NotFoundException('Autor no encontrado');
    const [author] = this.authorsOf(rows);
    return {
      id: author.id,
      asin: null,
      name: author.name,
      description: null,
      imagePath: null,
      libraryId: LIBRARY_ID,
      addedAt: author.addedAt,
      updatedAt: author.updatedAt,
      numBooks: rows.length,
      series: [],
      libraryItems: rows.map((r) => itemOf(r)),
    };
  }

  /** Las carpetas con audios, como colecciones de solo lectura (nombre = ruta completa; solo sus audios directos). */
  async collections(userId: string) {
    const [folders, rows] = await Promise.all([this.prisma.folder.findMany({ where: { userId } }), this.allItems(userId)]);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (id: string): string => {
      const folder = byId.get(id)!;
      return folder.parentId && byId.has(folder.parentId) ? `${pathOf(folder.parentId)} › ${folder.name}` : folder.name;
    };
    const items = new Map<string, ItemRow[]>();
    for (const row of rows) if (row.folderId) items.set(row.folderId, [...(items.get(row.folderId) ?? []), row]);
    return folders
      .filter((f) => items.has(f.id))
      .map((f) => ({
        id: f.id,
        name: pathOf(f.id),
        libraryId: LIBRARY_ID,
        description: null,
        books: items.get(f.id)!.map((r) => itemOf(r)),
        lastUpdate: Math.max(f.updatedAt.getTime(), ...items.get(f.id)!.map((r) => r.updatedAt.getTime())),
        createdAt: f.createdAt.getTime(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async collection(userId: string, id: string) {
    const found = (await this.collections(userId)).find((c) => c.id === id);
    if (!found) throw new NotFoundException('Colección no encontrada');
    return found;
  }

  async narrators(userId: string) {
    const rows = await this.allItems(userId);
    return {
      narrators: this.groupCounts(rows.map((r) => r.narrator)).map(([name, numBooks]) => ({ id: narratorIdOf(name), name, numBooks })),
    };
  }

  async search(userId: string, q: string, limit: number) {
    const needle = q.trim().toLocaleLowerCase('es');
    const rows = await this.allItems(userId);
    const includes = (value: string | null | undefined) => !!value && value.toLocaleLowerCase('es').includes(needle);
    const books = needle
      ? rows.filter((r) => includes(r.title) || includes(r.author) || includes(r.summaryTitle) || r.tags.some((t) => includes(t.tag.name)))
      : [];
    const matchOf = (r: ItemRow) =>
      includes(r.title) ? ['title', r.title] : includes(r.author) ? ['authors', r.author] : includes(r.summaryTitle) ? ['title', r.summaryTitle!] : ['tags', r.tags.find((t) => includes(t.tag.name))!.tag.name];
    return {
      book: books.slice(0, limit).map((r) => ({ libraryItem: itemOf(r), matchKey: matchOf(r)[0], matchText: matchOf(r)[1] })),
      podcast: [],
      narrators: needle
        ? this.groupCounts(rows.map((r) => r.narrator)).filter(([name]) => includes(name)).map(([name, numBooks]) => ({ name, numBooks }))
        : [],
      tags: needle
        ? this.groupCounts(rows.flatMap((r) => r.tags.map((t) => t.tag.name))).filter(([name]) => includes(name)).map(([name, numItems]) => ({ name, numItems }))
        : [],
      genres: needle
        ? this.groupCounts(rows.map((r) => r.category.name)).filter(([name]) => includes(name)).map(([name, numItems]) => ({ name, numItems }))
        : [],
      series: [],
      authors: needle
        ? this.authorsOf(rows).filter((a) => includes(a.name)).map((a) => ({ id: a.id, name: a.name, numBooks: a.numBooks, imagePath: null }))
        : [],
    };
  }

  // ---- Reproducción y progreso ------------------------------------------------------------------------

  async play(userId: string, itemId: string, body: Record<string, unknown>, ip: string) {
    const row = await this.item(userId, itemId);
    const progress = row.progress[0];
    const duration = row.durationSeconds ?? 0;
    // Igual que la web: un audio terminado vuelve a empezar desde el principio.
    const startTime = progress && !progress.completed ? Math.min(progress.positionSeconds, duration || progress.positionSeconds) : 0;

    const device = obj(body.deviceInfo);
    const deviceName = [str(device.clientName), str(device.model)].filter(Boolean).join(' · ') || 'Dispositivo';
    const session = await this.playSessions.create(userId, itemId, deviceName, startTime);
    return playSessionOf(row, session, startTime, { ...device, ipAddress: ip }, str(body.mediaPlayer) ?? 'unknown');
  }

  /**
   * Guarda el progreso que informa una app. Un `isFinished: false` que llega con la posición ya al final
   * no anula el estado "terminado" (las apps lo envían en cada actualización).
   */
  async updateProgress(userId: string, itemId: string, update: ProgressUpdate) {
    const row = await this.item(userId, itemId);
    const duration = row.durationSeconds ?? 0;
    const clamp = (seconds: number) => Math.min(MAX_POSITION_SECONDS, Math.max(0, Math.round(seconds)));

    let completed: boolean | undefined;
    if (update.isFinished === true) completed = true;
    else if (update.isFinished === false) {
      const atEnd = update.currentTime !== undefined && duration > 0 && update.currentTime >= duration * COMPLETE_RATIO;
      if (!atEnd) completed = false;
    }
    const position =
      update.currentTime !== undefined ? clamp(update.currentTime) : update.isFinished === true && duration > 0 ? duration : undefined;

    if (position !== undefined || completed !== undefined) {
      await this.summaries.saveProgress(itemId, userId, { positionSeconds: position, completed });
    }
    if (update.hideFromContinueListening !== undefined) {
      await this.prisma.playbackProgress.updateMany({
        where: { userId, summaryId: itemId },
        data: { hideFromContinue: update.hideFromContinueListening },
      });
    }
  }

  async getProgress(userId: string, itemId: string) {
    const row = await this.item(userId, itemId);
    if (!row.progress[0]) throw new NotFoundException('Sin progreso');
    return progressOf(row, row.progress[0]);
  }

  async removeProgress(userId: string, itemId: string) {
    await this.item(userId, itemId);
    await this.summaries.resetProgress(itemId, userId);
  }

  async syncSession(userId: string, sessionId: string, body: Record<string, unknown>) {
    const session = await this.playSessions.findOwned(sessionId, userId);
    if (!session) throw new NotFoundException('Sesión no encontrada');
    const currentTime = num(body.currentTime);
    if (currentTime !== undefined) await this.updateProgress(userId, session.summaryId, { currentTime });
    const timeListened = num(body.timeListened);
    if (timeListened) await this.statistics.recordAppChunk(userId, session.summaryId, timeListened);
    await this.playSessions.touch(sessionId);
    return { id: session.id, libraryItemId: session.summaryId, currentTime: currentTime ?? session.startTime };
  }

  /** Sesión grabada sin conexión: se aplica solo si es más reciente que lo guardado (gana la última escucha). */
  async syncLocalSession(userId: string, session: unknown) {
    const s = obj(session);
    const id = str(s.id) ?? '';
    const itemId = str(s.libraryItemId);
    const currentTime = num(s.currentTime);
    if (!itemId || currentTime === undefined) return { id, success: false, error: 'Sesión no válida' };

    const row = await this.prisma.summary.findFirst({ where: { id: itemId, ...this.live(userId) }, include: itemInclude(userId) });
    if (!row) return { id, success: false, error: 'Elemento no encontrado' };
    // El tiempo escuchado se registra aunque el progreso ya esté al día: un reenvío no lo duplica.
    const timeListening = num(s.timeListening);
    if (timeListening) await this.statistics.recordAppSession(userId, itemId, id, timeListening, num(s.updatedAt));
    const existing = row.progress[0];
    const reportedAt = num(s.updatedAt) ?? Date.now();
    if (existing && existing.updatedAt.getTime() >= reportedAt) return { id, success: true, progressSynced: false };
    await this.updateProgress(userId, itemId, { currentTime });
    return { id, success: true, progressSynced: true };
  }

  async syncLocalSessions(userId: string, body: Record<string, unknown>) {
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    if (sessions.length > MAX_LOCAL_SESSIONS) throw new BadRequestException('Demasiadas sesiones en una sola petición');
    const results = [];
    for (const session of sessions) results.push(await this.syncLocalSession(userId, session));
    return { results };
  }

  /** Progreso local de las apps (formato de /api/me/sync-local-progress). */
  async syncLocalProgress(userId: string, body: Record<string, unknown>) {
    const list = Array.isArray(body.localMediaProgress) ? body.localMediaProgress : [];
    if (list.length > MAX_LOCAL_SESSIONS) throw new BadRequestException('Demasiados elementos en una sola petición');
    let updated = 0;
    for (const entry of list) {
      const p = obj(entry);
      const itemId = str(p.libraryItemId);
      if (!itemId) continue;
      const row = await this.prisma.summary.findFirst({ where: { id: itemId, ...this.live(userId) }, include: itemInclude(userId) });
      if (!row) continue;
      const existing = row.progress[0];
      if (existing && existing.updatedAt.getTime() >= (num(p.lastUpdate) ?? Date.now())) continue;
      await this.updateProgress(userId, itemId, { currentTime: num(p.currentTime), isFinished: bool(p.isFinished) });
      updated++;
    }
    return { numServerProgressUpdates: updated, localProgressUpdates: [] };
  }

  libraryFor(id: string) {
    if (id !== LIBRARY_ID) throw new NotFoundException('Biblioteca no encontrada');
    return libraryOf();
  }
}
