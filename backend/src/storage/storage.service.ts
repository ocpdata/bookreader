import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_TTL_SECONDS = 15 * 60;
const PLAYBACK_TTL_SECONDS = 60 * 60;

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
}
