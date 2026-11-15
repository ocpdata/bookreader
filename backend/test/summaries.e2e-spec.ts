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
    // Cada prueba parte de cero: la base persiste entre ejecuciones y las etiquetas no dependen de un audio.
    await prisma.summary.deleteMany();
    await prisma.tag.deleteMany();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany();
    await prisma.tag.deleteMany();
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

  describe('etiquetas', () => {
    const tagsOf = async (id: string) =>
      (await request(app.getHttpServer()).get(`/api/summaries/${id}`).set(as(DEFAULT_USER_ID))).body.tags;
    const patch = (id: string, body: unknown, userId = DEFAULT_USER_ID) =>
      request(app.getHttpServer()).patch(`/api/summaries/${id}`).set(as(userId)).send(body as object);
    const suggest = async (query = '', userId = DEFAULT_USER_ID) =>
      (await request(app.getHttpServer()).get('/api/tags').query({ query }).set(as(userId))).body;

    it('crea con etiquetas, las normaliza y las reemplaza o quita al editar', async () => {
      const s = await createReady(DEFAULT_USER_ID, { tags: ['  Ventas  ', 'Liderazgo   equipos', '', 'ventas'] });
      // Recorta, colapsa espacios, descarta vacías y no duplica ("ventas" = "Ventas").
      expect(s.tags).toEqual(['Liderazgo equipos', 'Ventas']);

      expect((await patch(s.id, { tags: ['Finanzas'] })).body.tags).toEqual(['Finanzas']);
      // Sin el campo, no se tocan; con lista vacía, se quitan todas.
      expect((await patch(s.id, { title: 'Otro título' })).body.tags).toEqual(['Finanzas']);
      expect((await patch(s.id, { tags: [] })).body.tags).toEqual([]);
    });

    it('trata mayúsculas y acentos como la misma etiqueta y conserva la primera grafía', async () => {
      const a = await createReady(DEFAULT_USER_ID, { tags: ['Psicología'] });
      const b = await createReady(DEFAULT_USER_ID, { title: 'Otro', tags: ['psicologia'] });
      expect(b.tags).toEqual(['Psicología']);
      expect(await prisma.tag.count({ where: { userId: DEFAULT_USER_ID } })).toBe(1);
      expect(a.tags).toEqual(['Psicología']);
    });

    it('sugiere etiquetas con su número de audios y filtra por texto sin acentos', async () => {
      await createReady(DEFAULT_USER_ID, { tags: ['Ventas', 'Liderazgo'] });
      await createReady(DEFAULT_USER_ID, { title: 'Dos', tags: ['Ventas'] });
      expect(await suggest()).toEqual([
        { name: 'Ventas', count: 2 },
        { name: 'Liderazgo', count: 1 },
      ]);
      expect(await suggest('LIDER')).toEqual([{ name: 'Liderazgo', count: 1 }]);
      expect(await suggest('%')).toEqual([]);
    });

    it('elimina las etiquetas que se quedan sin audios', async () => {
      const s = await createReady(DEFAULT_USER_ID, { tags: ['Temporal'] });
      expect(await prisma.tag.count()).toBe(1);
      await patch(s.id, { tags: [] });
      expect(await prisma.tag.count()).toBe(0);
    });

    it('cada usuario tiene sus propias etiquetas', async () => {
      await createReady(DEFAULT_USER_ID, { tags: ['Ventas'] });
      expect(await suggest('', USER_B)).toEqual([]);
      const theirs = await createSummary(USER_B, { tags: ['ventas'] });
      expect(theirs.body.summary.tags).toEqual(['ventas']); // su propia etiqueta, no la de A
      expect(await prisma.tag.count()).toBe(2);
      expect(await suggest('', DEFAULT_USER_ID)).toEqual([{ name: 'Ventas', count: 1 }]);
    });

    it('filtra y busca por etiqueta', async () => {
      await createReady(DEFAULT_USER_ID, { title: 'Uno', tags: ['Ventas'] });
      await createReady(DEFAULT_USER_ID, { title: 'Dos', tags: ['Liderazgo'] });
      const titles = async (query: Record<string, string>) =>
        (await request(app.getHttpServer()).get('/api/summaries').query(query).set(as(DEFAULT_USER_ID))).body.map(
          (s: any) => s.title,
        );
      expect(await titles({ tag: 'ventas' })).toEqual(['Uno']);
      expect(await titles({ tag: 'LIDERAZGO' })).toEqual(['Dos']);
      expect(await titles({ search: 'lider' })).toEqual(['Dos']); // la búsqueda también mira etiquetas
      expect(await titles({ tag: 'inexistente' })).toEqual([]);
      const other = await request(app.getHttpServer()).get('/api/summaries?tag=ventas').set(as(USER_B));
      expect(other.body).toEqual([]);
    });

    it('valida las etiquetas', async () => {
      const s = await createReady(DEFAULT_USER_ID);
      const bad = [
        { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
        { tags: ['x'.repeat(51)] },
        { tags: 'ventas' },
        { tags: [1, 2] },
      ];
      for (const body of bad) {
        const res = await patch(s.id, body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      const create = await createSummary(DEFAULT_USER_ID, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) });
      expect(create.status).toBe(400);
    });
  });

  describe('favoritos y filtros de biblioteca', () => {
    const fav = (id: string, method: 'put' | 'delete', userId = DEFAULT_USER_ID) =>
      request(app.getHttpServer())[method](`/api/summaries/${id}/favorite`).set(as(userId));
    const titles = async (query: Record<string, string>, userId = DEFAULT_USER_ID) =>
      (await request(app.getHttpServer()).get('/api/summaries').query(query).set(as(userId))).body.map(
        (s: any) => s.title,
      );

    it('marca y desmarca favoritos (idempotente) y filtra por ellos', async () => {
      const a = await createReady(DEFAULT_USER_ID, { title: 'A' });
      await createReady(DEFAULT_USER_ID, { title: 'B' });
      expect(a.favorite).toBe(false);

      expect((await fav(a.id, 'put')).body).toEqual({ favorite: true });
      await fav(a.id, 'put').then((r) => expect(r.status).toBe(200));
      expect(await titles({ favorite: 'true' })).toEqual(['A']);
      const one = await request(app.getHttpServer()).get(`/api/summaries/${a.id}`).set(as(DEFAULT_USER_ID));
      expect(one.body.favorite).toBe(true);

      await fav(a.id, 'delete').then((r) => expect(r.status).toBe(204));
      await fav(a.id, 'delete').then((r) => expect(r.status).toBe(204));
      expect(await titles({ favorite: 'true' })).toEqual([]);
    });

    it('no permite favoritos sobre audios ajenos', async () => {
      const a = await createReady(DEFAULT_USER_ID);
      await fav(a.id, 'put', USER_B).then((r) => expect(r.status).toBe(404));
      await fav(a.id, 'delete', USER_B).then((r) => expect(r.status).toBe(404));
      expect(await prisma.favorite.count()).toBe(0);
    });

    it('filtra por terminados y pendientes', async () => {
      const done = await createReady(DEFAULT_USER_ID, { title: 'Terminado' });
      await createReady(DEFAULT_USER_ID, { title: 'Pendiente' });
      await prisma.playbackProgress.create({
        data: { userId: DEFAULT_USER_ID, summaryId: done.id, positionSeconds: 3, completed: true },
      });
      expect(await titles({ status: 'finished' })).toEqual(['Terminado']);
      expect(await titles({ status: 'unfinished' })).toEqual(['Pendiente']);
    });

    it('ordena por última escucha y deja al final lo que nunca se escuchó', async () => {
      const a = await createReady(DEFAULT_USER_ID, { title: 'A' });
      const b = await createReady(DEFAULT_USER_ID, { title: 'B' });
      await createReady(DEFAULT_USER_ID, { title: 'C sin escuchar' });
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: a.id, positionSeconds: 1 } });
      await new Promise((r) => setTimeout(r, 1100));
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: b.id, positionSeconds: 1 } });
      expect(await titles({ sort: 'listened' })).toEqual(['B', 'A', 'C sin escuchar']);
    });

    it('rechaza filtros inválidos', async () => {
      for (const query of ['favorite=false', 'status=otro', 'sort=otro']) {
        await request(app.getHttpServer()).get(`/api/summaries?${query}`).set(as(DEFAULT_USER_ID)).expect(400);
      }
    });
  });

  describe('pantalla de inicio', () => {
    const home = async (userId = DEFAULT_USER_ID) =>
      (await request(app.getHttpServer()).get('/api/home').set(as(userId))).body;
    const titles = (list: { title: string }[]) => list.map((s) => s.title);
    const pause = () => new Promise((r) => setTimeout(r, 1100));

    /** Inserta un audio READY directamente (sin pasar por S3) para probar límites sin tardar. */
    async function insertReady(title: string, extra: Record<string, unknown> = {}, userId = DEFAULT_USER_ID) {
      return prisma.summary.create({
        data: {
          userId,
          title,
          author: 'Autor',
          categoryId,
          s3Key: `audios/${userId}/${title}/audio.mp3`,
          originalFilename: 'a.mp3',
          sizeBytes: 1000,
          contentType: 'audio/mpeg',
          status: 'READY',
          durationSeconds: 100,
          ...extra,
        },
      });
    }

    it('devuelve todo vacío cuando no hay audios', async () => {
      expect(await home()).toEqual({ total: 0, continueListening: [], recent: [], favorites: [], categories: [] });
    });

    it('continuar escuchando: empezados y no terminados, el último escuchado primero', async () => {
      const a = await insertReady('A');
      const b = await insertReady('B');
      const done = await insertReady('Terminado');
      const zero = await insertReady('En cero');
      await insertReady('Sin escuchar');
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: a.id, positionSeconds: 10 } });
      await pause();
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: b.id, positionSeconds: 20 } });
      await prisma.playbackProgress.create({
        data: { userId: DEFAULT_USER_ID, summaryId: done.id, positionSeconds: 95, completed: true },
      });
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: zero.id, positionSeconds: 0 } });

      const data = await home();
      expect(titles(data.continueListening)).toEqual(['B', 'A']);
      expect(data.continueListening[0].progress).toMatchObject({ positionSeconds: 20, completed: false });
      expect(data.total).toBe(5);
    });

    it('agregados recientemente: los más nuevos primero y con límite de 8', async () => {
      for (let i = 1; i <= 10; i++) {
        await insertReady(`Audio ${String(i).padStart(2, '0')}`, { createdAt: new Date(Date.UTC(2026, 0, i)) });
      }
      const data = await home();
      expect(data.recent).toHaveLength(8);
      expect(titles(data.recent)).toEqual(
        ['10', '09', '08', '07', '06', '05', '04', '03'].map((n) => `Audio ${n}`),
      );
      expect(data.total).toBe(10);
    });

    it('limita "continuar escuchando" a 10', async () => {
      for (let i = 1; i <= 12; i++) {
        const s = await insertReady(`E${i}`);
        await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: s.id, positionSeconds: i } });
      }
      expect((await home()).continueListening).toHaveLength(10);
    });

    it('favoritos: el marcado más recientemente primero', async () => {
      const a = await insertReady('A');
      const b = await insertReady('B');
      await insertReady('C');
      await prisma.favorite.create({ data: { userId: DEFAULT_USER_ID, summaryId: a.id } });
      await pause();
      await prisma.favorite.create({ data: { userId: DEFAULT_USER_ID, summaryId: b.id } });
      const data = await home();
      expect(titles(data.favorites)).toEqual(['B', 'A']);
      expect(data.favorites.every((s: any) => s.favorite === true)).toBe(true);
    });

    it('categorías: solo las que tienen audios, con su conteo', async () => {
      const other = await prisma.category.upsert({ where: { name: 'Otra' }, update: {}, create: { name: 'Otra' } });
      await prisma.category.upsert({ where: { name: 'Vacía' }, update: {}, create: { name: 'Vacía' } });
      await insertReady('A');
      await insertReady('B');
      await insertReady('C', { categoryId: other.id });
      const data = await home();
      expect(data.categories).toEqual([
        { id: categoryId, name: 'Prueba', count: 2 },
        { id: other.id, name: 'Otra', count: 1 },
      ]);
    });

    it('no incluye audios pendientes y no mezcla usuarios', async () => {
      await createSummary(DEFAULT_USER_ID); // PENDING
      const mine = await insertReady('Mío');
      await prisma.favorite.create({ data: { userId: DEFAULT_USER_ID, summaryId: mine.id } });
      await prisma.playbackProgress.create({ data: { userId: DEFAULT_USER_ID, summaryId: mine.id, positionSeconds: 5 } });

      const a = await home();
      expect(a.total).toBe(1);
      expect(titles(a.recent)).toEqual(['Mío']);

      const b = await home(USER_B);
      expect(b).toEqual({ total: 0, continueListening: [], recent: [], favorites: [], categories: [] });
    });

    it('incluye etiquetas y el progreso en cada tarjeta', async () => {
      const s = await createReady(DEFAULT_USER_ID, { tags: ['Ventas'] });
      await request(app.getHttpServer()).put(`/api/summaries/${s.id}/progress`).set(as(DEFAULT_USER_ID)).send({ positionSeconds: 2 });
      const data = await home();
      expect(data.continueListening[0]).toMatchObject({ tags: ['Ventas'], favorite: false });
      expect(data.recent[0].progress).toMatchObject({ positionSeconds: 2 });
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
