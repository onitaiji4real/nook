import type { RuntimeConfig } from '@nook/config';
import type { BookingPolicyRepository } from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { BookingPolicyApplicationService } from '../src/modules/marketplace/booking-policy-application.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const actorUserId = '20000000-0000-4000-8000-000000000001';
const policy = {
  revision: 1,
  slotIntervalMinutes: 15 as const,
  minimumLeadMinutes: 120,
  maximumAdvanceDays: 60,
  consumerCancelLeadMinutes: 1_440,
  consumerRescheduleLeadMinutes: 1_440,
  updatedAt: new Date('2026-07-22T12:00:00.000Z'),
};

describe('BookingPolicyApplicationService', () => {
  it('allows active members to read the structured policy', async () => {
    const service = new BookingPolicyApplicationService(repository('VIEWER'), config(true));
    await expect(
      service.get({ tenantId, actorUserId, requestId: 'request-get' }),
    ).resolves.toMatchObject({
      revision: 1,
      updatedAt: '2026-07-22T12:00:00.000Z',
    });
  });

  it('checks role and tenant before the update capability and body', async () => {
    const service = new BookingPolicyApplicationService(repository('VIEWER'), config(false));
    await expect(
      service.update({ tenantId, actorUserId, requestId: 'request-1', body: null }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('fails closed on disabled v2 writes before validating the update body', async () => {
    const update = vi.fn<BookingPolicyRepository['update']>();
    const policies = repository('OWNER', { update });
    const service = new BookingPolicyApplicationService(policies, config(false));
    await expect(
      service.update({ tenantId, actorUserId, requestId: 'request-2', body: null }),
    ).rejects.toMatchObject({ status: 503, code: 'booking_policy_update_unavailable' });
    expect(update).not.toHaveBeenCalled();
  });
});

function repository(
  role: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER',
  overrides: Partial<BookingPolicyRepository> = {},
): BookingPolicyRepository {
  return {
    getForMember: vi.fn().mockResolvedValue({ policy, role, tenantStatus: 'ACTIVE' }),
    update: vi.fn(),
    ...overrides,
  } as BookingPolicyRepository;
}

function config(bookingPolicyV2WritesEnabled: boolean): RuntimeConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    appVersion: 'test',
    apiCorsAllowedOrigins: [],
    appointmentConfirmationEnabled: true,
    bookingPolicyV2WritesEnabled,
    appointmentLifecycleEnabled: true,
    lineAuthRateLimit: {
      globalLimit: 120,
      tokenLimit: 5,
      windowSeconds: 60,
      bucketTtlSeconds: 600,
    },
    identity: { mode: 'disabled' },
    media: { mode: 'disabled' },
    notification: { mode: 'disabled' },
  };
}
