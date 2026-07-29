import { KeyManagementServiceClient } from '@google-cloud/kms';
import type { CustomerNoteDataKeyWrapper } from '@nook/crypto';
import crc32c from 'fast-crc32c';

const KMS_TIMEOUT_MILLISECONDS = 5_000;
const CRC32C_MAX = 0xffff_ffff;
const KMS_KEY_RESOURCE_PATTERN =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/asia-east1\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;

interface KmsChecksum {
  readonly value?: unknown;
}

interface KmsEncryptResponse {
  readonly name?: string | null;
  readonly ciphertext?: unknown;
  readonly ciphertextCrc32c?: KmsChecksum | null;
  readonly verifiedPlaintextCrc32c?: boolean | null;
}

interface KmsDecryptResponse {
  readonly plaintext?: unknown;
  readonly plaintextCrc32c?: KmsChecksum | null;
}

export interface CustomerNoteKmsClient {
  encrypt(
    request: {
      readonly name: string;
      readonly plaintext: Uint8Array;
      readonly plaintextCrc32c: { readonly value: number };
    },
    options: { readonly timeout: number },
  ): Promise<readonly [KmsEncryptResponse, ...unknown[]]>;
  decrypt(
    request: {
      readonly name: string;
      readonly ciphertext: Uint8Array;
      readonly ciphertextCrc32c: { readonly value: number };
    },
    options: { readonly timeout: number },
  ): Promise<readonly [KmsDecryptResponse, ...unknown[]]>;
}

export class GoogleKmsCustomerNoteDataKeyWrapper implements CustomerNoteDataKeyWrapper {
  private readonly keyVersionPattern: RegExp;

  constructor(
    private readonly keyResource: string,
    private readonly client: CustomerNoteKmsClient = new KeyManagementServiceClient() as unknown as CustomerNoteKmsClient,
  ) {
    if (!KMS_KEY_RESOURCE_PATTERN.test(keyResource)) {
      throw new Error('Invalid customer note KMS key resource.');
    }
    this.keyVersionPattern = new RegExp(
      `^${escapeRegularExpression(keyResource)}/cryptoKeyVersions/[1-9][0-9]*$`,
    );
  }

  async wrapDataKey(plaintextDataKey: Uint8Array): Promise<{
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }> {
    const plaintext = Uint8Array.from(plaintextDataKey);
    const checksum = crc32c.calculate(plaintext);
    const [response] = await this.client.encrypt(
      {
        name: this.keyResource,
        plaintext,
        plaintextCrc32c: { value: checksum },
      },
      { timeout: KMS_TIMEOUT_MILLISECONDS },
    );
    const ciphertext = requireBytes(response.ciphertext);
    const keyVersion = response.name;
    if (
      response.verifiedPlaintextCrc32c !== true ||
      typeof keyVersion !== 'string' ||
      !this.keyVersionPattern.test(keyVersion) ||
      readChecksum(response.ciphertextCrc32c) !== crc32c.calculate(ciphertext)
    ) {
      throw new Error('Cloud KMS encryption integrity verification failed.');
    }
    return {
      wrappedDataKey: Uint8Array.from(ciphertext),
      kekResourceVersion: keyVersion,
    };
  }

  async unwrapDataKey(input: {
    readonly wrappedDataKey: Uint8Array;
    readonly kekResourceVersion: string;
  }): Promise<Uint8Array> {
    if (!this.keyVersionPattern.test(input.kekResourceVersion)) {
      throw new Error('Customer note KMS key version is outside the configured key.');
    }
    const ciphertext = Uint8Array.from(input.wrappedDataKey);
    const [response] = await this.client.decrypt(
      {
        // Symmetric Decrypt accepts the CryptoKey resource. KMS selects the version
        // embedded in its ciphertext; the stored version remains custody evidence.
        name: this.keyResource,
        ciphertext,
        ciphertextCrc32c: { value: crc32c.calculate(ciphertext) },
      },
      { timeout: KMS_TIMEOUT_MILLISECONDS },
    );
    const responsePlaintext = requireBytes(response.plaintext);
    try {
      if (readChecksum(response.plaintextCrc32c) !== crc32c.calculate(responsePlaintext)) {
        throw new Error('Cloud KMS decryption integrity verification failed.');
      }
      return Uint8Array.from(responsePlaintext);
    } finally {
      responsePlaintext.fill(0);
    }
  }
}

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error('Cloud KMS returned an invalid byte response.');
  }
  return value;
}

function readChecksum(checksum: KmsChecksum | null | undefined): number | null {
  const value = Number(checksum?.value);
  return Number.isSafeInteger(value) && value >= 0 && value <= CRC32C_MAX ? value : null;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
