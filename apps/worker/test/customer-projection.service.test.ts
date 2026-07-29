import type { RuntimeConfig } from '@nook/config';
import type { CustomerProjectionRepository } from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { CustomerProjectionService } from '../src/modules/customer-projection/customer-projection.service';

const baseConfig: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8081,
  appVersion: 'test-sha',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  marketingConsentGrantEnabled: false,
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

describe('CustomerProjectionService', () => {
  it('does not touch the repository while the production-safe mode is disabled', async () => {
    const repository = dependencies();
    const service = serviceFor(baseConfig, repository);

    await expect(service.run('request-disabled')).resolves.toEqual({
      mode: 'disabled',
      projectedCount: 0,
      terminalCount: 0,
      retryExhaustedMarkedCount: 0,
      backfillProjectedCount: 0,
      backfillOutcome: 'disabled',
      backfillSafeCode: null,
      operationalSnapshot: null,
    });
    expect(repository.projectNext).not.toHaveBeenCalled();
    expect(repository.backfillNext).not.toHaveBeenCalled();
  });

  it('projects deliveries, advances backfill and returns only aggregate operations data', async () => {
    const repository = dependencies();
    repository.sweepRetryExhausted.mockResolvedValue(2);
    repository.projectNext
      .mockResolvedValueOnce({
        kind: 'projected',
        deliveryId: 'delivery-1',
        customerId: 'customer-1',
        seededCount: 1,
      })
      .mockResolvedValueOnce({
        kind: 'terminal',
        deliveryId: 'delivery-2',
        code: 'reschedule_chain_invalid',
        seededCount: 0,
      })
      .mockResolvedValue({ kind: 'empty', seededCount: 0 });
    repository.backfillNext
      .mockResolvedValueOnce({
        kind: 'projected',
        appointmentId: 'appointment-1',
        customerId: 'customer-1',
      })
      .mockResolvedValue({ kind: 'completed' });
    const service = serviceFor({ ...baseConfig, crmProjectionMode: 'shadow' }, repository);

    await expect(service.run('request-shadow')).resolves.toEqual({
      mode: 'shadow',
      projectedCount: 1,
      terminalCount: 1,
      retryExhaustedMarkedCount: 2,
      backfillProjectedCount: 1,
      backfillOutcome: 'completed',
      backfillSafeCode: null,
      operationalSnapshot: snapshot,
    });
  });

  it('stops backfill on a safe failure and requires scheduler defense in depth', async () => {
    const repository = dependencies();
    repository.backfillNext.mockResolvedValue({
      kind: 'failed',
      code: 'blocked_stream',
    });
    const service = serviceFor({ ...baseConfig, crmProjectionMode: 'active' }, repository);

    await expect(service.run('request-active')).resolves.toMatchObject({
      mode: 'active',
      backfillOutcome: 'failed',
      backfillSafeCode: 'blocked_stream',
    });
    expect(() => service.requireScheduler(undefined)).toThrowError('scheduler_required');
    expect(() => service.requireScheduler('true')).not.toThrow();
  });
});

const snapshot = {
  oldestPendingAgeSeconds: 5,
  blockedStreamCount: 0,
  retryExhaustedCount: 2,
  backfillStatus: 'COMPLETED' as const,
  backfillRemainingAppointmentCount: 0,
};

function dependencies() {
  return {
    projectNext: vi.fn().mockResolvedValue({ kind: 'empty', seededCount: 0 }),
    seedDeliveries: vi.fn().mockResolvedValue(0),
    backfillNext: vi.fn().mockResolvedValue({ kind: 'completed' }),
    sweepRetryExhausted: vi.fn().mockResolvedValue(0),
    repairBlockedStream: vi.fn().mockResolvedValue({ kind: 'not_blocked' }),
    retryExhaustedDelivery: vi.fn().mockResolvedValue(false),
    resumeBackfill: vi.fn().mockResolvedValue(false),
    readOperationalSnapshot: vi.fn().mockResolvedValue(snapshot),
  };
}

function serviceFor(config: RuntimeConfig, repository: ReturnType<typeof dependencies>) {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return new CustomerProjectionService(
    config,
    repository as unknown as CustomerProjectionRepository,
  );
}
