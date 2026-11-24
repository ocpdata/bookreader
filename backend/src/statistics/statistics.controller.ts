import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StatisticsService } from './statistics.service';
import { ResourcesService } from './resources.service';

class ListeningEventDto {
  @IsUUID('4')
  id!: string;

  @IsUUID()
  summaryId!: string;

  @IsInt()
  @Min(1)
  @Max(60000)
  durationMs!: number;
}

@Controller('statistics')
export class StatisticsController {
  constructor(
    private readonly statistics: StatisticsService,
    private readonly resources: ResourcesService,
  ) {}

  @Get('admin/resources')
  resourcesOverview(
    @CurrentUser() userId: string,
    @Query('period') period?: string,
  ) {
    return this.resources.get(userId, period);
  }

  @Post('listening')
  @HttpCode(204)
  async record(
    @CurrentUser() userId: string,
    @Body() event: ListeningEventDto,
  ) {
    await this.statistics.record(userId, event);
  }

  @Get('me')
  mine(@CurrentUser() userId: string, @Query('period') period?: string) {
    return this.statistics.personal(userId, period);
  }

  @Get('admin')
  admin(@CurrentUser() userId: string, @Query('period') period?: string) {
    return this.statistics.overview(userId, period);
  }

  @Get('admin/users/:id')
  user(
    @CurrentUser() actorId: string,
    @Param('id', ParseUUIDPipe) userId: string,
    @Query('period') period?: string,
  ) {
    return this.statistics.adminUser(actorId, userId, period);
  }
}
