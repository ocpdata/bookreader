import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { StorageService } from '../storage/storage.service';
import { inoOf } from './abs.mapper';
import { AbsService } from './abs.service';
import { PlaySessionService } from './play-session.service';

// Un solo rango "bytes=a-b" (los reproductores piden así); cualquier otra forma se ignora y se envía completo.
const SINGLE_RANGE = /^bytes=\d*-\d*$/;

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
   * Audio de una sesión de reproducción, sin cabeceras de autorización: el id aleatorio de la sesión es el
   * secreto. Se sirve desde S3 con soporte de Range (los reproductores buscan y retoman por rangos).
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

    return this.serveAudio(req, res, audio);
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
    return this.serveAudio(req, res, item, req.path.endsWith('/download') ? item.originalFilename : undefined);
  }

  /** Sirve un audio desde S3 con soporte de Range (los reproductores y descargadores piden por rangos). */
  private async serveAudio(
    req: Request,
    res: Response,
    audio: { s3Key: string; contentType: string; sizeBytes: number },
    attachmentName?: string,
  ) {
    const range = typeof req.headers.range === 'string' && SINGLE_RANGE.test(req.headers.range) ? req.headers.range : undefined;
    let object;
    try {
      object = await this.storage.getObjectRange(audio.s3Key, range);
    } catch (error) {
      if ((error as { name?: string }).name === 'InvalidRange') {
        res.status(416).set('Content-Range', `bytes */${audio.sizeBytes}`).end();
        return;
      }
      res.status(502).json({ message: 'No se pudo leer el audio' });
      return;
    }

    res.status(object.partial ? 206 : 200);
    res.set({
      'Content-Type': audio.contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(attachmentName ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachmentName)}` } : {}),
    });
    if (object.contentLength !== undefined) res.set('Content-Length', String(object.contentLength));
    if (object.contentRange) res.set('Content-Range', object.contentRange);
    if (object.etag) res.set('ETag', object.etag);
    if (object.lastModified) res.set('Last-Modified', object.lastModified.toUTCString());

    // Si el cliente corta la descarga (cambia de posición), se libera la conexión con S3.
    res.on('close', () => object.body.destroy());
    if (req.method === 'HEAD') {
      object.body.destroy();
      res.end();
      return;
    }
    object.body.on('error', () => res.destroy());
    object.body.pipe(res);
  }
}
