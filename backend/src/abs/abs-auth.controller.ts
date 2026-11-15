import { BadRequestException, Body, Controller, Get, HttpCode, Post, Redirect, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AllowApiToken } from '../auth/allow-api-token.decorator';
import { AuthService } from '../auth/auth.service';
import { ApiTokenService } from '../auth/api-token.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { readBearerToken } from '../auth/session-user.resolver';
import { ABS_VERSION } from './abs.constants';
import { AbsService } from './abs.service';

/** Conexión y sesión de las apps compatibles. Las rutas públicas viven en la raíz (fuera de /api). */
@AllowApiToken()
@Controller()
export class AbsAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly apiTokens: ApiTokenService,
    private readonly abs: AbsService,
  ) {}

  @Public()
  @Get('ping')
  ping() {
    return { success: true };
  }

  @Public()
  @Get('status')
  status() {
    return {
      app: 'bookreader',
      serverVersion: ABS_VERSION,
      isInit: true,
      language: 'es',
      authMethods: ['local'],
      authFormData: { authLoginCustomMessage: 'Entra con el correo y la contraseña de tu cuenta de BookReader' },
    };
  }

  /** La pantalla web de acceso vive en /entrar; /login queda para las apps (POST). */
  @Public()
  @Get('login')
  @Redirect('/entrar', 302)
  loginPage() {
    return;
  }

  /** El "usuario" de las apps es el correo de la cuenta. Devuelve un token de dispositivo revocable. */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const { username, password } = body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new BadRequestException('Indica usuario y contraseña');
    }
    const { token, user } = await this.auth.loginDevice(
      username,
      password,
      req.ip ?? 'desconocida',
      String(req.headers['user-agent'] ?? 'Dispositivo'),
    );
    return this.abs.authorize(user.id, token);
  }

  /** Revoca el token del dispositivo; es público para que funcione aunque el token ya no sea válido. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    const token = readBearerToken(req.headers);
    if (token) await this.apiTokens.revoke(token);
    return {};
  }

  @Post('authorize')
  @HttpCode(200)
  authorize(@CurrentUser() userId: string, @Req() req: Request) {
    return this.abs.authorize(userId, readBearerToken(req.headers));
  }

  @Get('me')
  me(@CurrentUser() userId: string, @Req() req: Request) {
    return this.abs.userPayload(userId, readBearerToken(req.headers));
  }
}
