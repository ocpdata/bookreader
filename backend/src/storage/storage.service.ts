import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseStream } from 'music-metadata';
import { Readable } from 'node:stream';

const UPLOAD_TTL_SECONDS = 15 * 60;
const PLAYBACK_TTL_SECONDS = 60 * 60;
const AUDIO_PARSE_TIMEOUT_MS = 45_000;

/**
 * Únicas claves que el servidor puede borrar: el audio (`audios/{userId}/{uuid}/audio.ext` o el formato
 * anterior `audios/{uuid}/audio.ext`) y su portada (`cover-{8 hex}.jpg` en el mismo prefijo). Una clave
 * con otra forma (prefijos, `..`, vacía) se rechaza.
 */
const DELETABLE_KEY = /^audios\/[0-9a-f-]{36}(\/[0-9a-f-]{36})?\/(audio\.(mp3|m4a)|cover-[0-9a-f]{8}\.jpg)$/;

export interface ObjectRange {
  body: Readable;
  partial: boolean;
  contentLength?: number;
  contentRange?: string;
  etag?: string;
  lastModified?: Date;
}

export interface AudioInfo {
  durationSeconds: number;
  /** Portada incrustada en las etiquetas del archivo, sin procesar. */
  picture: Buffer | null;
}

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    // Las credenciales las resuelve el SDK (perfil local o variables de entorno de AWS).
    this.s3 = new S3Client({ region: config.getOrThrow<string>('AWS_REGION') });
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
  }

  createUploadUrl(key: string, contentType: string, sizeBytes: number) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.s3, command, { expiresIn: UPLOAD_TTL_SECONDS });
  }

  createPlaybackUrl(key: string) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: PLAYBACK_TTL_SECONDS });
  }

  /** Devuelve el tamaño del objeto o null si no existe. */
  async getObjectSize(key: string): Promise<number | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Duración en segundos leyendo el objeto en streaming. Lanza si el contenido no es un audio
   * legible (comprueba el contenido real, no solo la extensión).
   */
  async getAudioDurationSeconds(key: string, contentType: string, sizeBytes: number): Promise<number> {
    return (await this.getAudioInfo(key, contentType, sizeBytes)).durationSeconds;
  }

  /** Duración y portada incrustada, en una sola lectura del archivo. */
  async getAudioInfo(key: string, contentType: string, sizeBytes: number): Promise<AudioInfo> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), AUDIO_PARSE_TIMEOUT_MS);
    let body: Readable | undefined;
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: abort.signal,
      });
      body = object.Body as Readable;
      const metadata = await parseStream(body, { mimeType: contentType, size: sizeBytes }, { duration: true });
      const duration = metadata.format.duration;
      if (!duration || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('No se pudo determinar la duración del audio');
      }
      const picture = metadata.common.picture?.[0]?.data;
      return { durationSeconds: Math.max(1, Math.round(duration)), picture: picture ? Buffer.from(picture) : null };
    } finally {
      clearTimeout(timer);
      body?.destroy();
    }
  }

  /**
   * Objeto (o un rango de bytes) como stream, para servir el audio con soporte de `Range`.
   * `range` ya debe estar validado (un solo rango `bytes=a-b`).
   */
  async getObjectRange(key: string, range?: string): Promise<ObjectRange> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    return {
      body: object.Body as Readable,
      partial: object.$metadata.httpStatusCode === 206,
      contentLength: object.ContentLength,
      contentRange: object.ContentRange,
      etag: object.ETag,
      lastModified: object.LastModified,
    };
  }

  putObject(key: string, body: Buffer, contentType: string) {
    return this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** Cuerpo del objeto como stream; lanza si no existe. */
  async getObjectStream(key: string): Promise<Readable> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body as Readable;
  }

  /** Borra un objeto (idempotente: si no existe, tampoco falla). Rechaza claves con forma inesperada. */
  async deleteObject(key: string): Promise<void> {
    if (!DELETABLE_KEY.test(key)) throw new Error(`Clave no permitida para borrar: ${key}`);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Borra varios objetos en lotes de hasta 1000 (borrar una cuenta con cientos de audios es una sola ronda).
   * Se aplica la misma lista de claves permitidas, y se rechaza todo el conjunto si alguna no la cumple.
   * Devuelve las claves que S3 no pudo borrar.
   */
  async deleteObjects(keys: string[]): Promise<string[]> {
    const invalid = keys.find((key) => !DELETABLE_KEY.test(key));
    if (invalid) throw new Error(`Clave no permitida para borrar: ${invalid}`);
    const failed: string[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const result = await this.s3.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
      );
      failed.push(...(result.Errors ?? []).map((e) => e.Key!).filter(Boolean));
    }
    return failed;
  }
}
