import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserPlan, UserRole, UserStatus } from '@prisma/client';
import * as request from 'supertest';
import { OWNER_ID } from '../accounts/account-eraser';
import { PrismaService } from '../prisma/prisma.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUserActionsService } from './admin-user-actions.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { PasswordService } from './password.service';
import { UserGuard } from './user.guard';
import { USER_RESOLVER, UserRequest } from './user.constants';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const PENDING_ID = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'test-password';

interface TestUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  role: UserRole;
  passwordHash: string;
  plan: UserPlan;
  planExpiresAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  storageLimitBytes: bigint | null;
  maxAudios: number | null;
}

describe('Administración de roles', () => {
  let app: INestApplication;
  const owner: TestUser = { id: OWNER_ID, name: 'Propietario', email: 'owner@example.test', status: UserStatus.ACTIVE, role: UserRole.ADMIN, passwordHash: 'hash', plan: UserPlan.FOUNDER, planExpiresAt: null, createdAt: new Date('2026-01-01'), lastLoginAt: null, storageLimitBytes: null, maxAudios: null };
  const user: TestUser = { id: USER_ID, name: 'Usuario', email: 'user@example.test', status: UserStatus.ACTIVE, role: UserRole.USER, passwordHash: 'other', plan: UserPlan.FOUNDER, planExpiresAt: null, createdAt: new Date('2026-01-01'), lastLoginAt: null, storageLimitBytes: null, maxAudios: null };
  const admin: TestUser = { id: ADMIN_ID, name: 'Admin', email: 'admin@example.test', status: UserStatus.ACTIVE, role: UserRole.ADMIN, passwordHash: 'other', plan: UserPlan.FOUNDER, planExpiresAt: null, createdAt: new Date('2026-01-01'), lastLoginAt: null, storageLimitBytes: null, maxAudios: null };
  const pending: TestUser = { id: PENDING_ID, name: 'Pendiente', email: 'pending@example.test', status: UserStatus.PENDING, role: UserRole.USER, passwordHash: 'other', plan: UserPlan.FOUNDER, planExpiresAt: null, createdAt: new Date('2026-01-01'), lastLoginAt: null, storageLimitBytes: null, maxAudios: null };
  const users = [owner, user, admin, pending];
  const findUnique = jest.fn(async ({ where }: { where: { id: string } }) => users.find((item) => item.id === where.id) ?? null);
  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: { role: UserRole } }) => {
    const item = users.find((entry) => entry.id === where.id);
    if (!item) throw new Error('Usuario no encontrado');
    item.role = data.role;
    return item;
  });
  const audit = jest.fn(async () => ({}));
  const tx = { user: { findUnique, update }, adminRoleChange: { create: audit }, $queryRaw: jest.fn(async () => []) };
  const prisma = {
    user: {
      findUnique,
      findMany: jest.fn(async () => users),
      count: jest.fn(async () => users.length),
      groupBy: jest.fn(async () => []),
    },
    summary: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const verify = jest.fn(async (password: string, hash: string | null) => password === PASSWORD && hash === 'hash');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        LoginRateLimiter,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: { verify } },
        { provide: AdminUserActionsService, useValue: {} },
        {
          provide: USER_RESOLVER,
          useValue: {
            resolve: (req: UserRequest) => {
              if (req.headers['x-device']) req.apiToken = true;
              return req.headers['x-user'];
            },
          },
        },
        { provide: APP_GUARD, useClass: UserGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(() => {
    user.role = UserRole.USER;
    owner.role = UserRole.ADMIN;
    owner.status = UserStatus.ACTIVE;
    owner.passwordHash = 'hash';
    admin.role = UserRole.ADMIN;
    pending.status = UserStatus.PENDING;
    jest.clearAllMocks();
  });

  afterAll(async () => app.close());

  const api = () => request(app.getHttpServer());
  const role = (actor: string, target: string, next: string, password = PASSWORD) =>
    api().patch(`/api/admin/users/${target}/role`).set('x-user', actor).send({ role: next, password });

  it('solo permite listar a administradores activos con sesión web', async () => {
    await api().get('/api/admin/users').expect(401);
    await api().get('/api/admin/users').set('x-user', USER_ID).expect(403);
    await api().get('/api/admin/users').set('x-user', ADMIN_ID).set('x-device', '1').expect(403);
    const response = await api().get('/api/admin/users').set('x-user', ADMIN_ID).expect(200);
    expect(response.body).toMatchObject({ page: 1, total: 4 });
    expect(response.body.users[0]).toMatchObject({ id: OWNER_ID, isOwner: true });
    expect(JSON.stringify(response.body)).not.toContain('password');
    await api().get('/api/admin/users?page=0').set('x-user', OWNER_ID).expect(400);
    owner.status = UserStatus.SUSPENDED;
    await api().get('/api/admin/users').set('x-user', OWNER_ID).expect(403);
  });

  it('solo el propietario puede cambiar roles tras verificar su contraseña', async () => {
    await role(USER_ID, ADMIN_ID, 'USER').expect(403);
    await role(ADMIN_ID, USER_ID, 'ADMIN').expect(403);
    await role(OWNER_ID, OWNER_ID, 'USER').expect(403);
    await role(OWNER_ID, USER_ID, 'INVALID').expect(400);
    await role(OWNER_ID, USER_ID, 'ADMIN', 'incorrecta').expect(400);
    await role(OWNER_ID, PENDING_ID, 'ADMIN').expect(400);
    expect(user.role).toBe(UserRole.USER);
    expect(audit).not.toHaveBeenCalled();
    await role(OWNER_ID, USER_ID, 'ADMIN').expect(200);
    expect(user.role).toBe(UserRole.ADMIN);
    expect(audit).toHaveBeenCalledWith({ data: { actorId: OWNER_ID, targetId: USER_ID, previousRole: 'USER', newRole: 'ADMIN' } });
    await api().get('/api/admin/users').set('x-user', USER_ID).expect(200);
    await role(OWNER_ID, USER_ID, 'USER').expect(200);
    await api().get('/api/admin/users').set('x-user', USER_ID).expect(403);
  });

  it('no admite cambios con tokens de dispositivo', async () => {
    await api().patch(`/api/admin/users/${USER_ID}/role`).set('x-user', OWNER_ID).set('x-device', '1')
      .send({ role: 'ADMIN', password: PASSWORD }).expect(403);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rechaza un cambio si la contraseña del propietario cambió durante la confirmación', async () => {
    findUnique.mockResolvedValueOnce({ ...owner }).mockResolvedValueOnce({ ...owner, passwordHash: 'nuevo-hash' });
    await role(OWNER_ID, USER_ID, 'ADMIN').expect(403);
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('limita los intentos fallidos de confirmación', async () => {
    for (let i = 0; i < 5; i++) await role(OWNER_ID, USER_ID, 'ADMIN', 'incorrecta').expect(400);
    await role(OWNER_ID, USER_ID, 'ADMIN').expect(429);
    expect(update).not.toHaveBeenCalled();
  });
});
