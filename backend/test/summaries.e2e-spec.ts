import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_USER_ID, USER_RESOLVER } from '../src/auth/user.constants';
import { StorageService } from '../src/storage/storage.service';

const USER_B = '00000000-0000-4000-8000-0000000000b2';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

/** S3 simulado: los "objetos" subidos viven en memoria; la duración se lee con el parser real. */
class FakeStorage {
  objects = new Map<string, Buffer>();
  createUploadUrl = async (key: string) => `https://s3.test/upload/${key}`;
  createPlaybackUrl = async (key: string) => `https://s3.test/play/${key}`;
  getObjectSize = async (key: string) => this.objects.get(key)?.length ?? null;
  getAudioDurationSeconds = async (key: string, contentType: string, size: number) => {
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
    return real.getAudioDurationSeconds(key, contentType, size);
  };
}

describe('Summaries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: FakeStorage;
  let categoryId: string;

  const as = (userId: string | undefined) => ({ 'x-test-user': userId ?? '' });

  async function createSummary(userId: string, body: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/summaries')
      .set(as(userId))
      .send({
        title: 'Hábitos atómicos',
        author: 'James Clear',
        categoryId,
        originalFilename: 'habitos.mp3',
        contentType: 'audio/mpeg',
        sizeBytes: fixture('sample.mp3').length,
        ...body,
      });
    return res;
  }

  async function createReady(userId: string, body: Record<string, unknown> = {}, file = 'sample.mp3') {
    const created = await createSummary(userId, {
      sizeBytes: fixture(file).length,
      originalFilename: file,
      contentType: file.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg',
      ...body,
    });
    expect(created.status).toBe(201);
    storage.objects.set(created.body.summary.s3Key, fixture(file));
    const done = await request(app.getHttpServer())
      .post(`/api/summaries/${created.body.summary.id}/complete`)
      .set(as(userId));
    expect(done.status).toBe(200);
    return done.body;
  }

  beforeAll(async () => {
    storage = new FakeStorage();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(USER_RESOLVER)
      .useValue({ resolve: (req: any) => req.headers['x-test-user'] || undefined })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = new PrismaClient();
    await prisma.user.upsert({ where: { id: USER_B }, update: {}, create: { id: USER_B, name: 'Usuario B' } });
    const category = await prisma.category.upsert({
      where: { name: 'Prueba' },
      update: {},
      create: { name: 'Prueba' },
    });
    categoryId = category.id;
  });

  beforeEach(async () => {
    storage.objects.clear();
    await prisma.summary.deleteMany();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  it('requiere un usuario resuelto (401 sin sesión)', async () => {
    await request(app.getHttpServer()).get('/api/summaries').set(as(undefined)).expect(401);
  });

  it('crea el resumen con la clave de S3 prefijada por usuario', async () => {
    const res = await createSummary(DEFAULT_USER_ID, { summaryTitle: 'Resumen en 10 min', narrator: 'Ana' });
    expect(res.status).toBe(201);
    expect(res.body.summary.s3Key).toMatch(new RegExp(`^audios/${DEFAULT_USER_ID}/[0-9a-f-]{36}/audio\\.mp3$`));
    expect(res.body.summary).toMatchObject({ status: 'PENDING', summaryTitle: 'Resumen en 10 min', narrator: 'Ana' });
    expect(res.body.upload.url).toContain(res.body.summary.s3Key);
  });

  it('completa con duración real del MP3 y del M4A', async () => {
    const mp3 = await createReady(DEFAULT_USER_ID);
    expect(mp3.status).toBe('READY');
    expect(mp3.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(mp3.durationSeconds).toBeLessThanOrEqual(4);

    const m4a = await createReady(DEFAULT_USER_ID, { title: 'Otro' }, 'sample.m4a');
    expect(m4a.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(m4a.durationSeconds).toBeLessThanOrEqual(4);
  });

  it('rechaza completar antes de subir y con tamaño distinto', async () => {
    const created = await createSummary(DEFAULT_USER_ID);
    const id = created.body.summary.id;
    await request(app.getHttpServer()).post(`/api/summaries/${id}/complete`).set(as(DEFAULT_USER_ID)).expect(400);
    storage.objects.set(created.body.summary.s3Key, Buffer.from('corto'));
    await request(app.getHttpServer()).post(`/api/summaries/${id}/complete`).set(as(DEFAULT_USER_ID)).expect(400);
  });

  it('rechaza un archivo .mp3 que no es audio y lo deja PENDING', async () => {
    const bytes = fixture('not-audio.mp3');
    const created = await createSummary(DEFAULT_USER_ID, { sizeBytes: bytes.length });
    storage.objects.set(created.body.summary.s3Key, bytes);
    const res = await request(app.getHttpServer())
      .post(`/api/summaries/${created.body.summary.id}/complete`)
      .set(as(DEFAULT_USER_ID));
    expect(res.status).toBe(400);
    const row = await prisma.summary.findUnique({ where: { id: created.body.summary.id } });
    expect(row?.status).toBe('PENDING');
    expect(row?.durationSeconds).toBeNull();
  });

  it('aísla los datos entre usuarios (404 en lugar de 403)', async () => {
    const mine = await createReady(DEFAULT_USER_ID);
    const api = request(app.getHttpServer());

    const listB = await api.get('/api/summaries').set(as(USER_B));
    expect(listB.body).toHaveLength(0);
    const listA = await request(app.getHttpServer()).get('/api/summaries').set(as(DEFAULT_USER_ID));
    expect(listA.body).toHaveLength(1);

    const url = `/api/summaries/${mine.id}`;
    await request(app.getHttpServer()).get(url).set(as(USER_B)).expect(404);
    await request(app.getHttpServer()).patch(url).set(as(USER_B)).send({ title: 'Robado' }).expect(404);
    await request(app.getHttpServer()).post(`${url}/playback`).set(as(USER_B)).expect(404);
    await request(app.getHttpServer()).post(`${url}/complete`).set(as(USER_B)).expect(404);

    const unchanged = await request(app.getHttpServer()).get(url).set(as(DEFAULT_USER_ID));
    expect(unchanged.body.title).toBe('Hábitos atómicos');
  });

  it('la búsqueda no cruza usuarios', async () => {
    await createReady(DEFAULT_USER_ID);
    const res = await request(app.getHttpServer()).get('/api/summaries?search=habitos').set(as(USER_B));
    expect(res.body).toHaveLength(0);
  });

  it('busca sin distinguir acentos ni mayúsculas, y trata % y _ como texto', async () => {
    await createReady(DEFAULT_USER_ID, { title: 'Hábitos atómicos', author: 'James Clear' });
    await createReady(DEFAULT_USER_ID, { title: '100% real_mente', author: 'Ana', summaryTitle: 'Versión corta' });
    const count = async (q: string) =>
      (await request(app.getHttpServer()).get('/api/summaries').query({ search: q }).set(as(DEFAULT_USER_ID))).body.length;

    expect(await count('HABITOS')).toBe(1);
    expect(await count('clear')).toBe(1);
    expect(await count('version')).toBe(1);
    expect(await count('%')).toBe(1);
    expect(await count('_')).toBe(1);
    expect(await count('zzz')).toBe(0);
  });

  it('ordena por título y por duración', async () => {
    const short = await createReady(DEFAULT_USER_ID, { title: 'B corto' });
    const long = await createReady(DEFAULT_USER_ID, { title: 'A largo' });
    await prisma.summary.update({ where: { id: long.id }, data: { durationSeconds: 900 } });
    await prisma.summary.update({ where: { id: short.id }, data: { durationSeconds: 60 } });

    const titles = async (sort: string) =>
      (await request(app.getHttpServer()).get('/api/summaries').query({ sort }).set(as(DEFAULT_USER_ID))).body.map(
        (s: any) => s.title,
      );
    expect(await titles('title')).toEqual(['A largo', 'B corto']);
    expect(await titles('duration')).toEqual(['A largo', 'B corto']);
    expect(await titles('recent')).toEqual(['A largo', 'B corto']);
    await request(app.getHttpServer()).get('/api/summaries?sort=otro').set(as(DEFAULT_USER_ID)).expect(400);
  });

  it('solo lista audios READY', async () => {
    await createSummary(DEFAULT_USER_ID);
    const res = await request(app.getHttpServer()).get('/api/summaries').set(as(DEFAULT_USER_ID));
    expect(res.body).toHaveLength(0);
  });

  it('edita y limpia campos opcionales con cadena vacía', async () => {
    const s = await createReady(DEFAULT_USER_ID, { summaryTitle: 'Resumen', narrator: 'Ana', description: 'Texto' });
    const res = await request(app.getHttpServer())
      .patch(`/api/summaries/${s.id}`)
      .set(as(DEFAULT_USER_ID))
      .send({ summaryTitle: '', narrator: '  Luis  ' });
    expect(res.status).toBe(200);
    expect(res.body.summaryTitle).toBeNull();
    expect(res.body.narrator).toBe('Luis');
    expect(res.body.description).toBe('Texto');
    expect(res.body.durationSeconds).toBe(s.durationSeconds);
  });

  it('rellena la duración de audios anteriores al abrirlos', async () => {
    const s = await createReady(DEFAULT_USER_ID);
    await prisma.summary.update({ where: { id: s.id }, data: { durationSeconds: null } });
    const res = await request(app.getHttpServer()).get(`/api/summaries/${s.id}`).set(as(DEFAULT_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.durationSeconds).toBeGreaterThanOrEqual(2);
    const row = await prisma.summary.findUnique({ where: { id: s.id } });
    expect(row?.durationSeconds).toBe(res.body.durationSeconds);
  });

  describe('progreso de reproducción', () => {
    const put = (id: string, body: unknown, userId = DEFAULT_USER_ID) =>
      request(app.getHttpServer()).put(`/api/summaries/${id}/progress`).set(as(userId)).send(body as object);
    const getOne = async (id: string) =>
      (await request(app.getHttpServer()).get(`/api/summaries/${id}`).set(as(DEFAULT_USER_ID))).body;

    async function readyWithDuration(seconds = 100) {
      const s = await createReady(DEFAULT_USER_ID);
      await prisma.summary.update({ where: { id: s.id }, data: { durationSeconds: seconds } });
      return s.id as string;
    }

    it('guarda la posición y la devuelve en la ficha y en la lista', async () => {
      const id = await readyWithDuration();
      expect((await getOne(id)).progress).toBeNull();

      const res = await put(id, { positionSeconds: 42 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ positionSeconds: 42, completed: false });

      expect((await getOne(id)).progress).toMatchObject({ positionSeconds: 42, completed: false });
      const list = await request(app.getHttpServer()).get('/api/summaries').set(as(DEFAULT_USER_ID));
      expect(list.body[0].progress).toMatchObject({ positionSeconds: 42, completed: false });
    });

    it('marca terminado al llegar al 95 % y lo mantiene hasta que se cambie', async () => {
      const id = await readyWithDuration(100);
      expect((await put(id, { positionSeconds: 94 })).body.completed).toBe(false);
      expect((await put(id, { positionSeconds: 95 })).body.completed).toBe(true);
      // Volver a escuchar desde el inicio no lo desmarca.
      expect((await put(id, { positionSeconds: 10 })).body).toMatchObject({ positionSeconds: 10, completed: true });
      // Marcar como pendiente es explícito.
      expect((await put(id, { completed: false })).body).toMatchObject({ positionSeconds: 10, completed: false });
    });

    it('limita la posición a la duración y conserva la posición al marcar terminado', async () => {
      const id = await readyWithDuration(100);
      expect((await put(id, { positionSeconds: 5000 })).body).toMatchObject({ positionSeconds: 100, completed: true });
      await put(id, { positionSeconds: 30, completed: false });
      expect((await put(id, { completed: true })).body).toMatchObject({ positionSeconds: 30, completed: true });
    });

    it('reiniciar borra el progreso', async () => {
      const id = await readyWithDuration();
      await put(id, { positionSeconds: 60 });
      await request(app.getHttpServer()).delete(`/api/summaries/${id}/progress`).set(as(DEFAULT_USER_ID)).expect(204);
      expect((await getOne(id)).progress).toBeNull();
      // Es idempotente.
      await request(app.getHttpServer()).delete(`/api/summaries/${id}/progress`).set(as(DEFAULT_USER_ID)).expect(204);
    });

    it('no permite tocar el progreso de audios ajenos', async () => {
      const id = await readyWithDuration();
      await put(id, { positionSeconds: 20 });
      await put(id, { positionSeconds: 99 }, USER_B).then((r) => expect(r.status).toBe(404));
      await request(app.getHttpServer()).delete(`/api/summaries/${id}/progress`).set(as(USER_B)).expect(404);
      expect((await getOne(id)).progress).toMatchObject({ positionSeconds: 20 });
      expect(await prisma.playbackProgress.count({ where: { userId: USER_B } })).toBe(0);
    });

    it('valida la entrada y exige un audio disponible', async () => {
      const id = await readyWithDuration();
      for (const body of [{}, { positionSeconds: -1 }, { positionSeconds: 1.5 }, { positionSeconds: '10' }, { completed: 'si' }]) {
        const res = await put(id, body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      const pending = await createSummary(DEFAULT_USER_ID);
      expect((await put(pending.body.summary.id, { positionSeconds: 5 })).status).toBe(400);
    });

    it('el progreso de cada usuario es independiente y se borra con el audio', async () => {
      const id = await readyWithDuration();
      await put(id, { positionSeconds: 33 });
      await prisma.playbackProgress.create({ data: { userId: USER_B, summaryId: id, positionSeconds: 77 } });
      expect((await getOne(id)).progress.positionSeconds).toBe(33);
      await prisma.summary.delete({ where: { id } });
      expect(await prisma.playbackProgress.count({ where: { summaryId: id } })).toBe(0);
    });
  });

  it('valida los datos de entrada', async () => {
    const bad = [
      { contentType: 'audio/wav' },
      { originalFilename: 'x.wav' },
      { sizeBytes: 999_999_999 },
      { title: '' },
      { categoryId: '00000000-0000-4000-8000-0000000000ff' },
      { narrator: 'x'.repeat(201) },
    ];
    for (const patch of bad) {
      const res = await createSummary(DEFAULT_USER_ID, patch);
      expect({ patch, status: res.status }).toEqual({ patch, status: 400 });
    }
  });
});
