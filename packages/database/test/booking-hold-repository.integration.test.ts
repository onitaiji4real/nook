import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingHoldRepositoryError, PrismaBookingHoldRepository } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaBookingHoldRepository(prisma);
const primaryStartAt = futureFridayAtUtcHour(3);
const middleStartAt = futureFridayAtUtcHour(4);
const alternateStartAt = futureFridayAtUtcHour(5);

describe('booking hold repository', () => {
  beforeEach(async () => {
    await clearAppointmentAggregates();
    await prisma.bookingOccupancy.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.bookingHoldRateAttempt.deleteMany();
  });

  afterAll(async () => {
    await clearAppointmentAggregates();
    await prisma.bookingOccupancy.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.bookingHoldRateAttempt.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'hold-repository-' } } });
    await prisma.user.deleteMany({ where: { displayName: { startsWith: 'Hold repository ' } } });
    await prisma.$disconnect();
  });

  it('counts distinct idempotency keys and lets exact retries replay without consuming quota', async () => {
    const consumer = await prisma.user.create({
      data: { displayName: 'Hold repository rate consumer' },
    });
    const firstHash = hash('rate-0');
    await expect(
      repository.consumeCreateAttempt({
        consumerUserId: consumer.id,
        keyHash: firstHash,
        limit: 10,
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({ allowed: true, replay: false });
    await expect(
      repository.consumeCreateAttempt({
        consumerUserId: consumer.id,
        keyHash: firstHash,
        limit: 10,
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({ allowed: true, replay: true });

    for (let index = 1; index < 10; index += 1) {
      const decision = await repository.consumeCreateAttempt({
        consumerUserId: consumer.id,
        keyHash: hash(`rate-${index}`),
        limit: 10,
        windowSeconds: 600,
      });
      expect(decision.allowed).toBe(true);
    }
    await expect(
      repository.consumeCreateAttempt({
        consumerUserId: consumer.id,
        keyHash: hash('rate-10'),
        limit: 10,
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({ allowed: false, replay: false });
  });

  it('creates an exact candidate, replays idempotently, and rejects key reuse', async () => {
    const fixture = await createFixture('idempotency');
    const input = acquireInput(fixture, primaryStartAt, 'same-key');
    const created = await repository.acquire(input);
    const replayed = await repository.acquire(input);

    expect(created).toMatchObject({
      id: replayed.id,
      status: 'ACTIVE',
      appointmentCreated: false,
      service: { name: '凝膠服務', durationMinutes: 60, priceAmount: 1200 },
      staff: { displayName: 'Yun' },
    });
    expect(replayed.expiresAt).toEqual(created.expiresAt);
    await expect(prisma.bookingHold.count({ where: { tenantId: fixture.tenantId } })).resolves.toBe(
      1,
    );
    await expect(
      repository.acquire({
        ...input,
        startAt: middleStartAt,
        requestFingerprint: hash('different'),
      }),
    ).rejects.toEqual(new BookingHoldRepositoryError('idempotency_conflict'));

    await repository.release({ consumerUserId: fixture.consumerUserId, holdId: created.id });
    const terminalReplay = await repository.acquire(input);
    expect(terminalReplay).toMatchObject({ id: created.id, status: 'RELEASED' });
    expect(terminalReplay.expiresAt).toEqual(created.expiresAt);
    await expect(prisma.bookingHold.count({ where: { tenantId: fixture.tenantId } })).resolves.toBe(
      1,
    );
  });

  it('snapshots every catalog price shape and applies staff overrides', async () => {
    const cases = [
      {
        suffix: 'price-fixed',
        service: {
          priceType: 'FIXED' as const,
          priceAmount: 1200,
          priceMin: null,
          priceMax: null,
        },
        expected: {
          priceType: 'FIXED',
          priceAmount: 1200,
          priceMin: null,
          priceMax: null,
          durationMinutes: 60,
        },
      },
      {
        suffix: 'price-from',
        service: {
          priceType: 'FROM' as const,
          priceAmount: 900,
          priceMin: null,
          priceMax: null,
        },
        expected: {
          priceType: 'FROM',
          priceAmount: 900,
          priceMin: null,
          priceMax: null,
          durationMinutes: 60,
        },
      },
      {
        suffix: 'price-range',
        service: {
          priceType: 'RANGE' as const,
          priceAmount: null,
          priceMin: 1000,
          priceMax: 1600,
        },
        expected: {
          priceType: 'RANGE',
          priceAmount: null,
          priceMin: 1000,
          priceMax: 1600,
          durationMinutes: 60,
        },
      },
      {
        suffix: 'price-quote',
        service: {
          priceType: 'QUOTE' as const,
          priceAmount: null,
          priceMin: null,
          priceMax: null,
        },
        expected: {
          priceType: 'QUOTE',
          priceAmount: null,
          priceMin: null,
          priceMax: null,
          durationMinutes: 60,
        },
      },
      {
        suffix: 'price-staff-override',
        service: {
          priceType: 'RANGE' as const,
          priceAmount: null,
          priceMin: 1000,
          priceMax: 1600,
        },
        staffOverride: { customDurationMinutes: 75, customPriceAmount: 1350 },
        expected: {
          priceType: 'FIXED',
          priceAmount: 1350,
          priceMin: null,
          priceMax: null,
          durationMinutes: 75,
        },
      },
    ];

    for (const item of cases) {
      const fixture = await createFixture(item.suffix);
      await prisma.service.update({ where: { id: fixture.serviceId }, data: item.service });
      if (item.staffOverride !== undefined) {
        await prisma.staffService.update({
          where: {
            tenantId_staffId_serviceId: {
              tenantId: fixture.tenantId,
              staffId: fixture.staffId,
              serviceId: fixture.serviceId,
            },
          },
          data: item.staffOverride,
        });
      }

      const created = await repository.acquire(acquireInput(fixture, primaryStartAt, item.suffix));
      expect(created.service).toMatchObject(item.expected);
      await prisma.service.update({
        where: { id: fixture.serviceId },
        data: { name: '修改後名稱' },
      });
      expect(
        await repository.acquire(acquireInput(fixture, primaryStartAt, item.suffix)),
      ).toMatchObject({ service: { name: '凝膠服務', ...item.expected } });
    }
  });

  it('selects any-staff deterministically and never substitutes a requested staff member', async () => {
    const fixture = await createFixture('staff-selection');
    const location = await prisma.location.findFirstOrThrow({
      where: { tenantId: fixture.tenantId },
    });
    const preferred = await prisma.staffProfile.create({
      data: {
        tenantId: fixture.tenantId,
        locationId: location.id,
        displayName: 'Ari',
        sortOrder: -1,
        services: { create: { serviceId: fixture.serviceId } },
      },
    });
    await prisma.weeklyAvailabilityRule.create({
      data: {
        tenantId: fixture.tenantId,
        staffId: preferred.id,
        weekday: 5,
        startTime: new Date('1970-01-01T10:00:00.000Z'),
        endTime: new Date('1970-01-01T18:00:00.000Z'),
        validFrom: fixtureValidFrom(),
      },
    });

    const anyStaff = await repository.acquire(
      acquireInput(fixture, primaryStartAt, 'staff-selection-any'),
    );
    expect(anyStaff.staff).toMatchObject({ id: preferred.id, displayName: 'Ari' });
    await repository.release({ consumerUserId: fixture.consumerUserId, holdId: anyStaff.id });

    const requested = await repository.acquire({
      ...acquireInput(fixture, primaryStartAt, 'staff-selection-requested'),
      staffId: fixture.staffId,
    });
    expect(requested.staff).toMatchObject({ id: fixture.staffId, displayName: 'Yun' });

    await prisma.staffProfile.update({
      where: { id: fixture.staffId },
      data: { bookingEnabled: false },
    });
    await expect(
      repository.acquire({
        ...acquireInput(fixture, alternateStartAt, 'staff-selection-unavailable'),
        staffId: fixture.staffId,
      }),
    ).rejects.toEqual(new BookingHoldRepositoryError('hold_not_found'));
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: requested.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('rolls back replacement when another consumer already owns the new slot', async () => {
    const fixture = await createFixture('rollback');
    const other = await prisma.user.create({
      data: { displayName: 'Hold repository other consumer rollback' },
    });
    const original = await repository.acquire(acquireInput(fixture, primaryStartAt, 'original'));
    await repository.acquire({
      ...acquireInput(fixture, alternateStartAt, 'other'),
      consumerUserId: other.id,
    });

    await expect(
      repository.acquire(acquireInput(fixture, alternateStartAt, 'conflict')),
    ).rejects.toEqual(new BookingHoldRepositoryError('slot_no_longer_available'));
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: original.id } }),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      expiresAt: original.expiresAt,
    });
  });

  it('atomically releases the previous hold after a successful replacement', async () => {
    const fixture = await createFixture('replace');
    const original = await repository.acquire(
      acquireInput(fixture, primaryStartAt, 'replace-original'),
    );
    const replacement = await repository.acquire(
      acquireInput(fixture, alternateStartAt, 'replace-new'),
    );

    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: original.id } }),
    ).resolves.toMatchObject({
      status: 'RELEASED',
    });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: replacement.id } }),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
    });
    await expect(
      prisma.bookingHold.count({
        where: {
          tenantId: fixture.tenantId,
          consumerUserId: fixture.consumerUserId,
          status: 'ACTIVE',
        },
      }),
    ).resolves.toBe(1);
  });

  it('expires a stale candidate in the create transaction before replacing its range', async () => {
    const fixture = await createFixture('lazy-expiry');
    const stale = await repository.acquire(
      acquireInput(fixture, primaryStartAt, 'lazy-expiry-stale'),
    );
    const expiredAt = new Date(Date.now() - 60_000);
    await prisma.bookingHold.update({
      where: { id: stale.id },
      data: { createdAt: new Date(expiredAt.getTime() - 10 * 60_000), expiresAt: expiredAt },
    });

    const replacement = await repository.acquire(
      acquireInput(fixture, primaryStartAt, 'lazy-expiry-replacement'),
    );

    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: stale.id } }),
    ).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({ where: { holdId: stale.id } }),
    ).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    expect(replacement).toMatchObject({ status: 'ACTIVE', startAt: stale.startAt });
  });

  it('serializes concurrent creates for the same consumer and tenant across connections', async () => {
    const fixture = await createFixture('consumer-concurrency');
    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      const results = await Promise.all([
        new PrismaBookingHoldRepository(firstClient).acquire(
          acquireInput(fixture, primaryStartAt, 'concurrent-first'),
        ),
        new PrismaBookingHoldRepository(secondClient).acquire(
          acquireInput(fixture, alternateStartAt, 'concurrent-second'),
        ),
      ]);

      expect(results).toHaveLength(2);
      await expect(
        prisma.bookingHold.count({
          where: {
            tenantId: fixture.tenantId,
            consumerUserId: fixture.consumerUserId,
            status: 'ACTIVE',
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.bookingHold.count({
          where: {
            tenantId: fixture.tenantId,
            consumerUserId: fixture.consumerUserId,
            status: 'RELEASED',
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
  });

  it('maps concurrent cross-consumer overlap to a privacy-safe slot conflict', async () => {
    const fixture = await createFixture('slot-concurrency');
    const other = await prisma.user.create({
      data: { displayName: 'Hold repository other consumer slot concurrency' },
    });
    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      const results = await Promise.allSettled([
        new PrismaBookingHoldRepository(firstClient).acquire(
          acquireInput(fixture, primaryStartAt, 'slot-concurrent-first'),
        ),
        new PrismaBookingHoldRepository(secondClient).acquire({
          ...acquireInput(fixture, primaryStartAt, 'slot-concurrent-second'),
          consumerUserId: other.id,
        }),
      ]);

      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(({ status }) => status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: new BookingHoldRepositoryError('slot_no_longer_available'),
      });
      await expect(
        prisma.bookingHold.count({
          where: { tenantId: fixture.tenantId, status: 'ACTIVE' },
        }),
      ).resolves.toBe(1);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
  });

  it('releases idempotently and expires active holds in retry-safe batches', async () => {
    const fixture = await createFixture('release');
    const active = await repository.acquire(
      acquireInput(fixture, primaryStartAt, 'release-active'),
    );
    await repository.release({ consumerUserId: fixture.consumerUserId, holdId: active.id });
    await repository.release({ consumerUserId: fixture.consumerUserId, holdId: active.id });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: active.id } }),
    ).resolves.toMatchObject({
      status: 'RELEASED',
    });

    const expiryFixture = await createFixture('expiry');
    const expiring = await repository.acquire(
      acquireInput(expiryFixture, primaryStartAt, 'expiry-active'),
    );
    const past = new Date(Date.now() - 60_000);
    await prisma.bookingHold.update({
      where: { id: expiring.id },
      data: { createdAt: new Date(past.getTime() - 10 * 60_000), expiresAt: past },
    });

    await expect(repository.expireBatch(100)).resolves.toBe(1);
    await expect(repository.expireBatch(100)).resolves.toBe(0);
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: expiring.id } }),
    ).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({ where: { holdId: expiring.id } }),
    ).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: active.id } }),
    ).resolves.toMatchObject({
      status: 'RELEASED',
    });
  });
});

