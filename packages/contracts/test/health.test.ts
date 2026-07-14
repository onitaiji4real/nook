import { describe, expect, it } from 'vitest';

import { createHealthResponse } from '../src';

describe('createHealthResponse', () => {
  it('creates a stable UTC health contract', () => {
    expect(
      createHealthResponse({
        status: 'ok',
        service: 'api',
        version: 'abc123',
        now: new Date('2026-07-14T08:00:00+08:00'),
      }),
    ).toEqual({
      status: 'ok',
      service: 'api',
      version: 'abc123',
      timestamp: '2026-07-14T00:00:00.000Z',
    });
  });
});
