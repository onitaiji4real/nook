import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LineWebhookError,
  parseVerifiedLineWebhook,
  recipientObservation,
  shouldApplyLineRecipientObservation,
  verifyLineWebhookSignature,
} from '../src';

const subject = `U${'a'.repeat(32)}`;

function body(events: readonly unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ destination: `U${'b'.repeat(32)}`, events }));
}

function event(type: string, webhookEventId: string, timestamp = 1_700_000_000_000): unknown {
  return { type, webhookEventId, timestamp, source: { type: 'user', userId: subject } };
}

describe('LINE webhook boundary', () => {
  it('verifies the raw bytes before parsing', () => {
    const rawBody = body([event('follow', 'event-1')]);
    const signature = createHmac('sha256', 'synthetic-secret').update(rawBody).digest('base64');
    expect(verifyLineWebhookSignature(rawBody, signature, 'synthetic-secret')).toBe(true);
    expect(verifyLineWebhookSignature(rawBody, signature, 'other-secret')).toBe(false);
    expect(verifyLineWebhookSignature(rawBody, undefined, 'synthetic-secret')).toBe(false);
  });

  it('validates every event before returning an envelope', () => {
    const parsed = parseVerifiedLineWebhook(
      body([event('follow', 'event-1'), event('message', 'event-2')]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      routedType: 'follow',
      providerSubject: subject,
      webhookEventId: 'event-1',
    });
    expect(parsed[1]).toMatchObject({ routedType: 'other', webhookEventId: 'event-2' });
    expect(() =>
      parseVerifiedLineWebhook(body([event('follow', 'event-1'), { type: 'message' }])),
    ).toThrow(new LineWebhookError('invalid_payload'));
    expect(() =>
      parseVerifiedLineWebhook(
        body([event('follow', 'event-invalid-date', Number.MAX_SAFE_INTEGER)]),
      ),
    ).toThrow(new LineWebhookError('invalid_payload'));
  });

  it('keeps unfollow BLOCKED when equal-timestamp events arrive out of order', () => {
    const [follow] = parseVerifiedLineWebhook(body([event('follow', 'z-follow')]));
    const [unfollow] = parseVerifiedLineWebhook(body([event('unfollow', 'a-unfollow')]));
    if (follow === undefined || unfollow === undefined) throw new Error('fixture invalid');
    const following = recipientObservation(follow);
    const blocked = recipientObservation(unfollow);
    if (following === null || blocked === null) throw new Error('fixture invalid');
    expect(shouldApplyLineRecipientObservation(following, blocked)).toBe(true);
    expect(shouldApplyLineRecipientObservation(blocked, following)).toBe(false);
    expect(
      shouldApplyLineRecipientObservation(blocked, {
        ...blocked,
        timestamp: blocked.timestamp + 1,
        status: 'FOLLOWING',
      }),
    ).toBe(true);
  });

  it('rejects oversized bodies without parsing', () => {
    expect(() => parseVerifiedLineWebhook(Buffer.alloc(256 * 1_024 + 1))).toThrow(
      new LineWebhookError('payload_too_large'),
    );
  });
});
