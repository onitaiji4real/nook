import { Inject, Injectable } from '@nestjs/common';
import { createHealthResponse, type HealthResponse } from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';

import { DatabaseProbeService } from './database-probe.service';
import { RUNTIME_CONFIG } from './runtime-config.token';

export interface ReadinessResult {
  readonly statusCode: 200 | 503;
  readonly body: HealthResponse;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(DatabaseProbeService) private readonly databaseProbe: DatabaseProbeService,
  ) {}

  health(): HealthResponse {
    return createHealthResponse({
      status: 'ok',
      service: 'api',
      version: this.config.appVersion,
    });
  }

  async readiness(): Promise<ReadinessResult> {
    const ready = await this.databaseProbe.isReady();

    return {
      statusCode: ready ? 200 : 503,
      body: createHealthResponse({
        status: ready ? 'ready' : 'unavailable',
        service: 'api',
        version: this.config.appVersion,
      }),
    };
  }
}
