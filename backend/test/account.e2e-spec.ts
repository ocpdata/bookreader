import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as request from 'supertest';
import { AccountEraser } from '../src/accounts/account-eraser';
import { AppModule } from '../src/app.module';
import { sharedCategory } from './shared-category';
import { configureApp } from '../src/app.setup';
import { TERMS_VERSION } from '../src/auth/registration.config';
import { DEFAULT_USER_ID } from '../src/auth/user.constants';
import { MailMessage, MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { FakeStorage } from './fake-storage';

const PASSWORD = 'una-contraseña-segura-1';

describe('Cuenta: eliminación y términos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: FakeStorage;
  let outbox: MailMessage[];
  let categoryId: string;
  let counter = 0;

  const api = () => request(app.getHttpServer());

  async function createUser(data: Record<string, unknown> = {}) {
    const email = `cuenta${++counter}-${Date.now()}@del.test`;
    return prisma.user.create({
      data: { email, name: `Persona ${counter}`, passwordHash: bcrypt.hashSync(PASSWORD, 4), termsVersion: TERMS_VERSION, termsAcceptedAt: new Date(), ...data },
    });
  }

  async function webLogin(email: string, password = PASSWORD) {
    const res = await api().post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  /** Una cuenta con de todo: carpetas anidadas, audios (con portada, en la papelera y pendiente), etiquetas, progreso... */
  async function populate(userId: string) {
    const root = await prisma.folder.create({ data: { userId, name: 'Raíz' } });
    const child = await prisma.folder.create({ data: { userId, name: 'Hijo', parentId: root.id } });
    await prisma.folder.create({ data: { userId, name: 'Nieto', parentId: child.id } });
    const keys: string[] = [];
    const make = async (title: string, extra: Record<string, unknown> = {}, withCover = false) => {
      const id = crypto.randomUUID();
      const s3Key = `audios/${userId}/${id}/audio.mp3`;
      const coverKey = withCover ? `audios/${userId}/${id}/cover-0a1b2c3d.jpg` : null;
      keys.push(s3Key, ...(coverKey ? [coverKey] : []));
      storage.objects.set(s3Key, Buffer.from('audio'));
      if (coverKey) storage.objects.set(coverKey, Buffer.from('img'));
      return prisma.summary.create({
        data: { id, userId, title, author: 'Autor', categoryId, s3Key, coverKey, originalFilename: 'a.mp3', sizeBytes: 5, contentType: 'audio/mpeg', status: 'READY', durationSeconds: 60, folderId: child.id, ...extra },
      });
    };
    const live = await make('Vivo', {}, true);
    await make('En la papelera', { deletedAt: new Date() });
    await make('Pendiente', { status: 'PENDING' });
    const tag = await prisma.tag.create({ data: { userId, name: 'Etiqueta' } });
    await prisma.summaryTag.create({ data: { summaryId: live.id, tagId: tag.id } });
    await prisma.favorite.create({ data: { userId, summaryId: live.id } });
    await prisma.playbackProgress.create({ data: { userId, summaryId: live.id, positionSeconds: 10 } });
    await prisma.bookmark.create({ data: { userId, summaryId: live.id, timeSeconds: 5, title: 'm' } });
    await prisma.playSession.create({ data: { userId, summaryId: live.id, expiresAt: new Date(Date.now() + 3600_000) } });
    return keys;
  }

  const rowsOf = async (userId: string) => ({
    users: await prisma.user.count({ where: { id: userId } }),
    summaries: await prisma.summary.count({ where: { userId } }),
    folders: await prisma.folder.count({ where: { userId } }),
    tags: await prisma.tag.count({ where: { userId } }),
    favorites: await prisma.favorite.count({ where: { userId } }),
    progress: await prisma.playbackProgress.count({ where: { userId } }),
    bookmarks: await prisma.bookmark.count({ where: { userId } }),
    sessions: await prisma.session.count({ where: { userId } }),
    devices: await prisma.apiToken.count({ where: { userId } }),
    playSessions: await prisma.playSession.count({ where: { userId } }),
  });

  beforeAll(async () => {
    storage = new FakeStorage();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(MailService)
      .useValue({ send: async (m: MailMessage) => void outbox.push(m) })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
    categoryId = (await sharedCategory(prisma, 'Prueba')).id;
  });

  beforeEach(() => {
    outbox = [];
    storage.objects.clear();
    storage.deleted = [];
    storage.failKeys.clear();
    storage.failAllDeletes = false;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@del.test' } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.summary.deleteMany({ where: { userId: { in: ids } } });
    await prisma.folder.updateMany({ where: { userId: { in: ids } }, data: { parentId: null } });
    await prisma.folder.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('eliminar la cuenta', () => {
    it('borra la cuenta, todos sus datos y sus archivos de S3 sin tocar los de otras personas', async () => {
      const user = await createUser();
      const other = await createUser();
      const keys = await populate(user.id);
      const otherKeys = await populate(other.id);
      const category = await prisma.category.create({ data: { userId: user.id, name: 'Personal' } });
      await prisma.summary.updateMany({ where: { userId: user.id }, data: { categoryId: category.id } });
      const otherCategory = await prisma.category.create({ data: { userId: other.id, name: 'Personal' } });
      const cookie = await webLogin(user.email!);
      const device = (await api().post('/login').send({ username: user.email, password: PASSWORD })).body.user.token;
      expect(await rowsOf(user.id)).toMatchObject({ summaries: 3, folders: 3, tags: 1, favorites: 1, progress: 1, bookmarks: 1, devices: 1, playSessions: 1 });

      const res = await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: PASSWORD });
      expect(res.status).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/br_session=;/);

      expect(Object.values(await rowsOf(user.id)).every((n) => n === 0)).toBe(true);
      expect(await prisma.category.findUnique({ where: { id: category.id } })).toBeNull();
      expect(await prisma.category.findUnique({ where: { id: otherCategory.id } })).not.toBeNull();
      // Audios (vivo, papelera y pendiente) y portada: todos los archivos de la cuenta, y solo esos.
      expect(storage.deleted.sort()).toEqual(keys.sort());
      expect(keys).toHaveLength(4);
      for (const key of otherKeys) expect(storage.objects.has(key)).toBe(true);
      expect(await rowsOf(other.id)).toMatchObject({ users: 1, summaries: 3, folders: 3 });

      expect(outbox.map((m) => [m.to, m.subject])).toEqual([[user.email, expect.stringContaining('Eliminamos tu cuenta')]]);
      expect(outbox[0].text).toContain('14 días');
      expect((await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401);
      await api().get('/api/me').set({ Authorization: `Bearer ${device}` }).expect(401);
    });

    it('exige la contraseña (400, no 401), limita los intentos y no borra nada si falla', async () => {
      const user = await createUser();
      await populate(user.id);
      const cookie = await webLogin(user.email!);
      const del = (password: string) => api().delete('/api/auth/account').set('Cookie', cookie).send({ password });

      for (let i = 0; i < 5; i++) expect((await del('contraseña-equivocada')).status).toBe(400);
      expect((await del(PASSWORD)).status).toBe(429);
      expect(storage.deleted).toEqual([]);
      expect(await rowsOf(user.id)).toMatchObject({ users: 1, summaries: 3 });
      await api().delete('/api/auth/account').set('Cookie', cookie).send({}).expect(400);
      await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    });

    it('si S3 no puede borrar todo, la cuenta se conserva con lo que falta y se puede reintentar', async () => {
      const user = await createUser();
      const keys = await populate(user.id);
      const cookie = await webLogin(user.email!);
      const stuck = keys.find((k) => k.endsWith('audio.mp3'))!;
      storage.failKeys.add(stuck);

      const res = await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: PASSWORD });
      expect(res.status).toBe(502);
      expect(await rowsOf(user.id)).toMatchObject({ users: 1, summaries: 1 });
      expect(await prisma.summary.count({ where: { userId: user.id, s3Key: stuck } })).toBe(1);
      expect(outbox).toHaveLength(0);
      await api().get('/api/auth/me').set('Cookie', cookie).expect(200);

      storage.failKeys.clear();
      expect((await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: PASSWORD })).status).toBe(204);
      expect((await rowsOf(user.id)).users).toBe(0);
      expect(storage.objects.size).toBe(0);
    });

    it('no la elimina con un token de dispositivo ni sin sesión, y protege la cuenta propietaria', async () => {
      const user = await createUser();
      const device = (await api().post('/login').send({ username: user.email, password: PASSWORD })).body.user.token;
      await api().delete('/api/auth/account').set({ Authorization: `Bearer ${device}` }).send({ password: PASSWORD }).expect(403);
      await api().delete('/api/auth/account').send({ password: PASSWORD }).expect(401);
      expect((await rowsOf(user.id)).users).toBe(1);

      const owner = await prisma.user.findUniqueOrThrow({ where: { id: DEFAULT_USER_ID } });
      const email = `dueno-${Date.now()}@del.test`;
      try {
        await prisma.user.update({ where: { id: DEFAULT_USER_ID }, data: { email, passwordHash: bcrypt.hashSync(PASSWORD, 4) } });
        const cookie = await webLogin(email);
        await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: PASSWORD }).expect(403);
        expect((await rowsOf(DEFAULT_USER_ID)).users).toBe(1);
      } finally {
        await prisma.session.deleteMany({ where: { userId: DEFAULT_USER_ID } });
        await prisma.user.update({ where: { id: DEFAULT_USER_ID }, data: { email: owner.email, passwordHash: owner.passwordHash } });
      }
    });

    it('el borrado por el administrador (audio y cuenta) usa las mismas salvaguardas', async () => {
      const user = await createUser();
      await populate(user.id);
      const eraser = app.get(AccountEraser);
      const audio = await prisma.summary.findFirstOrThrow({ where: { userId: user.id, title: 'Vivo' } });

      const removed = await eraser.deleteAudio(audio.id);
      expect(removed).toMatchObject({ title: 'Vivo', userId: user.id, email: user.email });
      expect(storage.deleted.sort()).toEqual([audio.s3Key, audio.coverKey!].sort());
      expect(await prisma.summary.count({ where: { id: audio.id } })).toBe(0);
      expect(await prisma.bookmark.count({ where: { userId: user.id } })).toBe(0); // en cascada
      await expect(eraser.deleteAudio(audio.id)).rejects.toThrow('Audio no encontrado');

      await expect(eraser.deleteAccount(DEFAULT_USER_ID)).rejects.toThrow('propietaria');
      await eraser.deleteAccount(user.id);
      expect(Object.values(await rowsOf(user.id)).every((n) => n === 0)).toBe(true);
    });
  });

  describe('versión de los términos', () => {
    it('pide aceptar la versión vigente y deja de pedirlo al aceptarla', async () => {
      const user = await createUser({ termsVersion: null, termsAcceptedAt: null });
      const login = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(login.body.needsTerms).toBe(true);
      const cookie = login.headers['set-cookie'] as unknown as string[];
      expect((await api().get('/api/auth/me').set('Cookie', cookie)).body.needsTerms).toBe(true);

      const accepted = await api().post('/api/auth/accept-terms').set('Cookie', cookie);
      expect([accepted.status, accepted.body.needsTerms]).toEqual([200, false]);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.termsVersion).toBe(TERMS_VERSION);
      expect(stored.termsAcceptedAt).not.toBeNull();
      expect((await api().get('/api/auth/me').set('Cookie', cookie)).body.needsTerms).toBe(false);

      // Si la versión vigente cambia (aquí se simula una versión anterior guardada), se vuelve a pedir.
      await prisma.user.update({ where: { id: user.id }, data: { termsVersion: '2020-01-01' } });
      expect((await api().get('/api/auth/me').set('Cookie', cookie)).body.needsTerms).toBe(true);
      await api().post('/api/auth/accept-terms').expect(401);
    });
  });
});
