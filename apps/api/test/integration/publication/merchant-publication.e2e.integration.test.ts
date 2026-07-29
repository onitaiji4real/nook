import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { RuntimeConfig } from '@nook/config';
import type {
  AppointmentResponse,
  AppointmentTransitionResponse,
  BookingHoldResponse,
  BookingPolicyResponse,
  ConsumerAppointmentDetail,
  ConsumerAppointmentListResponse,
  MerchantAppointmentDetail,
  MerchantAppointmentListResponse,
  ProblemDetails,
  PublicAvailabilityResponse,
  PublicMerchantResponse,
} from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../src/app.module';
import type { MarketplaceMediaSigner } from '../../../src/modules/publication/marketplace-media-signer';
import {
  AVAILABILITY_CLOCK,
  MARKETPLACE_MEDIA_SIGNER,
} from '../../../src/modules/publication/publication.tokens';
import { RUNTIME_CONFIG } from '../../../src/platform/config/runtime-config.token';
import { requestContextMiddleware } from '../../../src/platform/http/request-context.middleware';

class TestIdentityVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();
  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    return userId === undefined
      ? Promise.reject(new IdentityTokenVerificationError('invalid_token', 'Rejected.'))
      : Promise.resolve({ userId });
  }
}

class TestMediaSigner implements MarketplaceMediaSigner {
  sign(input: { readonly objectKey: string }): Promise<string> {
    return Promise.resolve(
      `https://media.example.test/read/${encodeURIComponent(input.objectKey)}`,
    );
  }
}

const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  databaseUrl: 'postgresql://synthetic',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

const fixedAvailabilityNow = new Date('2026-07-22T00:00:00.000Z');
const dayMilliseconds = 24 * 60 * 60 * 1_000;
let availabilityNow = fixedAvailabilityNow;

