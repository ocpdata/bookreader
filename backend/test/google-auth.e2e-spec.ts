import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserPlan, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GoogleAuthError, GoogleClaims, GoogleOAuthClient } from '../src/auth/google-oauth.client';
import { SlidingWindowLimiter } from '../src/auth/rate-limiter';
import { StorageService } from '../src/storage/storage.service';
import { FakeStorage } from './fake-storage';

const PASSWORD = 'una-contraseña-segura-1';

describe('Acceso con Google y códigos de aplicación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let counter = 0;
  let claims: GoogleClaims;
  let exchangeError: GoogleAuthError | null = null;

  const api = () => request(app.getHttpServer());
  const newEmail = () => `persona${++counter}-${Date.now()}@google.test`;
  const hashEmail = (email: string) => createHash('sha256').update(email).digest('hex');
  const claimsFor = (email: string, extra: Partial<GoogleClaims> = {}): GoogleClaims => ({
    sub: `sub-${email}`,
    email,
    emailVerified: true,
    name: 'Persona Google',
    authTime: Math.floor(Date.now() / 1000),
    ...extra,
  });

  /** Recorre inicio y regreso; devuelve el destino, la cookie de sesión (si hubo) y la URL enviada a Google. */
  async function googleLogin(query = '', options: { cookie?: string | null } = {}) {
    const start = await api().get(`/api/auth/google/start${query}`).expect(302);
    const google = new URL(start.headers.location);
    const state = google.searchParams.get('state') ?? '';
    const flowCookie = ((start.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('br_google='));
    const cookie = options.cookie === undefined ? flowCookie?.split(';')[0] : options.cookie;
    const callback = api().get(`/api/auth/google/callback?code=abc&state=${state}`);
    const res = await (cookie ? callback.set('Cookie', cookie) : callback);
    const session = ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('br_session='));
    return { res, google, state, location: res.headers.location as string, sessionCookie: session?.split(';')[0] };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorage())
      .overrideProvider(GoogleOAuthClient)
      .useValue({
        exchange: async () => {
          if (exchangeError) throw exchangeError;
          return claims;
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
  });

  beforeEach(() => {
    exchangeError = null;
    process.env.REGISTRATION_MODE = 'open';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cliente-de-pruebas.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secreto-de-pruebas';
    app.get(SlidingWindowLimiter).clear();
  });

  afterAll(async () => {
    delete process.env.REGISTRATION_MODE;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@google.test' } }, select: { email: true } });
    await prisma.trialClaim.deleteMany({ where: { emailHash: { in: users.map((u) => hashEmail(u.email!)) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@google.test' } } });
    await prisma.$disconnect();
  });

  describe('acceso con Google', () => {
    it('informa si Google está disponible', async () => {
      expect((await api().get('/api/auth/config')).body).toEqual({ registration: 'open', google: true });
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      expect((await api().get('/api/auth/config')).body.google).toBe(false);
      const start = await api().get('/api/auth/google/start').expect(302);
      expect(start.headers.location).toBe('/entrar?error=google_unavailable');
    });

    it('envía a Google con PKCE, estado y solo los datos básicos', async () => {
      const { google } = await googleLogin('?from=share');
      expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(Object.fromEntries(google.searchParams)).toMatchObject({
        client_id: 'cliente-de-pruebas.apps.googleusercontent.com',
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge_method: 'S256',
      });
      expect(google.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/google\/callback$/);
      expect(google.searchParams.get('state')).toBeTruthy();
      expect(google.searchParams.get('nonce')).toBeTruthy();
    });

    it('crea una cuenta nueva ya verificada, con prueba gratuita, sin contraseña y con los términos aceptados', async () => {
      const email = newEmail();
      claims = claimsFor(email);
      const { location, sessionCookie } = await googleLogin('?from=share');
      expect(location).toBe('/invitaciones');
      expect(sessionCookie).toBeTruthy();

      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { identities: true } });
      expect(user).toMatchObject({ status: UserStatus.ACTIVE, plan: UserPlan.TRIAL, passwordHash: null, name: 'Persona Google' });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.planExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
      expect(user.identities).toHaveLength(1);

      const me = await api().get('/api/auth/me').set('Cookie', sessionCookie!).expect(200);
      expect(me.body).toMatchObject({ email, needsTerms: false, hasPassword: false });
    });

    it('la segunda vez entra por el sub aunque cambie el correo de Google', async () => {
      const email = newEmail();
      claims = claimsFor(email);
      await googleLogin();
      claims = claimsFor(newEmail(), { sub: `sub-${email}` });
      const second = await googleLogin();
      expect(second.location).toBe('/');
      const me = await api().get('/api/auth/me').set('Cookie', second.sessionCookie!).expect(200);
      expect(me.body.email).toBe(email);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it('con un plan elegido crea la cuenta sin prueba y vuelve a la cuenta para pagar', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_google';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_google';
      process.env.STRIPE_PRICE_MONTHLY_ID = 'price_monthly_test';
      process.env.STRIPE_PRICE_YEARLY_ID = 'price_yearly_test';
      try {
        const email = newEmail();
        claims = claimsFor(email);
        const { location } = await googleLogin('?plan=yearly');
        expect(location).toBe('/cuenta?checkout=yearly');
        expect(await prisma.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ plan: UserPlan.NONE, pendingCheckoutPlan: 'YEARLY' });
      } finally {
        delete process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        delete process.env.STRIPE_PRICE_MONTHLY_ID;
        delete process.env.STRIPE_PRICE_YEARLY_ID;
      }
    });

    it('vincula una cuenta activa existente con ese correo sin tocar su contraseña', async () => {
      const email = newEmail();
      const user = await prisma.user.create({
        data: { email, name: 'Con contraseña', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      claims = claimsFor(email);
      const { location, sessionCookie } = await googleLogin();
      expect(location).toBe('/');
      expect((await api().get('/api/auth/me').set('Cookie', sessionCookie!)).body.id).toBe(user.id);
      expect(await prisma.userIdentity.count({ where: { userId: user.id } })).toBe(1);
      await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    });

    it('activa una cuenta pendiente y descarta la contraseña que fijó quien se adelantó', async () => {
      const email = newEmail();
      const user = await prisma.user.create({
        data: { email, name: 'Pendiente', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.PENDING },
      });
      claims = claimsFor(email);
      await googleLogin();
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after).toMatchObject({ status: UserStatus.ACTIVE, passwordHash: null, plan: UserPlan.TRIAL });
      expect(after.emailVerifiedAt).not.toBeNull();
      expect((await api().post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    });

    it('rechaza correos que Google no verificó, sin crear cuenta', async () => {
      const email = newEmail();
      claims = claimsFor(email, { emailVerified: false });
      const { location, sessionCookie } = await googleLogin();
      expect(location).toBe('/entrar?error=google_unverified_email');
      expect(sessionCookie).toBeUndefined();
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('rechaza cuentas suspendidas', async () => {
      const email = newEmail();
      await prisma.user.create({ data: { email, name: 'Suspendida', status: UserStatus.SUSPENDED } });
      claims = claimsFor(email);
      const { location, sessionCookie } = await googleLogin();
      expect(location).toBe('/entrar?error=google_suspended');
      expect(sessionCookie).toBeUndefined();
    });

    it.each(['closed', 'invite'])('con el registro en modo %s no crea cuentas nuevas pero deja entrar a las existentes', async (mode) => {
      process.env.REGISTRATION_MODE = mode;
      const fresh = newEmail();
      claims = claimsFor(fresh);
      expect((await googleLogin()).location).toBe('/entrar?error=google_closed');
      expect(await prisma.user.count({ where: { email: fresh } })).toBe(0);

      const existing = newEmail();
      await prisma.user.create({ data: { email: existing, name: 'Existente', status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } });
      claims = claimsFor(existing);
      const ok = await googleLogin();
      expect([ok.location, Boolean(ok.sessionCookie)]).toEqual(['/', true]);
    });

    it('descarta el regreso si falta la cookie del navegador o el estado ya se usó', async () => {
      claims = claimsFor(newEmail());
      const noCookie = await googleLogin('', { cookie: null });
      expect(noCookie.location).toBe('/entrar?error=google_invalid');
      expect(noCookie.sessionCookie).toBeUndefined();

      const first = await googleLogin();
      expect(first.sessionCookie).toBeTruthy();
      const replay = await api().get(`/api/auth/google/callback?code=abc&state=${first.state}`).set('Cookie', `br_google=${first.state}`);
      expect(replay.headers.location).toBe('/entrar?error=google_invalid');

      const other = await googleLogin('', { cookie: 'br_google=otro-estado' });
      expect(other.location).toBe('/entrar?error=google_invalid');
    });

    it('trata el rechazo del usuario y los fallos de Google como errores de acceso', async () => {
      const start = await api().get('/api/auth/google/start').expect(302);
      const state = new URL(start.headers.location).searchParams.get('state');
      const denied = await api().get(`/api/auth/google/callback?error=access_denied&state=${state}`).set('Cookie', `br_google=${state}`);
      expect(denied.headers.location).toBe('/entrar?error=google_cancelled');

      exchangeError = new GoogleAuthError('invalid');
      claims = claimsFor(newEmail());
      expect((await googleLogin()).location).toBe('/entrar?error=google_invalid');
    });

    it('las cuentas sin contraseña no pueden cambiarla ni eliminarse con una contraseña', async () => {
      claims = claimsFor(newEmail());
      const { sessionCookie } = await googleLogin();
      const change = await api().post('/api/auth/password').set('Cookie', sessionCookie!).send({ current: 'x', next: PASSWORD });
      const erase = await api().delete('/api/auth/account').set('Cookie', sessionCookie!).send({ password: 'x' });
      expect([change.status, erase.status]).toEqual([400, 400]);
    });
  });

  describe('confirmar la eliminación de la cuenta con Google', () => {
    const deleteAccount = (cookie: string) => api().delete('/api/auth/account').set('Cookie', cookie).send({});

    async function googleUser() {
      const email = newEmail();
      claims = claimsFor(email);
      const { sessionCookie } = await googleLogin();
      return { email, cookie: sessionCookie!, id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
    }

    /** Recorre la confirmación; `callbackCookie` permite usar otra sesión en el regreso. */
    async function reauth(cookie: string, callbackCookie = cookie) {
      const start = await api().get('/api/auth/google/reauth').set('Cookie', cookie).expect(302);
      const google = new URL(start.headers.location);
      const state = google.searchParams.get('state');
      const res = await api().get(`/api/auth/google/callback?code=abc&state=${state}`).set('Cookie', `${callbackCookie}; br_google=${state}`);
      return { google, location: res.headers.location as string, setCookie: res.headers['set-cookie'] };
    }

    it('obliga a autenticarse de nuevo en Google y, al confirmar, permite eliminar sin contraseña', async () => {
      const { cookie, id } = await googleUser();
      expect((await deleteAccount(cookie)).status).toBe(400);

      const { google, location, setCookie } = await reauth(cookie);
      expect([google.searchParams.get('prompt'), google.searchParams.get('max_age')]).toEqual(['login', '0']);
      expect(location).toBe('/cuenta?reauth=ok');
      expect(JSON.stringify(setCookie)).not.toContain('br_session'); // no abre otra sesión

      expect((await deleteAccount(cookie)).status).toBe(204);
      expect(await prisma.user.count({ where: { id } })).toBe(0);
      expect(await prisma.userIdentity.count({ where: { userId: id } })).toBe(0);
    });

    it('la confirmación se gasta al usarla y no sirve para otra cuenta', async () => {
      const a = await googleUser();
      const b = await googleUser();
      claims = claimsFor(a.email);
      await reauth(a.cookie);
      expect((await deleteAccount(b.cookie)).status).toBe(400);
      expect((await deleteAccount(a.cookie)).status).toBe(204);
    });

    it('rechaza otra cuenta de Google, una autenticación anterior al intento y otra sesión', async () => {
      const a = await googleUser();
      const b = await googleUser();

      claims = claimsFor(newEmail(), { sub: 'otra-cuenta-de-google' });
      expect((await reauth(a.cookie)).location).toBe('/cuenta?reauth=invalid');

      claims = claimsFor(a.email, { authTime: Math.floor(Date.now() / 1000) - 3600 });
      expect((await reauth(a.cookie)).location).toBe('/cuenta?reauth=invalid');

      claims = claimsFor(a.email);
      expect((await reauth(a.cookie, b.cookie)).location).toBe('/cuenta?reauth=invalid');

      claims = claimsFor(a.email, { authTime: undefined });
      expect((await reauth(a.cookie)).location).toBe('/cuenta?reauth=invalid');

      expect((await deleteAccount(a.cookie)).status).toBe(400);
    });

    it('informa si la persona cancela y exige sesión y una cuenta de Google ligada', async () => {
      const { cookie } = await googleUser();
      const start = await api().get('/api/auth/google/reauth').set('Cookie', cookie).expect(302);
      const state = new URL(start.headers.location).searchParams.get('state');
      const denied = await api().get(`/api/auth/google/callback?error=access_denied&state=${state}`).set('Cookie', `${cookie}; br_google=${state}`);
      expect(denied.headers.location).toBe('/cuenta?reauth=cancelled');

      expect((await api().get('/api/auth/google/reauth')).status).toBe(401);

      const email = newEmail();
      await prisma.user.create({ data: { email, name: 'Sin Google', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } });
      const passwordCookie = (await api().post('/api/auth/login').send({ email, password: PASSWORD })).headers['set-cookie'][0].split(';')[0];
      const noGoogle = await api().get('/api/auth/google/reauth').set('Cookie', passwordCookie).expect(302);
      expect(noGoogle.headers.location).toBe('/cuenta?reauth=no_google');
    });

    it('una cuenta con contraseña sigue confirmando con ella', async () => {
      const email = newEmail();
      await prisma.user.create({ data: { email, name: 'Con contraseña', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } });
      const cookie = (await api().post('/api/auth/login').send({ email, password: PASSWORD })).headers['set-cookie'][0].split(';')[0];
      expect((await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: 'incorrecta' })).status).toBe(400);
      expect((await api().delete('/api/auth/account').set('Cookie', cookie).send({ password: PASSWORD })).status).toBe(204);
    });
  });

  describe('códigos de aplicación', () => {
    async function googleUser() {
      const email = newEmail();
      claims = claimsFor(email);
      const { sessionCookie } = await googleLogin();
      return { email, cookie: sessionCookie! };
    }
    const createCode = (cookie: string, name = 'iPhone') => api().post('/api/auth/app-passwords').set('Cookie', cookie).send({ name });
    const appLogin = (username: string, password: string) => api().post('/login').send({ username, password });

    it('permiten entrar en las apps con el correo y el código, y se guardan solo como hash', async () => {
      const { email, cookie } = await googleUser();
      const created = await createCode(cookie).expect(201);
      expect(created.body.code).toMatch(/^([A-Z2-9]{5}-){3}[A-Z2-9]{5}$/);

      const login = await appLogin(email, created.body.code);
      expect(login.status).toBe(200);
      expect(login.body.user.token).toMatch(/^brt_/);
      // También se acepta tecleado sin guiones y en minúsculas.
      expect((await appLogin(email, created.body.code.replace(/-/g, '').toLowerCase())).status).toBe(200);

      const row = await prisma.appPassword.findFirstOrThrow({ where: { id: created.body.id } });
      expect(row.codeHash).not.toContain(created.body.code);
      expect(row.lastUsedAt).not.toBeNull();

      const list = await api().get('/api/auth/app-passwords').set('Cookie', cookie).expect(200);
      expect(list.body).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(created.body.code);
    });

    it('no sirven en la web, ni con otro correo, ni con un código inventado', async () => {
      const a = await googleUser();
      const b = await googleUser();
      const code = (await createCode(a.cookie)).body.code;
      expect((await api().post('/api/auth/login').send({ email: a.email, password: code })).status).toBe(401);
      expect((await appLogin(b.email, code)).status).toBe(401);
      expect((await appLogin(a.email, 'AAAAA-BBBBB-CCCCC-DDDDD')).status).toBe(401);
    });

    it('se revocan uno a uno y los sigue limitando el máximo por cuenta', async () => {
      const { email, cookie } = await googleUser();
      const first = (await createCode(cookie, 'uno')).body;
      const second = (await createCode(cookie, 'dos')).body;
      await api().delete(`/api/auth/app-passwords/${first.id}`).set('Cookie', cookie).expect(204);
      expect((await appLogin(email, first.code)).status).toBe(401);
      expect((await appLogin(email, second.code)).status).toBe(200);
      await api().delete(`/api/auth/app-passwords/${first.id}`).set('Cookie', cookie).expect(404);

      for (let i = 0; i < 9; i++) await createCode(cookie).expect(201);
      expect((await createCode(cookie)).status).toBe(400);
    });

    it('los gestiona solo la sesión web y cada cuenta solo ve y revoca los suyos', async () => {
      const a = await googleUser();
      const b = await googleUser();
      const created = (await createCode(a.cookie)).body;
      const device = (await appLogin(a.email, created.code)).body.user.token;
      expect((await api().get('/api/auth/app-passwords').set('Authorization', `Bearer ${device}`)).status).toBe(403);
      await api().delete(`/api/auth/app-passwords/${created.id}`).set('Cookie', b.cookie).expect(404);
      expect((await api().get('/api/auth/app-passwords').set('Cookie', b.cookie)).body).toEqual([]);
    });

    it('también funcionan en cuentas con contraseña, que sigue valiendo', async () => {
      const email = newEmail();
      await prisma.user.create({
        data: { email, name: 'Mixta', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      const cookie = (await api().post('/api/auth/login').send({ email, password: PASSWORD })).headers['set-cookie'][0].split(';')[0];
      const code = (await createCode(cookie)).body.code;
      expect((await appLogin(email, code)).status).toBe(200);
      expect((await appLogin(email, PASSWORD)).status).toBe(200);
    });

    it('se revocan al cambiar la contraseña', async () => {
      const email = newEmail();
      await prisma.user.create({
        data: { email, name: 'Cambia', passwordHash: await bcrypt.hash(PASSWORD, 4), status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      });
      const cookie = (await api().post('/api/auth/login').send({ email, password: PASSWORD })).headers['set-cookie'][0].split(';')[0];
      const code = (await createCode(cookie)).body.code;
      await api().post('/api/auth/password').set('Cookie', cookie).send({ current: PASSWORD, next: 'otra-contraseña-segura-2' }).expect(204);
      expect((await appLogin(email, code)).status).toBe(401);
    });
  });
});
