import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AccountEraser } from './account-eraser';

@Global()
@Module({
  providers: [
    {
      provide: AccountEraser,
      inject: [PrismaService, StorageService],
      useFactory: (prisma: PrismaService, storage: StorageService) => new AccountEraser(prisma, storage),
    },
  ],
  exports: [AccountEraser],
})
export class AccountsModule {}
