import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { SessionService, SESSION_DAYS } from './session.service';
import { readSessionToken } from './session-user.resolver';
import { SESSION_COOKIE } from './user.constants';

const cookieOptions = () => ({
  httpOnly: true,
  // En producción (HTTPS) la cookie solo viaja cifrada; en desarrollo local (http) no puede ser Secure.
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { session, user } = await this.auth.login(dto.email, dto.password, req.ip ?? 'desconocida', req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, session.token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
    return user;
  }

  /** Público: cerrar sesión debe funcionar aunque la sesión ya haya caducado. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readSessionToken(req.headers);
    if (token) await this.sessions.destroy(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }

  @Get('me')
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    const token = readSessionToken(req.headers);
    if (!token) throw new UnauthorizedException();
    await this.auth.changePassword(userId, token, dto.current, dto.next);
  }
}
