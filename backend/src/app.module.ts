import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AbsCompatModule } from './abs/abs.module';
import { absCompatEnabled } from './abs/abs.constants';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { QuotaModule } from './quota/quota.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { FoldersModule } from './folders/folders.module';
import { TagsModule } from './tags/tags.module';
import { CategoriesModule } from './categories/categories.module';
import { SummariesModule } from './summaries/summaries.module';
import { HealthController } from './health/health.controller';
import { BillingModule } from './billing/billing.module';
import { StatisticsModule } from './statistics/statistics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    PrismaModule,
    MailModule,
    QuotaModule,
    AccountsModule,
    StorageModule,
    TagsModule,
    FoldersModule,
    CategoriesModule,
    SummariesModule,
    StatisticsModule,
    BillingModule,
    ...(absCompatEnabled() ? [AbsCompatModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
