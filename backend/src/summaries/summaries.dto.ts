import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_SUMMARY } from '../tags/tags.service';

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export const AUDIO_TYPES: Record<string, string[]> = {
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a'],
  'audio/x-m4a': ['.m4a'],
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Recorta y colapsa espacios de cada etiqueta; descarta las que quedan vacías. */
const normalizeTags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value
        .map((tag) => (typeof tag === 'string' ? tag.trim().replace(/\s+/g, ' ') : tag))
        .filter((tag) => tag !== '')
    : value;

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

  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_SUMMARY)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];
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

  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_SUMMARY)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

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

export const SORT_OPTIONS = ['recent', 'title', 'duration', 'listened'] as const;
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
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_TAG_LENGTH)
  tag?: string;

  @IsOptional()
  @IsIn(['true'])
  favorite?: 'true';

  @IsOptional()
  @IsIn(['finished', 'unfinished'])
  status?: 'finished' | 'unfinished';

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
