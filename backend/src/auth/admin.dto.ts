import { UserPlan, UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const ADMIN_PAGE_SIZES = [25, 50, 100] as const;
export const ADMIN_SORTS = ['created', 'lastLogin', 'name'] as const;
export type AdminSort = (typeof ADMIN_SORTS)[number];

export class ListAdminUsersQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(ADMIN_PAGE_SIZES as unknown as number[])
  pageSize?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserPlan)
  plan?: UserPlan;

  @IsOptional()
  @IsIn(ADMIN_SORTS as unknown as string[])
  sort?: AdminSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class SetStatusDto {
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status!: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class SetPlanDto {
  @IsEnum(UserPlan)
  plan!: UserPlan;

  // Sin días, el plan no vence; la prueba (TRIAL) siempre los exige.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}

export class SetQuotaDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  storageGb?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxAudios?: number;

  // Vuelve a los valores del plan (quita la cuota propia).
  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}
