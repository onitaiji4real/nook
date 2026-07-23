import { Module } from '@nestjs/common';
import {
  getPrismaClient,
  PrismaMerchantOnboardingRepository,
  PrismaLineWebhookRepository,
  PrismaRateLimitRepository,
  PrismaServiceCatalogRepository,
} from '@nook/database';
import { LineIdTokenVerifier } from '@nook/line';

import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { LINE_IDENTITY_VERIFIER } from './identity.tokens';
import { LineAuthApplicationService } from './line-auth-application.service';
import { LineAuthController } from './line-auth.controller';
import { LineAuthRateLimitService } from './line-auth-rate-limit.service';
import { LineWebhookApplicationService } from './line-webhook-application.service';
import { LineWebhookController } from './line-webhook.controller';
import { LINE_WEBHOOK_REPOSITORY } from './line-webhook.tokens';
import { MerchantOnboardingApplicationService } from './merchant-onboarding-application.service';
import { MerchantOnboardingController } from './merchant-onboarding.controller';
import { MERCHANT_ONBOARDING_REPOSITORY } from './merchant-onboarding-repository.token';
import { PlatformCoreModule } from './modules/core/platform-core.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { RATE_LIMIT_REPOSITORY } from './rate-limit.tokens';
import { runtimeConfig } from './runtime-config';
import { TenantApplicationService } from './tenant-application.service';
import { ServiceCatalogApplicationService } from './service-catalog-application.service';
import { ServiceCatalogController } from './service-catalog.controller';
import { SERVICE_CATALOG_REPOSITORY } from './service-catalog-repository.token';
import { TenantController } from './tenant.controller';
import { UnavailableLineIdentityVerifier } from './unavailable-line-identity-verifier';
const lineVerifier =
  runtimeConfig.identity.mode === 'firebase'
    ? new LineIdTokenVerifier({ channelId: runtimeConfig.identity.lineChannelId })
    : new UnavailableLineIdentityVerifier();

@Module({
  imports: [PlatformCoreModule, SchedulingModule, PortfolioModule, MarketplaceModule],
  controllers: [
    HealthController,
    LineAuthController,
    TenantController,
    MerchantOnboardingController,
    ServiceCatalogController,
    LineWebhookController,
  ],
  providers: [
    DatabaseProbeService,
    HealthService,
    LineAuthApplicationService,
    LineAuthRateLimitService,
    MerchantOnboardingApplicationService,
    ServiceCatalogApplicationService,
    TenantApplicationService,
    LineWebhookApplicationService,
    { provide: LINE_IDENTITY_VERIFIER, useValue: lineVerifier },
    {
      provide: RATE_LIMIT_REPOSITORY,
      useFactory: () => new PrismaRateLimitRepository(getPrismaClient()),
    },
    {
      provide: MERCHANT_ONBOARDING_REPOSITORY,
      useFactory: () => new PrismaMerchantOnboardingRepository(getPrismaClient()),
    },
    {
      provide: SERVICE_CATALOG_REPOSITORY,
      useFactory: () => new PrismaServiceCatalogRepository(getPrismaClient()),
    },
    {
      provide: LINE_WEBHOOK_REPOSITORY,
      useFactory: () => new PrismaLineWebhookRepository(getPrismaClient()),
    },
  ],
})
export class AppModule {}
