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
  });

  it('maps rejected Firebase tokens to a stable verification error', async () => {
    const adapter = new FirebaseIdentityAdapter({
      createCustomToken: vi.fn(),
      verifyIdToken: vi.fn().mockRejectedValue(new Error('provider detail')),
    });
    await expect(adapter.verify('rejected-token')).rejects.toMatchObject({ code: 'invalid_token' });
  });
});