interface Fixture {
  readonly slug: string;
  readonly tenantId: string;
  readonly serviceId: string;
  readonly staffId: string;
  readonly consumerUserId: string;
}

async function createFixture(suffix: string): Promise<Fixture> {
  const slug = `hold-repository-${suffix}`;
  const consumer = await prisma.user.create({
    data: { displayName: `Hold repository consumer ${suffix}` },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Hold repository ${suffix}`,
      slug,
      bookingPolicy: {
        create: { slotIntervalMinutes: 15, minimumLeadMinutes: 120, maximumAdvanceDays: 60 },
      },
    },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: '主要工作室',
      addressText: '台北市測試路 1 號',
      city: '台北市',
      district: '大安區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: '凝膠服務',
      durationMinutes: 60,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      priceType: 'FIXED',
      priceAmount: 1200,
    },
  });
  await prisma.merchantProfile.create({
    data: {
      tenantId: tenant.id,
      category: 'NAIL',
      description: '測試公開店家',
      bookingPolicy: '完全預約制',
      cancellationPolicy: '提前24小時',
      visibilityStatus: 'PUBLISHED',
      publishedAt: new Date(),
      primaryLocationId: location.id,
      starterServiceId: service.id,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'Yun',
      services: { create: { serviceId: service.id } },
    },
  });
  await prisma.weeklyAvailabilityRule.create({
    data: {
      tenantId: tenant.id,
      staffId: staff.id,
      weekday: 5,
      startTime: new Date('1970-01-01T10:00:00.000Z'),
      endTime: new Date('1970-01-01T18:00:00.000Z'),
      validFrom: fixtureValidFrom(),
    },
  });
  return {
    slug,
    tenantId: tenant.id,
    serviceId: service.id,
    staffId: staff.id,
    consumerUserId: consumer.id,
  };
}

function acquireInput(fixture: Fixture, startAt: Date, key: string) {
  return {
    consumerUserId: fixture.consumerUserId,
    slug: fixture.slug,
    serviceId: fixture.serviceId,
    startAt,
    idempotencyKeyHash: hash(key),
    requestFingerprint: hash(`${key}:${startAt.toISOString()}`),
  };
}

function futureFridayAtUtcHour(hour: number): Date {
  const candidate = new Date();
  candidate.setUTCDate(candidate.getUTCDate() + 7);
  candidate.setUTCHours(hour, 0, 0, 0);
  while (candidate.getUTCDay() !== 5) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

function fixtureValidFrom(): Date {
  return new Date(primaryStartAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function clearAppointmentAggregates(): Promise<void> {
  await prisma.appointmentConfirmationKey.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.appointmentStatusHistory.deleteMany();
  await prisma.auditLog.deleteMany({ where: { resourceType: 'appointment' } });
  await prisma.bookingOccupancy.deleteMany({ where: { appointmentId: { not: null } } });
  await prisma.appointmentItem.deleteMany();
  await prisma.appointment.deleteMany();
}
