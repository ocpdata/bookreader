import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AbsService, ProgressUpdate } from './abs.service';
import { toInt } from './abs-query';

const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function readUpdate(body: Record<string, unknown> | undefined): ProgressUpdate {
  const b = body ?? {};
  const duration = finite(b.duration);
  // Algunas apps solo envían "progress" (0–1) junto con la duración.
  const fromRatio = finite(b.progress) !== undefined && duration ? Math.round(finite(b.progress)! * duration) : undefined;
  return {
    currentTime: finite(b.currentTime) ?? fromRatio,
    isFinished: typeof b.isFinished === 'boolean' ? b.isFinished : undefined,
    hideFromContinueListening: typeof b.hideFromContinueListening === 'boolean' ? b.hideFromContinueListening : undefined,
  };
}

/** Progreso de escucha y estadísticas del usuario, en la forma de /api/me de Audiobookshelf. */
@AllowApiToken()
@Controller('me')
export class AbsProgressController {
  constructor(private readonly abs: AbsService) {}

  @Get('progress')
  async allProgress(@CurrentUser() userId: string) {
    return { mediaProgress: await this.abs.progressList(userId) };
  }

  @Patch('progress/batch/update')
  @HttpCode(200)
  async batchUpdate(@CurrentUser() userId: string, @Body() body: unknown) {
    if (!Array.isArray(body) || body.length > 200) throw new BadRequestException('Lista de progreso no válida');
    for (const entry of body) {
      const itemId = entry?.libraryItemId;
      if (typeof itemId !== 'string') continue;
      await this.abs.updateProgress(userId, itemId, readUpdate(entry));
    }
    return {};
  }

  @Get('progress/:id')
  progress(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.abs.getProgress(userId, id);
  }

  @Patch('progress/:id')
  @HttpCode(200)
  async updateProgress(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.abs.updateProgress(userId, id, readUpdate(body));
    return {};
  }

  @Delete('progress/:id')
  @HttpCode(200)
  async removeProgress(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.abs.removeProgress(userId, id);
    return {};
  }

  @Get('progress/:id/remove-from-continue-listening')
  async hide(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.abs.updateProgress(userId, id, { hideFromContinueListening: true });
    return {};
  }

  @Get('items-in-progress')
  async itemsInProgress(@CurrentUser() userId: string) {
    return { libraryItems: await this.abs.itemsInProgress(userId) };
  }

  @Post('sync-local-progress')
  @HttpCode(200)
  syncLocalProgress(@CurrentUser() userId: string, @Body() body: Record<string, unknown>) {
    return this.abs.syncLocalProgress(userId, body ?? {});
  }

  // Historial y estadísticas: no se registran todavía; se responden vacíos para no romper las pantallas.
  @Get('listening-sessions')
  listeningSessions(@Query() query: Record<string, unknown>) {
    return { total: 0, numPages: 0, page: toInt(query.page, 0), itemsPerPage: toInt(query.itemsPerPage, 10), sessions: [] };
  }

  @Get('item/listening-sessions/:id')
  itemListeningSessions(@Query() query: Record<string, unknown>) {
    return { total: 0, numPages: 0, page: toInt(query.page, 0), itemsPerPage: toInt(query.itemsPerPage, 10), sessions: [] };
  }

  @Get('listening-stats')
  listeningStats() {
    return { totalTime: 0, items: {}, days: {}, dayOfWeek: {}, today: 0, recentSessions: [] };
  }

  @Get('stats/year/:year')
  yearStats() {
    return { totalListeningSessions: 0, totalListeningTime: 0, totalBookListeningTime: 0, totalPodcastListeningTime: 0, topAuthors: [], topGenres: [], topNarrators: [], mostListenedMonth: null, numBooksFinished: 0, numBooksListened: 0, longestAudiobookFinished: null, booksWithCovers: [], finishedBooksWithCovers: [] };
  }

  @Get('bookmarks')
  async bookmarks(@CurrentUser() userId: string) {
    return { bookmarks: await this.abs.bookmarks(userId) };
  }

  @Get('bookmarks/:id')
  async itemBookmarks(@CurrentUser() userId: string, @Param('id') id: string) {
    return { bookmarks: await this.abs.bookmarks(userId, id) };
  }

  @Post('item/:id/bookmark')
  @HttpCode(200)
  createBookmark(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.abs.createBookmark(userId, id, body ?? {});
  }

  @Patch('item/:id/bookmark')
  @HttpCode(200)
  updateBookmark(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.abs.updateBookmark(userId, id, body ?? {});
  }

  @Delete('item/:id/bookmark/:time')
  @HttpCode(200)
  async deleteBookmark(@CurrentUser() userId: string, @Param('id') id: string, @Param('time') time: string) {
    await this.abs.deleteBookmark(userId, id, time);
    return {};
  }
}
