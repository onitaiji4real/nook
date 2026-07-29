import crc32c from 'fast-crc32c';
import { describe, expect, it, vi } from 'vitest';

import {
  GoogleKmsCustomerNoteDataKeyWrapper,
  type CustomerNoteKmsClient,
} from '../../../src/modules/consumer-crm/notes/google-kms-customer-note-key-wrapper';

const keyResource =
  'projects/nook-dev/locations/asia-east1/keyRings/customer-notes/cryptoKeys/note-kek';
const keyVersion = `${keyResource}/cryptoKeyVersions/7`;

describe('GoogleKmsCustomerNoteDataKeyWrapper', () => {
  it('wraps a data key with the configured key and verifies both CRC32C directions', async () => {
    const wrapped = Buffer.from('kms-wrapped-data-key');
    const client = fakeClient({
      encrypt: {
        name: keyVersion,
        ciphertext: wrapped,
        ciphertextCrc32c: { value: crc32c.calculate(wrapped) },
        verifiedPlaintextCrc32c: true,
      },
    });
    const wrapper = new GoogleKmsCustomerNoteDataKeyWrapper(keyResource, client);
    const plaintext = Buffer.alloc(32, 7);

    await expect(wrapper.wrapDataKey(plaintext)).resolves.toEqual({
      wrappedDataKey: Uint8Array.from(wrapped),
      kekResourceVersion: keyVersion,
    });
    expect(client.encrypt).toHaveBeenCalledWith(
      {
        name: keyResource,
        plaintext: Uint8Array.from(plaintext),
        plaintextCrc32c: { value: crc32c.calculate(plaintext) },
      },
      { timeout: 5_000 },
    );
  });

  it('only unwraps versions below the configured key and clears the response buffer', async () => {
    const plaintext = Buffer.alloc(32, 9);
    const expected = Uint8Array.from(plaintext);
    const client = fakeClient({
      decrypt: {
        plaintext,
        plaintextCrc32c: { value: crc32c.calculate(plaintext) },
      },
    });
    const wrapper = new GoogleKmsCustomerNoteDataKeyWrapper(keyResource, client);

    await expect(
      wrapper.unwrapDataKey({
        wrappedDataKey: Buffer.from('kms-wrapped-data-key'),
        kekResourceVersion: keyVersion,
      }),
    ).resolves.toEqual(expected);
    expect(plaintext.every((value) => value === 0)).toBe(true);
    expect(client.decrypt).toHaveBeenCalledWith(
      {
        name: keyResource,
        ciphertext: Uint8Array.from(Buffer.from('kms-wrapped-data-key')),
        ciphertextCrc32c: { value: crc32c.calculate(Buffer.from('kms-wrapped-data-key')) },
      },
      { timeout: 5_000 },
    );

    await expect(
      wrapper.unwrapDataKey({
        wrappedDataKey: Buffer.from('kms-wrapped-data-key'),
        kekResourceVersion:
          'projects/other1/locations/asia-east1/keyRings/customer-notes/cryptoKeys/note-kek/cryptoKeyVersions/7',
      }),
    ).rejects.toThrow('outside the configured key');
    expect(client.decrypt).toHaveBeenCalledTimes(1);
  });

  it('fails closed for invalid key resources or KMS integrity metadata', async () => {
    expect(
      () =>
        new GoogleKmsCustomerNoteDataKeyWrapper(
          `${keyResource}/cryptoKeyVersions/1`,
          fakeClient({}),
        ),
    ).toThrow('Invalid customer note KMS key resource');

    const plaintext = Buffer.alloc(32, 3);
    const invalidResponses = [
      {
        name: keyVersion,
        ciphertext: Buffer.from('wrapped'),
        ciphertextCrc32c: { value: 1 },
        verifiedPlaintextCrc32c: true,
      },
      {
        name: keyVersion,
        ciphertext: Buffer.from('wrapped'),
        ciphertextCrc32c: { value: crc32c.calculate(Buffer.from('wrapped')) },
        verifiedPlaintextCrc32c: false,
      },
      {
        name: `${keyResource}/cryptoKeyVersions/0`,
        ciphertext: Buffer.from('wrapped'),
        ciphertextCrc32c: { value: crc32c.calculate(Buffer.from('wrapped')) },
        verifiedPlaintextCrc32c: true,
      },
    ];

    for (const response of invalidResponses) {
      const wrapper = new GoogleKmsCustomerNoteDataKeyWrapper(
        keyResource,
        fakeClient({ encrypt: response }),
      );
      await expect(wrapper.wrapDataKey(plaintext)).rejects.toThrow('integrity verification failed');
    }

    const wrapper = new GoogleKmsCustomerNoteDataKeyWrapper(
      keyResource,
      fakeClient({
        decrypt: {
          plaintext,
          plaintextCrc32c: { value: 1 },
        },
      }),
    );
    await expect(
      wrapper.unwrapDataKey({
        wrappedDataKey: Buffer.from('wrapped'),
        kekResourceVersion: keyVersion,
      }),
    ).rejects.toThrow('integrity verification failed');
    expect(plaintext.every((value) => value === 0)).toBe(true);
  });
});

function fakeClient(input: {
  readonly encrypt?: {
    readonly name?: string;
    readonly ciphertext?: Uint8Array;
    readonly ciphertextCrc32c?: { readonly value: number };
    readonly verifiedPlaintextCrc32c?: boolean;
  };
  readonly decrypt?: {
    readonly plaintext?: Uint8Array;
    readonly plaintextCrc32c?: { readonly value: number };
  };
}): CustomerNoteKmsClient & {
  readonly encrypt: ReturnType<typeof vi.fn<CustomerNoteKmsClient['encrypt']>>;
  readonly decrypt: ReturnType<typeof vi.fn<CustomerNoteKmsClient['decrypt']>>;
} {
  const encrypt = vi.fn<CustomerNoteKmsClient['encrypt']>(() =>
    Promise.resolve([input.encrypt ?? {}]),
  );
  const decrypt = vi.fn<CustomerNoteKmsClient['decrypt']>(() =>
    Promise.resolve([input.decrypt ?? {}]),
  );
  return { encrypt, decrypt };
}
