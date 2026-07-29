import { describe, expect, it } from 'vitest';

import { buildBrowserRuntimeConfig } from '../src/lib/browser-runtime-config';

describe('buildBrowserRuntimeConfig', () => {
  it('returns only the public local-preview contract by default', () => {
    const config = buildBrowserRuntimeConfig({ NODE_ENV: 'test' });

    expect(config).toEqual({
      mode: 'disabled',
      apiBaseUrl: 'http://localhost:8080',
      capabilities: {
        bookingPolicyV2Writes: true,
        appointmentLifecycle: true,
        customerNotes: false,
      },
    });
    expect(JSON.stringify(config)).not.toContain('secret');
    expect(JSON.stringify(config)).not.toContain('serviceAccount');
  });

  it('does not copy undeclared process environment values into the response', () => {
    const config = buildBrowserRuntimeConfig({
      NODE_ENV: 'test',
      LINE_CHANNEL_SECRET: 'never-public',
      GOOGLE_APPLICATION_CREDENTIALS: '/private/key.json',
    });

    expect(JSON.stringify(config)).not.toContain('never-public');
    expect(JSON.stringify(config)).not.toContain('/private/key.json');
  });

  it('returns separate public LIFF identifiers when browser identity is enabled', () => {
    const config = buildBrowserRuntimeConfig({
      NODE_ENV: 'production',
      WEB_AUTH_MODE: 'firebase-line',
      WEB_API_PUBLIC_BASE_URL: 'https://api.example.com',
      LINE_LIFF_ID: 'consumer-liff-id',
      LINE_MERCHANT_LIFF_ID: 'merchant-liff-id',
      FIREBASE_WEB_API_KEY: 'public-api-key',
      FIREBASE_WEB_AUTH_DOMAIN: 'example.firebaseapp.com',
      FIREBASE_WEB_PROJECT_ID: 'example',
      FIREBASE_WEB_APP_ID: 'firebase-app-id',
      FIREBASE_WEB_MESSAGING_SENDER_ID: '1234567890',
    });

    expect(config).toMatchObject({
      mode: 'firebase-line',
      liffId: 'consumer-liff-id',
      merchantLiffId: 'merchant-liff-id',
    });
    expect(JSON.stringify(config)).not.toContain('secret');
  });
});
