import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaCustomerProjectionRepository } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaCustomerProjectionRepository(prisma);
const fixturePrefix = 'crm-projection-';

describe('customer projection repository', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('projects every shared outbox status without mutating shared delivery state', async () => {
    const fixture = await createFixture('shared-status');
    const event = await createOutboxEvent(fixture, 'appointment.confirmed.v1', 'PUBLISHED');

    await expect(repository.projectNext()).resolves.toMatchObject({
      kind: 'projected',
      seededCount: 1,
    });
    await expect(repository.projectNext()).resolves.toEqual({ kind: 'empty', seededCount: 0 });

    await expect(
      prisma.outboxEvent.findUniqueOrThrow({
        where: { id: event.id },
        select: { status: true, attemptCount: true, publishedAt: true },
      }),
    ).resolves.toEqual({
      status: 'PUBLISHED',
      attemptCount: 7,
      publishedAt: event.publishedAt,
    });
    await expect(
      prisma.customer.findUniqueOrThrow({
        where: {
          tenantId_consumerUserId: {
            tenantId: fixture.tenantId,
            consumerUserId: fixture.consumerUserId,
          },
        },
      }),
    ).resolves.toMatchObject({
      relationshipStartedAt: fixture.confirmedAt,
      completedVisitCount: 0,
      noShowCount: 0,
      projectedThroughEventId: event.id,
    });
    await expect(
      prisma.crmProjectionDelivery.count({
        where: { projector: 'consumer_crm_v1', outboxEventId: event.id },
      }),
    ).resolves.toBe(1);
  });

  it('recomputes completed and no-show counts from effective reschedule leaves', async () => {
    const fixture = await createFixture('current-truth');
    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: { status: 'RESCHEDULED' },
    });
    const replacement = await createAppointment(fixture, {
      status: 'COMPLETED',
      startAt: new Date(fixture.startAt.getTime() + 24 * 60 * 60 * 1_000),
      rescheduledFromId: fixture.appointmentId,
      rescheduleRootId: fixture.appointmentId,
    });
    const noShow = await createAppointment(fixture, {
      status: 'NO_SHOW',
      startAt: new Date(fixture.startAt.getTime() + 48 * 60 * 60 * 1_000),
    });
    await createOutboxEvent(
      { ...fixture, appointmentId: replacement.id },
      'appointment.completed.v1',
      'FAILED',
    );

    await expect(repository.projectNext()).resolves.toMatchObject({ kind: 'projected' });
    const customer = await prisma.customer.findUniqueOrThrow({
      where: {
        tenantId_consumerUserId: {
          tenantId: fixture.tenantId,
          consumerUserId: fixture.consumerUserId,
        },
      },
    });
    expect(customer).toMatchObject({
      relationshipStartedAt: fixture.confirmedAt,
      firstVisitAt: replacement.startAt,
      lastVisitAt: replacement.startAt,
      completedVisitCount: 1,
      noShowCount: 1,
    });
    expect(customer.firstVisitAt).not.toEqual(fixture.startAt);
    expect(noShow.status).toBe('NO_SHOW');
  });

  it('serializes concurrent replay and preserves one customer and one delivery', async () => {
    const fixture = await createFixture('concurrency');
    const event = await createOutboxEvent(fixture, 'appointment.confirmed.v1', 'PENDING');

    const outcomes = await Promise.all([repository.projectNext(), repository.projectNext()]);
    expect(outcomes.filter(({ kind }) => kind === 'projected')).toHaveLength(1);
    expect(outcomes.filter(({ kind }) => kind === 'empty')).toHaveLength(1);
    await expect(
      prisma.customer.count({
        where: { tenantId: fixture.tenantId, consumerUserId: fixture.consumerUserId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.crmProjectionDelivery.count({
        where: { projector: 'consumer_crm_v1', outboxEventId: event.id },
      }),
    ).resolves.toBe(1);
  });
});

interface Fixture {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly appointmentId: string;
  readonly locationId: string;
  readonly staffId: string;
  readonly serviceId: string;
  readonly startAt: Date;
  readonly confirmedAt: Date;
}

async function createFixture(suffix: string): Promise<Fixture> {
  const unique = `${suffix}-${randomUUID().slice(0, 8)}`;
  const consumer = await prisma.user.create({
    data: { displayName: `CRM projection consumer ${unique}` },
  });
  const plan = await prisma.plan.create({
    data: {
      code: `CRM_PROJECTION_${unique}`.toUpperCase(),
      name: `CRM projection ${unique}`,
      billingPeriod: 'MONTHLY',
      priceAmount: 0,
    },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `CRM projection ${unique}`,
      slug: `${fixturePrefix}${unique}`,
      planId: plan.id,
    },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: '中山店',
      addressText: 'fixture address',
      city: '台北市',
      district: '中山區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: 'CRM fixture service',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1_200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'CRM fixture staff',
    },
  });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
  const confirmedAt = new Date(Date.now() - 60_000);
  const fixtureBase = {
    tenantId: tenant.id,
    consumerUserId: consumer.id,
    locationId: location.id,
    staffId: staff.id,
    serviceId: service.id,
    startAt,
    confirmedAt,
  };
  const appointment = await createAppointment(
    { ...fixtureBase, appointmentId: '' },
    { status: 'CONFIRMED', startAt, confirmedAt },
  );
  return { ...fixtureBase, appointmentId: appointment.id };
}

