import { Injectable } from '@nestjs/common';
import { CheckoutPlan, User, UserPlan, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { billingConfigured } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReauthService } from './reauth.service';
import { GoogleAuthError, GoogleClaims, GoogleOAuthClient, googleConfigured } from './google-oauth.client';
import { HOUR_MS, SlidingWindowLimiter } from './rate-limiter';
import { appUrl, registrationMode, TERMS_VERSION } from './registration.config';
import { RegistrationService } from './registration.service';
import { SessionService } from './session.service';

const PROVIDER = 'google';
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_FLOWS = 5000;
const MAX_REQUESTS_PER_IP_PER_HOUR = 40;

export type GoogleSource = 'share';
export type GoogleStart = { source?: GoogleSource; plan?: 'monthly' | 'yearly' };

interface Flow extends GoogleStart {
  nonce: string;
  verifier: string;
  startedAt: number;
  expiresAt: number;
  /** Si está, el intento no abre sesión: confirma que esta persona es la dueña de la cuenta. */
  reauthUserId?: string;
}

// Margen entre el reloj de Google y el nuestro al comprobar que la autenticación fue después de iniciar el intento.
const CLOCK_SKEW_S = 10;

const base64url = (buffer: Buffer) => buffer.toString('base64url');
export const googleRedirectUri = () => appUrl('/api/auth/google/callback');

/**
 * Acceso y registro con Google (OpenID Connect, código de autorización con PKCE). El estado de cada intento vive en
 * memoria (una sola instancia) y la cookie del navegador solo lleva su identificador: así el regreso de Google solo
 * vale en el navegador que lo inició. Google debe confirmar el correo; la persona se reconoce por el `sub`.
 */
