import { describe, expect, it } from 'vitest';

import {
  appointmentIdempotencyKeySchema,
  createAppointmentRequestSchema,
} from '../src/appointment';

describe('appointment confirmation contract', () => {
  const request = {
    holdId: '10000000-0000-4000-8000-000000000001',
    policiesAccepted: true,
    policyVersion: `v1:${'a'.repeat(64)}`,
  } as const;

  it('accepts only a UUID key and an explicit policy acknowledgement', () => {
    expect(createAppointmentRequestSchema.parse(request)).toEqual(request);
    expect(
      appointmentIdempotencyKeySchema.safeParse('20000000-0000-4000-8000-000000000001').success,
    ).toBe(true);
  });

  it('rejects client-controlled appointment fields and malformed policy versions', () => {
    expect(
      createAppointmentRequestSchema.safeParse({ ...request, source: 'MARKETPLACE' }).success,
    ).toBe(false);
    expect(
      createAppointmentRequestSchema.safeParse({ ...request, policiesAccepted: false }).success,
    ).toBe(false);
    expect(
      createAppointmentRequestSchema.safeParse({ ...request, policyVersion: 'v1:ABC' }).success,
    ).toBe(false);
    expect(appointmentIdempotencyKeySchema.safeParse('retry-key').success).toBe(false);
  });

  it('lets the application map a non-UUID hold identifier to privacy-safe 404', () => {
    expect(
      createAppointmentRequestSchema.safeParse({ ...request, holdId: 'not-a-uuid' }).success,
    ).toBe(true);
  });

  it('accepts both policy snapshot versions during a mixed-version rollout', () => {
    expect(
      createAppointmentRequestSchema.safeParse({
        ...request,
        policyVersion: `v2:${'b'.repeat(64)}`,
      }).success,
    ).toBe(true);
  });
});
