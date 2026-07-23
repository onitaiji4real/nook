import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PrismaNotificationDeliveryRepository,
  PrismaNotificationDispatchRepository,
  PrismaNotificationProjectionRepository,
} from '../src';

const prisma = new PrismaClient();
const projection = new PrismaNotificationProjectionRepository(prisma);
const dispatch = new PrismaNotificationDispatchRepository(prisma);
const delivery = new PrismaNotificationDeliveryRepository(prisma);
const fixturePrefix = 'notification-repository-';

describe('notification repositories', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('projects a confirmed event at stable event time and cancels prior jobs on cancellation', async () => {
    const fixture = await createFixture('projection', 2);
    const confirmed = await createOutboxEvent(fixture, 'appointment.confirmed.v1', {
      appointmentId: fixture.appointmentId,
      tenantId: fixture.tenantId,
    });

    await expect(projection.projectNext()).resolves.toEqual({
      kind: 'projected',
      eventId: confirmed.id,
      jobCount: 3,
    });
    await expect(projection.projectNext()).resolves.toEqual({ kind: 'empty' });

    const projected = await prisma.notificationJob.findMany({
      where: { appointmentId: fixture.appointmentId },
      orderBy: { dueAt: 'asc' },
      select: { templateKey: true, dueAt: true, status: true, sourceOutboxEventId: true },
    });
    expect(projected).toEqual([
      {
        templateKey: 'appointment.confirmed.v1',
        dueAt: confirmed.createdAt,
        status: 'PENDING',
        sourceOutboxEventId: confirmed.id,
      },
      {
        templateKey: 'appointment.reminder.24h.v1',
        dueAt: new Date(fixture.startAt.getTime() - 24 * 60 * 60 * 1_000),
        status: 'PENDING',
        sourceOutboxEventId: confirmed.id,
      },
      {
        templateKey: 'appointment.reminder.2h.v1',
        dueAt: new Date(fixture.startAt.getTime() - 2 * 60 * 60 * 1_000),
        status: 'PENDING',
        sourceOutboxEventId: confirmed.id,
      },
    ]);

    await prisma.appointment.update({
      where: { id: fixture.appointmentId },
      data: { status: 'CANCELLED' },
    });
    const cancelled = await createOutboxEvent(fixture, 'appointment.cancelled.v1', {
      appointmentId: fixture.appointmentId,
    });
    await expect(projection.projectNext()).resolves.toEqual({
      kind: 'projected',
      eventId: cancelled.id,
      jobCount: 1,
    });
    await expect(
      prisma.notificationJob.findMany({
        where: { appointmentId: fixture.appointmentId },
        orderBy: { templateKey: 'asc' },
        select: { templateKey: true, status: true, terminalCode: true },
      }),
    ).resolves.toEqual([
      {
        templateKey: 'appointment.cancelled.v1',
        status: 'PENDING',
        terminalCode: null,
      },
      {
        templateKey: 'appointment.confirmed.v1',
        status: 'CANCELLED',
        terminalCode: 'appointment_lifecycle_changed',
      },
      {
        templateKey: 'appointment.reminder.24h.v1',
        status: 'CANCELLED',
        terminalCode: 'appointment_lifecycle_changed',
      },
      {
        templateKey: 'appointment.reminder.2h.v1',
        status: 'CANCELLED',
        terminalCode: 'appointment_lifecycle_changed',
      },
    ]);
  });

  it('fails corrupt events without creating jobs and leaves future events pending', async () => {
    const fixture = await createFixture('corruption', 1);
    const future = await createOutboxEvent(
      fixture,
      'appointment.confirmed.v1',
      { appointmentId: fixture.appointmentId, tenantId: fixture.tenantId },
      { availableAt: new Date(Date.now() + 60 * 60 * 1_000) },
    );
    await expect(projection.projectNext()).resolves.toEqual({ kind: 'empty' });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: future.id } }),
    ).resolves.toMatchObject({ status: 'PENDING', attemptCount: 0 });

    await prisma.outboxEvent.update({
      where: { id: future.id },
      data: {
        availableAt: new Date(Date.now() - 1_000),
        payloadJson: { appointmentId: randomUUID(), tenantId: fixture.tenantId },
      },
    });
    await expect(projection.projectNext()).resolves.toEqual({
      kind: 'failed',
      eventId: future.id,
      code: 'aggregate_id_mismatch',
    });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: future.id } }),
    ).resolves.toMatchObject({ status: 'FAILED', attemptCount: 1 });
    await expect(
      prisma.notificationJob.count({ where: { sourceOutboxEventId: future.id } }),
    ).resolves.toBe(0);
  });

  it('revalidates an existing dedupe row before publishing a duplicate event', async () => {
    const fixture = await createFixture('dedupe-shape', 0);
    const first = await createOutboxEvent(fixture, 'appointment.confirmed.v1', {
      appointmentId: fixture.appointmentId,
      tenantId: fixture.tenantId,
    });
    const second = await createOutboxEvent(
      fixture,
      'appointment.confirmed.v1',
      { appointmentId: fixture.appointmentId, tenantId: fixture.tenantId },
      { createdAt: new Date(first.createdAt.getTime() + 1_000) },
    );
    await expect(projection.projectNext()).resolves.toMatchObject({
      kind: 'projected',
      eventId: first.id,
    });
    await expect(projection.projectNext()).resolves.toEqual({
      kind: 'failed',
      eventId: second.id,
      code: 'notification_dedupe_collision',
    });
    await expect(
      prisma.notificationJob.count({ where: { appointmentId: fixture.appointmentId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: { id: { in: [first.id, second.id] }, status: 'PUBLISHED' },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.count({
        where: { id: { in: [first.id, second.id] }, status: 'FAILED' },
      }),
    ).resolves.toBe(1);
  });

  it('claims, reclaims, marks enqueued and truthfully sweeps expired jobs', async () => {
    const fixture = await projectConfirmedFixture('dispatch', 2);
    const resultJob = await job(fixture.appointmentId, 'appointment.confirmed.v1');

    const firstClaim = await dispatch.claimNext();
    expect(firstClaim).toMatchObject({ jobId: resultJob.id });
    if (firstClaim === null) throw new Error('expected dispatch claim');
    await expect(dispatch.markEnqueued(firstClaim)).resolves.toBe(true);
    await expect(
      prisma.notificationJob.findUniqueOrThrow({ where: { id: resultJob.id } }),
    ).resolves.toMatchObject({
      status: 'ENQUEUED',
      dispatchAttemptCount: 1,
      dispatchLeaseUntil: null,
    });

    const reminder = await job(fixture.appointmentId, 'appointment.reminder.24h.v1');
    await prisma.notificationJob.update({
      where: { id: reminder.id },
      data: {
        status: 'DISPATCHING',
        dueAt: new Date(Date.now() - 30 * 60 * 1_000),
        dispatchLeaseUntil: new Date(Date.now() - 1_000),
      },
    });
    await expect(dispatch.claimNext()).resolves.toMatchObject({ jobId: reminder.id });
    await expect(
      prisma.notificationJob.findUniqueOrThrow({ where: { id: reminder.id } }),
    ).resolves.toMatchObject({ status: 'DISPATCHING', dispatchAttemptCount: 1 });

    const expired = await job(fixture.appointmentId, 'appointment.reminder.2h.v1');
    await prisma.notificationJob.update({
      where: { id: expired.id },
      data: { dueAt: new Date(Date.now() - 2 * 60 * 60 * 1_000) },
    });
    await expect(dispatch.sweepNextExpired()).resolves.toEqual({
      kind: 'terminal',
      jobId: expired.id,
      status: 'SKIPPED',
      code: 'notification_expired',
    });
  });

  it('serializes delivery, preserves retry identity and reserves monthly budget once', async () => {
    const fixture = await projectConfirmedFixture('delivery', 2);
    await createFollowingRecipient(fixture.consumerUserId);
    const resultJob = await job(fixture.appointmentId, 'appointment.confirmed.v1');
    await prisma.notificationJob.update({
      where: { id: resultJob.id },
      data: { status: 'ENQUEUED' },
    });

    const first = await delivery.claim({
      jobId: resultJob.id,
      monthlyCap: 1,
      render: () => 'safe canonical text',
    });
    expect(first).toMatchObject({ kind: 'claimed', attemptNumber: 1 });
    if (first.kind !== 'claimed') throw new Error('expected delivery claim');
    await expect(
      delivery.claim({ jobId: resultJob.id, monthlyCap: 1, render: () => 'unused' }),
    ).resolves.toEqual({ kind: 'busy' });
    await expect(
      delivery.complete({
        claim: first,
        result: { kind: 'retryable', code: 'line_timeout' },
      }),
    ).resolves.toEqual({ kind: 'retryable' });

    const second = await delivery.claim({
      jobId: resultJob.id,
      monthlyCap: 1,
      render: () => 'safe canonical text',
    });
    expect(second).toMatchObject({
      kind: 'claimed',
      attemptNumber: 2,
      retryKey: first.retryKey,
    });
    if (second.kind !== 'claimed') throw new Error('expected retry claim');
    await expect(
      delivery.complete({
        claim: second,
        result: { kind: 'accepted', httpStatus: 200, requestId: 'safe-request-id' },
      }),
    ).resolves.toEqual({ kind: 'accepted', replayed: false });

    const monthlyUsage = await prisma.notificationProviderMonthlyUsage.findMany({
      select: { usageMonth: true, reservedCount: true },
    });
    expect(monthlyUsage).toHaveLength(1);
    expect(monthlyUsage[0]?.usageMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/u);
    expect(monthlyUsage[0]?.reservedCount).toBe(1);
    await expect(
      prisma.notificationDelivery.findMany({
        where: { notificationJobId: resultJob.id },
        orderBy: { attemptNumber: 'asc' },
        select: { attemptNumber: true, outcome: true, code: true },
      }),
    ).resolves.toEqual([
      { attemptNumber: 1, outcome: 'RETRYABLE', code: 'line_timeout' },
      { attemptNumber: 2, outcome: 'ACCEPTED', code: 'line_accepted' },
    ]);

    const cappedJob = await job(fixture.appointmentId, 'appointment.reminder.24h.v1');
    await prisma.notificationJob.update({
      where: { id: cappedJob.id },
      data: { status: 'ENQUEUED', dueAt: new Date() },
    });
    await expect(
      delivery.claim({ jobId: cappedJob.id, monthlyCap: 1, render: () => 'safe' }),
    ).resolves.toEqual({ kind: 'skipped', code: 'line_monthly_cap_exhausted' });
    await expect(prisma.notificationProviderMonthlyUsage.findFirstOrThrow()).resolves.toMatchObject(
      { reservedCount: 1 },
    );
  });

  it('does not claim for blocked, inactive or stale appointment truth', async () => {
    const blocked = await projectConfirmedFixture('blocked', 2);
    await createFollowingRecipient(blocked.consumerUserId, 'BLOCKED');
    const blockedJob = await job(blocked.appointmentId, 'appointment.confirmed.v1');
    await prisma.notificationJob.update({
      where: { id: blockedJob.id },
      data: { status: 'ENQUEUED' },
    });
    await expect(
      delivery.claim({ jobId: blockedJob.id, monthlyCap: 10, render: () => 'unused' }),
    ).resolves.toEqual({ kind: 'skipped', code: 'line_recipient_unavailable' });

    const inactive = await projectConfirmedFixture('inactive', 2);
    await createFollowingRecipient(inactive.consumerUserId);
    await prisma.user.update({
      where: { id: inactive.consumerUserId },
      data: { status: 'SUSPENDED' },
    });
    const inactiveJob = await job(inactive.appointmentId, 'appointment.confirmed.v1');
    await prisma.notificationJob.update({
      where: { id: inactiveJob.id },
      data: { status: 'ENQUEUED' },
    });
    await expect(
      delivery.claim({ jobId: inactiveJob.id, monthlyCap: 10, render: () => 'unused' }),
    ).resolves.toEqual({ kind: 'skipped', code: 'line_recipient_unavailable' });

    const changed = await projectConfirmedFixture('changed-truth', 2);
    await createFollowingRecipient(changed.consumerUserId);
    await prisma.appointment.update({
      where: { id: changed.appointmentId },
      data: { status: 'CANCELLED' },
    });
    const changedJob = await job(changed.appointmentId, 'appointment.reminder.24h.v1');
    await prisma.notificationJob.update({
      where: { id: changedJob.id },
      data: { status: 'ENQUEUED', dueAt: new Date() },
    });
    await expect(
      delivery.claim({ jobId: changedJob.id, monthlyCap: 10, render: () => 'unused' }),
    ).resolves.toEqual({ kind: 'skipped', code: 'appointment_not_eligible' });
    await expect(prisma.notificationProviderMonthlyUsage.count()).resolves.toBe(0);
  });

  it('turns an expired tenth STARTED attempt into AMBIGUOUS and dead-letters without attempt eleven', async () => {
    const fixture = await projectConfirmedFixture('ambiguous-limit', 1);
    const resultJob = await job(fixture.appointmentId, 'appointment.confirmed.v1');
    const startedAt = new Date(Date.now() - 3 * 60 * 1_000);
    await prisma.notificationJob.update({
      where: { id: resultJob.id },
      data: {
        status: 'DELIVERING',
        deliveryAttemptCount: 10,
        deliveryLeaseUntil: new Date(Date.now() - 60_000),
      },
    });
    await prisma.notificationDelivery.create({
      data: {
        notificationJobId: resultJob.id,
        attemptNumber: 10,
        outcome: 'STARTED',
        startedAt,
      },
    });

    await expect(
      delivery.claim({ jobId: resultJob.id, monthlyCap: 10, render: () => 'unused' }),
    ).resolves.toEqual({ kind: 'dead_letter', code: 'attempt_limit_ambiguous' });
    await expect(
      prisma.notificationDelivery.findUniqueOrThrow({
        where: {
          notificationJobId_attemptNumber: {
            notificationJobId: resultJob.id,
            attemptNumber: 10,
          },
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'AMBIGUOUS',
      code: 'delivery_outcome_ambiguous',
    });
    await expect(
      prisma.notificationDelivery.count({ where: { notificationJobId: resultJob.id } }),
    ).resolves.toBe(1);
  });

  it('serializes the platform budget across independent jobs and connections', async () => {
    const firstFixture = await projectConfirmedFixture('budget-first', 1);
    const secondFixture = await projectConfirmedFixture('budget-second', 1);
    await Promise.all([
      createFollowingRecipient(firstFixture.consumerUserId),
      createFollowingRecipient(secondFixture.consumerUserId),
    ]);
    const [firstJob, secondJob] = await Promise.all([
      job(firstFixture.appointmentId, 'appointment.confirmed.v1'),
      job(secondFixture.appointmentId, 'appointment.confirmed.v1'),
    ]);
    await prisma.notificationJob.updateMany({
      where: { id: { in: [firstJob.id, secondJob.id] } },
      data: { status: 'ENQUEUED' },
    });

    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      const outcomes = await Promise.all([
        new PrismaNotificationDeliveryRepository(firstClient).claim({
          jobId: firstJob.id,
          monthlyCap: 1,
          render: () => 'safe',
        }),
        new PrismaNotificationDeliveryRepository(secondClient).claim({
          jobId: secondJob.id,
          monthlyCap: 1,
          render: () => 'safe',
        }),
      ]);
      expect(outcomes.filter(({ kind }) => kind === 'claimed')).toHaveLength(1);
      expect(outcomes.filter(({ kind }) => kind === 'skipped')).toEqual([
        { kind: 'skipped', code: 'line_monthly_cap_exhausted' },
      ]);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
    await expect(prisma.notificationProviderMonthlyUsage.findFirstOrThrow()).resolves.toMatchObject(
      { reservedCount: 1 },
    );
  });

  it('reports a PII-free operational snapshot for backlog, failures and monthly cost', async () => {
    const fixture = await projectConfirmedFixture('operational-snapshot', 2);
    await createOutboxEvent(
      fixture,
      'appointment.cancelled.v1',
      { appointmentId: fixture.appointmentId, tenantId: fixture.tenantId },
      { createdAt: new Date(Date.now() - 5_000) },
    );
    const resultJob = await job(fixture.appointmentId, 'appointment.confirmed.v1');
    const deadLetterJob = await job(fixture.appointmentId, 'appointment.reminder.24h.v1');
    const acceptedJob = await job(fixture.appointmentId, 'appointment.reminder.2h.v1');
    const finishedAt = new Date();

    await prisma.notificationJob.update({
      where: { id: deadLetterJob.id },
      data: {
        status: 'DEAD_LETTER',
        terminalCode: 'synthetic_operational_failure',
      },
    });
    await prisma.notificationJob.update({
      where: { id: resultJob.id },
      data: { status: 'ENQUEUED', deliveryAttemptCount: 1 },
    });
    await prisma.notificationJob.update({
      where: { id: acceptedJob.id },
      data: { status: 'ACCEPTED', acceptedAt: finishedAt, deliveryAttemptCount: 1 },
    });
    await prisma.notificationDelivery.createMany({
      data: [
        {
          notificationJobId: resultJob.id,
          attemptNumber: 1,
          outcome: 'RETRYABLE',
          code: 'line_timeout',
          startedAt: new Date(finishedAt.getTime() - 1_000),
          finishedAt,
        },
        {
          notificationJobId: acceptedJob.id,
          attemptNumber: 1,
          outcome: 'ACCEPTED',
          providerHttpStatus: 200,
          code: 'line_accepted',
          startedAt: new Date(finishedAt.getTime() - 1_000),
          finishedAt,
        },
      ],
    });
    await prisma.notificationProviderMonthlyUsage.create({
      data: {
        provider: 'LINE_MESSAGING',
        usageMonth: taipeiMonth(finishedAt),
        reservedCount: 7,
      },
    });

    const snapshot = await dispatch.readOperationalSnapshot();
    expect(snapshot.oldestPendingOutboxAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot.oldestDueJobDelaySeconds).toBeGreaterThanOrEqual(0);
    expect(snapshot).toMatchObject({
      deadLetterJobCount: 1,
      retryableAttemptCount24h: 1,
      acceptedAttemptCount24h: 1,
      lineBudgetReservedCount: 7,
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      'acceptedAttemptCount24h',
      'deadLetterJobCount',
      'lineBudgetReservedCount',
      'oldestDueJobDelaySeconds',
      'oldestPendingOutboxAgeSeconds',
      'retryableAttemptCount24h',
    ]);
  });
});

interface Fixture {
  readonly tenantId: string;
  readonly appointmentId: string;
  readonly consumerUserId: string;
  readonly startAt: Date;
}

async function projectConfirmedFixture(suffix: string, reminderCount: number): Promise<Fixture> {
  const fixture = await createFixture(suffix, reminderCount);
  await createOutboxEvent(fixture, 'appointment.confirmed.v1', {
    appointmentId: fixture.appointmentId,
    tenantId: fixture.tenantId,
  });
  const outcome = await projection.projectNext();
  if (outcome.kind !== 'projected') throw new Error('expected confirmed projection');
  return fixture;
}

async function createFixture(suffix: string, reminderCount: number): Promise<Fixture> {
  const unique = `${suffix}-${randomUUID().slice(0, 8)}`;
  const consumer = await prisma.user.create({
    data: { displayName: `Notification repository consumer ${unique}` },
  });
  const plan = await prisma.plan.create({
    data: {
      code: `NOTIFICATION_REPOSITORY_${unique}`.toUpperCase(),
      name: `Notification repository ${unique}`,
      billingPeriod: 'MONTHLY',
      priceAmount: 0,
      entitlements: {
        create: {
          entitlementCode: 'APPOINTMENT_REMINDER_COUNT',
          valueJson: reminderCount,
        },
      },
    },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: `Notification repository ${unique}`,
      slug: `${fixturePrefix}${unique}`,
      planId: plan.id,
    },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: '大安店',
      addressText: 'private fixture address',
      city: '台北市',
      district: '大安區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: '凝膠服務',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1_200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'Yun',
    },
  });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1_000);
  const policyVersion = `v2:${hash(unique)}`;
  const hold = await prisma.bookingHold.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      serviceId: service.id,
      staffId: staff.id,
      consumerUserId: consumer.id,
      status: 'CONSUMED',
      startAt,
      endAt,
      serviceNameSnapshot: service.name,
      staffDisplayNameSnapshot: staff.displayName,
      durationMinutesSnapshot: 60,
      priceTypeSnapshot: 'FIXED',
      priceAmountSnapshot: 1_200,
      currencySnapshot: 'TWD',
      source: 'MERCHANT_LINK',
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '請提前通知',
      policyVersion,
      locationNameSnapshot: location.name,
      addressTextSnapshot: location.addressText,
      citySnapshot: location.city,
      districtSnapshot: location.district,
      locationTimezoneSnapshot: location.timezone,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKeyHash: hash(`${unique}:hold-key`),
      requestFingerprint: hash(`${unique}:hold-request`),
    },
  });
  const confirmedAt = new Date();
  const appointment = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      staffId: staff.id,
      consumerUserId: consumer.id,
      holdId: hold.id,
      status: 'CONFIRMED',
      source: 'MERCHANT_LINK',
      pricingStatus: 'EXACT',
      paymentStatus: 'NOT_REQUIRED',
      startAt,
      endAt,
      confirmedAt,
      usageTimezoneSnapshot: 'Asia/Taipei',
      usageMonth: taipeiMonth(startAt),
      locationTimezoneSnapshot: location.timezone,
      currency: 'TWD',
      subtotalAmount: 1_200,
      depositAmount: 0,
      totalAmount: 1_200,
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '請提前通知',
      policyVersion,
      policiesAcceptedAt: confirmedAt,
      locationNameSnapshot: location.name,
      addressTextSnapshot: location.addressText,
      citySnapshot: location.city,
      districtSnapshot: location.district,
    },
  });
  await prisma.appointmentItem.create({
    data: {
      tenantId: tenant.id,
      appointmentId: appointment.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutesSnapshot: service.durationMinutes,
      priceTypeSnapshot: 'FIXED',
      priceAmountSnapshot: 1_200,
      currencySnapshot: 'TWD',
    },
  });
  return {
    tenantId: tenant.id,
    appointmentId: appointment.id,
    consumerUserId: consumer.id,
    startAt,
  };
}

