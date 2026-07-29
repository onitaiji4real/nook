import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaPortfolioMediaRepository } from '@nook/database';
import type { RuntimeConfig } from '@nook/config';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { PlatformCoreModule } from '../../platform/platform-core.module';
import {
  GcpMediaVerificationQueue,
  GcsMediaUploadSigner,
  UnavailableMediaUploadSigner,
  UnavailableMediaVerificationQueue,
} from './media-gateways';
import { PortfolioApplicationService } from './portfolio-application.service';
import { PortfolioController } from './portfolio.controller';
import {
  MEDIA_UPLOAD_SIGNER,
  MEDIA_VERIFICATION_QUEUE,
  PORTFOLIO_MEDIA_REPOSITORY,
} from './portfolio.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [PortfolioController],
  providers: [
    PortfolioApplicationService,
    {
      provide: PORTFOLIO_MEDIA_REPOSITORY,
      useFactory: () => new PrismaPortfolioMediaRepository(getPrismaClient()),
    },
    {
      provide: MEDIA_UPLOAD_SIGNER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.media.mode === 'gcp'
          ? new GcsMediaUploadSigner(config.media.projectId)
          : new UnavailableMediaUploadSigner(),
    },
    {
      provide: MEDIA_VERIFICATION_QUEUE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.media.mode === 'gcp'
          ? new GcpMediaVerificationQueue(config.media)
          : new UnavailableMediaVerificationQueue(),
    },
  ],
})
export class PortfolioModule {}
