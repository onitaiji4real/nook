import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type {
  CustomerProjectionOperationalSnapshot,
  CustomerProjectionRepository,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { CUSTOMER_PROJECTION_REPOSITORY } from './customer-projection.tokens';

const batchLimit = 100;

@Injectable()
export class CustomerProjectionService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY)
    private readonly repository: CustomerProjectionRepository,
  ) {}

  requireScheduler(value: string | undefined): void {
    if (value !== 'true') throw new CustomerProjectionRequestError(403, 'scheduler_required');
  }

  async run(requestId: string): Promise<CustomerProjectionRunResult> {
    if (this.config.crmProjectionMode === 'disabled') {
      return {
        mode: 'disabled',
        projectedCount: 0,
        terminalCount: 0,
        retryExhaustedMarkedCount: 0,
        backfillProjectedCount: 0,
        backfillOutcome: 'disabled',
        backfillSafeCode: null,
        operationalSnapshot: null,
      };
    }

    const retryExhaustedMarkedCount = await this.repository.sweepRetryExhausted();
    let projectedCount = 0;
    let terminalCount = 0;
    for (let index = 0; index < batchLimit; index += 1) {
      const outcome = await this.repository.projectNext();
      if (outcome.kind === 'empty') break;
      if (outcome.kind === 'projected') projectedCount += 1;
      else terminalCount += 1;
    }

    let backfillProjectedCount = 0;
    let backfillOutcome: CustomerProjectionRunResult['backfillOutcome'] = 'running';
    let backfillSafeCode: string | null = null;
    for (let index = 0; index < batchLimit; index += 1) {
      const outcome = await this.repository.backfillNext();
      if (outcome.kind === 'projected') {
        backfillProjectedCount += 1;
        continue;
      }
      backfillOutcome = outcome.kind;
      backfillSafeCode = outcome.kind === 'failed' ? outcome.code : null;
      break;
    }

    const operationalSnapshot = await this.repository.readOperationalSnapshot();
    const result: CustomerProjectionRunResult = {
      mode: this.config.crmProjectionMode,
      projectedCount,
      terminalCount,
      retryExhaustedMarkedCount,
      backfillProjectedCount,
      backfillOutcome,
      backfillSafeCode,
      operationalSnapshot,
    };
    process.stdout.write(
      `${JSON.stringify({
        severity: 'INFO',
        service: 'worker',
        operation: 'customer-projection.run',
        outcome: 'success',
        requestId,
        ...result,
      })}\n`,
    );
    return result;
  }
}

export interface CustomerProjectionRunResult {
  readonly mode: RuntimeConfig['crmProjectionMode'];
  readonly projectedCount: number;
  readonly terminalCount: number;
  readonly retryExhaustedMarkedCount: number;
  readonly backfillProjectedCount: number;
  readonly backfillOutcome: 'disabled' | 'running' | 'completed' | 'failed';
  readonly backfillSafeCode: string | null;
  readonly operationalSnapshot: CustomerProjectionOperationalSnapshot | null;
}

export class CustomerProjectionRequestError extends Error {
  constructor(
    readonly status: 403,
    readonly code: 'scheduler_required',
  ) {
    super(code);
    this.name = 'CustomerProjectionRequestError';
  }
}
