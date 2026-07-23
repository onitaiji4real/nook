import type {
  BookingHoldRateDecision,
  BookingHoldRecord,
  BookingHoldRepository,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import {
  BookingHoldExpiryRequestError,
  BookingHoldExpiryService,
} from '../src/modules/booking-holds/booking-hold-expiry.service';

class FakeBookingHoldRepository implements BookingHoldRepository {
  expiredCount = 0;
  batches: number[] = [];

  consumeCreateAttempt(): Promise<BookingHoldRateDecision> {
    throw new Error('not used');
  }
  acquire(): Promise<BookingHoldRecord> {
    throw new Error('not used');
  }
  release(): Promise<void> {
    throw new Error('not used');
  }
  expireBatch(limit: number): Promise<number> {
    this.batches.push(limit);
    return Promise.resolve(this.expiredCount);
  }
}

describe('BookingHoldExpiryService', () => {
  it('runs one bounded retry-safe repository batch and returns only the count', async () => {
    const repository = new FakeBookingHoldRepository();
    repository.expiredCount = 7;
    const service = new BookingHoldExpiryService(repository);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(service.run('expiry-request')).resolves.toEqual({ expiredCount: 7 });
    expect(repository.batches).toEqual([100]);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('"requestId":"expiry-request"'));
    output.mockRestore();
  });

  it('requires the scheduler marker before running the operation', () => {
    const service = new BookingHoldExpiryService(new FakeBookingHoldRepository());
    expect(() => service.requireScheduler(undefined)).toThrow(BookingHoldExpiryRequestError);
    expect(() => service.requireScheduler('false')).toThrow(BookingHoldExpiryRequestError);
    expect(() => service.requireScheduler('true')).not.toThrow();
  });
});
