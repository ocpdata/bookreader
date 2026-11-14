import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { CategoriesModule } from './categories/categories.module';
import { SummariesModule } from './summaries/summaries.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    CategoriesModule,
    SummariesModule,
  ],
})
export class AppModule {}
