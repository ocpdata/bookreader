import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { ResourcesService } from './resources.service';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, ResourcesService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
