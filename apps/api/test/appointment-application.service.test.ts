import type { RuntimeConfig } from '@nook/config';
import {
  AppointmentConfirmationRepositoryError,
  type AppointmentConfirmationRepository,
  type ConfirmAppointmentInput,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationError } from '../src/platform/http/application-error';
import { AppointmentApplicationService } from '../src/modules/appointments/appointment-application.service';

describe('AppointmentApplicationService', () => {
  const body = {
    holdId: '10000000-0000-4000-8000-000000000001',
    policiesAccepted: true,
    policyVersion: `v1:${'a'.repeat(64)}`,
  } as const;

  it('canonicalizes the server-owned confirmation fingerprint and returns the owner representation', async () => {
    let captured: ConfirmAppointmentInput | undefined;
    const confirm = vi.fn<AppointmentConfirmationRepository['confirm']>((input) => {
      captured = input;
      return Promise.resolve({ kind: 'created', appointment: appointmentRecord() });
    });
    const repository: AppointmentConfirmationRepository = {
      confirm,
    };
    const response = await new AppointmentApplicationService(repository, runtimeConfig()).create({
      consumerUserId: '20000000-0000-4000-8000-000000000001',
      idempotencyKey: '30000000-0000-4000-8000-000000000001',
      requestId: 'request-1',
      body,
    });

    expect(captured).toMatchObject({
      holdId: body.holdId,
      policyVersion: body.policyVersion,
    });
    expect(captured?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(response).toMatchObject({
      appointmentCreated: true,
      status: 'CONFIRMED',
      location: { addressText: '台北市測試路 1 號' },
      policies: { version: body.policyVersion },
    });
  });

  it('fails closed while disabled and maps malformed hold identifiers to privacy-safe 404', async () => {
    const confirm = vi.fn<AppointmentConfirmationRepository['confirm']>();
    const repository: AppointmentConfirmationRepository = { confirm };
    await expect(
      new AppointmentApplicationService(repository, runtimeConfig(false)).create({
        consumerUserId: 'consumer',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        requestId: 'request-2',
        body,
      }),
    ).rejects.toMatchObject({ status: 503, code: 'appointment_confirmation_disabled' });
    await expect(
      new AppointmentApplicationService(repository, runtimeConfig()).create({
        consumerUserId: 'consumer',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        requestId: 'request-3',
        body: { ...body, holdId: 'not-a-uuid' },
      }),
    ).rejects.toMatchObject({ status: 404, code: 'booking_hold_not_found' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['monthly_booking_limit_reached', 403, 'monthly_booking_limit_reached'],
    ['policy_version_mismatch', 409, 'policy_version_mismatch'],
    ['entitlement_unavailable', 503, 'booking_entitlement_unavailable'],
  ] as const)('maps repository %s to a safe API problem', async (repositoryCode, status, code) => {
    const repository: AppointmentConfirmationRepository = {
      confirm: vi.fn(() =>
        Promise.reject(new AppointmentConfirmationRepositoryError(repositoryCode)),
      ),
    };
    await expect(
      new AppointmentApplicationService(repository, runtimeConfig()).create({
        consumerUserId: 'consumer',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        requestId: 'request-4',
        body,
      }),
    ).rejects.toMatchObject({ status, code });
  });

  it('turns a committed expiry outcome into a 409 only after the repository returns', async () => {
    const repository: AppointmentConfirmationRepository = {
      confirm: vi
        .fn<AppointmentConfirmationRepository['confirm']>()
        .mockResolvedValue({ kind: 'expired' }),
    };
    await expect(
      new AppointmentApplicationService(repository, runtimeConfig()).create({
        consumerUserId: 'consumer',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        requestId: 'request-5',
        body,
      }),
    ).rejects.toBeInstanceOf(ApplicationError);
    await expect(
      new AppointmentApplicationService(repository, runtimeConfig()).create({
        consumerUserId: 'consumer',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        requestId: 'request-5',
        body,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'hold_expired' });
  });
});

function runtimeConfig(appointmentConfirmationEnabled = true): RuntimeConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    appVersion: 'test',
    apiCorsAllowedOrigins: [],
    appointmentConfirmationEnabled,
    bookingPolicyV2WritesEnabled: true,
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

function appointmentRecord() {
  const confirmedAt = new Date('2026-07-22T08:00:00.000Z');
  return {
    id: '40000000-0000-4000-8000-000000000001',
    status: 'CONFIRMED' as const,
    source: 'MERCHANT_LINK' as const,
    pricingStatus: 'EXACT' as const,
    paymentStatus: 'NOT_REQUIRED' as const,
    timezone: 'Asia/Taipei',
    startAt: new Date('2026-07-24T03:00:00.000Z'),
    endAt: new Date('2026-07-24T04:00:00.000Z'),
    confirmedAt,
    currency: 'TWD',
    subtotalAmount: 1200,
    depositAmount: 0 as const,
    totalAmount: 1200,
    service: {
      id: '50000000-0000-4000-8000-000000000001',
      name: '凝膠服務',
      durationMinutes: 60,
      priceType: 'FIXED' as const,
      priceAmount: 1200,
      priceMin: null,
      priceMax: null,
      currency: 'TWD',
    },
    staff: { id: '60000000-0000-4000-8000-000000000001', displayName: 'Yun' },
    policies: {
      version: `v1:${'a'.repeat(64)}`,
      bookingPolicy: '完全預約制',
      cancellationPolicy: '提前24小時',
      acceptedAt: confirmedAt,
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
      cancelUntil: new Date('2026-07-23T03:00:00.000Z'),
      rescheduleUntil: new Date('2026-07-23T03:00:00.000Z'),
      cancelUntilInclusive: true,
      rescheduleUntilInclusive: true,
    },
    location: {
      name: '主要工作室',
      addressText: '台北市測試路 1 號',
      postalCode: '106',
      city: '台北市',
      district: '大安區',
    },
  };
}
