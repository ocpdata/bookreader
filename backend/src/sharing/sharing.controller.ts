import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateShareDto } from './sharing.dto';
import { SharingService } from './sharing.service';

@Controller('shares')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('config')
  config() {
    return { enabled: this.sharing.isEnabled() };
  }

  @Post()
  create(
    @CurrentUser() userId: string,
    @Body() dto: CreateShareDto,
    @Req() req: Request,
  ) {
    return this.sharing.create(userId, dto, req.ip ?? 'desconocida');
  }

  @Get('sent')
  sent(@CurrentUser() userId: string) {
    return this.sharing.sent(userId);
  }

  @Get('received')
  received(@CurrentUser() userId: string) {
    return this.sharing.received(userId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sharing.accept(userId, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sharing.reject(userId, id);
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sharing.resend(userId, id, req.ip ?? 'desconocida');
  }

  @Delete(':id')
  revoke(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sharing.revoke(userId, id);
  }
}
