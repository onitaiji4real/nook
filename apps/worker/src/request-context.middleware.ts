import { createRequestLog, redactValue } from '@nook/observability';
import type { NextFunction, Request, Response } from 'express';

import { safeRequestId, type RequestWithContext } from './request-context';
import { runtimeConfig } from './runtime-config';

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction) {
  const requestId = safeRequestId(request.header('x-request-id'));
  const startedAt = performance.now();

  (request as RequestWithContext).requestId = requestId;
  response.setHeader('x-request-id', requestId);
  response.on('finish', () => {
    const entry = createRequestLog({
      service: 'worker',
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
