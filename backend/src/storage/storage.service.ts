import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
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
 * Únicas claves que el servidor puede borrar: `audios/{userId}/{uuid}/audio.ext` o el formato
 * anterior `audios/{uuid}/audio.ext`. Una clave con otra forma (prefijos, `..`, vacía) se rechaza.
 */
const DELETABLE_KEY = /^audios\/[0-9a-f-]{36}(\/[0-9a-f-]{36})?\/audio\.(mp3|m4a)$/;

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
      return Math.max(1, Math.round(duration));
    } finally {
      clearTimeout(timer);
      body?.destroy();
    }
  }

  /** Borra un objeto (idempotente: si no existe, tampoco falla). Rechaza claves con forma inesperada. */
  async deleteObject(key: string): Promise<void> {
    if (!DELETABLE_KEY.test(key)) throw new Error(`Clave no permitida para borrar: ${key}`);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
