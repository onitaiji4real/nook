import { describe, expect, it } from 'vitest';

import { ApplicationError } from '../src/application-error';
import {
  decodeConsumerCursor,
  decodeMerchantCursor,
  encodeCursor,
} from '../src/modules/marketplace/appointment-view-application.service';

const id = '10000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-24T03:00:00.000Z';

describe('appointment view cursor', () => {
  it('round-trips a consumer cursor and binds it to the selected view', () => {
    const raw = encodeCursor({
      v: 1,
      kind: 'consumer',
      view: 'upcoming',
      asOf: timestamp,
      lastStartAt: timestamp,
      lastId: id,
    });
    expect(decodeConsumerCursor(raw, 'upcoming')).toMatchObject({ view: 'upcoming', lastId: id });
    expect(() => decodeConsumerCursor(raw, 'past')).toThrowError(ApplicationError);
  });

  it('binds merchant cursors to tenant and canonical filters', () => {
    const expected = {
      tenantId: id,
      from: '2026-07-20T00:00:00.000Z',
      to: '2026-07-27T00:00:00.000Z',
      staffId: null,
      status: null,
    } as const;
    const raw = encodeCursor({
      v: 1,
      kind: 'merchant',
      asOf: timestamp,
      ...expected,
      lastStartAt: timestamp,
      lastId: id,
    });
    expect(decodeMerchantCursor(raw, expected)).toMatchObject(expected);
    expect(() =>
      decodeMerchantCursor(raw, { ...expected, tenantId: id.replace(/1$/, '2') }),
    ).toThrow(ApplicationError);
  });

  it('rejects noncanonical base64url and extra JSON keys', () => {
    const raw = Buffer.from(
      JSON.stringify({
        v: 1,
        kind: 'consumer',
        view: 'upcoming',
        asOf: timestamp,
        lastStartAt: timestamp,
        lastId: id,
        consumerUserId: id,
      }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeConsumerCursor(raw, 'upcoming')).toThrow(ApplicationError);
    expect(() => decodeConsumerCursor(`${raw}=`, 'upcoming')).toThrow(ApplicationError);
  });
});
