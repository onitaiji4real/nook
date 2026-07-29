import { describe, expect, it } from 'vitest';

import { availabilityQuerySchema } from '../src/availability';

describe('availability query contract', () => {
  const serviceId = '10000000-0000-4000-8000-000000000001';

  it('accepts a bounded local-date query and applies one-day default', () => {
    expect(availabilityQuerySchema.parse({ serviceId, date: '2026-07-22' })).toEqual({
      serviceId,
      date: '2026-07-22',
      days: 1,
    });
    expect(
      availabilityQuerySchema.parse({ serviceId, date: '2026-07-22', days: '7' }),
    ).toMatchObject({ days: 7 });
  });

  it('rejects malformed, impossible, unbounded, and unknown query input', () => {
    expect(availabilityQuerySchema.safeParse({ serviceId, date: '2026-02-30' }).success).toBe(
      false,
    );
    expect(
      availabilityQuerySchema.safeParse({ serviceId, date: '2026-07-22', days: 8 }).success,
    ).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({ serviceId, date: '2026-07-22', timezone: 'UTC' }).success,
    ).toBe(false);
  });
});
