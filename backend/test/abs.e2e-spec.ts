import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { sharedCategory } from './shared-category';
import { configureApp } from '../src/app.setup';
import { StorageService } from '../src/storage/storage.service';
import { FakeStorage, fixture } from './fake-storage';

const PASSWORD = 'contraseña-correcta-1';
const SAMPLE = fixture('sample.mp3');

/** Comprobaciones equivalentes a la decodificación estricta (Codable) de AudioBooth: tipos y campos obligatorios. */
const isInt = (v: unknown) => Number.isInteger(v);

function expectLibraryFile(file: any) {
  expect(typeof file.ino).toBe('string');
  for (const k of ['filename', 'ext', 'path', 'relPath']) expect(typeof file.metadata[k]).toBe('string');
  expect(isInt(file.metadata.size) && isInt(file.metadata.birthtimeMs)).toBe(true);
  expect(isInt(file.addedAt) && isInt(file.updatedAt)).toBe(true);
}

function expectBook(book: any, expanded = false) {
  expect(typeof book.id).toBe('string');
  expect(typeof book.libraryId).toBe('string');
  expect(isInt(book.addedAt) && isInt(book.updatedAt)).toBe(true);
  expect(typeof book.media.metadata.title).toBe('string');
  expect(typeof book.media.duration).toBe('number');
  expect(isInt(book.media.size)).toBe(true);
  for (const author of book.media.metadata.authors) expect([typeof author.id, typeof author.name]).toEqual(['string', 'string']);
  expect(Array.isArray(book.media.tags)).toBe(true);
  if (expanded) {
    expect(book.media.tracks).toHaveLength(1);
    const track = book.media.tracks[0];
    expect([typeof track.startOffset, typeof track.duration]).toEqual(['number', 'number']);
    expect(typeof track.contentUrl).toBe('string');
    book.libraryFiles.forEach(expectLibraryFile);
    book.media.audioFiles.forEach(expectLibraryFile);
  } else {
    expect(book.libraryFiles).toBeUndefined();
  }
}

function expectMediaProgress(p: any) {
  expect([typeof p.id, typeof p.libraryItemId, typeof p.progress, typeof p.currentTime, typeof p.isFinished]).toEqual([
    'string',
    'string',
    'number',
    'number',
    'boolean',
  ]);
  expect(isInt(p.startedAt) && isInt(p.lastUpdate)).toBe(true);
  expect(p.finishedAt === null || isInt(p.finishedAt)).toBe(true);
}

function expectAuthorize(body: any) {
  expect(typeof body.user.id).toBe('string');
  expect(Array.isArray(body.user.mediaProgress)).toBe(true);
  expect(Array.isArray(body.user.bookmarks)).toBe(true);
  for (const k of ['update', 'delete', 'download']) expect(typeof body.user.permissions[k]).toBe('boolean');
  expect(typeof body.serverSettings.id).toBe('string');
  expect(typeof body.serverSettings.version).toBe('string');
  expect(typeof body.serverSettings.sortingIgnorePrefix).toBe('boolean');
  expect(Array.isArray(body.ereaderDevices)).toBe(true);
  body.user.mediaProgress.forEach(expectMediaProgress);
}

