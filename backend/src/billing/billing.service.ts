import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserPlan } from '@prisma/client';
// Stripe declara `export =`; sin esModuleInterop este es el único import con el valor y los tipos.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Stripe = require('stripe');
import { appUrl } from '../auth/registration.config';
import { PrismaService } from '../prisma/prisma.service';

/** Margen tras el fin del período pagado antes de bloquear subidas (reintentos de cobro, husos horarios). */
const GRACE_MS = 3 * 24 * 3600_000;
/** Estados de la suscripción con los que se mantiene el acceso premium. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type BillingPlan = 'monthly' | 'yearly';

/**
 * Suscripciones con Stripe Checkout: el servidor nunca ve tarjetas. El webhook es la fuente de verdad
 * del plan; `confirm` cubre el regreso del pago cuando el webhook aún no llegó (o en desarrollo local).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private client?: Stripe;

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_PRICE_MONTHLY_ID &&
      process.env.STRIPE_PRICE_YEARLY_ID,
    );
  }

  private get stripe(): Stripe {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        'Los pagos no están disponibles por ahora',
      );
    this.client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
    return this.client;
  }

  /** Crea la sesión de pago alojada por Stripe y devuelve su URL. */
  async checkout(userId: string, plan: BillingPlan) {
    const price =
      plan === 'yearly'
        ? process.env.STRIPE_PRICE_YEARLY_ID
        : process.env.STRIPE_PRICE_MONTHLY_ID;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, stripeCustomerId: true },
    });
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: userId,
      // El webhook identifica al usuario por estos metadatos, sin depender del orden de los eventos.
      subscription_data: { metadata: { userId } },
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email ?? undefined }),
      success_url: appUrl(
        '/cuenta?pago=exitoso&session_id={CHECKOUT_SESSION_ID}',
      ),
      cancel_url: appUrl('/cuenta?pago=cancelado'),
    });
    if (!session.url)
      throw new ServiceUnavailableException(
        'Stripe no devolvió la página de pago',
      );
    return { url: session.url };
  }

  /** Portal de Stripe para cambiar la tarjeta, ver facturas o cancelar. */
  async portal(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user.stripeCustomerId)
      throw new NotFoundException('Esta cuenta no tiene una suscripción');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: appUrl('/cuenta'),
    });
    return { url: session.url };
  }

  /** Al volver del pago: confirma la sesión directamente con Stripe (no se confía en el navegador). */
  async confirm(userId: string, sessionId: string) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
    if (session.client_reference_id !== userId)
      throw new NotFoundException('Sesión de pago no encontrada');
    const subscription = session.subscription as Stripe.Subscription | null;
    if (session.status !== 'complete' || !subscription) {
      throw new BadRequestException('El pago no se completó');
    }
    await this.applySubscription(subscription, userId);
    return { plan: UserPlan.PREMIUM };
  }

  /** Punto de entrada del webhook: la firma garantiza que el evento viene de Stripe. */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException('Webhook no configurado');
    if (!rawBody || !signature)
      throw new BadRequestException('Petición no válida');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Firma no válida');
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const customer =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id;
      if (userId && customer) await this.saveCustomer(userId, customer);
    } else if (event.type.startsWith('customer.subscription.')) {
      await this.applySubscription(event.data.object as Stripe.Subscription);
    }
    return { received: true };
  }

  private async saveCustomer(userId: string, customerId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  /** Refleja el estado de la suscripción en el plan de la cuenta. */
  private async applySubscription(
    subscription: Stripe.Subscription,
    knownUserId?: string,
  ) {
    const userId = knownUserId ?? subscription.metadata?.userId;
    if (!userId) {
      this.logger.warn(
        `Suscripción ${subscription.id} sin usuario en los metadatos; se ignora`,
      );
      return;
    }
    const customer =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;
    // El fin de período vive en la suscripción o, en versiones recientes de la API, en su elemento.
    const sub = subscription as Stripe.Subscription & {
      current_period_end?: number;
    };
    const periodEnd =
      sub.current_period_end ??
      subscription.items?.data?.[0]?.current_period_end;
    const active =
      ACTIVE_STATUSES.has(subscription.status) && typeof periodEnd === 'number';
    const updated = await this.prisma.user.updateMany({
      where: { id: userId },
      data: active
        ? {
            plan: UserPlan.PREMIUM,
            planExpiresAt: new Date(periodEnd! * 1000 + GRACE_MS),
            ...(customer ? { stripeCustomerId: customer } : {}),
          }
        : { plan: UserPlan.PREMIUM, planExpiresAt: new Date() },
    });
    if (!updated.count)
      this.logger.warn(
        `Suscripción ${subscription.id} de un usuario inexistente: ${userId}`,
      );
    else
      this.logger.log(
        `Plan actualizado por Stripe: usuario ${userId}, estado ${subscription.status}`,
      );
  }
}
