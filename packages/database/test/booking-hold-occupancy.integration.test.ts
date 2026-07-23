import { PrismaClient, type ServicePriceType } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();
const concurrentClient = new PrismaClient();

describe('booking hold occupancy constraint', () => {
  beforeEach(async () => {
    await prisma.bookingOccupancy.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.bookingHoldRateAttempt.deleteMany();
  });

  afterAll(async () => {
    await prisma.bookingOccupancy.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.bookingHoldRateAttempt.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'hold-constraint-' } } });
    await prisma.user.deleteMany({ where: { displayName: { startsWith: 'Hold constraint ' } } });
    await Promise.all([prisma.$disconnect(), concurrentClient.$disconnect()]);
  });

  it('allows only one overlapping ACTIVE occupancy across independent connections', async () => {
    const fixture = await createFixture('overlap');
    const first = await createHold(fixture, '10000000-0000-4000-8000-000000000001');
    const second = await createHold(fixture, '10000000-0000-4000-8000-000000000002');
    const occupiedStartAt = new Date('2026-08-01T02:50:00.000Z');
    const occupiedEndAt = new Date('2026-08-01T04:10:00.000Z');

    const results = await Promise.allSettled([
      prisma.bookingOccupancy.create({
        data: {
          tenantId: fixture.tenantId,
          staffId: fixture.staffId,
          holdId: first.id,
          occupiedStartAt,
          occupiedEndAt,
        },
      }),
      concurrentClient.bookingOccupancy.create({
        data: {
          tenantId: fixture.tenantId,
          staffId: fixture.staffId,
          holdId: second.id,
          occupiedStartAt: new Date('2026-08-01T03:00:00.000Z'),
          occupiedEndAt: new Date('2026-08-01T04:20:00.000Z'),
        },
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected' });
    const reason = rejected?.status === 'rejected' ? String(rejected.reason) : '';
    expect(reason).toContain('23P01');
    expect(reason).toContain('booking_occupancies_no_overlap');
    await expect(
      prisma.bookingOccupancy.count({
        where: { tenantId: fixture.tenantId, staffId: fixture.staffId, status: 'ACTIVE' },
      }),
    ).resolves.toBe(1);
  });

  it('uses half-open ranges so adjacent occupancies can both be ACTIVE', async () => {
    const fixture = await createFixture('adjacent');
    const first = await createHold(fixture, '10000000-0000-4000-8000-000000000003');
    const second = await createHold(fixture, '10000000-0000-4000-8000-000000000004');

    await Promise.all([
      prisma.bookingOccupancy.create({
        data: {
          tenantId: fixture.tenantId,
          staffId: fixture.staffId,
          holdId: first.id,
          occupiedStartAt: new Date('2026-08-02T02:00:00.000Z'),
          occupiedEndAt: new Date('2026-08-02T03:00:00.000Z'),
        },
      }),
      concurrentClient.bookingOccupancy.create({
        data: {
          tenantId: fixture.tenantId,
          staffId: fixture.staffId,
          holdId: second.id,
          occupiedStartAt: new Date('2026-08-02T03:00:00.000Z'),
          occupiedEndAt: new Date('2026-08-02T04:00:00.000Z'),
        },
      }),
    ]);

    await expect(
      prisma.bookingOccupancy.count({ where: { tenantId: fixture.tenantId, status: 'ACTIVE' } }),
    ).resolves.toBe(2);
  });

  it('does not let terminal occupancy rows block a replacement', async () => {
    const fixture = await createFixture('terminal');
    const expired = await createHold(fixture, '10000000-0000-4000-8000-000000000005');
    const replacement = await createHold(fixture, '10000000-0000-4000-8000-000000000006');
    const range = {
      occupiedStartAt: new Date('2026-08-03T02:00:00.000Z'),
      occupiedEndAt: new Date('2026-08-03T03:00:00.000Z'),
    };

    await prisma.bookingOccupancy.create({
      data: {
        tenantId: fixture.tenantId,
        staffId: fixture.staffId,
        holdId: expired.id,
        status: 'EXPIRED',
        ...range,
      },
    });
    await expect(
      prisma.bookingOccupancy.create({
        data: {
          tenantId: fixture.tenantId,
          staffId: fixture.staffId,
          holdId: replacement.id,
          ...range,
        },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });
});

interface HoldFixture {
  readonly tenantId: string;
  readonly locationId: string;
  readonly serviceId: string;
  readonly staffId: string;
  readonly consumerUserId: string;
}

async function createFixture(suffix: string): Promise<HoldFixture> {
  const consumer = await prisma.user.create({
    data: { displayName: `Hold constraint consumer ${suffix}` },
  });
  const tenant = await prisma.tenant.create({
    data: { name: `Hold constraint ${suffix}`, slug: `hold-constraint-${suffix}` },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: 'Constraint studio',
      addressText: '台北市測試路 1 號',
      city: '台北市',
      district: '中正區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Constraint service',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'Constraint staff',
    },
  });
  return {
    tenantId: tenant.id,
    locationId: location.id,
    serviceId: service.id,
    staffId: staff.id,
    consumerUserId: consumer.id,
  };
}

async function createHold(fixture: HoldFixture, idempotencyKeyHash: string) {
  return prisma.bookingHold.create({
    data: {
      ...fixture,
      startAt: new Date('2026-08-01T03:00:00.000Z'),
      endAt: new Date('2026-08-01T04:00:00.000Z'),
      serviceNameSnapshot: 'Constraint service',
      staffDisplayNameSnapshot: 'Constraint staff',
      durationMinutesSnapshot: 60,
      priceTypeSnapshot: 'FIXED' satisfies ServicePriceType,
      priceAmountSnapshot: 1200,
      currencySnapshot: 'TWD',
      expiresAt: new Date('2026-08-01T02:10:00.000Z'),
      idempotencyKeyHash: idempotencyKeyHash.padEnd(64, 'a'),
      requestFingerprint: idempotencyKeyHash.padEnd(64, 'f'),
    },
  });
}
