import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaMerchantOnboardingRepository } from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { MerchantOnboardingApplicationService } from './merchant-onboarding-application.service';
import { MERCHANT_ONBOARDING_REPOSITORY } from './merchant-onboarding-repository.token';
import { MerchantOnboardingController } from './merchant-onboarding.controller';

@Module({
  imports: [PlatformCoreModule],
  controllers: [MerchantOnboardingController],
  providers: [
    MerchantOnboardingApplicationService,
    {
      provide: MERCHANT_ONBOARDING_REPOSITORY,
      useFactory: () => new PrismaMerchantOnboardingRepository(getPrismaClient()),
    },
  ],
})
export class MerchantOnboardingModule {}
