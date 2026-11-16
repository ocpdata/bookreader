import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { PurgeService } from './purge.service';
import { HashBackfillService } from './hash-backfill.service';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { TrashController } from './trash.controller';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [CategoriesModule],
  controllers: [SummariesController, HomeController, TrashController],
  providers: [SummariesService, PurgeService, HashBackfillService],
  exports: [SummariesService],
})
export class SummariesModule {}
