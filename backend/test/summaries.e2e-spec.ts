import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import sharp = require('sharp');
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DEFAULT_USER_ID, USER_RESOLVER } from '../src/auth/user.constants';
import { StorageService } from '../src/storage/storage.service';
import { PurgeService } from '../src/summaries/purge.service';
import { FakeStorage, fixture } from './fake-storage';

const USER_B = '00000000-0000-4000-8000-0000000000b2';

describe('Summaries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: FakeStorage;
  let purge: PurgeService;
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
    purge = module.get(PurgeService);
    app = module.createNestApplication();
    configureApp(app);
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
    storage.deleted = [];
    storage.failKeys.clear();
    storage.failAllDeletes = false;
    // Cada prueba parte de cero: la base persiste entre ejecuciones y las etiquetas no dependen de un audio.
    await prisma.summary.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.tag.deleteMany();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany();
    await prisma.folder.deleteMany();
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

  describe('papelera y limpieza', () => {
    const api = () => request(app.getHttpServer());
    const trash = (id: string, userId = DEFAULT_USER_ID) => api().delete(`/api/summaries/${id}`).set(as(userId));
    const restore = (id: string, userId = DEFAULT_USER_ID) => api().post(`/api/summaries/${id}/restore`).set(as(userId));
    const trashList = async (userId = DEFAULT_USER_ID) => (await api().get('/api/trash').set(as(userId))).body;
    const forever = (id: string, userId = DEFAULT_USER_ID) => api().delete(`/api/trash/${id}`).set(as(userId));
    const keyOf = async (id: string) => (await prisma.summary.findUniqueOrThrow({ where: { id } })).s3Key;
    const DAY = 24 * 3600 * 1000;

    it('mover a la papelera lo oculta en todas partes sin borrar nada', async () => {
      const s = await createReady(DEFAULT_USER_ID, { tags: ['Ventas'] });
      await api().put(`/api/summaries/${s.id}/favorite`).set(as(DEFAULT_USER_ID));
      await api().put(`/api/summaries/${s.id}/progress`).set(as(DEFAULT_USER_ID)).send({ positionSeconds: 2 });

      await trash(s.id).then((r) => expect(r.status).toBe(204));

      expect((await api().get('/api/summaries').set(as(DEFAULT_USER_ID))).body).toEqual([]);
      expect((await api().get('/api/home').set(as(DEFAULT_USER_ID))).body).toMatchObject({
        total: 0,
        recent: [],
        favorites: [],
        continueListening: [],
        categories: [],
      });
      expect((await api().get('/api/tags').set(as(DEFAULT_USER_ID))).body).toEqual([]);
      await api().get(`/api/summaries/${s.id}`).set(as(DEFAULT_USER_ID)).expect(404);
      await api().post(`/api/summaries/${s.id}/playback`).set(as(DEFAULT_USER_ID)).expect(404);
      await api().patch(`/api/summaries/${s.id}`).set(as(DEFAULT_USER_ID)).send({ title: 'x' }).expect(404);
      await api().put(`/api/summaries/${s.id}/progress`).set(as(DEFAULT_USER_ID)).send({ positionSeconds: 3 }).expect(404);
      await api().put(`/api/summaries/${s.id}/favorite`).set(as(DEFAULT_USER_ID)).expect(404);
      await trash(s.id).then((r) => expect(r.status).toBe(404)); // ya está en la papelera

      // Nada se borró: ni el archivo ni la fila.
      expect(storage.deleted).toEqual([]);
      expect(storage.objects.has(await keyOf(s.id))).toBe(true);
    });

    it('la papelera lista lo eliminado con la fecha de borrado definitivo', async () => {
      const a = await createReady(DEFAULT_USER_ID, { title: 'A' });
      const b = await createReady(DEFAULT_USER_ID, { title: 'B' });
      await createReady(DEFAULT_USER_ID, { title: 'C vivo' });
      await trash(a.id);
      await new Promise((r) => setTimeout(r, 1100));
      await trash(b.id);

      const list = await trashList();
      expect(list.map((i: any) => i.title)).toEqual(['B', 'A']); // el más reciente primero
      const first = list[0];
      expect(Object.keys(first).sort()).toEqual(
        ['author', 'category', 'deletedAt', 'durationSeconds', 'id', 'purgeAt', 'sizeBytes', 'title'].sort(),
      );
      expect(new Date(first.purgeAt).getTime() - new Date(first.deletedAt).getTime()).toBe(30 * DAY);
    });

    it('restaurar devuelve el audio con etiquetas, favorito y progreso intactos', async () => {
      const s = await createReady(DEFAULT_USER_ID, { tags: ['Ventas'] });
      await api().put(`/api/summaries/${s.id}/favorite`).set(as(DEFAULT_USER_ID));
      await api().put(`/api/summaries/${s.id}/progress`).set(as(DEFAULT_USER_ID)).send({ positionSeconds: 2 });
      await trash(s.id);

      const res = await restore(s.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: s.id, tags: ['Ventas'], favorite: true, progress: { positionSeconds: 2 } });
      expect((await api().get('/api/summaries').set(as(DEFAULT_USER_ID))).body).toHaveLength(1);
      expect(await trashList()).toEqual([]);
      await restore(s.id).then((r) => expect(r.status).toBe(404)); // ya no está en la papelera
    });

    it('otro usuario no puede eliminar, restaurar ni borrar definitivamente', async () => {
      const s = await createReady(DEFAULT_USER_ID);
      await trash(s.id, USER_B).then((r) => expect(r.status).toBe(404));
      await trash(s.id);
      await restore(s.id, USER_B).then((r) => expect(r.status).toBe(404));
      await forever(s.id, USER_B).then((r) => expect(r.status).toBe(404));
      expect(await trashList(USER_B)).toEqual([]);
      expect((await api().delete('/api/trash').set(as(USER_B))).body).toEqual({ deleted: 0, failed: 0 });

      // Nada cambió para el dueño.
      expect(await trashList()).toHaveLength(1);
      expect(storage.deleted).toEqual([]);
      expect(await prisma.summary.count({ where: { id: s.id } })).toBe(1);
    });

    it('el borrado definitivo solo vale desde la papelera y borra el archivo exacto y la fila', async () => {
      const s = await createReady(DEFAULT_USER_ID);
      const other = await createReady(DEFAULT_USER_ID, { title: 'Otro' });
      const key = await keyOf(s.id);

      await forever(s.id).then((r) => expect(r.status).toBe(404)); // vivo: no se puede borrar así
      expect(storage.deleted).toEqual([]);

      await trash(s.id);
      await forever(s.id).then((r) => expect(r.status).toBe(204));
      expect(storage.deleted).toEqual([key]);
      expect(await prisma.summary.count({ where: { id: s.id } })).toBe(0);
      expect(await prisma.summary.count({ where: { id: other.id } })).toBe(1);
      expect(storage.objects.has(await keyOf(other.id))).toBe(true);
    });

    it('si S3 falla el audio no se pierde y se puede reintentar', async () => {
      const s = await createReady(DEFAULT_USER_ID);
      await trash(s.id);
      storage.failAllDeletes = true;
      await forever(s.id).then((r) => expect(r.status).toBe(502));
      expect(await prisma.summary.count({ where: { id: s.id } })).toBe(1);
      expect(await trashList()).toHaveLength(1);

      storage.failAllDeletes = false;
      await forever(s.id).then((r) => expect(r.status).toBe(204));
      expect(await prisma.summary.count({ where: { id: s.id } })).toBe(0);
    });

    it('vaciar la papelera borra solo la del usuario', async () => {
      const a1 = await createReady(DEFAULT_USER_ID, { title: 'A1' });
      const a2 = await createReady(DEFAULT_USER_ID, { title: 'A2' });
      const alive = await createReady(DEFAULT_USER_ID, { title: 'Vivo' });
      const b = await createReady(USER_B, { title: 'B' });
      await trash(a1.id);
      await trash(a2.id);
      await trash(b.id, USER_B);

      const res = await api().delete('/api/trash').set(as(DEFAULT_USER_ID));
      expect(res.body).toEqual({ deleted: 2, failed: 0 });
      expect(await prisma.summary.findMany({ select: { title: true }, orderBy: { title: 'asc' } })).toEqual([
        { title: 'B' },
        { title: 'Vivo' },
      ]);
      expect(await trashList(USER_B)).toHaveLength(1);
      expect(storage.objects.has(await keyOf(alive.id))).toBe(true);
    });

    it('la purga borra la papelera vencida y las cargas abandonadas, y nada más', async () => {
      const alive = await createReady(DEFAULT_USER_ID, { title: 'Vivo' });
      const trashed = await createReady(DEFAULT_USER_ID, { title: 'En papelera' });
      await trash(trashed.id);
      const pending = await createSummary(DEFAULT_USER_ID, { title: 'Pendiente' });
      const pendingId = pending.body.summary.id as string;
      storage.objects.set(pending.body.summary.s3Key, Buffer.from('a medias'));
      const now = Date.now();

      // 2 horas: ni la papelera (30 días) ni la carga pendiente (24 h) vencen.
      expect(await purge.run(new Date(now + 2 * 3600 * 1000))).toEqual({ trashExpired: 0, pendingStale: 0, failed: 0 });
      // 25 horas: vence la carga abandonada, no la papelera.
      expect(await purge.run(new Date(now + 25 * 3600 * 1000))).toEqual({ trashExpired: 0, pendingStale: 1, failed: 0 });
      expect(await prisma.summary.count({ where: { id: pendingId } })).toBe(0);
      expect(await prisma.summary.count({ where: { id: trashed.id } })).toBe(1);
      // 31 días: vence la papelera.
      expect(await purge.run(new Date(now + 31 * DAY))).toEqual({ trashExpired: 1, pendingStale: 0, failed: 0 });
      expect(await prisma.summary.count({ where: { id: trashed.id } })).toBe(0);

      // El audio vivo nunca se toca, por viejo que sea.
      expect(await purge.run(new Date(now + 365 * DAY))).toEqual({ trashExpired: 0, pendingStale: 0, failed: 0 });
      expect(await prisma.summary.count({ where: { id: alive.id } })).toBe(1);
      expect(storage.objects.has(await keyOf(alive.id))).toBe(true);
    });

    it('un fallo de S3 en la purga conserva la fila y no frena el resto', async () => {
      const a = await createReady(DEFAULT_USER_ID, { title: 'A' });
      const b = await createReady(DEFAULT_USER_ID, { title: 'B' });
      await trash(a.id);
      await trash(b.id);
      storage.failKeys.add(await keyOf(a.id));

      const future = new Date(Date.now() + 31 * DAY);
      expect(await purge.run(future)).toEqual({ trashExpired: 1, pendingStale: 0, failed: 1 });
      expect(await prisma.summary.count({ where: { id: a.id } })).toBe(1); // se reintenta en la próxima
      expect(await prisma.summary.count({ where: { id: b.id } })).toBe(0);

      storage.failKeys.clear();
      expect(await purge.run(future)).toEqual({ trashExpired: 1, pendingStale: 0, failed: 0 });
    });

    it('nunca borra una clave con forma inesperada', async () => {
      const s = await insertWithKey('audios/../otro/audio.mp3');
      const prefix = await insertWithKey('audios/');
      const other = await insertWithKey('covers/00000000-0000-4000-8000-000000000001/audio.mp3');
      for (const row of [s, prefix, other]) {
        await prisma.summary.update({ where: { id: row.id }, data: { deletedAt: new Date(Date.now() - 40 * DAY) } });
      }
      expect(await purge.run()).toEqual({ trashExpired: 0, pendingStale: 0, failed: 3 });
      expect(storage.deleted).toEqual([]);
      expect(await prisma.summary.count()).toBe(3);
    });

    it('acepta las dos formas de clave válidas (con y sin usuario)', async () => {
      const withUser = await insertWithKey(
        'audios/00000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111/audio.mp3',
      );
      const legacy = await insertWithKey('audios/22222222-2222-4222-8222-222222222222/audio.m4a');
      for (const row of [withUser, legacy]) {
        await prisma.summary.update({ where: { id: row.id }, data: { deletedAt: new Date(Date.now() - 40 * DAY) } });
      }
      expect(await purge.run()).toEqual({ trashExpired: 2, pendingStale: 0, failed: 0 });
      expect(storage.deleted.sort()).toEqual([withUser.s3Key, legacy.s3Key].sort());
    });

    async function insertWithKey(s3Key: string) {
      return prisma.summary.create({
        data: {
          userId: DEFAULT_USER_ID,
          title: s3Key,
          author: 'Autor',
          categoryId,
          s3Key,
          originalFilename: 'a.mp3',
          sizeBytes: 10,
          contentType: 'audio/mpeg',
          status: 'READY',
        },
      });
    }
  });

  describe('cuotas', () => {
    const A = DEFAULT_USER_ID;
    const SIZE = fixture('sample.mp3').length;
    const api = () => request(app.getHttpServer());
    const usage = async (user = A) => (await api().get('/api/usage').set(as(user))).body;
    const setQuota = (data: { storageLimitBytes?: bigint | null; maxAudios?: number | null }, user = A) =>
      prisma.user.update({ where: { id: user }, data });

    beforeEach(async () => {
      for (const id of [A, USER_B]) await setQuota({ storageLimitBytes: null, maxAudios: null }, id);
    });
    afterAll(async () => {
      for (const id of [A, USER_B]) await setQuota({ storageLimitBytes: null, maxAudios: null }, id);
      delete process.env.DEFAULT_STORAGE_LIMIT_BYTES;
      delete process.env.DEFAULT_MAX_AUDIOS;
    });

    it('informa el uso frente a la cuota (por defecto 2 GB y 500 audios) y exige sesión', async () => {
      expect(await usage()).toEqual({ usedBytes: 0, limitBytes: 2 * 1024 ** 3, audios: 0, maxAudios: 500, trashBytes: 0, trashAudios: 0 });
      const audio = await createReady(A);
      await createReady(A);
      expect(await usage()).toMatchObject({ usedBytes: 2 * SIZE, audios: 2, trashBytes: 0 });
      await api().delete(`/api/summaries/${audio.id}`).set(as(A)).expect(204);
      expect(await usage()).toMatchObject({ usedBytes: 2 * SIZE, audios: 2, trashBytes: SIZE, trashAudios: 1 });
      expect(await usage(USER_B)).toMatchObject({ usedBytes: 0, audios: 0 });
      await api().get('/api/usage').expect(401);
    });

    it('rechaza el audio que no cabe en el almacenamiento, sin crear la fila ni la URL de carga', async () => {
      await setQuota({ storageLimitBytes: BigInt(SIZE * 2 + 100) });
      await createReady(A);
      await createReady(A);
      const res = await createSummary(A);
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('QUOTA_STORAGE');
      expect(res.body.message).toContain('No hay espacio suficiente');
      expect(res.body).not.toHaveProperty('upload');
      expect(await prisma.summary.count({ where: { userId: A } })).toBe(2);
      // La cuota es de cada cuenta.
      expect((await createSummary(USER_B)).status).toBe(201);
    });

    it('cuentan las cargas pendientes y la papelera; se libera al borrar de forma definitiva', async () => {
      await setQuota({ storageLimitBytes: BigInt(SIZE * 2 + 100) });
      const pending = await createSummary(A);
      expect(pending.status).toBe(201); // PENDING: ya reserva su espacio
      const ready = await createReady(A);
      expect((await createSummary(A)).status).toBe(413);

      await api().delete(`/api/summaries/${ready.id}`).set(as(A)).expect(204);
      expect((await createSummary(A)).status).toBe(413); // en la papelera sigue ocupando
      await api().delete(`/api/trash/${ready.id}`).set(as(A)).expect(204);
      expect((await createSummary(A)).status).toBe(201);
    });

    it('limita el número de audios', async () => {
      await setQuota({ maxAudios: 2 });
      await createReady(A);
      await createReady(A);
      const res = await createSummary(A);
      expect([res.status, res.body.code]).toEqual([413, 'QUOTA_AUDIOS']);
      expect(res.body.message).toContain('máximo de 2 audios');
      expect(await usage()).toMatchObject({ audios: 2, maxAudios: 2 });
    });

    it('usa los valores por defecto del servicio y los de la cuenta cuando existen', async () => {
      process.env.DEFAULT_STORAGE_LIMIT_BYTES = String(SIZE + 50);
      process.env.DEFAULT_MAX_AUDIOS = '3';
      expect(await usage()).toMatchObject({ limitBytes: SIZE + 50, maxAudios: 3 });
      await createReady(A);
      expect((await createSummary(A)).status).toBe(413);
      // El límite propio de la cuenta manda sobre el valor por defecto.
      await setQuota({ storageLimitBytes: BigInt(10 * SIZE) });
      expect(await usage()).toMatchObject({ limitBytes: 10 * SIZE, maxAudios: 3 });
      expect((await createSummary(A)).status).toBe(201);
      // Un valor inválido en el entorno vuelve al predeterminado.
      process.env.DEFAULT_STORAGE_LIMIT_BYTES = 'basura';
      delete process.env.DEFAULT_MAX_AUDIOS;
      await setQuota({ storageLimitBytes: null });
      expect(await usage()).toMatchObject({ limitBytes: 2 * 1024 ** 3, maxAudios: 500 });
      delete process.env.DEFAULT_STORAGE_LIMIT_BYTES;
    });

    it('cargas simultáneas no pueden superar la cuota', async () => {
      await setQuota({ storageLimitBytes: BigInt(SIZE * 2 + 100) });
      const results = await Promise.all(Array.from({ length: 6 }, () => createSummary(A)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 413, 413, 413, 413]);
      expect(await prisma.summary.count({ where: { userId: A } })).toBe(2);
    });
  });

  describe('carpetas', () => {
    const A = DEFAULT_USER_ID;
    const api = () => request(app.getHttpServer());
    const mk = async (name: string, parentId: string | null = null, user = A) => {
      const res = await api().post('/api/folders').set(as(user)).send({ name, parentId });
      expect({ name, status: res.status }).toEqual({ name, status: 201 });
      return res.body.id as string;
    };
    const tree = async (user = A) => (await api().get('/api/folders').set(as(user))).body as any[];
    const listIn = async (query: string, user = A) =>
      (await api().get(`/api/summaries?${query}`).set(as(user))).body.map((s: any) => s.title).sort();

    it('crea carpetas anidadas, las lista con su conteo y exige sesión', async () => {
      const negocios = await mk('Negocios');
      const ventas = await mk('Ventas', negocios);
      await createReady(A, { title: 'En ventas', folderId: ventas });
      await createReady(A, { title: 'En la raíz' });
      const list = await tree();
      expect(list.map((f) => [f.name, f.parentId, f.count])).toEqual([
        ['Negocios', null, 0],
        ['Ventas', negocios, 1],
      ]);
      await api().get('/api/folders').expect(401);
    });

    it('rechaza nombres duplicados entre hermanas (sin distinguir acentos ni mayúsculas) y permite el mismo nombre en otro nivel', async () => {
      const a = await mk('Finanzas');
      await mk('Hijo', a);
      for (const [name, parentId] of [['FINANZAS', null], ['finánzas', null], ['hijo', a]] as const) {
        const res = await api().post('/api/folders').set(as(A)).send({ name, parentId });
        expect({ name, status: res.status }).toEqual({ name, status: 409 });
      }
      await mk('Finanzas', a);
      // Otro usuario puede usar el mismo nombre.
      await mk('Finanzas', null, USER_B);
    });

    it('valida nombre, padre y el cuerpo', async () => {
      for (const body of [{ name: '   ' }, { name: 'x'.repeat(101) }, { name: 'a', parentId: 'no-uuid' }, {}]) {
        const res = await api().post('/api/folders').set(as(A)).send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      const missing = await api().post('/api/folders').set(as(A)).send({ name: 'a', parentId: USER_B });
      expect(missing.status).toBe(404);
      const trimmed = await api().post('/api/folders').set(as(A)).send({ name: '  Mis   libros  ' });
      expect(trimmed.body.name).toBe('Mis libros');
    });

    it('aísla las carpetas entre usuarios', async () => {
      const mine = await mk('Mía');
      const theirs = await mk('Suya', null, USER_B);
      expect(await tree()).toHaveLength(1);
      await api().patch(`/api/folders/${theirs}`).set(as(A)).send({ name: 'x' }).expect(404);
      await api().delete(`/api/folders/${theirs}`).set(as(A)).expect(404);
      await api().post('/api/folders').set(as(A)).send({ name: 'x', parentId: theirs }).expect(404);
      await api().patch(`/api/folders/${mine}`).set(as(A)).send({ parentId: theirs }).expect(404);

      const audio = await createReady(A, { title: 'Mío' });
      await api().patch(`/api/summaries/${audio.id}`).set(as(A)).send({ folderId: theirs }).expect(404);
      await createSummary(A, { folderId: theirs }).then((r) => expect(r.status).toBe(404));
      await api().get(`/api/summaries?folderId=${theirs}`).set(as(A)).expect(404);
      await api().post('/api/summaries/move').set(as(A)).send({ ids: [audio.id], folderId: theirs }).expect(404);
    });

    it('renombra y mueve carpetas; no permite ciclos ni pasar de 5 niveles', async () => {
      const a = await mk('A');
      const b = await mk('B', a);
      const c = await mk('C', b);
      const patch = (id: string, body: object) => api().patch(`/api/folders/${id}`).set(as(A)).send(body);

      expect((await patch(a, { name: 'Alfa' })).body.name).toBe('Alfa');
      expect((await patch(a, { parentId: a })).status).toBe(400);
      expect((await patch(a, { parentId: c })).status).toBe(400);
      expect((await patch(c, { parentId: null })).body.parentId).toBeNull();
      await patch(c, { parentId: b }).expect(200);

      // Cadena de 5 niveles: A > B > C > D > E. Un sexto nivel no cabe.
      const d = await mk('D', c);
      const e = await mk('E', d);
      const sixth = await api().post('/api/folders').set(as(A)).send({ name: 'F', parentId: e });
      expect(sixth.status).toBe(400);
      // Mover un subárbol que haría pasar el límite también falla.
      const other = await mk('Otra');
      const deep = await mk('Hondo', other);
      expect((await patch(other, { parentId: e })).status).toBe(400);
      expect((await patch(deep, { parentId: e })).status).toBe(400);
      // El nombre se valida al mover: no puede chocar en el destino.
      await mk('B', null);
      expect((await patch(b, { parentId: null })).status).toBe(409);
    });

    it('limita el número de carpetas por usuario', async () => {
      await prisma.folder.createMany({
        data: Array.from({ length: 200 }, (_, i) => ({ userId: A, name: `Carpeta ${i}` })),
      });
      const res = await api().post('/api/folders').set(as(A)).send({ name: 'Una más' });
      expect(res.status).toBe(400);
      expect((await api().post('/api/folders').set(as(USER_B)).send({ name: 'Una más' })).status).toBe(201);
    });

    it('guarda un audio al crearlo, lo mueve y lo filtra por carpeta (con o sin subcarpetas)', async () => {
      const f = await mk('F');
      const g = await mk('G', f);
      const inF = await createReady(A, { title: 'en F', folderId: f });
      await createReady(A, { title: 'en G', folderId: g });
      await createReady(A, { title: 'raíz' });
      expect(inF.folderId).toBe(f);

      expect(await listIn(`folderId=${f}`)).toEqual(['en F']);
      expect(await listIn(`folderId=${f}&includeSubfolders=true`)).toEqual(['en F', 'en G']);
      expect(await listIn('folderId=root')).toEqual(['raíz']);
      expect(await listIn('')).toEqual(['en F', 'en G', 'raíz']);

      const moved = await api().patch(`/api/summaries/${inF.id}`).set(as(A)).send({ folderId: null });
      expect(moved.body.folderId).toBeNull();
      expect(await listIn('folderId=root')).toEqual(['en F', 'raíz']);
      // Editar otro campo no cambia la carpeta.
      await api().patch(`/api/summaries/${inF.id}`).set(as(A)).send({ folderId: g }).expect(200);
      const renamed = await api().patch(`/api/summaries/${inF.id}`).set(as(A)).send({ title: 'nuevo' });
      expect(renamed.body.folderId).toBe(g);
      await api().get('/api/summaries?folderId=nope').set(as(A)).expect(400);
    });

    it('mueve varios audios de una vez, todo o nada', async () => {
      const f = await mk('Destino');
      const one = await createReady(A, { title: 'uno' });
      const two = await createReady(A, { title: 'dos' });
      const foreign = await createReady(USER_B, { title: 'ajeno' });
      const move = (body: object, user = A) => api().post('/api/summaries/move').set(as(user)).send(body);

      expect((await move({ ids: [one.id, foreign.id], folderId: f })).status).toBe(404);
      expect(await listIn(`folderId=${f}`)).toEqual([]);
      expect((await move({ ids: [one.id, two.id, one.id], folderId: f })).body).toEqual({ moved: 2 });
      expect(await listIn(`folderId=${f}`)).toEqual(['dos', 'uno']);
      expect((await move({ ids: [one.id], folderId: null })).body).toEqual({ moved: 1 });
      expect((await move({ ids: [one.id] })).status).toBe(400);
      expect((await move({ ids: [], folderId: f })).status).toBe(400);
      // Un audio en la papelera no se mueve.
      await api().delete(`/api/summaries/${two.id}`).set(as(A)).expect(204);
      expect((await move({ ids: [two.id], folderId: null })).status).toBe(404);
    });

    it('al borrar una carpeta sus audios (también en papelera) y subcarpetas suben al padre', async () => {
      const top = await mk('Top');
      const mid = await mk('Mid', top);
      await mk('Hoja', mid);
      const live = await createReady(A, { title: 'vivo', folderId: mid });
      const trashed = await createReady(A, { title: 'papelera', folderId: mid });
      await api().delete(`/api/summaries/${trashed.id}`).set(as(A)).expect(204);

      const res = await api().delete(`/api/folders/${mid}`).set(as(A));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ movedFolders: 1, movedAudios: 2 });
      expect((await tree()).map((f) => [f.name, f.parentId])).toEqual([['Hoja', top], ['Top', null]]);
      expect((await api().get(`/api/summaries/${live.id}`).set(as(A))).body.folderId).toBe(top);

      // Restaurar desde la papelera lo deja en la carpeta a la que subió.
      const restored = await api().post(`/api/summaries/${trashed.id}/restore`).set(as(A));
      expect(restored.body.folderId).toBe(top);
    });

    it('al borrar renombra las subcarpetas que chocan con las del padre', async () => {
      const top = await mk('Top');
      const mid = await mk('Mid', top);
      await mk('Ventas', top);
      await mk('Ventas', mid);
      await mk('Mid', mid);
      const audio = await createReady(A, { title: 'x', folderId: mid });
      await api().delete(`/api/folders/${mid}`).set(as(A)).expect(200);

      const underTop = (await tree()).filter((f) => f.parentId === top).map((f) => f.name).sort();
      expect(underTop).toEqual(['Mid (2)', 'Ventas', 'Ventas (2)']);
      expect((await api().get(`/api/summaries/${audio.id}`).set(as(A))).body.folderId).toBe(top);
    });

    it('un audio nuevo puede crearse directamente en una carpeta y el borrado definitivo no depende de ella', async () => {
      const f = await mk('Temp');
      const audio = await createReady(A, { title: 'para borrar', folderId: f });
      await api().delete(`/api/summaries/${audio.id}`).set(as(A)).expect(204);
      await api().delete(`/api/trash/${audio.id}`).set(as(A)).expect(204);
      await api().delete(`/api/folders/${f}`).set(as(A)).expect(200);
      expect(await tree()).toEqual([]);
    });
  });

  describe('portadas', () => {
    const A = DEFAULT_USER_ID;
    const api = () => request(app.getHttpServer());
    const png = (width = 1200, height = 900, background = '#cc3333') =>
      sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

    /** MP3 con una portada PNG incrustada (etiqueta ID3v2.3 con un fotograma APIC). */
    function mp3WithArt(image: Buffer) {
      const apic = Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from([0]), image]);
      const frame = Buffer.concat([Buffer.from('APIC'), Buffer.from([apic.length >>> 24, apic.length >>> 16, apic.length >>> 8, apic.length].map((n) => n & 255)), Buffer.from([0, 0]), apic]);
      const size = frame.length;
      const synchsafe = [(size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127];
      return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), Buffer.from(synchsafe), frame, fixture('sample.mp3')]);
    }

    async function ready(user = A, audio?: Buffer) {
      const created = await createSummary(user, { sizeBytes: (audio ?? fixture('sample.mp3')).length });
      expect(created.status).toBe(201);
      storage.objects.set(created.body.summary.s3Key, audio ?? fixture('sample.mp3'));
      const done = await api().post(`/api/summaries/${created.body.summary.id}/complete`).set(as(user));
      expect(done.status).toBe(200);
      return done.body;
    }
    const upload = (id: string, file: Buffer | null, user = A, name = 'portada.png') => {
      const req = api().post(`/api/summaries/${id}/cover`).set(as(user));
      return file ? req.attach('file', file, name) : req.field('x', 'y');
    };
    const coverKeys = () => [...storage.objects.keys()].filter((k) => /cover-[0-9a-f]{8}\.jpg$/.test(k));

    it('sube una portada, la normaliza a JPEG de 800 px y la sirve solo a su dueño', async () => {
      const audio = await ready();
      expect(audio.coverUrl).toBeNull();
      expect(audio).not.toHaveProperty('coverKey');
      await api().get(`/api/summaries/${audio.id}/cover`).set(as(A)).expect(404);

      const res = await upload(audio.id, await png());
      expect(res.status).toBe(200);
      expect(res.body.coverUrl).toMatch(new RegExp(`^/api/summaries/${audio.id}/cover\\?v=[0-9a-f]{8}$`));
      expect(res.body).not.toHaveProperty('coverKey');
      expect(coverKeys()).toHaveLength(1);
      expect(coverKeys()[0]).toContain(`audios/${A}/`);

      const img = await api().get(res.body.coverUrl).set(as(A)).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/jpeg');
      expect(img.headers['cache-control']).toContain('immutable');
      const meta = await sharp(img.body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 800, 600]);

      await api().get(res.body.coverUrl).set(as(USER_B)).expect(404);
      await api().get(res.body.coverUrl).expect(401);
      await upload(audio.id, await png(), USER_B).then((r) => expect(r.status).toBe(404));
    });

    it('rechaza archivos que no son una imagen válida, formatos no permitidos y archivos grandes', async () => {
      const audio = await ready();
      expect((await upload(audio.id, null)).status).toBe(400);
      expect((await upload(audio.id, Buffer.from('esto no es una imagen'))).status).toBe(400);
      // Un SVG (que podría contener scripts) o un GIF no se aceptan aunque sean imágenes.
      expect((await upload(audio.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), A, 'x.svg')).status).toBe(400);
      const gif = await sharp(await png(20, 20)).gif().toBuffer();
      expect((await upload(audio.id, gif, A, 'x.gif')).status).toBe(400);
      expect((await upload(audio.id, Buffer.alloc(1_000_001, 1))).status).toBe(413);
      expect(coverKeys()).toHaveLength(0);
      const after = await api().get(`/api/summaries/${audio.id}`).set(as(A));
      expect(after.body.coverUrl).toBeNull();
    });

    it('al reemplazar una portada la URL cambia y el objeto anterior se borra; al quitarla desaparece', async () => {
      const audio = await ready();
      const first = (await upload(audio.id, await png())).body.coverUrl;
      const [oldKey] = coverKeys();
      const second = (await upload(audio.id, await png(100, 100, '#3366cc'))).body.coverUrl;
      expect(second).not.toBe(first);
      expect(coverKeys()).toHaveLength(1);
      expect(coverKeys()[0]).not.toBe(oldKey);
      expect(storage.deleted).toContain(oldKey);

      await api().delete(`/api/summaries/${audio.id}/cover`).set(as(A)).expect(204);
      expect(coverKeys()).toHaveLength(0);
      expect((await api().get(`/api/summaries/${audio.id}`).set(as(A))).body.coverUrl).toBeNull();
      await api().delete(`/api/summaries/${audio.id}/cover`).set(as(A)).expect(204);
      await api().delete(`/api/summaries/${audio.id}/cover`).set(as(USER_B)).expect(404);
    });

    it('toma la portada incrustada del audio al completar la carga y también a petición', async () => {
      const withArt = await ready(A, mp3WithArt(await png(600, 600)));
      expect(withArt.coverUrl).not.toBeNull();
      expect(coverKeys()).toHaveLength(1);

      const plain = await ready();
      expect(plain.coverUrl).toBeNull();
      const none = await api().post(`/api/summaries/${plain.id}/cover/from-audio`).set(as(A));
      expect(none.status).toBe(400);

      // Un audio sin portada al completar puede recibirla después desde el propio archivo.
      const later = await ready(A, mp3WithArt(await png(300, 300)));
      await api().delete(`/api/summaries/${later.id}/cover`).set(as(A)).expect(204);
      const again = await api().post(`/api/summaries/${later.id}/cover/from-audio`).set(as(A));
      expect(again.status).toBe(200);
      expect(again.body.coverUrl).not.toBeNull();
      await api().post(`/api/summaries/${later.id}/cover/from-audio`).set(as(USER_B)).expect(404);
    });

    it('una portada incrustada ilegible no impide completar el audio', async () => {
      const audio = await ready(A, mp3WithArt(Buffer.from('basura que no es una imagen')));
      expect(audio.status).toBe('READY');
      expect(audio.coverUrl).toBeNull();
    });

    it('el borrado definitivo elimina también la portada, y la lista y el inicio la incluyen', async () => {
      const audio = await ready();
      await upload(audio.id, await png());
      const [coverKey] = coverKeys();
      const list = await api().get('/api/summaries').set(as(A));
      expect(list.body[0].coverUrl).toContain('/cover?v=');
      const home = await api().get('/api/home').set(as(A));
      expect(home.body.recent[0].coverUrl).toContain('/cover?v=');

      await api().delete(`/api/summaries/${audio.id}`).set(as(A)).expect(204);
      await api().delete(`/api/trash/${audio.id}`).set(as(A)).expect(204);
      expect(storage.deleted).toEqual(expect.arrayContaining([audio.s3Key, coverKey]));
      expect(coverKeys()).toHaveLength(0);
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
