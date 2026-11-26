import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from './current-user.decorator';
import { AdminService } from './admin.service';
import { AdminUserActionsService } from './admin-user-actions.service';
import { ListAdminUsersQuery, SetPlanDto, SetQuotaDto, SetStatusDto } from './admin.dto';

class ChangeRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly actions: AdminUserActionsService,
  ) {}

  @Get('users')
  users(@CurrentUser() userId: string, @Query() query: ListAdminUsersQuery) {
    return this.admin.listUsers(userId, query);
  }

  @Patch('users/:id/status')
  @HttpCode(200)
  setStatus(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) targetId: string, @Body() dto: SetStatusDto) {
    return this.actions.setStatus(userId, targetId, dto.status, dto.reason);
  }

  @Patch('users/:id/plan')
  @HttpCode(200)
  setPlan(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) targetId: string, @Body() dto: SetPlanDto) {
    return this.actions.setPlan(userId, targetId, dto);
  }

  @Patch('users/:id/quota')
  @HttpCode(200)
  setQuota(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) targetId: string, @Body() dto: SetQuotaDto) {
    return this.actions.setQuota(userId, targetId, dto);
  }

  @Patch('users/:id/role')
  @HttpCode(200)
  changeRole(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: Request,
  ) {
    return this.admin.changeRole(userId, targetId, dto.role, dto.password, req.ip ?? 'desconocida');
  }
}
