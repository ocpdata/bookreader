import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';

describe('StorageService upload signatures', () => {
  it('exige la huella firmada para las cargas recuperables', async () => {
    const storage = new StorageService(new ConfigService({ AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket' }));
    Object.assign(storage, {
      s3: new S3Client({
        region: 'us-east-1',
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      }),
    });
    const url = new URL(await storage.createUploadUrl('audios/test/audio.mp3', 'audio/mpeg', 10, 'a'.repeat(64)));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-checksum-sha256');
  });

  it('envía la copia de Drive con longitud y checksum obligatorios', async () => {
    const storage = new StorageService(new ConfigService({ AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket' }));
    const send = jest.fn().mockResolvedValue({});
    Object.assign(storage, { s3: { send } });
    const body = Readable.from([Buffer.from('audio')]);
    await storage.putAudioStream('audios/test/audio.mp3', body, 'audio/mpeg', 5, 'a'.repeat(64));
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'test-bucket', Body: body, ContentLength: 5, ContentType: 'audio/mpeg',
      ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
    });
  });
});
