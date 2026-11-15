import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';

@Controller('home')
export class HomeController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  home(@CurrentUser() userId: string) {
    return this.summaries.home(userId);
  }
}
