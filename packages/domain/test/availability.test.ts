import { describe, expect, it } from 'vitest';

import { calculateAvailability, localDateTimeToInstant } from '../src/availability';

const baseStaff = {
  id: 'staff-a',
  displayName: 'Mia',
  durationMinutes: null,
  weeklyRules: [
    {
      weekday: 3,
      startTime: '09:00',
      endTime: '12:00',
      validFrom: '2026-01-01',
      validUntil: null,
    },
  ],
  exceptions: [],
  occupancy: [],
} as const;

describe('availability calculator', () => {
  it('creates Taipei slots aligned to local midnight and requires buffers inside opening hours', () => {
    const slots = calculateAvailability({
      timeZone: 'Asia/Taipei',
      date: '2026-07-22',
      days: 1,
      slotIntervalMinutes: 30,
      earliestStartAt: new Date('2026-07-21T00:00:00.000Z'),
      serviceDurationMinutes: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      staff: [baseStaff],
    });

    expect(slots.map(({ startAt }) => startAt.toISOString())).toEqual([
      '2026-07-22T01:30:00.000Z',
      '2026-07-22T02:00:00.000Z',
      '2026-07-22T02:30:00.000Z',
    ]);
  });

  it('unions extra hours then lets time off and block win', () => {
    const slots = calculateAvailability({
      timeZone: 'Asia/Taipei',
      date: '2026-07-22',
      days: 1,
      slotIntervalMinutes: 60,
      earliestStartAt: new Date('2026-07-21T00:00:00.000Z'),
      serviceDurationMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      staff: [
        {
          ...baseStaff,
          exceptions: [
            {
              kind: 'EXTRA_HOURS',
              startAt: new Date('2026-07-22T04:00:00.000Z'),
              endAt: new Date('2026-07-22T07:00:00.000Z'),
            },
            {
              kind: 'TIME_OFF',
              startAt: new Date('2026-07-22T02:00:00.000Z'),
              endAt: new Date('2026-07-22T03:00:00.000Z'),
            },
            {
              kind: 'BLOCK',
              startAt: new Date('2026-07-22T05:00:00.000Z'),
              endAt: new Date('2026-07-22T06:00:00.000Z'),
            },
          ],
        },
      ],
    });

    expect(slots.map(({ startAt }) => startAt.toISOString())).toEqual([
      '2026-07-22T01:00:00.000Z',
      '2026-07-22T03:00:00.000Z',
      '2026-07-22T04:00:00.000Z',
      '2026-07-22T06:00:00.000Z',
    ]);
  });

  it('uses half-open occupancy and aggregates eligible staff', () => {
    const slots = calculateAvailability({
      timeZone: 'Asia/Taipei',
      date: '2026-07-22',
      days: 1,
      slotIntervalMinutes: 60,
      earliestStartAt: new Date('2026-07-21T00:00:00.000Z'),
      serviceDurationMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      staff: [
        {
          ...baseStaff,
          occupancy: [
            {
              startAt: new Date('2026-07-22T02:00:00.000Z'),
              endAt: new Date('2026-07-22T03:00:00.000Z'),
            },
          ],
        },
        { ...baseStaff, id: 'staff-b', displayName: 'Lin' },
      ],
    });

    expect(slots).toHaveLength(3);
    expect(slots[0]?.eligibleStaffIds).toEqual(['staff-a', 'staff-b']);
    expect(slots[1]?.eligibleStaffIds).toEqual(['staff-b']);
    expect(slots[2]?.eligibleStaffIds).toEqual(['staff-a', 'staff-b']);
  });

  it('omits nonexistent DST time and selects the earlier instant for an ambiguous local time', () => {
    expect(localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    expect(
      new Date(localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York')!).toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });
});
