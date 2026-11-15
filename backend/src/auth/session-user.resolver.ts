import { Injectable } from '@nestjs/common';
import { SessionService } from './session.service';
import { SESSION_COOKIE, UserResolver } from './user.constants';

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

@Injectable()
export class SessionUserResolver implements UserResolver {
  constructor(private readonly sessions: SessionService) {}

  async resolve(request: { headers: Record<string, unknown> }): Promise<string | undefined> {
    const token = readSessionToken(request.headers);
    if (!token) return undefined;
    return (await this.sessions.resolve(token))?.userId;
  }
}
