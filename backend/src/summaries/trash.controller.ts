import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SummariesService } from './summaries.service';

@Controller('trash')
export class TrashController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.summaries.listTrash(userId);
  }

  /** Vacía la papelera del usuario (borrado definitivo). */
  @Delete()
  emptyTrash(@CurrentUser() userId: string) {
    return this.summaries.emptyTrash(userId);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteForever(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.summaries.deleteForever(id, userId);
  }
}
