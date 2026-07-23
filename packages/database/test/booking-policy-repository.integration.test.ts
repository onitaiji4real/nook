import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingPolicyRepositoryError, PrismaBookingPolicyRepository } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaBookingPolicyRepository(prisma);

describe('booking policy repository', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('reads for active members and uses revision CAS for owner updates', async () => {
    const fixture = await createFixture();
    await expect(
      repository.getForMember({ tenantId: fixture.tenantId, actorUserId: fixture.viewerUserId }),
    ).resolves.toMatchObject({ role: 'VIEWER', policy: { revision: 1 } });

    const updated = await repository.update({
      tenantId: fixture.tenantId,
      actorUserId: fixture.ownerUserId,
      requestId: randomUUID(),
      expectedRevision: 1,
      slotIntervalMinutes: 30,
      minimumLeadMinutes: 60,
      maximumAdvanceDays: 120,
      consumerCancelLeadMinutes: 2_880,
      consumerRescheduleLeadMinutes: 720,
    });
    expect(updated).toMatchObject({
      revision: 2,
      slotIntervalMinutes: 30,
      consumerCancelLeadMinutes: 2_880,
      consumerRescheduleLeadMinutes: 720,
    });
    await expect(
      repository.update({
        tenantId: fixture.tenantId,
        actorUserId: fixture.ownerUserId,
        requestId: randomUUID(),
        expectedRevision: 1,
        slotIntervalMinutes: 15,
        minimumLeadMinutes: 120,
        maximumAdvanceDays: 60,
        consumerCancelLeadMinutes: 1_440,
        consumerRescheduleLeadMinutes: 1_440,
      }),
    ).rejects.toEqual(new BookingPolicyRepositoryError('booking_policy_revision_conflict'));
    await expect(
      prisma.auditLog.count({
        where: { tenantId: fixture.tenantId, action: 'booking_policy.update' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects viewer writes without modifying the policy', async () => {
    const fixture = await createFixture();
    await expect(
      repository.update({
        tenantId: fixture.tenantId,
        actorUserId: fixture.viewerUserId,
        requestId: randomUUID(),
        expectedRevision: 1,
        slotIntervalMinutes: 30,
        minimumLeadMinutes: 0,
        maximumAdvanceDays: 30,
        consumerCancelLeadMinutes: 0,
        consumerRescheduleLeadMinutes: 0,
      }),
    ).rejects.toEqual(new BookingPolicyRepositoryError('forbidden'));
    await expect(
      prisma.bookingPolicy.findUniqueOrThrow({ where: { tenantId: fixture.tenantId } }),
    ).resolves.toMatchObject({ revision: 1, consumerCancelLeadMinutes: 1_440 });
  });
});

async function createFixture() {
  const [owner, viewer] = await Promise.all([
    prisma.user.create({ data: { displayName: 'Policy repository owner' } }),
    prisma.user.create({ data: { displayName: 'Policy repository viewer' } }),
  ]);
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Policy repository fixture',
      slug: `policy-repository-${randomUUID()}`,
      bookingPolicy: { create: {} },
      memberships: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: viewer.id, role: 'VIEWER' },
        ],
      },
    },
  });
  return { tenantId: tenant.id, ownerUserId: owner.id, viewerUserId: viewer.id };
}

async function clearFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: 'policy-repository-' } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({ where: { displayName: { startsWith: 'Policy repository ' } } });
}
