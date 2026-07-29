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
import type { CustomerDetail, CustomerNote, ProblemDetails } from '@nook/contracts';
import type { CustomerNoteDataKeyWrapper } from '@nook/crypto';
import { disconnectPrismaClient, getPrismaClient } from '@nook/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { CUSTOMER_NOTE_KEY_WRAPPER } from '../../../src/modules/consumer-crm/notes/customer-notes.tokens';
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

class InMemoryDataKeyWrapper implements CustomerNoteDataKeyWrapper {
  readonly keys = new Map<string, Uint8Array>();

  wrapDataKey(plaintextDataKey: Uint8Array): Promise<{
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }> {
    const id = createHash('sha256').update(plaintextDataKey).digest('hex');
    this.keys.set(id, Uint8Array.from(plaintextDataKey));
    return Promise.resolve({
      wrappedDataKey: Buffer.from(id, 'hex'),
      kekResourceVersion:
        'projects/nook-test/locations/asia-east1/keyRings/customer-notes/cryptoKeys/note-kek/cryptoKeyVersions/1',
    });
  }

  unwrapDataKey(input: {
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }): Promise<Uint8Array> {
    const key = this.keys.get(Buffer.from(input.wrappedDataKey).toString('hex'));
    return key === undefined
      ? Promise.reject(new Error('synthetic key unavailable'))
      : Promise.resolve(Uint8Array.from(key));
  }
}

