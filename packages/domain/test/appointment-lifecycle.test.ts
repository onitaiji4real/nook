import { describe, expect, it } from 'vitest';

import { isConsumerLifecycleBeforeDeadline, isMerchantLifecycleActionAvailable } from '../src';

const startAt = new Date('2026-07-24T03:00:00.000Z');
const endAt = new Date('2026-07-24T04:00:00.000Z');

describe('appointment lifecycle timing', () => {
  it('includes an exact positive-lead deadline', () => {
    expect(
      isConsumerLifecycleBeforeDeadline({
        status: 'CONFIRMED',
        targetStatus: 'CANCELLED',
        now: new Date('2026-07-23T03:00:00.000Z'),
        startAt,
        leadMinutes: 1_440,
      }),
    ).toBe(true);
  });

  it('treats zero lead as strictly before start time', () => {
    expect(
      isConsumerLifecycleBeforeDeadline({
        status: 'CONFIRMED',
        targetStatus: 'RESCHEDULED',
        now: startAt,
        startAt,
        leadMinutes: 0,
      }),
    ).toBe(false);
  });

  it('uses the state machine before merchant timing rules', () => {
    expect(
      isMerchantLifecycleActionAvailable({
        status: 'CONFIRMED',
        targetStatus: 'CHECKED_IN',
        now: new Date('2026-07-24T01:00:00.000Z'),
        startAt,
        endAt,
      }),
    ).toBe(true);
    expect(
      isMerchantLifecycleActionAvailable({
        status: 'CONFIRMED',
        targetStatus: 'COMPLETED',
        now: endAt,
        startAt,
        endAt,
      }),
    ).toBe(false);
  });

  it('allows no-show at the exact end instant', () => {
    expect(
      isMerchantLifecycleActionAvailable({
        status: 'CONFIRMED',
        targetStatus: 'NO_SHOW',
        now: endAt,
        startAt,
        endAt,
      }),
    ).toBe(true);
  });
});
