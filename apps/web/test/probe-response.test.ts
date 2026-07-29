import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as health } from '../src/app/api/health/route';
import { GET as readiness } from '../src/app/api/readiness/route';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('web probe responses', () => {
  it('preserves a safe request ID and emits a correlated structured log', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = health(
      new Request('http://localhost/api/health', {
        headers: { 'x-request-id': 'health-check-123' },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'web',
    });
    expect(response.headers.get('x-request-id')).toBe('health-check-123');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const log = JSON.parse(String(writeSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(log).toMatchObject({
      service: 'web',
      requestId: 'health-check-123',
      operation: 'http.request',
      outcome: 'success',
      method: 'GET',
      path: '/api/health',
      statusCode: 200,
    });
  });

  it('replaces an unsafe request ID on readiness responses', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const response = readiness(
      new Request('http://localhost/api/readiness', {
        headers: { 'x-request-id': 'unsafe request id' },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      service: 'web',
    });
    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