describe('merchant publication API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantId: string;
  let ownerId: string;
  let viewerId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(config)
      .overrideProvider(MARKETPLACE_MEDIA_SIGNER)
      .useValue(new TestMediaSigner())
      .overrideProvider(AVAILABILITY_CLOCK)
      .useValue(() => new Date(availabilityNow))
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    availabilityNow = fixedAvailabilityNow;
    await prisma.appointmentTransitionKey.deleteMany();
    await prisma.appointmentConfirmationKey.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.appointmentStatusHistory.deleteMany();
    await prisma.appointmentItem.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.bookingOccupancy.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.bookingHold.deleteMany();
    await prisma.bookingHoldRateAttempt.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
    const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const [owner, viewer] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Publication Owner' } }),
      prisma.user.create({ data: { displayName: 'Publication Viewer' } }),
    ]);
    const tenant = await prisma.tenant.create({
      data: {
        name: '留白製甲所',
        slug: 'public-api-studio',
        planId: plan.id,
        bookingPolicy: { create: { minimumLeadMinutes: 0 } },
      },
    });
    ownerId = owner.id;
    viewerId = viewer.id;
    tenantId = tenant.id;
    await prisma.membership.createMany({
      data: [
        { tenantId, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
        { tenantId, userId: viewerId, role: 'VIEWER', status: 'ACTIVE' },
      ],
    });
    verifier.identities.clear();
    verifier.identities.set('owner-token', ownerId);
    verifier.identities.set('viewer-token', viewerId);
    await createCompleteAggregate(tenantId, ownerId);
  });

  afterAll(async () => {
    await clearAppointmentAggregates();
    if (app !== undefined) await app.close();
    await disconnectPrismaClient();
  });

  it('lets an owner publish and exposes a privacy-filtered public read without authentication', async () => {
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const response = await request(server)
      .get('/v1/marketplace/merchants/public-api-studio')
      .expect(200);
    const merchant = response.body as unknown as PublicMerchantResponse;
    expect(merchant.location).toEqual({
      disclosure: 'DISTRICT_ONLY',
      name: null,
      address: null,
      postalCode: null,
      city: '台北市',
      district: '大安區',
      timezone: 'Asia/Taipei',
    });
    expect(merchant.portfolio[0]?.imageUrl).toMatch(/^https:\/\/media\.example\.test\/read\//);
    expect(response.text).not.toMatch(
      /0900000000|仁愛路四段測試門牌|private-test-bucket|object_key|tenantId|userId/,
    );
  });

  it('allows a viewer to read readiness but denies writes and records authorization', async () => {
    await request(server)
      .get(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer viewer-token')
      .expect(200);
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer viewer-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(403);
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'authorization.denied' } }),
    ).resolves.toBe(1);
  });

  it('does not publish or read a different tenant through guessed identifiers', async () => {
    const plan = await prisma.plan.findFirstOrThrow({ where: { isDefault: true } });
    const foreign = await prisma.tenant.create({
      data: { name: 'Foreign', slug: 'foreign-publication', planId: plan.id },
    });
    await request(server)
      .get(`/v1/tenants/${foreign.id}/publication`)
      .set('authorization', 'Bearer owner-token')
      .expect(403);
    await request(server).get('/v1/marketplace/merchants/foreign-publication').expect(404);
  });

  it('returns bounded candidate slots without exposing private scheduling data', async () => {
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const service = await prisma.service.findFirstOrThrow({ where: { tenantId } });
    const response = await request(server)
      .get('/v1/marketplace/merchants/public-api-studio/availability')
      .query({ serviceId: service.id, date: '2026-07-22', days: 1 })
      .expect(200);
    const availability = response.body as unknown as PublicAvailabilityResponse;

    expect(availability).toMatchObject({
      timezone: 'Asia/Taipei',
      generatedAt: '2026-07-22T00:00:00.000Z',
      reservation: false,
      service: { id: service.id, name: '凝膠設計', durationMinutes: 90 },
    });
    expect(availability.slots[0]?.startAt).toBe('2026-07-22T03:00:00.000Z');
    expect(availability.slots[0]?.eligibleStaffIds).toHaveLength(1);
    expect(response.text).not.toMatch(/仁愛路|0900000000|reason|buffer|occupied|tenantId/);
  });

  it('fails closed for invalid scope, date windows, and a missing booking policy', async () => {
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const service = await prisma.service.findFirstOrThrow({ where: { tenantId } });
    const base = `/v1/marketplace/merchants/public-api-studio/availability`;

    await request(server)
      .get(base)
      .query({ serviceId: '00000000-0000-4000-8000-000000000099', date: '2026-07-22' })
      .expect(404);
    await request(server)
      .get(base)
      .query({
        serviceId: service.id,
        staffId: '00000000-0000-4000-8000-000000000099',
        date: '2026-07-22',
      })
      .expect(404);
    await request(server)
      .get(base)
      .query({ serviceId: service.id, date: '2026-07-22', days: 8 })
      .expect(400);
    await request(server)
      .get(base)
      .query({ serviceId: service.id, date: '2026-07-21' })
      .expect(400);

    await prisma.bookingPolicy.delete({ where: { tenantId } });
    await request(server)
      .get(base)
      .query({ serviceId: service.id, date: '2026-07-22' })
      .expect(503);
  });

  it('creates, replays, privacy-scopes, and releases an authenticated booking hold', async () => {
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const service = await prisma.service.findFirstOrThrow({ where: { tenantId } });
    const url = '/v1/marketplace/merchants/public-api-studio/booking-holds';
    const key = '30000000-0000-4000-8000-000000000001';
    const body = { serviceId: service.id, startAt: '2026-07-29T08:00:00.000Z' };

    await request(server).post(url).set('idempotency-key', key).send(body).expect(401);
    await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .send(body)
      .expect(400);
    await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', 'not-a-uuid')
      .send(body)
      .expect(400);
    expect(await prisma.bookingHoldRateAttempt.count({ where: { consumerUserId: ownerId } })).toBe(
      0,
    );
    await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', key)
      .send({ ...body, consumerUserId: viewerId })
      .expect(400);
    expect(await prisma.bookingHoldRateAttempt.count({ where: { consumerUserId: ownerId } })).toBe(
      1,
    );

    const createdResponse = await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    const created = createdResponse.body as unknown as BookingHoldResponse;
    expect(created).toMatchObject({
      bookingState: 'HELD',
      status: 'ACTIVE',
      appointmentCreated: false,
      timezone: 'Asia/Taipei',
      service: { id: service.id, name: '凝膠設計', durationMinutes: 90 },
      staff: { displayName: 'Yun' },
    });
    expect(createdResponse.text).not.toMatch(
      /tenantId|consumerUserId|buffer|occupied|仁愛路|0900000000/,
    );
    const availabilityUrl = '/v1/marketplace/merchants/public-api-studio/availability';
    const heldAvailability = await request(server)
      .get(availabilityUrl)
      .query({ serviceId: service.id, date: '2026-07-29' })
      .expect(200);
    expect(
      (heldAvailability.body as unknown as PublicAvailabilityResponse).slots.some(
        ({ startAt }) => startAt === body.startAt,
      ),
    ).toBe(false);
    const conflicting = await request(server)
      .post(url)
      .set('authorization', 'Bearer viewer-token')
      .set('idempotency-key', '30000000-0000-4000-8000-000000000002')
      .send(body)
      .expect(409);
    expect((conflicting.body as unknown as ProblemDetails).code).toBe('slot_no_longer_available');

    const replay = await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toMatchObject({ id: created.id, expiresAt: created.expiresAt });
    await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', key)
      .send({ ...body, startAt: '2026-07-22T09:00:00.000Z' })
      .expect(409);

    const hidden = await request(server)
      .delete(`/v1/booking-holds/${created.id}`)
      .set('authorization', 'Bearer viewer-token')
      .expect(404);
    expect((hidden.body as unknown as ProblemDetails).code).toBe('booking_hold_not_found');
    await request(server)
      .delete(`/v1/booking-holds/${created.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(204);
    await request(server)
      .delete(`/v1/booking-holds/${created.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(204);
    const terminalReplay = await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', key)
      .send(body)
      .expect(201);
    expect(terminalReplay.body).toMatchObject({
      id: created.id,
      status: 'RELEASED',
      expiresAt: created.expiresAt,
    });
    const releasedAvailability = await request(server)
      .get(availabilityUrl)
      .query({ serviceId: service.id, date: '2026-07-29' })
      .expect(200);
    expect(
      (releasedAvailability.body as unknown as PublicAvailabilityResponse).slots.some(
        ({ startAt }) => startAt === body.startAt,
      ),
    ).toBe(true);
  });

  it('rejects inactive consumers and rate-limits distinct keys before hold validation', async () => {
    await prisma.user.update({ where: { id: viewerId }, data: { status: 'SUSPENDED' } });
    await request(server)
      .post('/v1/marketplace/merchants/public-api-studio/booking-holds')
      .set('authorization', 'Bearer viewer-token')
      .set('idempotency-key', '30000000-0000-4000-8000-000000000001')
      .send({
        serviceId: '00000000-0000-4000-8000-000000000099',
        startAt: '2026-07-22T03:00:00.000Z',
      })
      .expect(403);

    const url = '/v1/marketplace/merchants/public-api-studio/booking-holds';
    for (let index = 1; index <= 10; index += 1) {
      await request(server)
        .post(url)
        .set('authorization', 'Bearer owner-token')
        .set('idempotency-key', `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
        .send({
          serviceId: '00000000-0000-4000-8000-000000000099',
          startAt: '2026-07-22T03:00:00.000Z',
        })
        .expect(404);
    }
    const limited = await request(server)
      .post(url)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '30000000-0000-4000-8000-000000000011')
      .send({
        serviceId: '00000000-0000-4000-8000-000000000099',
        startAt: '2026-07-22T03:00:00.000Z',
      })
      .expect(429);
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('confirms an owned hold, reveals its snapshotted address, and replays without duplicate effects', async () => {
    const lifecycleStartAt = prepareLifecycleWindow();
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const service = await prisma.service.findFirstOrThrow({ where: { tenantId } });
    const holdResponse = await request(server)
      .post('/v1/marketplace/merchants/public-api-studio/booking-holds')
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '31000000-0000-4000-8000-000000000001')
      .send({ serviceId: service.id, startAt: lifecycleStartAt.toISOString() })
      .expect(201);
    const hold = holdResponse.body as unknown as BookingHoldResponse;
    expect(hold.policies).toMatchObject({
      bookingPolicy: '請準時抵達',
      cancellationPolicy: '二十四小時前取消',
      consumerCancelLeadMinutes: 1_440,
      consumerRescheduleLeadMinutes: 1_440,
    });
    expect(hold.policies.version).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(holdResponse.text).not.toContain('仁愛路四段測試門牌');

    const confirmationBody = {
      holdId: hold.id,
      policiesAccepted: true,
      policyVersion: hold.policies.version,
    };
    await request(server)
      .post('/v1/appointments')
      .set('idempotency-key', '32000000-0000-4000-8000-000000000001')
      .send(confirmationBody)
      .expect(401);
    await request(server)
      .post('/v1/appointments')
      .set('authorization', 'Bearer viewer-token')
      .set('idempotency-key', '32000000-0000-4000-8000-000000000002')
      .send(confirmationBody)
      .expect(404);
    const createdResponse = await request(server)
      .post('/v1/appointments')
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '32000000-0000-4000-8000-000000000001')
      .send(confirmationBody)
      .expect(201);
    const created = createdResponse.body as unknown as AppointmentResponse;
    expect(created).toMatchObject({
      appointmentCreated: true,
      status: 'CONFIRMED',
      paymentStatus: 'NOT_REQUIRED',
      depositAmount: 0,
      location: { addressText: '仁愛路四段測試門牌', postalCode: '106' },
      policies: { version: hold.policies.version },
    });
    expect(createdResponse.text).not.toMatch(/tenantId|consumerUserId|occupancy|entitlement/);

    const replay = await request(server)
      .post('/v1/appointments')
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '32000000-0000-4000-8000-000000000003')
      .send(confirmationBody)
      .expect(201);
    expect(replay.body).toMatchObject({ id: created.id, confirmedAt: created.confirmedAt });
    await expect(prisma.appointment.count({ where: { holdId: hold.id } })).resolves.toBe(1);
    await expect(
      prisma.appointmentStatusHistory.count({ where: { appointmentId: created.id } }),
    ).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateId: created.id } })).resolves.toBe(1);

    const consumerListResponse = await request(server)
      .get('/v1/me/appointments?view=upcoming')
      .set('authorization', 'Bearer owner-token')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const consumerList = consumerListResponse.body as unknown as ConsumerAppointmentListResponse;
    expect(consumerList.items).toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'CONFIRMED',
        location: { name: '私人工作室', city: '台北市', district: '大安區' },
      }),
    ]);
    expect(consumerListResponse.text).not.toMatch(
      /addressText|bookingPolicy|source|consumerUserId|holdId/,
    );
    const consumerDetailResponse = await request(server)
      .get(`/v1/me/appointments/${created.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const consumerDetail = consumerDetailResponse.body as unknown as ConsumerAppointmentDetail;
    expect(consumerDetail).toMatchObject({
      id: created.id,
      location: { addressText: '仁愛路四段測試門牌' },
      policies: { bookingPolicy: '請準時抵達' },
      history: [{ fromStatus: null, toStatus: 'CONFIRMED' }],
    });
    expect(consumerDetailResponse.text).not.toMatch(/actorUserId|reasonText|source|consumerUserId/);
    await request(server)
      .get(`/v1/me/appointments/${created.id}`)
      .set('authorization', 'Bearer viewer-token')
      .expect(404);

    const calendarFrom = new Date(lifecycleStartAt);
    calendarFrom.setUTCHours(0, 0, 0, 0);
    const calendarTo = new Date(calendarFrom.getTime() + dayMilliseconds);
    const calendarQuery = new URLSearchParams({
      from: calendarFrom.toISOString(),
      to: calendarTo.toISOString(),
    }).toString();
    const merchantListResponse = await request(server)
      .get(`/v1/tenants/${tenantId}/appointments?${calendarQuery}`)
      .set('authorization', 'Bearer viewer-token')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const merchantList = merchantListResponse.body as unknown as MerchantAppointmentListResponse;
    expect(merchantList).toMatchObject({
      calendarTimezone: 'Asia/Taipei',
      items: [
        {
          id: created.id,
          source: 'MERCHANT_LINK',
          consumer: { displayName: 'Publication Owner' },
        },
      ],
    });
    expect(merchantListResponse.text).not.toMatch(
      /addressText|bookingPolicy|consumerUserId|email|phone|avatar/,
    );
    const merchantDetailResponse = await request(server)
      .get(`/v1/tenants/${tenantId}/appointments/${created.id}`)
      .set('authorization', 'Bearer viewer-token')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const merchantDetail = merchantDetailResponse.body as unknown as MerchantAppointmentDetail;
    expect(merchantDetail.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'CONFIRMED' }),
    ]);
    expect(merchantDetailResponse.text).not.toMatch(
      /addressText|bookingPolicy|actorUserId|reasonText/,
    );

    const cancellation = await request(server)
      .post(`/v1/me/appointments/${created.id}/cancel`)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '33000000-0000-4000-8000-000000000001')
      .set('x-request-id', 'consumer-cancel-e2e')
      .send({ reasonCode: 'CONSUMER_CHANGE_OF_PLANS' })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(cancellation.body as unknown as AppointmentTransitionResponse).toMatchObject({
      appointmentId: created.id,
      status: 'CANCELLED',
      replacementAppointmentId: null,
    });
    await request(server)
      .post(`/v1/me/appointments/${created.id}/cancel`)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '33000000-0000-4000-8000-000000000001')
      .send({ reasonCode: 'CONSUMER_CHANGE_OF_PLANS' })
      .expect(200);
    await request(server)
      .post(`/v1/me/appointments/${created.id}/cancel`)
      .set('authorization', 'Bearer viewer-token')
      .set('idempotency-key', '33000000-0000-4000-8000-000000000002')
      .send({ reasonCode: 'CONSUMER_CHANGE_OF_PLANS' })
      .expect(404);
    await expect(
      prisma.appointmentStatusHistory.count({ where: { appointmentId: created.id } }),
    ).resolves.toBe(2);
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: created.id, eventType: 'appointment.cancelled.v1' },
      }),
    ).resolves.toBe(1);

    await request(server)
      .delete(`/v1/booking-holds/${hold.id}`)
      .set('authorization', 'Bearer owner-token')
      .expect(409);
  });

  it('enforces merchant lifecycle authorization and replays a scoped cancellation', async () => {
    const lifecycleStartAt = prepareLifecycleWindow();
    await request(server)
      .put(`/v1/tenants/${tenantId}/publication`)
      .set('authorization', 'Bearer owner-token')
      .send({ visibilityStatus: 'PUBLISHED' })
      .expect(200);
    const service = await prisma.service.findFirstOrThrow({ where: { tenantId } });
    const holdResponse = await request(server)
      .post('/v1/marketplace/merchants/public-api-studio/booking-holds')
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '34000000-0000-4000-8000-000000000001')
      .send({ serviceId: service.id, startAt: lifecycleStartAt.toISOString() })
      .expect(201);
    const hold = holdResponse.body as unknown as BookingHoldResponse;
    const appointmentResponse = await request(server)
      .post('/v1/appointments')
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '35000000-0000-4000-8000-000000000001')
      .send({ holdId: hold.id, policiesAccepted: true, policyVersion: hold.policies.version })
      .expect(201);
    const appointment = appointmentResponse.body as unknown as AppointmentResponse;

    await request(server)
      .post(`/v1/tenants/${tenantId}/appointments/${appointment.id}/cancel`)
      .set('authorization', 'Bearer viewer-token')
      .set('idempotency-key', '36000000-0000-4000-8000-000000000001')
      .send({ reasonCode: 'MERCHANT_CUSTOMER_REQUEST' })
      .expect(403);
    const cancelled = await request(server)
      .post(`/v1/tenants/${tenantId}/appointments/${appointment.id}/cancel`)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '36000000-0000-4000-8000-000000000002')
      .set('x-request-id', 'merchant-cancel-e2e')
      .send({ reasonCode: 'MERCHANT_CUSTOMER_REQUEST' })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(cancelled.body as unknown as AppointmentTransitionResponse).toMatchObject({
      appointmentId: appointment.id,
      status: 'CANCELLED',
    });
    await request(server)
      .post(`/v1/tenants/${tenantId}/appointments/${appointment.id}/cancel`)
      .set('authorization', 'Bearer owner-token')
      .set('idempotency-key', '36000000-0000-4000-8000-000000000002')
      .send({ reasonCode: 'MERCHANT_CUSTOMER_REQUEST' })
      .expect(200);
    await expect(
      prisma.auditLog.count({
        where: { tenantId, resourceId: appointment.id, action: 'MERCHANT_CANCEL' },
      }),
    ).resolves.toBe(1);
  });

  it('serves booking policy reads and protects updates with role and revision CAS', async () => {
    const read = await request(server)
      .get(`/v1/tenants/${tenantId}/booking-policy`)
      .set('authorization', 'Bearer viewer-token')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    const policy = read.body as unknown as BookingPolicyResponse;
    await request(server)
      .put(`/v1/tenants/${tenantId}/booking-policy`)
      .set('authorization', 'Bearer viewer-token')
      .send({
        expectedRevision: policy.revision,
        slotIntervalMinutes: policy.slotIntervalMinutes,
        minimumLeadMinutes: policy.minimumLeadMinutes,
        maximumAdvanceDays: policy.maximumAdvanceDays,
        consumerCancelLeadMinutes: 0,
        consumerRescheduleLeadMinutes: 0,
      })
      .expect(403);
    const updateBody = {
      expectedRevision: policy.revision,
      slotIntervalMinutes: policy.slotIntervalMinutes,
      minimumLeadMinutes: policy.minimumLeadMinutes,
      maximumAdvanceDays: policy.maximumAdvanceDays,
      consumerCancelLeadMinutes: 0,
      consumerRescheduleLeadMinutes: 0,
    };
    const updated = await request(server)
      .put(`/v1/tenants/${tenantId}/booking-policy`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'policy-update-e2e')
      .send(updateBody)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(updated.body as unknown as BookingPolicyResponse).toMatchObject({
      revision: policy.revision + 1,
      consumerCancelLeadMinutes: 0,
      consumerRescheduleLeadMinutes: 0,
    });
    await request(server)
      .put(`/v1/tenants/${tenantId}/booking-policy`)
      .set('authorization', 'Bearer owner-token')
      .send(updateBody)
      .expect(409);
  });
});

