import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

  // undefined = no cambia; null = sacarlo de su carpeta (raíz).
  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_SUMMARY)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];
}

export class CreateSummaryDto {
  @IsOptional()
  @IsUUID()
  uploadRequestId?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  requestedSha256?: string;

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
  @IsUUID()
  folderId?: string;

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

export class DuplicateQueryDto {
  @IsOptional()
  @IsUUID()
  uploadRequestId?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  sha256?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  author?: string;
}

export class DriveFileDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,256}$/)
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  accessToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,256}$/)
  resourceKey?: string;
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

  // "root" = audios sin carpeta.
  @IsOptional()
  @Matches(/^(root|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  folderId?: string;

  @IsOptional()
  @IsIn(['true'])
  includeSubfolders?: 'true';

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

export class MoveSummariesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];

  // Obligatorio: null = a la raíz.
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}
