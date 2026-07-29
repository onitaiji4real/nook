import { describe, expect, it } from 'vitest';

import {
  appointmentStatuses,
  AppointmentTransitionError,
  assertAppointmentTransition,
  canTransitionAppointment,
  createNoDepositConfirmedAppointment,
  type AppointmentStatus,
} from '../src';

describe('appointment state machine', () => {
  const allowed = new Set([
    'CONFIRMED->CHECKED_IN',
    'CONFIRMED->CANCELLED',
    'CONFIRMED->NO_SHOW',
    'CONFIRMED->RESCHEDULED',
    'CHECKED_IN->COMPLETED',
  ]);

  it('creates the only P3-003 initial no-deposit state and history', () => {
    expect(createNoDepositConfirmedAppointment()).toEqual({
      status: 'CONFIRMED',
      paymentStatus: 'NOT_REQUIRED',
      depositAmount: 0,
      history: { fromStatus: null, toStatus: 'CONFIRMED' },
    });
  });

  it('allows only the documented future transition matrix', () => {
    for (const fromStatus of appointmentStatuses) {
      for (const toStatus of appointmentStatuses) {
        const expected = allowed.has(`${fromStatus}->${toStatus}`);
        expect(canTransitionAppointment(fromStatus, toStatus)).toBe(expected);
        if (expected) {
          expect(() => assertAppointmentTransition(fromStatus, toStatus)).not.toThrow();
        } else {
          expect(() => assertAppointmentTransition(fromStatus, toStatus)).toThrow(
            AppointmentTransitionError,
          );
        }
      }
    }
  });

  it.each<AppointmentStatus>(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'keeps %s terminal',
    (status) => {
      for (const candidate of appointmentStatuses) {
        expect(canTransitionAppointment(status, candidate)).toBe(false);
      }
    },
  );
});
