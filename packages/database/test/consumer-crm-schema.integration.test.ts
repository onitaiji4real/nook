import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();

describe('consumer CRM expand constraints', () => {
  const suffix = randomUUID().slice(0, 8);
  let consumerUserId: string;
  let ownerUserId: string;
  let tenantId: string;
  let otherTenantId: string;
  let ownerMembershipId: string;
  let otherMembershipId: string;
  let customerId: string;

  beforeAll(async () => {
    const [consumer, owner, tenant, otherTenant] = await Promise.all([
      prisma.user.create({ data: { displayName: `CRM consumer ${suffix}` } }),
      prisma.user.create({ data: { displayName: `CRM owner ${suffix}` } }),
      prisma.tenant.create({
        data: { name: `CRM tenant ${suffix}`, slug: `crm-tenant-${suffix}` },
      }),
      prisma.tenant.create({
        data: { name: `CRM other ${suffix}`, slug: `crm-other-${suffix}` },
      }),
    ]);
    consumerUserId = consumer.id;
    ownerUserId = owner.id;
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;

    const [ownerMembership, otherMembership, customer] = await Promise.all([
      prisma.membership.create({
        data: { tenantId, userId: ownerUserId, role: 'OWNER' },
      }),
      prisma.membership.create({
        data: { tenantId: otherTenantId, userId: ownerUserId, role: 'OWNER' },
      }),
      prisma.customer.create({
        data: {
          tenantId,
          consumerUserId,
          relationshipStartedAt: new Date('2026-07-01T02:00:00.000Z'),
        },
      }),
    ]);
    ownerMembershipId = ownerMembership.id;
    otherMembershipId = otherMembership.id;
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects cross-tenant note ownership and malformed encryption envelopes', async () => {
    await expect(
      prisma.customerNote.create({
        data: {
          tenantId: otherTenantId,
          customerId,
          ciphertext: Buffer.from('ciphertext'),
          nonce: Buffer.alloc(12),
          authTag: Buffer.alloc(16),
          wrappedDek: Buffer.from('wrapped-dek'),
          kekResourceVersion:
            'projects/synthetic/locations/asia-east1/keyRings/test/cryptoKeys/note/cryptoKeyVersions/1',
          createdByMembershipId: otherMembershipId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      prisma.customerNote.create({
        data: {
          tenantId,
          customerId,
          ciphertext: Buffer.from('ciphertext'),
          nonce: Buffer.alloc(8),
          authTag: Buffer.alloc(16),
          wrappedDek: Buffer.from('wrapped-dek'),
          kekResourceVersion:
            'projects/synthetic/locations/asia-east1/keyRings/test/cryptoKeys/note/cryptoKeyVersions/1',
          createdByMembershipId: ownerMembershipId,
        },
      }),
    ).rejects.toThrow(/customer_notes_envelope_check/);
  });

  it('allows only one active consent document per purpose', async () => {
    await prisma.consentDocument.create({
      data: {
        purpose: 'MARKETING_MESSAGES',
        version: `crm-${suffix}-v1`,
        locale: 'zh-TW',
        contentSha256: '0'.repeat(64),
        contentText: 'Synthetic approved consent document.',
        status: 'ACTIVE',
        documentGeneration: 1n,
        activeFrom: new Date('2026-07-28T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.consentDocument.create({
        data: {
          purpose: 'MARKETING_MESSAGES',
          version: `crm-${suffix}-v2`,
          locale: 'zh-TW',
          contentSha256: '1'.repeat(64),
          contentText: 'Synthetic second active document.',
          status: 'ACTIVE',
          documentGeneration: 2n,
          activeFrom: new Date('2026-07-28T01:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects grant events without canonical evidence', async () => {
    const document = await prisma.consentDocument.findFirstOrThrow({
      where: { purpose: 'MARKETING_MESSAGES', status: 'ACTIVE' },
    });
    await prisma.consumerConsentStream.create({
      data: { tenantId, consumerUserId, purpose: 'MARKETING_MESSAGES' },
    });
    const command = await prisma.consumerConsentCommand.create({
      data: {
        tenantId,
        consumerUserId,
        purpose: 'MARKETING_MESSAGES',
        idempotencyKeyHash: '2'.repeat(64),
        commandType: 'GRANT',
        requestFingerprint: '3'.repeat(64),
        resultRevision: 1,
        outcome: 'APPLIED',
        requestId: `crm-consent-${suffix}`,
        createdAt: new Date('2026-07-28T02:00:00.000Z'),
      },
    });

    await expect(
      prisma.consumerConsentEvent.create({
        data: {
          tenantId,
          consumerUserId,
          purpose: 'MARKETING_MESSAGES',
          revision: 1,
          eventType: 'GRANTED',
          consentDocumentId: document.id,
          source: 'CONSUMER_WEB',
          actorUserId: consumerUserId,
          commandId: command.id,
          occurredAt: new Date('2026-07-28T02:00:00.000Z'),
          requestId: `crm-consent-${suffix}`,
          createdAt: new Date('2026-07-28T02:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(/consumer_consent_events_evidence_check/);
  });

  it('rejects export counters beyond the documented hard bounds', async () => {
    await expect(
      prisma.customerExportJob.create({
        data: {
          tenantId,
          requestedByMembershipId: ownerMembershipId,
          idempotencyKeyHash: '4'.repeat(64),
          requestFingerprint: '5'.repeat(64),
          customerCount: 10_001,
        },
      }),
    ).rejects.toThrow(/customer_export_jobs_bounds_check/);
  });
});
