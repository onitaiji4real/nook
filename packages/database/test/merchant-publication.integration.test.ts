import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MerchantPublicationRepositoryError, PrismaMerchantPublicationRepository } from '../src';

const prisma = new PrismaClient();

describe('merchant publication repository', () => {
  const repository = new PrismaMerchantPublicationRepository(prisma);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('blocks incomplete publication then publishes a complete tenant atomically', async () => {
    const incomplete = await fixture('publication-incomplete', false);
    await expect(
      repository.changeVisibility({
        tenantId: incomplete.tenantId,
        actorUserId: incomplete.userId,
        requestId: 'publish-incomplete',
        visibilityStatus: 'PUBLISHED',
      }),
    ).rejects.toEqual(new MerchantPublicationRepositoryError('publication_not_ready'));

    const complete = await fixture('publication-complete', true);
    const result = await repository.changeVisibility({
      tenantId: complete.tenantId,
      actorUserId: complete.userId,
      requestId: 'publish-complete',
      visibilityStatus: 'PUBLISHED',
    });
    expect(result.visibilityStatus).toBe('PUBLISHED');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(Object.values(result.readiness).every(Boolean)).toBe(true);
    await expect(
      prisma.auditLog.findFirstOrThrow({ where: { tenantId: complete.tenantId } }),
    ).resolves.toMatchObject({
      action: 'merchant.publication_status_changed',
      requestId: 'publish-complete',
    });
  });

  it('requires READY media for portfolio publication and isolates tenant IDs', async () => {
    const owner = await fixture('publication-owner', false);
    const foreign = await fixture('publication-foreign', false);
    await expect(
      repository.changePortfolioStatus({
        tenantId: owner.tenantId,
        actorUserId: owner.userId,
        requestId: 'media-pending',
        portfolioItemId: owner.portfolioItemId,
        status: 'PUBLISHED',
      }),
    ).rejects.toMatchObject({ code: 'portfolio_media_not_ready' });
    await expect(
      repository.changePortfolioStatus({
        tenantId: foreign.tenantId,
        actorUserId: foreign.userId,
        requestId: 'cross-tenant',
        portfolioItemId: owner.portfolioItemId,
        status: 'HIDDEN',
      }),
    ).rejects.toMatchObject({ code: 'portfolio_not_found' });
  });

  it('returns only active published stores and never exposes raw internal identity fields', async () => {
    const complete = await fixture('publication-public', true);
    await repository.changeVisibility({
      tenantId: complete.tenantId,
      actorUserId: complete.userId,
      requestId: 'publish-public',
      visibilityStatus: 'PUBLISHED',
    });
    const publicRecord = await repository.findPublishedBySlug('publication-public');
    expect(publicRecord).toMatchObject({
      slug: 'publication-public',
      location: { isPublicAddress: false, addressText: '仁愛路四段測試門牌' },
      portfolio: [{ bucket: 'private-test-bucket' }],
    });
    expect(publicRecord?.portfolio[0]?.objectKey).toContain('/display.webp');
    expect(publicRecord).not.toHaveProperty('tenantId');
    expect(publicRecord).not.toHaveProperty('phone');
    await prisma.tenant.update({ where: { id: complete.tenantId }, data: { status: 'SUSPENDED' } });
    await expect(repository.findPublishedBySlug('publication-public')).resolves.toBeNull();
  });
});

async function fixture(slug: string, ready: boolean) {
  const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
  const user = await prisma.user.create({ data: { displayName: `${slug} owner` } });
  const tenant = await prisma.tenant.create({
    data: { name: `${slug} studio`, slug, planId: plan.id },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: '私人工作室',
      addressText: '仁愛路四段測試門牌',
      postalCode: '106',
      city: '台北市',
      district: '大安區',
      isPublicAddress: false,
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: '凝膠設計',
      durationMinutes: 90,
      priceType: 'FIXED',
      priceAmount: 1200,
    },
  });
  await prisma.merchantProfile.create({
    data: {
      tenantId: tenant.id,
      category: 'NAIL',
      description: '測試公開介紹',
      bookingPolicy: '請準時抵達',
      cancellationPolicy: '二十四小時前取消',
      phone: '0900000000',
      primaryLocationId: location.id,
      starterServiceId: service.id,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: { tenantId: tenant.id, locationId: location.id, displayName: 'Yun' },
  });
  await prisma.staffService.create({
    data: { tenantId: tenant.id, staffId: staff.id, serviceId: service.id },
  });
  await prisma.weeklyAvailabilityRule.create({
    data: {
      tenantId: tenant.id,
      staffId: staff.id,
      weekday: 2,
      startTime: new Date('1970-01-01T11:00:00.000Z'),
      endTime: new Date('1970-01-01T19:00:00.000Z'),
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const portfolio = await prisma.portfolioItem.create({
    data: {
      tenantId: tenant.id,
      title: '測試作品',
      status: ready ? 'PUBLISHED' : 'DRAFT',
      publishedAt: ready ? new Date() : null,
    },
  });
  await prisma.mediaAsset.create({
    data: {
      tenantId: tenant.id,
      ownerId: portfolio.id,
      bucket: 'private-test-bucket',
      uploadObjectKey: `tenants/${tenant.id}/portfolio/${portfolio.id}/upload`,
      objectKey: ready ? `tenants/${tenant.id}/portfolio/${portfolio.id}/display.webp` : null,
      thumbnailObjectKey: ready
        ? `tenants/${tenant.id}/portfolio/${portfolio.id}/thumb.webp`
        : null,
      declaredMimeType: 'image/jpeg',
      declaredByteSize: 1024,
      mimeType: ready ? 'image/webp' : null,
      byteSize: ready ? 900 : null,
      width: ready ? 1200 : null,
      height: ready ? 1500 : null,
      checksum: ready ? 'a'.repeat(64) : null,
      status: ready ? 'READY' : 'PENDING',
      uploadExpiresAt: new Date('2026-07-23T00:00:00.000Z'),
      createdByUserId: user.id,
    },
  });
  return { tenantId: tenant.id, userId: user.id, portfolioItemId: portfolio.id };
}
