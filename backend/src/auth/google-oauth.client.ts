import { Injectable } from '@nestjs/common';

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /** Momento (segundos Unix) en que la persona se autenticó en Google; solo lo devuelve si se pidió reautenticar. */
  authTime?: number;
}

export class GoogleAuthError extends Error {
  constructor(
    readonly code: 'unavailable' | 'invalid' | 'unverified_email' | 'closed' | 'suspended' | 'too_many' | 'cancelled' | 'no_google',
    /** true si falló una reautenticación (confirmar una acción), no un inicio de sesión. */
    readonly reauth = false,
  ) {
    super(code);
  }
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);

const decodePayload = (jwt: string): Record<string, unknown> | null => {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
};

/**
 * Cambia el código de autorización por la identidad de la persona. El ID token llega directamente del endpoint de
 * Google por TLS, así que (según OpenID Connect) basta con comprobar sus datos sin validar la firma.
 */
@Injectable()
export class GoogleOAuthClient {
  async exchange(code: string, verifier: string, redirectUri: string, nonce: string): Promise<GoogleClaims> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new GoogleAuthError('unavailable');

    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GoogleAuthError('unavailable');
    }
    if (!response.ok) throw new GoogleAuthError('invalid');
    const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
    const claims = typeof body?.id_token === 'string' ? decodePayload(body.id_token) : null;
    if (!claims) throw new GoogleAuthError('invalid');

    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const valid =
      (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com') &&
      audience.includes(clientId) &&
      typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() &&
      claims.nonce === nonce &&
      typeof claims.sub === 'string' && claims.sub !== '' &&
      typeof claims.email === 'string' && claims.email !== '';
    if (!valid) throw new GoogleAuthError('invalid');
    return {
      sub: claims.sub as string,
      email: (claims.email as string).trim().toLowerCase(),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : undefined,
      authTime: typeof claims.auth_time === 'number' ? claims.auth_time : undefined,
    };
  }
}
