import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CurrentUser } from '../auth/current-user.decorator';
import { MAX_TAG_LENGTH, TagsService } from './tags.service';

class SuggestTagsQuery {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(MAX_TAG_LENGTH)
  query?: string;
}

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  suggest(@CurrentUser() userId: string, @Query() { query }: SuggestTagsQuery) {
    return this.tags.suggest(userId, query);
  }
}
