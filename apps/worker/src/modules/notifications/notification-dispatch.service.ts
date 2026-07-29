import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type {
  LineWebhookRepository,
  NotificationDispatchRepository,
  NotificationOperationalSnapshot,
  NotificationProjectionRepository,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import type { NotificationTaskGateway } from './notification-task-gateway';
import {
  LINE_WEBHOOK_REPOSITORY,
  NOTIFICATION_DISPATCH_REPOSITORY,
  NOTIFICATION_PROJECTION_REPOSITORY,
  NOTIFICATION_TASK_GATEWAY,
} from './notification.tokens';

const batchLimit = 100;

@Injectable()
export class NotificationDispatchService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(NOTIFICATION_PROJECTION_REPOSITORY)
    private readonly projectionRepository: NotificationProjectionRepository,
    @Inject(NOTIFICATION_DISPATCH_REPOSITORY)
    private readonly dispatchRepository: NotificationDispatchRepository,
    @Inject(NOTIFICATION_TASK_GATEWAY)
    private readonly taskGateway: NotificationTaskGateway,
    @Inject(LINE_WEBHOOK_REPOSITORY)
    private readonly lineWebhookRepository: LineWebhookRepository,
  ) {}

  requireScheduler(value: string | undefined): void {
    if (value !== 'true') throw new NotificationDispatchRequestError(403, 'scheduler_required');
  }

  async run(requestId: string): Promise<NotificationDispatchResult> {
    let projectedCount = 0;
    let failedProjectionCount = 0;
    for (let index = 0; index < batchLimit; index += 1) {
      const outcome = await this.projectionRepository.projectNext();
      if (outcome.kind === 'empty') break;
      if (outcome.kind === 'projected') projectedCount += 1;
      else failedProjectionCount += 1;
    }

    let expiredCount = 0;
    for (let index = 0; index < batchLimit; index += 1) {
      const outcome = await this.dispatchRepository.sweepNextExpired();
      if (outcome.kind === 'empty') break;
      expiredCount += 1;
    }

    let enqueuedCount = 0;
    if (this.config.notification.mode === 'line_push') {
      for (let index = 0; index < batchLimit; index += 1) {
        const claim = await this.dispatchRepository.claimNext();
        if (claim === null) break;
        await this.taskGateway.enqueue(claim.jobId);
        if (!(await this.dispatchRepository.markEnqueued(claim))) {
          throw new NotificationDispatchRequestError(503, 'dispatch_claim_lost');
        }
        enqueuedCount += 1;
      }
    }

    const deletedWebhookCount = await this.lineWebhookRepository.deleteExpired({ limit: 1_000 });
    const storedSnapshot = await this.dispatchRepository.readOperationalSnapshot();
    const lineBudgetMonthlyCap =
      this.config.notification.mode === 'line_push' && this.config.notification.service === 'worker'
        ? this.config.notification.monthlyCap
        : null;
    const operationalSnapshot = {
      ...storedSnapshot,
      lineBudgetMonthlyCap,
      lineBudgetUtilizationBps:
        lineBudgetMonthlyCap === null
          ? null
          : Math.floor((storedSnapshot.lineBudgetReservedCount * 10_000) / lineBudgetMonthlyCap),
    };
    const result = {
      projectedCount,
      failedProjectionCount,
      expiredCount,
      enqueuedCount,
      deletedWebhookCount,
      operationalSnapshot,
    };
    process.stdout.write(
      `${JSON.stringify({
        severity: 'INFO',
        service: 'worker',
        operation: 'notifications.dispatch',
        outcome: 'success',
        requestId,
        ...result,
      })}\n`,
    );
    return result;
  }
}

export interface NotificationDispatchResult {
  readonly projectedCount: number;
  readonly failedProjectionCount: number;
  readonly expiredCount: number;
  readonly enqueuedCount: number;
  readonly deletedWebhookCount: number;
  readonly operationalSnapshot: NotificationDispatchOperationalSnapshot;
}

export interface NotificationDispatchOperationalSnapshot extends NotificationOperationalSnapshot {
  readonly lineBudgetMonthlyCap: number | null;
  readonly lineBudgetUtilizationBps: number | null;
}

export class NotificationDispatchRequestError extends Error {
  constructor(
    readonly status: 403 | 503,
    readonly code: 'scheduler_required' | 'dispatch_claim_lost',
  ) {
    super(code);
    this.name = 'NotificationDispatchRequestError';
  }
}
