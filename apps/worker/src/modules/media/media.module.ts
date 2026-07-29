import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaPortfolioMediaRepository } from '@nook/database';
import type { RuntimeConfig } from '@nook/config';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { GcsMediaObjectStore, UnavailableMediaObjectStore } from './media-object-store';
import { MediaVerificationController } from './media-verification.controller';
import { MediaVerificationService } from './media-verification.service';
import { MEDIA_OBJECT_STORE, PORTFOLIO_MEDIA_REPOSITORY } from './media.tokens';

@Module({
  controllers: [MediaVerificationController],
  providers: [
    MediaVerificationService,
    {
      provide: PORTFOLIO_MEDIA_REPOSITORY,
      useFactory: () => new PrismaPortfolioMediaRepository(getPrismaClient()),
    },
    {
      provide: MEDIA_OBJECT_STORE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.media.mode === 'gcp'
          ? new GcsMediaObjectStore(config.media.projectId)
          : new UnavailableMediaObjectStore(),
    },
  ],
})
export class MediaModule {}
