import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  AudioStorageError,
  InvalidAudioError,
  StorageService,
} from './storage.service';

describe('StorageService upload signatures', () => {
  it('exige la huella firmada para las cargas recuperables', async () => {
    const storage = new StorageService(
      new ConfigService({ AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket' }),
    );
    Object.assign(storage, {
      s3: new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      }),
    });
    const url = new URL(
      await storage.createUploadUrl(
        'audios/test/audio.mp3',
        'audio/mpeg',
        10,
        'a'.repeat(64),
      ),
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'x-amz-checksum-sha256',
    );
  });

  it('envía la copia de Drive con longitud y checksum obligatorios', async () => {
    const storage = new StorageService(
      new ConfigService({ AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket' }),
    );
    const send = jest.fn().mockResolvedValue({});
    Object.assign(storage, { s3: { send } });
    const body = Readable.from([Buffer.from('audio')]);
    await storage.putAudioStream(
      'audios/test/audio.mp3',
      body,
      'audio/mpeg',
      5,
      'a'.repeat(64),
    );
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'test-bucket',
      Body: body,
      ContentLength: 5,
      ContentType: 'audio/mpeg',
      ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
    });
  });
});

describe('StorageService audio validation', () => {
  const fragmented = readFileSync(
    join(__dirname, '../../test/fixtures/sample-fragmented.m4a'),
  );
  let storage: StorageService;

  beforeEach(() => {
    storage = new StorageService(
      new ConfigService({ AWS_REGION: 'us-east-1', S3_BUCKET: 'test-bucket' }),
    );
  });

  afterEach(() => jest.useRealTimers());

  it('acepta un M4A fragmentado aunque cada lectura tarde más de 45 segundos con progreso', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const send = jest.fn().mockImplementation(async () => ({
      Body: Readable.from(
        (async function* () {
          const chunkSize = Math.ceil(fragmented.length / 5);
          for (
            let offset = 0;
            offset < fragmented.length;
            offset += chunkSize
          ) {
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            yield fragmented.subarray(offset, offset + chunkSize);
          }
        })(),
      ),
    }));
    Object.assign(storage, { s3: { send } });
    const result = storage.getAudioInfo(
      'audio.m4a',
      'audio/mp4',
      fragmented.length,
    );
    await jest.advanceTimersByTimeAsync(160_000);
    expect((await result).durationSeconds).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('interrumpe una lectura sin progreso y la distingue de un archivo inválido', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const body = new Readable({ read() {} });
    Object.assign(storage, {
      s3: { send: jest.fn().mockResolvedValue({ Body: body }) },
    });
    const result = storage.getAudioInfo('audio.mp3', 'audio/mpeg', 100);
    const assertion = expect(result).rejects.toBeInstanceOf(AudioStorageError);
    await jest.advanceTimersByTimeAsync(45_000);
    await assertion;
    expect(body.destroyed).toBe(true);
  });

  it('valida un M4A de 200 MiB con una transferencia sostenida de 512 KiB/s', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const total = 200 * 1024 * 1024;
    const freeSize = total - fragmented.length;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(freeSize, 0);
    header.write('free', 4);
    const padding = Buffer.alloc(1024 * 1024);
    const send = jest.fn().mockImplementation(async () => ({
      Body: Readable.from(
        (async function* () {
          yield Buffer.concat([fragmented, header]);
          let remaining = freeSize - header.length;
          while (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            const length = Math.min(remaining, padding.length);
            yield padding.subarray(0, length);
            remaining -= length;
          }
        })(),
      ),
    }));
    Object.assign(storage, { s3: { send } });
    const result = storage.getAudioInfo('audio.m4a', 'audio/mp4', total);
    await jest.advanceTimersByTimeAsync(899_000);
    expect((await result).durationSeconds).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('limita el tiempo total aun cuando la transferencia siga progresando', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const body = Readable.from(
      (async function* () {
        for (const byte of fragmented) {
          await new Promise((resolve) => setTimeout(resolve, 30_000));
          yield Buffer.from([byte]);
        }
      })(),
    );
    Object.assign(storage, {
      s3: { send: jest.fn().mockResolvedValue({ Body: body }) },
    });
    const result = storage.getAudioInfo(
      'audio.m4a',
      'audio/mp4',
      fragmented.length,
    );
    const assertion = expect(result).rejects.toBeInstanceOf(AudioStorageError);
    await jest.advanceTimersByTimeAsync(900_000);
    await assertion;
    expect(body.destroyed).toBe(true);
  });

  it('distingue un fallo del stream o de S3 del contenido inválido', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('S3 unavailable'))
      .mockImplementationOnce(async () => ({
        Body: new Readable({
          read() {
            this.destroy(new Error('Connection reset'));
          },
        }),
      }))
      .mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('not an audio')]),
      });
    Object.assign(storage, { s3: { send } });
    await expect(
      storage.getAudioInfo('audio.mp3', 'audio/mpeg', 12),
    ).rejects.toBeInstanceOf(AudioStorageError);
    await expect(
      storage.getAudioInfo('audio.mp3', 'audio/mpeg', 12),
    ).rejects.toBeInstanceOf(AudioStorageError);
    await expect(
      storage.getAudioInfo('audio.mp3', 'audio/mpeg', 12),
    ).rejects.toBeInstanceOf(InvalidAudioError);
  });
});
