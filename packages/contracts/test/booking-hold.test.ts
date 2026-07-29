import { describe, expect, it } from 'vitest';

import {
  bookingHoldIdempotencyKeySchema,
  createBookingHoldRequestSchema,
} from '../src/booking-hold';

describe('booking hold contract', () => {
  const request = {
    serviceId: '10000000-0000-4000-8000-000000000001',
    staffId: '20000000-0000-4000-8000-000000000001',
    startAt: '2026-07-24T03:00:00.000Z',
  };

  it('accepts only server-controlled UTC hold input and UUID idempotency keys', () => {
    expect(createBookingHoldRequestSchema.parse(request)).toEqual(request);
    expect(
      bookingHoldIdempotencyKeySchema.safeParse('30000000-0000-4000-8000-000000000001').success,
    ).toBe(true);
  });

  it('rejects offsets, unknown fields, client identity, and malformed keys', () => {
    expect(
      createBookingHoldRequestSchema.safeParse({ ...request, startAt: '2026-07-24T11:00:00+08:00' })
        .success,
    ).toBe(false);
    expect(
      createBookingHoldRequestSchema.safeParse({ ...request, tenantId: request.staffId }).success,
    ).toBe(false);
    expect(
      createBookingHoldRequestSchema.safeParse({ ...request, consumerUserId: request.staffId })
        .success,
    ).toBe(false);
    expect(bookingHoldIdempotencyKeySchema.safeParse('raw-retry-key').success).toBe(false);
  });

  it('keeps confirmation policy fields server-owned', () => {
    expect(
      createBookingHoldRequestSchema.safeParse({
        ...request,
        policyVersion: 'v1:client-controlled',
      }).success,
    ).toBe(false);
  });
});
