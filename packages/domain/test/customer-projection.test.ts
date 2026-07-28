import { describe, expect, it } from 'vitest';

import {
  CustomerProjectionCorruption,
  deriveCustomerProjection,
  type CustomerProjectionAppointment,
} from '../src';

const baseTime = new Date('2026-07-28T00:00:00.000Z');

describe('deriveCustomerProjection', () => {
  it('counts only the current effective leaf of each reschedule chain', () => {
    const original = appointment('original', 'RESCHEDULED', 0);
    const replacement = appointment('replacement', 'COMPLETED', 1, {
      rescheduledFromId: original.id,
      rescheduleRootId: original.id,
    });
    const noShow = appointment('no-show', 'NO_SHOW', 2);

    expect(deriveCustomerProjection([original, replacement, noShow], replacement.id)).toEqual({
      relationshipStartedAt: original.confirmedAt,
      firstVisitAt: replacement.startAt,
      lastVisitAt: replacement.startAt,
      completedVisitCount: 1,
      noShowCount: 1,
    });
  });

  it('returns null visit dates without a completed service', () => {
    const confirmed = appointment('confirmed', 'CONFIRMED', 0);

    expect(deriveCustomerProjection([confirmed], confirmed.id)).toEqual({
      relationshipStartedAt: confirmed.confirmedAt,
      firstVisitAt: null,
      lastVisitAt: null,
      completedVisitCount: 0,
      noShowCount: 0,
    });
  });

  it.each([
    {
      name: 'missing parent',
      appointments: [
        appointment('replacement', 'COMPLETED', 1, {
          rescheduledFromId: 'missing',
          rescheduleRootId: 'missing',
        }),
      ],
      code: 'reschedule_parent_missing',
    },
    {
      name: 'parent not rescheduled',
      appointments: [
        appointment('original', 'CONFIRMED', 0),
        appointment('replacement', 'COMPLETED', 1, {
          rescheduledFromId: 'original',
          rescheduleRootId: 'original',
        }),
      ],
      code: 'reschedule_chain_invalid',
    },
    {
      name: 'multiple children',
      appointments: [
        appointment('original', 'RESCHEDULED', 0),
        appointment('replacement-a', 'COMPLETED', 1, {
          rescheduledFromId: 'original',
          rescheduleRootId: 'original',
        }),
        appointment('replacement-b', 'NO_SHOW', 2, {
          rescheduledFromId: 'original',
          rescheduleRootId: 'original',
        }),
      ],
      code: 'multiple_effective_leaves',
    },
  ])('fails closed for $name', ({ appointments, code }) => {
    expect(() => deriveCustomerProjection(appointments, appointments[0]?.id ?? '')).toThrowError(
      new CustomerProjectionCorruption(code),
    );
  });
});

function appointment(
  id: string,
  status: string,
  dayOffset: number,
  links: {
    readonly rescheduledFromId?: string;
    readonly rescheduleRootId?: string;
  } = {},
): CustomerProjectionAppointment {
  return {
    id,
    tenantId: 'tenant',
    consumerUserId: 'consumer',
    status,
    startAt: new Date(baseTime.getTime() + dayOffset * 24 * 60 * 60 * 1_000),
    confirmedAt: new Date(baseTime.getTime() + dayOffset * 1_000),
    rescheduledFromId: links.rescheduledFromId ?? null,
    rescheduleRootId: links.rescheduleRootId ?? null,
  };
}
