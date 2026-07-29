import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaCustomerTagRepository, readCustomerTagsEntitlement } from '../src';

const prisma = new PrismaClient();

describe('customer tag repository', () => {
  const suffix = randomUUID().slice(0, 8);
  const repository = new PrismaCustomerTagRepository(prisma);
  let planId: string;
  let tenantId: string;
  let otherTenantId: string;
  let ownerUserId: string;
  let consumerUserId: string;
  let otherConsumerUserId: string;
  let ownerMembershipId: string;
  let customerId: string;
  let otherCustomerId: string;
  let tagId: string;

  beforeAll(async () => {
    const plan = await prisma.plan.create({
      data: {
        code: `CRM_TAGS_${suffix}`,
        name: `CRM tags ${suffix}`,
        billingPeriod: 'MONTHLY',
        priceAmount: 0,
        entitlements: {
          create: {
            entitlementCode: 'CUSTOMER_TAGS',
            valueJson: true,
          },
        },
      },
    });
    planId = plan.id;
    const [owner, consumer, otherConsumer] = await Promise.all([
      prisma.user.create({ data: { displayName: `Tags owner ${suffix}` } }),
      prisma.user.create({ data: { displayName: `Tags consumer ${suffix}` } }),
      prisma.user.create({ data: { displayName: `Tags other ${suffix}` } }),
    ]);
    ownerUserId = owner.id;
    consumerUserId = consumer.id;
    otherConsumerUserId = otherConsumer.id;
    const [tenant, otherTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: `Tags tenant ${suffix}`, slug: `tags-${suffix}`, planId },
      }),
      prisma.tenant.create({
        data: { name: `Tags other ${suffix}`, slug: `tags-other-${suffix}`, planId },
      }),
    ]);
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    const [membership, customer, otherCustomer] = await Promise.all([
      prisma.membership.create({
        data: { tenantId, userId: ownerUserId, role: 'OWNER' },
      }),
      prisma.customer.create({
        data: {
          tenantId,
          consumerUserId,
          relationshipStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      }),
      prisma.customer.create({
        data: {
          tenantId: otherTenantId,
          consumerUserId: otherConsumerUserId,
          relationshipStartedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      }),
    ]);
    ownerMembershipId = membership.id;
    customerId = customer.id;
    otherCustomerId = otherCustomer.id;
  });

  afterAll(async () => {
    await prisma.customerTagLink.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.auditLog.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.customerTagDefinition.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.customer.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.membership.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUserId, consumerUserId, otherConsumerUserId] } },
    });
    await prisma.plan.delete({ where: { id: planId } });
    await prisma.$disconnect();
  });

  it('requires the generic boolean entitlement and persists only safe tag audit identifiers', async () => {
    await expect(readCustomerTagsEntitlement(prisma, tenantId)).resolves.toBe('enabled');
    tagId = randomUUID();
    await expect(
      repository.createDefinition({
        tenantId,
        actorUserId: ownerUserId,
        requestId: `tags-create-${suffix}`,
        id: tagId,
        normalizedName: 'vip 客戶',
        displayName: 'VIP 客戶',
      }),
    ).resolves.toMatchObject({ id: tagId, displayName: 'VIP 客戶', status: 'ACTIVE' });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: 'crm.customer_tag_definition_created' },
    });
    expect(audit).toMatchObject({
      actorUserId: ownerUserId,
      resourceType: 'customer_tag',
      resourceId: tagId,
    });
    expect(JSON.stringify(audit)).not.toContain('VIP 客戶');
  });

  it('rejects normalized duplicates and cross-tenant customer links', async () => {
    await expect(
      repository.createDefinition({
        tenantId,
        actorUserId: ownerUserId,
        requestId: `tags-duplicate-${suffix}`,
        id: randomUUID(),
        normalizedName: 'vip 客戶',
        displayName: 'vip 客戶',
      }),
    ).rejects.toMatchObject({ code: 'tag_conflict' });

    await expect(
      repository.attach({
        tenantId,
        actorUserId: ownerUserId,
        requestId: `tags-cross-tenant-${suffix}`,
        customerId: otherCustomerId,
        tagId,
      }),
    ).rejects.toMatchObject({ code: 'customer_not_found' });
  });

  it('makes link mutation idempotent and blocks inactive definitions', async () => {
    const context = {
      tenantId,
      actorUserId: ownerUserId,
      customerId,
      tagId,
    };
    await expect(
      repository.attach({ ...context, requestId: `tags-attach-1-${suffix}` }),
    ).resolves.toBe(true);
    await expect(
      repository.attach({ ...context, requestId: `tags-attach-2-${suffix}` }),
    ).resolves.toBe(false);
    await repository.changeDefinitionStatus({
      tenantId,
      actorUserId: ownerUserId,
      requestId: `tags-inactive-${suffix}`,
      tagId,
      status: 'INACTIVE',
    });
    await repository.detach({ ...context, requestId: `tags-detach-1-${suffix}` });
    await expect(
      repository.detach({ ...context, requestId: `tags-detach-2-${suffix}` }),
    ).resolves.toBe(false);
    await expect(
      repository.attach({ ...context, requestId: `tags-inactive-attach-${suffix}` }),
    ).rejects.toMatchObject({ code: 'tag_inactive' });
  });

  it('enforces the documented 100-definition and 50-link caps', async () => {
    const existing = await prisma.customerTagDefinition.count({ where: { tenantId } });
    await prisma.customerTagDefinition.createMany({
      data: Array.from({ length: 100 - existing }, (_, index) => ({
        id: randomUUID(),
        tenantId,
        normalizedName: `tag-${suffix}-${index}`,
        displayName: `標籤 ${index}`,
      })),
    });
    await expect(
      repository.createDefinition({
        tenantId,
        actorUserId: ownerUserId,
        requestId: `tags-definition-limit-${suffix}`,
        id: randomUUID(),
        normalizedName: `overflow-${suffix}`,
        displayName: '超過上限',
      }),
    ).rejects.toMatchObject({ code: 'definition_limit_reached' });

    const definitions = await prisma.customerTagDefinition.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      take: 51,
      select: { id: true },
    });
    await prisma.customerTagLink.createMany({
      data: definitions.slice(0, 50).map(({ id }) => ({
        tenantId,
        customerId,
        tagId: id,
        createdByMembershipId: ownerMembershipId,
      })),
    });
    await expect(
      repository.attach({
        tenantId,
        actorUserId: ownerUserId,
        requestId: `tags-link-limit-${suffix}`,
        customerId,
        tagId: definitions[50]!.id,
      }),
    ).rejects.toMatchObject({ code: 'link_limit_reached' });
  });
});
