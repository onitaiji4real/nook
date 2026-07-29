import { Module } from '@nestjs/common';
import {
  getPrismaClient,
  PrismaBookingHoldRepository,
  PrismaBookingPolicyRepository,
} from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { BookingHoldApplicationService } from './booking-hold-application.service';
import { BookingHoldController, MarketplaceBookingHoldController } from './booking-hold.controller';
import { BookingPolicyApplicationService } from './booking-policy-application.service';
import { BookingPolicyController } from './booking-policy.controller';
import { BOOKING_HOLD_REPOSITORY, BOOKING_POLICY_REPOSITORY } from './booking.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [MarketplaceBookingHoldController, BookingHoldController, BookingPolicyController],
  providers: [
    BookingHoldApplicationService,
    BookingPolicyApplicationService,
    {
      provide: BOOKING_HOLD_REPOSITORY,
      useFactory: () => new PrismaBookingHoldRepository(getPrismaClient()),
    },
    {
      provide: BOOKING_POLICY_REPOSITORY,
      useFactory: () => new PrismaBookingPolicyRepository(getPrismaClient()),
    },
  ],
})
export class BookingModule {}
