import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CUSTOM_TOKEN_ISSUER, type CustomTokenIssuer } from '@nook/auth';
import type { LineExchangeResponse, ProblemDetails } from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import { LineVerificationError, type LineIdentityVerifier } from '@nook/line';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/platform/http/request-context.middleware';
import { LINE_IDENTITY_VERIFIER } from '../src/platform/identity/identity.tokens';

class SyntheticLineVerifier implements LineIdentityVerifier {
  readonly verify = vi.fn(
    (rawToken: string): Promise<{ readonly subject: string; readonly displayName: string }> => {
      if (rawToken === 'timeout-token') {
        return Promise.reject(new LineVerificationError('provider_timeout'));
      }
      if (rawToken !== 'valid.raw.token') {
        return Promise.reject(new LineVerificationError('invalid_token'));
      }
      return Promise.resolve({
        subject: 'synthetic-line-subject',
        displayName: 'Synthetic LINE User',
      });
    },
  );
}

const issueToken = vi.fn((userId: string) =>
  Promise.resolve({ customToken: `custom.${userId}`, expiresIn: 3_600 }),
);
const issuer: CustomTokenIssuer = { issue: issueToken };

describe('LINE identity exchange', () => {
  const prisma = getPrismaClient();
  const lineVerifier = new SyntheticLineVerifier();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LINE_IDENTITY_VERIFIER)
      .useValue(lineVerifier)
      .overrideProvider(CUSTOM_TOKEN_ISSUER)
      .useValue(issuer)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await prisma.authRateLimitBucket.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    issueToken.mockClear();
    lineVerifier.verify.mockClear();
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('returns only the custom token contract without a cookie or sensitive logs', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = await exchange('valid.raw.token', 'auth-line-success').expect(200);
    const body = response.body as unknown as LineExchangeResponse;
    expect(body.customToken).toMatch(/^custom\./);
    expect(body.expiresIn).toBe(3_600);
    expect(response.headers['set-cookie']).toBeUndefined();
    const logs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();
    expect(logs).toContain('auth.line.exchange');
    expect(logs).not.toContain('valid.raw.token');
    expect(logs).not.toContain('synthetic-line-subject');
    expect(logs).not.toContain('user@example.com');
  });

  it('is idempotent under concurrent exchanges', async () => {
    const responses = await Promise.all([
      exchange('valid.raw.token', 'concurrent-a'),
      exchange('valid.raw.token', 'concurrent-b'),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await expect(
      prisma.userIdentity.count({
        where: { provider: 'LINE', providerSubject: 'synthetic-line-subject' },
      }),
    ).resolves.toBe(1);
    await expect(prisma.user.count()).resolves.toBe(1);
  });

  it.each(['SUSPENDED', 'DELETED'] as const)(
    'refuses to issue another token when the local user is %s',
    async (status) => {
      await exchange('valid.raw.token', `create-${status.toLowerCase()}`).expect(200);
      const identity = await prisma.userIdentity.findUniqueOrThrow({
        where: {
          provider_providerSubject: {
            provider: 'LINE',
            providerSubject: 'synthetic-line-subject',
          },
        },
        select: { userId: true },
      });
      await prisma.user.update({ where: { id: identity.userId }, data: { status } });
      issueToken.mockClear();

      const response = await exchange('valid.raw.token', `inactive-${status.toLowerCase()}`).expect(
        403,
      );
      expect(response.body as unknown as ProblemDetails).toMatchObject({
        status: 403,
        code: 'account_inactive',
      });
      expect(issueToken).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['rejected-token', 401, 'invalid_token'],
    ['timeout-token', 503, 'line_provider_timeout'],
  ])('maps %s to stable Problem Details', async (token, status, code) => {
    const response = await exchange(token, `error-${code}`).expect(status);
    expect(response.body as unknown as ProblemDetails).toMatchObject({ status, code });
  });

  it('returns 429 with Retry-After before calling LINE again for a repeated token', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await exchange('rejected-token', `limited-${attempt}`).expect(401);
    }

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = await exchange('rejected-token', 'limited-final').expect(429);
    const authLog = writeSpy.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.includes('"operation":"auth.line.exchange"'));
    writeSpy.mockRestore();
    expect(response.headers['retry-after']).toMatch(/^\d+$/);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      status: 429,
      code: 'line_exchange_rate_limited',
    });
    expect(lineVerifier.verify).toHaveBeenCalledTimes(5);
    expect(authLog).toContain('"durationMs"');
    expect(authLog).not.toContain('providerLatencyMs');
    expect(authLog).not.toContain('rejected-token');
  });

  function exchange(token: string, requestId: string) {
    return request(httpServer)
      .post('/v1/auth/line/exchange')
      .set('x-request-id', requestId)
      .send({ idToken: token, nonce: 'synthetic-nonce-1234' });
  }
});
