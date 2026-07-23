import { describe, expect, it } from 'vitest';

import { requireRequestId, safeRequestId, type RequestWithContext } from '../src/request-context';

describe('worker request context', () => {
  it('keeps bounded correlation IDs and replaces untrusted values', () => {
    expect(safeRequestId('cloud-task_123', () => 'generated')).toBe('cloud-task_123');
    expect(safeRequestId('Bearer secret token', () => 'generated')).toBe('generated');
    expect(safeRequestId('x'.repeat(129), () => 'generated')).toBe('generated');
  });

  it('requires middleware-owned context instead of rereading the request header', () => {
    expect(requireRequestId({ requestId: 'safe-id' } as RequestWithContext)).toBe('safe-id');
    expect(() => requireRequestId({} as RequestWithContext)).toThrowError(
      'request context middleware was not initialized',
    );
  });
});
