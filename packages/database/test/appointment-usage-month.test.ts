import { describe, expect, it } from 'vitest';

import { AppointmentConfirmationRepositoryError, appointmentUsageMonth } from '../src';

describe('appointment usage month', () => {
  it('uses the tenant usage timezone instead of the location or UTC month', () => {
    const boundary = new Date('2026-07-31T16:30:00.000Z');
    expect(appointmentUsageMonth(boundary, 'UTC')).toBe('2026-07');
    expect(appointmentUsageMonth(boundary, 'Asia/Taipei')).toBe('2026-08');
    expect(appointmentUsageMonth(boundary, 'Pacific/Kiritimati')).toBe('2026-08');
  });

  it('fails closed for an invalid IANA timezone', () => {
    expect(() => appointmentUsageMonth(new Date(), 'Taipei')).toThrow(
      new AppointmentConfirmationRepositoryError('entitlement_unavailable'),
    );
  });
});
