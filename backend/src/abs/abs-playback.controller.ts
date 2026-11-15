import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { StorageService } from '../storage/storage.service';
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
