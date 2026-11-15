import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from '../summaries/summaries.service';
import { LIBRARY_ID } from './abs.constants';
import { AbsService } from './abs.service';
import { itemOf } from './abs.mapper';
import { toInt } from './abs-query';

const emptyPage = (query: Record<string, unknown>) => ({
  results: [],
  total: 0,
  limit: toInt(query.limit, 0),
  page: toInt(query.page, 0),
  sortBy: typeof query.sort === 'string' ? query.sort : '',
  sortDesc: query.desc === '1',
  filterBy: typeof query.filter === 'string' ? query.filter : '',
  mediaType: 'book',
  minified: query.minified !== '0',
  include: '',
});

/** Biblioteca de solo lectura para las apps: una biblioteca ("Resúmenes") con todos los audios del usuario. */
@AllowApiToken()
@Controller()
export class AbsLibraryController {
  constructor(
    private readonly abs: AbsService,
    private readonly summaries: SummariesService,
  ) {}

  @Get('libraries')
  libraries() {
    return { libraries: [this.abs.libraryFor(LIBRARY_ID)] };
  }

  @Get('libraries/:id')
  async library(@CurrentUser() userId: string, @Param('id') id: string, @Query() query: Record<string, string>) {
    const library = this.abs.libraryFor(id);
    const include = (query.include ?? '').split(',');
    return include.includes('filterdata') ? { ...library, filterdata: await this.abs.filterData(userId) } : library;
  }

  @Get('libraries/:id/items')
  items(@CurrentUser() userId: string, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    this.abs.libraryFor(id);
    return this.abs.libraryItems(userId, query);
  }

  @Get('libraries/:id/personalized')
  personalized(@CurrentUser() userId: string, @Param('id') id: string, @Query('limit') limit?: string) {
    this.abs.libraryFor(id);
    return this.abs.personalized(userId, toInt(limit, 10) || 10);
  }

  @Get('libraries/:id/search')
  search(@CurrentUser() userId: string, @Param('id') id: string, @Query('q') q = '', @Query('limit') limit?: string) {
    this.abs.libraryFor(id);
    return this.abs.search(userId, q, toInt(limit, 12) || 12);
  }

  @Get('libraries/:id/authors')
  authors(@CurrentUser() userId: string, @Param('id') id: string) {
    this.abs.libraryFor(id);
    return this.abs.authors(userId);
  }

  @Get('libraries/:id/narrators')
  narrators(@CurrentUser() userId: string, @Param('id') id: string) {
    this.abs.libraryFor(id);
    return this.abs.narrators(userId);
  }

  // Series, colecciones y listas no existen en BookReader: se responden vacías con la forma esperada.
  @Get('libraries/:id/series')
  series(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    this.abs.libraryFor(id);
    return emptyPage(query);
  }

  @Get('libraries/:id/collections')
  collections(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    this.abs.libraryFor(id);
    return emptyPage(query);
  }

  @Get('libraries/:id/playlists')
  playlists(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    this.abs.libraryFor(id);
    return emptyPage(query);
  }

  @Get('libraries/:id/recent-episodes')
  recentEpisodes(@Param('id') id: string) {
    this.abs.libraryFor(id);
    return { episodes: [], page: 0, limit: 0 };
  }

  @Get('collections')
  allCollections() {
    return { collections: [] };
  }

  @Get('playlists')
  allPlaylists() {
    return { playlists: [] };
  }

  @Get('authors/:id')
  author(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.abs.author(userId, id);
  }

  @Post('items/batch/get')
  @HttpCode(200)
  async batchGet(@CurrentUser() userId: string, @Body() body: Record<string, unknown>) {
    const ids = Array.isArray(body?.libraryItemIds) ? body.libraryItemIds.filter((v): v is string => typeof v === 'string') : [];
    return { libraryItems: await this.abs.batchGet(userId, ids) };
  }

  @Get('items/:id')
  async item(@CurrentUser() userId: string, @Param('id') id: string, @Query() query: Record<string, string>) {
    const row = await this.abs.item(userId, id);
    const item = itemOf(row, query.expanded === '1');
    const progress = row.progress[0];
    if (progress && (query.include ?? '').split(',').includes('progress')) {
      const [mine] = (await this.abs.progressList(userId)).filter((p) => p.libraryItemId === id);
      return { ...item, userMediaProgress: mine };
    }
    return item;
  }

  /** Portada del audio; sin portada responde 404 y las apps muestran su marcador. */
  @Get('items/:id/cover')
  async cover(@CurrentUser() userId: string, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const stream = await this.summaries.openCover(id, userId).catch(() => {
      throw new NotFoundException('Sin portada');
    });
    res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(stream, { type: 'image/jpeg' });
  }

  @Post('items/:id/play')
  @HttpCode(200)
  play(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.abs.play(userId, id, body ?? {}, req.ip ?? '');
  }
}
