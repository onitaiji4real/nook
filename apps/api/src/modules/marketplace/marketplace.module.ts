import { Module } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  getPrismaClient,
  PrismaAvailabilityRepository,
  PrismaAppointmentConfirmationRepository,
  PrismaAppointmentViewRepository,
  PrismaAppointmentLifecycleRepository,
  PrismaBookingPolicyRepository,
  PrismaBookingHoldRepository,
  PrismaMerchantPublicationRepository,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { PlatformCoreModule } from '../core/platform-core.module';
import {
  GcsMarketplaceMediaSigner,
  UnavailableMarketplaceMediaSigner,
} from './marketplace-media-signer';
import {
  MarketplaceController,
  MerchantPublicationController,
} from './merchant-publication.controller';
import { MerchantPublicationApplicationService } from './merchant-publication-application.service';
import { AvailabilityApplicationService } from './availability-application.service';
import { BookingHoldApplicationService } from './booking-hold-application.service';
import { BookingHoldController, MarketplaceBookingHoldController } from './booking-hold.controller';
import { AppointmentApplicationService } from './appointment-application.service';
import { AppointmentController } from './appointment.controller';
import { AppointmentViewApplicationService } from './appointment-view-application.service';
import { AppointmentViewController } from './appointment-view.controller';
import { BookingPolicyApplicationService } from './booking-policy-application.service';
import { BookingPolicyController } from './booking-policy.controller';
import { AppointmentLifecycleApplicationService } from './appointment-lifecycle-application.service';
import { AppointmentLifecycleController } from './appointment-lifecycle.controller';
import {
  AVAILABILITY_CLOCK,
  APPOINTMENT_CONFIRMATION_REPOSITORY,
  APPOINTMENT_VIEW_REPOSITORY,
  APPOINTMENT_LIFECYCLE_REPOSITORY,
  AVAILABILITY_REPOSITORY,
  BOOKING_HOLD_REPOSITORY,
  BOOKING_POLICY_REPOSITORY,
  MARKETPLACE_MEDIA_SIGNER,
  MERCHANT_PUBLICATION_REPOSITORY,
} from './marketplace.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [
    MerchantPublicationController,
    MarketplaceController,
    MarketplaceBookingHoldController,
    BookingHoldController,
    AppointmentController,
    AppointmentViewController,
    BookingPolicyController,
    AppointmentLifecycleController,
  ],
  providers: [
    MerchantPublicationApplicationService,
    AvailabilityApplicationService,
    BookingHoldApplicationService,
    AppointmentApplicationService,
    AppointmentViewApplicationService,
    BookingPolicyApplicationService,
    AppointmentLifecycleApplicationService,
    {
      provide: MERCHANT_PUBLICATION_REPOSITORY,
      useFactory: () => new PrismaMerchantPublicationRepository(getPrismaClient()),
    },
    {
      provide: AVAILABILITY_REPOSITORY,
      useFactory: () => new PrismaAvailabilityRepository(getPrismaClient()),
    },
    {
      provide: BOOKING_HOLD_REPOSITORY,
      useFactory: () => new PrismaBookingHoldRepository(getPrismaClient()),
    },
    {
      provide: APPOINTMENT_CONFIRMATION_REPOSITORY,
      useFactory: () => new PrismaAppointmentConfirmationRepository(getPrismaClient()),
    },
    {
      provide: APPOINTMENT_VIEW_REPOSITORY,
      useFactory: () => new PrismaAppointmentViewRepository(getPrismaClient()),
    },
    {
      provide: BOOKING_POLICY_REPOSITORY,
      useFactory: () => new PrismaBookingPolicyRepository(getPrismaClient()),
    },
    {
      provide: APPOINTMENT_LIFECYCLE_REPOSITORY,
      useFactory: () => new PrismaAppointmentLifecycleRepository(getPrismaClient()),
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
export class MarketplaceModule {}
