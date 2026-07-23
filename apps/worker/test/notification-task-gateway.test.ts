import { protos } from '@google-cloud/tasks';
import type { RuntimeConfig } from '@nook/config';
import { describe, expect, it, vi } from 'vitest';

import { GcpNotificationTaskGateway } from '../src/modules/notifications/notification-task-gateway';

const config: Extract<RuntimeConfig['notification'], { mode: 'line_push'; service: 'worker' }> = {
  mode: 'line_push',
  service: 'worker',
  accessToken: 'synthetic-token',
  projectId: 'synthetic-project',
  region: 'asia-east1',
  taskQueue: 'nook-notifications',
  workerUrl: 'https://worker.nook.example',
  taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
  publicWebBaseUrl: 'https://app.nook.example',
  monthlyCap: 1000,
};

function client() {
  const createTask =
    vi.fn<
      (input: {
        readonly parent: string;
        readonly task: protos.google.cloud.tasks.v2.ITask;
      }) => Promise<unknown>
    >();
  createTask.mockResolvedValue({});
  return {
    queuePath: vi.fn().mockReturnValue('queues/nook-notifications'),
    taskPath: vi.fn().mockReturnValue('tasks/notification-job-id'),
    createTask,
  };
}

describe('GcpNotificationTaskGateway', () => {
  it('enqueues an ID-only body with deterministic task name and OIDC', async () => {
    const tasks = client();
    const gateway = new GcpNotificationTaskGateway(config, tasks);
    await expect(gateway.enqueue('10000000-0000-4000-8000-000000000001')).resolves.toBe('enqueued');
    expect(tasks.taskPath).toHaveBeenCalledWith(
      'synthetic-project',
      'asia-east1',
      'nook-notifications',
      'notification-10000000-0000-4000-8000-000000000001',
    );
    const request = tasks.createTask.mock.calls[0]?.[0];
    expect(request?.task.httpRequest).toMatchObject({
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: 'https://worker.nook.example/internal/notifications/deliver',
      oidcToken: {
        serviceAccountEmail: 'tasks@example.iam.gserviceaccount.com',
        audience: 'https://worker.nook.example',
      },
    });
    const body = request?.task.httpRequest?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('expected base64 task body');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe(
      JSON.stringify({ jobId: '10000000-0000-4000-8000-000000000001' }),
    );
  });

  it('treats deterministic AlreadyExists as an idempotent replay', async () => {
    const tasks = client();
    tasks.createTask.mockRejectedValueOnce({ code: 6 });
    await expect(
      new GcpNotificationTaskGateway(config, tasks).enqueue('10000000-0000-4000-8000-000000000001'),
    ).resolves.toBe('replayed');
  });

  it('preserves non-idempotent queue failures', async () => {
    const tasks = client();
    const failure = new Error('synthetic queue failure');
    tasks.createTask.mockRejectedValueOnce(failure);
    await expect(
      new GcpNotificationTaskGateway(config, tasks).enqueue('10000000-0000-4000-8000-000000000001'),
    ).rejects.toBe(failure);
  });
});
