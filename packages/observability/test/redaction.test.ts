import { describe, expect, it } from 'vitest';

import { createRequestLog, redactValue } from '../src';

describe('redactValue', () => {
  it('redacts secrets, PII, and database URLs recursively', () => {
    const databaseUrl = 'postgresql://nook:password@localhost:5432/nook';
    const serialized = JSON.stringify(
      redactValue({
        databaseUrl,
        message: `connection failed for ${databaseUrl}`,
        nested: { email: 'customer@example.com', authorization: 'Bearer abc.def' },
      }),
    );

    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('abc.def');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('createRequestLog', () => {
  it('includes the release and correlation dimensions required by operations', () => {
    expect(
      createRequestLog({
        service: 'api',
        version: 'synthetic-sha',
        environment: 'staging',
        requestId: 'request-123',
        method: 'GET',
        path: '/health',
        statusCode: 200,
        durationMs: 1.25,
      }),
    ).toMatchObject({
      service: 'api',
      version: 'synthetic-sha',
      environment: 'staging',
      requestId: 'request-123',
      operation: 'http.request',
      outcome: 'success',
    });
  });

  it('marks server errors as failed operations', () => {
    expect(
      createRequestLog({
        service: 'worker',
        version: 'synthetic-sha',
        environment: 'staging',
        requestId: 'request-500',
        method: 'GET',
        path: '/ready',
        statusCode: 503,
        durationMs: 2.5,
      }),
    ).toMatchObject({
      severity: 'ERROR',
      operation: 'http.request',
      outcome: 'failure',
    });
  });

  it('marks rejected client requests as failed operations without inflating error severity', () => {
    expect(
      createRequestLog({
        service: 'api',
        version: 'synthetic-sha',
        environment: 'staging',
        requestId: 'request-401',
        method: 'GET',
        path: '/v1/me',
        statusCode: 401,
        durationMs: 1,
      }),
    ).toMatchObject({
      severity: 'INFO',
      operation: 'http.request',
      outcome: 'failure',
    });
  });
});
