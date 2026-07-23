import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type {
  NotificationDeliveryRepository,
  NotificationProviderResult,
  NotificationTemplateData,
} from '@nook/database';
import { type LinePushClient, renderLineNotificationTemplate } from '@nook/line';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { LINE_PUSH_CLIENT, NOTIFICATION_DELIVERY_REPOSITORY } from './notification.tokens';

@Injectable()
export class NotificationDeliveryService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(NOTIFICATION_DELIVERY_REPOSITORY)
    private readonly repository: NotificationDeliveryRepository,
    @Inject(LINE_PUSH_CLIENT) private readonly lineClient: Pick<LinePushClient, 'send'>,
  ) {}

  requireTask(queueName: string | undefined): void {
    const notification = this.workerConfig();
    if (queueName !== notification.taskQueue) {
      throw new NotificationDeliveryRequestError(403, 'task_queue_required');
    }
  }

  parseBody(value: unknown): { readonly jobId: string } {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new NotificationDeliveryRequestError(400, 'request_body_invalid');
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || !isUuid(body.jobId)) {
      throw new NotificationDeliveryRequestError(400, 'request_body_invalid');
    }
    return { jobId: body.jobId };
  }

  async deliver(jobId: string, requestId: string): Promise<NotificationDeliveryResult> {
    const notification = this.workerConfig();
    const claim = await this.repository.claim({
      jobId,
      monthlyCap: notification.monthlyCap,
      render: (data) => this.render(data, notification.publicWebBaseUrl),
    });
    if (claim.kind === 'busy') {
      throw new NotificationDeliveryRequestError(503, 'delivery_in_progress');
    }
    if (claim.kind !== 'claimed') {
      const outcome =
        claim.kind === 'skipped'
          ? 'skipped'
          : claim.kind === 'dead_letter'
            ? 'dead_letter'
            : 'success';
      this.log(requestId, jobId, outcome);
      return { outcome };
    }

    const providerResult = await this.lineClient.send({
      recipient: claim.recipient,
      retryKey: claim.retryKey,
      text: claim.text,
    });
    const completion = await this.repository.complete({
      claim,
      result: providerResult as NotificationProviderResult,
    });
    if (completion.kind === 'retryable') {
      this.log(requestId, jobId, 'retryable');
      throw new NotificationDeliveryRequestError(503, 'provider_retryable');
    }
    const outcome =
      completion.kind === 'accepted'
        ? completion.replayed
          ? 'replayed'
          : 'accepted'
        : completion.kind === 'dead_letter'
          ? 'dead_letter'
          : 'success';
    this.log(requestId, jobId, outcome);
    return { outcome };
  }

  private workerConfig(): Extract<
    RuntimeConfig['notification'],
    { mode: 'line_push'; service: 'worker' }
  > {
    if (
      this.config.notification.mode !== 'line_push' ||
      this.config.notification.service !== 'worker'
    ) {
      throw new NotificationDeliveryRequestError(503, 'notification_disabled');
    }
    return this.config.notification;
  }

  private render(data: NotificationTemplateData, publicWebBaseUrl: string): string | null {
    const result = renderLineNotificationTemplate({
      ...data,
      publicWebBaseUrl,
      allowLocalHttp: ['development', 'test'].includes(this.config.nodeEnv),
    });
    return result.ok ? result.text : null;
  }

  private log(
    requestId: string,
    jobId: string,
    outcome: NotificationDeliveryResult['outcome'],
  ): void {
    process.stdout.write(
      `${JSON.stringify({
        severity: 'INFO',
        service: 'worker',
        operation: 'notifications.deliver',
        outcome,
        requestId,
        jobId,
      })}\n`,
    );
  }
}

export interface NotificationDeliveryResult {
  readonly outcome: 'success' | 'accepted' | 'replayed' | 'skipped' | 'retryable' | 'dead_letter';
}

export class NotificationDeliveryRequestError extends Error {
  constructor(
    readonly status: 400 | 403 | 503,
    readonly code:
      | 'request_body_invalid'
      | 'task_queue_required'
      | 'notification_disabled'
      | 'delivery_in_progress'
      | 'provider_retryable',
  ) {
    super(code);
    this.name = 'NotificationDeliveryRequestError';
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}
