import { describe, expect, it, vi } from 'vitest';

import type { DatabaseProbeService } from '../src/database-probe.service';
import { HealthService } from '../src/health.service';

describe('api HealthService', () => {
  it('presents the stable health response', () => {
    const probe = { isReady: vi.fn() } as unknown as DatabaseProbeService;
    const service = new HealthService(
      { nodeEnv: 'test', port: 8080, appVersion: 'test-sha' },
      probe,
    );

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'api',
      version: 'test-sha',
    });
  });

  it('reports an unavailable dependency without exposing its connection details', async () => {
    const probe = { isReady: vi.fn().mockResolvedValue(false) } as unknown as DatabaseProbeService;
    const service = new HealthService(
      { nodeEnv: 'test', port: 8080, appVersion: 'test-sha' },
      probe,
    );

    await expect(service.readiness()).resolves.toMatchObject({
      statusCode: 503,
      body: { status: 'unavailable', service: 'api', version: 'test-sha' },
    });
  });
});
