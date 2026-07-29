import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const CUSTOMER_NOTE_AAD_SCHEMA = 'nook-customer-note-aad-v1' as const;
export const CUSTOMER_NOTE_ENCRYPTION_SCHEMA_VERSION = 1 as const;
export const CUSTOMER_NOTE_DATA_KEY_BYTES = 32;
export const CUSTOMER_NOTE_NONCE_BYTES = 12;
export const CUSTOMER_NOTE_AUTH_TAG_BYTES = 16;
export const CUSTOMER_NOTE_MAX_CODE_POINTS = 2_000;

export type CustomerNoteEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface CustomerNoteAadInput {
  readonly environment: CustomerNoteEnvironment;
  readonly tenantId: string;
  readonly customerId: string;
  readonly noteId: string;
  readonly encryptionSchemaVersion: typeof CUSTOMER_NOTE_ENCRYPTION_SCHEMA_VERSION;
}

export interface CustomerNoteEnvelope {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly kekResourceVersion: string;
  readonly encryptionSchemaVersion: typeof CUSTOMER_NOTE_ENCRYPTION_SCHEMA_VERSION;
}

export interface CustomerNoteDataKeyWrapper {
  wrapDataKey(plaintextDataKey: Uint8Array): Promise<{
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }>;
  unwrapDataKey(input: {
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }): Promise<Uint8Array>;
}

export type CustomerNoteEncryptionErrorCode =
  | 'invalid_plaintext'
  | 'key_unavailable'
  | 'invalid_envelope';

export class CustomerNoteEncryptionError extends Error {
  constructor(readonly code: CustomerNoteEncryptionErrorCode) {
    super(code);
    this.name = 'CustomerNoteEncryptionError';
  }
}

export function canonicalCustomerNoteAad(input: CustomerNoteAadInput): Uint8Array {
  return Buffer.from(
    JSON.stringify([
      CUSTOMER_NOTE_AAD_SCHEMA,
      input.environment,
      input.tenantId,
      input.customerId,
      input.noteId,
      input.encryptionSchemaVersion,
    ]),
    'utf8',
  );
}

export async function encryptCustomerNote(input: {
  readonly plaintext: string;
  readonly aad: CustomerNoteAadInput;
  readonly keyWrapper: CustomerNoteDataKeyWrapper;
  readonly randomSource?: ((size: number) => Uint8Array) | undefined;
}): Promise<CustomerNoteEnvelope> {
  requireValidPlaintext(input.plaintext);
  const generate = input.randomSource ?? randomBytes;
  const dataKey = Buffer.from(generate(CUSTOMER_NOTE_DATA_KEY_BYTES));
  const nonce = Buffer.from(generate(CUSTOMER_NOTE_NONCE_BYTES));
  if (
    dataKey.byteLength !== CUSTOMER_NOTE_DATA_KEY_BYTES ||
    nonce.byteLength !== CUSTOMER_NOTE_NONCE_BYTES
  ) {
    dataKey.fill(0);
    throw new CustomerNoteEncryptionError('key_unavailable');
  }

  try {
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonce, {
      authTagLength: CUSTOMER_NOTE_AUTH_TAG_BYTES,
    });
    cipher.setAAD(canonicalCustomerNoteAad(input.aad));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(input.plaintext, 'utf8')),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const wrapped = await input.keyWrapper.wrapDataKey(dataKey);
    if (!validWrappedKey(wrapped.wrappedDataKey, wrapped.kekResourceVersion)) {
      throw new CustomerNoteEncryptionError('key_unavailable');
    }
    return {
      ciphertext,
      nonce,
      authTag,
      wrappedDek: Buffer.from(wrapped.wrappedDataKey),
      kekResourceVersion: wrapped.kekResourceVersion,
      encryptionSchemaVersion: CUSTOMER_NOTE_ENCRYPTION_SCHEMA_VERSION,
    };
  } catch (error) {
    if (error instanceof CustomerNoteEncryptionError) throw error;
    throw new CustomerNoteEncryptionError('key_unavailable');
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptCustomerNote(input: {
  readonly envelope: CustomerNoteEnvelope;
  readonly aad: CustomerNoteAadInput;
  readonly keyWrapper: CustomerNoteDataKeyWrapper;
}): Promise<string> {
  if (!validEnvelope(input.envelope)) {
    throw new CustomerNoteEncryptionError('invalid_envelope');
  }

  let dataKey: Buffer;
  try {
    dataKey = Buffer.from(
      await input.keyWrapper.unwrapDataKey({
        wrappedDataKey: input.envelope.wrappedDek,
        kekResourceVersion: input.envelope.kekResourceVersion,
      }),
    );
  } catch {
    throw new CustomerNoteEncryptionError('key_unavailable');
  }
  if (dataKey.byteLength !== CUSTOMER_NOTE_DATA_KEY_BYTES) {
    dataKey.fill(0);
    throw new CustomerNoteEncryptionError('key_unavailable');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, input.envelope.nonce, {
      authTagLength: CUSTOMER_NOTE_AUTH_TAG_BYTES,
    });
    decipher.setAAD(canonicalCustomerNoteAad(input.aad));
    decipher.setAuthTag(input.envelope.authTag);
    const plaintextBytes = Buffer.concat([
      decipher.update(input.envelope.ciphertext),
      decipher.final(),
    ]);
    const plaintext = new TextDecoder('utf-8', { fatal: true }).decode(plaintextBytes);
    requireValidPlaintext(plaintext);
    return plaintext;
  } catch {
    throw new CustomerNoteEncryptionError('invalid_envelope');
  } finally {
    dataKey.fill(0);
  }
}

function requireValidPlaintext(value: string): void {
  const codePoints = Array.from(value).length;
  if (codePoints < 1 || codePoints > CUSTOMER_NOTE_MAX_CODE_POINTS || value.trim().length === 0) {
    throw new CustomerNoteEncryptionError('invalid_plaintext');
  }
}

function validWrappedKey(wrappedDataKey: Uint8Array, resourceVersion: string): boolean {
  return (
    wrappedDataKey.byteLength > 0 &&
    resourceVersion.length >= 1 &&
    Buffer.byteLength(resourceVersion, 'utf8') <= 512
  );
}

function validEnvelope(envelope: CustomerNoteEnvelope): boolean {
  return (
    envelope.encryptionSchemaVersion === CUSTOMER_NOTE_ENCRYPTION_SCHEMA_VERSION &&
    envelope.ciphertext.byteLength > 0 &&
    envelope.nonce.byteLength === CUSTOMER_NOTE_NONCE_BYTES &&
    envelope.authTag.byteLength === CUSTOMER_NOTE_AUTH_TAG_BYTES &&
    validWrappedKey(envelope.wrappedDek, envelope.kekResourceVersion)
  );
}