function createOutboxEvent(
  fixture: Fixture,
  eventType: string,
  payloadJson: Record<string, string>,
  options: { readonly availableAt?: Date; readonly createdAt?: Date } = {},
) {
  const createdAt = options.createdAt ?? new Date(Date.now() - 1_000);
  return prisma.outboxEvent.create({
    data: {
      tenantId: fixture.tenantId,
      aggregateType: 'appointment',
      aggregateId: fixture.appointmentId,
      eventType,
      payloadJson,
      dedupeKey: `${eventType}:${fixture.appointmentId}:${randomUUID()}`,
      availableAt: options.availableAt ?? createdAt,
      createdAt,
      updatedAt: createdAt,
    },
  });
}

function job(appointmentId: string, templateKey: string) {
  return prisma.notificationJob.findFirstOrThrow({
    where: { appointmentId, templateKey },
  });
}

async function createFollowingRecipient(
  userId: string,
  status: 'FOLLOWING' | 'BLOCKED' = 'FOLLOWING',
): Promise<void> {
  const providerSubject = `U${randomUUID().replaceAll('-', '')}`;
  await prisma.userIdentity.create({
    data: { userId, provider: 'LINE', providerSubject },
  });
  await prisma.lineMessagingRecipient.create({
    data: {
      providerSubject,
      userId,
      status,
      observedAt: new Date(),
      observedWebhookEventId: randomUUID(),
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
    await prisma.notificationDelivery.deleteMany({
      where: { notificationJob: { tenantId: { in: tenantIds } } },
    });
    await prisma.notificationJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointmentItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.bookingHold.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.staffProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.lineMessagingRecipient.deleteMany({
    where: { user: { displayName: { startsWith: 'Notification repository consumer ' } } },
  });
  await prisma.user.deleteMany({
    where: { displayName: { startsWith: 'Notification repository consumer ' } },
  });
  await prisma.plan.deleteMany({ where: { code: { startsWith: 'NOTIFICATION_REPOSITORY_' } } });
  await prisma.notificationProviderMonthlyUsage.deleteMany();
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