const fixturePrefix = 'crm-notes-api-';
const config: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  databaseUrl: 'postgresql://synthetic:not-used@localhost/synthetic',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'active',
  crmTagsMode: 'disabled',
  crmNotesMode: 'active',
  crmNotesKmsKeyResource:
    'projects/nook-test/locations/asia-east1/keyRings/customer-notes/cryptoKeys/note-kek',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: { globalLimit: 120, tokenLimit: 5, windowSeconds: 60, bucketTtlSeconds: 600 },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('merchant encrypted customer notes API', () => {
  const prisma = getPrismaClient();
  const verifier = new TestIdentityVerifier();
  const keyWrapper = new InMemoryDataKeyWrapper();
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantId: string;
  let foreignTenantId: string;
  let ownerUserId: string;
  let customerId: string;
  let foreignCustomerId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(config)
      .overrideProvider(CUSTOMER_NOTE_KEY_WRAPPER)
      .useValue(keyWrapper)
      .compile();
    app = module.createNestApplication();
    app.use(requestContextMiddleware);
    await app.init();
    server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  beforeEach(async () => {
    await clearFixtures();
    keyWrapper.keys.clear();
    const unique = randomUUID();
    const actors = await Promise.all(
      ['owner', 'manager', 'viewer', 'outsider'].map((role) =>
        prisma.user.create({ data: { displayName: `${fixturePrefix}${role}-${unique}` } }),
      ),
    );
    const [consumer, foreignConsumer] = await Promise.all([
      prisma.user.create({ data: { displayName: `${fixturePrefix}consumer-${unique}` } }),
      prisma.user.create({ data: { displayName: `${fixturePrefix}foreign-consumer-${unique}` } }),
    ]);
    const [tenant, foreignTenant] = await Promise.all([
      prisma.tenant.create({
        data: { name: '加密備註測試店', slug: `${fixturePrefix}tenant-${unique}` },
      }),
      prisma.tenant.create({
        data: { name: '加密備註外店', slug: `${fixturePrefix}foreign-${unique}` },
      }),
    ]);
    await Promise.all([
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[0]!.id, role: 'OWNER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[1]!.id, role: 'MANAGER' },
      }),
      prisma.membership.create({
        data: { tenantId: tenant.id, userId: actors[2]!.id, role: 'VIEWER' },
      }),
    ]);
    const relationshipStartedAt = new Date('2026-07-01T00:00:00.000Z');
    const [customer, foreignCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          tenantId: tenant.id,
          consumerUserId: consumer.id,
          relationshipStartedAt,
          createdAt: relationshipStartedAt,
        },
      }),
      prisma.customer.create({
        data: {
          tenantId: foreignTenant.id,
          consumerUserId: foreignConsumer.id,
          relationshipStartedAt,
          createdAt: relationshipStartedAt,
        },
      }),
    ]);
    tenantId = tenant.id;
    foreignTenantId = foreignTenant.id;
    ownerUserId = actors[0]!.id;
    customerId = customer.id;
    foreignCustomerId = foreignCustomer.id;
    verifier.identities.clear();
    ['owner', 'manager', 'viewer', 'outsider'].forEach((role, index) => {
      verifier.identities.set(`${role}-token`, actors[index]!.id);
    });
  });

  afterAll(async () => {
    await clearFixtures();
    await app.close();
    await disconnectPrismaClient();
  });

  it('requires authentication, enforces OWNER/MANAGER, and does not disclose tenant boundaries', async () => {
    const unauthenticated = await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .send({ content: 'unauthenticated' })
      .expect(401);
    expect(unauthenticated.headers['cache-control']).toBe('private, no-store');

    const viewer = await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer viewer-token')
      .send({ content: 'viewer denied' })
      .expect(403);
    expect(viewer.body as unknown as ProblemDetails).toMatchObject({
      code: 'tenant_access_denied',
    });

    await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer outsider-token')
      .send({ content: 'outsider denied' })
      .expect(404);
    await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${foreignCustomerId}/notes`)
      .set('authorization', 'Bearer owner-token')
      .send({ content: 'foreign customer denied' })
      .expect(404);
    await request(server)
      .post(`/v1/tenants/${foreignTenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer owner-token')
      .send({ content: 'foreign tenant denied' })
      .expect(404);
  });

  it('creates, decrypts, replaces with CAS, and deletes an encrypted note', async () => {
    const firstContent = '偏好自然透明感；避免厚重。';
    const created = await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer manager-token')
      .set('x-request-id', 'crm-note-create')
      .send({ content: firstContent })
      .expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const note = created.body as unknown as CustomerNote;

    const storedBefore = await prisma.customerNote.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: note.id } },
    });
    expect(Buffer.from(storedBefore.ciphertext).toString('utf8')).not.toContain(firstContent);
    expect(JSON.stringify(storedBefore)).not.toContain(firstContent);
    expect(storedBefore.encryptionSchemaVersion).toBe(1);

    const detail = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${customerId}`)
      .set('authorization', 'Bearer owner-token')
      .expect(200);
    expect((detail.body as unknown as CustomerDetail).notes).toEqual([note]);

    await request(server)
      .patch(`/v1/tenants/${tenantId}/customers/${customerId}/notes/${note.id}`)
      .set('authorization', 'Bearer manager-token')
      .send({ content: 'stale update', expectedUpdatedAt: new Date(0).toISOString() })
      .expect(409);

    const replacementContent = '更新：可接受裸粉色。';
    const updated = await request(server)
      .patch(`/v1/tenants/${tenantId}/customers/${customerId}/notes/${note.id}`)
      .set('authorization', 'Bearer manager-token')
      .set('x-request-id', 'crm-note-update')
      .send({ content: replacementContent, expectedUpdatedAt: note.updatedAt })
      .expect(200);
    const replacement = updated.body as unknown as CustomerNote;
    expect(replacement.id).toBe(note.id);
    expect(replacement.content).toBe(replacementContent);

    const storedAfter = await prisma.customerNote.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: note.id } },
    });
    expect(Buffer.from(storedAfter.nonce).equals(storedBefore.nonce)).toBe(false);
    expect(Buffer.from(storedAfter.ciphertext).equals(storedBefore.ciphertext)).toBe(false);

    const replacedDetail = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${customerId}`)
      .set('authorization', 'Bearer manager-token')
      .expect(200);
    expect((replacedDetail.body as unknown as CustomerDetail).notes).toEqual([replacement]);

    const deleted = await request(server)
      .delete(`/v1/tenants/${tenantId}/customers/${customerId}/notes/${note.id}`)
      .set('authorization', 'Bearer owner-token')
      .set('x-request-id', 'crm-note-delete')
      .expect(204);
    expect(deleted.headers['cache-control']).toBe('private, no-store');
    const emptyDetail = await request(server)
      .get(`/v1/tenants/${tenantId}/customers/${customerId}`)
      .set('authorization', 'Bearer owner-token')
      .expect(200);
    expect((emptyDetail.body as unknown as CustomerDetail).notes).toEqual([]);

    await expect(
      prisma.auditLog.count({
        where: {
          tenantId,
          resourceId: note.id,
          action: {
            in: [
              'crm.customer_note_created',
              'crm.customer_note_updated',
              'crm.customer_note_deleted',
            ],
          },
        },
      }),
    ).resolves.toBe(3);
  });

  it('returns no partial plaintext when authentication metadata is tampered', async () => {
    const content = '這段敏感內容不可出現在錯誤或 log';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const created = await request(server)
        .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
        .set('authorization', 'Bearer owner-token')
        .send({ content })
        .expect(201);
      const note = created.body as unknown as CustomerNote;
      const stored = await prisma.customerNote.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: note.id } },
        select: { authTag: true },
      });
      const tamperedTag = Buffer.from(stored.authTag);
      tamperedTag[0] = tamperedTag[0]! ^ 0xff;
      await prisma.customerNote.update({
        where: { tenantId_id: { tenantId, id: note.id } },
        data: { authTag: tamperedTag },
      });

      const response = await request(server)
        .get(`/v1/tenants/${tenantId}/customers/${customerId}`)
        .set('authorization', 'Bearer owner-token')
        .set('x-request-id', 'crm-note-tampered')
        .expect(503);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body as unknown as ProblemDetails).toMatchObject({
        code: 'customer_notes_unavailable',
      });
      expect(JSON.stringify(response.body)).not.toContain(content);
      expect(writeSpy.mock.calls.flat().join(' ')).not.toContain(content);
      await expect(
        prisma.auditLog.count({
          where: {
            tenantId,
            actorUserId: ownerUserId,
            resourceId: customerId,
            action: 'crm.customer_detail_unavailable',
            requestId: 'crm-note-tampered',
          },
        }),
      ).resolves.toBe(1);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('rejects unbounded or ambiguous input before persistence', async () => {
    await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer owner-token')
      .send({ content: '客'.repeat(2_001) })
      .expect(400);
    await request(server)
      .post(`/v1/tenants/${tenantId}/customers/${customerId}/notes`)
      .set('authorization', 'Bearer owner-token')
      .send({ content: '內容', extra: true })
      .expect(400);
    await expect(prisma.customerNote.count({ where: { tenantId, customerId } })).resolves.toBe(0);
  });
});

async function clearFixtures(): Promise<void> {
  const prisma = getPrismaClient();
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const users = await prisma.user.findMany({
    where: { displayName: { startsWith: fixturePrefix } },
    select: { id: true },
  });
  if (tenantIds.length > 0) {
    await prisma.customerNote.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
}
