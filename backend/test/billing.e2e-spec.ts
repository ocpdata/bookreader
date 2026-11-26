import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
// Stripe declara `export =`; sin esModuleInterop este es el único import con el valor y los tipos.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Stripe = require('stripe');
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StorageService } from '../src/storage/storage.service';

const WEBHOOK_SECRET = 'whsec_prueba_firmas';

/** Evento de suscripción con la forma mínima que usa el webhook. */
function subscriptionEvent(
  type: string,
  subscription: Record<string, unknown>,
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    data: { object: { object: 'subscription', ...subscription } },
  };
}

describe('Cobros con Stripe (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stripe = new Stripe('sk_test_firmas_localmente');
  const emails: string[] = [];
  let counter = 0;

  const api = () => request(app.getHttpServer());

  async function createUser() {
    const email = `cliente${++counter}-${Date.now()}@billing.test`;
    emails.push(email);
    return prisma.user.create({
      data: {
        email,
        name: `Cliente ${counter}`,
        plan: 'TRIAL',
        planExpiresAt: new Date(),
      },
    });
  }

  function signedPost(payload: object, secret = WEBHOOK_SECRET) {
    const body = JSON.stringify(payload);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });
    return api()
      .post('/api/billing/webhook')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(body);
  }

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_firmas_localmente';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_PRICE_MONTHLY_ID = 'price_mensual';
    process.env.STRIPE_PRICE_YEARLY_ID = 'price_anual';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue({})
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_MONTHLY_ID;
    delete process.env.STRIPE_PRICE_YEARLY_ID;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('exige sesión en checkout, portal y confirm; el webhook es público pero exige firma válida', async () => {
    await api()
      .post('/api/billing/checkout')
      .send({ plan: 'monthly' })
      .expect(401);
    await api().post('/api/billing/portal').expect(401);
    await api().post('/api/billing/confirm').send({}).expect(401);
    await api().get('/api/billing/config').expect(200).expect({ enabled: true });

    await api().post('/api/billing/webhook').send({}).expect(400);
    const res = await signedPost(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_x',
        status: 'active',
      }),
      'whsec_otro',
    );
    expect(res.status).toBe(400);
  });

  it('una suscripción activa da Premium con margen de gracia y guarda el cliente de Stripe', async () => {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'NONE', pendingCheckoutPlan: 'YEARLY' },
    });
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const res = await signedPost(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_activa',
        status: 'active',
        customer: 'cus_cliente1',
        metadata: { userId: user.id },
        current_period_end: periodEnd,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updated.plan).toBe('PREMIUM');
    expect(updated.pendingCheckoutPlan).toBeNull();
    expect(updated.stripeCustomerId).toBe('cus_cliente1');
    const graceDays =
      (updated.planExpiresAt!.getTime() - periodEnd * 1000) / 86400_000;
    expect(graceDays).toBeCloseTo(3, 1);
  });

  it('lee el fin de período desde el elemento de la suscripción (API nueva de Stripe)', async () => {
    const user = await createUser();
    const periodEnd = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await signedPost(
      subscriptionEvent('customer.subscription.created', {
        id: 'sub_items',
        status: 'active',
        metadata: { userId: user.id },
        items: { data: [{ current_period_end: periodEnd }] },
      }),
    ).expect(200);
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updated.plan).toBe('PREMIUM');
    expect(updated.planExpiresAt!.getTime()).toBeGreaterThan(periodEnd * 1000);
  });

  it('una suscripción cancelada bloquea de inmediato y no puede tocar a otros usuarios', async () => {
    const user = await createUser();
    const other = await createUser();
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    await signedPost(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_c',
        status: 'active',
        metadata: { userId: user.id },
        current_period_end: periodEnd,
      }),
    ).expect(200);
    await signedPost(
      subscriptionEvent('customer.subscription.deleted', {
        id: 'sub_c',
        status: 'canceled',
        metadata: { userId: user.id },
        current_period_end: periodEnd,
      }),
    ).expect(200);
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updated.plan).toBe('PREMIUM');
    expect(updated.planExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());

    // Sin usuario en los metadatos (o con uno inexistente) el evento se acepta sin tocar nada.
    await signedPost(
      subscriptionEvent('customer.subscription.updated', {
        id: 'sub_anon',
        status: 'active',
      }),
    ).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).plan,
    ).toBe('TRIAL');
  });
});
