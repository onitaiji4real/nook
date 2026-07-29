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
import type { CustomerDetail, CustomerListResponse, ProblemDetails } from '@nook/contracts';
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
    if (userId === undefined) {
      return Promise.reject(new IdentityTokenVerificationError('invalid_token', 'Rejected.'));
    }
    return Promise.resolve({ userId });
  }
}

const fixturePrefix = 'crm-read-api-';
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
  crmTagsMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('merchant customer CRM read API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantId: string;
  let foreignTenantId: string;
  let ownerUserId: string;
  let ownerMembershipId: string;
  let customers: readonly {
    readonly id: string;
    readonly relationshipStartedAt: Date;
    readonly displayName: string;
  }[];
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
    const actors = await Promise.all(
      ['owner', 'manager', 'viewer', 'staff', 'outsider'].map((role) =>
        prisma.user.create({ data: { displayName: `${fixturePrefix}${role}-${unique}` } }),
      ),
    );
    const consumers = await Promise.all(
      ['陳小美', '林小姐', '   ', '外店顧客'].map((displayName, index) =>
        prisma.user.create({
          data: {
            displayName: index === 3 ? `${fixturePrefix}${displayName}-${unique}` : displayName,
          },
        }),
      ),
    );
    const [tenant, foreignTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: 'CRM 美甲店', slug: `${fixturePrefix}tenant-${unique}` },
      }),
      prisma.tenant.create({
        data: { name: 'CRM 外店', slug: `${fixturePrefix}foreign-${unique}` },
      }),
    ]);
    const memberships = await Promise.all([
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[0]!.id, role: 'OWNER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[1]!.id, role: 'MANAGER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[2]!.id, role: 'VIEWER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[3]!.id, role: 'STAFF' },
      }),
    ]);
    const relationshipTimes = [
      new Date('2026-07-03T03:00:00.000Z'),
      new Date('2026-07-02T03:00:00.000Z'),
      new Date('2026-07-01T03:00:00.000Z'),
    ];
    const createdCustomers = await Promise.all(
      consumers.slice(0, 3).map((consumer, index) => {
        const relationshipStartedAt = relationshipTimes[index];
        if (relationshipStartedAt === undefined) throw new Error('fixture time is missing');
        return prisma.customer.create({
          data: {
            tenantId: tenant.id,
            consumerUserId: consumer.id,
            relationshipStartedAt,
            firstVisitAt: index === 0 ? relationshipStartedAt : null,
            lastVisitAt: index === 0 ? relationshipStartedAt : null,
            completedVisitCount: index === 0 ? 1 : 0,
            noShowCount: index === 1 ? 1 : 0,
          },
        });
      }),
    );
    const foreignCustomer = await prisma.customer.create({
      data: {
        tenantId: foreignTenant.id,
        consumerUserId: consumers[3]!.id,
        relationshipStartedAt: new Date('2026-07-04T03:00:00.000Z'),
      },
    });
    await prisma.consentDocument.create({
      data: {
        purpose: 'MARKETING_MESSAGES',
        version: `${fixturePrefix}v1-${unique}`,
        locale: 'zh-TW',
        contentSha256: 'c'.repeat(64),
        contentText: 'Synthetic CRM read document.',
        status: 'ACTIVE',
        documentGeneration: BigInt(Date.now()),
        activeFrom: new Date(),
      },
    });

    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    ownerUserId = actors[0]!.id;
    ownerMembershipId = memberships[0].id;
    customers = createdCustomers.map((customer, index) => ({
      id: customer.id,
      relationshipStartedAt: relationshipTimes[index]!,
      displayName: index === 2 ? '顧客' : consumers[index]!.displayName.trim(),
    }));
    foreignCustomerId = foreignCustomer.id;
    verifier.identities.clear();
    ['owner', 'manager', 'viewer', 'staff', 'outsider'].forEach((role, index) => {
      verifier.identities.set(`${role}-token`, actors[index]!.id);
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
    await disconnectPrismaClient();
  });

  it('requires authentication and denies VIEWER, STAFF, and non-members with no-store', async () => {
    const unauthenticated = await request(server)
      .get(`/v1/tenants/${tenantId}/customers`)
      .expect(401);
    expect(unauthenticated.headers['cache-control']).toBe('private, no-store');

    for (const token of ['viewer-token', 'staff-token', 'outsider-token']) {
      const denied = await request(server)
        .get(`/v1/tenants/${tenantId}/customers`)
        .set('authorization', `Bearer ${token}`)
        .expect(403);
      expect(denied.headers['cache-control']).toBe('private, no-store');
      expect(denied.body as unknown as ProblemDetails).toMatchObject({
        code: 'tenant_access_denied',
      });
    }
  });

  it('allows OWNER and MANAGER and keeps an immutable bounded page', async () => {
    const first = await request(server)
      .get(`/v1/tenants/${tenantId}/customers`)
      .query({ limit: 2 })
      .set('authorization', 'Bearer owner-token')
      .expect(200);
    const firstPage = first.body as unknown as CustomerListResponse;
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(firstPage.items.map(({ id }) => id)).toEqual([customers[0]!.id, customers[1]!.id]);
    expect(firstPage.items[0]).toMatchObject({
      displayName: '陳小美',
      completedVisitCount: 1,
      totalSpent: null,
      spendStatus: 'UNKNOWN',
      marketingState: 'NOT_GRANTED',
      tags: [],
    });
    expect(firstPage.items[0]?.activeMarketingDocumentVersion).toContain(fixturePrefix);
    expect(firstPage.nextCursor).not.toBeNull();

    const lateConsumer = await prisma.user.create({
      data: { displayName: `${fixturePrefix}late-${randomUUID()}` },
    });
    await prisma.customer.create({
      data: {
        tenantId,
        consumerUserId: lateConsumer.id,
        relationshipStartedAt: new Date('2026-07-01T12:00:00.000Z'),
        createdAt: new Date(Date.parse(firstPage.asOf) + 1_000),
      },
    });
    const second = await request(server)
      .get(`/v1/tenants/${tenantId}/customers`)
      .query({ limit: 2, cursor: firstPage.nextCursor })
      .set('authorization', 'Bearer manager-token')
      .expect(200);
    const secondPage = second.body as unknown as CustomerListResponse;
    expect(secondPage.asOf).toBe(firstPage.asOf);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]).toMatchObject({
      id: customers[2]!.id,
      displayName: '顧客',
    });
    expect(secondPage.nextCursor).toBeNull();

    const rawCursor = JSON.parse(
      Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const tampered = Buffer.from(JSON.stringify({ ...rawCursor, extra: tenantId })).toString(
      'base64url',
    );
    await request(server)
      .get(`/v1/tenants/${tenantId}/customers`)
      .query({ cursor: tampered })
      .set('authorization', 'Bearer owner-token')
      .expect(400);
  });

  it('returns an allowlisted detail and audits success and cross-tenant refusal', async () => {
    const response = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${customers[0]!.id}`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'crm-detail-success')
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body as unknown as CustomerDetail).toMatchObject({
      customer: { id: customers[0]!.id, displayName: '陳小美', tags: [] },
      contact: { phone: null, email: null, source: null },
      notes: [],
    });
    await expect(
      prisma.auditLog.count({
        where: {
          tenantId,
          actorUserId: ownerUserId,
          resourceId: customers[0]!.id,
          action: 'crm.customer_detail_viewed',
          requestId: 'crm-detail-success',
        },
      }),
    ).resolves.toBe(1);

    const crossTenant = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${foreignCustomerId}`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'crm-detail-cross-tenant')
      .expect(404);
    expect(crossTenant.headers['cache-control']).toBe('private, no-store');
    await expect(
      prisma.auditLog.count({
        where: {
          tenantId,
          resourceId: foreignCustomerId,
          action: 'crm.customer_detail_access_denied',
          requestId: 'crm-detail-cross-tenant',
        },
      }),
    ).resolves.toBe(1);

    await request(server)
      .get(`/v1/tenants/${foreignTenantId}/customers/${customers[0]!.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(403);
  });

  it('fails closed instead of hiding encrypted notes when KMS read is unavailable', async () => {
    await prisma.customerNote.create({
      data: {
        tenantId,
        customerId: customers[0]!.id,
        ciphertext: Buffer.from('ciphertext'),
        nonce: Buffer.alloc(12),
        authTag: Buffer.alloc(16),
        wrappedDek: Buffer.from('wrapped-dek'),
        kekResourceVersion:
          'projects/synthetic/locations/asia-east1/keyRings/test/cryptoKeys/note/cryptoKeyVersions/1',
        createdByMembershipId: ownerMembershipId,
      },
    });
    const response = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${customers[0]!.id}`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'crm-detail-notes-unavailable')
      .expect(503);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body as unknown as ProblemDetails).toMatchObject({
      code: 'customer_notes_unavailable',
    });
    await expect(
      prisma.auditLog.count({
        where: {
          tenantId,
          resourceId: customers[0]!.id,
          action: 'crm.customer_detail_unavailable',
          requestId: 'crm-detail-notes-unavailable',
        },
      }),
    ).resolves.toBe(1);
  });
});

async function clearFixtures(): Promise<void> {
  const prisma = getPrismaClient();
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const userIds =
    tenantIds.length === 0
      ? []
      : [
          ...(
            await prisma.customer.findMany({
              where: { tenantId: { in: tenantIds } },
              select: { consumerUserId: true },
            })
          ).map(({ consumerUserId }) => consumerUserId),
          ...(
            await prisma.membership.findMany({
              where: { tenantId: { in: tenantIds } },
              select: { userId: true },
            })
          ).map(({ userId }) => userId),
        ];
  if (tenantIds.length > 0) {
    await prisma.customerNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customerTagLink.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customerTagDefinition.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.consentDocument.deleteMany({
    where: { version: { startsWith: fixturePrefix } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
