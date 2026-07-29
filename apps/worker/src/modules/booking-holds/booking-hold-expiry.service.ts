import { Inject, Injectable } from '@nestjs/common';
import type { BookingHoldRepository } from '@nook/database';

import { BOOKING_HOLD_REPOSITORY } from './booking-hold-expiry.tokens';

@Injectable()
export class BookingHoldExpiryService {
  constructor(
    @Inject(BOOKING_HOLD_REPOSITORY) private readonly repository: BookingHoldRepository,
  ) {}

  requireScheduler(value: string | undefined): void {
    if (value !== 'true') throw new BookingHoldExpiryRequestError(403, 'scheduler_required');
  }

  async run(requestId: string): Promise<{ readonly expiredCount: number }> {
    const expiredCount = await this.repository.expireBatch(100);
    process.stdout.write(
      `${JSON.stringify({
        severity: 'INFO',
        service: 'worker',
        operation: 'booking-holds.expire',
        outcome: 'success',
        requestId,
        expiredCount,
      })}\n`,
    );
    return { expiredCount };
  }
}

export class BookingHoldExpiryRequestError extends Error {
  constructor(
    readonly status: 403,
    readonly code: 'scheduler_required',
  ) {
    super(code);
    this.name = 'BookingHoldExpiryRequestError';
  }
}
