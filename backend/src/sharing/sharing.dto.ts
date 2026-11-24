import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ShareScope } from '@prisma/client';

export const MAX_SHARE_ITEMS = 200;

export class CreateShareDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsEnum(ShareScope)
  scope!: ShareScope;

  // null no equivale a ausencia; los requisitos de cada ámbito se comprueban en el servicio.
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_SHARE_ITEMS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  summaryIds?: string[];
}
