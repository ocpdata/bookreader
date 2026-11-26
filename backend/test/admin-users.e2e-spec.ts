import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserPlan, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OWNER_ID } from '../src/accounts/account-eraser';
import { SlidingWindowLimiter } from '../src/auth/rate-limiter';
import { StorageService } from '../src/storage/storage.service';
import { sharedCategory } from './shared-category';

const PASSWORD = 'una-contraseña-segura-1';
const GB = 1024 ** 3;

describe('Administración de usuarios: tabla y acciones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let counter = 0;
  let adminCookie: string;
  let admin: { id: string };

  const api = () => request(app.getHttpServer());
  const email = (label: string) => `${label}${++counter}-${Date.now()}@admin.test`;

  async function createUser(data: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: {
        email: email('persona'),
        name: `Persona ${counter}`,
        passwordHash: bcrypt.hashSync(PASSWORD, 4),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        plan: UserPlan.FOUNDER,
        ...data,
      },
    });
  }

  async function loginAs(user: { email: string | null }) {
    const res = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    return (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  }

  const list = (query = '') => api().get(`/api/admin/users${query}`).set('Cookie', adminCookie);
  const patch = (id: string, action: string, body: object, cookie = adminCookie) =>
    api().patch(`/api/admin/users/${id}/${action}`).set('Cookie', cookie).send(body);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
    categoryId = (await sharedCategory(prisma, 'Prueba')).id;
    admin = await createUser({ role: UserRole.ADMIN, name: 'Admin de prueba' });
    adminCookie = await loginAs(admin as { email: string | null } & typeof admin);
  });

  beforeEach(() => {
    app.get(SlidingWindowLimiter).clear();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany({ where: { user: { email: { endsWith: '@admin.test' } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@admin.test' } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('listado', () => {
    it('lo pueden consultar solo los administradores activos', async () => {
      const user = await createUser();
      await api().get('/api/admin/users').expect(401);
      await api().get('/api/admin/users').set('Cookie', await loginAs(user)).expect(403);
      expect((await list()).status).toBe(200);
    });

    it('filtra por texto, rol, estado y plan, sin exponer contraseñas', async () => {
      const tag = `zz${Date.now()}`;
      const a = await createUser({ name: `Ana ${tag}`, plan: UserPlan.TRIAL, planExpiresAt: new Date(Date.now() + 86400_000) });
      const b = await createUser({ name: `Beto ${tag}`, status: UserStatus.SUSPENDED });
      const c = await createUser({ name: `Carla ${tag}`, role: UserRole.ADMIN });

      const all = await list(`?q=${tag}&sort=name&order=asc`);
      expect(all.body.users.map((u: { id: string }) => u.id)).toEqual([a.id, b.id, c.id]);
      expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|bcrypt/i);

      expect((await list(`?q=${tag}&status=SUSPENDED`)).body.users.map((u: { id: string }) => u.id)).toEqual([b.id]);
      expect((await list(`?q=${tag}&role=ADMIN`)).body.users.map((u: { id: string }) => u.id)).toEqual([c.id]);
      expect((await list(`?q=${tag}&plan=TRIAL`)).body.users.map((u: { id: string }) => u.id)).toEqual([a.id]);
      expect((await list(`?q=${a.email}`)).body.users.map((u: { id: string }) => u.id)).toEqual([a.id]);
      expect((await list(`?q=${tag}-no-existe`)).body).toMatchObject({ users: [], total: 0 });
    });

    it('ordena, pagina de forma estable y entrega los totales por estado, rol y plan', async () => {
      const tag = `pg${Date.now()}`;
      const created = [];
      for (let i = 0; i < 3; i++) created.push(await createUser({ name: `${tag}-${i}` }));

      const first = await list(`?q=${tag}&sort=name&order=asc&pageSize=25&page=1`);
      expect(first.body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
      const names = first.body.users.map((u: { name: string }) => u.name);
      expect(names).toEqual([...names].sort());

      const lastLogin = await createUser({ name: `${tag}-login`, lastLoginAt: new Date() });
      const byLogin = await list(`?q=${tag}&sort=lastLogin&order=desc`);
      expect(byLogin.body.users[0].id).toBe(lastLogin.id);
      expect(byLogin.body.users[byLogin.body.users.length - 1].lastLoginAt).toBeNull();

      const { summary } = first.body;
      expect(summary.byStatus.ACTIVE).toBeGreaterThanOrEqual(4);
      expect(summary.byRole.ADMIN).toBeGreaterThanOrEqual(1);
      expect(Object.keys(summary.byPlan).length).toBeGreaterThan(0);
      expect(created).toHaveLength(3);
    });

    it('rechaza parámetros no válidos', async () => {
      for (const query of ['?page=0', '?pageSize=7', '?sort=password', '?order=up', '?role=ROOT', '?status=x', `?q=${'a'.repeat(101)}`]) {
        expect((await list(query)).status).toBe(400);
      }
    });

    it('calcula el uso y el límite de cada cuenta, con su cuota propia', async () => {
      const user = await createUser({ name: `Uso ${Date.now()}`, plan: UserPlan.TRIAL, planExpiresAt: new Date(Date.now() + 86400_000) });
      for (const size of [1000, 2500]) {
        await prisma.summary.create({
          data: { userId: user.id, title: 't', author: 'a', categoryId, s3Key: `admin-test/${randomUUID()}`, originalFilename: 'a.mp3', sizeBytes: size, contentType: 'audio/mpeg', status: 'READY' },
        });
      }
      const row = (await list(`?q=${user.email}`)).body.users[0];
      expect(row).toMatchObject({ usedBytes: 3500, audios: 2, limitBytes: 2 * GB, maxAudios: 25, customQuota: false });

      await prisma.user.update({ where: { id: user.id }, data: { storageLimitBytes: BigInt(5 * GB), maxAudios: 99 } });
      expect((await list(`?q=${user.email}`)).body.users[0]).toMatchObject({ limitBytes: 5 * GB, maxAudios: 99, customQuota: true });
    });
  });

  describe('suspender y reactivar', () => {
    it('suspende, cierra sesiones y apps, impide entrar y deja constancia', async () => {
      const target = await createUser();
      const targetCookie = await loginAs(target);
      await prisma.apiToken.create({ data: { userId: target.id, tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'), name: 'App' } });
      await prisma.appPassword.create({ data: { userId: target.id, codeHash: randomUUID().replace(/-/g, '').padEnd(64, '1'), name: 'Código' } });
      await api().get('/api/auth/me').set('Cookie', targetCookie).expect(200);

      const res = await patch(target.id, 'status', { status: 'SUSPENDED', reason: 'Uso indebido' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SUSPENDED');
      await api().get('/api/auth/me').set('Cookie', targetCookie).expect(401);
      expect(await prisma.apiToken.count({ where: { userId: target.id } })).toBe(0);
      expect(await prisma.appPassword.count({ where: { userId: target.id } })).toBe(0);
      expect((await api().post('/api/auth/login').send({ email: target.email, password: PASSWORD })).status).toBe(403);
      expect(await prisma.adminUserAction.findFirst({ where: { targetId: target.id } })).toMatchObject({
        actorId: admin.id,
        action: 'SUSPEND',
        detail: 'Motivo: Uso indebido',
      });

      expect((await patch(target.id, 'status', { status: 'SUSPENDED' })).status).toBe(400);
    });

    it('reactiva: activa si verificó el correo y pendiente si nunca lo hizo', async () => {
      const verified = await createUser({ status: UserStatus.SUSPENDED });
      const unverified = await createUser({ status: UserStatus.SUSPENDED, emailVerifiedAt: null });
      expect((await patch(verified.id, 'status', { status: 'ACTIVE' })).body.status).toBe('ACTIVE');
      expect((await patch(unverified.id, 'status', { status: 'ACTIVE' })).body.status).toBe('PENDING');
      expect(await prisma.adminUserAction.count({ where: { targetId: verified.id, action: 'REACTIVATE' } })).toBe(1);
      const active = await createUser();
      expect((await patch(active.id, 'status', { status: 'ACTIVE' })).status).toBe(400);
    });

    it('protege al propietario, a uno mismo y a otros administradores', async () => {
      const otherAdmin = await createUser({ role: UserRole.ADMIN });
      expect((await patch(OWNER_ID, 'status', { status: 'SUSPENDED' })).status).toBe(403);
      expect((await patch(admin.id, 'status', { status: 'SUSPENDED' })).status).toBe(403);
      expect((await patch(otherAdmin.id, 'status', { status: 'SUSPENDED' })).status).toBe(403);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })).status).toBe('ACTIVE');
    });

    it('exige un administrador, un usuario existente y valores válidos', async () => {
      const user = await createUser();
      const target = await createUser();
      expect((await patch(target.id, 'status', { status: 'SUSPENDED' }, await loginAs(user))).status).toBe(403);
      expect((await patch(randomUUID(), 'status', { status: 'SUSPENDED' })).status).toBe(404);
      expect((await patch(target.id, 'status', { status: 'PENDING' })).status).toBe(400);
      expect((await patch('no-es-uuid', 'status', { status: 'SUSPENDED' })).status).toBe(400);
    });
  });

  describe('plan', () => {
    it('cambia el plan con o sin vencimiento y registra la acción', async () => {
      const target = await createUser();
      expect((await patch(target.id, 'plan', { plan: 'TRIAL' })).status).toBe(400);
      const trial = await patch(target.id, 'plan', { plan: 'TRIAL', days: 30 });
      expect(trial.status).toBe(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.plan).toBe('TRIAL');
      expect(stored.planExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

      await patch(target.id, 'plan', { plan: 'PREMIUM' }).expect(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ plan: 'PREMIUM', planExpiresAt: null });
      expect(await prisma.adminUserAction.count({ where: { targetId: target.id, action: 'SET_PLAN' } })).toBe(2);
    });

    it('rechaza planes y días no válidos', async () => {
      const target = await createUser();
      for (const body of [{ plan: 'GRATIS' }, { plan: 'PREMIUM', days: 0 }, { plan: 'PREMIUM', days: 99999 }, {}]) {
        expect((await patch(target.id, 'plan', body)).status).toBe(400);
      }
    });
  });

  describe('cuota', () => {
    it('fija almacenamiento y audios, y la restablece', async () => {
      const target = await createUser();
      await patch(target.id, 'quota', { storageGb: 1.5, maxAudios: 40 }).expect(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        storageLimitBytes: BigInt(Math.floor(1.5 * GB)),
        maxAudios: 40,
      });
      await patch(target.id, 'quota', { maxAudios: 60 }).expect(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ storageLimitBytes: BigInt(Math.floor(1.5 * GB)), maxAudios: 60 });
      await patch(target.id, 'quota', { reset: true }).expect(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ storageLimitBytes: null, maxAudios: null });
      expect(await prisma.adminUserAction.count({ where: { targetId: target.id, action: 'SET_QUOTA' } })).toBe(3);
    });

    it('rechaza cuotas vacías, combinadas con restablecer o fuera de rango', async () => {
      const target = await createUser();
      for (const body of [{}, { reset: true, maxAudios: 5 }, { storageGb: 0 }, { maxAudios: 0 }, { storageGb: -1 }, { maxAudios: 1.5 }]) {
        expect((await patch(target.id, 'quota', body)).status).toBe(400);
      }
    });
  });
});
