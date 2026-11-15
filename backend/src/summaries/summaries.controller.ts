import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';
import { CreateSummaryDto, ListSummariesQuery, SaveProgressDto, UpdateSummaryDto } from './summaries.dto';

@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query() query: ListSummariesQuery) {
    return this.summaries.list(userId, query);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.get(id, userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateSummaryDto) {
    return this.summaries.create(userId, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.complete(id, userId);
  }

  /** Mueve a la papelera (recuperable). El borrado definitivo está en /trash. */
  @Delete(':id')
  @HttpCode(204)
  async trash(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.summaries.trash(id, userId);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.restore(id, userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSummaryDto,
  ) {
    return this.summaries.update(id, userId, dto);
  }

  @Post(':id/playback')
  @HttpCode(200)
  playback(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.playback(id, userId);
  }

  @Put(':id/progress')
  saveProgress(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveProgressDto,
  ) {
    return this.summaries.saveProgress(id, userId, dto);
  }

  @Delete(':id/progress')
  @HttpCode(204)
  resetProgress(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.resetProgress(id, userId);
  }

  @Put(':id/favorite')
  setFavorite(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.setFavorite(id, userId, true);
  }

  @Delete(':id/favorite')
  @HttpCode(204)
  async removeFavorite(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.summaries.setFavorite(id, userId, false);
  }
}
