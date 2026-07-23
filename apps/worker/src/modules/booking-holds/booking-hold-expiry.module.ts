import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaBookingHoldRepository } from '@nook/database';

import { BookingHoldExpiryController } from './booking-hold-expiry.controller';
import { BookingHoldExpiryService } from './booking-hold-expiry.service';
import { BOOKING_HOLD_REPOSITORY } from './booking-hold-expiry.tokens';

@Module({
  controllers: [BookingHoldExpiryController],
  providers: [
    BookingHoldExpiryService,
    {
      provide: BOOKING_HOLD_REPOSITORY,
      useFactory: () => new PrismaBookingHoldRepository(getPrismaClient()),
    },
  ],
})
export class BookingHoldExpiryModule {}
