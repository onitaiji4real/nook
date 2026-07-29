import { describe, expect, it, vi } from 'vitest';

import { LinePushClient, type LinePushFetch } from '../src';

function response(status: number, requestId: string | null = 'request-safe'): LinePushFetch {
  return vi.fn().mockResolvedValue({
    status,
    headers: { get: () => requestId },
  });
}

describe('LINE push client', () => {
  it.each([
    [200, { kind: 'accepted', httpStatus: 200, requestId: 'request-safe' }],
    [409, { kind: 'replayed', httpStatus: 409, requestId: 'request-safe' }],
    [408, { kind: 'retryable', httpStatus: 408, code: 'line_retryable_response' }],
    [425, { kind: 'retryable', httpStatus: 425, code: 'line_retryable_response' }],
    [429, { kind: 'retryable', httpStatus: 429, code: 'line_retryable_response' }],
    [503, { kind: 'retryable', httpStatus: 503, code: 'line_retryable_response' }],
    [400, { kind: 'terminal', httpStatus: 400, code: 'line_terminal_response' }],
    [302, { kind: 'terminal', httpStatus: 302, code: 'line_protocol_response' }],
    [201, { kind: 'terminal', httpStatus: 201, code: 'line_protocol_response' }],
  ] as const)('classifies HTTP %s', async (status, expected) => {
    const client = new LinePushClient({ accessToken: 'synthetic-token', fetch: response(status) });
    await expect(
      client.send({
        recipient: `U${'a'.repeat(32)}`,
        retryKey: '00000000-0000-4000-8000-000000000001',
        text: '預約已成立',
      }),
    ).resolves.toMatchObject(expected);
  });

  it('sends one fixed text message and retry key without following redirects', async () => {
    const fetcher = response(200, 'unsafe request id with spaces');
    const client = new LinePushClient({ accessToken: 'synthetic-token', fetch: fetcher });
    await client.send({
      recipient: `U${'a'.repeat(32)}`,
      retryKey: '00000000-0000-4000-8000-000000000001',
      text: '預約已成立',
    });
    const call = vi.mocked(fetcher).mock.calls[0];
    expect(call?.[0]).toBe('https://api.line.me/v2/bot/message/push');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: 'Bearer synthetic-token',
        'x-line-retry-key': '00000000-0000-4000-8000-000000000001',
      },
    });
    expect(JSON.parse(call?.[1].body ?? '{}')).toEqual({
      to: `U${'a'.repeat(32)}`,
      messages: [{ type: 'text', text: '預約已成立' }],
    });
  });

  it('maps timeout and network failures without reading provider bodies', async () => {
    const timeout: LinePushFetch = vi
      .fn()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const network: LinePushFetch = vi.fn().mockRejectedValue(new Error('synthetic network'));
    const input = {
      recipient: `U${'a'.repeat(32)}`,
      retryKey: '00000000-0000-4000-8000-000000000001',
      text: '預約已成立',
    };
    await expect(
      new LinePushClient({ accessToken: 'x', fetch: timeout }).send(input),
    ).resolves.toEqual({ kind: 'retryable', code: 'line_timeout' });
    await expect(
      new LinePushClient({ accessToken: 'x', fetch: network }).send(input),
    ).resolves.toEqual({ kind: 'retryable', code: 'line_network_error' });
  });
});
