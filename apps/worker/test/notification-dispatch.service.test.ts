import type { RuntimeConfig } from '@nook/config';
import type {
  LineWebhookRepository,
  NotificationDispatchRepository,
  NotificationProjectionRepository,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { NotificationDispatchService } from '../src/modules/notifications/notification-dispatch.service';
import type { NotificationTaskGateway } from '../src/modules/notifications/notification-task-gateway';

const baseConfig: Omit<RuntimeConfig, 'notification'> = {
  nodeEnv: 'test',
  port: 8081,
  appVersion: 'test-sha',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
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
};

function dependencies() {
  const operationalSnapshot = {
    oldestPendingOutboxAgeSeconds: 12,
    oldestDueJobDelaySeconds: 34,
    deadLetterJobCount: 1,
    retryableAttemptCount24h: 2,
    acceptedAttemptCount24h: 8,
    lineBudgetReservedCount: 55,
  };
  const projection = {
    projectNext: vi
      .fn()
      .mockResolvedValueOnce({ kind: 'projected', eventId: 'event-1', jobCount: 2 })
      .mockResolvedValueOnce({ kind: 'failed', eventId: 'event-2', code: 'payload_invalid' })
      .mockResolvedValue({ kind: 'empty' }),
  };
  const dispatch = {
    sweepNextExpired: vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'terminal',
        jobId: 'job-expired',
        status: 'SKIPPED',
        code: 'notification_expired',
      })
      .mockResolvedValue({ kind: 'empty' }),
    claimNext: vi.fn().mockResolvedValue(null),
    markEnqueued: vi.fn().mockResolvedValue(true),
    readOperationalSnapshot: vi.fn().mockResolvedValue(operationalSnapshot),
  };
  const tasks = { enqueue: vi.fn().mockResolvedValue('enqueued') };
  const webhooks = { record: vi.fn(), deleteExpired: vi.fn().mockResolvedValue(3) };
  return { projection, dispatch, tasks, webhooks, operationalSnapshot };
}

describe('NotificationDispatchService', () => {
  it('projects and sweeps while disabled without enqueueing a late blast', async () => {
    const deps = dependencies();
    const service = serviceFor({ ...baseConfig, notification: { mode: 'disabled' } }, deps);

    await expect(service.run('request-1')).resolves.toEqual({
      projectedCount: 1,
      failedProjectionCount: 1,
      expiredCount: 1,
      enqueuedCount: 0,
      deletedWebhookCount: 3,
      operationalSnapshot: {
        ...deps.operationalSnapshot,
        lineBudgetMonthlyCap: null,
        lineBudgetUtilizationBps: null,
      },
    });
    expect(deps.dispatch.claimNext).not.toHaveBeenCalled();
    expect(deps.tasks.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a claimed job and records the exact lease completion', async () => {
    const deps = dependencies();
    const claim = { jobId: '10000000-0000-4000-8000-000000000001', leaseUntil: new Date() };
    deps.dispatch.claimNext.mockResolvedValueOnce(claim).mockResolvedValue(null);
    const service = serviceFor(
      {
        ...baseConfig,
        notification: {
          mode: 'line_push',
          service: 'worker',
          accessToken: 'synthetic-token',
          projectId: 'synthetic-project',
          region: 'asia-east1',
          taskQueue: 'nook-notifications',
          workerUrl: 'https://worker.nook.example',
          taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
          publicWebBaseUrl: 'https://app.nook.example',
          monthlyCap: 1_000,
        },
      },
      deps,
    );

    await expect(service.run('request-2')).resolves.toMatchObject({
      enqueuedCount: 1,
      operationalSnapshot: {
        lineBudgetMonthlyCap: 1_000,
        lineBudgetUtilizationBps: 550,
      },
    });
    expect(deps.tasks.enqueue).toHaveBeenCalledWith(claim.jobId);
    expect(deps.dispatch.markEnqueued).toHaveBeenCalledWith(claim);
  });

  it('requires the scheduler defense-in-depth header', () => {
    const deps = dependencies();
    const service = serviceFor({ ...baseConfig, notification: { mode: 'disabled' } }, deps);
    expect(() => service.requireScheduler(undefined)).toThrowError('scheduler_required');
    expect(() => service.requireScheduler('true')).not.toThrow();
  });
});

function serviceFor(config: RuntimeConfig, deps: ReturnType<typeof dependencies>) {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return new NotificationDispatchService(
    config,
    deps.projection as unknown as NotificationProjectionRepository,
    deps.dispatch as unknown as NotificationDispatchRepository,
    deps.tasks as unknown as NotificationTaskGateway,
    deps.webhooks as unknown as LineWebhookRepository,
  );
}
