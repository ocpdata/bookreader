import { Injectable } from '@nestjs/common';
import { ApiTokenService } from './api-token.service';
import { SessionService } from './session.service';
import { SESSION_COOKIE, UserRequest, UserResolver } from './user.constants';

/** Lee el token de la cookie de sesión. Con Cognito, este es el único punto que cambia. */
export function readSessionToken(headers: Record<string, unknown>): string | undefined {
  const cookie = headers.cookie;
  if (typeof cookie !== 'string') return undefined;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value.length) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function readBearerToken(headers: Record<string, unknown>): string | undefined {
  const header = headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1];
}

// Las apps piden portadas y descargas con ?token= porque cargan imágenes y archivos sin poder añadir cabeceras.
const QUERY_TOKEN_PATH = /^\/api\/items\/[^/]+\/(cover|file\/[^/]+(\/download)?)$/;

@Injectable()
export class SessionUserResolver implements UserResolver {
  constructor(
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  async resolve(request: UserRequest): Promise<string | undefined> {
    const sessionToken = readSessionToken(request.headers);
    if (sessionToken) {
      const session = await this.sessions.resolve(sessionToken);
      if (session) return session.userId;
    }
    let deviceToken = readBearerToken(request.headers);
    if (!deviceToken && (request.method === 'GET' || request.method === 'HEAD') && request.path && QUERY_TOKEN_PATH.test(request.path)) {
      const queryToken = request.query?.token;
      if (typeof queryToken === 'string') deviceToken = queryToken;
    }
    if (!deviceToken) return undefined;
    const resolved = await this.apiTokens.resolve(deviceToken);
    if (!resolved) return undefined;
    request.apiToken = true;
    return resolved.userId;
  }
}
