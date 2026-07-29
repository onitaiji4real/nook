import { describe, expect, it } from 'vitest';

import {
  createAvailabilityExceptionRequestSchema,
  createStaffRequestSchema,
  replaceWeeklyAvailabilityRequestSchema,
} from '../src/staff-availability';

describe('staff availability contracts', () => {
  it('requires a location and unique service qualifications', () => {
    const base = {
      id: '30000000-0000-4000-8000-000000000001',
      locationId: '30000000-0000-4000-8000-000000000002',
      displayName: 'Eric',
      serviceIds: ['30000000-0000-4000-8000-000000000003'],
    };
    expect(createStaffRequestSchema.parse(base)).toMatchObject({ bookingEnabled: true });
    expect(
      createStaffRequestSchema.safeParse({
        ...base,
        serviceIds: [...base.serviceIds, ...base.serviceIds],
      }).success,
    ).toBe(false);
  });

  it('accepts split shifts but rejects overlapping date and time windows', () => {
    const base = {
      id: '30000000-0000-4000-8000-000000000010',
      weekday: 1,
      startTime: '09:00',
      endTime: '12:00',
      validFrom: '2026-07-01',
      validUntil: null,
    };
    expect(
      replaceWeeklyAvailabilityRequestSchema.safeParse({
        rules: [
          base,
          {
            ...base,
            id: '30000000-0000-4000-8000-000000000011',
            startTime: '13:00',
            endTime: '18:00',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      replaceWeeklyAvailabilityRequestSchema.safeParse({
        rules: [
          base,
          {
            ...base,
            id: '30000000-0000-4000-8000-000000000012',
            startTime: '11:45',
            endTime: '14:00',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires offset-aware exception timestamps with a positive interval', () => {
    expect(
      createAvailabilityExceptionRequestSchema.safeParse({
        id: '30000000-0000-4000-8000-000000000020',
        type: 'TIME_OFF',
        startAt: '2026-08-01T09:00:00+08:00',
        endAt: '2026-08-01T18:00:00+08:00',
      }).success,
    ).toBe(true);
    expect(
      createAvailabilityExceptionRequestSchema.safeParse({
        id: '30000000-0000-4000-8000-000000000020',
        type: 'TIME_OFF',
        startAt: '2026-08-01T18:00:00+08:00',
        endAt: '2026-08-01T09:00:00+08:00',
      }).success,
    ).toBe(false);
  });
});
