import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type { RateLimitRepository } from '@nook/database';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { RATE_LIMIT_REPOSITORY } from './rate-limit.tokens';

const globalKeyHash = createHash('sha256').update('line-exchange-global').digest('hex');

@Injectable()
export class LineAuthRateLimitService {
  constructor(
    @Inject(RATE_LIMIT_REPOSITORY) private readonly repository: RateLimitRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async consume(idToken: string, now = new Date()): Promise<void> {
    const settings = this.config.lineAuthRateLimit;
    const windowStart = startOfWindow(now, settings.windowSeconds);
    const expiresAt = new Date(windowStart.getTime() + settings.bucketTtlSeconds * 1_000);
    const retryAfterSeconds = secondsUntilNextWindow(now, windowStart, settings.windowSeconds);

    try {
      const globalDecision = await this.repository.consume({
        scope: 'line_exchange_global',
        keyHash: globalKeyHash,
        windowStart,
        expiresAt,
        limit: settings.globalLimit,
        cleanupExpired: true,
      });
      if (!globalDecision.allowed) {
        throw rateLimited(retryAfterSeconds);
      }

      const tokenDecision = await this.repository.consume({
        scope: 'line_exchange_token',
        keyHash: createHash('sha256').update(idToken).digest('hex'),
        windowStart,
        expiresAt,
        limit: settings.tokenLimit,
      });
      if (!tokenDecision.allowed) {
        throw rateLimited(retryAfterSeconds);
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        503,
        'auth_rate_limit_unavailable',
        'Service Unavailable',
        'Authentication is temporarily unavailable.',
      );
    }
  }
}

function startOfWindow(now: Date, windowSeconds: number): Date {
  const windowMilliseconds = windowSeconds * 1_000;
  return new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds);
}

function secondsUntilNextWindow(now: Date, windowStart: Date, windowSeconds: number): number {
  const remainingMilliseconds = windowStart.getTime() + windowSeconds * 1_000 - now.getTime();
  return Math.max(1, Math.ceil(remainingMilliseconds / 1_000));
}

function rateLimited(retryAfterSeconds: number): ApplicationError {
  return new ApplicationError(
    429,
    'line_exchange_rate_limited',
    'Too Many Requests',
    'Too many authentication attempts. Try again later.',
    retryAfterSeconds,
  );
}
