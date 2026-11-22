import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokenService } from './api-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailTokenService } from './email-token.service';
import { InvitationService } from './invitation.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { OriginGuard } from './origin.guard';
import { PasswordService } from './password.service';
import { SlidingWindowLimiter } from './rate-limiter';
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
  controllers: [AuthController, RegistrationController, AdminController],
  providers: [
    AuthService,
    AdminService,
    PasswordService,
    SessionService,
    ApiTokenService,
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
  exports: [AuthService, AdminService, ApiTokenService, LoginRateLimiter],
})
export class AuthModule {}
