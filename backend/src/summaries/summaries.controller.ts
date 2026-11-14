import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';
import { CreateSummaryDto, ListSummariesQuery, UpdateSummaryDto } from './summaries.dto';

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
}
