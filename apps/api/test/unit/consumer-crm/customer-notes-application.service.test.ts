import type { RuntimeConfig } from '@nook/config';
import { encryptCustomerNote, type CustomerNoteDataKeyWrapper } from '@nook/crypto';
import {
  CustomerNoteRepositoryError,
  type CustomerNoteEnvelopeRecord,
  type CustomerNoteRepository,
  type TenantRepository,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { CustomerNotesApplicationService } from '../../../src/modules/consumer-crm/notes/customer-notes-application.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const customerId = '00000000-0000-4000-8000-000000000003';
const noteId = '00000000-0000-4000-8000-000000000004';
const createdAt = new Date('2026-07-29T15:00:00.000Z');

const baseConfig: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  crmNotesMode: 'active',
  crmNotesKmsKeyResource:
    'projects/nook-dev/locations/asia-east1/keyRings/customer-notes/cryptoKeys/note-kek',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: {
    globalLimit: 120,
    tokenLimit: 5,
    windowSeconds: 60,
    bucketTtlSeconds: 600,
  },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('CustomerNotesApplicationService', () => {
  it('fails before encryption or persistence while the runtime gate is disabled', async () => {
    const repository = createRepository();
    const wrapper = createWrapper();
    const service = createService(repository, wrapper, {
      ...baseConfig,
      crmNotesMode: 'disabled',
    });

    await expect(
      service.create({ ...context(), body: { content: '不得儲存' } }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'customer_notes_unavailable',
    });
    expect(wrapper.wrapDataKey).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('encrypts before persistence and never passes plaintext into the repository', async () => {
    const repository = createRepository();
    const wrapper = createWrapper();
    repository.create.mockImplementation((input) =>
      Promise.resolve(record(input.noteId, input.envelope)),
    );
    const service = createService(repository, wrapper);
    const content = '偏好自然透明感，避免厚重。';

    await expect(service.create({ ...context(), body: { content } })).resolves.toMatchObject({
      content,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    const persisted = repository.create.mock.calls[0]?.[0];
    expect(persisted).toBeDefined();
    expect(JSON.stringify(persisted)).not.toContain(content);
    expect(Buffer.from(persisted!.envelope.ciphertext).toString('utf8')).not.toContain(content);
    expect(persisted!.envelope).toMatchObject({
      encryptionSchemaVersion: 1,
      kekResourceVersion: 'test-kek-version-1',
    });
  });

  it('allows an empty detail read while disabled but fails closed for stored notes', async () => {
    const repository = createRepository();
    const wrapper = createWrapper();
    const disabled = createService(repository, wrapper, {
      ...baseConfig,
      crmNotesMode: 'disabled',
    });

    repository.listEnvelopes.mockResolvedValueOnce([]);
    await expect(disabled.readForDetail(context())).resolves.toEqual([]);
    expect(wrapper.unwrapDataKey).not.toHaveBeenCalled();

    repository.listEnvelopes.mockResolvedValueOnce([record(noteId)]);
    await expect(disabled.readForDetail(context())).rejects.toMatchObject({
      status: 503,
      code: 'customer_notes_unavailable',
    });
    expect(wrapper.unwrapDataKey).not.toHaveBeenCalled();
  });

  it('decrypts the complete note set and rejects an unknown envelope version', async () => {
    const repository = createRepository();
    const wrapper = createWrapper();
    const service = createService(repository, wrapper);
    const envelope = await encryptCustomerNote({
      plaintext: '完整解密內容',
      aad: {
        environment: 'test',
        tenantId,
        customerId,
        noteId,
        encryptionSchemaVersion: 1,
      },
      keyWrapper: wrapper,
    });
    const encrypted = record(noteId, envelope);
    repository.listEnvelopes.mockResolvedValueOnce([encrypted]);

    await expect(service.readForDetail(context())).resolves.toEqual([
      {
        id: noteId,
        content: '完整解密內容',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      },
    ]);

    repository.listEnvelopes.mockResolvedValueOnce([{ ...encrypted, encryptionSchemaVersion: 2 }]);
    wrapper.unwrapDataKey.mockClear();
    await expect(service.readForDetail(context())).rejects.toMatchObject({
      status: 503,
      code: 'customer_notes_unavailable',
    });
    expect(wrapper.unwrapDataKey).not.toHaveBeenCalled();
  });

  it('fails closed without a database write when the key provider is unavailable', async () => {
    const repository = createRepository();
    const wrapper = createWrapper();
    wrapper.wrapDataKey.mockRejectedValue(new Error('synthetic KMS outage'));
    const service = createService(repository, wrapper);

    await expect(
      service.create({ ...context(), body: { content: '不得降級明文' } }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'customer_notes_unavailable',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps exact update conflicts after producing a fresh envelope', async () => {
    const repository = createRepository();
    repository.update.mockRejectedValue(new CustomerNoteRepositoryError('note_conflict'));
    const wrapper = createWrapper();
    const service = createService(repository, wrapper);

    await expect(
      service.update({
        ...context(),
        noteId,
        body: {
          content: '更新內容',
          expectedUpdatedAt: createdAt.toISOString(),
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'customer_note_conflict',
    });
    expect(wrapper.wrapDataKey).toHaveBeenCalledOnce();
  });
});

function context() {
  return { tenantId, customerId, userId, requestId: 'request-notes' };
}

function createService(
  repository: ReturnType<typeof createRepository>,
  wrapper: ReturnType<typeof createWrapper>,
  config: RuntimeConfig = baseConfig,
): CustomerNotesApplicationService {
  return new CustomerNotesApplicationService(repository, createTenants('OWNER'), wrapper, config);
}

function createRepository() {
  return {
    listEnvelopes: vi.fn<CustomerNoteRepository['listEnvelopes']>(),
    create: vi.fn<CustomerNoteRepository['create']>(),
    update: vi.fn<CustomerNoteRepository['update']>(),
    delete: vi.fn<CustomerNoteRepository['delete']>(),
  };
}

function createWrapper() {
  return {
    wrapDataKey: vi
      .fn<CustomerNoteDataKeyWrapper['wrapDataKey']>()
      .mockImplementation((plaintextDataKey) =>
        Promise.resolve({
          wrappedDataKey: Uint8Array.from(plaintextDataKey),
          kekResourceVersion: 'test-kek-version-1',
        }),
      ),
    unwrapDataKey: vi
      .fn<CustomerNoteDataKeyWrapper['unwrapDataKey']>()
      .mockImplementation(({ wrappedDataKey }) => Promise.resolve(Uint8Array.from(wrappedDataKey))),
  };
}

function createTenants(role: 'OWNER' | 'MANAGER' | 'VIEWER' | 'STAFF' | null) {
  return {
    createTenantWithOwner: vi.fn<TenantRepository['createTenantWithOwner']>(),
    findActiveTenantMembership: vi
      .fn<TenantRepository['findActiveTenantMembership']>()
      .mockResolvedValue(
        role === null
          ? null
          : {
              tenant: {
                id: tenantId,
                name: '測試工作室',
                slug: 'test-studio',
                status: 'ACTIVE',
              },
              membership: { role, status: 'ACTIVE' },
            },
      ),
    listMembershipsForUser: vi.fn<TenantRepository['listMembershipsForUser']>(),
    recordAuthorizationDeniedIfTenantExists:
      vi.fn<TenantRepository['recordAuthorizationDeniedIfTenantExists']>(),
  };
}

function record(
  id: string,
  envelope: {
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly authTag: Uint8Array;
    readonly wrappedDek: Uint8Array;
    readonly kekResourceVersion: string;
    readonly encryptionSchemaVersion: number;
  } = {
    ciphertext: Buffer.from('ciphertext'),
    nonce: Buffer.alloc(12, 1),
    authTag: Buffer.alloc(16, 2),
    wrappedDek: Buffer.alloc(32, 3),
    kekResourceVersion: 'test-kek-version-1',
    encryptionSchemaVersion: 1,
  },
): CustomerNoteEnvelopeRecord {
  return { id, ...envelope, createdAt, updatedAt: createdAt };
}
