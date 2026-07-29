import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalCustomerNoteAad,
  CustomerNoteEncryptionError,
  decryptCustomerNote,
  encryptCustomerNote,
  type CustomerNoteAadInput,
  type CustomerNoteDataKeyWrapper,
} from '../src';

const aad: CustomerNoteAadInput = {
  environment: 'test',
  tenantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  noteId: '00000000-0000-4000-8000-000000000003',
  encryptionSchemaVersion: 1,
};

describe('customer note envelope', () => {
  it('keeps the canonical AAD byte contract stable', () => {
    const bytes = canonicalCustomerNoteAad(aad);
    expect(Buffer.from(bytes).toString('utf8')).toBe(
      '["nook-customer-note-aad-v1","test","00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003",1]',
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'ce39d4176045cf54e4e67ac4580c0c8e75e4b3997426141b0435e3da1cc9efaf',
    );
  });

  it('round-trips UTF-8 plaintext without persisting the data key', async () => {
    const wrapper = new InMemoryKeyWrapper();
    const envelope = await encryptCustomerNote({
      plaintext: '喜歡自然透明感\n避免太厚重。',
      aad,
      keyWrapper: wrapper,
    });

    expect(envelope.nonce).toHaveLength(12);
    expect(envelope.authTag).toHaveLength(16);
    expect(envelope.wrappedDek).not.toHaveLength(0);
    expect(envelope.kekResourceVersion).toBe('test-kek-version-1');
    expect(Buffer.from(envelope.ciphertext).toString('utf8')).not.toContain('自然透明感');
    await expect(decryptCustomerNote({ envelope, aad, keyWrapper: wrapper })).resolves.toBe(
      '喜歡自然透明感\n避免太厚重。',
    );
  });

  it('rejects AAD and authentication tag tampering without returning partial plaintext', async () => {
    const wrapper = new InMemoryKeyWrapper();
    const envelope = await encryptCustomerNote({
      plaintext: '僅供授權店家查看',
      aad,
      keyWrapper: wrapper,
    });

    await expect(
      decryptCustomerNote({
        envelope,
        aad: { ...aad, customerId: '00000000-0000-4000-8000-000000000099' },
        keyWrapper: wrapper,
      }),
    ).rejects.toMatchObject({ code: 'invalid_envelope' });

    const changedTag = Uint8Array.from(envelope.authTag);
    changedTag[0] = changedTag[0]! ^ 0xff;
    await expect(
      decryptCustomerNote({
        envelope: { ...envelope, authTag: changedTag },
        aad,
        keyWrapper: wrapper,
      }),
    ).rejects.toMatchObject({ code: 'invalid_envelope' });
  });

  it('fails closed for unavailable wrappers and unbounded plaintext', async () => {
    const unavailable: CustomerNoteDataKeyWrapper = {
      wrapDataKey: () => Promise.reject(new Error('synthetic unavailable')),
      unwrapDataKey: () => Promise.reject(new Error('synthetic unavailable')),
    };
    await expect(
      encryptCustomerNote({ plaintext: 'test', aad, keyWrapper: unavailable }),
    ).rejects.toEqual(new CustomerNoteEncryptionError('key_unavailable'));
    await expect(
      encryptCustomerNote({ plaintext: '客'.repeat(2_001), aad, keyWrapper: unavailable }),
    ).rejects.toMatchObject({ code: 'invalid_plaintext' });
    await expect(
      encryptCustomerNote({ plaintext: ' \n\t ', aad, keyWrapper: unavailable }),
    ).rejects.toMatchObject({ code: 'invalid_plaintext' });
  });

  it('uses a fresh data key and nonce for every replacement', async () => {
    const wrapper = new InMemoryKeyWrapper();
    const first = await encryptCustomerNote({ plaintext: 'same', aad, keyWrapper: wrapper });
    const second = await encryptCustomerNote({ plaintext: 'same', aad, keyWrapper: wrapper });

    expect(Buffer.from(first.nonce).equals(second.nonce)).toBe(false);
    expect(Buffer.from(first.wrappedDek).equals(second.wrappedDek)).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(second.ciphertext)).toBe(false);
  });
});

class InMemoryKeyWrapper implements CustomerNoteDataKeyWrapper {
  private readonly keys = new Map<string, Uint8Array>();

  wrapDataKey(plaintextDataKey: Uint8Array): Promise<{
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }> {
    const id = createHash('sha256').update(plaintextDataKey).digest('hex');
    this.keys.set(id, Uint8Array.from(plaintextDataKey));
    return Promise.resolve({
      wrappedDataKey: Buffer.from(id, 'hex'),
      kekResourceVersion: 'test-kek-version-1',
    });
  }

  unwrapDataKey(input: {
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }): Promise<Uint8Array> {
    if (input.kekResourceVersion !== 'test-kek-version-1') {
      return Promise.reject(new Error('synthetic unavailable'));
    }
    const key = this.keys.get(Buffer.from(input.wrappedDataKey).toString('hex'));
    return key === undefined
      ? Promise.reject(new Error('synthetic unavailable'))
      : Promise.resolve(Uint8Array.from(key));
  }
}
