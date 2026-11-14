import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SingleUserResolver } from './single-user.resolver';
import { USER_RESOLVER } from './user.constants';
import { UserGuard } from './user.guard';

@Module({
  providers: [
    { provide: USER_RESOLVER, useClass: SingleUserResolver },
    { provide: APP_GUARD, useClass: UserGuard },
  ],
})
export class AuthModule {}
