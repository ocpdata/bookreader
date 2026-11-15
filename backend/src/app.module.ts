import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AbsCompatModule } from './abs/abs.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { FoldersModule } from './folders/folders.module';
import { TagsModule } from './tags/tags.module';
import { CategoriesModule } from './categories/categories.module';
import { SummariesModule } from './summaries/summaries.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    PrismaModule,
    StorageModule,
    TagsModule,
    FoldersModule,
    CategoriesModule,
    SummariesModule,
    ...(process.env.ABS_COMPAT_ENABLED === 'false' ? [] : [AbsCompatModule]),
  ],
  controllers: [HealthController],
})
export class AppModule {}
