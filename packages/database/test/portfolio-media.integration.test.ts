import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PortfolioMediaRepositoryError, PrismaPortfolioMediaRepository } from '../src';

const prisma = new PrismaClient();
const now = new Date('2026-07-22T06:00:00.000Z');

describe('portfolio media repository', () => {
  const repository = new PrismaPortfolioMediaRepository(prisma);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    const defaultPlan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.planEntitlement.update({
      where: {
        planId_entitlementCode: {
          planId: defaultPlan.id,
          entitlementCode: 'MAX_PORTFOLIO_IMAGES',
        },
      },
      data: { valueJson: 20 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a tenant-scoped DRAFT/PENDING aggregate and preserves safe audit data', async () => {
    const setup = await tenant('portfolio-owner');
    const result = await repository.create(input(setup, '1'), now);
    expect(result).toMatchObject({
      tenantId: setup.tenantId,
      limit: 20,
      used: 1,
      items: [
        {
          title: '測試作品 1',
          status: 'DRAFT',
          tags: ['短甲', '霧面'],
          media: { status: 'PENDING' },
        },
      ],
    });
    await expect(
      prisma.auditLog.findFirstOrThrow({ where: { tenantId: setup.tenantId } }),
    ).resolves.toMatchObject({ action: 'portfolio.created', requestId: 'portfolio-request-1' });
  });

  it('rejects cross-tenant metadata writes without modifying the owner tenant', async () => {
    const owner = await tenant('portfolio-local');
    const foreign = await tenant('portfolio-foreign');
    const created = await repository.create(input(owner, '2'), now);
    const portfolioItemId = created.items[0]?.id;
    if (portfolioItemId === undefined) throw new Error('expected item');

    await expect(
      repository.update(
        {
          tenantId: foreign.tenantId,
          actorUserId: foreign.userId,
          requestId: 'foreign-update',
          portfolioItemId,
          patch: { title: '跨店竄改' },
        },
        now,
      ),
    ).rejects.toMatchObject({
      code: 'portfolio_not_found',
    });
    await expect(
      prisma.portfolioItem.findUniqueOrThrow({ where: { id: portfolioItemId } }),
    ).resolves.toMatchObject({ title: '測試作品 2', tenantId: owner.tenantId });
  });

  it('enforces MAX_PORTFOLIO_IMAGES under concurrent serializable creates', async () => {
    const setup = await tenant('portfolio-quota');
    const defaultPlan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.planEntitlement.update({
      where: {
        planId_entitlementCode: {
          planId: defaultPlan.id,
          entitlementCode: 'MAX_PORTFOLIO_IMAGES',
        },
      },
      data: { valueJson: 1 },
    });
    const results = await Promise.allSettled([
      repository.create(input(setup, '3'), now),
      repository.create(input(setup, '4'), now),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    if (rejected?.status !== 'rejected') throw new Error('expected rejection');
    expect(rejected.reason).toBeInstanceOf(PortfolioMediaRepositoryError);
    expect((rejected.reason as PortfolioMediaRepositoryError).code).toBe(
      'entitlement_limit_reached',
    );
    await expect(prisma.mediaAsset.count({ where: { tenantId: setup.tenantId } })).resolves.toBe(1);
  });

  it('only counts unexpired pending assets and keeps verification terminal', async () => {
    const setup = await tenant('portfolio-expiry');
    const created = await repository.create(
      {
        ...input(setup, '5'),
        uploadExpiresAt: new Date('2026-07-22T05:59:59.000Z'),
      },
      now,
    );
    expect(created.used).toBe(0);
    const mediaAssetId = created.items[0]?.media.id;
    if (mediaAssetId === undefined) throw new Error('expected media asset');
    await repository.markRejected(setup.tenantId, mediaAssetId, 'metadata_mismatch');
    await expect(
      repository.markRejected(setup.tenantId, mediaAssetId, 'retry'),
    ).rejects.toMatchObject({ code: 'media_not_pending' });
  });
});

async function tenant(slug: string): Promise<{ tenantId: string; userId: string }> {
  const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
  const user = await prisma.user.create({ data: { displayName: slug } });
  const created = await prisma.tenant.create({
    data: { name: slug, slug, planId: plan.id },
  });
  return { tenantId: created.id, userId: user.id };
}

function input(setup: { tenantId: string; userId: string }, suffix: string) {
  const serial = suffix.padStart(12, '0');
  return {
    tenantId: setup.tenantId,
    actorUserId: setup.userId,
    requestId: `portfolio-request-${suffix}`,
    portfolioItemId: `10000000-0000-4000-8000-${serial}`,
    mediaAssetId: `20000000-0000-4000-8000-${serial}`,
    title: `測試作品 ${suffix}`,
    tags: ['霧面', '短甲'],
    bucket: 'synthetic-private-bucket',
    uploadObjectKey: `tenants/${setup.tenantId}/portfolio/20000000-0000-4000-8000-${serial}/upload`,
    mimeType: 'image/jpeg' as const,
    byteSize: 1024,
    uploadExpiresAt: new Date('2026-07-22T06:15:00.000Z'),
  };
}
