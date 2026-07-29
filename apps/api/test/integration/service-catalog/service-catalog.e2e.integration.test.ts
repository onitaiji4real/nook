import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type {
  CreateServiceRequest,
  MerchantOnboardingRequest,
  ProblemDetails,
  ServiceCatalogResponse,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { requestContextMiddleware } from '../../../src/platform/http/request-context.middleware';

class CatalogIdentityTokenVerifier implements IdentityTokenVerifier {
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

describe('service catalog', () => {
  const prisma = getPrismaClient();
  const verifier = new CatalogIdentityTokenVerifier();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let ownerId: string;
  let memberId: string;

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
    const [owner, member] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Catalog Owner' } }),
      prisma.user.create({ data: { displayName: 'Catalog Member' } }),
    ]);
    ownerId = owner.id;
    memberId = member.id;
    verifier.identities.clear();
    verifier.identities.set('owner-token', ownerId);
    verifier.identities.set('member-token', memberId);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('lets a MANAGER create and list services with generic entitlement usage', async () => {
    const tenantId = await setupCatalog();
    await prisma.membership.create({
      data: { tenantId, userId: memberId, role: 'MANAGER', status: 'ACTIVE' },
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const response = await createService(
      'member-token',
      tenantId,
      serviceBody('20000000-0000-4000-8000-000000000021', '日式自然款'),
      201,
    );
    const logs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();
    expect(response.body as unknown as ServiceCatalogResponse).toMatchObject({
      tenantId,
      entitlement: { code: 'MAX_SERVICES', limit: 5, used: 2, remaining: 3 },
      services: [
        { name: '單色凝膠', sortOrder: 0, status: 'ACTIVE' },
        { name: '日式自然款', sortOrder: 1, status: 'ACTIVE' },
      ],
    });
    expect(logs).not.toContain('日式自然款');
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'service.created' } }),
    ).resolves.toBe(1);

    await request(httpServer)
      .get(`/v1/tenants/${tenantId}/services`)
      .set('authorization', 'Bearer member-token')
      .expect(200);
  });

  it('lets STAFF read but denies catalog changes with an authorization audit', async () => {
    const tenantId = await setupCatalog();
    await prisma.membership.create({
      data: { tenantId, userId: memberId, role: 'STAFF', status: 'ACTIVE' },
    });
    await request(httpServer)
      .get(`/v1/tenants/${tenantId}/services`)
      .set('authorization', 'Bearer member-token')
      .expect(200);
    const denied = await createService(
      'member-token',
      tenantId,
      serviceBody('20000000-0000-4000-8000-000000000022', '不可新增'),
      403,
    );
    expect(denied.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'authorization.denied' } }),
    ).resolves.toBe(1);
  });

  it('enforces MAX_SERVICES without branching on a plan name', async () => {
    const tenantId = await setupCatalog();
    for (let index = 1; index <= 4; index += 1) {
      await createService(
        'owner-token',
        tenantId,
        serviceBody(`20000000-0000-4000-8000-00000000003${index}`, `服務 ${index}`),
        201,
      );
    }
    const response = await createService(
      'owner-token',
      tenantId,
      serviceBody('20000000-0000-4000-8000-000000000039', '第六項'),
      403,
    );
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'service_limit_reached',
    });
    await expect(prisma.service.count({ where: { tenantId, status: 'ACTIVE' } })).resolves.toBe(5);
  });

  it('moves the starter pointer when deactivating and protects the final active service', async () => {
    const tenantId = await setupCatalog();
    const replacementId = '20000000-0000-4000-8000-000000000041';
    await createService('owner-token', tenantId, serviceBody(replacementId, '接替服務'), 201);

    await changeStatus(tenantId, '20000000-0000-4000-8000-000000000010', 'INACTIVE', 200);
    await expect(
      prisma.merchantProfile.findUniqueOrThrow({ where: { tenantId } }),
    ).resolves.toMatchObject({ starterServiceId: replacementId });
    await expect(
      prisma.service.findUniqueOrThrow({
        where: { id: '20000000-0000-4000-8000-000000000010' },
      }),
    ).resolves.toMatchObject({ status: 'INACTIVE', bookingEnabled: false });

    const denied = await changeStatus(tenantId, replacementId, 'INACTIVE', 409);
    expect(denied.body as unknown as ProblemDetails).toMatchObject({ code: 'last_active_service' });
    await expect(
      prisma.service.findUniqueOrThrow({ where: { id: replacementId } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('updates price fields atomically and rejects an empty patch', async () => {
    const tenantId = await setupCatalog();
    const serviceId = '20000000-0000-4000-8000-000000000010';
    const updated = await request(httpServer)
      .patch(`/v1/tenants/${tenantId}/services/${serviceId}`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'service-update-test')
      .send({ name: '進階單色', price: { type: 'RANGE', min: 1500, max: 2200 } })
      .expect(200);
    expect(updated.body as unknown as ServiceCatalogResponse).toMatchObject({
      services: [{ name: '進階單色', price: { type: 'RANGE', min: 1500, max: 2200 } }],
    });
    await request(httpServer)
      .patch(`/v1/tenants/${tenantId}/services/${serviceId}`)
      .set('authorization', 'Bearer owner-token')
      .send({})
      .expect(400);
  });

  it('reorders only when the request contains the complete tenant catalog', async () => {
    const tenantId = await setupCatalog();
    const secondId = '20000000-0000-4000-8000-000000000051';
    const thirdId = '20000000-0000-4000-8000-000000000052';
    await createService('owner-token', tenantId, serviceBody(secondId, '第二項'), 201);
    await createService('owner-token', tenantId, serviceBody(thirdId, '第三項'), 201);
    const originalId = '20000000-0000-4000-8000-000000000010';

    const reordered = await request(httpServer)
      .put(`/v1/tenants/${tenantId}/services/order`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'service-order-test')
      .send({ serviceIds: [thirdId, originalId, secondId] })
      .expect(200);
    expect(
      (reordered.body as unknown as ServiceCatalogResponse).services.map(({ id }) => id),
    ).toEqual([thirdId, originalId, secondId]);

    const denied = await request(httpServer)
      .put(`/v1/tenants/${tenantId}/services/order`)
      .set('authorization', 'Bearer owner-token')
      .send({ serviceIds: [originalId, secondId] })
      .expect(409);
    expect(denied.body as unknown as ProblemDetails).toMatchObject({
      code: 'service_order_mismatch',
    });
    await expect(
      prisma.service.findMany({
        where: { tenantId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      }),
    ).resolves.toEqual([{ id: thirdId }, { id: originalId }, { id: secondId }]);
  });

  it('does not reveal or modify a service owned by another tenant', async () => {
    const tenantA = await setupCatalog('catalog-a');
    const tenantB = await setupCatalog('catalog-b', 'member-token');
    const foreignId = '20000000-0000-4000-8000-000000000011';

    const response = await request(httpServer)
      .patch(`/v1/tenants/${tenantA}/services/${foreignId}`)
      .set('authorization', 'Bearer owner-token')
      .send({ name: '不應寫入' })
      .expect(404);
    expect(response.body as unknown as ProblemDetails).toMatchObject({ code: 'service_not_found' });
    await expect(
      prisma.service.findFirstOrThrow({ where: { tenantId: tenantB, id: foreignId } }),
    ).resolves.toMatchObject({ name: '單色凝膠' });
  });

  async function setupCatalog(slug = 'catalog-studio', token = 'owner-token'): Promise<string> {
    const tenant = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', `Bearer ${token}`)
      .send({ name: slug, slug })
      .expect(201);
    const tenantId = (tenant.body as unknown as { id: string }).id;
    await request(httpServer)
      .put(`/v1/tenants/${tenantId}/merchant-onboarding`)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', 'catalog-onboarding')
      .send(onboardingBody(slug === 'catalog-b' ? '1' : '0'))
      .expect(200);
    return tenantId;
  }

  function createService(
    token: string,
    tenantId: string,
    body: CreateServiceRequest,
    status: number,
  ) {
    return request(httpServer)
      .post(`/v1/tenants/${tenantId}/services`)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', 'service-create-test')
      .send(body)
      .expect(status);
  }

  function changeStatus(tenantId: string, serviceId: string, status: string, code: number) {
    return request(httpServer)
      .put(`/v1/tenants/${tenantId}/services/${serviceId}/status`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'service-status-test')
      .send({ status })
      .expect(code);
  }
});

function serviceBody(id: string, name: string): CreateServiceRequest {
  return {
    id,
    name,
    durationMinutes: 120,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    price: { type: 'FIXED', amount: 1600 },
    bookingEnabled: true,
  };
}

function onboardingBody(resourceSuffix = '0'): MerchantOnboardingRequest {
  return {
    profile: { category: 'NAIL' },
    location: {
      id: `10000000-0000-4000-8000-00000000001${resourceSuffix}`,
      name: '主要工作室',
      addressText: '台北市中山區測試路 10 號',
      city: '台北市',
      district: '中山區',
      isPublicAddress: false,
    },
    service: {
      id: `20000000-0000-4000-8000-00000000001${resourceSuffix}`,
      name: '單色凝膠',
      durationMinutes: 90,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
      price: { type: 'FIXED', amount: 1200 },
      bookingEnabled: true,
    },
  };
}