describe('Compatibilidad con apps de Audiobookshelf (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: FakeStorage;
  let categoryId: string;
  const emails: string[] = [];
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const b64 = (value: string) => Buffer.from(value).toString('base64');

  async function createUser() {
    const email = `usuario${++counter}-${Date.now()}@abs.test`;
    emails.push(email);
    const user = await prisma.user.create({ data: { email, name: `Usuario ${counter}`, passwordHash: bcrypt.hashSync(PASSWORD, 4) } });
    return { ...user, email };
  }

  async function deviceLogin(email: string, password = PASSWORD) {
    const res = await api().post('/login').set('User-Agent', 'AudioBooth/1.0 (iPhone)').send({ username: email, password });
    return res;
  }

  async function tokenFor(email: string) {
    const res = await deviceLogin(email);
    expect(res.status).toBe(200);
    return res.body.user.token as string;
  }

  /** Inserta un audio listo (con su archivo en el S3 simulado) sin pasar por la API web. */
  async function addItem(userId: string, data: Record<string, unknown> = {}) {
    const id = crypto.randomUUID();
    const s3Key = `audios/${userId}/${id}/audio.mp3`;
    storage.objects.set(s3Key, SAMPLE);
    return prisma.summary.create({
      data: {
        id,
        userId,
        title: 'Hábitos atómicos',
        author: 'James Clear',
        categoryId,
        s3Key,
        originalFilename: 'habitos.mp3',
        sizeBytes: SAMPLE.length,
        contentType: 'audio/mpeg',
        status: 'READY',
        durationSeconds: 100,
        ...data,
      },
    });
  }

  beforeAll(async () => {
    storage = new FakeStorage();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useValue(storage).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
    categoryId = (await sharedCategory(prisma, 'Prueba')).id;
  });

  beforeEach(async () => {
    storage.objects.clear();
    storage.deleted = [];
    await prisma.summary.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.tag.deleteMany();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('conexión y login', () => {
    it('responde /ping y /status sin autenticación y anuncia la versión mínima que usan las apps', async () => {
      expect((await api().get('/ping')).body).toEqual({ success: true });
      const status = (await api().get('/status')).body;
      expect(status).toMatchObject({ isInit: true, app: 'bookreader', serverVersion: '2.22.0' });
      expect(status.authMethods).toContain('local');
      // Las rutas de las apps viven en la raíz, no bajo /api.
      await api().get('/api/status').expect(404);
      await api().get('/api/ping').expect(404);
    });

    it('entra con correo y contraseña y devuelve un token simple (sin access/refresh token)', async () => {
      const user = await createUser();
      const res = await deviceLogin(user.email.toUpperCase());
      expect(res.status).toBe(200);
      expectAuthorize(res.body);
      expect(res.body.user.token).toMatch(/^brt_[A-Za-z0-9_-]{40,}$/);
      expect(res.body.user).not.toHaveProperty('accessToken');
      expect(res.body.user).not.toHaveProperty('refreshToken');
      expect(res.body.user.permissions).toMatchObject({ download: true, update: false, delete: false, upload: false });
      expect(res.body.userDefaultLibraryId).toBe('lib_resumenes');
      expect(res.body.Source).toBe('bookreader');
      // En la base solo queda el hash del token.
      const rows = await prisma.apiToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].name).toContain('AudioBooth');
    });

    it('rechaza credenciales incorrectas con el mismo error y limita los intentos', async () => {
      const user = await createUser();
      const wrong = await deviceLogin(user.email, 'otra-contraseña-123');
      const unknown = await deviceLogin('nadie@abs.test');
      expect([wrong.status, unknown.status]).toEqual([401, 401]);
      expect(wrong.body.message).toBe(unknown.body.message);
      for (const body of [{}, { username: 'a' }, { username: 1, password: 2 }]) {
        expect((await api().post('/login').send(body)).status).toBe(400);
      }
      for (let i = 0; i < 6; i++) await deviceLogin(user.email, `mala-${i}-contraseña`);
      expect((await deviceLogin(user.email)).status).toBe(429);
    });

    it('/login con GET redirige a la pantalla web /entrar', async () => {
      const res = await api().get('/login');
      expect([res.status, res.headers.location]).toEqual([302, '/entrar']);
    });

    it('authorize y /api/me exigen el token y devuelven al usuario con su progreso', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      await api().post('/api/authorize').expect(401);
      const authorized = await api().post('/api/authorize').set(bearer(token));
      expect(authorized.status).toBe(200);
      expectAuthorize(authorized.body);
      expect(authorized.body.user.token).toBe(token);
      const me = await api().get('/api/me').set(bearer(token));
      expect(me.body).toMatchObject({ id: user.id, username: user.email, type: 'user' });
      await api().get('/api/me').set(bearer('brt_invalido')).expect(401);
    });

    it('el token solo vale para las rutas de las apps, no para la API web', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      for (const path of ['/api/summaries', `/api/summaries/${item.id}`, '/api/folders', '/api/home', '/api/auth/me']) {
        const res = await api().get(path).set(bearer(token));
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
      await api().delete(`/api/summaries/${item.id}`).set(bearer(token)).expect(403);
      expect((await api().get('/api/libraries').set(bearer(token))).status).toBe(200);
    });

    it('logout revoca el token y cambiar la contraseña revoca todos los dispositivos', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      expect((await api().post('/logout').set(bearer(token))).status).toBe(200);
      await api().get('/api/me').set(bearer(token)).expect(401);
      await api().post('/logout').set(bearer('brt_cualquiera')).expect(200);

      const other = await tokenFor(user.email);
      const web = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(web.status).toBe(200);
      const cookie = web.headers['set-cookie'];
      const changed = await api().post('/api/auth/password').set('Cookie', cookie).send({ current: PASSWORD, next: 'contraseña-nueva-123' });
      expect(changed.status).toBe(204);
      await api().get('/api/me').set(bearer(other)).expect(401);
    });

    it('lista y revoca los dispositivos vinculados solo desde la sesión web', async () => {
      const a = await createUser();
      const b = await createUser();
      const phone = await tokenFor(a.email);
      const tablet = await tokenFor(a.email);
      const others = await tokenFor(b.email);
      const web = await api().post('/api/auth/login').send({ email: a.email, password: PASSWORD });
      const cookie = web.headers['set-cookie'];

      const list = await api().get('/api/auth/devices').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(Object.keys(list.body[0]).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name']);
      expect(list.body[0].name).toContain('AudioBooth');

      // Un token de dispositivo no puede gestionar dispositivos.
      await api().get('/api/auth/devices').set(bearer(phone)).expect(403);
      await api().get('/api/auth/devices').expect(401);

      const [first] = list.body;
      await api().delete(`/api/auth/devices/${first.id}`).set('Cookie', cookie).expect(204);
      await api().delete(`/api/auth/devices/${first.id}`).set('Cookie', cookie).expect(404);
      const bDevice = (await prisma.apiToken.findFirstOrThrow({ where: { userId: b.id } })).id;
      await api().delete(`/api/auth/devices/${bDevice}`).set('Cookie', cookie).expect(404);
      expect((await api().get('/api/me').set(bearer(others))).status).toBe(200);
      // Se revocó exactamente uno de los dos dispositivos de este usuario.
      const statuses = await Promise.all([phone, tablet].map(async (t) => (await api().get('/api/me').set(bearer(t))).status));
      expect(statuses.sort()).toEqual([200, 401]);

      await api().delete('/api/auth/devices').set('Cookie', cookie).expect(204);
      expect((await api().get('/api/auth/devices').set('Cookie', cookie)).body).toEqual([]);
      expect((await api().get('/api/me').set(bearer(others))).status).toBe(200);
    });

    it('guarda como máximo 20 tokens por usuario', async () => {
      const user = await createUser();
      for (let i = 0; i < 22; i++) await tokenFor(user.email);
      expect(await prisma.apiToken.count({ where: { userId: user.id } })).toBe(20);
    });
  });

  describe('biblioteca', () => {
    it('lista una biblioteca y valida la forma de los elementos', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      await addItem(user.id, { narrator: 'Ana Pérez', description: 'Un libro' });
      const libs = (await api().get('/api/libraries').set(bearer(token))).body.libraries;
      expect(libs).toHaveLength(1);
      expect(libs[0]).toMatchObject({ id: 'lib_resumenes', mediaType: 'book' });
      await api().get('/api/libraries/otra').set(bearer(token)).expect(404);

      const page = (await api().get('/api/libraries/lib_resumenes/items?limit=10&page=0&minified=1').set(bearer(token))).body;
      expect([page.total, page.page, page.results.length]).toEqual([1, 0, 1]);
      expectBook(page.results[0]);
      expect(page.results[0].media.metadata).toMatchObject({ title: 'Hábitos atómicos', authorName: 'James Clear', narratorName: 'Ana Pérez', genres: ['Prueba'] });
    });

    it('pagina, ordena y filtra como piden las apps (filtros en base64)', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const a = await addItem(user.id, { title: 'Bravo', author: 'Ana', createdAt: new Date('2026-01-01') });
      const b = await addItem(user.id, { title: 'alfa', author: 'Zoe', createdAt: new Date('2026-01-02') });
      const c = await addItem(user.id, { title: 'Charlie', author: 'Ana', createdAt: new Date('2026-01-03') });
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: a.id, positionSeconds: 30 } });
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: c.id, positionSeconds: 100, completed: true } });
      const tag = await prisma.tag.create({ data: { userId: user.id, name: 'Negocios' } });
      await prisma.summaryTag.create({ data: { summaryId: b.id, tagId: tag.id } });
      const list = async (query: string) => {
        const res = await api().get(`/api/libraries/lib_resumenes/items?${query}`).set(bearer(token));
        expect(res.status).toBe(200);
        return res.body.results.map((r: any) => r.media.metadata.title);
      };

      expect(await list('sort=media.metadata.title')).toEqual(['alfa', 'Bravo', 'Charlie']);
      expect(await list('sort=media.metadata.title&desc=1')).toEqual(['Charlie', 'Bravo', 'alfa']);
      expect(await list('sort=addedAt&desc=1')).toEqual(['Charlie', 'alfa', 'Bravo']);
      expect(await list('sort=media.metadata.authorName')).toEqual(['Bravo', 'Charlie', 'alfa']);
      expect(await list('sort=addedAt&limit=2&page=1')).toEqual(['Charlie']);
      const paged = (await api().get('/api/libraries/lib_resumenes/items?sort=addedAt&limit=2&page=1').set(bearer(token))).body;
      expect([paged.total, paged.limit, paged.page]).toEqual([3, 2, 1]);

      expect(await list(`filter=progress.${b64('finished')}&sort=addedAt`)).toEqual(['Charlie']);
      expect(await list(`filter=progress.${b64('in-progress')}`)).toEqual(['Bravo']);
      expect(await list(`filter=progress.${b64('not-started')}`)).toEqual(['alfa']);
      expect(await list(`filter=progress.${b64('not-finished')}&sort=addedAt`)).toEqual(['Bravo', 'alfa']);
      expect(await list(`filter=genres.${b64('prueba')}&sort=addedAt`)).toHaveLength(3);
      expect(await list(`filter=genres.${b64('Otro')}`)).toEqual([]);
      expect(await list(`filter=tags.${b64('negocios')}`)).toEqual(['alfa']);
      const authorId = (await api().get('/api/libraries/lib_resumenes/authors').set(bearer(token))).body.authors.find((x: any) => x.name === 'Ana').id;
      expect(await list(`filter=authors.${b64(authorId)}&sort=addedAt`)).toEqual(['Bravo', 'Charlie']);
      expect(await list(`filter=series.${b64('x')}`)).toEqual([]);
    });

    it('no mezcla usuarios ni incluye audios en la papelera o pendientes', async () => {
      const a = await createUser();
      const b = await createUser();
      const tokenA = await tokenFor(a.email);
      const mine = await addItem(a.id, { title: 'Mío' });
      await addItem(a.id, { title: 'Papelera', deletedAt: new Date() });
      await addItem(a.id, { title: 'Pendiente', status: 'PENDING' });
      const theirs = await addItem(b.id, { title: 'Ajeno' });
      const items = (await api().get('/api/libraries/lib_resumenes/items').set(bearer(tokenA))).body;
      expect(items.results.map((r: any) => r.id)).toEqual([mine.id]);
      await api().get(`/api/items/${theirs.id}`).set(bearer(tokenA)).expect(404);
      await api().post(`/api/items/${theirs.id}/play`).set(bearer(tokenA)).send({}).expect(404);
      await api().get(`/api/items/${theirs.id}/cover?token=${tokenA}`).expect(404);
    });

    it('el detalle expandido trae pistas y archivos; sin expanded es la versión mínima', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      const full = (await api().get(`/api/items/${item.id}?expanded=1&include=progress`).set(bearer(token))).body;
      expectBook(full, true);
      expect(full.media.tracks[0].mimeType).toBe('audio/mpeg');
      const minimal = (await api().get(`/api/items/${item.id}`).set(bearer(token))).body;
      expect(minimal.media.audioFiles).toBeUndefined();
      await api().get('/api/items/inexistente').set(bearer(token)).expect(404);
      const batch = await api().post('/api/items/batch/get').set(bearer(token)).send({ libraryItemIds: [item.id, 'x'] });
      expect(batch.body.libraryItems.map((i: any) => i.id)).toEqual([item.id]);
    });

    it('arma las estanterías de inicio, la búsqueda, los filtros disponibles, autores y narradores', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const reading = await addItem(user.id, { title: 'Leyendo', narrator: 'Ana Pérez' });
      const done = await addItem(user.id, { title: 'Terminado' });
      await addItem(user.id, { title: 'Nuevo', author: 'Otra Autora' });
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: reading.id, positionSeconds: 20 } });
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: done.id, positionSeconds: 100, completed: true } });

      const shelves = (await api().get('/api/libraries/lib_resumenes/personalized?limit=10').set(bearer(token))).body;
      expect(shelves.map((s: any) => [s.id, s.type, s.entities.map((e: any) => e.media.metadata.title)])).toEqual([
        ['continue-listening', 'book', ['Leyendo']],
        ['recently-added', 'book', expect.arrayContaining(['Leyendo', 'Terminado', 'Nuevo'])],
        ['listen-again', 'book', ['Terminado']],
      ]);
      shelves.forEach((s: any) => s.entities.forEach((e: any) => expectBook(e)));

      const search = (await api().get('/api/libraries/lib_resumenes/search?q=leyen').set(bearer(token))).body;
      expect(search.book.map((b: any) => b.libraryItem.media.metadata.title)).toEqual(['Leyendo']);
      expectBook(search.book[0].libraryItem);
      expect((await api().get('/api/libraries/lib_resumenes/search?q=ana').set(bearer(token))).body.narrators).toEqual([{ name: 'Ana Pérez', numBooks: 1 }]);

      const filter = (await api().get('/api/libraries/lib_resumenes?include=filterdata').set(bearer(token))).body.filterdata;
      expect(filter).toMatchObject({ genres: ['Prueba'], narrators: ['Ana Pérez'], series: [], languages: [], publishers: [], publishedDecades: [] });
      expect(filter.authors.map((a: any) => a.name)).toEqual(['James Clear', 'Otra Autora']);

      const authors = (await api().get('/api/libraries/lib_resumenes/authors').set(bearer(token))).body;
      expect(authors.authors.map((a: any) => [a.name, a.numBooks])).toEqual([['James Clear', 2], ['Otra Autora', 1]]);
      const author = (await api().get(`/api/authors/${authors.authors[0].id}`).set(bearer(token))).body;
      expect([author.name, author.libraryItems.length, isInt(author.addedAt)]).toEqual(['James Clear', 2, true]);
      await api().get('/api/authors/aut_noexiste').set(bearer(token)).expect(404);

      const narrators = (await api().get('/api/libraries/lib_resumenes/narrators').set(bearer(token))).body.narrators;
      expect(narrators.map((n: any) => [n.name, n.numBooks])).toEqual([['Ana Pérez', 1]]);
      for (const path of ['series', 'collections', 'playlists']) {
        const res = (await api().get(`/api/libraries/lib_resumenes/${path}`).set(bearer(token))).body;
        expect([path, res.results, res.total, res.page]).toEqual([path, [], 0, 0]);
      }
    });
  });

  describe('reproducción', () => {
    async function play(token: string, itemId: string, body: object = {}) {
      const res = await api().post(`/api/items/${itemId}/play`).set(bearer(token)).send({
        deviceInfo: { clientName: 'AudioBooth', deviceId: 'abc', model: 'iPhone' },
        forceDirectPlay: true,
        mediaPlayer: 'ios',
        supportedMimeTypes: ['audio/mpeg', 'audio/mp4'],
        ...body,
      });
      expect(res.status).toBe(200);
      return res.body;
    }

    it('abre una sesión con pistas que apuntan a la URL pública del audio', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: item.id, positionSeconds: 42 } });
      const session = await play(token, item.id);
      expect(session).toMatchObject({ libraryItemId: item.id, mediaType: 'book', currentTime: 42, startTime: 42, duration: 100, displayTitle: 'Hábitos atómicos' });
      expect(typeof session.id).toBe('string');
      expect(isInt(session.startedAt)).toBe(true);
      expect(session.audioTracks).toHaveLength(1);
      expect(session.audioTracks[0]).toMatchObject({ index: 1, startOffset: 0, duration: 100, mimeType: 'audio/mpeg', contentUrl: `/public/session/${session.id}/track/1` });
      expectBook(session.libraryItem, true);
      expect(await prisma.playSession.count({ where: { userId: user.id } })).toBe(1);
    });

    it('un audio terminado empieza desde el principio', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await prisma.playbackProgress.create({ data: { userId: user.id, summaryId: item.id, positionSeconds: 99, completed: true } });
      expect((await play(token, item.id)).currentTime).toBe(0);
    });

    it('sirve el audio sin cabeceras de autorización, con soporte de Range', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      const session = await play(token, item.id);
      const url = session.audioTracks[0].contentUrl;
      const binary = (req: request.Test) => req.buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

      const full = await binary(api().get(url));
      expect(full.status).toBe(200);
      expect(full.headers['content-type']).toBe('audio/mpeg');
      expect(full.headers['accept-ranges']).toBe('bytes');
      expect(full.headers['content-length']).toBe(String(SAMPLE.length));
      expect(Buffer.compare(full.body, SAMPLE)).toBe(0);

      const part = await binary(api().get(url).set('Range', 'bytes=10-99'));
      expect(part.status).toBe(206);
      expect(part.headers['content-range']).toBe(`bytes 10-99/${SAMPLE.length}`);
      expect(part.headers['content-length']).toBe('90');
      expect(Buffer.compare(part.body, SAMPLE.subarray(10, 100))).toBe(0);

      const open = await binary(api().get(url).set('Range', 'bytes=100-'));
      expect([open.status, open.body.length]).toEqual([206, SAMPLE.length - 100]);
      const suffix = await binary(api().get(url).set('Range', 'bytes=-20'));
      expect([suffix.status, suffix.body.length]).toEqual([206, 20]);

      expect((await api().get(url).set('Range', `bytes=${SAMPLE.length + 10}-`)).status).toBe(416);
      // Una forma de rango no soportada se ignora y se envía completo.
      expect((await binary(api().get(url).set('Range', 'bytes=0-1,5-6'))).status).toBe(200);
      const head = await api().head(url);
      expect([head.status, head.headers['content-length']]).toEqual([200, String(SAMPLE.length)]);
    });

    it('la URL pública no sirve con sesiones inexistentes, índices ajenos ni audios que ya no existen', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      const session = await play(token, item.id);
      await api().get(`/public/session/${crypto.randomUUID()}/track/1`).expect(404);
      await api().get('/public/session/no-es-uuid/track/1').expect(400);
      await api().get(`/public/session/${session.id}/track/2`).expect(404);
      await api().get(`/api/public/session/${session.id}/track/1`).expect(404);

      // Caduca.
      await prisma.playSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await api().get(`/public/session/${session.id}/track/1`).expect(404);
      const fresh = await play(token, item.id);
      await api().get(`/public/session/${fresh.id}/track/1`).expect(200);
      // Al mandar el audio a la papelera la URL deja de servir.
      await prisma.summary.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
      await api().get(`/public/session/${fresh.id}/track/1`).expect(404);
    });

    it('conserva como máximo 50 sesiones por usuario', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      for (let i = 0; i < 52; i++) await play(token, item.id);
      expect(await prisma.playSession.count({ where: { userId: user.id } })).toBe(50);
    });

    it('sync y close guardan la posición, visible también en la web, y solo en sesiones propias', async () => {
      const a = await createUser();
      const b = await createUser();
      const tokenA = await tokenFor(a.email);
      const tokenB = await tokenFor(b.email);
      const item = await addItem(a.id);
      const session = await play(tokenA, item.id);

      const sync = await api().post(`/api/session/${session.id}/sync`).set(bearer(tokenA)).send({ currentTime: 33.4, timeListened: 12, duration: 100 });
      expect(sync.status).toBe(200);
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(tokenA))).body).toMatchObject({ currentTime: 33, isFinished: false });
      const web = await api().post('/api/auth/login').send({ email: a.email, password: PASSWORD });
      const detail = await api().get(`/api/summaries/${item.id}`).set('Cookie', web.headers['set-cookie']);
      expect(detail.body.progress.positionSeconds).toBe(33);

      await api().post(`/api/session/${session.id}/sync`).set(bearer(tokenB)).send({ currentTime: 5 }).expect(404);
      await api().post(`/api/session/${crypto.randomUUID()}/sync`).set(bearer(tokenA)).send({ currentTime: 5 }).expect(404);
      await api().post(`/api/session/${session.id}/sync`).send({ currentTime: 5 }).expect(401);
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(tokenA))).body.currentTime).toBe(33);

      // Llegar al 95 % termina el audio; cerrar guarda la última posición y la URL sigue sirviendo.
      const close = await api().post(`/api/session/${session.id}/close`).set(bearer(tokenA)).send({ currentTime: 97, timeListened: 4 });
      expect(close.status).toBe(200);
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(tokenA))).body).toMatchObject({ currentTime: 97, isFinished: true, progress: 1 });
      await api().get(`/public/session/${session.id}/track/1`).expect(200);
    });
  });

  describe('progreso', () => {
    it('lista el progreso, lo actualiza con PATCH y lo borra', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await api().get(`/api/me/progress/${item.id}`).set(bearer(token)).expect(404);
      expect((await api().get('/api/me/progress').set(bearer(token))).body).toEqual({ mediaProgress: [] });

      const patch = (body: object) => api().patch(`/api/me/progress/${item.id}`).set(bearer(token)).send(body);
      expect((await patch({ currentTime: 25, duration: 100, progress: 0.25, isFinished: false })).status).toBe(200);
      const progress = (await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body;
      expectMediaProgress(progress);
      expect(progress).toMatchObject({ id: item.id, libraryItemId: item.id, currentTime: 25, isFinished: false, duration: 100, progress: 0.25, hideFromContinueListening: false });
      const all = (await api().get('/api/me/progress').set(bearer(token))).body.mediaProgress;
      expect(all).toHaveLength(1);
      all.forEach(expectMediaProgress);

      // Solo "progress" y duración también cuentan.
      await patch({ progress: 0.5, duration: 100 });
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body.currentTime).toBe(50);

      expect((await patch({ isFinished: true })).status).toBe(200);
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body).toMatchObject({ isFinished: true, progress: 1, currentTime: 100 });
      // Una app que manda isFinished:false con la posición al final no anula el estado terminado.
      await patch({ currentTime: 99, isFinished: false });
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body.isFinished).toBe(true);
      // ...pero si vuelve a una posición anterior, sí lo reinicia.
      await patch({ currentTime: 10, isFinished: false });
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body).toMatchObject({ isFinished: false, currentTime: 10 });

      expect((await api().delete(`/api/me/progress/${item.id}`).set(bearer(token))).status).toBe(200);
      await api().get(`/api/me/progress/${item.id}`).set(bearer(token)).expect(404);
      await api().patch('/api/me/progress/inexistente').set(bearer(token)).send({ currentTime: 1 }).expect(404);
    });

    it('actualiza varios a la vez y ajusta posiciones fuera de rango', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const one = await addItem(user.id);
      const two = await addItem(user.id);
      const res = await api().patch('/api/me/progress/batch/update').set(bearer(token)).send([
        { libraryItemId: one.id, currentTime: 10 },
        { libraryItemId: two.id, currentTime: -5 },
        { nada: true },
      ]);
      expect(res.status).toBe(200);
      const all = (await api().get('/api/me/progress').set(bearer(token))).body.mediaProgress;
      expect(Object.fromEntries(all.map((p: any) => [p.libraryItemId, p.currentTime]))).toEqual({ [one.id]: 10, [two.id]: 0 });
      await api().patch('/api/me/progress/batch/update').set(bearer(token)).send({ no: 'lista' }).expect(400);
    });

    it('"continuar escuchando" incluye lo empezado, se puede ocultar y vuelve al avanzar', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await api().patch(`/api/me/progress/${item.id}`).set(bearer(token)).send({ currentTime: 20 }).expect(200);
      const inProgress = async () => (await api().get('/api/me/items-in-progress').set(bearer(token))).body.libraryItems.map((i: any) => i.id);
      expect(await inProgress()).toEqual([item.id]);
      const shelf = async () => (await api().get('/api/libraries/lib_resumenes/personalized').set(bearer(token))).body.find((s: any) => s.id === 'continue-listening');

      expect((await api().get(`/api/me/progress/${item.id}/remove-from-continue-listening`).set(bearer(token))).status).toBe(200);
      expect(await inProgress()).toEqual([]);
      expect(await shelf()).toBeUndefined();
      expect((await api().get(`/api/me/progress/${item.id}`).set(bearer(token))).body.hideFromContinueListening).toBe(true);
      // También desaparece del inicio de la web.
      const web = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect((await api().get('/api/home').set('Cookie', web.headers['set-cookie'])).body.continueListening).toEqual([]);

      await api().patch(`/api/me/progress/${item.id}`).set(bearer(token)).send({ currentTime: 30 }).expect(200);
      expect(await inProgress()).toEqual([item.id]);
    });

    it('aplica el progreso grabado sin conexión solo si es más reciente que lo guardado', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await api().patch(`/api/me/progress/${item.id}`).set(bearer(token)).send({ currentTime: 50 }).expect(200);
      const current = () => api().get(`/api/me/progress/${item.id}`).set(bearer(token)).then((r) => r.body.currentTime);

      const old = await api().post('/api/session/local').set(bearer(token)).send({ id: 'local-1', libraryItemId: item.id, currentTime: 70, timeListening: 20, duration: 100, updatedAt: Date.now() - 3600_000 });
      expect(old.body).toMatchObject({ id: 'local-1', success: true, progressSynced: false });
      expect(await current()).toBe(50);

      const recent = await api().post('/api/session/local').set(bearer(token)).send({ id: 'local-2', libraryItemId: item.id, currentTime: 60, updatedAt: Date.now() + 1000 });
      expect(recent.body).toMatchObject({ success: true, progressSynced: true });
      expect(await current()).toBe(60);

      const bulk = await api().post('/api/session/local-all').set(bearer(token)).send({
        deviceInfo: { deviceId: 'abc' },
        sessions: [
          { id: 's1', libraryItemId: item.id, currentTime: 80, updatedAt: Date.now() + 2000 },
          { id: 's2', libraryItemId: 'inexistente', currentTime: 1 },
          { id: 's3' },
        ],
      });
      expect(bulk.status).toBe(200);
      expect(bulk.body.results.map((r: any) => [r.id, r.success])).toEqual([['s1', true], ['s2', false], ['s3', false]]);
      expect(await current()).toBe(80);
      const tooMany = Array.from({ length: 201 }, (_, i) => ({ id: `x${i}`, libraryItemId: item.id, currentTime: 1 }));
      await api().post('/api/session/local-all').set(bearer(token)).send({ sessions: tooMany }).expect(400);
    });

    it('responde vacíos el historial y las estadísticas', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      expect((await api().get('/api/me/listening-sessions?page=0&itemsPerPage=10').set(bearer(token))).body).toMatchObject({ total: 0, sessions: [], numPages: 0 });
      expect((await api().get(`/api/me/item/listening-sessions/${item.id}`).set(bearer(token))).body.sessions).toEqual([]);
      expect((await api().get('/api/me/listening-stats').set(bearer(token))).body).toMatchObject({ totalTime: 0 });
    });
  });

  describe('marcadores', () => {
    const isBookmark = (b: any) => expect([typeof b.libraryItemId, typeof b.title, typeof b.time, isInt(b.createdAt)]).toEqual(['string', 'string', 'number', true]);

    it('crea, lista, edita y borra marcadores por su posición', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      const create = (body: object) => api().post(`/api/me/item/${item.id}/bookmark`).set(bearer(token)).send(body);

      const created = await create({ time: 120.5, title: '  Capítulo 2  ' });
      expect(created.status).toBe(200);
      isBookmark(created.body);
      expect(created.body).toMatchObject({ libraryItemId: item.id, time: 120.5, title: 'Capítulo 2' });
      await create({ time: 30, title: 'Inicio' }).expect(200);
      expect((await create({ time: 30, title: 'Otra vez' })).status).toBe(400);
      expect((await create({ time: 45 })).body.title).toBe('Marcador');
      for (const bad of [{ title: 'x' }, { time: -1, title: 'x' }, { time: 'a', title: 'x' }, { time: 9e9, title: 'x' }, { time: 1, title: 'x'.repeat(256) }]) {
        expect({ bad, status: (await create(bad)).status }).toEqual({ bad, status: 400 });
      }

      const all = (await api().get('/api/me/bookmarks').set(bearer(token))).body.bookmarks;
      expect(all.map((b: any) => [b.time, b.title])).toEqual([[30, 'Inicio'], [45, 'Marcador'], [120.5, 'Capítulo 2']]);
      all.forEach(isBookmark);
      expect((await api().get(`/api/me/bookmarks/${item.id}`).set(bearer(token))).body.bookmarks).toHaveLength(3);
      // También viajan en el usuario (login, authorize y /api/me).
      expect((await api().get('/api/me').set(bearer(token))).body.bookmarks).toHaveLength(3);
      expect((await deviceLogin(user.email)).body.user.bookmarks).toHaveLength(3);

      const renamed = await api().patch(`/api/me/item/${item.id}/bookmark`).set(bearer(token)).send({ time: 120.5, title: 'Capítulo dos' });
      expect([renamed.status, renamed.body.title]).toEqual([200, 'Capítulo dos']);
      await api().patch(`/api/me/item/${item.id}/bookmark`).set(bearer(token)).send({ time: 99, title: 'x' }).expect(404);

      expect((await api().delete(`/api/me/item/${item.id}/bookmark/120.5`).set(bearer(token))).status).toBe(200);
      await api().delete(`/api/me/item/${item.id}/bookmark/120.5`).set(bearer(token)).expect(404);
      await api().delete(`/api/me/item/${item.id}/bookmark/abc`).set(bearer(token)).expect(400);
      expect((await api().get('/api/me/bookmarks').set(bearer(token))).body.bookmarks.map((b: any) => b.time)).toEqual([30, 45]);
    });

    it('limita los marcadores por audio, no cruza usuarios y desaparece con el audio', async () => {
      const a = await createUser();
      const b = await createUser();
      const tokenA = await tokenFor(a.email);
      const tokenB = await tokenFor(b.email);
      const item = await addItem(a.id);
      await prisma.bookmark.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ userId: a.id, summaryId: item.id, timeSeconds: i, title: `m${i}` })) });
      expect((await api().post(`/api/me/item/${item.id}/bookmark`).set(bearer(tokenA)).send({ time: 500, title: 'x' })).status).toBe(400);

      expect((await api().post(`/api/me/item/${item.id}/bookmark`).set(bearer(tokenB)).send({ time: 1, title: 'x' })).status).toBe(404);
      expect((await api().get('/api/me/bookmarks').set(bearer(tokenB))).body.bookmarks).toEqual([]);

      // En la papelera no aparecen; al borrarlo definitivamente se eliminan con él.
      await prisma.summary.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
      expect((await api().get('/api/me/bookmarks').set(bearer(tokenA))).body.bookmarks).toEqual([]);
      await prisma.summary.delete({ where: { id: item.id } });
      expect(await prisma.bookmark.count({ where: { userId: a.id } })).toBe(0);
    });
  });

  describe('colecciones (carpetas)', () => {
    const isCollection = (c: any) => {
      expect([typeof c.id, typeof c.name, typeof c.libraryId, isInt(c.lastUpdate), isInt(c.createdAt)]).toEqual(['string', 'string', 'string', true, true]);
      c.books.forEach((b: any) => expectBook(b));
    };

    it('ofrece las carpetas con audios como colecciones de solo lectura', async () => {
      const user = await createUser();
      const other = await createUser();
      const token = await tokenFor(user.email);
      const negocios = await prisma.folder.create({ data: { userId: user.id, name: 'Negocios' } });
      const ventas = await prisma.folder.create({ data: { userId: user.id, name: 'Ventas', parentId: negocios.id } });
      await prisma.folder.create({ data: { userId: user.id, name: 'Vacía' } });
      await prisma.folder.create({ data: { userId: other.id, name: 'Ajena' } });
      await addItem(user.id, { title: 'En negocios', folderId: negocios.id });
      await addItem(user.id, { title: 'En ventas', folderId: ventas.id });
      await addItem(user.id, { title: 'En papelera', folderId: ventas.id, deletedAt: new Date() });
      await addItem(user.id, { title: 'Sin carpeta' });

      const page = (await api().get('/api/libraries/lib_resumenes/collections').set(bearer(token))).body;
      expect([page.total, page.page]).toEqual([2, 0]);
      page.results.forEach(isCollection);
      expect(page.results.map((c: any) => [c.name, c.books.map((b: any) => b.media.metadata.title)])).toEqual([
        ['Negocios', ['En negocios']],
        ['Negocios › Ventas', ['En ventas']],
      ]);
      expect((await api().get('/api/collections').set(bearer(token))).body.collections).toHaveLength(2);
      const one = (await api().get(`/api/collections/${ventas.id}`).set(bearer(token))).body;
      isCollection(one);
      expect(one.name).toBe('Negocios › Ventas');
      await api().get('/api/collections/inexistente').set(bearer(token)).expect(404);
      const otherToken = await tokenFor(other.email);
      await api().get(`/api/collections/${ventas.id}`).set(bearer(otherToken)).expect(404);
    });
  });

  describe('descargas sin conexión', () => {
    const binary = (req: request.Test) => req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    it('las pistas del detalle traen el ino con el que las apps piden el archivo', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      const full = (await api().get(`/api/items/${item.id}?expanded=1`).set(bearer(token))).body;
      const track = full.media.tracks[0];
      expect(track.ino).toMatch(/^\d+$/);
      expect(track.ino).toBe(full.media.audioFiles[0].ino);
      expect(track.contentUrl).toBe(`/api/items/${item.id}/file/${track.ino}`);
      expect(track.metadata.size).toBe(SAMPLE.length);
    });

    it('descarga el archivo con Bearer o ?token=, con Range y como adjunto en /download', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id, { originalFilename: 'Hábitos atómicos.mp3' });
      const ino = (await api().get(`/api/items/${item.id}?expanded=1`).set(bearer(token))).body.media.tracks[0].ino;
      const url = `/api/items/${item.id}/file/${ino}`;

      const viaBearer = await binary(api().get(url).set(bearer(token)));
      expect([viaBearer.status, viaBearer.headers['content-type'], Buffer.compare(viaBearer.body, SAMPLE)]).toEqual([200, 'audio/mpeg', 0]);
      expect(viaBearer.headers['content-disposition']).toBeUndefined();

      const viaQuery = await binary(api().get(`${url}?token=${token}`));
      expect([viaQuery.status, Buffer.compare(viaQuery.body, SAMPLE)]).toEqual([200, 0]);

      const part = await binary(api().get(`${url}?token=${token}`).set('Range', 'bytes=0-99'));
      expect([part.status, part.headers['content-range'], part.body.length]).toEqual([206, `bytes 0-99/${SAMPLE.length}`, 100]);

      const download = await api().get(`${url}/download`).set(bearer(token));
      expect(download.status).toBe(200);
      expect(download.headers['content-disposition']).toBe("attachment; filename*=UTF-8''H%C3%A1bitos%20at%C3%B3micos.mp3");
      expect((await api().get(`${url}/download?token=${token}`)).status).toBe(200);
      expect((await api().head(`${url}?token=${token}`)).headers['content-length']).toBe(String(SAMPLE.length));
    });

    it('exige autenticación, el ino correcto y un audio propio y disponible', async () => {
      const a = await createUser();
      const b = await createUser();
      const tokenA = await tokenFor(a.email);
      const tokenB = await tokenFor(b.email);
      const item = await addItem(a.id);
      const ino = (await api().get(`/api/items/${item.id}?expanded=1`).set(bearer(tokenA))).body.media.tracks[0].ino;
      const url = `/api/items/${item.id}/file/${ino}`;

      await api().get(url).expect(401);
      await api().get(`${url}?token=brt_falso`).expect(401);
      await api().get(`/api/items/${item.id}/file/999`).set(bearer(tokenA)).expect(404);
      await api().get(url).set(bearer(tokenB)).expect(404);
      await api().get(`${url}?token=${tokenB}`).expect(404);
      expect((await api().get(url).set(bearer(tokenA)).set('Range', `bytes=${SAMPLE.length + 5}-`)).status).toBe(416);
      await prisma.summary.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
      await api().get(url).set(bearer(tokenA)).expect(404);
    });
  });

  describe('portadas', () => {
    it('sirve la portada con Bearer o con ?token= solo en ese endpoint', async () => {
      const user = await createUser();
      const token = await tokenFor(user.email);
      const item = await addItem(user.id);
      await api().get(`/api/items/${item.id}/cover`).set(bearer(token)).expect(404);
      expect((await api().get(`/api/items/${item.id}`).set(bearer(token))).body.media.coverPath).toBeNull();

      const key = `audios/${user.id}/${item.id}/cover-0a1b2c3d.jpg`;
      storage.objects.set(key, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      await prisma.summary.update({ where: { id: item.id }, data: { coverKey: key } });
      expect((await api().get(`/api/items/${item.id}`).set(bearer(token))).body.media.coverPath).toContain(item.id);

      const viaBearer = await api().get(`/api/items/${item.id}/cover`).set(bearer(token));
      expect([viaBearer.status, viaBearer.headers['content-type']]).toEqual([200, 'image/jpeg']);
      expect((await api().get(`/api/items/${item.id}/cover?token=${token}&width=400&ts=1`)).status).toBe(200);
      // El token en la URL no abre ningún otro endpoint.
      await api().get(`/api/items/${item.id}?token=${token}`).expect(401);
      await api().get(`/api/libraries?token=${token}`).expect(401);
      await api().get(`/api/items/${item.id}/cover?token=brt_falso`).expect(401);
    });
  });
});
