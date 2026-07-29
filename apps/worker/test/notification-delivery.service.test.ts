import type { RuntimeConfig } from '@nook/config';
import type { NotificationDeliveryRepository } from '@nook/database';
import type { LinePushClient } from '@nook/line';
import { describe, expect, it, vi } from 'vitest';

import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service';

const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8081,
  appVersion: 'test-sha',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  crmNotesMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: {
    globalLimit: 120,
    tokenLimit: 5,
    windowSeconds: 60,
    bucketTtlSeconds: 600,
  },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: {
    mode: 'line_push',
    service: 'worker',
    accessToken: 'synthetic-token',
    projectId: 'synthetic-project',
    region: 'asia-east1',
    taskQueue: 'nook-notifications',
    workerUrl: 'https://worker.nook.example',
    taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
    publicWebBaseUrl: 'http://localhost:3000',
    monthlyCap: 1_000,
  },
};

describe('NotificationDeliveryService', () => {
  it('renders the canonical template and completes an accepted provider call', async () => {
    const repository = {
      claim: vi
        .fn()
        .mockImplementation(({ render }: Parameters<NotificationDeliveryRepository['claim']>[0]) =>
          Promise.resolve({
            kind: 'claimed',
            jobId: '10000000-0000-4000-8000-000000000001',
            attemptNumber: 1,
            leaseUntil: new Date('2026-07-23T01:02:00.000Z'),
            recipient: 'U00000000000000000000000000000000',
            retryKey: '20000000-0000-4000-8000-000000000002',
            text: render({
              templateKey: 'appointment.confirmed.v1',
              tenantName: '沐光美甲',
              serviceName: '凝膠服務',
              startAt: new Date('2026-07-24T02:00:00.000Z'),
              timezone: 'Asia/Taipei',
              locationName: '大安店',
            }),
          }),
        ),
      complete: vi.fn().mockResolvedValue({ kind: 'accepted', replayed: false }),
    };
    const send = vi.fn<Pick<LinePushClient, 'send'>['send']>();
    send.mockResolvedValue({ kind: 'accepted', httpStatus: 200 });
    const lineClient = {
      send,
    };
    const service = createService(repository, lineClient);

    await expect(
      service.deliver('10000000-0000-4000-8000-000000000001', 'request-1'),
    ).resolves.toEqual({ outcome: 'accepted' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].retryKey).toBe('20000000-0000-4000-8000-000000000002');
    expect(send.mock.calls[0]?.[0].text).toContain('預約已成立\n沐光美甲\n服務：凝膠服務');
  });

  it('returns 503 for retryable provider outcomes so Cloud Tasks retries', async () => {
    const claim = {
      kind: 'claimed' as const,
      jobId: '10000000-0000-4000-8000-000000000001',
      attemptNumber: 1,
      leaseUntil: new Date('2026-07-23T01:02:00.000Z'),
      recipient: 'U00000000000000000000000000000000',
      retryKey: '20000000-0000-4000-8000-000000000002',
      text: 'synthetic text',
    };
    const repository = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn().mockResolvedValue({ kind: 'retryable' }),
    };
    const lineClient = {
      send: vi.fn().mockResolvedValue({ kind: 'retryable', code: 'line_timeout' }),
    };
    const service = createService(repository, lineClient);

    await expect(
      service.deliver('10000000-0000-4000-8000-000000000001', 'request-2'),
    ).rejects.toMatchObject({ status: 503, code: 'provider_retryable' });
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it('validates the exact queue marker and ID-only request body', () => {
    const service = createService({ claim: vi.fn(), complete: vi.fn() }, { send: vi.fn() });
    expect(() => service.requireTask('nook-notifications')).not.toThrow();
    expect(() => service.requireTask('other')).toThrowError('task_queue_required');
    expect(service.parseBody({ jobId: '10000000-0000-4000-8000-000000000001' })).toEqual({
      jobId: '10000000-0000-4000-8000-000000000001',
    });
    expect(() =>
      service.parseBody({ jobId: '10000000-0000-4000-8000-000000000001', tenantId: 'leak' }),
    ).toThrowError('request_body_invalid');
  });
});

function createService(repository: object, lineClient: object) {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return new NotificationDeliveryService(
    config,
    repository as NotificationDeliveryRepository,
    lineClient as Pick<LinePushClient, 'send'>,
  );
}
