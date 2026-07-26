import { Module } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  getPrismaClient,
  PrismaAvailabilityRepository,
  PrismaMerchantPublicationRepository,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { PlatformCoreModule } from '../../platform/platform-core.module';
import { AvailabilityApplicationService } from './availability-application.service';
import {
  GcsMarketplaceMediaSigner,
  UnavailableMarketplaceMediaSigner,
} from './marketplace-media-signer';
import { MerchantPublicationApplicationService } from './merchant-publication-application.service';
import {
  MarketplaceController,
  MerchantPublicationController,
} from './merchant-publication.controller';
import {
  AVAILABILITY_CLOCK,
  AVAILABILITY_REPOSITORY,
  MARKETPLACE_MEDIA_SIGNER,
  MERCHANT_PUBLICATION_REPOSITORY,
} from './publication.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [MerchantPublicationController, MarketplaceController],
  providers: [
    MerchantPublicationApplicationService,
    AvailabilityApplicationService,
    {
      provide: MERCHANT_PUBLICATION_REPOSITORY,
      useFactory: () => new PrismaMerchantPublicationRepository(getPrismaClient()),
    },
    {
      provide: AVAILABILITY_REPOSITORY,
      useFactory: () => new PrismaAvailabilityRepository(getPrismaClient()),
    },
    { provide: AVAILABILITY_CLOCK, useValue: () => new Date() },
    {
      provide: MARKETPLACE_MEDIA_SIGNER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        config.media.mode === 'gcp'
          ? new GcsMarketplaceMediaSigner(config.media.projectId)
          : new UnavailableMarketplaceMediaSigner(),
    },
  ],
})
export class PublicationModule {}
