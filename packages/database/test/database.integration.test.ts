import { IdentityProvider, PrismaClient, UserStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PrismaIdentityRepository,
  PrismaMerchantOnboardingRepository,
  PrismaRateLimitRepository,
  PrismaServiceCatalogRepository,
  PrismaStaffSchedulingRepository,
  PrismaTenantRepository,
  ServiceCatalogRepositoryError,
  StaffSchedulingRepositoryError,
} from '../src';

const prisma = new PrismaClient();

describe('database foundation', () => {
  beforeEach(async () => {
    await prisma.authRateLimitBucket.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads the PostGIS extension', async () => {
    const result = await prisma.$queryRaw<
      Array<{ version: string }>
    >`SELECT PostGIS_Version() AS version`;

    expect(result[0]?.version).toMatch(/^3\./);
  });

  it('enforces unique provider identities', async () => {
    const user = await prisma.user.create({
      data: {
        displayName: 'Synthetic Test User',
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: IdentityProvider.LINE,
        providerSubject: 'synthetic-line-subject',
      },
    });

    await expect(
      prisma.userIdentity.create({
        data: {
          userId: user.id,
          provider: IdentityProvider.LINE,
          providerSubject: 'synthetic-line-subject',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces one membership per user and tenant', async () => {
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Owner' } }),
      prisma.tenant.create({ data: { name: 'Synthetic Studio', slug: 'synthetic-studio' } }),
    ]);

    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' },
    });

    await expect(
      prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'STAFF' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('creates the default booking policy in the tenant owner transaction', async () => {
    const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const owner = await prisma.user.create({ data: { displayName: 'Booking Policy Owner' } });
    const repository = new PrismaTenantRepository(prisma);

    const created = await repository.createTenantWithOwner({
      ownerUserId: owner.id,
      name: 'Policy Studio',
      slug: `policy-studio-${plan.id.slice(0, 8)}`,
      requestId: 'booking-policy-tenant-create',
    });

    await expect(
      prisma.bookingPolicy.findUnique({ where: { tenantId: created.tenant.id } }),
    ).resolves.toMatchObject({
      slotIntervalMinutes: 15,
      minimumLeadMinutes: 120,
      maximumAdvanceDays: 60,
    });
  });

  it('recognizes only ACTIVE users as authorized local users', async () => {
    const repository = new PrismaIdentityRepository(prisma);
    const [active, suspended, deleted] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Active User', status: UserStatus.ACTIVE } }),
      prisma.user.create({ data: { displayName: 'Suspended User', status: UserStatus.SUSPENDED } }),
      prisma.user.create({ data: { displayName: 'Deleted User', status: UserStatus.DELETED } }),
    ]);

    await expect(repository.isActiveUser(active.id)).resolves.toBe(true);
    await expect(repository.isActiveUser(suspended.id)).resolves.toBe(false);
    await expect(repository.isActiveUser(deleted.id)).resolves.toBe(false);
    await expect(repository.isActiveUser('00000000-0000-4000-8000-000000000000')).resolves.toBe(
      false,
    );
  });

  it('requires audit request IDs and retains audit evidence when tenant deletion is attempted', async () => {
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Audit Actor' } }),
      prisma.tenant.create({ data: { name: 'Synthetic Audit Tenant', slug: 'synthetic-audit' } }),
    ]);

    const audit = await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'tenant.created',
        resourceType: 'tenant',
        resourceId: tenant.id,
        requestId: 'request-audit-retention-test',
      },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO "audit_logs" (
          "id", "tenant_id", "action", "resource_type", "created_at"
        ) VALUES (
          gen_random_uuid(), ${tenant.id}::uuid, 'invalid.missing_request', 'tenant', NOW()
        )
      `,
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '23502' } });

    await expect(prisma.tenant.delete({ where: { id: tenant.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.auditLog.findUnique({ where: { id: audit.id } })).resolves.toMatchObject({
      requestId: 'request-audit-retention-test',
    });
  });

  it('atomically upserts one merchant onboarding aggregate with stable client resource IDs', async () => {
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Merchant Owner' } }),
      prisma.tenant.create({ data: { name: 'Synthetic Merchant', slug: 'synthetic-merchant' } }),
    ]);
    const repository = new PrismaMerchantOnboardingRepository(prisma);
    const baseInput = {
      tenantId: tenant.id,
      actorUserId: user.id,
      requestId: 'merchant-onboarding-first',
      profile: { category: 'NAIL' as const, phone: '0912-345-678' },
      location: {
        id: '10000000-0000-4000-8000-000000000001',
        name: '主要工作室',
        addressText: '台北市中山區測試路 1 號',
        postalCode: '104',
        city: '台北市',
        district: '中山區',
        isPublicAddress: false,
      },
      service: {
        id: '20000000-0000-4000-8000-000000000001',
        name: '單色凝膠',
        durationMinutes: 90,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 15,
        priceType: 'FIXED' as const,
        priceAmount: 1200,
        priceMin: null,
        priceMax: null,
        bookingEnabled: true,
      },
    };

    const created = await repository.save(baseInput);
    const updated = await repository.save({
      ...baseInput,
      requestId: 'merchant-onboarding-retry',
      service: { ...baseInput.service, name: '進階單色凝膠', priceAmount: 1300 },
    });

    expect(created).toMatchObject({
      tenantId: tenant.id,
      visibilityStatus: 'DRAFT',
      primaryLocation: { id: baseInput.location.id, timezone: 'Asia/Taipei' },
      starterService: { id: baseInput.service.id, priceAmount: 1200, currency: 'TWD' },
    });
    expect(updated.starterService).toMatchObject({ name: '進階單色凝膠', priceAmount: 1300 });
    await expect(prisma.merchantProfile.count({ where: { tenantId: tenant.id } })).resolves.toBe(1);
    await expect(prisma.location.count({ where: { tenantId: tenant.id } })).resolves.toBe(1);
    await expect(prisma.service.count({ where: { tenantId: tenant.id } })).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: { tenantId: tenant.id, action: 'merchant.onboarding.saved' },
      }),
    ).resolves.toBe(2);
  });

  it('rolls back profile and location when the database price invariant rejects a service', async () => {
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Rollback Owner' } }),
      prisma.tenant.create({ data: { name: 'Rollback Merchant', slug: 'rollback-merchant' } }),
    ]);
    const repository = new PrismaMerchantOnboardingRepository(prisma);

    const rejectedSave = repository.save({
      tenantId: tenant.id,
      actorUserId: user.id,
      requestId: 'merchant-onboarding-invalid-price',
      profile: { category: 'LASH' },
      location: {
        id: '10000000-0000-4000-8000-000000000002',
        name: 'Rollback Location',
        addressText: '台北市測試路 2 號',
        city: '台北市',
        district: '信義區',
        isPublicAddress: false,
      },
      service: {
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Invalid Price Service',
        durationMinutes: 60,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        priceType: 'FIXED',
        priceAmount: null,
        priceMin: null,
        priceMax: null,
        bookingEnabled: true,
      },
    });

    await expect(rejectedSave).rejects.toThrow(/services_price_check/);

    await expect(prisma.merchantProfile.count({ where: { tenantId: tenant.id } })).resolves.toBe(0);
    await expect(prisma.location.count({ where: { tenantId: tenant.id } })).resolves.toBe(0);
    await expect(prisma.service.count({ where: { tenantId: tenant.id } })).resolves.toBe(0);
    await expect(
      prisma.auditLog.count({
        where: { tenantId: tenant.id, action: 'merchant.onboarding.saved' },
      }),
    ).resolves.toBe(0);
  });

  it('atomically enforces a shared rate-limit bucket under concurrency', async () => {
    const repository = new PrismaRateLimitRepository(prisma);
    const windowStart = new Date('2026-07-21T14:00:00.000Z');
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.consume({
          scope: 'line_exchange_token',
          keyHash: 'a'.repeat(64),
          windowStart,
          expiresAt: new Date('2026-07-21T14:10:00.000Z'),
          limit: 5,
        }),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.map((decision) => decision.requestCount).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    await expect(prisma.authRateLimitBucket.count()).resolves.toBe(1);
  });

  it('enforces the active service entitlement under concurrent catalog writes', async () => {
    const defaultPlan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Concurrent Catalog Owner' } }),
      prisma.tenant.create({
        data: { name: 'Concurrent Catalog', slug: 'concurrent-catalog', planId: defaultPlan.id },
      }),
    ]);
    await prisma.service.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        id: `20000000-0000-4000-8000-00000000006${index}`,
        tenantId: tenant.id,
        name: `Existing ${index}`,
        durationMinutes: 60,
        priceType: 'FIXED',
        priceAmount: 1000,
        sortOrder: index,
      })),
    });
    const repository = new PrismaServiceCatalogRepository(prisma);
    const create = (id: string) =>
      repository.create({
        tenantId: tenant.id,
        actorUserId: user.id,
        requestId: `concurrent-${id}`,
        id,
        name: 'Concurrent Service',
        durationMinutes: 60,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        priceType: 'FIXED',
        priceAmount: 1000,
        priceMin: null,
        priceMax: null,
        bookingEnabled: true,
      });
    const results = await Promise.allSettled([
      create('20000000-0000-4000-8000-000000000071'),
      create('20000000-0000-4000-8000-000000000072'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      const reason: unknown = rejected.reason;
      expect(reason).toBeInstanceOf(ServiceCatalogRepositoryError);
      if (reason instanceof ServiceCatalogRepositoryError) {
        expect(reason.code).toBe('entitlement_limit_reached');
      }
    }
    await expect(
      prisma.service.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
    ).resolves.toBe(5);
  });

  it('enforces MAX_STAFF under concurrent staff creation', async () => {
    const defaultPlan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Concurrent Staff Owner' } }),
      prisma.tenant.create({
        data: { name: 'Concurrent Staff', slug: 'concurrent-staff', planId: defaultPlan.id },
      }),
    ]);
    const location = await prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: '主要據點',
        addressText: '台北市測試路 1 號',
        city: '台北市',
        district: '中山區',
      },
    });
    const service = await prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: '測試服務',
        durationMinutes: 60,
        priceType: 'FIXED',
        priceAmount: 1000,
      },
    });
    const repository = new PrismaStaffSchedulingRepository(prisma);
    const create = (id: string) =>
      repository.create({
        tenantId: tenant.id,
        actorUserId: user.id,
        requestId: `concurrent-staff-${id}`,
        id,
        locationId: location.id,
        displayName: '測試服務人員',
        bookingEnabled: true,
        serviceIds: [service.id],
      });
    const results = await Promise.allSettled([
      create('30000000-0000-4000-8000-000000000071'),
      create('30000000-0000-4000-8000-000000000072'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      const reason: unknown = rejected.reason;
      expect(reason).toBeInstanceOf(StaffSchedulingRepositoryError);
      if (reason instanceof StaffSchedulingRepositoryError) {
        expect(reason.code).toBe('entitlement_limit_reached');
      }
    }
    await expect(
      prisma.staffProfile.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
    ).resolves.toBe(1);
  });

  it('removes expired fingerprints during the global bucket consume', async () => {
    await prisma.authRateLimitBucket.create({
      data: {
        scope: 'line_exchange_token',
        keyHash: 'b'.repeat(64),
        windowStart: new Date('2026-07-21T13:00:00.000Z'),
        expiresAt: new Date('2026-07-21T13:10:00.000Z'),
      },
    });
    const repository = new PrismaRateLimitRepository(prisma);

    await repository.consume({
      scope: 'line_exchange_global',
      keyHash: 'c'.repeat(64),
      windowStart: new Date('2026-07-21T14:00:00.000Z'),
      expiresAt: new Date('2026-07-21T14:10:00.000Z'),
      limit: 120,
      cleanupExpired: true,
    });

    await expect(
      prisma.authRateLimitBucket.count({ where: { keyHash: 'b'.repeat(64) } }),
    ).resolves.toBe(0);
  });
});
