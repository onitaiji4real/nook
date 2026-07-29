import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { RuntimeConfig } from '@nook/config';
import type { CustomerListResponse, CustomerTagDefinition, ProblemDetails } from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { RUNTIME_CONFIG } from '../../../src/platform/config/runtime-config.token';
import { requestContextMiddleware } from '../../../src/platform/http/request-context.middleware';

class TestIdentityVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();

  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    return userId === undefined
      ? Promise.reject(new IdentityTokenVerificationError('invalid_token', 'Rejected.'))
      : Promise.resolve({ userId });
  }
}

const fixturePrefix = 'crm-tags-api-';
const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  databaseUrl: 'postgresql://synthetic:not-used@localhost/synthetic',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'active',
  crmTagsMode: 'active',
  crmNotesMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('merchant customer tags API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let planId: string;
  let tenantId: string;
  let foreignTenantId: string;
  let customerId: string;
  let foreignCustomerId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await clearFixtures();
    const unique = randomUUID();
    const plan = await prisma.plan.create({
      data: {
        code: `${fixturePrefix}${unique}`,
        name: `CRM tags API ${unique}`,
        billingPeriod: 'MONTHLY',
        priceAmount: 0,
        entitlements: {
          create: { entitlementCode: 'CUSTOMER_TAGS', valueJson: true },
        },
      },
    });
    planId = plan.id;
    const actors = await Promise.all(
      ['owner', 'manager', 'viewer', 'outsider'].map((role) =>
        prisma.user.create({ data: { displayName: `${fixturePrefix}${role}-${unique}` } }),
      ),
    );
    const [consumer, foreignConsumer] = await Promise.all([
      prisma.user.create({ data: { displayName: `${fixturePrefix}consumer-${unique}` } }),
      prisma.user.create({ data: { displayName: `${fixturePrefix}foreign-consumer-${unique}` } }),
    ]);
    const [tenant, foreignTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: '標籤測試店', slug: `${fixturePrefix}tenant-${unique}`, planId },
      }),
      prisma.tenant.create({
        data: { name: '標籤外店', slug: `${fixturePrefix}foreign-${unique}`, planId },
      }),
    ]);
    await Promise.all([
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[0]!.id, role: 'OWNER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[1]!.id, role: 'MANAGER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[2]!.id, role: 'VIEWER' },
      }),
    ]);
    const [customer, foreignCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          tenantId: tenant.id,
          consumerUserId: consumer.id,
          relationshipStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      }),
      prisma.customer.create({
        data: {
          tenantId: foreignTenant.id,
          consumerUserId: foreignConsumer.id,
          relationshipStartedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      }),
    ]);
    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    customerId = customer.id;
    foreignCustomerId = foreignCustomer.id;
    verifier.identities.clear();
    ['owner', 'manager', 'viewer', 'outsider'].forEach((role, index) => {
      verifier.identities.set(`${role}-token`, actors[index]!.id);
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
    await disconnectPrismaClient();
  });

  it('requires authentication, preserves no-store, and separates manager administration rights', async () => {
    const unauthenticated = await request(server)
      .get(`/v1/tenants/${tenantId}/customer-tags`)
      .expect(401);
    expect(unauthenticated.headers['cache-control']).toBe('private, no-store');

    const viewer = await request(server)
      .get(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer viewer-token')
      .expect(403);
    expect(viewer.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });

    await request(server)
      .get(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer manager-token')
      .expect(200);
    await request(server)
      .post(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer manager-token')
      .send({ name: 'VIP' })
      .expect(403);
  });

  it('normalizes definitions, rejects sensitive taxonomy, and exposes entitled links in reads', async () => {
    const created = await request(server)
      .post(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'crm-tags-create')
      .send({ name: '  ＶＩＰ 客戶  ' })
      .expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const tag = created.body as unknown as CustomerTagDefinition;
    expect(tag).toMatchObject({ name: 'VIP 客戶', status: 'ACTIVE' });

    await request(server)
      .post(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .send({ name: 'vip 客戶' })
      .expect(409);
    await request(server)
      .post(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .send({ name: '醫療需求' })
      .expect(400);

    await request(server)
      .put(`/v1/tenants/${tenantId}/customers/${customerId}/tags/${tag.id}`)
      .set('authorization', 'Bearer manager-token')
      .expect(204);
    await request(server)
      .put(`/v1/tenants/${tenantId}/customers/${customerId}/tags/${tag.id}`)
      .set('authorization', 'Bearer manager-token')
      .expect(204);
    const customers = await request(server)
      .get(`/v1/tenants/${tenantId}/customers`)
      .set('authorization', 'Bearer owner-token')
      .expect(200);
    expect((customers.body as unknown as CustomerListResponse).items[0]?.tags).toEqual([
      { id: tag.id, name: 'VIP 客戶' },
    ]);
  });

  it('blocks inactive attachment and does not disclose cross-tenant resources', async () => {
    const created = await request(server)
      .post(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .send({ name: '回訪' })
      .expect(201);
    const tag = created.body as unknown as CustomerTagDefinition;
    await request(server)
      .put(`/v1/tenants/${tenantId}/customer-tags/${tag.id}/status`)
      .set('authorization', 'Bearer owner-token')
      .send({ status: 'INACTIVE' })
      .expect(200);
    await request(server)
      .put(`/v1/tenants/${tenantId}/customers/${customerId}/tags/${tag.id}`)
      .set('authorization', 'Bearer manager-token')
      .expect(409);
    await request(server)
      .put(`/v1/tenants/${tenantId}/customers/${foreignCustomerId}/tags/${tag.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(404);
    await request(server)
      .get(`/v1/tenants/${foreignTenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .expect(404);
  });

  it('denies a tenant whose plan entitlement is false', async () => {
    await prisma.planEntitlement.update({
      where: {
        planId_entitlementCode: {
          planId,
          entitlementCode: 'CUSTOMER_TAGS',
        },
      },
      data: { valueJson: false },
    });
    const response = await request(server)
      .get(`/v1/tenants/${tenantId}/customer-tags`)
      .set('authorization', 'Bearer owner-token')
      .expect(403);
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'customer_tags_not_in_plan',
    });
  });
});

async function clearFixtures(): Promise<void> {
  const prisma = getPrismaClient();
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const users = await prisma.user.findMany({
    where: { displayName: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  if (tenantIds.length > 0) {
    await prisma.customerTagLink.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customerTagDefinition.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await prisma.plan.deleteMany({ where: { code: { startsWith: fixturePrefix } } });
}
