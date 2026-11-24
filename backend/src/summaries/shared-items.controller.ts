import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';

@Controller('shares')
export class SharedItemsController {
  constructor(private readonly summaries: SummariesService) {}

  @Get('items')
  list(@CurrentUser() userId: string) {
    return this.summaries.listShared(userId);
  }
}
