import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { StorageService } from '../src/storage/storage.service';

export const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

/** S3 simulado: los "objetos" subidos viven en memoria; la duración se lee con el parser real. */
export class FakeStorage {
  objects = new Map<string, Buffer>();
  /** Claves que S3 "borró" y claves cuyo borrado debe fallar (para probar los reintentos). */
  deleted: string[] = [];
  failKeys = new Set<string>();
  failAllDeletes = false;
  deleteObject = async (key: string) => {
    if (this.failAllDeletes || this.failKeys.has(key)) throw new Error('S3 no disponible');
    // Se ejecuta la validación real de claves del servicio con un cliente S3 simulado.
    const real = Object.create(StorageService.prototype) as StorageService;
    (real as any).bucket = 'x';
    (real as any).s3 = {
      send: async (command: any) => {
        this.deleted.push(command.input.Key);
        this.objects.delete(command.input.Key);
      },
    };
    await real.deleteObject(key);
  };
  /** Borrado por lotes: aplica la validación real de claves y devuelve las que "fallan" (failKeys o failAllDeletes). */
  deleteObjects = async (keys: string[]) => {
    const real = Object.create(StorageService.prototype) as StorageService;
    (real as any).bucket = 'x';
    (real as any).s3 = {
      send: async (command: any) => {
        const errors: { Key: string }[] = [];
        for (const { Key } of command.input.Delete.Objects) {
          if (this.failAllDeletes || this.failKeys.has(Key)) errors.push({ Key });
          else {
            this.deleted.push(Key);
            this.objects.delete(Key);
          }
        }
        return { Errors: errors };
      },
    };
    return real.deleteObjects(keys);
  };
  createUploadUrl = async (key: string) => `https://s3.test/upload/${key}`;
  createPlaybackUrl = async (key: string) => `https://s3.test/play/${key}`;
  getObjectSize = async (key: string) => this.objects.get(key)?.length ?? null;
  putObject = async (key: string, body: Buffer) => {
    this.objects.set(key, body);
  };
  /** Como S3: con Range devuelve 206 y el tramo pedido; un inicio fuera del archivo lanza InvalidRange. */
  getObjectRange = async (key: string, range?: string) => {
    const body = this.objects.get(key);
    if (!body) throw new Error('NoSuchKey');
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!match) {
      const stream = new PassThrough();
      stream.end(body);
      return { body: stream, partial: false, contentLength: body.length, etag: '"fake"', lastModified: new Date(0) };
    }
    const start = match[1] === '' ? Math.max(0, body.length - Number(match[2])) : Number(match[1]);
    const end = match[1] === '' || match[2] === '' ? body.length - 1 : Math.min(Number(match[2]), body.length - 1);
    if (start >= body.length) throw Object.assign(new Error('InvalidRange'), { name: 'InvalidRange' });
    const slice = body.subarray(start, end + 1);
    const stream = new PassThrough();
    stream.end(slice);
    return {
      body: stream,
      partial: true,
      contentLength: slice.length,
      contentRange: `bytes ${start}-${end}/${body.length}`,
      etag: '"fake"',
      lastModified: new Date(0),
    };
  };
  getObjectStream = async (key: string) => {
    const body = this.objects.get(key);
    if (!body) throw new Error('NoSuchKey');
    const stream = new PassThrough();
    stream.end(body);
    return stream;
  };
  getAudioDurationSeconds = async (key: string, contentType: string, size: number) =>
    (await this.getAudioInfo(key, contentType, size)).durationSeconds;
  getAudioInfo = async (key: string, contentType: string, size: number) => {
    const real = Object.create(StorageService.prototype) as StorageService;
    (real as any).bucket = 'x';
    // El cuerpo real de S3 es un stream de bytes (no de objetos, como Readable.from).
    (real as any).s3 = {
      send: async () => {
        const body = new PassThrough();
        body.end(this.objects.get(key));
        return { Body: body };
      },
    };
    return real.getAudioInfo(key, contentType, size);
  };
}
