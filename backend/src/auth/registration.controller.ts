import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from './public.decorator';
import { registrationMode } from './registration.config';
import { EmailDto, RegisterDto, ResetPasswordDto, TokenDto, VerificationEmailDto } from './registration.dto';
import { RegistrationService } from './registration.service';

const GENERIC = {
  register: 'Si el correo es válido, te enviamos un enlace para verificar tu cuenta. Revisa tu bandeja (y el spam).',
  link: 'Si el correo corresponde a una cuenta, te enviamos las instrucciones. Revisa tu bandeja (y el spam).',
};

/** Registro, verificación de correo y recuperación de contraseña. Todo es público; las respuestas no delatan qué correos existen. */
@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /** Lo que la pantalla de acceso necesita saber: si se puede crear cuenta y si pide invitación. */
  @Public()
  @Get('config')
  config() {
    return { registration: registrationMode() };
  }

  @Public()
  @Post('register')
  @HttpCode(202)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    await this.registration.register(dto, req.ip ?? 'desconocida');
    return { message: GENERIC.register };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  async resend(@Body() dto: VerificationEmailDto, @Req() req: Request) {
    await this.registration.resendVerification(dto.email, req.ip ?? 'desconocida', dto.source);
    return { message: GENERIC.link };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verify(@Body() dto: TokenDto) {
    await this.registration.verifyEmail(dto.token);
    return { message: 'Correo verificado. Ya puedes entrar.' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body() dto: EmailDto, @Req() req: Request) {
    await this.registration.forgotPassword(dto.email, req.ip ?? 'desconocida');
    return { message: GENERIC.link };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async reset(@Body() dto: ResetPasswordDto) {
    await this.registration.resetPassword(dto.token, dto.password);
    return { message: 'Contraseña actualizada. Ya puedes entrar con la nueva.' };
  }
}
