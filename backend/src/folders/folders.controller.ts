import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateFolderDto, UpdateFolderDto } from './folders.dto';
import { FoldersService } from './folders.service';

@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.folders.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateFolderDto) {
    return this.folders.create(userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFolderDto) {
    return this.folders.update(id, userId, dto);
  }

  /** Los audios y subcarpetas suben a la carpeta padre; no se borra contenido. */
  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.remove(id, userId);
  }
}
