import { Prisma, type PrismaClient } from '@prisma/client';

export interface ConsumeRateLimitInput {
  readonly scope: string;
  readonly keyHash: string;
  readonly windowStart: Date;
  readonly expiresAt: Date;
  readonly limit: number;
  readonly cleanupExpired?: boolean;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly requestCount: number;
}

export interface RateLimitRepository {
  consume(input: ConsumeRateLimitInput): Promise<RateLimitDecision>;
}

export class PrismaRateLimitRepository implements RateLimitRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async consume(input: ConsumeRateLimitInput): Promise<RateLimitDecision> {
    if (input.cleanupExpired === true) {
      await this.prisma.authRateLimitBucket.deleteMany({
        where: { expiresAt: { lte: input.windowStart } },
      });
    }

    const rows = await this.prisma.$queryRaw<Array<{ requestCount: number }>>(Prisma.sql`
      INSERT INTO "auth_rate_limit_buckets" (
        "scope",
        "key_hash",
        "window_start",
        "request_count",
        "expires_at",
        "updated_at"
      )
      VALUES (
        ${input.scope},
        ${input.keyHash},
        ${input.windowStart},
        1,
        ${input.expiresAt},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("scope", "key_hash", "window_start")
      DO UPDATE SET
        "request_count" = "auth_rate_limit_buckets"."request_count" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING "request_count" AS "requestCount"
    `);
    const requestCount = rows[0]?.requestCount;
    if (requestCount === undefined) {
      throw new Error('Rate limit counter did not return a row.');
    }

    return { allowed: requestCount <= input.limit, requestCount };
  }
}
