import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuotaService } from './quota.service';

@Controller('usage')
export class QuotaController {
  constructor(private readonly quota: QuotaService) {}

  /** Espacio y número de audios usados frente a la cuota de la cuenta. */
  @Get()
  usage(@CurrentUser() userId: string) {
    return this.quota.usage(userId);
  }
}
