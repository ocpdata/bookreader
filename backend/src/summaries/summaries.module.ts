import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';

@Module({
  controllers: [SummariesController, HomeController],
  providers: [SummariesService],
})
export class SummariesModule {}
