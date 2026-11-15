import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export const MAX_FOLDER_NAME = 100;

/** Recorta y colapsa los espacios del nombre. */
const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateFolderDto {
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_FOLDER_NAME)
  name!: string;

  // null o ausente = en la raíz.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateFolderDto {
  @IsOptional()
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_FOLDER_NAME)
  name?: string;

  // undefined = no cambia; null = mover a la raíz.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
