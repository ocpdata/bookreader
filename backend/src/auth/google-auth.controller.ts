import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import { GoogleAuthService, GoogleStart } from './google-auth.service';
import { GoogleAuthError } from './google-oauth.client';
import { Public } from './public.decorator';
import { cookieOptions } from './session-cookie';
import { SESSION_DAYS, SessionService } from './session.service';
import { readSessionToken } from './session-user.resolver';
import { SESSION_COOKIE } from './user.constants';

const FLOW_COOKIE = 'br_google';
const FLOW_COOKIE_PATH = '/api/auth/google';

const flowCookieOptions = () => ({ ...cookieOptions(), path: FLOW_COOKIE_PATH });
const failure = (error: unknown) => {
  const code = error instanceof GoogleAuthError ? error.code : 'invalid';
  return error instanceof GoogleAuthError && error.reauth ? `/cuenta?reauth=${code}` : `/entrar?error=google_${code}`;
};

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name && value.length) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** Acceso y registro con Google: son redirecciones del navegador, no llamadas de la API. */
@Controller('auth/google')
export class GoogleAuthController {
  private readonly logger = new Logger(GoogleAuthController.name);

  constructor(
    private readonly google: GoogleAuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get('start')
  start(@Query('from') from: string | undefined, @Query('plan') plan: string | undefined, @Req() req: Request, @Res() res: Response) {
    const options: GoogleStart = {
      ...(from === 'share' ? { source: 'share' as const } : {}),
      ...(plan === 'monthly' || plan === 'yearly' ? { plan } : {}),
    };
    try {
      const { url, state } = this.google.start(req.ip ?? 'desconocida', options);
      res.cookie(FLOW_COOKIE, state, { ...flowCookieOptions(), maxAge: 10 * 60 * 1000 });
      res.redirect(url);
    } catch (error) {
      res.redirect(failure(error));
    }
  }

  /** Con sesión: vuelve a identificar a la persona con Google para confirmar eliminar la cuenta (no abre otra sesión). */
  @Get('reauth')
  async reauth(@CurrentUser() userId: string, @Req() req: Request, @Res() res: Response) {
    try {
      const { url, state } = await this.google.startReauth(req.ip ?? 'desconocida', userId);
      res.cookie(FLOW_COOKIE, state, { ...flowCookieOptions(), maxAge: 10 * 60 * 1000 });
      res.redirect(url);
    } catch (error) {
      res.redirect(failure(error));
    }
  }

  @Public()
  @Get('callback')
  async callback(@Query() query: { code?: string; state?: string; error?: string }, @Req() req: Request, @Res() res: Response) {
    res.clearCookie(FLOW_COOKIE, flowCookieOptions());
    try {
      const strings = Object.fromEntries(Object.entries(query).filter(([, value]) => typeof value === 'string'));
      const sessionToken = readSessionToken(req.headers);
      const current = sessionToken ? await this.sessions.resolve(sessionToken) : null;
      const { session, destination } = await this.google.finish(req.ip ?? 'desconocida', strings, readCookie(req, FLOW_COOKIE), current?.userId);
      if (session) res.cookie(SESSION_COOKIE, session.token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
      res.redirect(destination);
    } catch (error) {
      if (!(error instanceof GoogleAuthError)) this.logger.error(`Acceso con Google: ${(error as Error).message}`);
      res.redirect(failure(error));
    }
  }
}
