import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export const AUDIO_TYPES: Record<string, string[]> = {
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a'],
  'audio/x-m4a': ['.m4a'],
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateSummaryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  summaryTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  narrator?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CreateSummaryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  author!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  summaryTitle?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  narrator?: string;

  @IsUUID()
  categoryId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  originalFilename!: string;

  @IsIn(Object.keys(AUDIO_TYPES))
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_AUDIO_BYTES)
  sizeBytes!: number;
}

export const SORT_OPTIONS = ['recent', 'title', 'duration'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export class ListSummariesQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(SORT_OPTIONS as unknown as string[])
  sort?: SortOption;
}

export class SaveProgressDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7 * 24 * 3600)
  positionSeconds?: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
