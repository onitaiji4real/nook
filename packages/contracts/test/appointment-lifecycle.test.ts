import { describe, expect, it } from 'vitest';

import {
  appointmentLifecycleIdempotencyKeySchema,
  bookingPolicyUpdateRequestSchema,
  consumerCancelAppointmentRequestSchema,
  emptyAppointmentTransitionRequestSchema,
  rescheduleAppointmentRequestSchema,
} from '../src/appointment-lifecycle';

describe('appointment lifecycle contract', () => {
  it('accepts visible ASCII idempotency keys within the documented bounds', () => {
    expect(appointmentLifecycleIdempotencyKeySchema.safeParse('transition-key-01').success).toBe(
      true,
    );
    expect(appointmentLifecycleIdempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(appointmentLifecycleIdempotencyKeySchema.safeParse('transition key 01').success).toBe(
      false,
    );
  });

  it('keeps transition bodies strict and reason codes allowlisted', () => {
    expect(
      consumerCancelAppointmentRequestSchema.safeParse({
        reasonCode: 'CONSUMER_CHANGE_OF_PLANS',
      }).success,
    ).toBe(true);
    expect(
      consumerCancelAppointmentRequestSchema.safeParse({
        reasonCode: 'free-form reason',
      }).success,
    ).toBe(false);
    expect(emptyAppointmentTransitionRequestSchema.safeParse({ extra: true }).success).toBe(false);
  });

  it('requires v2 policy acceptance when rescheduling', () => {
    const request = {
      holdId: '10000000-0000-4000-8000-000000000001',
      policyVersion: `v2:${'a'.repeat(64)}`,
      policiesAccepted: true,
      reasonCode: 'RESCHEDULE_SCHEDULE_CONFLICT',
    } as const;
    expect(rescheduleAppointmentRequestSchema.safeParse(request).success).toBe(true);
    expect(
      rescheduleAppointmentRequestSchema.safeParse({ ...request, policiesAccepted: false }).success,
    ).toBe(false);
  });

  it('validates booking-policy revision and lifecycle lead ranges', () => {
    const policy = {
      expectedRevision: 1,
      slotIntervalMinutes: 15,
      minimumLeadMinutes: 60,
      maximumAdvanceDays: 90,
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
    } as const;
    expect(bookingPolicyUpdateRequestSchema.safeParse(policy).success).toBe(true);
    expect(
      bookingPolicyUpdateRequestSchema.safeParse({
        ...policy,
        consumerCancelLeadMinutes: 43_201,
      }).success,
    ).toBe(false);
  });
});
