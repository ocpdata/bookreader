import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SlidingWindowLimiter } from '../src/auth/rate-limiter';
import { RegistrationService } from '../src/auth/registration.service';
import { MailMessage, MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { FakeStorage } from './fake-storage';

const PASSWORD = 'una-contraseña-segura-1';
const hashCode = (code: string) => createHash('sha256').update(code.replace(/[^a-z0-9]/gi, '').toUpperCase()).digest('hex');

describe('Registro, verificación y recuperación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let outbox: MailMessage[];
  let failMail = false;
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const newEmail = () => `persona${++counter}-${Date.now()}@reg.test`;
  const register = (body: Record<string, unknown> = {}) =>
    api().post('/api/auth/register').send({ email: newEmail(), name: 'Persona Prueba', password: PASSWORD, acceptTerms: true, ...body });
  const login = (email: string, password = PASSWORD) => api().post('/api/auth/login').send({ email, password });
  const tokenIn = (message: MailMessage) => /token=([A-Za-z0-9_-]+)/.exec(message.text)?.[1] as string;
  const sentTo = (email: string) => outbox.filter((m) => m.to === email);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorage())
      .overrideProvider(MailService)
      .useValue({
        send: async (message: MailMessage) => {
          if (failMail) throw new Error('SES no disponible');
          outbox.push(message);
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
  });

  beforeEach(() => {
    outbox = [];
    failMail = false;
    process.env.REGISTRATION_MODE = 'open';
    app.get(SlidingWindowLimiter).clear();
  });

  afterAll(async () => {
    delete process.env.REGISTRATION_MODE;
    await prisma.invitation.deleteMany({ where: { note: 'prueba' } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@reg.test' } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('modos de registro', () => {
    it('informa el modo y, cerrado, rechaza el registro sin crear nada', async () => {
      process.env.REGISTRATION_MODE = 'closed';
      expect((await api().get('/api/auth/config')).body).toEqual({ registration: 'closed' });
      const email = newEmail();
      expect((await register({ email })).status).toBe(403);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
      delete process.env.REGISTRATION_MODE;
      expect((await api().get('/api/auth/config')).body).toEqual({ registration: 'closed' });
      process.env.REGISTRATION_MODE = 'invite';
      expect((await api().get('/api/auth/config')).body).toEqual({ registration: 'invite' });
    });

    it('en modo invitación exige un código válido, de un solo uso o con tope, y lo consume', async () => {
      process.env.REGISTRATION_MODE = 'invite';
      const code = 'BR-ABCD-EFGH-JKLM';
      const invitation = await prisma.invitation.create({ data: { codeHash: hashCode(code), maxUses: 2, note: 'prueba' } });

      for (const inviteCode of [undefined, '', 'BR-0000-0000-0000', 'corto']) {
        app.get(SlidingWindowLimiter).clear();
        const res = await register({ inviteCode });
        expect({ inviteCode, status: res.status }).toEqual({ inviteCode, status: 400 });
      }
      expect(outbox).toHaveLength(0);

      // El código se acepta sin guiones ni mayúsculas.
      const first = newEmail();
      expect((await register({ email: first, inviteCode: 'brabcdefghjklm' })).status).toBe(202);
      expect((await register({ inviteCode: code })).status).toBe(202);
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).uses).toBe(2);
      // Agotado.
      expect((await register({ inviteCode: code })).status).toBe(400);
      expect(outbox).toHaveLength(2);
    });

    it('una invitación puede estar atada a un correo y caducar', async () => {
      process.env.REGISTRATION_MODE = 'invite';
      const locked = newEmail();
      await prisma.invitation.create({ data: { codeHash: hashCode('BR-LOCK-LOCK-LOCK'), email: locked, note: 'prueba' } });
      await prisma.invitation.create({ data: { codeHash: hashCode('BR-OLD0-OLD0-OLD0'), expiresAt: new Date(Date.now() - 1000), note: 'prueba' } });
      expect((await register({ inviteCode: 'BR-LOCK-LOCK-LOCK' })).status).toBe(400);
      expect((await register({ inviteCode: 'BR-OLD0-OLD0-OLD0' })).status).toBe(400);
      expect((await register({ email: locked.toUpperCase(), inviteCode: 'BR-LOCK-LOCK-LOCK' })).status).toBe(202);
    });

    it('una invitación fallida (contraseña débil) no gasta el código', async () => {
      process.env.REGISTRATION_MODE = 'invite';
      const invitation = await prisma.invitation.create({ data: { codeHash: hashCode('BR-SAFE-SAFE-SAFE'), note: 'prueba' } });
      expect((await register({ inviteCode: 'BR-SAFE-SAFE-SAFE', password: 'corta' })).status).toBe(400);
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).uses).toBe(0);
    });
  });

  describe('registro y verificación', () => {
    it('crea la cuenta pendiente, envía el enlace y solo permite entrar tras verificarla', async () => {
      const email = newEmail();
      const res = await register({ email: email.toUpperCase(), name: '  Ana   María ' });
      expect(res.status).toBe(202);
      expect(res.body.message).toContain('Revisa tu bandeja');

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ name: 'Ana María', status: 'PENDING', emailVerifiedAt: null, termsVersion: expect.any(String) });
      expect(user.termsAcceptedAt).not.toBeNull();
      expect(await bcrypt.compare(PASSWORD, user.passwordHash!)).toBe(true);

      expect(sentTo(email)).toHaveLength(1);
      const mail = sentTo(email)[0];
      expect(mail.subject).toContain('Verifica');
      expect(mail.text).toContain('/verificar?token=');
      expect(mail.html).toContain('Verificar mi correo');
      // En la base solo queda el hash del enlace.
      const stored = await prisma.emailToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(stored.tokenHash).toBe(createHash('sha256').update(tokenIn(mail)).digest('hex'));
      expect(stored.purpose).toBe('VERIFY_EMAIL');

      // Antes de verificar no entra (web ni apps) y el motivo solo se dice con la contraseña correcta.
      const blocked = await login(email);
      expect([blocked.status, blocked.body.message]).toEqual([403, expect.stringContaining('Verifica tu correo')]);
      expect((await login(email, 'otra-contraseña-123')).status).toBe(401);
      expect((await api().post('/login').send({ username: email, password: PASSWORD })).status).toBe(403);

      expect((await api().post('/api/auth/verify-email').send({ token: tokenIn(mail) })).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('ACTIVE');
      expect((await login(email)).status).toBe(200);
      expect((await api().post('/login').send({ username: email, password: PASSWORD })).status).toBe(200);
    });

    it('el enlace de verificación es de un solo uso, caduca y rechaza basura', async () => {
      const email = newEmail();
      await register({ email });
      const token = tokenIn(sentTo(email)[0]);
      expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(200);
      expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(400);
      expect((await api().post('/api/auth/verify-email').send({ token: 'x'.repeat(43) })).status).toBe(400);
      expect((await api().post('/api/auth/verify-email').send({ token: 'corto' })).status).toBe(400);
      expect((await api().post('/api/auth/verify-email').send({})).status).toBe(400);

      const late = newEmail();
      await register({ email: late });
      await prisma.emailToken.updateMany({ where: { user: { email: late } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await api().post('/api/auth/verify-email').send({ token: tokenIn(sentTo(late)[0]) })).status).toBe(400);
    });

    it('valida los datos: correo, nombre, términos y contraseña', async () => {
      const bad: Record<string, unknown>[] = [
        { email: 'no-es-correo' },
        { email: 'x'.repeat(250) + '@a.com' },
        { name: '   ' },
        { name: 'x'.repeat(101) },
        { acceptTerms: false },
        { acceptTerms: undefined },
        { password: 'corta' },
        { password: 'x'.repeat(73) },
        { password: 'password1234' },
        { password: 'aaaaaaaaaaaa' },
        { email: 'ocarrillo@reg.test', password: 'ocarrillo-123456' },
        { name: 'Guillermo', password: 'mi-guillermo-123' },
        { email: 'laura.prueba@reg.test', name: 'Laura Prueba', password: 'laura-prueba-12345' },
      ];
      for (const patch of bad) {
        // Cada intento cuenta contra el límite por IP: aquí se prueba la validación, no el límite.
        app.get(SlidingWindowLimiter).clear();
        const res = await register(patch);
        expect({ patch, status: res.status }).toEqual({ patch, status: 400 });
      }
      expect(outbox).toHaveLength(0);
    });

    it('no delata qué correos existen: la respuesta es la misma y es el correo el que lo dice', async () => {
      const email = newEmail();
      const first = await register({ email });
      await api().post('/api/auth/verify-email').send({ token: tokenIn(sentTo(email)[0]) });
      outbox = [];

      const again = await register({ email, password: 'otra-contraseña-segura-9' });
      expect([again.status, again.body]).toEqual([first.status, first.body]);
      expect(sentTo(email)).toHaveLength(1);
      expect(sentTo(email)[0].subject).toContain('Ya tienes una cuenta');
      expect(sentTo(email)[0].text).toContain('/olvide');
      // La contraseña de la cuenta existente no cambia.
      expect((await login(email)).status).toBe(200);
      expect((await login(email, 'otra-contraseña-segura-9')).status).toBe(401);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it('una cuenta pendiente que se vuelve a registrar recibe un enlace nuevo y su contraseña no se pisa', async () => {
      const email = newEmail();
      await register({ email });
      const oldToken = tokenIn(sentTo(email)[0]);
      // Alguien más intenta quedarse con la cuenta pendiente usando otra contraseña.
      await register({ email, password: 'contraseña-del-intruso-1' });
      expect(sentTo(email)).toHaveLength(2);
      const newToken = tokenIn(sentTo(email)[1]);
      expect(newToken).not.toBe(oldToken);
      // El enlace anterior queda invalidado.
      expect((await api().post('/api/auth/verify-email').send({ token: oldToken })).status).toBe(400);
      expect((await api().post('/api/auth/verify-email').send({ token: newToken })).status).toBe(200);
      expect((await login(email)).status).toBe(200);
      expect((await login(email, 'contraseña-del-intruso-1')).status).toBe(401);
    });

    it('reenvía la verificación solo a cuentas pendientes, con la misma respuesta para cualquier correo', async () => {
      const pending = newEmail();
      await register({ email: pending });
      outbox = [];
      const known = await api().post('/api/auth/resend-verification').send({ email: pending });
      const unknown = await api().post('/api/auth/resend-verification').send({ email: newEmail() });
      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect(known.body).toEqual(unknown.body);
      expect(outbox.map((m) => m.to)).toEqual([pending]);

      await api().post('/api/auth/verify-email').send({ token: tokenIn(outbox[0]) });
      outbox = [];
      await api().post('/api/auth/resend-verification').send({ email: pending });
      expect(outbox).toHaveLength(0);
    });

    it('si el envío falla la cuenta se crea igual y la respuesta no cambia', async () => {
      failMail = true;
      const email = newEmail();
      expect((await register({ email })).status).toBe(202);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('PENDING');
      failMail = false;
      await api().post('/api/auth/resend-verification').send({ email }).expect(202);
      expect(sentTo(email)).toHaveLength(1);
    });
  });

  describe('límites', () => {
    it('limita los registros por IP y los correos por dirección (en silencio)', async () => {
      for (let i = 0; i < 10; i++) expect((await register()).status).toBe(202);
      expect((await register()).status).toBe(429);

      app.get(SlidingWindowLimiter).clear();
      const email = newEmail();
      await register({ email });
      for (let i = 0; i < 4; i++) await register({ email });
      // 3 correos por hora a esa dirección; el resto se omite sin cambiar la respuesta.
      expect(sentTo(email)).toHaveLength(3);
    });

    it('limita los reenvíos y las solicitudes de contraseña por IP', async () => {
      for (let i = 0; i < 10; i++) expect((await api().post('/api/auth/forgot-password').send({ email: newEmail() })).status).toBe(202);
      expect((await api().post('/api/auth/forgot-password').send({ email: newEmail() })).status).toBe(429);
      for (let i = 0; i < 10; i++) expect((await api().post('/api/auth/resend-verification').send({ email: newEmail() })).status).toBe(202);
      expect((await api().post('/api/auth/resend-verification').send({ email: newEmail() })).status).toBe(429);
    });
  });

  describe('recuperar la contraseña', () => {
    async function activeUser() {
      const email = newEmail();
      await register({ email });
      await api().post('/api/auth/verify-email').send({ token: tokenIn(sentTo(email)[0]) });
      outbox = [];
      return email;
    }

    it('responde igual para cualquier correo y solo escribe a cuentas reales', async () => {
      const email = await activeUser();
      const real = await api().post('/api/auth/forgot-password').send({ email });
      const fake = await api().post('/api/auth/forgot-password').send({ email: newEmail() });
      expect([real.status, fake.status]).toEqual([202, 202]);
      expect(real.body).toEqual(fake.body);
      expect(outbox.map((m) => [m.to, m.subject.includes('Restablece')])).toEqual([[email, true]]);
      expect(outbox[0].text).toContain('/restablecer?token=');
      await api().post('/api/auth/forgot-password').send({ email: 'no-es-correo' }).expect(400);
    });

    it('restablece con el enlace, cierra sesiones y apps, avisa por correo y no deja reusar el enlace', async () => {
      const email = await activeUser();
      const web = await login(email);
      const device = (await api().post('/login').send({ username: email, password: PASSWORD })).body.user.token;
      await api().get('/api/auth/me').set('Cookie', web.headers['set-cookie']).expect(200);
      await api().get('/api/me').set({ Authorization: `Bearer ${device}` }).expect(200);

      await api().post('/api/auth/forgot-password').send({ email });
      const token = tokenIn(outbox[0]);
      outbox = [];
      const done = await api().post('/api/auth/reset-password').send({ token, password: 'la-contraseña-nueva-77' });
      expect(done.status).toBe(200);

      expect((await login(email)).status).toBe(401);
      expect((await login(email, 'la-contraseña-nueva-77')).status).toBe(200);
      await api().get('/api/auth/me').set('Cookie', web.headers['set-cookie']).expect(401);
      await api().get('/api/me').set({ Authorization: `Bearer ${device}` }).expect(401);
      expect(outbox.map((m) => m.subject)).toEqual([expect.stringContaining('cambió')]);
      expect((await api().post('/api/auth/reset-password').send({ token, password: 'otra-contraseña-nueva-8' })).status).toBe(400);
    });

    it('una contraseña débil no gasta el enlace; uno nuevo invalida el anterior; caduca en una hora', async () => {
      const email = await activeUser();
      await api().post('/api/auth/forgot-password').send({ email });
      const token = tokenIn(outbox[0]);
      expect((await api().post('/api/auth/reset-password').send({ token, password: 'corta' })).status).toBe(400);
      expect((await api().post('/api/auth/reset-password').send({ token, password: 'password1234' })).status).toBe(400);
      // Sigue vigente tras los intentos rechazados.
      const stored = await prisma.emailToken.findFirstOrThrow({ where: { user: { email }, purpose: 'RESET_PASSWORD' } });
      expect(stored.usedAt).toBeNull();
      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);

      await api().post('/api/auth/forgot-password').send({ email });
      const newer = tokenIn(outbox[1]);
      expect((await api().post('/api/auth/reset-password').send({ token, password: 'contraseña-nueva-123' })).status).toBe(400);
      await prisma.emailToken.updateMany({ where: { user: { email }, purpose: 'RESET_PASSWORD' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await api().post('/api/auth/reset-password').send({ token: newer, password: 'contraseña-nueva-123' })).status).toBe(400);
    });

    it('en una cuenta sin verificar "olvidé mi contraseña" reenvía la verificación, y restablecer también la verifica', async () => {
      const email = newEmail();
      await register({ email });
      outbox = [];
      await api().post('/api/auth/forgot-password').send({ email });
      expect(outbox.map((m) => m.subject.includes('Verifica'))).toEqual([true]);

      // Una persona con acceso al correo puede fijar la contraseña desde un enlace de restablecimiento.
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const raw = 'enlace-de-restablecimiento-de-prueba-0123456789';
      await prisma.emailToken.create({
        data: { userId: user.id, purpose: 'RESET_PASSWORD', tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 600_000) },
      });
      expect((await api().post('/api/auth/reset-password').send({ token: raw, password: 'contraseña-nueva-456' })).status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect([after.status, after.emailVerifiedAt !== null]).toEqual(['ACTIVE', true]);
      expect((await login(email, 'contraseña-nueva-456')).status).toBe(200);
    });

    it('cambiar la contraseña desde la cuenta avisa por correo', async () => {
      const email = await activeUser();
      const web = await login(email);
      const res = await api().post('/api/auth/password').set('Cookie', web.headers['set-cookie']).send({ current: PASSWORD, next: 'contraseña-cambiada-321' });
      expect(res.status).toBe(204);
      expect(outbox.map((m) => [m.to, m.subject.includes('cambió')])).toEqual([[email, true]]);
    });
  });

  describe('cuentas suspendidas y limpieza', () => {
    it('una cuenta suspendida no entra ni recibe correos de recuperación', async () => {
      const email = newEmail();
      await prisma.user.create({ data: { email, name: 'Suspendida', passwordHash: bcrypt.hashSync(PASSWORD, 4), status: 'SUSPENDED' } });
      const res = await login(email);
      expect([res.status, res.body.message]).toEqual([403, expect.stringContaining('suspendida')]);
      await api().post('/api/auth/forgot-password').send({ email }).expect(202);
      await register({ email });
      expect(outbox).toHaveLength(0);
    });

    it('borra los enlaces vencidos y las cuentas que nunca se verificaron en una semana', async () => {
      const stale = newEmail();
      const fresh = newEmail();
      await prisma.user.create({ data: { email: stale, name: 'Vieja', passwordHash: 'x', status: 'PENDING', createdAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
      await prisma.user.create({ data: { email: fresh, name: 'Nueva', passwordHash: 'x', status: 'PENDING' } });
      const active = await prisma.user.create({ data: { email: newEmail(), name: 'Activa', passwordHash: 'x', createdAt: new Date(Date.now() - 30 * 24 * 3600_000) } });
      await app.get(RegistrationService).cleanup();
      expect(await prisma.user.count({ where: { email: stale } })).toBe(0);
      expect(await prisma.user.count({ where: { email: fresh } })).toBe(1);
      expect(await prisma.user.count({ where: { id: active.id } })).toBe(1);
    });
  });
});
