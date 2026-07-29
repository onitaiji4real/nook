import { randomUUID } from 'node:crypto';

import type { Request } from 'express';

const validRequestId = /^[A-Za-z0-9._-]{1,128}$/;

export interface RequestWithContext extends Request {
  requestId?: string;
}

export function safeRequestId(
  incoming: string | undefined,
  generate: () => string = randomUUID,
): string {
  return incoming !== undefined && validRequestId.test(incoming) ? incoming : generate();
}

export function requireRequestId(request: RequestWithContext): string {
  if (request.requestId === undefined) {
    throw new Error('request context middleware was not initialized');
  }
  return request.requestId;
}
