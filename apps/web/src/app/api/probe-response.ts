import { randomUUID } from 'node:crypto';

import { createHealthResponse, type HealthStatus } from '@nook/contracts';
import { createRequestLog, redactValue } from '@nook/observability';
import { NextResponse } from 'next/server';

const validRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export function createWebProbeResponse(request: Request, status: HealthStatus): NextResponse {
  const startedAt = performance.now();
  const incomingRequestId = request.headers.get('x-request-id');
  const requestId =
    incomingRequestId !== null && validRequestId.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  const response = NextResponse.json(
    createHealthResponse({
      status,
      service: 'web',
      version: process.env.APP_VERSION ?? 'dev',
    }),
    {
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    },
  );

  const entry = createRequestLog({
    service: 'web',
    version: process.env.APP_VERSION ?? 'dev',
    environment: process.env.NODE_ENV ?? 'development',
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    statusCode: response.status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  });
  process.stdout.write(`${JSON.stringify(redactValue(entry))}\n`);

  return response;
}
