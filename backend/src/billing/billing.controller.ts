import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { BillingPlan, BillingService } from './billing.service';

class CheckoutDto {
  @IsIn(['monthly', 'yearly'])
  plan!: BillingPlan;
}

class ConfirmDto {
  @IsOptional()
  @IsString()
  @Matches(/^cs_[A-Za-z0-9_]{10,200}$/)
  sessionId?: string;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('config')
  @Public()
  config() {
    return { enabled: this.billing.enabled };
  }

  @Post('checkout')
  @HttpCode(200)
  checkout(@CurrentUser() userId: string, @Body() dto: CheckoutDto) {
    return this.billing.checkout(userId, dto.plan);
  }

  @Post('portal')
  @HttpCode(200)
  portal(@CurrentUser() userId: string) {
    return this.billing.portal(userId);
  }

  /** Confirma el pago al volver de Checkout; sin sessionId válido no hace nada. */
  @Post('confirm')
  @HttpCode(200)
  confirm(@CurrentUser() userId: string, @Body() dto: ConfirmDto) {
    if (!dto.sessionId) return { plan: null };
    return this.billing.confirm(userId, dto.sessionId);
  }

  /** Webhook de Stripe: público, autenticado por la firma del cuerpo crudo. */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
