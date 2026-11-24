import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { PurgeService } from './purge.service';
import { HashBackfillService } from './hash-backfill.service';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { TrashController } from './trash.controller';
import { CategoriesModule } from '../categories/categories.module';
import { DriveService } from './drive.service';
import { SharingModule } from '../sharing/sharing.module';
import { SharedItemsController } from './shared-items.controller';

@Module({
  imports: [CategoriesModule, SharingModule],
  controllers: [SummariesController, HomeController, TrashController, SharedItemsController],
  providers: [SummariesService, PurgeService, HashBackfillService, DriveService],
  exports: [SummariesService],
})
export class SummariesModule {}
