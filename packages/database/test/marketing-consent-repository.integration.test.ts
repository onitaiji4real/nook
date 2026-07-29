import { createHash, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaMarketingConsentRepository, type GrantMarketingConsentInput } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaMarketingConsentRepository(prisma);
const fixturePrefix = 'crm-consent-repository-';

interface Fixture {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly documentId: string;
}

let fixture: Fixture;

describe('marketing consent repository', () => {
  beforeEach(async () => {
    await clearFixtures();
    fixture = await createFixture();
  });

  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('reads a confirmed relationship without waiting for customer projection', async () => {
    await expect(repository.readCurrent(fixture)).resolves.toMatchObject({
      tenantId: fixture.tenantId,
      purpose: 'MARKETING_MESSAGES',
      state: 'NOT_GRANTED',
      eligible: false,
      revision: 0,
      grantedAt: null,
      withdrawnAt: null,
      activeDocument: {
        id: fixture.documentId,
        purpose: 'MARKETING_MESSAGES',
        locale: 'zh-TW',
      },
    });
    await expect(
      prisma.customer.count({
        where: { tenantId: fixture.tenantId, consumerUserId: fixture.consumerUserId },
      }),
    ).resolves.toBe(0);
  });

  it('stores canonical grant and withdrawal evidence with current-safe exact replay', async () => {
    const grant = grantInput(fixture, 'grant-a', 0);
    const granted = await repository.grant(grant);
    expect(granted).toMatchObject({ state: 'GRANTED', eligible: true, revision: 1 });

    const grantEvent = await prisma.consumerConsentEvent.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, eventType: 'GRANTED' },
    });
    expect(grantEvent).toMatchObject({
      consumerUserId: fixture.consumerUserId,
      actorUserId: fixture.consumerUserId,
      revision: 1,
      source: 'CONSUMER_WEB',
      renderedEvidenceSchema: 'nook-consent-evidence-v1',
    });
    expect(grantEvent.renderedEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(repository.grant(grant)).resolves.toMatchObject({
      state: 'GRANTED',
      revision: 1,
    });

    const withdrawn = await repository.withdraw(
      withdrawInput(fixture, 'withdraw-a', 1, fixture.consumerUserId),
    );
    expect(withdrawn).toMatchObject({
      state: 'WITHDRAWN',
      eligible: false,
      revision: 2,
    });
    expect(withdrawn.grantedAt).toEqual(grantEvent.occurredAt);
    expect(withdrawn.withdrawnAt).not.toBeNull();

    const retiredAt = new Date();
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: fixture.tenantId },
        data: { status: 'SUSPENDED' },
      }),
      prisma.consentDocument.update({
        where: { id: fixture.documentId },
        data: { status: 'RETIRED', retiredAt },
      }),
    ]);
    await expect(repository.grant(grant)).resolves.toMatchObject({
      state: 'WITHDRAWN',
      eligible: false,
      revision: 2,
      activeDocument: null,
    });
    await expect(
      prisma.consumerConsentEvent.count({ where: { tenantId: fixture.tenantId } }),
    ).resolves.toBe(2);
    await expect(
      prisma.tenantCrmPrivacyVersion.findUniqueOrThrow({
        where: { tenantId: fixture.tenantId },
      }),
    ).resolves.toMatchObject({ consentWatermark: 2n });
    await expect(
      prisma.auditLog.count({
        where: {
          tenantId: fixture.tenantId,
          action: { in: ['marketing_consent.granted', 'marketing_consent.withdrawn'] },
        },
      }),
    ).resolves.toBe(2);
  });

  it('keeps withdrawal available when tenant and active document are disabled', async () => {
    await repository.grant(grantInput(fixture, 'grant-disabled', 0));
    const retiredAt = new Date();
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: fixture.tenantId },
        data: { status: 'SUSPENDED' },
      }),
      prisma.consentDocument.update({
        where: { id: fixture.documentId },
        data: { status: 'RETIRED', retiredAt },
      }),
    ]);

    await expect(
      repository.withdraw(withdrawInput(fixture, 'withdraw-disabled', 1, fixture.consumerUserId)),
    ).resolves.toMatchObject({
      state: 'WITHDRAWN',
      activeDocument: null,
      revision: 2,
    });
    await expect(
      repository.withdraw(withdrawInput(fixture, 'withdraw-noop', 2, fixture.consumerUserId)),
    ).resolves.toMatchObject({ state: 'WITHDRAWN', revision: 2 });
    await expect(
      prisma.consumerConsentCommand.findFirstOrThrow({
        where: { tenantId: fixture.tenantId, idempotencyKeyHash: hash('withdraw-noop') },
      }),
    ).resolves.toMatchObject({
      commandType: 'WITHDRAW',
      outcome: 'NOOP_ALREADY_WITHDRAWN',
      resultRevision: 2,
    });
  });

  it('allows explicit re-grant after the active document supersedes prior evidence', async () => {
    await repository.grant(grantInput(fixture, 'grant-v1', 0));
    const switchedAt = new Date();
    const documentV2 = await prisma.$transaction(async (tx) => {
      await tx.consentDocument.update({
        where: { id: fixture.documentId },
        data: { status: 'RETIRED', retiredAt: switchedAt },
      });
      return tx.consentDocument.create({
        data: {
          purpose: 'MARKETING_MESSAGES',
          version: `${fixturePrefix}v2-${randomUUID()}`,
          locale: 'zh-TW',
          contentSha256: 'b'.repeat(64),
          contentText: '第二版合成行銷同意文案。',
          status: 'ACTIVE',
          documentGeneration: BigInt(Date.now()) + 1n,
          activeFrom: switchedAt,
        },
      });
    });

    await expect(repository.readCurrent(fixture)).resolves.toMatchObject({
      state: 'SUPERSEDED',
      eligible: false,
      revision: 1,
      activeDocument: { id: documentV2.id },
    });
    await expect(
      repository.grant({
        ...grantInput(fixture, 'grant-v2', 1),
        consentDocumentId: documentV2.id,
        requestFingerprint: fingerprint('GRANT', documentV2.id, 1),
      }),
    ).resolves.toMatchObject({
      state: 'GRANTED',
      eligible: true,
      revision: 2,
      activeDocument: { id: documentV2.id },
    });
  });

  it('rejects cross-tenant access, stale revisions and same-key payload changes', async () => {
    const foreignTenant = await prisma.tenant.create({
      data: { name: 'Foreign consent tenant', slug: `${fixturePrefix}foreign-${randomUUID()}` },
    });
    await expect(
      repository.readCurrent({
        tenantId: foreignTenant.id,
        consumerUserId: fixture.consumerUserId,
      }),
    ).rejects.toMatchObject({
      code: 'relationship_not_found',
    });

    const grant = grantInput(fixture, 'conflict-key', 0);
    await repository.grant(grant);
    await expect(
      repository.grant({
        ...grant,
        requestFingerprint: fingerprint('GRANT', fixture.documentId, 9),
      }),
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(
      repository.withdraw(withdrawInput(fixture, 'stale-withdraw', 0, fixture.consumerUserId)),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(repository.grant(grantInput(fixture, 'already-granted', 1))).rejects.toMatchObject(
      {
        code: 'consent_already_granted',
      },
    );
  });

  it('serializes a concurrent exact grant into one command and one event', async () => {
    const input = grantInput(fixture, 'concurrent-grant', 0);
    const results = await Promise.all([repository.grant(input), repository.grant(input)]);
    expect(results).toHaveLength(2);
    expect(results.every(({ state, revision }) => state === 'GRANTED' && revision === 1)).toBe(
      true,
    );
    await expect(
      prisma.consumerConsentCommand.count({ where: { tenantId: fixture.tenantId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.consumerConsentEvent.count({ where: { tenantId: fixture.tenantId } }),
    ).resolves.toBe(1);
  });
});

function grantInput(
  source: Fixture,
  key: string,
  expectedRevision: number,
): GrantMarketingConsentInput {
  return {
    tenantId: source.tenantId,
    consumerUserId: source.consumerUserId,
    actorUserId: source.consumerUserId,
    consentDocumentId: source.documentId,
    expectedRevision,
    idempotencyKeyHash: hash(key),
    requestFingerprint: fingerprint('GRANT', source.documentId, expectedRevision),
    requestId: `crm-consent-${key}`,
  };
}

function withdrawInput(
  source: Fixture,
  key: string,
  expectedRevision: number,
  actorUserId: string,
) {
  return {
    tenantId: source.tenantId,
    consumerUserId: source.consumerUserId,
    actorUserId,
    expectedRevision,
    idempotencyKeyHash: hash(key),
    requestFingerprint: fingerprint('WITHDRAW', null, expectedRevision),
    requestId: `crm-consent-${key}`,
  };
}

function fingerprint(command: 'GRANT' | 'WITHDRAW', documentId: string | null, revision: number) {
  return hash(JSON.stringify({ version: 1, command, documentId, expectedRevision: revision }));
}

async function createFixture(): Promise<Fixture> {
  const unique = randomUUID();
  const consumer = await prisma.user.create({
    data: { displayName: `${fixturePrefix}${unique}` },
  });
  const tenant = await prisma.tenant.create({
    data: { name: '範例美甲店', slug: `${fixturePrefix}${unique}` },
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
      name: 'Consent fixture service',
      durationMinutes: 60,
      priceType: 'FIXED',
      priceAmount: 1_200,
    },
  });
  const staff = await prisma.staffProfile.create({
    data: {
      tenantId: tenant.id,
      locationId: location.id,
      displayName: 'Consent fixture staff',
    },
  });
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
  const confirmedAt = new Date();
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
      idempotencyKeyHash: hash(randomUUID()),
      requestFingerprint: hash(randomUUID()),
    },
  });
  await prisma.appointment.create({
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
  const document = await prisma.consentDocument.create({
    data: {
      purpose: 'MARKETING_MESSAGES',
      version: `${fixturePrefix}v1-${unique}`,
      locale: 'zh-TW',
      contentSha256: 'a'.repeat(64),
      contentText: '合成行銷同意文案，可隨時撤回。',
      status: 'ACTIVE',
      documentGeneration: BigInt(Date.now()),
      activeFrom: new Date(),
    },
  });
  return { tenantId: tenant.id, consumerUserId: consumer.id, documentId: document.id };
}

async function clearFixtures(): Promise<void> {
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
