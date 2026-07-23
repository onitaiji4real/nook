import { CloudTasksClient, protos } from '@google-cloud/tasks';
import type { RuntimeConfig } from '@nook/config';

type NotificationWorkerConfig = Extract<
  RuntimeConfig['notification'],
  { mode: 'line_push'; service: 'worker' }
>;

interface CloudTasksGatewayClient {
  queuePath(projectId: string, region: string, queue: string): string;
  taskPath(projectId: string, region: string, queue: string, task: string): string;
  createTask(input: {
    readonly parent: string;
    readonly task: protos.google.cloud.tasks.v2.ITask;
  }): Promise<unknown>;
}

export interface NotificationTaskGateway {
  enqueue(jobId: string): Promise<'enqueued' | 'replayed'>;
}

export class GcpNotificationTaskGateway implements NotificationTaskGateway {
  private readonly client: CloudTasksGatewayClient;

  constructor(
    private readonly config: NotificationWorkerConfig,
    client: CloudTasksGatewayClient = new CloudTasksClient(),
  ) {
    this.client = client;
  }

  async enqueue(jobId: string): Promise<'enqueued' | 'replayed'> {
    const parent = this.client.queuePath(
      this.config.projectId,
      this.config.region,
      this.config.taskQueue,
    );
    const task: protos.google.cloud.tasks.v2.ITask = {
      name: this.client.taskPath(
        this.config.projectId,
        this.config.region,
        this.config.taskQueue,
        `notification-${jobId}`,
      ),
      httpRequest: {
        httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
        url: `${this.config.workerUrl.replace(/\/$/u, '')}/internal/notifications/deliver`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: this.config.taskInvokerServiceAccount,
          audience: this.config.workerUrl,
        },
      },
    };
    try {
      await this.client.createTask({ parent, task });
      return 'enqueued';
    } catch (error) {
      if (isAlreadyExists(error)) return 'replayed';
      throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 6
  );
}
