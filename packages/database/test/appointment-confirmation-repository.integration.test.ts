import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AppointmentConfirmationRepositoryError,
  PrismaAppointmentConfirmationRepository,
  PrismaBookingHoldRepository,
} from '../src';

const prisma = new PrismaClient();
const repository = new PrismaAppointmentConfirmationRepository(prisma);
const primaryStartAt = futureFridayAtUtcHour(3);
const alternateStartAt = futureFridayAtUtcHour(5);

describe('appointment confirmation repository', () => {
  beforeEach(async () => {
    await clearAppointments();
  });

  afterAll(async () => {
    await clearAppointments();
    await prisma.bookingOccupancy.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'appointment-repository-' } } });
    await prisma.user.deleteMany({
      where: { displayName: { startsWith: 'Appointment repository ' } },
    });
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'APPOINTMENT_TEST_' } } });
    await prisma.$disconnect();
  });

  it('creates the complete no-deposit aggregate and atomically transfers occupancy ownership', async () => {
    const fixture = await createFixture('aggregate');
    const input = confirmationInput(fixture, 'aggregate-key');
    const result = await repository.confirm(input);

    expect(result).toMatchObject({
      kind: 'created',
      appointment: {
        status: 'CONFIRMED',
        source: 'MERCHANT_LINK',
        pricingStatus: 'EXACT',
        paymentStatus: 'NOT_REQUIRED',
        subtotalAmount: 1200,
        depositAmount: 0,
        totalAmount: 1200,
        service: { name: '凝膠服務', priceType: 'FIXED', priceAmount: 1200 },
        staff: { displayName: 'Yun' },
        policies: { version: fixture.policyVersion, bookingPolicy: '完全預約制' },
        location: { addressText: '台北市測試路 1 號', district: '大安區' },
      },
    });
    const appointmentId = result.kind === 'expired' ? '' : result.appointment.id;
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({ where: { appointmentId } }),
    ).resolves.toMatchObject({ holdId: null, appointmentId, status: 'ACTIVE' });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: fixture.holdId } }),
    ).resolves.toMatchObject({ status: 'CONSUMED' });
    await expect(prisma.appointmentItem.count({ where: { appointmentId } })).resolves.toBe(1);
    await expect(prisma.appointmentStatusHistory.count({ where: { appointmentId } })).resolves.toBe(
      1,
    );
    await expect(prisma.outboxEvent.count({ where: { aggregateId: appointmentId } })).resolves.toBe(
      1,
    );
    await expect(
      prisma.auditLog.count({ where: { resourceType: 'appointment', resourceId: appointmentId } }),
    ).resolves.toBe(1);
  });

  it('replays the same key and maps a new key for the consumed hold without duplicate effects', async () => {
    const fixture = await createFixture('replay');
    const first = await repository.confirm(confirmationInput(fixture, 'first-key'));
    const sameKey = await repository.confirm(confirmationInput(fixture, 'first-key'));
    const secondKey = await repository.confirm(confirmationInput(fixture, 'second-key'));

    expect(first.kind).toBe('created');
    expect(sameKey).toMatchObject({ kind: 'replayed', appointment: { id: appointmentId(first) } });
    expect(secondKey).toMatchObject({
      kind: 'replayed',
      appointment: { id: appointmentId(first) },
    });
    await expect(prisma.appointment.count({ where: { holdId: fixture.holdId } })).resolves.toBe(1);
    await expect(
      prisma.appointmentConfirmationKey.count({ where: { appointmentId: appointmentId(first) } }),
    ).resolves.toBe(2);
    await expect(
      prisma.appointmentStatusHistory.count({ where: { appointmentId: appointmentId(first) } }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({ where: { aggregateId: appointmentId(first) } }),
    ).resolves.toBe(1);
  });

  it('commits expiry maintenance but rolls back policy mismatches and limit failures', async () => {
    const expired = await createFixture('expired');
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.bookingHold.update({
      where: { id: expired.holdId },
      data: { createdAt: new Date(expiredAt.getTime() - 600_000), expiresAt: expiredAt },
    });
    await expect(repository.confirm(confirmationInput(expired, 'expired-key'))).resolves.toEqual({
      kind: 'expired',
    });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: expired.holdId } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({ where: { holdId: expired.holdId } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });

    const mismatch = await createFixture('mismatch');
    await expect(
      repository.confirm({
        ...confirmationInput(mismatch, 'mismatch-key'),
        policyVersion: `v1:${'0'.repeat(64)}`,
      }),
    ).rejects.toEqual(new AppointmentConfirmationRepositoryError('policy_version_mismatch'));
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: mismatch.holdId } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(prisma.appointment.count({ where: { holdId: mismatch.holdId } })).resolves.toBe(0);

    const limited = await createFixture('limited', 0);
    await prisma.planEntitlement.update({
      where: {
        planId_entitlementCode: {
          planId: limited.planId!,
          entitlementCode: 'MAX_MONTHLY_BOOKINGS',
        },
      },
      data: { valueJson: -1 },
    });
    await expect(repository.confirm(confirmationInput(limited, 'limited-key'))).rejects.toEqual(
      new AppointmentConfirmationRepositoryError('entitlement_unavailable'),
    );
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: limited.holdId } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('serializes different keys from independent connections to one appointment', async () => {
    const fixture = await createFixture('concurrent');
    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      const results = await Promise.all([
        new PrismaAppointmentConfirmationRepository(firstClient).confirm(
          confirmationInput(fixture, 'concurrent-first'),
        ),
        new PrismaAppointmentConfirmationRepository(secondClient).confirm(
          confirmationInput(fixture, 'concurrent-second'),
        ),
      ]);
      expect(new Set(results.map(appointmentId)).size).toBe(1);
      await expect(prisma.appointment.count({ where: { holdId: fixture.holdId } })).resolves.toBe(
        1,
      );
      await expect(
        prisma.appointmentStatusHistory.count({ where: { tenantId: fixture.tenantId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.outboxEvent.count({ where: { tenantId: fixture.tenantId } }),
      ).resolves.toBe(1);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
  });

  it('enforces the effective plan monthly limit without consuming the next hold', async () => {
    const first = await createFixture('monthly-limit', 1);
    const other = await prisma.user.create({
      data: { displayName: 'Appointment repository monthly limit second consumer' },
    });
    const secondHold = await new PrismaBookingHoldRepository(prisma).acquire({
      consumerUserId: other.id,
      slug: first.slug,
      serviceId: first.serviceId,
      startAt: alternateStartAt,
      idempotencyKeyHash: hash('monthly-limit-second-hold'),
      requestFingerprint: hash('monthly-limit-second-request'),
    });
    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      const outcomes = await Promise.allSettled([
        new PrismaAppointmentConfirmationRepository(firstClient).confirm(
          confirmationInput(first, 'monthly-limit-first-confirm'),
        ),
        new PrismaAppointmentConfirmationRepository(secondClient).confirm(
          confirmationInput(
            {
              ...first,
              consumerUserId: other.id,
              holdId: secondHold.id,
              policyVersion: secondHold.policies.version,
            },
            'monthly-limit-second-confirm',
          ),
        ),
      ]);
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toMatchObject([
        { reason: new AppointmentConfirmationRepositoryError('monthly_booking_limit_reached') },
      ]);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
    await expect(
      prisma.bookingHold.count({ where: { tenantId: first.tenantId, status: 'ACTIVE' } }),
    ).resolves.toBe(1);
    await expect(prisma.appointment.count({ where: { tenantId: first.tenantId } })).resolves.toBe(
      1,
    );
  });

  it.each([
    {
      suffix: 'price-from',
      snapshot: { priceTypeSnapshot: 'FROM' as const, priceAmountSnapshot: 900 },
      expected: { pricingStatus: 'ESTIMATE', subtotalAmount: null, totalAmount: null },
    },
    {
      suffix: 'price-range',
      snapshot: {
        priceTypeSnapshot: 'RANGE' as const,
        priceAmountSnapshot: null,
        priceMinSnapshot: 1000,
        priceMaxSnapshot: 1600,
      },
      expected: { pricingStatus: 'ESTIMATE', subtotalAmount: null, totalAmount: null },
    },
    {
      suffix: 'price-quote',
      snapshot: {
        priceTypeSnapshot: 'QUOTE' as const,
        priceAmountSnapshot: null,
        priceMinSnapshot: null,
        priceMaxSnapshot: null,
      },
      expected: { pricingStatus: 'QUOTE_REQUIRED', subtotalAmount: null, totalAmount: null },
    },
  ])(
    'keeps $suffix pricing truthful without inventing totals',
    async ({ suffix, snapshot, expected }) => {
      const fixture = await createFixture(suffix);
      await prisma.bookingHold.update({ where: { id: fixture.holdId }, data: snapshot });
      const result = await repository.confirm(confirmationInput(fixture, `${suffix}-confirm`));
      expect(result).toMatchObject({ kind: 'created', appointment: expected });
    },
  );

  it('treats a zero monthly entitlement as unlimited', async () => {
    const first = await createFixture('monthly-unlimited', 0);
    const other = await prisma.user.create({
      data: { displayName: 'Appointment repository unlimited second consumer' },
    });
    const secondHold = await new PrismaBookingHoldRepository(prisma).acquire({
      consumerUserId: other.id,
      slug: first.slug,
      serviceId: first.serviceId,
      startAt: alternateStartAt,
      idempotencyKeyHash: hash('monthly-unlimited-second-hold'),
      requestFingerprint: hash('monthly-unlimited-second-request'),
    });
    await repository.confirm(confirmationInput(first, 'monthly-unlimited-first-confirm'));
    await expect(
      repository.confirm(
        confirmationInput(
          {
            ...first,
            consumerUserId: other.id,
            holdId: secondHold.id,
            policyVersion: secondHold.policies.version,
          },
          'monthly-unlimited-second-confirm',
        ),
      ),
    ).resolves.toMatchObject({ kind: 'created' });
    await expect(prisma.appointment.count({ where: { tenantId: first.tenantId } })).resolves.toBe(
      2,
    );
  });
});

interface Fixture {
  readonly tenantId: string;
  readonly slug: string;
  readonly serviceId: string;
  readonly consumerUserId: string;
  readonly holdId: string;
  readonly policyVersion: string;
  readonly planId?: string;
}

async function createFixture(suffix: string, paidLimit?: number): Promise<Fixture> {
  const consumer = await prisma.user.create({
    data: { displayName: `Appointment repository consumer ${suffix}` },
  });
  let planId: string | undefined;
  if (paidLimit !== undefined) {
    const plan = await prisma.plan.create({
      data: {
        code: `APPOINTMENT_TEST_${suffix.toUpperCase()}`,
        name: `Appointment test ${suffix}`,
        billingPeriod: 'MONTHLY',
        priceAmount: 100,
        entitlements: {
          create: { entitlementCode: 'MAX_MONTHLY_BOOKINGS', valueJson: paidLimit },
        },
      },
    });
    planId = plan.id;
  }
  const tenant = await prisma.tenant.create({
    data: {
      name: `Appointment repository ${suffix}`,
      slug: `appointment-repository-${suffix}`,
      ...(planId === undefined ? {} : { planId, subscriptionStatus: 'ACTIVE' as const }),
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
      postalCode: '106',
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
  const hold = await new PrismaBookingHoldRepository(prisma).acquire({
    consumerUserId: consumer.id,
    slug: tenant.slug,
    serviceId: service.id,
    startAt: primaryStartAt,
    idempotencyKeyHash: hash(`${suffix}:hold-key`),
    requestFingerprint: hash(`${suffix}:hold-request`),
  });
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    serviceId: service.id,
    consumerUserId: consumer.id,
    holdId: hold.id,
    policyVersion: hold.policies.version,
    ...(planId === undefined ? {} : { planId }),
  };
}

function confirmationInput(fixture: Fixture, key: string) {
  return {
    consumerUserId: fixture.consumerUserId,
    holdId: fixture.holdId,
    policyVersion: fixture.policyVersion,
    keyHash: hash(key),
    requestFingerprint: hash(`${key}:${fixture.holdId}:${fixture.policyVersion}`),
    requestId: randomUUID(),
  };
}

function appointmentId(outcome: Awaited<ReturnType<typeof repository.confirm>>): string {
  if (outcome.kind === 'expired') throw new Error('expected appointment outcome');
  return outcome.appointment.id;
}

async function clearAppointments(): Promise<void> {
  await prisma.appointmentConfirmationKey.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.appointmentStatusHistory.deleteMany();
  await prisma.auditLog.deleteMany({ where: { resourceType: 'appointment' } });
  await prisma.bookingOccupancy.deleteMany({ where: { appointmentId: { not: null } } });
  await prisma.appointmentItem.deleteMany();
  await prisma.appointment.deleteMany();
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
