import type { RuntimeConfig } from '@nook/config';
import type { ConsumeRateLimitInput, RateLimitDecision, RateLimitRepository } from '@nook/database';
import { describe, expect, it } from 'vitest';

import { ApplicationError } from '../../../src/platform/http/application-error';
import { LineAuthRateLimitService } from '../../../src/modules/line-auth/line-auth-rate-limit.service';

class InMemoryRateLimitRepository implements RateLimitRepository {
  readonly inputs: ConsumeRateLimitInput[] = [];
  private readonly counts = new Map<string, number>();

  consume(input: ConsumeRateLimitInput): Promise<RateLimitDecision> {
    this.inputs.push(input);
    const key = `${input.scope}:${input.keyHash}:${input.windowStart.toISOString()}`;
    const requestCount = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, requestCount);
    return Promise.resolve({ allowed: requestCount <= input.limit, requestCount });
  }
}

const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
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
    globalLimit: 2,
    tokenLimit: 1,
    windowSeconds: 60,
    bucketTtlSeconds: 600,
  },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('LineAuthRateLimitService', () => {
  it('uses stable hashes without persisting the raw LINE token', async () => {
    const repository = new InMemoryRateLimitRepository();
    const service = new LineAuthRateLimitService(repository, config);

    await service.consume('sensitive.raw.line.token', new Date('2026-07-21T14:00:30.000Z'));

    expect(repository.inputs).toHaveLength(2);
    expect(repository.inputs.map((input) => input.scope)).toEqual([
      'line_exchange_global',
      'line_exchange_token',
    ]);
    for (const input of repository.inputs) {
      expect(input.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(input.keyHash).not.toContain('sensitive.raw.line.token');
      expect(input.windowStart.toISOString()).toBe('2026-07-21T14:00:00.000Z');
      expect(input.expiresAt.toISOString()).toBe('2026-07-21T14:10:00.000Z');
    }
  });

  it('rejects a repeated token with a bounded Retry-After value', async () => {
    const repository = new InMemoryRateLimitRepository();
    const service = new LineAuthRateLimitService(repository, config);
    const now = new Date('2026-07-21T14:00:30.250Z');

    await service.consume('same-token', now);
    await expect(service.consume('same-token', now)).rejects.toMatchObject({
      status: 429,
      code: 'line_exchange_rate_limited',
      retryAfterSeconds: 30,
    });
  });

  it('enforces the global provider-call ceiling before creating another token bucket', async () => {
    const repository = new InMemoryRateLimitRepository();
    const service = new LineAuthRateLimitService(repository, config);
    const now = new Date('2026-07-21T14:00:01.000Z');

    await service.consume('token-a', now);
    await service.consume('token-b', now);
    await expect(service.consume('token-c', now)).rejects.toMatchObject({ status: 429 });
    expect(repository.inputs.filter((input) => input.scope === 'line_exchange_token')).toHaveLength(
      2,
    );
  });

  it('fails closed without leaking a repository error', async () => {
    const repository: RateLimitRepository = {
      consume: () => Promise.reject(new Error('database connection details')),
    };
    const service = new LineAuthRateLimitService(repository, config);

    await expect(service.consume('token')).rejects.toEqual(
      new ApplicationError(
        503,
        'auth_rate_limit_unavailable',
        'Service Unavailable',
        'Authentication is temporarily unavailable.',
      ),
    );
  });
});
