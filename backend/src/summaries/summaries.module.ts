import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { PurgeService } from './purge.service';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { TrashController } from './trash.controller';

@Module({
  controllers: [SummariesController, HomeController, TrashController],
  providers: [SummariesService, PurgeService],
  exports: [SummariesService],
})
export class SummariesModule {}
