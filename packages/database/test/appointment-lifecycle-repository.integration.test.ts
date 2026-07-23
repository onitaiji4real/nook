import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AppointmentLifecycleRepositoryError,
  PrismaAppointmentConfirmationRepository,
  PrismaAppointmentLifecycleRepository,
  PrismaBookingHoldRepository,
} from '../src';

const prisma = new PrismaClient();
const lifecycle = new PrismaAppointmentLifecycleRepository(prisma);
const holds = new PrismaBookingHoldRepository(prisma);
const confirmations = new PrismaAppointmentConfirmationRepository(prisma);

describe('appointment lifecycle repository', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('atomically builds A to B to C, preserves root usage and supports both replay forms', async () => {
    const fixture = await createFixture('chain');
    const firstTarget = await createHold(fixture, '2026-08-07T03:00:00.000Z', 'target-b');
    const firstInput = rescheduleInput(fixture, fixture.appointmentId, firstTarget, 'first-key');

    const first = await lifecycle.transitionConsumerReschedule(firstInput);
    expect(first).toMatchObject({
      kind: 'transition',
      result: {
        appointmentId: fixture.appointmentId,
        status: 'RESCHEDULED',
        replayed: false,
      },
    });
    if (first.kind !== 'transition' || first.result.replacementAppointmentId === null)
      throw new Error('expected replacement');
    expect(typeof first.result.replacementAppointmentId).toBe('string');
    const replacementId = first.result.replacementAppointmentId;

    await expect(lifecycle.transitionConsumerReschedule(firstInput)).resolves.toMatchObject({
      kind: 'transition',
      result: { replacementAppointmentId: replacementId, replayed: true },
    });
    await expect(
      lifecycle.transitionConsumerReschedule({ ...firstInput, keyHash: hash('natural-new-key') }),
    ).resolves.toMatchObject({
      kind: 'transition',
      result: { replacementAppointmentId: replacementId, replayed: true },
    });

    const secondTarget = await createHold(fixture, '2026-08-14T03:00:00.000Z', 'target-c');
    const second = await lifecycle.transitionConsumerReschedule(
      rescheduleInput(fixture, replacementId, secondTarget, 'second-key'),
    );
    if (second.kind !== 'transition' || second.result.replacementAppointmentId === null)
      throw new Error('expected second replacement');
    const leafId = second.result.replacementAppointmentId;

    await expect(
      prisma.appointment.findMany({
        where: { tenantId: fixture.tenantId },
        orderBy: { confirmedAt: 'asc' },
        select: {
          id: true,
          status: true,
          source: true,
          usageMonth: true,
          rescheduledFromId: true,
          rescheduleRootId: true,
        },
      }),
    ).resolves.toEqual([
      {
        id: fixture.appointmentId,
        status: 'RESCHEDULED',
        source: 'MERCHANT_LINK',
        usageMonth: fixture.usageMonth,
        rescheduledFromId: null,
        rescheduleRootId: null,
      },
      {
        id: replacementId,
        status: 'RESCHEDULED',
        source: 'MERCHANT_LINK',
        usageMonth: fixture.usageMonth,
        rescheduledFromId: fixture.appointmentId,
        rescheduleRootId: fixture.appointmentId,
      },
      {
        id: leafId,
        status: 'CONFIRMED',
        source: 'MERCHANT_LINK',
        usageMonth: fixture.usageMonth,
        rescheduledFromId: replacementId,
        rescheduleRootId: fixture.appointmentId,
      },
    ]);
    await expect(
      prisma.appointment.count({
        where: {
          tenantId: fixture.tenantId,
          usageMonth: fixture.usageMonth,
          source: { in: ['MERCHANT_LINK', 'MARKETPLACE'] },
          rescheduledFromId: null,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.bookingOccupancy.findMany({
        where: { tenantId: fixture.tenantId },
        orderBy: { occupiedStartAt: 'asc' },
        select: { appointmentId: true, holdId: true, status: true },
      }),
    ).resolves.toEqual([
      { appointmentId: fixture.appointmentId, holdId: null, status: 'RELEASED' },
      { appointmentId: replacementId, holdId: null, status: 'RELEASED' },
      { appointmentId: leafId, holdId: null, status: 'ACTIVE' },
    ]);
    await expect(
      prisma.appointmentTransitionKey.count({ where: { tenantId: fixture.tenantId } }),
    ).resolves.toBe(3);
    await expect(
      prisma.outboxEvent.count({
        where: { tenantId: fixture.tenantId, eventType: 'appointment.rescheduled.v1' },
      }),
    ).resolves.toBe(2);
  });

  it('rolls back mismatched targets but commits stable target expiry maintenance', async () => {
    const fixture = await createFixture('failures');
    const mismatch = await createHold(fixture, '2026-08-07T03:00:00.000Z', 'mismatch');
    const otherService = await prisma.service.create({
      data: {
        tenantId: fixture.tenantId,
        name: 'Other service',
        durationMinutes: 60,
        priceType: 'FIXED',
        priceAmount: 900,
      },
    });
    await prisma.bookingHold.update({
      where: { id: mismatch.id },
      data: { serviceId: otherService.id },
    });
    await expect(
      lifecycle.transitionConsumerReschedule(
        rescheduleInput(fixture, fixture.appointmentId, mismatch, 'mismatch-key'),
      ),
    ).rejects.toEqual(new AppointmentLifecycleRepositoryError('reschedule_target_mismatch'));
    await expect(
      prisma.appointment.findUniqueOrThrow({ where: { id: fixture.appointmentId } }),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: mismatch.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    const expired = await createHold(fixture, '2026-08-14T03:00:00.000Z', 'expired');
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.bookingHold.update({
      where: { id: expired.id },
      data: { createdAt: new Date(expiredAt.getTime() - 600_000), expiresAt: expiredAt },
    });
    await expect(
      lifecycle.transitionConsumerReschedule(
        rescheduleInput(fixture, fixture.appointmentId, expired, 'expired-key'),
      ),
    ).resolves.toEqual({ kind: 'target_expired' });
    await expect(
      prisma.bookingHold.findUniqueOrThrow({ where: { id: expired.id } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({ where: { holdId: expired.id } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    await expect(
      prisma.appointment.findUniqueOrThrow({ where: { id: fixture.appointmentId } }),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('cancels once, releases exactly one occupancy and replays without duplicate effects', async () => {
    const fixture = await createFixture('cancel');
    const input = {
      actorUserId: fixture.consumerUserId,
      appointmentId: fixture.appointmentId,
      reasonCode: 'CONSUMER_CHANGE_OF_PLANS' as const,
      keyHash: hash('cancel-key'),
      requestFingerprint: hash('cancel-fingerprint'),
      requestId: randomUUID(),
    };
    await expect(lifecycle.transitionConsumerCancel(input)).resolves.toMatchObject({
      status: 'CANCELLED',
      replayed: false,
    });
    await expect(lifecycle.transitionConsumerCancel(input)).resolves.toMatchObject({
      status: 'CANCELLED',
      replayed: true,
    });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({
        where: { appointmentId: fixture.appointmentId },
      }),
    ).resolves.toMatchObject({ status: 'RELEASED' });
    await expect(
      prisma.appointmentStatusHistory.count({
        where: { appointmentId: fixture.appointmentId, toStatus: 'CANCELLED' },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: fixture.appointmentId, eventType: 'appointment.cancelled.v1' },
      }),
    ).resolves.toBe(1);
  });

  it('enforces merchant role and timing while retaining occupancy through check-in and complete', async () => {
    const fixture = await createFixture('merchant');
    const manager = await prisma.user.create({ data: { displayName: 'Lifecycle manager' } });
    await prisma.membership.create({
      data: { tenantId: fixture.tenantId, userId: manager.id, role: 'MANAGER' },
    });
    await expect(
      lifecycle.transitionMerchant({
        actorUserId: manager.id,
        tenantId: fixture.tenantId,
        appointmentId: fixture.appointmentId,
        action: 'MERCHANT_CHECK_IN',
        reasonCode: null,
        keyHash: hash('too-early-key'),
        requestFingerprint: hash('too-early-fingerprint'),
        requestId: randomUUID(),
      }),
    ).rejects.toEqual(new AppointmentLifecycleRepositoryError('appointment_action_too_early'));

    const now = Date.now();
    const startAt = new Date(now - 60 * 60_000);
    const endAt = new Date(now - 1_000);
    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: { startAt, endAt },
    });
    await prisma.bookingOccupancy.update({
      where: { appointmentId: fixture.appointmentId },
      data: {
        occupiedStartAt: new Date(startAt.getTime() - 10 * 60_000),
        occupiedEndAt: new Date(endAt.getTime() + 10 * 60_000),
      },
    });
    await expect(
      lifecycle.transitionMerchant({
        actorUserId: manager.id,
        tenantId: fixture.tenantId,
        appointmentId: fixture.appointmentId,
        action: 'MERCHANT_CHECK_IN',
        reasonCode: null,
        keyHash: hash('check-in-key'),
        requestFingerprint: hash('check-in-fingerprint'),
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: 'CHECKED_IN' });
    await expect(
      lifecycle.transitionMerchant({
        actorUserId: manager.id,
        tenantId: fixture.tenantId,
        appointmentId: fixture.appointmentId,
        action: 'MERCHANT_COMPLETE',
        reasonCode: null,
        keyHash: hash('complete-key'),
        requestFingerprint: hash('complete-fingerprint'),
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(
      prisma.bookingOccupancy.findUniqueOrThrow({
        where: { appointmentId: fixture.appointmentId },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });

    const viewer = await prisma.user.create({ data: { displayName: 'Lifecycle viewer' } });
    await prisma.membership.create({
      data: { tenantId: fixture.tenantId, userId: viewer.id, role: 'VIEWER' },
    });
    await expect(
      lifecycle.authorizeMerchant({ actorUserId: viewer.id, tenantId: fixture.tenantId }),
    ).rejects.toEqual(new AppointmentLifecycleRepositoryError('forbidden'));
  });
});

interface Fixture {
  readonly tenantId: string;
  readonly slug: string;
  readonly serviceId: string;
  readonly consumerUserId: string;
  readonly staffId: string;
  readonly appointmentId: string;
  readonly usageMonth: string;
}

async function createFixture(suffix: string): Promise<Fixture> {
  const consumer = await prisma.user.create({
    data: { displayName: `Lifecycle consumer ${suffix}` },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Lifecycle ${suffix}`,
      slug: `lifecycle-${suffix}`,
      bookingPolicy: {
        create: {
          slotIntervalMinutes: 15,
          minimumLeadMinutes: 0,
          maximumAdvanceDays: 90,
          consumerCancelLeadMinutes: 0,
          consumerRescheduleLeadMinutes: 0,
        },
      },
    },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: 'Lifecycle studio',
      addressText: '台北市測試路 1 號',
      city: '台北市',
      district: '大安區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Lifecycle service',
      durationMinutes: 60,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      priceType: 'FIXED',
      priceAmount: 1_200,
    },
  });
  await prisma.merchantProfile.create({
    data: {
      tenantId: tenant.id,
      category: 'NAIL',
      description: 'Lifecycle fixture',
      bookingPolicy: '完全預約制',
      cancellationPolicy: '提前聯絡店家',
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
      validFrom: new Date('2026-07-01T00:00:00.000Z'),
    },
  });
  const sourceHold = await createHold(
    { tenantId: tenant.id, slug: tenant.slug, serviceId: service.id, consumerUserId: consumer.id },
    '2026-07-31T03:00:00.000Z',
    'source',
  );
  const confirmed = await confirmations.confirm({
    consumerUserId: consumer.id,
    holdId: sourceHold.id,
    policyVersion: sourceHold.policies.version,
    keyHash: hash(`${suffix}:confirm-key`),
    requestFingerprint: hash(`${suffix}:confirm-fingerprint`),
    requestId: randomUUID(),
  });
  if (confirmed.kind === 'expired') throw new Error('source unexpectedly expired');
  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    serviceId: service.id,
    consumerUserId: consumer.id,
    staffId: staff.id,
    appointmentId: confirmed.appointment.id,
    usageMonth: await prisma.appointment
      .findUniqueOrThrow({ where: { id: confirmed.appointment.id }, select: { usageMonth: true } })
      .then(({ usageMonth }) => usageMonth),
  };
}

function createHold(
  fixture: Pick<Fixture, 'slug' | 'serviceId' | 'consumerUserId'> & { tenantId?: string },
  startAt: string,
  key: string,
) {
  return holds.acquire({
    consumerUserId: fixture.consumerUserId,
    slug: fixture.slug,
    serviceId: fixture.serviceId,
    startAt: new Date(startAt),
    idempotencyKeyHash: hash(`${key}:hold-key`),
    requestFingerprint: hash(`${key}:hold-fingerprint`),
    policyVersion: 2,
  });
}

function rescheduleInput(
  fixture: Fixture,
  appointmentId: string,
  hold: Awaited<ReturnType<typeof createHold>>,
  key: string,
) {
  return {
    actorUserId: fixture.consumerUserId,
    appointmentId,
    holdId: hold.id,
    policyVersion: hold.policies.version,
    policiesAccepted: true as const,
    reasonCode: 'RESCHEDULE_SCHEDULE_CONFLICT' as const,
    keyHash: hash(key),
    requestFingerprint: hash(
      JSON.stringify({
        appointmentId,
        holdId: hold.id,
        policyVersion: hold.policies.version,
        reasonCode: 'RESCHEDULE_SCHEDULE_CONFLICT',
      }),
    ),
    requestId: randomUUID(),
  };
}

async function clearFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: 'lifecycle-' } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length === 0) return;
  await prisma.appointmentTransitionKey.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.appointmentConfirmationKey.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.appointmentStatusHistory.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.bookingOccupancy.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.appointmentItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.bookingHold.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { displayName: { startsWith: 'Lifecycle' } } });
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
