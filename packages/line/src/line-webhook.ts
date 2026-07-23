import { createHmac, timingSafeEqual } from 'node:crypto';

export const lineWebhookMaxBytes = 256 * 1_024;
export const lineWebhookMaxEvents = 100;

export type LineWebhookEventType = 'follow' | 'unfollow' | 'other';

export interface ParsedLineWebhookEvent {
  readonly webhookEventId: string;
  readonly eventType: string;
  readonly routedType: LineWebhookEventType;
  readonly sourceType: 'user' | 'group' | 'room';
  readonly providerSubject?: string;
  readonly timestamp: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type LineRecipientEventStatus = 'FOLLOWING' | 'BLOCKED';

export interface LineRecipientObservation {
  readonly status: LineRecipientEventStatus;
  readonly timestamp: number;
  readonly webhookEventId: string;
}

export class LineWebhookError extends Error {
  constructor(
    readonly code: 'payload_too_large' | 'signature_invalid' | 'invalid_payload',
  ) {
    super(code);
    this.name = 'LineWebhookError';
  }
}

export function verifyLineWebhookSignature(
  rawBody: Uint8Array,
  signature: string | undefined,
  channelSecret: string,
): boolean {
  if (rawBody.byteLength > lineWebhookMaxBytes || signature === undefined || signature === '') {
    return false;
  }
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseVerifiedLineWebhook(
  rawBody: Uint8Array,
): readonly ParsedLineWebhookEvent[] {
  if (rawBody.byteLength > lineWebhookMaxBytes) throw new LineWebhookError('payload_too_large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
  } catch {
    throw new LineWebhookError('invalid_payload');
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.events) ||
    parsed.events.length > lineWebhookMaxEvents
  ) {
    throw new LineWebhookError('invalid_payload');
  }
  return parsed.events.map(parseEvent);
}

export function recipientObservation(
  event: ParsedLineWebhookEvent,
): LineRecipientObservation | null {
  if (event.routedType === 'other' || event.providerSubject === undefined) return null;
  return {
    status: event.routedType === 'follow' ? 'FOLLOWING' : 'BLOCKED',
    timestamp: event.timestamp,
    webhookEventId: event.webhookEventId,
  };
}

export function shouldApplyLineRecipientObservation(
  current: LineRecipientObservation | null,
  incoming: LineRecipientObservation,
): boolean {
  if (current === null) return true;
  if (incoming.timestamp !== current.timestamp) return incoming.timestamp > current.timestamp;
  if (incoming.status !== current.status) return incoming.status === 'BLOCKED';
  return incoming.webhookEventId > current.webhookEventId;
}

function parseEvent(value: unknown): ParsedLineWebhookEvent {
  if (!isRecord(value)) throw new LineWebhookError('invalid_payload');
  const webhookEventId = boundedString(value.webhookEventId, 128);
  const eventType = boundedString(value.type, 40);
  const timestamp = value.timestamp;
  const source = value.source;
  if (
    webhookEventId === null ||
    eventType === null ||
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isFinite(new Date(timestamp).getTime()) ||
    !isRecord(source)
  ) {
    throw new LineWebhookError('invalid_payload');
  }
  const sourceType = source.type;
  if (sourceType !== 'user' && sourceType !== 'group' && sourceType !== 'room') {
    throw new LineWebhookError('invalid_payload');
  }
  const routedType = eventType === 'follow' || eventType === 'unfollow' ? eventType : 'other';
  const providerSubject = sourceType === 'user' ? boundedString(source.userId, 33) : null;
  if (
    (sourceType === 'user' &&
      (providerSubject === null || !/^U[0-9a-f]{32}$/u.test(providerSubject))) ||
    (routedType !== 'other' && sourceType !== 'user')
  ) {
    throw new LineWebhookError('invalid_payload');
  }
  return {
    webhookEventId,
    eventType,
    routedType,
    sourceType,
    ...(providerSubject === null ? {} : { providerSubject }),
    timestamp,
    payload: value,
  };
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
