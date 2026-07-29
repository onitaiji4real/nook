import { randomUUID } from 'node:crypto';

import { createRequestLog, redactValue } from '@nook/observability';
import type { NextFunction, Request, Response } from 'express';

import type { RequestWithContext } from './request-context';
import { runtimeConfig } from '../config/runtime-config';

const validRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction) {
  const incoming = request.header('x-request-id');
  const requestId =
    incoming !== undefined && validRequestId.test(incoming) ? incoming : randomUUID();
  const startedAt = performance.now();

  (request as RequestWithContext).requestId = requestId;

  response.setHeader('x-request-id', requestId);
  response.on('finish', () => {
    const entry = createRequestLog({
      service: 'api',
      version: runtimeConfig.appVersion,
      environment: runtimeConfig.nodeEnv,
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
    process.stdout.write(`${JSON.stringify(redactValue(entry))}\n`);
  });

  next();
}