async function createCompleteAggregate(tenantId: string, userId: string): Promise<void> {
  const prisma = getPrismaClient();
  const location = await prisma.location.create({
    data: {
      tenantId,
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
      tenantId,
      name: '凝膠設計',
      durationMinutes: 90,
      priceType: 'FIXED',
      priceAmount: 1200,
    },
  });
  await prisma.merchantProfile.create({
    data: {
      tenantId,
      category: 'NAIL',
      description: '安靜的私人美甲空間',
      phone: '0900000000',
      bookingPolicy: '請準時抵達',
      cancellationPolicy: '二十四小時前取消',
      primaryLocationId: location.id,
      starterServiceId: service.id,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: { tenantId, locationId: location.id, displayName: 'Yun' },
  });
  await prisma.staffService.create({
    data: { tenantId, staffId: staff.id, serviceId: service.id },
  });
  await prisma.weeklyAvailabilityRule.create({
    data: {
      tenantId,
      staffId: staff.id,
      weekday: 3,
      startTime: new Date('1970-01-01T11:00:00Z'),
      endTime: new Date('1970-01-01T19:00:00Z'),
      validFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const item = await prisma.portfolioItem.create({
    data: { tenantId, title: '煙灰色午後', status: 'PUBLISHED', publishedAt: new Date() },
  });
  await prisma.mediaAsset.create({
    data: {
      tenantId,
      ownerId: item.id,
      bucket: 'private-test-bucket',
      uploadObjectKey: `tenants/${tenantId}/${item.id}/upload`,
      objectKey: `tenants/${tenantId}/${item.id}/display.webp`,
      thumbnailObjectKey: `tenants/${tenantId}/${item.id}/thumb.webp`,
      declaredMimeType: 'image/jpeg',
      declaredByteSize: 1024,
      mimeType: 'image/webp',
      byteSize: 900,
      width: 1200,
      height: 1500,
      checksum: 'a'.repeat(64),
      status: 'READY',
      uploadExpiresAt: new Date('2026-07-23T00:00:00Z'),
      createdByUserId: userId,
    },
  });
}

async function clearAppointmentAggregates(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.appointmentTransitionKey.deleteMany();
  await prisma.appointmentConfirmationKey.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.appointmentStatusHistory.deleteMany();
  await prisma.auditLog.deleteMany({ where: { resourceType: 'appointment' } });
  await prisma.bookingOccupancy.deleteMany({ where: { appointmentId: { not: null } } });
  await prisma.appointmentItem.deleteMany();
  await prisma.appointment.deleteMany();
}

function prepareLifecycleWindow(now = new Date()): Date {
  const startAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8, 8),
  );
  while (startAt.getUTCDay() !== 3) {
    startAt.setUTCDate(startAt.getUTCDate() + 1);
  }
  availabilityNow = new Date(startAt.getTime() - 7 * dayMilliseconds);
  return startAt;
}
