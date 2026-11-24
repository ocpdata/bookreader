import type { Request, Response } from 'express';
import { StorageService } from './storage.service';

const SINGLE_RANGE = /^bytes=\d*-\d*$/;

export async function serveAudio(
  storage: StorageService,
  req: Request,
  res: Response,
  audio: { s3Key: string; contentType: string; sizeBytes: number },
  attachmentName?: string,
) {
  const range =
    typeof req.headers.range === 'string' &&
    SINGLE_RANGE.test(req.headers.range)
      ? req.headers.range
      : undefined;
  let object;
  try {
    object = await storage.getObjectRange(audio.s3Key, range);
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
    ...(attachmentName
      ? {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachmentName)}`,
        }
      : {}),
  });
  if (object.contentLength !== undefined)
    res.set('Content-Length', String(object.contentLength));
  if (object.contentRange) res.set('Content-Range', object.contentRange);
  if (object.etag) res.set('ETag', object.etag);
  if (object.lastModified)
    res.set('Last-Modified', object.lastModified.toUTCString());

  res.on('close', () => object.body.destroy());
  if (req.method === 'HEAD') {
    object.body.destroy();
    res.end();
    return;
  }
  object.body.on('error', () => res.destroy());
  object.body.pipe(res);
}
