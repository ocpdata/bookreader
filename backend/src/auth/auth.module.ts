import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { OriginGuard } from './origin.guard';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { SessionUserResolver } from './session-user.resolver';
import { USER_RESOLVER } from './user.constants';
import { UserGuard } from './user.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    LoginRateLimiter,
    { provide: USER_RESOLVER, useClass: SessionUserResolver },
    // Primero el origen (CSRF) y después la sesión.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: UserGuard },
  ],
})
export class AuthModule {}
