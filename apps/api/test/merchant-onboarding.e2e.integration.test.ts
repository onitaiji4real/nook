import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type {
  MerchantOnboardingRequest,
  MerchantOnboardingResponse,
  ProblemDetails,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/request-context.middleware';

class SyntheticIdentityTokenVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();

  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    if (userId === undefined) {
      return Promise.reject(
        new IdentityTokenVerificationError('invalid_token', 'Synthetic token rejected.'),
      );
    }
    return Promise.resolve({ userId });
  }
}

describe('merchant onboarding', () => {
  const prisma = getPrismaClient();
  const verifier = new SyntheticIdentityTokenVerifier();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
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

    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Merchant A' } }),
      prisma.user.create({ data: { displayName: 'Synthetic Merchant B' } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    verifier.identities.clear();
    verifier.identities.set('token-a', userAId);
    verifier.identities.set('token-b', userBId);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('lets an OWNER save a private starter aggregate and writes a PII-free audit/log', async () => {
    const tenantId = await createTenant('token-a', 'Owner Studio', 'owner-studio');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const response = await saveOnboarding('token-a', tenantId, onboardingBody(), 200);
    const logs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();
    expect(response.body as unknown as MerchantOnboardingResponse).toMatchObject({
      tenantId,
      profile: {
        category: 'NAIL',
        visibilityStatus: 'DRAFT',
        verificationStatus: 'UNVERIFIED',
      },
      primaryLocation: {
        id: '10000000-0000-4000-8000-000000000010',
        timezone: 'Asia/Taipei',
        isPublicAddress: false,
      },
      starterService: {
        id: '20000000-0000-4000-8000-000000000010',
        price: { type: 'FIXED', amount: 1200 },
        currency: 'TWD',
      },
      readiness: { readyForSchedule: true, readyToPublish: false },
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: 'merchant.onboarding.saved' },
    });
    expect(audit).toMatchObject({
      actorUserId: userAId,
      resourceType: 'merchant_profile',
      resourceId: tenantId,
      requestId: 'merchant-onboarding-test',
      beforeJson: null,
      afterJson: null,
    });
    expect(logs).not.toContain('0912-345-678');
    expect(logs).not.toContain('測試路 10 號');
    expect(logs).not.toContain('單色凝膠');
  });

  it('updates the same client-generated resources instead of duplicating them', async () => {
    const tenantId = await createTenant('token-a', 'Retry Studio', 'retry-studio');
    const body = onboardingBody();
    await saveOnboarding('token-a', tenantId, body, 200);
    await saveOnboarding(
      'token-a',
      tenantId,
      {
        ...body,
        service: { ...body.service, name: '更新後單色凝膠', price: { type: 'FROM', amount: 1500 } },
      },
      200,
    );

    await expect(prisma.location.count({ where: { tenantId } })).resolves.toBe(1);
    await expect(prisma.service.count({ where: { tenantId } })).resolves.toBe(1);
    await expect(prisma.service.findFirstOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      name: '更新後單色凝膠',
      priceType: 'FROM',
      priceAmount: 1500,
    });
  });

  it('allows an active member to read but only an OWNER to write onboarding', async () => {
    const tenantId = await createTenant('token-a', 'Role Studio', 'role-studio');
    await saveOnboarding('token-a', tenantId, onboardingBody(), 200);
    await prisma.membership.create({
      data: { tenantId, userId: userBId, role: 'MANAGER', status: 'ACTIVE' },
    });

    await request(httpServer)
      .get(`/v1/tenants/${tenantId}/merchant-onboarding`)
      .set('authorization', 'Bearer token-b')
      .expect(200);
    const denied = await saveOnboarding('token-b', tenantId, onboardingBody(), 403);
    expect(denied.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
      status: 403,
    });
  });

  it('denies a cross-tenant write and does not create merchant data', async () => {
    const tenantId = await createTenant('token-b', 'Tenant B Studio', 'tenant-b-studio');

    const response = await saveOnboarding('token-a', tenantId, onboardingBody(), 403);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });
    await expect(prisma.merchantProfile.count({ where: { tenantId } })).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'authorization.denied' } }),
    ).resolves.toBe(1);
  });

  it('rejects invalid pricing and unapproved LINE URLs before any database write', async () => {
    const tenantId = await createTenant('token-a', 'Invalid Studio', 'invalid-studio');
    const body = onboardingBody();

    const response = await saveOnboarding(
      'token-a',
      tenantId,
      {
        ...body,
        profile: { ...body.profile, lineOaUrl: 'https://example.com/not-line' },
        service: { ...body.service, price: { type: 'RANGE', min: 2000, max: 1000 } },
      },
      400,
    );
    expect(response.body as unknown as ProblemDetails).toMatchObject({ code: 'invalid_request' });
    await expect(prisma.merchantProfile.count({ where: { tenantId } })).resolves.toBe(0);
  });

  it('rolls back the aggregate when a resource UUID belongs to another tenant', async () => {
    const tenantA = await createTenant('token-a', 'Conflict A', 'conflict-a');
    const tenantB = await createTenant('token-b', 'Conflict B', 'conflict-b');
    const body = onboardingBody();
    await saveOnboarding('token-b', tenantB, body, 200);

    const response = await saveOnboarding('token-a', tenantA, body, 409);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'onboarding_resource_conflict',
      status: 409,
    });
    await expect(prisma.merchantProfile.count({ where: { tenantId: tenantA } })).resolves.toBe(0);
    await expect(prisma.location.count({ where: { tenantId: tenantA } })).resolves.toBe(0);
    await expect(prisma.service.count({ where: { tenantId: tenantA } })).resolves.toBe(0);
  });

  it('returns a stable not-found response before onboarding starts', async () => {
    const tenantId = await createTenant('token-a', 'Empty Studio', 'empty-studio');
    const response = await request(httpServer)
      .get(`/v1/tenants/${tenantId}/merchant-onboarding`)
      .set('authorization', 'Bearer token-a')
      .set('x-request-id', 'merchant-onboarding-not-found')
      .expect(404);

    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'merchant_onboarding_not_found',
      requestId: 'merchant-onboarding-not-found',
    });
  });

  async function createTenant(token: string, name: string, slug: string): Promise<string> {
    const response = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', `Bearer ${token}`)
      .send({ name, slug })
      .expect(201);
    return (response.body as unknown as { readonly id: string }).id;
  }

  function saveOnboarding(token: string, tenantId: string, body: object, status: number) {
    return request(httpServer)
      .put(`/v1/tenants/${tenantId}/merchant-onboarding`)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', 'merchant-onboarding-test')
      .send(body)
      .expect(status);
  }
});

function onboardingBody(): MerchantOnboardingRequest {
  return {
    profile: {
      category: 'NAIL',
      description: '預約制凝膠工作室',
      phone: '0912-345-678',
      lineOaUrl: 'https://lin.ee/synthetic',
      instagramUrl: 'https://www.instagram.com/synthetic.studio/',
      bookingPolicy: '請準時抵達。',
      cancellationPolicy: '請於 24 小時前取消。',
    },
    location: {
      id: '10000000-0000-4000-8000-000000000010',
      name: '主要工作室',
      addressText: '台北市中山區測試路 10 號',
      postalCode: '104',
      city: '台北市',
      district: '中山區',
      isPublicAddress: false,
    },
    service: {
      id: '20000000-0000-4000-8000-000000000010',
      name: '單色凝膠',
      description: '含基礎保養。',
      durationMinutes: 90,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 15,
      price: { type: 'FIXED', amount: 1200 },
      bookingEnabled: true,
    },
  };
}
