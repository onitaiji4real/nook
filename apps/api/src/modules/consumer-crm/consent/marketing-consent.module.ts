import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaMarketingConsentRepository } from '@nook/database';

import { PlatformCoreModule } from '../../../platform/platform-core.module';
import { MarketingConsentApplicationService } from './marketing-consent-application.service';
import { MARKETING_CONSENT_REPOSITORY } from './marketing-consent.tokens';

@Module({
  imports: [PlatformCoreModule],
  providers: [
    MarketingConsentApplicationService,
    {
      provide: MARKETING_CONSENT_REPOSITORY,
      useFactory: () => new PrismaMarketingConsentRepository(getPrismaClient()),
    },
  ],
  exports: [MarketingConsentApplicationService],
})
export class MarketingConsentModule {}
