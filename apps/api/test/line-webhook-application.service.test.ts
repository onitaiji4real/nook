import { createHmac } from 'node:crypto';

import { parseRuntimeConfig } from '@nook/config';
import type { LineWebhookRepository } from '@nook/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LineWebhookApplicationService } from '../src/modules/line-webhook/line-webhook-application.service';

const subject = `U${'a'.repeat(32)}`;

function config(mode: 'disabled' | 'line_push') {
  return parseRuntimeConfig(
    mode === 'disabled'
      ? {}
      : {
          NOTIFICATION_MODE: 'line_push',
          LINE_MESSAGING_CHANNEL_SECRET: 'synthetic-secret',
        },
    { defaultPort: 8080, service: 'api' },
  );
}

function createRepository() {
  const record = vi.fn().mockResolvedValue({ replayed: false, status: 'PROCESSED' });
  const value: LineWebhookRepository = {
    record,
    deleteExpired: vi.fn().mockResolvedValue(0),
  };
  return { value, record };
}

function rawBody(events: readonly unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ events }));
}

function signature(body: Uint8Array): string {
  return createHmac('sha256', 'synthetic-secret').update(body).digest('base64');
}

describe('LineWebhookApplicationService', () => {
  beforeEach(() => vi.spyOn(process.stdout, 'write').mockReturnValue(true));

  it('verifies then records each valid event without forwarding the envelope', async () => {
    const records = createRepository();
    const service = new LineWebhookApplicationService(records.value, config('line_push'));
    const body = rawBody([
      {
        type: 'follow',
        webhookEventId: 'event-1',
        timestamp: 1_700_000_000_000,
        source: { type: 'user', userId: subject },
      },
      {
        type: 'message',
        webhookEventId: 'event-2',
        timestamp: 1_700_000_000_001,
        source: { type: 'user', userId: subject },
      },
    ]);
    await expect(
      service.receive({ rawBody: body, signature: signature(body), requestId: 'request-1' }),
    ).resolves.toEqual({ accepted: true, processedCount: 2, replayedCount: 0 });
    expect(records.record).toHaveBeenCalledTimes(2);
    expect(records.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        webhookEventId: 'event-1',
        routedType: 'follow',
        providerSubject: subject,
      }),
    );
  });

  it('rejects an invalid signature before any database write', async () => {
    const records = createRepository();
    const service = new LineWebhookApplicationService(records.value, config('line_push'));
    await expect(
      service.receive({
        rawBody: rawBody([]),
        signature: 'invalid-signature',
        requestId: 'request-2',
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'line_webhook_signature_invalid',
    });
    expect(records.record).not.toHaveBeenCalled();
  });

  it('prevalidates the complete envelope before any database write', async () => {
    const records = createRepository();
    const service = new LineWebhookApplicationService(records.value, config('line_push'));
    const body = rawBody([
      {
        type: 'follow',
        webhookEventId: 'event-1',
        timestamp: 1_700_000_000_000,
        source: { type: 'user', userId: subject },
      },
      { type: 'message' },
    ]);
    await expect(
      service.receive({ rawBody: body, signature: signature(body), requestId: 'request-3' }),
    ).rejects.toMatchObject({ status: 400, code: 'line_webhook_payload_invalid' });
    expect(records.record).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversized body before signature verification or writes', async () => {
    const records = createRepository();
    const service = new LineWebhookApplicationService(records.value, config('line_push'));
    await expect(
      service.receive({
        rawBody: Buffer.alloc(256 * 1_024 + 1),
        signature: 'irrelevant',
        requestId: 'request-large',
      }),
    ).rejects.toMatchObject({ status: 413, code: 'line_webhook_payload_too_large' });
    expect(records.record).not.toHaveBeenCalled();
  });

  it('fails closed while notifications are disabled', async () => {
    const records = createRepository();
    const service = new LineWebhookApplicationService(records.value, config('disabled'));
    await expect(
      service.receive({ rawBody: rawBody([]), signature: 'x', requestId: 'request-4' }),
    ).rejects.toMatchObject({ status: 503, code: 'line_webhook_unavailable' });
    expect(records.record).not.toHaveBeenCalled();
  });
});
