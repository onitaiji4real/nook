import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaAppointmentViewRepository } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaAppointmentViewRepository(prisma);
const asOf = new Date('2026-07-24T00:00:00.000Z');

describe('appointment view repository', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('partitions consumer appointments and paginates with a stable time/id cursor', async () => {
    const fixture = await createFixture('consumer-page');
    const firstId = '10000000-0000-4000-8000-000000000001';
    const secondId = '10000000-0000-4000-8000-000000000002';
    await createAppointment(fixture, {
      id: secondId,
      key: 'second',
      startAt: new Date('2026-07-25T03:00:00.000Z'),
    });
    await createAppointment(fixture, {
      id: firstId,
      key: 'first',
      startAt: new Date('2026-07-25T03:00:00.000Z'),
    });
    await createAppointment(fixture, {
      key: 'past-completed',
      status: 'COMPLETED',
      startAt: new Date('2026-07-23T03:00:00.000Z'),
    });

    const first = await repository.listForConsumer({
      consumerUserId: fixture.consumerId,
      view: 'upcoming',
      limit: 1,
      asOf,
    });
    expect(first.items.map(({ id }) => id)).toEqual([firstId]);
    expect(first.next).toEqual({ startAt: new Date('2026-07-25T03:00:00.000Z'), id: firstId });
    const second = await repository.listForConsumer({
      consumerUserId: fixture.consumerId,
      view: 'upcoming',
      limit: 1,
      asOf: first.asOf,
      after: first.next ?? undefined,
    });
    expect(second.items.map(({ id }) => id)).toEqual([secondId]);
    const past = await repository.listForConsumer({
      consumerUserId: fixture.consumerId,
      view: 'past',
      limit: 10,
      asOf,
    });
    expect(past.items).toHaveLength(1);
    expect(past.items[0]?.status).toBe('COMPLETED');

    const foreign = await prisma.user.create({ data: { displayName: 'Appointment view foreign' } });
    await expect(
      repository.listForConsumer({
        consumerUserId: foreign.id,
        view: 'upcoming',
        limit: 10,
        asOf,
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it('returns owner detail from immutable snapshots without leaking it to another consumer', async () => {
    const fixture = await createFixture('consumer-detail');
    const appointment = await createAppointment(fixture, {
      key: 'detail',
      startAt: new Date('2026-07-25T03:00:00.000Z'),
    });
    await prisma.staffProfile.update({
      where: { id: fixture.staffId },
      data: { displayName: 'Current renamed staff' },
    });
    const detail = await repository.findForConsumer({
      consumerUserId: fixture.consumerId,
      appointmentId: appointment.id,
    });
    expect(detail).toMatchObject({
      staff: { displayName: 'Snapshot Yun' },
      location: { addressText: '台北市測試路 1 號' },
      policies: { bookingPolicy: '完全預約制' },
      history: [{ fromStatus: null, toStatus: 'CONFIRMED' }],
    });
    const foreign = await prisma.user.create({
      data: { displayName: 'Appointment view outsider' },
    });
    await expect(
      repository.findForConsumer({
        consumerUserId: foreign.id,
        appointmentId: appointment.id,
      }),
    ).resolves.toBeNull();
  });

  it('uses tenant/staff scope and half-open overlap for merchant calendar reads', async () => {
    const fixture = await createFixture('merchant-range');
    const overlapping = await createAppointment(fixture, {
      key: 'overlap',
      startAt: new Date('2026-07-24T23:30:00.000Z'),
      durationMinutes: 90,
    });
    await createAppointment(fixture, {
      key: 'outside',
      startAt: new Date('2026-07-26T03:00:00.000Z'),
    });
    const page = await repository.listForTenant({
      tenantId: fixture.tenantId,
      from: new Date('2026-07-25T00:00:00.000Z'),
      to: new Date('2026-07-25T08:00:00.000Z'),
      staffId: fixture.staffId,
      limit: 10,
      asOf,
    });
    expect(page.calendarTimezone).toBe('Asia/Taipei');
    expect(page.items.map(({ id }) => id)).toEqual([overlapping.id]);
    expect(page.items[0]).toMatchObject({ consumerDisplayName: 'Appointment view merchant-range' });

    const other = await createFixture('other-tenant');
    await expect(
      repository.findForTenant({
        tenantId: other.tenantId,
        appointmentId: overlapping.id,
      }),
    ).resolves.toBeNull();
  });

  it('resolves exactly one active staff profile and ignores bookingEnabled', async () => {
    const fixture = await createFixture('staff-scope', true);
    await expect(
      repository.resolveActiveStaffId({ tenantId: fixture.tenantId, userId: fixture.staffUserId }),
    ).resolves.toBe(fixture.staffId);
    await prisma.staffProfile.create({
      data: {
        tenantId: fixture.tenantId,
        userId: fixture.staffUserId,
        locationId: fixture.locationId,
        displayName: 'Second linked staff',
        status: 'ACTIVE',
      },
    });
    await expect(
      repository.resolveActiveStaffId({ tenantId: fixture.tenantId, userId: fixture.staffUserId }),
    ).resolves.toBeNull();
  });
});

interface Fixture {
  readonly tenantId: string;
  readonly locationId: string;
  readonly serviceId: string;
  readonly staffId: string;
  readonly staffUserId: string;
  readonly consumerId: string;
}

async function createFixture(suffix: string, linkStaff = false): Promise<Fixture> {
  const consumer = await prisma.user.create({
    data: { displayName: `Appointment view ${suffix}` },
  });
  const staffUser = await prisma.user.create({
    data: { displayName: `Appointment view staff ${suffix}` },
  });
  const tenant = await prisma.tenant.create({
    data: { name: `Appointment view ${suffix}`, slug: `appointment-view-${suffix}` },
  });
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: '主要工作室',
      addressText: '台北市測試路 1 號',
      postalCode: '106',
      city: '台北市',
      district: '大安區',
      timezone: 'Asia/Taipei',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: '凝膠服務',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'Current Yun',
      bookingEnabled: false,
      ...(linkStaff ? { userId: staffUser.id } : {}),
    },
  });
  return {
    tenantId: tenant.id,
    locationId: location.id,
    serviceId: service.id,
    staffId: staff.id,
    staffUserId: staffUser.id,
    consumerId: consumer.id,
  };
}

async function createAppointment(
  fixture: Fixture,
  input: {
    readonly id?: string | undefined;
    readonly key: string;
    readonly startAt: Date;
    readonly durationMinutes?: number | undefined;
    readonly status?: AppointmentStatus | undefined;
  },
) {
  const durationMinutes = input.durationMinutes ?? 60;
  const endAt = new Date(input.startAt.getTime() + durationMinutes * 60_000);
  const hold = await prisma.bookingHold.create({
    data: {
      tenantId: fixture.tenantId,
      locationId: fixture.locationId,
      serviceId: fixture.serviceId,
      staffId: fixture.staffId,
      consumerUserId: fixture.consumerId,
      status: 'CONSUMED',
      startAt: input.startAt,
      endAt,
      serviceNameSnapshot: 'Snapshot 凝膠服務',
      staffDisplayNameSnapshot: 'Snapshot Yun',
      durationMinutesSnapshot: durationMinutes,
      priceTypeSnapshot: 'FIXED',
      priceAmountSnapshot: 1200,
      priceMinSnapshot: null,
      priceMaxSnapshot: null,
      currencySnapshot: 'TWD',
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '提前24小時',
      policyVersion: `v1:${'a'.repeat(64)}`,
      locationNameSnapshot: '主要工作室',
      addressTextSnapshot: '台北市測試路 1 號',
      postalCodeSnapshot: '106',
      citySnapshot: '台北市',
      districtSnapshot: '大安區',
      locationTimezoneSnapshot: 'Asia/Taipei',
      expiresAt: new Date(input.startAt.getTime() + 10 * 60_000),
      idempotencyKeyHash: hash(`${input.key}:hold`),
      requestFingerprint: hash(`${input.key}:request`),
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    },
  });
  const status = input.status ?? 'CONFIRMED';
  const appointment = await prisma.appointment.create({
    data: {
      ...(input.id === undefined ? {} : { id: input.id }),
      tenantId: fixture.tenantId,
      locationId: fixture.locationId,
      staffId: fixture.staffId,
      consumerUserId: fixture.consumerId,
      holdId: hold.id,
      status,
      source: 'MERCHANT_LINK',
      pricingStatus: 'EXACT',
      paymentStatus: 'NOT_REQUIRED',
      startAt: input.startAt,
      endAt,
      confirmedAt: new Date('2026-07-22T00:00:00.000Z'),
      usageTimezoneSnapshot: 'Asia/Taipei',
      usageMonth: '2026-07',
      locationTimezoneSnapshot: 'Asia/Taipei',
      currency: 'TWD',
      subtotalAmount: 1200,
      depositAmount: 0,
      totalAmount: 1200,
      bookingPolicySnapshot: '完全預約制',
      cancellationPolicySnapshot: '提前24小時',
      policyVersion: `v1:${'a'.repeat(64)}`,
      policiesAcceptedAt: new Date('2026-07-22T00:00:00.000Z'),
      locationNameSnapshot: '主要工作室',
      addressTextSnapshot: '台北市測試路 1 號',
      postalCodeSnapshot: '106',
      citySnapshot: '台北市',
      districtSnapshot: '大安區',
    },
  });
  await prisma.appointmentItem.create({
    data: {
      tenantId: fixture.tenantId,
      appointmentId: appointment.id,
      serviceId: fixture.serviceId,
      serviceNameSnapshot: 'Snapshot 凝膠服務',
      durationMinutesSnapshot: durationMinutes,
      priceTypeSnapshot: 'FIXED',
      priceAmountSnapshot: 1200,
      priceMinSnapshot: null,
      priceMaxSnapshot: null,
      currencySnapshot: 'TWD',
    },
  });
  await prisma.appointmentStatusHistory.create({
    data: {
      tenantId: fixture.tenantId,
      appointmentId: appointment.id,
      fromStatus: null,
      toStatus: 'CONFIRMED',
      actorUserId: fixture.consumerId,
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
    },
  });
  if (status !== 'CONFIRMED') {
    await prisma.appointmentStatusHistory.create({
      data: {
        tenantId: fixture.tenantId,
        appointmentId: appointment.id,
        fromStatus: 'CONFIRMED',
        toStatus: status,
        actorUserId: fixture.consumerId,
        createdAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    });
  }
  return appointment;
}

async function clearFixtures(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: 'appointment-view-' } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.appointmentConfirmationKey.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.bookingOccupancy.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointmentItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.bookingHold.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.staffService.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.staffProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({
    where: { displayName: { startsWith: 'Appointment view' } },
  });
}

function hash(value: string): string {
  return createHash('sha256').update(`${value}:${randomUUID()}`, 'utf8').digest('hex');
}
