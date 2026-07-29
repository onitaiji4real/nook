import { createHash, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { RuntimeConfig } from '@nook/config';
import type { MarketingConsentResponse, ProblemDetails } from '@nook/contracts';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { RUNTIME_CONFIG } from '../../../src/platform/config/runtime-config.token';
import { requestContextMiddleware } from '../../../src/platform/http/request-context.middleware';

class TestIdentityVerifier implements IdentityTokenVerifier {
  readonly identities = new Map<string, string>();

  verify(token: string): Promise<AuthenticatedPrincipal> {
    const userId = this.identities.get(token);
    if (userId === undefined) {
      return Promise.reject(new IdentityTokenVerificationError('invalid_token', 'Rejected.'));
    }
    return Promise.resolve({ userId });
  }
}

const fixturePrefix = 'crm-consent-api-';
const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  databaseUrl: 'postgresql://synthetic:not-used@localhost/synthetic',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  marketingConsentGrantEnabled: true,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('consumer marketing consent API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantId: string;
  let foreignTenantId: string;
  let consumerUserId: string;
  let outsiderUserId: string;
  let documentId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await clearFixtures();
    const unique = randomUUID();
    const [consumer, outsider] = await Promise.all([
      prisma.user.create({ data: { displayName: `${fixturePrefix}consumer-${unique}` } }),
      prisma.user.create({ data: { displayName: `${fixturePrefix}outsider-${unique}` } }),
    ]);
    const [tenant, foreignTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: '範例美甲店', slug: `${fixturePrefix}tenant-${unique}` },
      }),
      prisma.tenant.create({
        data: { name: '其他店家', slug: `${fixturePrefix}foreign-${unique}` },
      }),
    ]);
    const document = await prisma.consentDocument.create({
      data: {
        purpose: 'MARKETING_MESSAGES',
        version: `${fixturePrefix}v1-${unique}`,
        locale: 'zh-TW',
        contentSha256: 'a'.repeat(64),
        contentText: '我同意接收此店家的行銷訊息，並可隨時撤回。',
        status: 'ACTIVE',
        documentGeneration: BigInt(Date.now()),
        activeFrom: new Date(),
      },
    });
    await createConfirmedRelationship(tenant.id, consumer.id);

    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    consumerUserId = consumer.id;
    outsiderUserId = outsider.id;
    documentId = document.id;
    verifier.identities.clear();
    verifier.identities.set('consumer-token', consumerUserId);
    verifier.identities.set('outsider-token', outsiderUserId);
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
    await disconnectPrismaClient();
  });

  it('requires current authentication and never exposes another relationship', async () => {
    const unauthenticated = await request(server)
      .get(`/v1/me/marketing-consents/${tenantId}`)
      .expect(401);
    expect(unauthenticated.headers['cache-control']).toBe('private, no-store');

    const crossConsumer = await request(server)
      .get(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer outsider-token')
      .expect(404);
    expect(crossConsumer.headers['cache-control']).toBe('private, no-store');
    expect(crossConsumer.body as unknown as ProblemDetails).toMatchObject({
      code: 'marketing_consent_not_found',
    });

    const crossTenant = await request(server)
      .get(`/v1/me/marketing-consents/${foreignTenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .expect(404);
    expect(crossTenant.body as unknown as ProblemDetails).toMatchObject({
      code: 'marketing_consent_not_found',
    });
  });

  it('reads current consent from the appointment relationship without customer projection', async () => {
    const response = await request(server)
      .get(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .expect(200);

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body as unknown as MarketingConsentResponse).toMatchObject({
      tenantId,
      tenantDisplayName: '範例美甲店',
      purpose: 'MARKETING_MESSAGES',
      state: 'NOT_GRANTED',
      eligible: false,
      revision: 0,
      activeDocument: { id: documentId, locale: 'zh-TW' },
      grantedAt: null,
      withdrawnAt: null,
    });
    await expect(prisma.customer.count({ where: { tenantId, consumerUserId } })).resolves.toBe(0);
  });

  it('grants exactly once and rejects same-key payload changes', async () => {
    const key = randomUUID();
    const body = {
      purpose: 'MARKETING_MESSAGES',
      consentDocumentId: documentId,
      expectedRevision: 0,
    };
    const first = await request(server)
      .post(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', key)
      .set('x-request-id', 'consent-grant-http')
      .send(body)
      .expect(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body as unknown as MarketingConsentResponse).toMatchObject({
      state: 'GRANTED',
      eligible: true,
      revision: 1,
    });

    await request(server)
      .post(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', key)
      .set('x-request-id', 'consent-grant-http-replay')
      .send(body)
      .expect(200);
    const conflict = await request(server)
      .post(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', key)
      .send({ ...body, expectedRevision: 1 })
      .expect(409);
    expect(conflict.headers['cache-control']).toBe('private, no-store');
    expect(conflict.body as unknown as ProblemDetails).toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(prisma.consumerConsentCommand.count({ where: { tenantId } })).resolves.toBe(1);
    await expect(prisma.consumerConsentEvent.count({ where: { tenantId } })).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({ where: { tenantId, action: 'marketing_consent.granted' } }),
    ).resolves.toBe(1);
  });

  it('withdraws after tenant/document deactivation and records repeated withdrawal as a no-op', async () => {
    const grantKey = randomUUID();
    const grantBody = {
      purpose: 'MARKETING_MESSAGES',
      consentDocumentId: documentId,
      expectedRevision: 0,
    };
    await request(server)
      .post(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', grantKey)
      .send(grantBody)
      .expect(200);
    const retiredAt = new Date();
    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } }),
      prisma.consentDocument.update({
        where: { id: documentId },
        data: { status: 'RETIRED', retiredAt },
      }),
    ]);

    const withdrawn = await request(server)
      .delete(`/v1/me/marketing-consents/${tenantId}`)
      .query({ expectedRevision: 1 })
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', randomUUID())
      .set('x-request-id', 'consent-withdraw-http')
      .expect(200);
    expect(withdrawn.headers['cache-control']).toBe('private, no-store');
    expect(withdrawn.body as unknown as MarketingConsentResponse).toMatchObject({
      state: 'WITHDRAWN',
      eligible: false,
      revision: 2,
      activeDocument: null,
    });

    const noopKey = randomUUID();
    await request(server)
      .delete(`/v1/me/marketing-consents/${tenantId}`)
      .query({ expectedRevision: 2 })
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', noopKey)
      .expect(200);
    await expect(
      prisma.consumerConsentCommand.findFirstOrThrow({
        where: { tenantId, idempotencyKeyHash: sha256(noopKey) },
      }),
    ).resolves.toMatchObject({
      outcome: 'NOOP_ALREADY_WITHDRAWN',
      resultRevision: 2,
    });
    await expect(prisma.consumerConsentEvent.count({ where: { tenantId } })).resolves.toBe(2);

    const replay = await request(server)
      .post(`/v1/me/marketing-consents/${tenantId}`)
      .set('authorization', 'Bearer consumer-token')
      .set('idempotency-key', grantKey)
      .send(grantBody)
      .expect(200);
    expect(replay.body as unknown as MarketingConsentResponse).toMatchObject({
      state: 'WITHDRAWN',
      revision: 2,
      activeDocument: null,
    });
  });
});

async function createConfirmedRelationship(
  tenantId: string,
  consumerUserId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const location = await prisma.location.create({
    data: {
      tenantId,
      name: '中山店',
      addressText: 'fixture address',
      city: '台北市',
      district: '中山區',
    },
  });
  const service = await prisma.service.create({
    data: {
      tenantId,
      name: 'Consent API fixture service',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1_200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: { tenantId, locationId: location.id, displayName: 'Consent API fixture staff' },
  });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
  const confirmedAt = new Date();
  const policyVersion = `v2:${sha256(randomUUID())}`;
  const hold = await prisma.bookingHold.create({
    data: {
      tenantId,
      locationId: location.id,
      serviceId: service.id,
      staffId: staff.id,
      consumerUserId,
      status: 'CONSUMED',
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1_000),
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
      locationTimezoneSnapshot: 'Asia/Taipei',
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKeyHash: sha256(randomUUID()),
      requestFingerprint: sha256(randomUUID()),
    },
  });
  await prisma.appointment.create({
    data: {
      tenantId,
      locationId: location.id,
      staffId: staff.id,
      consumerUserId,
      holdId: hold.id,
      status: 'CONFIRMED',
      source: 'MERCHANT_LINK',
      pricingStatus: 'EXACT',
      paymentStatus: 'NOT_REQUIRED',
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1_000),
      confirmedAt,
      usageTimezoneSnapshot: 'Asia/Taipei',
      usageMonth: taipeiMonth(startAt),
      locationTimezoneSnapshot: 'Asia/Taipei',
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
}

async function clearFixtures(): Promise<void> {
  const prisma = getPrismaClient();
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await prisma.consumerConsentStream.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { currentRevision: 0, currentEventId: null },
    });
    await prisma.consumerConsentEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.consumerConsentCommand.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.consumerConsentStream.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenantCrmPrivacyVersion.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.bookingHold.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.staffProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.consentDocument.deleteMany({
    where: { version: { startsWith: fixturePrefix } },
  });
  await prisma.user.deleteMany({
    where: { displayName: { startsWith: fixturePrefix } },
  });
}

function sha256(value: string): string {
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
