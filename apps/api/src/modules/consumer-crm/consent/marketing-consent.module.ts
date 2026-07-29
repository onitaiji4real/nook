import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { getPrismaClient, PrismaMarketingConsentRepository } from '@nook/database';

import { PlatformCoreModule } from '../../../platform/platform-core.module';
import { MarketingConsentApplicationService } from './marketing-consent-application.service';
import { MarketingConsentController } from './marketing-consent.controller';
import { MarketingConsentNoStoreMiddleware } from './marketing-consent-no-store.middleware';
import { MARKETING_CONSENT_REPOSITORY } from './marketing-consent.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [MarketingConsentController],
  providers: [
    MarketingConsentApplicationService,
    MarketingConsentNoStoreMiddleware,
    {
      provide: MARKETING_CONSENT_REPOSITORY,
      useFactory: () => new PrismaMarketingConsentRepository(getPrismaClient()),
    },
  ],
  exports: [MarketingConsentApplicationService],
})
export class MarketingConsentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MarketingConsentNoStoreMiddleware).forRoutes(MarketingConsentController);
  }
}
