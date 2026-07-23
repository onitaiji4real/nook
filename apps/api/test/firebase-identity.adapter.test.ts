import { describe, expect, it, vi } from 'vitest';

import { FirebaseIdentityAdapter } from '../src/firebase-identity.adapter';

describe('FirebaseIdentityAdapter', () => {
  it('issues a one-hour custom token contract and verifies ID token uid', async () => {
    const auth = {
      createCustomToken: vi.fn().mockResolvedValue('synthetic-custom-token'),
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'local-user-id' }),
    };
    const adapter = new FirebaseIdentityAdapter(auth);
    await expect(adapter.issue('local-user-id')).resolves.toEqual({
      customToken: 'synthetic-custom-token',
      expiresIn: 3_600,
    });
    await expect(adapter.verify('synthetic-id-token')).resolves.toEqual({
      userId: 'local-user-id',
    });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('synthetic-id-token', true);
  });

  it.each([
    'auth/argument-error',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/invalid-id-token',
    'auth/tenant-id-mismatch',
    'auth/user-disabled',
    'auth/user-not-found',
  ])('maps rejected Firebase token code %s to invalid_token', async (code) => {
    const adapter = new FirebaseIdentityAdapter({
      createCustomToken: vi.fn(),
      verifyIdToken: vi.fn().mockRejectedValue({ code, message: 'provider detail' }),
    });
    await expect(adapter.verify('rejected-token')).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it.each([
    { code: 'auth/certificate-fetch-failed', message: 'provider detail' },
    { code: 'auth/insufficient-permission', message: 'provider detail' },
    { code: 'auth/internal-error', message: 'provider detail' },
    { code: 'app/network-error', message: 'provider detail' },
    new Error('network detail'),
  ])('maps provider/infrastructure failure to verifier_unavailable', async (error) => {
    const adapter = new FirebaseIdentityAdapter({
      createCustomToken: vi.fn(),
      verifyIdToken: vi.fn().mockRejectedValue(error),
    });

    await expect(adapter.verify('synthetic-token')).rejects.toMatchObject({
      code: 'verifier_unavailable',
    });
  });
});