@Injectable()
export class GoogleAuthService {
  private readonly flows = new Map<string, Flow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleOAuthClient,
    private readonly registration: RegistrationService,
    private readonly sessions: SessionService,
    private readonly limiter: SlidingWindowLimiter,
    private readonly reauth: ReauthService,
  ) {}

  private limit(ip: string) {
    if (!this.limiter.allow(`google:ip:${ip}`, MAX_REQUESTS_PER_IP_PER_HOUR, HOUR_MS)) throw new GoogleAuthError('too_many');
  }

  /** Prepara un intento y devuelve la URL de Google y el identificador que debe guardar la cookie. */
  start(ip: string, options: GoogleStart & { reauthUserId?: string }) {
    if (!googleConfigured()) throw new GoogleAuthError('unavailable');
    this.limit(ip);
    const now = Date.now();
    for (const [id, flow] of this.flows) if (flow.expiresAt <= now) this.flows.delete(id);
    if (this.flows.size >= MAX_FLOWS) throw new GoogleAuthError('too_many');

    const state = base64url(randomBytes(24));
    const flow: Flow = { ...options, nonce: base64url(randomBytes(24)), verifier: base64url(randomBytes(32)), startedAt: now, expiresAt: now + FLOW_TTL_MS };
    this.flows.set(state, flow);

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce: flow.nonce,
      code_challenge: base64url(createHash('sha256').update(flow.verifier).digest()),
      code_challenge_method: 'S256',
      // Para confirmar una acción se obliga a autenticarse de nuevo, aunque ya haya sesión en Google.
      ...(options.reauthUserId ? { prompt: 'login', max_age: '0' } : { prompt: 'select_account' }),
    }).toString();
    return { url: url.toString(), state };
  }

  /** Prepara la confirmación con Google de la persona que ya tiene sesión (para eliminar su cuenta). */
  async startReauth(ip: string, userId: string) {
    const identity = await this.prisma.userIdentity.findFirst({ where: { userId, provider: PROVIDER }, select: { id: true } });
    if (!identity) throw new GoogleAuthError('no_google', true);
    try {
      return this.start(ip, { reauthUserId: userId });
    } catch (error) {
      throw error instanceof GoogleAuthError ? new GoogleAuthError(error.code, true) : error;
    }
  }

  /**
   * Completa el intento: valida el regreso de Google. Un inicio de sesión devuelve la sesión y el destino dentro de la
   * web; una confirmación solo registra que `sessionUserId` se reautenticó.
   */
  async finish(ip: string, query: { code?: string; state?: string; error?: string }, cookieState?: string, sessionUserId?: string) {
    const flow = query.state ? this.flows.get(query.state) : undefined;
    if (query.state) this.flows.delete(query.state);
    try {
      return await this.complete(ip, query, flow, cookieState, sessionUserId);
    } catch (error) {
      throw error instanceof GoogleAuthError && flow?.reauthUserId ? new GoogleAuthError(error.code, true) : error;
    }
  }

  private async complete(
    ip: string,
    query: { code?: string; state?: string; error?: string },
    flow: Flow | undefined,
    cookieState: string | undefined,
    sessionUserId: string | undefined,
  ) {
    this.limit(ip);
    if (!flow || flow.expiresAt <= Date.now() || !cookieState || cookieState !== query.state) throw new GoogleAuthError('invalid');
    if (query.error) throw new GoogleAuthError(query.error === 'access_denied' ? 'cancelled' : 'invalid');
    if (!query.code) throw new GoogleAuthError('invalid');

    const claims = await this.google.exchange(query.code, flow.verifier, googleRedirectUri(), flow.nonce);
    if (flow.reauthUserId) return this.confirm(claims, flow, flow.reauthUserId, sessionUserId);

    if (!claims.emailVerified) throw new GoogleAuthError('unverified_email');
    const user = await this.resolveUser(claims, flow);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await this.sessions.create(user.id);
    return { session, destination: flow.plan ? `/cuenta?checkout=${flow.plan}` : flow.source === 'share' ? '/invitaciones' : '/' };
  }

  /** La confirmación vale solo si es la misma sesión, la misma cuenta de Google ligada a esa persona y una autenticación nueva. */
  private async confirm(claims: GoogleClaims, flow: Flow, userId: string, sessionUserId?: string) {
    if (sessionUserId !== userId) throw new GoogleAuthError('invalid');
    if (claims.authTime === undefined || claims.authTime + CLOCK_SKEW_S < flow.startedAt / 1000) throw new GoogleAuthError('invalid');
    const identity = await this.prisma.userIdentity.findUnique({ where: { provider_subject: { provider: PROVIDER, subject: claims.sub } } });
    if (identity?.userId !== userId) throw new GoogleAuthError('invalid');
    this.reauth.grant(userId);
    return { session: undefined, destination: '/cuenta?reauth=ok' };
  }

  private async resolveUser(claims: GoogleClaims, flow: GoogleStart): Promise<User> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: PROVIDER, subject: claims.sub } },
      include: { user: true },
    });
    if (identity) return this.assertUsable(identity.user);

    const existing = await this.prisma.user.findUnique({ where: { email: claims.email } });
    if (!existing) {
      if (registrationMode() !== 'open') throw new GoogleAuthError('closed');
      return this.createUser(claims, flow);
    }
    this.assertUsable(existing);

    let user = existing;
    if (existing.status === UserStatus.PENDING) {
      // Google demostró que el correo es de esta persona. La contraseña de una cuenta sin verificar se descarta: la
      // pudo fijar quien se adelantó con ese correo.
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          passwordHash: null,
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          ...(existing.pendingCheckoutPlan ? {} : { plan: UserPlan.TRIAL, planExpiresAt: await this.registration.claimTrial(existing.email) }),
        },
      });
    } else if (!existing.emailVerifiedAt) {
      user = await this.prisma.user.update({ where: { id: existing.id }, data: { emailVerifiedAt: new Date() } });
    }
    await this.link(user.id, claims.sub);
    return user;
  }

  private assertUsable(user: User) {
    if (user.status === UserStatus.SUSPENDED) throw new GoogleAuthError('suspended');
    return user;
  }

  private async link(userId: string, subject: string) {
    try {
      await this.prisma.userIdentity.create({ data: { userId, provider: PROVIDER, subject } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }

  private async createUser(claims: GoogleClaims, flow: GoogleStart): Promise<User> {
    const checkout = flow.plan && billingConfigured() ? (flow.plan === 'monthly' ? CheckoutPlan.MONTHLY : CheckoutPlan.YEARLY) : null;
    try {
      return await this.prisma.user.create({
        data: {
          email: claims.email,
          name: (claims.name?.trim() || claims.email.split('@')[0]).slice(0, 100),
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          ...(checkout
            ? { plan: UserPlan.NONE, pendingCheckoutPlan: checkout }
            : { plan: UserPlan.TRIAL, planExpiresAt: await this.registration.claimTrial(claims.email) }),
          identities: { create: { provider: PROVIDER, subject: claims.sub } },
        },
      });
    } catch (error) {
      // Otra petición creó la cuenta a la vez: se usa esa.
      if ((error as { code?: string }).code === 'P2002') {
        const raced = await this.prisma.user.findUnique({ where: { email: claims.email } });
        if (raced) {
          this.assertUsable(raced);
          await this.link(raced.id, claims.sub);
          return raced;
        }
      }
      throw error;
    }
  }
}
