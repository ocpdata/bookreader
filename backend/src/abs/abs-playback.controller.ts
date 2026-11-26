import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { StorageService } from '../storage/storage.service';
import { serveAudio } from '../storage/serve-audio';
import { inoOf } from './abs.mapper';
import { AbsService } from './abs.service';
import { PlaySessionService } from './play-session.service';

@AllowApiToken()
@Controller()
export class AbsPlaybackController {
  constructor(
    private readonly abs: AbsService,
    private readonly sessions: PlaySessionService,
    private readonly storage: StorageService,
  ) {}

  @Post('session/local-all')
  @HttpCode(200)
  syncLocalAll(@CurrentUser() userId: string, @Body() body: Record<string, unknown>) {
    return this.abs.syncLocalSessions(userId, body ?? {});
  }

  @Post('session/local')
  @HttpCode(200)
  syncLocal(@CurrentUser() userId: string, @Body() body: Record<string, unknown>) {
    return this.abs.syncLocalSession(userId, body);
  }

  @Post('session/:id/sync')
  @HttpCode(200)
  sync(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.abs.syncSession(userId, id, body ?? {});
  }

  /** Cerrar guarda la última posición pero no invalida la URL: un reproductor pausado puede seguir pidiendo rangos. */
  @Post('session/:id/close')
  @HttpCode(200)
  async close(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    await this.abs.syncSession(userId, id, body ?? {});
    return {};
  }

  /**
   * Audio de una sesión de reproducción, sin cabeceras de autorización. Se sirve desde S3 con soporte de
   * Range y comprobación actual de permisos (los reproductores buscan y retoman por rangos).
   */
  @Public()
  @Get('public/session/:sessionId/track/:index')
  async track(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('index') index: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const audio = index === '1' ? await this.sessions.findForStreaming(sessionId) : null;
    if (!audio) throw new NotFoundException('Sesión no encontrada');

    return serveAudio(this.storage, req, res, audio);
  }

  /** Descarga de un archivo de audio para escuchar sin conexión (Bearer o ?token=). Con /download se sirve como adjunto. */
  @Get(['items/:id/file/:ino', 'items/:id/file/:ino/download'])
  async file(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('ino') ino: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const item = await this.abs.item(userId, id);
    if (ino !== inoOf(id)) throw new NotFoundException('Archivo no encontrado');
    return serveAudio(this.storage, req, res, item, req.path.endsWith('/download') ? item.originalFilename : undefined);
  }
}
