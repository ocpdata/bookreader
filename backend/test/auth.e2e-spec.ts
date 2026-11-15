import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionService } from '../src/auth/session.service';
import { DEFAULT_USER_ID } from '../src/auth/user.constants';
import { StorageService } from '../src/storage/storage.service';
import { TEST_DATABASE_URL } from './test-config';

const PASSWORD = 'contraseña-correcta-1';
const DAY = 24 * 3600 * 1000;

describe('Autenticación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sessions: SessionService;
  let categoryId: string;
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const newEmail = () => `usuario${++counter}@auth.test`;

  async function createUser(email = newEmail(), password: string | null = PASSWORD) {
    // Como el comando de administración: el correo se guarda siempre en minúsculas.
    return prisma.user.create({
      data: { email: email.toLowerCase(), name: `Usuario ${counter}`, passwordHash: password ? bcrypt.hashSync(password, 4) : null },
    });
  }

  /** Inicia sesión y devuelve la cookie lista para usar en las siguientes peticiones. */
  async function login(email: string, password = PASSWORD) {
    const res = await api().post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    return { cookie: cookie.split(';')[0], raw: cookie, body: res.body };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    sessions = module.get(SessionService);
    prisma = new PrismaClient();
    categoryId = (await prisma.category.upsert({ where: { name: 'Prueba' }, update: {}, create: { name: 'Prueba' } })).id;
  });

  /**
   * Deja la base como la migración: el propietario sin correo ni contraseña. Se hace ANTES de borrar los
   * usuarios de prueba, porque los tests del script le asignan un correo @auth.test y, si no, ese
   * borrado se lo llevaría (y con él los audios y las claves foráneas de las demás suites).
   */
  async function resetUsers() {
    await prisma.session.deleteMany();
    await prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      update: { email: null, passwordHash: null, name: 'Propietario', externalId: null, lastLoginAt: null },
      create: { id: DEFAULT_USER_ID, name: 'Propietario' },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@auth.test' } } });
  }

  beforeEach(async () => {
    await prisma.summary.deleteMany();
    await resetUsers();
  });

  afterAll(async () => {
    await prisma.summary.deleteMany();
    await resetUsers();
    await prisma.$disconnect();
    await app.close();
  });

  it('exige sesión en los endpoints protegidos; salud e inicio de sesión son públicos', async () => {
    await api().get('/api/summaries').expect(401);
    await api().get('/api/home').expect(401);
    await api().get('/api/tags').expect(401);
    await api().get('/api/trash').expect(401);
    await api().get('/api/auth/me').expect(401);
    await api().post('/api/summaries').send({}).expect(401);
    await api().get('/api/health').expect(200);
    await api().post('/api/auth/logout').expect(204);
  });

  it('inicia sesión con cookie httpOnly y sin exponer la contraseña ni el token en la base', async () => {
    const user = await createUser('Dueña@Auth.test');
    const { cookie, raw, body } = await login('  dueña@auth.TEST  '); // el correo se normaliza
    expect(body).toEqual({ id: user.id, name: user.name, email: 'dueña@auth.test', needsTerms: true });
    expect(JSON.stringify(body)).not.toMatch(/hash|password/i);
    expect(raw).toMatch(/^br_session=[A-Za-z0-9_-]{43}/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);

    const token = cookie.split('=')[1];
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenHash).not.toContain(token);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).not.toBeNull();
  });

  it('la cookie es Secure cuando se indica (producción)', async () => {
    const user = await createUser();
    process.env.COOKIE_SECURE = 'true';
    try {
      const { raw } = await login(user.email!);
      expect(raw).toMatch(/Secure/i);
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });

  it('rechaza credenciales inválidas con el mismo mensaje exista o no el usuario', async () => {
    const user = await createUser();
    const wrongPassword = await api().post('/api/auth/login').send({ email: user.email, password: 'otra-contraseña-1234' });
    const unknownUser = await api().post('/api/auth/login').send({ email: 'nadie@auth.test', password: PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);

    // Un usuario sin contraseña asignada tampoco puede entrar, ni con una vacía.
    const noPassword = await createUser(newEmail(), null);
    await api().post('/api/auth/login').send({ email: noPassword.email, password: 'cualquiera-12345' }).expect(401);
    await api().post('/api/auth/login').send({ email: 'no-es-un-correo', password: PASSWORD }).expect(400);
    await api().post('/api/auth/login').send({ email: user.email, password: '' }).expect(400);
  });

  it('con la cookie se accede a los datos; sin ella o tras cerrar sesión, no', async () => {
    const user = await createUser();
    const { cookie } = await login(user.email!);

    expect((await api().get('/api/auth/me').set('Cookie', cookie)).body.email).toBe(user.email);
    await api().get('/api/summaries').set('Cookie', cookie).expect(200);
    await api().get('/api/summaries').set('Cookie', 'br_session=token-inventado').expect(401);

    const out = await api().post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toMatch(/br_session=;/);
    expect(await prisma.session.count()).toBe(0);
    await api().get('/api/summaries').set('Cookie', cookie).expect(401); // la cookie vieja ya no sirve
  });

  it('una sesión caducada no vale y se limpia; una activa se renueva una vez al día', async () => {
    const user = await createUser();
    const { cookie } = await login(user.email!);

    // Renovación deslizante: sin actividad reciente, al usarla se extiende la caducidad.
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 2 * DAY), expiresAt: new Date(Date.now() + 5 * DAY) },
    });
    await api().get('/api/summaries').set('Cookie', cookie).expect(200);
    const renewed = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    // Caducada: 401 y la limpieza la borra.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api().get('/api/summaries').set('Cookie', cookie).expect(401);
    expect(await sessions.deleteExpired()).toBe(1);
    expect(await prisma.session.count()).toBe(0);
  });

  it('limita los intentos fallidos por IP y cuenta, y un acierto reinicia la cuenta', async () => {
    const victim = await createUser();
    const bad = () => api().post('/api/auth/login').send({ email: victim.email, password: 'incorrecta-12345' });

    for (let i = 0; i < 5; i++) expect((await bad()).status).toBe(401);
    // Superado el límite, incluso la contraseña correcta queda bloqueada un rato.
    const blocked = await api().post('/api/auth/login').send({ email: victim.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();

    // Otra cuenta desde la misma IP no se ve afectada (el atacante no deja fuera a otros).
    const other = await createUser();
    await login(other.email!);

    // Un acierto antes del límite reinicia el contador de esa cuenta.
    const third = await createUser();
    for (let i = 0; i < 4; i++) {
      await api().post('/api/auth/login').send({ email: third.email, password: 'incorrecta-12345' }).expect(401);
    }
    await login(third.email!);
    for (let i = 0; i < 4; i++) {
      await api().post('/api/auth/login').send({ email: third.email, password: 'incorrecta-12345' }).expect(401);
    }
    await login(third.email!);
  });

  it('cambia la contraseña: exige la actual, valida la nueva y cierra las demás sesiones', async () => {
    const user = await createUser();
    const a = await login(user.email!);
    const b = await login(user.email!);
    const change = (current: string, next: string) =>
      api().post('/api/auth/password').set('Cookie', a.cookie).send({ current, next });

    // 400 (no 401): una contraseña actual errónea no debe confundirse con una sesión caducada.
    await change('no-es-la-actual-123', 'nueva-contraseña-1234').then((r) => expect(r.status).toBe(400));
    // ...y la sesión sigue válida tras ese error.
    await api().get('/api/auth/me').set('Cookie', a.cookie).expect(200);
    await change(PASSWORD, 'corta').then((r) => expect(r.status).toBe(400));
    await change(PASSWORD, 'x'.repeat(73)).then((r) => expect(r.status).toBe(400)); // bcrypt solo usa 72 bytes
    await change(PASSWORD, 'ñ'.repeat(37)).then((r) => expect(r.status).toBe(400)); // 74 bytes en UTF-8
    await change(PASSWORD, 'nueva-contraseña-1234').then((r) => expect(r.status).toBe(204));

    await api().get('/api/auth/me').set('Cookie', a.cookie).expect(200); // la sesión actual sigue
    await api().get('/api/auth/me').set('Cookie', b.cookie).expect(401); // las demás se cierran
    await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
    await login(user.email!, 'nueva-contraseña-1234');
    await api().post('/api/auth/password').send({ current: PASSWORD, next: 'otra-contraseña-1234' }).expect(401); // sin sesión
  });

  it('bloquea los cambios de datos que vienen de otro origen (CSRF)', async () => {
    const user = await createUser();
    const { cookie } = await login(user.email!);
    const post = () => api().post('/api/auth/password').set('Cookie', cookie).send({ current: PASSWORD, next: 'nueva-contraseña-1234' });

    await post().set('Origin', 'https://sitio-malicioso.example').then((r) => expect(r.status).toBe(403));
    await post().set('Sec-Fetch-Site', 'cross-site').then((r) => expect(r.status).toBe(403));
    await api().delete('/api/trash').set('Cookie', cookie).set('Origin', 'https://sitio-malicioso.example').expect(403);
    await api().post('/api/auth/login').set('Origin', 'https://sitio-malicioso.example').send({ email: user.email, password: PASSWORD }).expect(403);
    // Las lecturas no cambian nada y el mismo origen sí pasa.
    await api().get('/api/summaries').set('Cookie', cookie).set('Origin', 'https://sitio-malicioso.example').expect(200);
    await post().set('Origin', 'http://127.0.0.1').set('Host', '127.0.0.1').then((r) => expect(r.status).toBe(204));
  });

  it('cada sesión ve solo los datos de su usuario', async () => {
    const a = await createUser();
    const b = await createUser();
    const audio = await prisma.summary.create({
      data: {
        userId: a.id,
        title: 'De A',
        author: 'X',
        categoryId,
        s3Key: `audios/${a.id}/audio.mp3`,
        originalFilename: 'a.mp3',
        sizeBytes: 10,
        contentType: 'audio/mpeg',
        status: 'READY',
        durationSeconds: 5,
      },
    });
    const sa = await login(a.email!);
    const sb = await login(b.email!);

    expect((await api().get('/api/summaries').set('Cookie', sa.cookie)).body).toHaveLength(1);
    expect((await api().get('/api/summaries').set('Cookie', sb.cookie)).body).toHaveLength(0);
    expect((await api().get('/api/home').set('Cookie', sb.cookie)).body.total).toBe(0);
    await api().get(`/api/summaries/${audio.id}`).set('Cookie', sb.cookie).expect(404);
    await api().delete(`/api/summaries/${audio.id}`).set('Cookie', sb.cookie).expect(404);
    await api().put(`/api/summaries/${audio.id}/favorite`).set('Cookie', sb.cookie).expect(404);
    expect(await prisma.summary.count({ where: { id: audio.id, deletedAt: null } })).toBe(1);
  });

  describe('script de administración', () => {
    const run = (args: string[], password?: string, extraEnv: Record<string, string> = {}) =>
      spawnSync('node', ['scripts/user-admin.js', ...args], {
        cwd: `${__dirname}/..`,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: TEST_DATABASE_URL,
          BCRYPT_COST: '4',
          ...(password ? { USER_ADMIN_PASSWORD: password } : {}),
          ...extraEnv,
        },
      });

    it('reclama al propietario conservando su id (y con él sus audios) y fija su contraseña', async () => {
      const res = run(['set-owner', 'Dueño@Auth.test', 'Oscar'], PASSWORD);
      expect(res.status).toBe(0);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: DEFAULT_USER_ID } });
      expect(owner).toMatchObject({ email: 'dueño@auth.test', name: 'Oscar' });
      expect(bcrypt.compareSync(PASSWORD, owner.passwordHash!)).toBe(true);
      expect(owner.passwordHash).not.toContain(PASSWORD);
      await login('dueño@auth.test'); // ya puede iniciar sesión

      // No se puede reasignar a otro correo sin querer, ni usar uno ajeno.
      expect(run(['set-owner', 'otro@auth.test', 'Otro'], PASSWORD).status).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: DEFAULT_USER_ID } })).email).toBe('dueño@auth.test');
    });

    it('crea usuarios, rechaza duplicados y contraseñas débiles, y set-password cierra sesiones', async () => {
      expect(run(['create', 'nuevo@auth.test', 'Nuevo'], PASSWORD).status).toBe(0);
      expect(run(['create', 'nuevo@auth.test', 'Nuevo'], PASSWORD).status).toBe(1); // duplicado
      expect(run(['create', 'debil@auth.test', 'Débil'], 'corta').status).toBe(1);
      expect(run(['create', 'no-es-correo', 'X'], PASSWORD).status).toBe(1);
      expect(await prisma.user.count({ where: { email: 'debil@auth.test' } })).toBe(0);

      const { cookie } = await login('nuevo@auth.test');
      expect(run(['set-password', 'nuevo@auth.test'], 'contraseña-nueva-9876').status).toBe(0);
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401);
      await api().post('/api/auth/login').send({ email: 'nuevo@auth.test', password: PASSWORD }).expect(401);
      await login('nuevo@auth.test', 'contraseña-nueva-9876');
      expect(run(['set-password', 'inexistente@auth.test'], PASSWORD).status).toBe(1);
    });

    it('retiro de contenido: lista y elimina audios y cuentas con las mismas salvaguardas (sin tocar S3 en las pruebas)', async () => {
      const skipS3 = { ADMIN_SKIP_S3: 'true' };
      expect(run(['create', 'retiro@auth.test', 'Retiro'], PASSWORD).status).toBe(0);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'retiro@auth.test' } });
      const mk = (title: string) =>
        prisma.summary.create({
          data: { userId: user.id, title, author: 'A', categoryId, s3Key: `audios/${user.id}/${crypto.randomUUID()}/audio.mp3`, originalFilename: 'a.mp3', sizeBytes: 1048576, contentType: 'audio/mpeg', status: 'READY' },
        });
      const first = await mk('Primero');
      await mk('Segundo');
      const folder = await prisma.folder.create({ data: { userId: user.id, name: 'Padre' } });
      await prisma.folder.create({ data: { userId: user.id, name: 'Hijo', parentId: folder.id } });

      const list = run(['audios', 'retiro@auth.test']);
      expect(list.status).toBe(0);
      expect(list.stdout).toContain(first.id);
      expect(list.stdout).toContain('2 audios');

      const removed = run(['remove-audio', first.id, '--reason', 'reclamación 123'], undefined, skipS3);
      expect(removed.status).toBe(0);
      expect(removed.stdout).toContain('Primero');
      expect(removed.stdout).toContain('reclamación 123');
      expect(await prisma.summary.count({ where: { userId: user.id } })).toBe(1);
      expect(run(['remove-audio', first.id], undefined, skipS3).status).toBe(1); // ya no existe
      expect(run(['remove-audio'], undefined, skipS3).status).toBe(1);

      // Sin --confirm no borra nada; con él elimina la cuenta, sus carpetas anidadas y lo que quedaba.
      expect(run(['delete-user', 'retiro@auth.test'], undefined, skipS3).status).toBe(1);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
      expect(run(['delete-user', 'retiro@auth.test', '--confirm'], undefined, skipS3).status).toBe(0);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
      expect(await prisma.folder.count({ where: { userId: user.id } })).toBe(0);
      expect(run(['delete-user', 'inexistente@auth.test', '--confirm'], undefined, skipS3).status).toBe(1);
    });

    it('fija la cuota propia de una cuenta y permite volver a los valores por defecto', async () => {
      expect(run(['create', 'cuota@auth.test', 'Cuota'], PASSWORD).status).toBe(0);
      expect(run(['set-quota', 'cuota@auth.test', '--gb', '0.5', '--audios', '10']).status).toBe(0);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'cuota@auth.test' } });
      expect([user.storageLimitBytes, user.maxAudios]).toEqual([BigInt(512 * 1024 ** 2), 10]);
      expect(run(['set-quota', 'cuota@auth.test', '--reset']).status).toBe(0);
      const reset = await prisma.user.findUniqueOrThrow({ where: { email: 'cuota@auth.test' } });
      expect([reset.storageLimitBytes, reset.maxAudios]).toEqual([null, null]);
      for (const args of [['--gb', '0'], ['--gb'], ['--audios', 'x'], ['--nada', '1'], []]) {
        expect({ args, status: run(['set-quota', 'cuota@auth.test', ...args]).status }).toEqual({ args, status: 1 });
      }
      expect(run(['set-quota', 'inexistente@auth.test', '--gb', '1']).status).toBe(1);
    });

    it('crea usuarios ya verificados, suspende y reactiva cuentas, y crea invitaciones sin guardar el código', async () => {
      expect(run(['create', 'verificado@auth.test', 'Verificado'], PASSWORD).status).toBe(0);
      const created = await prisma.user.findUniqueOrThrow({ where: { email: 'verificado@auth.test' } });
      expect([created.status, created.emailVerifiedAt !== null]).toEqual(['ACTIVE', true]);

      const { cookie } = await login('verificado@auth.test');
      expect(run(['suspend', 'verificado@auth.test']).status).toBe(0);
      await api().get('/api/auth/me').set('Cookie', cookie).expect(401);
      await api().post('/api/auth/login').send({ email: 'verificado@auth.test', password: PASSWORD }).expect(403);
      expect(run(['suspend', 'inexistente@auth.test']).status).toBe(1);
      expect(run(['activate', 'verificado@auth.test']).status).toBe(0);
      await login('verificado@auth.test');

      const invite = run(['invite', '--email', 'Invitada@Auth.test', '--uses', '3', '--days', '7', '--note', 'prueba-cli']);
      expect(invite.status).toBe(0);
      const code = /BR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(invite.stdout)?.[0] as string;
      expect(code).toBeDefined();
      const stored = await prisma.invitation.findFirstOrThrow({ where: { note: 'prueba-cli' } });
      expect(stored).toMatchObject({ email: 'invitada@auth.test', maxUses: 3, uses: 0 });
      expect(stored.codeHash).toBe(require('node:crypto').createHash('sha256').update(code.replace(/-/g, '')).digest('hex'));
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(stored.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6 * DAY);
      expect(run(['invite', '--uses', '0']).status).toBe(1);
      expect(run(['invite', '--bogus', 'x']).status).toBe(1);
      await prisma.invitation.deleteMany({ where: { note: 'prueba-cli' } });
    });
  });
});
