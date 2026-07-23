import { describe, expect, it } from 'vitest';

import { browserRuntimeConfigResponseSchema } from '../src';

describe('browserRuntimeConfigResponseSchema', () => {
  it('accepts preview mode without identity fields', () => {
    expect(
      browserRuntimeConfigResponseSchema.parse({
        mode: 'disabled',
        apiBaseUrl: 'http://localhost:8080',
        capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
      }),
    ).toEqual({
      mode: 'disabled',
      apiBaseUrl: 'http://localhost:8080',
      capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
    });
  });

  it('rejects undeclared credential-like fields', () => {
    expect(() =>
      browserRuntimeConfigResponseSchema.parse({
        mode: 'disabled',
        apiBaseUrl: 'http://localhost:8080',
        capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
        channelSecret: 'must-not-be-public',
      }),
    ).toThrow();
  });
});
