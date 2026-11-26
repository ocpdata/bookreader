import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { absCompatEnabled, mobileServerUrl } from '../abs/abs.constants';
import { ApiTokenService } from './api-token.service';
import { AppPasswordService } from './app-password.service';
import { AuthService } from './auth.service';
import { AppPasswordDto, ChangePasswordDto, DeleteAccountDto, LoginDto } from './auth.dto';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { SessionService, SESSION_DAYS } from './session.service';
import { readSessionToken } from './session-user.resolver';
import { cookieOptions } from './session-cookie';
import { SESSION_COOKIE } from './user.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly apiTokens: ApiTokenService,
    private readonly appPasswords: AppPasswordService,
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

  @Get('mobile-config')
  mobileConfig() {
    return { enabled: absCompatEnabled(), serverUrl: mobileServerUrl() };
  }

  /** Apps vinculadas (Absorb, AudioBooth...). Solo con la sesión web: un token de dispositivo no puede gestionarlos. */
  @Get('devices')
  devices(@CurrentUser() userId: string) {
    return this.apiTokens.list(userId);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async revokeDevice(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.apiTokens.revokeById(userId, id))) throw new NotFoundException('Dispositivo no encontrado');
  }

  @Delete('devices')
  @HttpCode(204)
  async revokeAllDevices(@CurrentUser() userId: string) {
    await this.apiTokens.revokeAll(userId);
  }

  /** Códigos de aplicación: el código solo se devuelve al crearlo. Como los dispositivos, solo con la sesión web. */
  @Get('app-passwords')
  listAppPasswords(@CurrentUser() userId: string) {
    return this.appPasswords.list(userId);
  }

  @Post('app-passwords')
  createAppPassword(@CurrentUser() userId: string, @Body() dto: AppPasswordDto) {
    return this.appPasswords.create(userId, dto.name);
  }

  @Delete('app-passwords/:id')
  @HttpCode(204)
  async revokeAppPassword(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.appPasswords.revoke(userId, id))) throw new NotFoundException('Código no encontrado');
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    const token = readSessionToken(req.headers);
    if (!token) throw new UnauthorizedException();
    await this.auth.changePassword(userId, token, dto.current, dto.next);
  }

  /** Aceptar la versión vigente de los términos y del aviso de privacidad (la web lo pide si cambió). */
  @Post('accept-terms')
  @HttpCode(200)
  acceptTerms(@CurrentUser() userId: string) {
    return this.auth.acceptTerms(userId);
  }

  /** Elimina la cuenta y todo su contenido, confirmando con la contraseña. Solo con la sesión web. */
  @Delete('account')
  @HttpCode(204)
  async deleteAccount(
    @CurrentUser() userId: string,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.deleteAccount(userId, dto.password, req.ip ?? 'desconocida');
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }
}
