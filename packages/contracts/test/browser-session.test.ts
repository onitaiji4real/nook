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

  it('accepts separate consumer and merchant LIFF identifiers', () => {
    expect(
      browserRuntimeConfigResponseSchema.parse({
        mode: 'firebase-line',
        apiBaseUrl: 'https://api.example.com',
        capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
        liffId: 'consumer-liff-id',
        merchantLiffId: 'merchant-liff-id',
        firebase: {
          apiKey: 'public-api-key',
          authDomain: 'example.firebaseapp.com',
          projectId: 'example',
          appId: 'firebase-app-id',
          messagingSenderId: '1234567890',
        },
      }),
    ).toMatchObject({
      liffId: 'consumer-liff-id',
      merchantLiffId: 'merchant-liff-id',
    });
  });

  it('rejects enabled runtime config without a merchant LIFF identifier', () => {
    expect(() =>
      browserRuntimeConfigResponseSchema.parse({
        mode: 'firebase-line',
        apiBaseUrl: 'https://api.example.com',
        capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
        liffId: 'consumer-liff-id',
        firebase: {
          apiKey: 'public-api-key',
          authDomain: 'example.firebaseapp.com',
          projectId: 'example',
          appId: 'firebase-app-id',
          messagingSenderId: '1234567890',
        },
      }),
    ).toThrow();
  });
});
