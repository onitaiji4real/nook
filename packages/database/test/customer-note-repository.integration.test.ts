import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CUSTOMER_NOTE_LIMIT,
  PrismaCustomerNoteRepository,
  type CustomerNoteEnvelopeInput,
} from '../src';

const prisma = new PrismaClient();

describe('customer note repository', () => {
  const suffix = randomUUID().slice(0, 8);
  const repository = new PrismaCustomerNoteRepository(prisma);
  let tenantId: string;
  let foreignTenantId: string;
  let ownerUserId: string;
  let consumerUserId: string;
  let foreignConsumerUserId: string;
  let ownerMembershipId: string;
  let customerId: string;
  let foreignCustomerId: string;
  let noteId: string;

  beforeAll(async () => {
    const [owner, consumer, foreignConsumer] = await Promise.all([
      prisma.user.create({ data: { displayName: `Notes owner ${suffix}` } }),
      prisma.user.create({ data: { displayName: `Notes consumer ${suffix}` } }),
      prisma.user.create({ data: { displayName: `Notes foreign ${suffix}` } }),
    ]);
    ownerUserId = owner.id;
    consumerUserId = consumer.id;
    foreignConsumerUserId = foreignConsumer.id;
    const [tenant, foreignTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: `Notes tenant ${suffix}`, slug: `notes-${suffix}` },
      }),
      prisma.tenant.create({
        data: { name: `Notes foreign ${suffix}`, slug: `notes-foreign-${suffix}` },
      }),
    ]);
    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    const [membership, customer, foreignCustomer] = await Promise.all([
      prisma.membership.create({
        data: { tenantId, userId: ownerUserId, role: 'OWNER' },
      }),
      prisma.customer.create({
        data: {
          tenantId,
          consumerUserId,
          relationshipStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      }),
      prisma.customer.create({
        data: {
          tenantId: foreignTenantId,
          consumerUserId: foreignConsumerUserId,
          relationshipStartedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      }),
    ]);
    ownerMembershipId = membership.id;
    customerId = customer.id;
    foreignCustomerId = foreignCustomer.id;
  });

  afterAll(async () => {
    await prisma.customerNote.deleteMany({
      where: { tenantId: { in: [tenantId, foreignTenantId] } },
    });
    await prisma.auditLog.deleteMany({
      where: { tenantId: { in: [tenantId, foreignTenantId] } },
    });
    await prisma.customer.deleteMany({
      where: { tenantId: { in: [tenantId, foreignTenantId] } },
    });
    await prisma.membership.deleteMany({
      where: { tenantId: { in: [tenantId, foreignTenantId] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, foreignTenantId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUserId, consumerUserId, foreignConsumerUserId] } },
    });
    await prisma.$disconnect();
  });

  it('creates a tenant-scoped envelope and audits only the safe note id', async () => {
    noteId = randomUUID();
    const note = await repository.create({
      ...context(),
      noteId,
      envelope: envelope(1),
    });
    expect(note).toMatchObject({
      id: noteId,
      kekResourceVersion: 'test-kek-version-1',
      encryptionSchemaVersion: 1,
    });
    expect(note.nonce).toHaveLength(12);
    expect(note.authTag).toHaveLength(16);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, action: 'crm.customer_note_created', resourceId: noteId },
    });
    expect(audit.resourceType).toBe('customer_note');
    expect(JSON.stringify(audit)).not.toContain('plaintext');
  });

  it('does not disclose a foreign customer or note through tenant-scoped writes', async () => {
    await expect(
      repository.create({
        ...context(),
        customerId: foreignCustomerId,
        noteId: randomUUID(),
        envelope: envelope(2),
      }),
    ).rejects.toMatchObject({ code: 'customer_not_found' });
    await expect(
      repository.update({
        ...context(),
        noteId: randomUUID(),
        expectedUpdatedAt: new Date(),
        envelope: envelope(3),
      }),
    ).rejects.toMatchObject({ code: 'note_not_found' });
  });

  it('uses an exact updatedAt CAS and preserves the note id on replacement', async () => {
    const current = (await repository.listEnvelopes({ tenantId, customerId })).find(
      ({ id }) => id === noteId,
    );
    expect(current).toBeDefined();
    await expect(
      repository.update({
        ...context(),
        noteId,
        expectedUpdatedAt: new Date(0),
        envelope: envelope(4),
      }),
    ).rejects.toMatchObject({ code: 'note_conflict' });

    const updated = await repository.update({
      ...context(),
      noteId,
      expectedUpdatedAt: current!.updatedAt,
      envelope: envelope(5),
    });
    expect(updated.id).toBe(noteId);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(current!.updatedAt.getTime());
    expect(Buffer.from(updated.ciphertext).equals(envelope(1).ciphertext)).toBe(false);
  });

  it('enforces the 100-note cap and deletes with safe audit', async () => {
    const existing = await prisma.customerNote.count({ where: { tenantId, customerId } });
    await prisma.customerNote.createMany({
      data: Array.from({ length: CUSTOMER_NOTE_LIMIT - existing }, (_, index) => {
        const encrypted = envelope(index + 10);
        return {
          id: randomUUID(),
          tenantId,
          customerId,
          ciphertext: Buffer.from(encrypted.ciphertext),
          nonce: Buffer.from(encrypted.nonce),
          authTag: Buffer.from(encrypted.authTag),
          wrappedDek: Buffer.from(encrypted.wrappedDek),
          kekResourceVersion: encrypted.kekResourceVersion,
          encryptionSchemaVersion: encrypted.encryptionSchemaVersion,
          createdByMembershipId: ownerMembershipId,
        };
      }),
    });
    await expect(
      repository.create({
        ...context(),
        noteId: randomUUID(),
        envelope: envelope(200),
      }),
    ).rejects.toMatchObject({ code: 'note_limit_reached' });

    await repository.delete({ ...context(), noteId });
    await expect(
      prisma.customerNote.findUnique({ where: { tenantId_id: { tenantId, id: noteId } } }),
    ).resolves.toBeNull();
    await expect(
      prisma.auditLog.count({
        where: { tenantId, action: 'crm.customer_note_deleted', resourceId: noteId },
      }),
    ).resolves.toBe(1);
  });

  function context() {
    return {
      tenantId,
      customerId,
      actorUserId: ownerUserId,
      requestId: `notes-${suffix}-${randomUUID()}`,
    };
  }
});

function envelope(seed: number): CustomerNoteEnvelopeInput {
  return {
    ciphertext: Buffer.from(`ciphertext-${seed}`),
    nonce: Buffer.alloc(12, seed % 256),
    authTag: Buffer.alloc(16, (seed + 1) % 256),
    wrappedDek: Buffer.from(`wrapped-key-${seed}`),
    kekResourceVersion: 'test-kek-version-1',
    encryptionSchemaVersion: 1,
  };
}
