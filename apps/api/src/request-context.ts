import type { AuthenticatedPrincipal } from '@nook/auth';
import type { Request } from 'express';

export interface RequestWithContext extends Request {
  requestId?: string;
  principal?: AuthenticatedPrincipal;
}

export function requireRequestId(request: RequestWithContext): string {
  if (request.requestId === undefined) {
    throw new Error('request context middleware was not initialized');
  }

  return request.requestId;
}

export function requirePrincipal(request: RequestWithContext): AuthenticatedPrincipal {
  if (request.principal === undefined) {
    throw new Error('authentication guard was not initialized');
  }

  return request.principal;
}
