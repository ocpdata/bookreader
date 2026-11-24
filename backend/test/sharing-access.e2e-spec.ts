import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, SummaryStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AccountEraser } from '../src/accounts/account-eraser';
import { SESSION_COOKIE } from '../src/auth/user.constants';
import { SessionService } from '../src/auth/session.service';
import { MailMessage, MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { FakeStorage } from './fake-storage';
import { sharedCategory } from './shared-category';

describe('Acceso a audios compartidos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let storage: FakeStorage;
  const outbox: MailMessage[] = [];
  const suffix = randomUUID();
  const ownerEmail = `owner-${suffix}@share.test`;
  const recipientEmail = `recipient-${suffix}@share.test`;
  const otherEmail = `other-${suffix}@share.test`;
  const erasedEmail = `erased-${suffix}@share.test`;
  let ownerId: string;
  let recipientId: string;
  let otherId: string;
  let categoryId: string;
  const cookies = new Map<string, string>();
  const as = (userId: string) => ({
    Cookie: `${SESSION_COOKIE}=${cookies.get(userId) ?? ''}`,
  });
  const api = () => request(app.getHttpServer());

  async function audio(title: string) {
    const id = randomUUID();
    const s3Key = `audios/${ownerId}/${randomUUID()}/audio.mp3`;
    const coverKey = s3Key.replace('audio.mp3', 'cover-12345678.jpg');
    storage.objects.set(s3Key, Buffer.from('0123456789'));
    storage.objects.set(coverKey, Buffer.from('cover'));
    await prisma.summary.create({
      data: {
        id,
        userId: ownerId,
        title,
        author: 'Autor',
        categoryId,
        s3Key,
        coverKey,
        originalFilename: 'audio.mp3',
        sizeBytes: 10,
        contentType: 'audio/mpeg',
        status: SummaryStatus.READY,
        durationSeconds: 100,
      },
    });
    return id;
  }

  beforeAll(async () => {
    process.env.REGISTRATION_MODE = 'open';
    process.env.SHARING_ENABLED = 'true';
    storage = new FakeStorage();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(MailService)
      .useValue({
        send: async (message: MailMessage) => {
          outbox.push(message);
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
    ownerId = (
      await prisma.user.create({
        data: {
          name: 'Propietaria',
          email: ownerEmail,
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
    otherId = (
      await prisma.user.create({
        data: {
          name: 'Tercero',
          email: otherEmail,
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
    cookies.set(ownerId, (await app.get(SessionService).create(ownerId)).token);
    cookies.set(otherId, (await app.get(SessionService).create(otherId)).token);
    categoryId = (await sharedCategory(prisma, `Prueba ${suffix}`)).id;
  });

  afterAll(async () => {
    await prisma.summary.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({
      where: {
        email: { in: [ownerEmail, recipientEmail, otherEmail, erasedEmail] },
      },
    });
    await prisma.trialClaim.deleteMany({
      where: {
        emailHash: createHash('sha256').update(recipientEmail).digest('hex'),
      },
    });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
    await app.close();
    delete process.env.REGISTRATION_MODE;
    delete process.env.SHARING_ENABLED;
  });

  it('permite invitar antes del registro y mantiene el acceso aislado y revocable', async () => {
    const first = await audio('Primer audio');
    const second = await audio('Segundo audio');
    const created = await api()
      .post('/api/shares')
      .set(as(ownerId))
      .send({
        email: recipientEmail.toUpperCase(),
        scope: 'ITEMS',
        summaryIds: [first],
      });
    expect(created.status).toBeLessThan(300);
    expect(outbox.some((message) => message.to === recipientEmail)).toBe(true);
    const invitationMail = outbox.find((message) => message.to === recipientEmail)!;
    expect(invitationMail.text).toContain('/entrar?from=share');
    expect(invitationMail.text).toContain('/registro?from=share');

    const sent = await api()
      .get('/api/shares/sent')
      .set(as(ownerId))
      .expect(200);
    const share = sent.body.find(
      (entry: { email: string }) => entry.email === recipientEmail,
    );
    expect(share).toBeDefined();
    await api()
      .post(`/api/shares/${share.id}/accept`)
      .set(as(otherId))
      .expect(404);

    await api()
      .post('/api/auth/register')
      .send({
        name: 'Nueva persona',
        email: recipientEmail,
        password: 'una-contraseña-segura-1',
        acceptTerms: true,
        source: 'share',
      })
      .expect(202);
    const pending = await prisma.user.findUniqueOrThrow({
      where: { email: recipientEmail },
    });
    recipientId = pending.id;
    expect(pending.status).toBe('PENDING');
    cookies.set(
      recipientId,
      (await app.get(SessionService).create(recipientId)).token,
    );
    expect(
      (await api().post(`/api/shares/${share.id}/accept`).set(as(recipientId)))
        .status,
    ).toBeGreaterThanOrEqual(400);
    const verification = outbox.find(
      (message) =>
        message.to === recipientEmail &&
        message.text.includes('/verificar?token='),
    );
    const token = /token=([A-Za-z0-9_-]+)/.exec(verification?.text ?? '')?.[1];
    expect(token).toBeDefined();
    expect(verification?.text).toContain('&from=share');
    await api().post('/api/auth/verify-email').send({ token }).expect(200);
    const verified = await prisma.user.findUniqueOrThrow({
      where: { id: recipientId },
    });
    expect(verified.plan).toBe('TRIAL');
    expect(verified.planExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(404);
    const received = await api()
      .get('/api/shares/received')
      .set(as(recipientId))
      .expect(200);
    expect(received.body.map((entry: { id: string }) => entry.id)).toContain(
      share.id,
    );
    expect(
      received.body.find((entry: { id: string }) => entry.id === share.id)
        .summaries,
    ).toEqual([{ id: first, title: 'Primer audio', author: 'Autor' }]);
    expect(
      (await api().post(`/api/shares/${share.id}/accept`).set(as(recipientId)))
        .status,
    ).toBeLessThan(300);
    const list = await api()
      .get('/api/shares/items')
      .set(as(recipientId))
      .expect(200);
    expect(list.body.map((entry: { id: string }) => entry.id)).toEqual([first]);
    const detail = await api()
      .get(`/api/summaries/${first}`)
      .set(as(recipientId))
      .expect(200);
    expect(detail.body).toMatchObject({
      isOwner: false,
      ownerName: 'Propietaria',
      tags: [],
    });
    expect(detail.body.s3Key).toBeUndefined();
    process.env.SHARING_ENABLED = 'false';
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(404);
    await api().get(`/api/summaries/${first}`).set(as(ownerId)).expect(200);
    process.env.SHARING_ENABLED = 'true';
    await api()
      .get(`/api/summaries/${second}`)
      .set(as(recipientId))
      .expect(404);
    await api().get(`/api/summaries/${first}`).set(as(otherId)).expect(404);
    await api()
      .patch(`/api/summaries/${first}`)
      .set(as(recipientId))
      .send({ title: 'Alterado' })
      .expect(404);
    await api()
      .delete(`/api/summaries/${first}`)
      .set(as(recipientId))
      .expect(404);

    await api()
      .put(`/api/summaries/${first}/progress`)
      .set(as(recipientId))
      .send({ positionSeconds: 40 })
      .expect(200);
    await api()
      .put(`/api/summaries/${first}/favorite`)
      .set(as(recipientId))
      .expect(200);
    await api()
      .post('/api/statistics/listening')
      .set(as(recipientId))
      .send({ id: randomUUID(), summaryId: first, durationMs: 2000 })
      .expect(204);
    const ownerDetail = await api()
      .get(`/api/summaries/${first}`)
      .set(as(ownerId))
      .expect(200);
    expect(ownerDetail.body.progress).toBeNull();
    expect(ownerDetail.body.favorite).toBe(false);
    const playback = await api()
      .post(`/api/summaries/${first}/playback`)
      .set(as(recipientId))
      .expect(200);
    expect(playback.body.url).toBe(`/api/summaries/${first}/audio`);
    const range = await api()
      .get(playback.body.url)
      .set(as(recipientId))
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(range.headers['content-range']).toBe('bytes 0-3/10');
    const cover = await api()
      .get(`/api/summaries/${first}/cover`)
      .set(as(recipientId))
      .expect(200);
    expect(cover.headers['cache-control']).toContain('no-store');
    await api()
      .get(`/api/items/${first}/cover`)
      .set(as(recipientId))
      .expect(404);
    const absProgress = await api()
      .get('/api/me/progress')
      .set(as(recipientId))
      .expect(200);
    expect(absProgress.body.mediaProgress).toEqual([]);

    await prisma.user.update({
      where: { id: recipientId },
      data: { planExpiresAt: new Date(0) },
    });
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(200);
    await api().delete(`/api/summaries/${first}`).set(as(ownerId)).expect(204);
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(404);
    await api()
      .post(`/api/summaries/${first}/restore`)
      .set(as(ownerId))
      .expect(200);
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(200);

    const libraryCreated = await api()
      .post('/api/shares')
      .set(as(ownerId))
      .send({ email: recipientEmail, scope: 'LIBRARY' });
    expect(libraryCreated.status).toBeLessThan(300);
    const sentAgain = await api()
      .get('/api/shares/sent')
      .set(as(ownerId))
      .expect(200);
    const library = sentAgain.body.find(
      (entry: { scope: string }) => entry.scope === 'LIBRARY',
    );
    expect(library).toBeDefined();
    expect(
      (
        await api()
          .post(`/api/shares/${library.id}/accept`)
          .set(as(recipientId))
      ).status,
    ).toBeLessThan(300);
    const later = await audio('Añadido después');
    const allShared = await api()
      .get('/api/shares/items')
      .set(as(recipientId))
      .expect(200);
    expect(
      allShared.body.map((entry: { id: string }) => entry.id).sort(),
    ).toEqual([first, second, later].sort());
    expect(
      (await api().delete(`/api/shares/${share.id}`).set(as(ownerId))).status,
    ).toBeLessThan(300);
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(200);
    const revoked = await api()
      .get('/api/shares/received')
      .set(as(recipientId))
      .expect(200);
    expect(
      revoked.body.find((entry: { id: string }) => entry.id === share.id)
        .summaries,
    ).toEqual([]);
    expect(
      (await api().delete(`/api/shares/${library.id}`).set(as(ownerId))).status,
    ).toBeLessThan(300);
    await api().get(`/api/summaries/${first}`).set(as(recipientId)).expect(404);
    await api().get(playback.body.url).set(as(recipientId)).expect(404);
    await api()
      .get(`/api/summaries/${first}/cover`)
      .set(as(recipientId))
      .expect(404);
    await api()
      .put(`/api/summaries/${first}/progress`)
      .set(as(recipientId))
      .send({ positionSeconds: 50 })
      .expect(404);
    await api()
      .post('/api/statistics/listening')
      .set(as(recipientId))
      .send({ id: randomUUID(), summaryId: first, durationMs: 2000 })
      .expect(404);
    const stats = await api()
      .get('/api/statistics/me')
      .set(as(recipientId))
      .expect(200);
    expect(stats.body.titles).toEqual([]);
  });

  it('elimina invitaciones pendientes dirigidas al borrar la cuenta destinataria', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Persona',
        email: erasedEmail,
        emailVerifiedAt: new Date(),
      },
    });
    const created = await api()
      .post('/api/shares')
      .set(as(ownerId))
      .send({ email: erasedEmail, scope: 'LIBRARY' })
      .expect(201);
    await app.get(AccountEraser).deleteAccount(user.id);
    const sent = await api()
      .get('/api/shares/sent')
      .set(as(ownerId))
      .expect(200);
    expect(sent.body.map((entry: { id: string }) => entry.id)).not.toContain(
      created.body.id,
    );
  });
});
