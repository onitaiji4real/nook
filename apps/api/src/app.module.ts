import { Module } from '@nestjs/common';

import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BookingModule } from './modules/booking/booking.module';
import { MarketingConsentModule } from './modules/consumer-crm/consent/marketing-consent.module';
import { CustomerNotesModule } from './modules/consumer-crm/notes/customer-notes.module';
import { CustomerReadModule } from './modules/consumer-crm/read/customer-read.module';
import { CustomerTagsModule } from './modules/consumer-crm/tags/customer-tags.module';
import { HealthModule } from './modules/health/health.module';
import { LineAuthModule } from './modules/line-auth/line-auth.module';
import { LineStudioEntryModule } from './modules/line-studio-entry/line-studio-entry.module';
import { LineWebhookModule } from './modules/line-webhook/line-webhook.module';
import { MerchantOnboardingModule } from './modules/merchant-onboarding/merchant-onboarding.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { PublicationModule } from './modules/publication/publication.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { ServiceCatalogModule } from './modules/service-catalog/service-catalog.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { PlatformCoreModule } from './platform/platform-core.module';

@Module({
  imports: [
    PlatformCoreModule,
    HealthModule,
    LineAuthModule,
    LineStudioEntryModule,
    LineWebhookModule,
    TenancyModule,
    MerchantOnboardingModule,
    ServiceCatalogModule,
    SchedulingModule,
    PortfolioModule,
    PublicationModule,
    BookingModule,
    AppointmentsModule,
    MarketingConsentModule,
    CustomerNotesModule,
    CustomerReadModule,
    CustomerTagsModule,
  ],
})
export class AppModule {}
