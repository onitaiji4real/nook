import type { RuntimeConfig } from '@nook/config';
import type { AppointmentLifecycleRepository } from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { AppointmentLifecycleApplicationService } from '../../../src/modules/appointments/appointment-lifecycle-application.service';

const actorUserId = '10000000-0000-4000-8000-000000000001';
const tenantId = '20000000-0000-4000-8000-000000000001';
const appointmentId = '30000000-0000-4000-8000-000000000001';

describe('AppointmentLifecycleApplicationService', () => {
  it('hashes the key and canonicalizes a consumer cancellation fingerprint', async () => {
    const transitionConsumerCancel = vi
      .fn<AppointmentLifecycleRepository['transitionConsumerCancel']>()
      .mockResolvedValue({
        appointmentId,
        status: 'CANCELLED',
        occurredAt: new Date('2026-07-22T12:00:00.000Z'),
        replacementAppointmentId: null,
        replayed: false,
      });
    const service = new AppointmentLifecycleApplicationService(
      repository({ transitionConsumerCancel }),
      config(true),
    );
    const response = await service.consumerCancel({
      actorUserId,
      rawAppointmentId: appointmentId,
      rawIdempotencyKey: 'consumer-cancel-01',
      body: { reasonCode: 'CONSUMER_CHANGE_OF_PLANS' },
      requestId: 'request-1',
    });
    expect(transitionConsumerCancel).toHaveBeenCalledOnce();
    const [transitionInput] = transitionConsumerCancel.mock.calls[0] ?? [];
    expect(transitionInput).toMatchObject({ actorUserId, appointmentId });
    expect(transitionInput?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(transitionInput?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(response).toEqual({
      appointmentId,
      status: 'CANCELLED',
      occurredAt: '2026-07-22T12:00:00.000Z',
      replacementAppointmentId: null,
    });
  });

  it('fails closed before consumer resource, key and body validation', async () => {
    const transitionConsumerCancel =
      vi.fn<AppointmentLifecycleRepository['transitionConsumerCancel']>();
    const lifecycle = repository({ transitionConsumerCancel });
    const service = new AppointmentLifecycleApplicationService(lifecycle, config(false));
    await expect(
      service.consumerCancel({
        actorUserId,
        rawAppointmentId: 'bad',
        rawIdempotencyKey: 'bad',
        body: null,
        requestId: 'request-2',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'appointment_lifecycle_unavailable' });
    expect(transitionConsumerCancel).not.toHaveBeenCalled();
  });

  it('returns the replacement identity and preserves the committed target expiry outcome', async () => {
    const transitionConsumerReschedule = vi
      .fn<AppointmentLifecycleRepository['transitionConsumerReschedule']>()
      .mockResolvedValueOnce({
        kind: 'transition',
        result: {
          appointmentId,
          status: 'RESCHEDULED',
          occurredAt: new Date('2026-07-22T12:30:00.000Z'),
          replacementAppointmentId: '40000000-0000-4000-8000-000000000001',
          replayed: false,
        },
      })
      .mockResolvedValueOnce({ kind: 'target_expired' });
    const service = new AppointmentLifecycleApplicationService(
      repository({ transitionConsumerReschedule }),
      config(true),
    );
    const request = {
      actorUserId,
      rawAppointmentId: appointmentId,
      rawIdempotencyKey: 'consumer-reschedule-01',
      body: {
        holdId: '50000000-0000-4000-8000-000000000001',
        policyVersion: `v2:${'a'.repeat(64)}`,
        policiesAccepted: true,
        reasonCode: 'RESCHEDULE_SCHEDULE_CONFLICT',
      },
      requestId: 'request-reschedule',
    } as const;
    await expect(service.consumerReschedule(request)).resolves.toMatchObject({
      status: 'RESCHEDULED',
      replacementAppointmentId: '40000000-0000-4000-8000-000000000001',
    });
    await expect(service.consumerReschedule(request)).rejects.toMatchObject({
      status: 409,
      code: 'target_hold_expired',
    });
  });

  it('authorizes merchant scope before returning the disabled capability error', async () => {
    const authorizeMerchant = vi
      .fn<AppointmentLifecycleRepository['authorizeMerchant']>()
      .mockResolvedValue();
    const transitionMerchant = vi.fn<AppointmentLifecycleRepository['transitionMerchant']>();
    const lifecycle = repository({ authorizeMerchant, transitionMerchant });
    const service = new AppointmentLifecycleApplicationService(lifecycle, config(false));
    await expect(
      service.merchantTransition({
        actorUserId,
        tenantId,
        rawAppointmentId: 'bad',
        rawIdempotencyKey: 'bad',
        endpoint: 'merchant.check_in',
        body: { extra: true },
        requestId: 'request-3',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'appointment_lifecycle_unavailable' });
    expect(authorizeMerchant).toHaveBeenCalledWith({ actorUserId, tenantId });
    expect(transitionMerchant).not.toHaveBeenCalled();
  });
});

function repository(
  overrides: Partial<AppointmentLifecycleRepository> = {},
): AppointmentLifecycleRepository {
  return {
    authorizeMerchant: vi.fn(),
    authorizeConsumerAppointment: vi.fn(),
    authorizeMerchantAppointment: vi.fn(),
    transitionConsumerCancel: vi.fn(),
    transitionConsumerReschedule: vi.fn(),
    transitionMerchant: vi.fn(),
    ...overrides,
  };
}

function config(appointmentLifecycleEnabled: boolean): RuntimeConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    appVersion: 'test',
    apiCorsAllowedOrigins: [],
    appointmentConfirmationEnabled: true,
    bookingPolicyV2WritesEnabled: true,
    appointmentLifecycleEnabled,
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
