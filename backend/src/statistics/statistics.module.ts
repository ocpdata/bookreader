import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { SharingModule } from '../sharing/sharing.module';
import { ResourcesService } from './resources.service';

@Module({
  imports: [SharingModule],
  controllers: [StatisticsController],
  providers: [StatisticsService, ResourcesService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
