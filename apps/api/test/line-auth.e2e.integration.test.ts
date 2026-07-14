import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CUSTOM_TOKEN_ISSUER, type CustomTokenIssuer } from '@nook/auth';
import type { LineExchangeResponse, ProblemDetails } from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import { LineVerificationError, type LineIdentityVerifier } from '@nook/line';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { LINE_IDENTITY_VERIFIER } from '../src/identity.tokens';
import { requestContextMiddleware } from '../src/request-context.middleware';

class SyntheticLineVerifier implements LineIdentityVerifier {
  verify(rawToken: string): Promise<{ readonly subject: string; readonly displayName: string }> {
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
  }
}

const issuer: CustomTokenIssuer = {
  issue: (userId) => Promise.resolve({ customToken: `custom.${userId}`, expiresIn: 3_600 }),
};

describe('LINE identity exchange', () => {
  const prisma = getPrismaClient();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LINE_IDENTITY_VERIFIER)
      .useValue(new SyntheticLineVerifier())
      .overrideProvider(CUSTOM_TOKEN_ISSUER)
      .useValue(issuer)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
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

  it.each([
    ['rejected-token', 401, 'invalid_token'],
    ['timeout-token', 503, 'line_provider_timeout'],
  ])('maps %s to stable Problem Details', async (token, status, code) => {
    const response = await exchange(token, `error-${code}`).expect(status);
    expect(response.body as unknown as ProblemDetails).toMatchObject({ status, code });
  });

  function exchange(token: string, requestId: string) {
    return request(httpServer)
      .post('/v1/auth/line/exchange')
      .set('x-request-id', requestId)
      .send({ idToken: token, nonce: 'synthetic-nonce-1234' });
  }
});