async function createAppointment(
  fixture: Fixture,
  options: {
    readonly status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';
    readonly startAt: Date;
    readonly confirmedAt?: Date;
    readonly rescheduledFromId?: string;
    readonly rescheduleRootId?: string;
  },
) {
  const policyVersion = `v2:${hash(randomUUID())}`;
  const hold = await prisma.bookingHold.create({
    data: {
      tenantId: fixture.tenantId,
      locationId: fixture.locationId,
      serviceId: fixture.serviceId,
      staffId: fixture.staffId,
      consumerUserId: fixture.consumerUserId,
      status: 'CONSUMED',
      startAt: options.startAt,
      endAt: new Date(options.startAt.getTime() + 60 * 60 * 1_000),
      serviceNameSnapshot: 'CRM fixture service',
      staffDisplayNameSnapshot: 'CRM fixture staff',
      durationMinutesSnapshot: 60,
      priceTypeSnapshot: 'FIXED',
      priceAmountSnapshot: 1_200,
      currencySnapshot: 'TWD',
      source: 'MERCHANT_LINK',
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '請提前通知',
      policyVersion,
      locationNameSnapshot: '中山店',
      addressTextSnapshot: 'fixture address',
      citySnapshot: '台北市',
      districtSnapshot: '中山區',
      locationTimezoneSnapshot: 'Asia/Taipei',
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKeyHash: hash(randomUUID()),
      requestFingerprint: hash(randomUUID()),
    },
  });
  const confirmedAt = options.confirmedAt ?? new Date();
  return prisma.appointment.create({
    data: {
      tenantId: fixture.tenantId,
      locationId: fixture.locationId,
      staffId: fixture.staffId,
      consumerUserId: fixture.consumerUserId,
      holdId: hold.id,
      status: options.status,
      source: 'MERCHANT_LINK',
      pricingStatus: 'EXACT',
      paymentStatus: 'NOT_REQUIRED',
      startAt: options.startAt,
      endAt: new Date(options.startAt.getTime() + 60 * 60 * 1_000),
      confirmedAt,
      usageTimezoneSnapshot: 'Asia/Taipei',
      usageMonth: taipeiMonth(options.startAt),
      locationTimezoneSnapshot: 'Asia/Taipei',
      currency: 'TWD',
      subtotalAmount: 1_200,
      depositAmount: 0,
      totalAmount: 1_200,
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '請提前通知',
      policyVersion,
      policiesAcceptedAt: confirmedAt,
      locationNameSnapshot: '中山店',
      addressTextSnapshot: 'fixture address',
      citySnapshot: '台北市',
      districtSnapshot: '中山區',
      rescheduledFromId: options.rescheduledFromId ?? null,
      rescheduleRootId: options.rescheduleRootId ?? null,
    },
  });
}

function createOutboxEvent(
  fixture: Pick<Fixture, 'tenantId' | 'appointmentId'>,
  eventType: string,
  status: 'PENDING' | 'PUBLISHED' | 'FAILED',
) {
  const createdAt = new Date(Date.now() - 1_000);
  return prisma.outboxEvent.create({
    data: {
      tenantId: fixture.tenantId,
      aggregateType: 'appointment',
      aggregateId: fixture.appointmentId,
      eventType,
      payloadJson: { appointmentId: fixture.appointmentId },
      dedupeKey: `crm:${eventType}:${fixture.appointmentId}:${randomUUID()}`,
      status,
      availableAt: createdAt,
      attemptCount: status === 'PUBLISHED' ? 7 : 0,
      publishedAt: status === 'PUBLISHED' ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    },
  });
}

async function clearFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.crmProjectionStream.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.crmProjectionDelivery.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.bookingHold.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.staffProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({
    where: { displayName: { startsWith: 'CRM projection consumer ' } },
  });
  await prisma.plan.deleteMany({ where: { code: { startsWith: 'CRM_PROJECTION_' } } });
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function taipeiMonth(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  })
    .format(value)
    .slice(0, 7);
}
