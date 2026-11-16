import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
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
});
