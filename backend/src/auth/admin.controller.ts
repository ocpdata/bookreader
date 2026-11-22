import { Body, Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from './current-user.decorator';
import { AdminService } from './admin.service';

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
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(@CurrentUser() userId: string, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.admin.listUsers(userId, page);
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
