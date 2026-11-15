import { Module } from '@nestjs/common';
import { SummariesModule } from '../summaries/summaries.module';
import { AbsAuthController } from './abs-auth.controller';
import { AbsLibraryController } from './abs-library.controller';
import { AbsPlaybackController } from './abs-playback.controller';
import { AbsProgressController } from './abs-progress.controller';
import { AbsService } from './abs.service';
import { PlaySessionService } from './play-session.service';

/** Capa de compatibilidad con la API de Audiobookshelf (apps como Absorb o AudioBooth). Se desactiva con ABS_COMPAT_ENABLED=false. */
@Module({
  imports: [SummariesModule],
  controllers: [AbsAuthController, AbsLibraryController, AbsPlaybackController, AbsProgressController],
  providers: [AbsService, PlaySessionService],
})
export class AbsCompatModule {}
