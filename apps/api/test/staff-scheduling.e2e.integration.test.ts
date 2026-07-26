import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type {
  CreateStaffRequest,
  MerchantOnboardingRequest,
  ProblemDetails,
  StaffAvailabilityResponse,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/platform/http/request-context.middleware';

class SchedulingIdentityTokenVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();

  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    if (userId === undefined) {
      return Promise.reject(
        new IdentityTokenVerificationError('invalid_token', 'Synthetic token rejected.'),
      );
    }
    return Promise.resolve({ userId });
  }
}

describe('staff scheduling', () => {
  const prisma = getPrismaClient();
  const verifier = new SchedulingIdentityTokenVerifier();
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let ownerId: string;
  let memberId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    const [owner, member] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Scheduling Owner' } }),
      prisma.user.create({ data: { displayName: 'Scheduling Member' } }),
    ]);
    ownerId = owner.id;
    memberId = member.id;
    verifier.identities.clear();
    verifier.identities.set('owner-token', ownerId);
    verifier.identities.set('member-token', memberId);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrismaClient();
  });

  it('lets a MANAGER create and list staff without logging profile content', async () => {
    const setup = await setupStudio('manager-studio', 'owner-token', '0');
    await prisma.membership.create({
      data: { tenantId: setup.tenantId, userId: memberId, role: 'MANAGER', status: 'ACTIVE' },
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = await createStaff('member-token', setup, '主要美甲師', 201);
    const logs = writeSpy.mock.calls.flat().join('');
    writeSpy.mockRestore();

    expect(response.body as unknown as StaffAvailabilityResponse).toMatchObject({
      tenantId: setup.tenantId,
      timezone: 'Asia/Taipei',
      entitlement: { code: 'MAX_STAFF', limit: 1, used: 1, remaining: 0 },
      staff: [{ displayName: '主要美甲師', serviceIds: [setup.serviceId] }],
    });
    expect(logs).not.toContain('主要美甲師');
    await expect(
      prisma.auditLog.count({ where: { tenantId: setup.tenantId, action: 'staff.created' } }),
    ).resolves.toBe(1);
    await request(httpServer)
      .get(`/v1/tenants/${setup.tenantId}/staff`)
      .set('authorization', 'Bearer member-token')
      .expect(200);
  });

  it('lets STAFF read but denies scheduling writes with an authorization audit', async () => {
    const setup = await setupStudio('staff-reader', 'owner-token', '1');
    await prisma.membership.create({
      data: { tenantId: setup.tenantId, userId: memberId, role: 'STAFF', status: 'ACTIVE' },
    });
    await request(httpServer)
      .get(`/v1/tenants/${setup.tenantId}/staff`)
      .set('authorization', 'Bearer member-token')
      .expect(200);
    const denied = await createStaff('member-token', setup, '不可新增', 403);
    expect(denied.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });
    await expect(
      prisma.auditLog.count({
        where: { tenantId: setup.tenantId, action: 'authorization.denied' },
      }),
    ).resolves.toBe(1);
  });

  it('enforces MAX_STAFF and same-tenant active service assignments', async () => {
    const local = await setupStudio('local-studio', 'owner-token', '2');
    const foreign = await setupStudio('foreign-studio', 'member-token', '3');
    const invalid = await request(httpServer)
      .post(`/v1/tenants/${local.tenantId}/staff`)
      .set('authorization', 'Bearer owner-token')
      .send(staffBody(local, '跨店人員', '30000000-0000-4000-8000-000000000032', foreign.serviceId))
      .expect(409);
    expect(invalid.body as unknown as ProblemDetails).toMatchObject({
      code: 'staff_service_assignment_invalid',
    });

    await createStaff('owner-token', local, '第一位人員', 201);
    const limited = await request(httpServer)
      .post(`/v1/tenants/${local.tenantId}/staff`)
      .set('authorization', 'Bearer owner-token')
      .send(staffBody(local, '第二位人員', '30000000-0000-4000-8000-000000000042'))
      .expect(403);
    expect(limited.body as unknown as ProblemDetails).toMatchObject({
      code: 'staff_limit_reached',
    });
  });

  it('replaces weekly rules atomically and stores offset exceptions in UTC', async () => {
    const setup = await setupStudio('calendar-studio', 'owner-token', '4');
    const created = await createStaff('owner-token', setup, '排班人員', 201);
    const staffId = (created.body as unknown as StaffAvailabilityResponse).staff[0]?.id;
    if (staffId === undefined) throw new Error('Expected created staff ID.');

    const schedule = await request(httpServer)
      .put(`/v1/tenants/${setup.tenantId}/staff/${staffId}/weekly-schedule`)
      .set('authorization', 'Bearer owner-token')
      .send({
        rules: [
          {
            id: '40000000-0000-4000-8000-000000000041',
            weekday: 1,
            startTime: '10:00',
            endTime: '13:00',
            validFrom: '2026-07-21',
            validUntil: null,
          },
          {
            id: '40000000-0000-4000-8000-000000000042',
            weekday: 1,
            startTime: '14:00',
            endTime: '18:00',
            validFrom: '2026-07-21',
            validUntil: null,
          },
        ],
      })
      .expect(200);
    expect(
      (schedule.body as unknown as StaffAvailabilityResponse).staff[0]?.weeklyRules,
    ).toHaveLength(2);

    await request(httpServer)
      .put(`/v1/tenants/${setup.tenantId}/staff/${staffId}/weekly-schedule`)
      .set('authorization', 'Bearer owner-token')
      .send({
        rules: [
          {
            id: '40000000-0000-4000-8000-000000000043',
            weekday: 1,
            startTime: '10:00',
            endTime: '15:00',
            validFrom: '2026-07-21',
            validUntil: null,
          },
          {
            id: '40000000-0000-4000-8000-000000000044',
            weekday: 1,
            startTime: '14:00',
            endTime: '17:00',
            validFrom: '2026-07-21',
            validUntil: null,
          },
        ],
      })
      .expect(400);
    await expect(prisma.weeklyAvailabilityRule.count({ where: { staffId } })).resolves.toBe(2);

    const exceptionId = '50000000-0000-4000-8000-000000000041';
    const exception = await request(httpServer)
      .post(`/v1/tenants/${setup.tenantId}/staff/${staffId}/exceptions`)
      .set('authorization', 'Bearer owner-token')
      .send({
        id: exceptionId,
        type: 'TIME_OFF',
        startAt: '2026-08-01T10:00:00+08:00',
        endAt: '2026-08-01T12:00:00+08:00',
        reason: '教育訓練',
      })
      .expect(201);
    expect(
      (exception.body as unknown as StaffAvailabilityResponse).staff[0]?.exceptions[0],
    ).toMatchObject({
      startAt: '2026-08-01T02:00:00.000Z',
      endAt: '2026-08-01T04:00:00.000Z',
    });
    const overlap = await request(httpServer)
      .post(`/v1/tenants/${setup.tenantId}/staff/${staffId}/exceptions`)
      .set('authorization', 'Bearer owner-token')
      .send({
        id: '50000000-0000-4000-8000-000000000042',
        type: 'BLOCK',
        startAt: '2026-08-01T11:00:00+08:00',
        endAt: '2026-08-01T13:00:00+08:00',
      })
      .expect(409);
    expect(overlap.body as unknown as ProblemDetails).toMatchObject({
      code: 'availability_exception_overlap',
    });
    await request(httpServer)
      .put(`/v1/tenants/${setup.tenantId}/staff/${staffId}/exceptions/${exceptionId}/status`)
      .set('authorization', 'Bearer owner-token')
      .send({ status: 'CANCELLED' })
      .expect(200);
    await expect(
      prisma.availabilityException.findUniqueOrThrow({ where: { id: exceptionId } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', reason: '教育訓練' });
  });

  it('protects the last active staff and cannot expose inactive staff to booking', async () => {
    const setup = await setupStudio('staff-state', 'owner-token', '5');
    const created = await createStaff('owner-token', setup, '唯一人員', 201);
    const activeId = (created.body as unknown as StaffAvailabilityResponse).staff[0]?.id;
    if (activeId === undefined) throw new Error('Expected active staff ID.');
    const inactiveId = '30000000-0000-4000-8000-000000000095';
    await prisma.staffProfile.create({
      data: {
        id: inactiveId,
        tenantId: setup.tenantId,
        locationId: setup.locationId,
        displayName: '停用人員',
        status: 'INACTIVE',
        bookingEnabled: false,
        sortOrder: 1,
      },
    });
    await prisma.staffService.create({
      data: { tenantId: setup.tenantId, staffId: inactiveId, serviceId: setup.serviceId },
    });

    const inactiveBooking = await request(httpServer)
      .patch(`/v1/tenants/${setup.tenantId}/staff/${inactiveId}`)
      .set('authorization', 'Bearer owner-token')
      .send({ bookingEnabled: true })
      .expect(409);
    expect(inactiveBooking.body as unknown as ProblemDetails).toMatchObject({
      code: 'inactive_staff_booking',
    });
    const lastActive = await request(httpServer)
      .put(`/v1/tenants/${setup.tenantId}/staff/${activeId}/status`)
      .set('authorization', 'Bearer owner-token')
      .send({ status: 'INACTIVE' })
      .expect(409);
    expect(lastActive.body as unknown as ProblemDetails).toMatchObject({
      code: 'last_active_staff',
    });

    const reordered = await request(httpServer)
      .put(`/v1/tenants/${setup.tenantId}/staff/order`)
      .set('authorization', 'Bearer owner-token')
      .send({ staffIds: [inactiveId, activeId] })
      .expect(200);
    expect(
      (reordered.body as unknown as StaffAvailabilityResponse).staff.map(({ id }) => id),
    ).toEqual([inactiveId, activeId]);
  });

  async function setupStudio(slug: string, token: string, suffix: string) {
    const tenant = await request(httpServer)
      .post('/v1/tenants')
      .set('authorization', `Bearer ${token}`)
      .send({ name: slug, slug })
      .expect(201);
    const tenantId = (tenant.body as unknown as { id: string }).id;
    const body = onboardingBody(suffix);
    await request(httpServer)
      .put(`/v1/tenants/${tenantId}/merchant-onboarding`)
      .set('authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);
    return { tenantId, locationId: body.location.id, serviceId: body.service.id, suffix };
  }

  function createStaff(
    token: string,
    setup: Awaited<ReturnType<typeof setupStudio>>,
    name: string,
    status: number,
  ) {
    return request(httpServer)
      .post(`/v1/tenants/${setup.tenantId}/staff`)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', 'staff-create-test')
      .send(staffBody(setup, name, `30000000-0000-4000-8000-00000000001${setup.suffix}`))
      .expect(status);
  }
});

function staffBody(
  setup: { locationId: string; serviceId: string },
  displayName: string,
  id: string,
  serviceId = setup.serviceId,
): CreateStaffRequest {
  return {
    id,
    locationId: setup.locationId,
    displayName,
    bookingEnabled: true,
    serviceIds: [serviceId],
  };
}

function onboardingBody(suffix: string): MerchantOnboardingRequest {
  return {
    profile: { category: 'NAIL' },
    location: {
      id: `10000000-0000-4000-8000-00000000001${suffix}`,
      name: '主要工作室',
      addressText: '台北市測試路 10 號',
      city: '台北市',
      district: '中山區',
      isPublicAddress: false,
    },
    service: {
      id: `20000000-0000-4000-8000-00000000001${suffix}`,
      name: '單色凝膠',
      durationMinutes: 90,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
      price: { type: 'FIXED', amount: 1200 },
      bookingEnabled: true,
    },
  };
}
