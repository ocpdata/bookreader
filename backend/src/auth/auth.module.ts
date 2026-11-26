import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokenService } from './api-token.service';
import { AppPasswordService } from './app-password.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailTokenService } from './email-token.service';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { InvitationService } from './invitation.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { OriginGuard } from './origin.guard';
import { PasswordService } from './password.service';
import { SlidingWindowLimiter } from './rate-limiter';
import { ReauthService } from './reauth.service';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SessionService } from './session.service';
import { SessionUserResolver } from './session-user.resolver';
import { USER_RESOLVER } from './user.constants';
import { UserGuard } from './user.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Global()
@Module({
  controllers: [AuthController, RegistrationController, GoogleAuthController, AdminController],
  providers: [
    AuthService,
    AdminService,
    PasswordService,
    SessionService,
    ApiTokenService,
    AppPasswordService,
    ReauthService,
    GoogleOAuthClient,
    GoogleAuthService,
    EmailTokenService,
    InvitationService,
    RegistrationService,
    SlidingWindowLimiter,
    LoginRateLimiter,
    { provide: USER_RESOLVER, useClass: SessionUserResolver },
    // Primero el origen (CSRF) y después la sesión.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: UserGuard },
  ],
  exports: [AuthService, AdminService, ApiTokenService, LoginRateLimiter, SlidingWindowLimiter],
})
export class AuthModule {}
