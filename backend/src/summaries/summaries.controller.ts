import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SummariesService } from './summaries.service';
import { CreateSummaryDto, ListSummariesQuery, UpdateSummaryDto } from './summaries.dto';

@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  list(@Query() query: ListSummariesQuery) {
    return this.summaries.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.get(id);
  }

  @Post()
  create(@Body() dto: CreateSummaryDto) {
    return this.summaries.create(dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.complete(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSummaryDto) {
    return this.summaries.update(id, dto);
  }

  @Post(':id/playback')
  @HttpCode(200)
  playback(@Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.playback(id);
  }
}
