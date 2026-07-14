import { describe, expect, it, vi } from 'vitest';

import { LineIdTokenVerifier, LineVerificationError, type LineFetch } from '../src';

const now = 1_700_000_000_000;
const validPayload = {
  iss: 'https://access.line.me',
  aud: 'channel-123',
  sub: 'synthetic-subject',
  exp: now / 1_000 + 60,
  nonce: 'synthetic-nonce-1234',
  name: 'Synthetic User',
};

function response(payload: unknown, status = 200): LineFetch {
  return vi
    .fn()
    .mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(payload) });
}

describe('LineIdTokenVerifier', () => {
  it('verifies a synthetic LINE response and sends the raw token only to LINE', async () => {
    const fetcher = response(validPayload);
    const verifier = new LineIdTokenVerifier({
      channelId: 'channel-123',
      now: () => now,
      fetch: fetcher,
    });
    await expect(verifier.verify('synthetic.raw.token', 'synthetic-nonce-1234')).resolves.toEqual({
      subject: 'synthetic-subject',
      displayName: 'Synthetic User',
    });
    const call = vi.mocked(fetcher).mock.calls[0];
    expect(call?.[1].body.get('id_token')).toBe('synthetic.raw.token');
    expect(call?.[1].body.get('client_id')).toBe('channel-123');
  });

  it.each([
    ['expired', { ...validPayload, exp: now / 1_000 - 1 }, 'invalid_token'],
    ['wrong audience', { ...validPayload, aud: 'other-channel' }, 'invalid_token'],
    ['invalid nonce', { ...validPayload, nonce: 'other-nonce' }, 'invalid_nonce'],
  ])('rejects %s', async (_name, payload, code) => {
    const verifier = new LineIdTokenVerifier({
      channelId: 'channel-123',
      now: () => now,
      fetch: response(payload),
    });
    await expect(
      verifier.verify('synthetic.raw.token', 'synthetic-nonce-1234'),
    ).rejects.toMatchObject({ code });
  });

  it('maps a provider timeout without exposing provider details', async () => {
    const fetcher: LineFetch = vi
      .fn()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const verifier = new LineIdTokenVerifier({ channelId: 'channel-123', fetch: fetcher });
    await expect(verifier.verify('synthetic.raw.token', 'synthetic-nonce-1234')).rejects.toEqual(
      new LineVerificationError('provider_timeout'),
    );
  });
});
