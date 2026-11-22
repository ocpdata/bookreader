import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_COVER_BYTES } from '../covers/cover-image';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';
import {
  CreateSummaryDto,
  DuplicateQueryDto,
  DriveFileDto,
  DriveImportDto,
  ListSummariesQuery,
  MoveSummariesDto,
  SaveProgressDto,
  UpdateSummaryDto,
} from './summaries.dto';

@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query() query: ListSummariesQuery) {
    return this.summaries.list(userId, query);
  }

  /** Mueve varios audios a una carpeta (folderId null = raíz) en una sola operación. */
  @Post('move')
  @HttpCode(200)
  move(@CurrentUser() userId: string, @Body() dto: MoveSummariesDto) {
    return this.summaries.moveMany(userId, dto);
  }

  @Get('duplicates')
  duplicates(@CurrentUser() userId: string, @Query() query: DuplicateQueryDto) {
    return this.summaries.duplicates(userId, query);
  }

  @Post('drive/inspect')
  @HttpCode(200)
  inspectDrive(@CurrentUser() userId: string, @Body() dto: DriveFileDto) {
    return this.summaries.inspectDrive(userId, dto);
  }

  @Post(':id/drive-import')
  @HttpCode(200)
  importDrive(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DriveImportDto,
  ) {
    return this.summaries.importDrive(id, userId, dto);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.get(id, userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateSummaryDto) {
    return this.summaries.create(userId, dto);
  }

  /** Portada del audio (JPEG normalizado). La URL lleva ?v= con la versión, así que se puede cachear sin riesgo. */
  @Get(':id/cover')
  async cover(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.summaries.openCover(id, userId);
    res.set({ 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(stream, { type: 'image/jpeg' });
  }

  @Post(':id/cover')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_COVER_BYTES, files: 1 } }))
  setCover(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Adjunta la imagen en el campo "file"');
    return this.summaries.setCover(id, userId, file.buffer);
  }

  /** Usa la portada incrustada en el propio archivo de audio. */
  @Post(':id/cover/from-audio')
  @HttpCode(200)
  coverFromAudio(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.coverFromAudio(id, userId);
  }

  @Delete(':id/cover')
  @HttpCode(204)
  removeCover(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.removeCover(id, userId);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.summaries.complete(id, userId);
  }

  @Post(':id/cancel-upload')
  @HttpCode(204)
  async cancelUpload(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.summaries.cancelPending(id, userId);
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
