import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, parseWebRuntimeConfig } from '../src';

describe('parseRuntimeConfig', () => {
  it('applies safe local defaults', () => {
    expect(parseRuntimeConfig({}, { defaultPort: 8080 })).toEqual({
      nodeEnv: 'development',
      port: 8080,
      appVersion: 'dev',
      apiCorsAllowedOrigins: [],
      appointmentConfirmationEnabled: true,
      bookingPolicyV2WritesEnabled: true,
      appointmentLifecycleEnabled: true,
      crmProjectionMode: 'disabled',
      crmTagsMode: 'disabled',
      marketingConsentGrantEnabled: false,
      lineAuthRateLimit: {
        globalLimit: 120,
        tokenLimit: 5,
        windowSeconds: 60,
        bucketTtlSeconds: 600,
      },
      identity: { mode: 'disabled' },
      media: { mode: 'disabled' },
      notification: { mode: 'disabled' },
    });
  });

  it('treats blank optional identity values as absent while auth is disabled', () => {
    expect(
      parseRuntimeConfig(
        {
          AUTH_ADAPTER_MODE: 'disabled',
          LINE_CHANNEL_ID: '',
          IDENTITY_PLATFORM_PROJECT_ID: '  ',
          IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID: '',
        },
        { defaultPort: 8080 },
      ).identity,
    ).toEqual({ mode: 'disabled' });
  });

  it('requires complete identity configuration in firebase mode', () => {
    expect(() =>
      parseRuntimeConfig({ AUTH_ADAPTER_MODE: 'firebase' }, { defaultPort: 8080 }),
    ).toThrow('LINE_CHANNEL_ID');

    expect(
      parseRuntimeConfig(
        {
          AUTH_ADAPTER_MODE: 'firebase',
          LINE_CHANNEL_ID: 'synthetic-channel',
          IDENTITY_PLATFORM_PROJECT_ID: 'synthetic-project',
        },
        { defaultPort: 8080 },
      ).identity,
    ).toEqual({
      mode: 'firebase',
      lineChannelId: 'synthetic-channel',
      firebaseProjectId: 'synthetic-project',
    });

    expect(() =>
      parseRuntimeConfig(
        {
          AUTH_ADAPTER_MODE: 'firebase',
          LINE_CHANNEL_ID: '',
          IDENTITY_PLATFORM_PROJECT_ID: '',
        },
        { defaultPort: 8080 },
      ),
    ).toThrow('LINE_CHANNEL_ID');
  });

  it('fails closed when a database URL is required', () => {
    expect(() => parseRuntimeConfig({}, { defaultPort: 8080, requireDatabase: true })).toThrow();
  });

  it('keeps appointment confirmation disabled by default in deployed environments', () => {
    expect(
      parseRuntimeConfig({ NODE_ENV: 'staging' }, { defaultPort: 8080 })
        .appointmentConfirmationEnabled,
    ).toBe(false);
    expect(
      parseRuntimeConfig(
        { NODE_ENV: 'production', APPOINTMENT_CONFIRMATION_ENABLED: 'true' },
        { defaultPort: 8080 },
      ).appointmentConfirmationEnabled,
    ).toBe(true);
  });

  it('keeps lifecycle capabilities disabled by default in deployed environments', () => {
    expect(parseRuntimeConfig({ NODE_ENV: 'staging' }, { defaultPort: 8080 })).toMatchObject({
      bookingPolicyV2WritesEnabled: false,
      appointmentLifecycleEnabled: false,
    });
    expect(
      parseRuntimeConfig(
        {
          NODE_ENV: 'production',
          BOOKING_POLICY_V2_WRITES_ENABLED: 'true',
          APPOINTMENT_LIFECYCLE_ENABLED: 'true',
        },
        { defaultPort: 8080 },
      ),
    ).toMatchObject({
      bookingPolicyV2WritesEnabled: true,
      appointmentLifecycleEnabled: true,
    });
  });

  it('keeps CRM projection disabled by default and accepts explicit shadow or active mode', () => {
    expect(
      parseRuntimeConfig({ NODE_ENV: 'production' }, { defaultPort: 8081, service: 'worker' })
        .crmProjectionMode,
    ).toBe('disabled');
    expect(
      parseRuntimeConfig(
        { NODE_ENV: 'staging', CRM_PROJECTION_MODE: 'shadow' },
        { defaultPort: 8081, service: 'worker' },
      ).crmProjectionMode,
    ).toBe('shadow');
    expect(
      parseRuntimeConfig(
        { NODE_ENV: 'production', CRM_PROJECTION_MODE: 'active' },
        { defaultPort: 8081, service: 'worker' },
      ).crmProjectionMode,
    ).toBe('active');
  });

  it('keeps marketing consent grant disabled until the legal activation gate is approved', () => {
    expect(
      parseRuntimeConfig({ NODE_ENV: 'production' }, { defaultPort: 8080 })
        .marketingConsentGrantEnabled,
    ).toBe(false);
    expect(
      parseRuntimeConfig(
        { NODE_ENV: 'staging', MARKETING_CONSENT_GRANT_ENABLED: 'true' },
        { defaultPort: 8080 },
      ).marketingConsentGrantEnabled,
    ).toBe(true);
  });

  it('keeps customer tags disabled until taxonomy approval and accepts explicit activation', () => {
    expect(parseRuntimeConfig({ NODE_ENV: 'production' }, { defaultPort: 8080 }).crmTagsMode).toBe(
      'disabled',
    );
    expect(
      parseRuntimeConfig({ NODE_ENV: 'staging', CRM_TAGS_MODE: 'active' }, { defaultPort: 8080 })
        .crmTagsMode,
    ).toBe('active');
  });

  it('requires a complete GCP media configuration and only accepts HTTPS worker URLs', () => {
    expect(() => parseRuntimeConfig({ MEDIA_STORAGE_MODE: 'gcp' }, { defaultPort: 8080 })).toThrow(
      'GCP_PROJECT_ID',
    );
    expect(
      parseRuntimeConfig(
        {
          MEDIA_STORAGE_MODE: 'gcp',
          GCP_PROJECT_ID: 'synthetic-project',
          GCP_REGION: 'asia-east1',
          MEDIA_BUCKET: 'synthetic-private-bucket',
          MEDIA_TASK_QUEUE: 'nook-media',
          MEDIA_WORKER_URL: 'https://worker.example.test',
          MEDIA_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
        },
        { defaultPort: 8080 },
      ).media,
    ).toEqual({
      mode: 'gcp',
      projectId: 'synthetic-project',
      region: 'asia-east1',
      bucket: 'synthetic-private-bucket',
      taskQueue: 'nook-media',
      workerUrl: 'https://worker.example.test',
      taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
    });
    expect(() =>
      parseRuntimeConfig(
        {
          MEDIA_STORAGE_MODE: 'gcp',
          GCP_PROJECT_ID: 'synthetic-project',
          GCP_REGION: 'asia-east1',
          MEDIA_BUCKET: 'synthetic-private-bucket',
          MEDIA_TASK_QUEUE: 'nook-media',
          MEDIA_WORKER_URL: 'http://worker.example.test',
          MEDIA_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
        },
        { defaultPort: 8080 },
      ),
    ).toThrow();
  });

  it('keeps LINE messaging secrets isolated by service role', () => {
    expect(
      parseRuntimeConfig(
        {
          NOTIFICATION_MODE: 'line_push',
          LINE_MESSAGING_CHANNEL_SECRET: 'synthetic-channel-secret',
          LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'must-not-be-read-by-api',
        },
        { defaultPort: 8080, service: 'api' },
      ).notification,
    ).toEqual({
      mode: 'line_push',
      service: 'api',
      channelSecret: 'synthetic-channel-secret',
    });

    expect(
      parseRuntimeConfig(
        {
          NODE_ENV: 'production',
          NOTIFICATION_MODE: 'line_push',
          LINE_MESSAGING_CHANNEL_SECRET: 'must-not-be-read-by-worker',
          LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-access-token',
          GCP_PROJECT_ID: 'synthetic-project',
          GCP_REGION: 'asia-east1',
          NOTIFICATION_TASK_QUEUE: 'nook-notifications',
          NOTIFICATION_WORKER_URL: 'https://worker.nook.example',
          NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
          PUBLIC_WEB_BASE_URL: 'https://app.nook.example',
          LINE_MESSAGING_MONTHLY_CAP: '1000',
        },
        { defaultPort: 8081, service: 'worker' },
      ).notification,
    ).toEqual({
      mode: 'line_push',
      service: 'worker',
      accessToken: 'synthetic-access-token',
      projectId: 'synthetic-project',
      region: 'asia-east1',
      taskQueue: 'nook-notifications',
      workerUrl: 'https://worker.nook.example',
      taskInvokerServiceAccount: 'tasks@example.iam.gserviceaccount.com',
      publicWebBaseUrl: 'https://app.nook.example',
      monthlyCap: 1000,
    });
  });

  it('fails closed for incomplete or unsafe LINE messaging configuration', () => {
    expect(() =>
      parseRuntimeConfig({ NOTIFICATION_MODE: 'line_push' }, { defaultPort: 8080, service: 'api' }),
    ).toThrow('LINE_MESSAGING_CHANNEL_SECRET');
    expect(() =>
      parseRuntimeConfig(
        {
          NOTIFICATION_MODE: 'line_push',
          LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-access-token',
          GCP_PROJECT_ID: 'synthetic-project',
          GCP_REGION: 'asia-east1',
          NOTIFICATION_TASK_QUEUE: 'nook-notifications',
          NOTIFICATION_WORKER_URL: 'https://worker.nook.example',
          NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
          PUBLIC_WEB_BASE_URL: 'http://app.nook.example',
          LINE_MESSAGING_MONTHLY_CAP: '1000',
        },
        { defaultPort: 8081, service: 'worker' },
      ),
    ).toThrow('PUBLIC_WEB_BASE_URL');
    for (const workerUrl of [
      'https://worker.nook.example/internal/notifications/deliver',
      'https://worker.nook.example?target=other',
      'https://user:password@worker.nook.example',
      'http://worker.nook.example',
    ]) {
      expect(() =>
        parseRuntimeConfig(
          {
            NODE_ENV: 'production',
            NOTIFICATION_MODE: 'line_push',
            LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-access-token',
            GCP_PROJECT_ID: 'synthetic-project',
            GCP_REGION: 'asia-east1',
            NOTIFICATION_TASK_QUEUE: 'nook-notifications',
            NOTIFICATION_WORKER_URL: workerUrl,
            NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
            PUBLIC_WEB_BASE_URL: 'https://app.nook.example',
            LINE_MESSAGING_MONTHLY_CAP: '1000',
          },
          { defaultPort: 8081, service: 'worker' },
        ),
      ).toThrow('NOTIFICATION_WORKER_URL');
    }
    expect(
      parseRuntimeConfig(
        {
          NODE_ENV: 'development',
          NOTIFICATION_MODE: 'line_push',
          LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-access-token',
          GCP_PROJECT_ID: 'synthetic-project',
          GCP_REGION: 'asia-east1',
          NOTIFICATION_TASK_QUEUE: 'nook-notifications',
          NOTIFICATION_WORKER_URL: 'http://localhost:8081',
          NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT: 'tasks@example.iam.gserviceaccount.com',
          PUBLIC_WEB_BASE_URL: 'http://localhost:3000',
          LINE_MESSAGING_MONTHLY_CAP: '1000',
        },
        { defaultPort: 8081, service: 'worker' },
      ).notification,
    ).toMatchObject({ workerUrl: 'http://localhost:8081' });
    expect(() =>
      parseRuntimeConfig(
        { NOTIFICATION_MODE: 'line_push', LINE_MESSAGING_CHANNEL_SECRET: 'x' },
        { defaultPort: 8080 },
      ),
    ).toThrow('service');
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      parseRuntimeConfig(
        { DATABASE_URL: 'https://example.com/database' },
        { defaultPort: 8080, requireDatabase: true },
      ),
    ).toThrow();
  });

  it('parses exact CORS origins without enabling wildcard access', () => {
    expect(
      parseRuntimeConfig(
        {
          API_CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.nook.example',
        },
        { defaultPort: 8080 },
      ).apiCorsAllowedOrigins,
    ).toEqual(['http://localhost:3000', 'https://app.nook.example']);
  });

  it.each([
    '*',
    'https://*.nook.example',
    'https://app.nook.example/path',
    'https://user:password@app.nook.example',
    'javascript:alert(1)',
    'https://app.nook.example,https://app.nook.example',
  ])('rejects unsafe or non-origin CORS value %s', (value) => {
    expect(() =>
      parseRuntimeConfig({ API_CORS_ALLOWED_ORIGINS: value }, { defaultPort: 8080 }),
    ).toThrow('API_CORS_ALLOWED_ORIGINS');
  });

  it('parses bounded LINE exchange rate-limit settings', () => {
    expect(
      parseRuntimeConfig(
        {
          AUTH_LINE_EXCHANGE_GLOBAL_LIMIT: '240',
          AUTH_LINE_EXCHANGE_TOKEN_LIMIT: '8',
          AUTH_LINE_EXCHANGE_WINDOW_SECONDS: '120',
          AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS: '900',
        },
        { defaultPort: 8080 },
      ).lineAuthRateLimit,
    ).toEqual({
      globalLimit: 240,
      tokenLimit: 8,
      windowSeconds: 120,
      bucketTtlSeconds: 900,
    });
  });

  it.each([
    { AUTH_LINE_EXCHANGE_GLOBAL_LIMIT: '0' },
    { AUTH_LINE_EXCHANGE_TOKEN_LIMIT: '101' },
    { AUTH_LINE_EXCHANGE_WINDOW_SECONDS: '9' },
    {
      AUTH_LINE_EXCHANGE_WINDOW_SECONDS: '120',
      AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS: '60',
    },
  ])('rejects unsafe LINE exchange rate-limit settings %#', (environment) => {
    expect(() => parseRuntimeConfig(environment, { defaultPort: 8080 })).toThrow();
  });
});

describe('parseWebRuntimeConfig', () => {
  it('uses an explicit local-preview default without requiring provider configuration', () => {
    expect(parseWebRuntimeConfig({})).toEqual({
      nodeEnv: 'development',
      apiBaseUrl: 'http://localhost:8080',
      capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
      auth: { mode: 'disabled' },
    });
  });

  it('parses a complete Firebase and LINE public browser configuration', () => {
    expect(
      parseWebRuntimeConfig({
        NODE_ENV: 'production',
        WEB_AUTH_MODE: 'firebase-line',
        WEB_API_PUBLIC_BASE_URL: 'https://api.nook.example',
        LINE_LIFF_ID: '1234567890-AbCdEfGh',
        LINE_MERCHANT_LIFF_ID: '1234567890-Merchant',
        FIREBASE_WEB_API_KEY: 'public-key',
        FIREBASE_WEB_AUTH_DOMAIN: 'nook.firebaseapp.com',
        FIREBASE_WEB_PROJECT_ID: 'nook-production',
        FIREBASE_WEB_APP_ID: '1:1234567890:web:abcdef',
        FIREBASE_WEB_MESSAGING_SENDER_ID: '1234567890',
      }),
    ).toEqual({
      nodeEnv: 'production',
      apiBaseUrl: 'https://api.nook.example',
      capabilities: { bookingPolicyV2Writes: false, appointmentLifecycle: false },
      auth: {
        mode: 'firebase-line',
        liffId: '1234567890-AbCdEfGh',
        merchantLiffId: '1234567890-Merchant',
        firebase: {
          apiKey: 'public-key',
          authDomain: 'nook.firebaseapp.com',
          projectId: 'nook-production',
          appId: '1:1234567890:web:abcdef',
          messagingSenderId: '1234567890',
        },
      },
    });
  });

  it('fails closed when enabled auth is incomplete', () => {
    expect(() => parseWebRuntimeConfig({ WEB_AUTH_MODE: 'firebase-line' })).toThrow('LINE_LIFF_ID');
  });

  it('fails closed when the dedicated merchant LIFF app is missing', () => {
    expect(() =>
      parseWebRuntimeConfig({
        WEB_AUTH_MODE: 'firebase-line',
        LINE_LIFF_ID: '1234567890-Consumer',
      }),
    ).toThrow('LINE_MERCHANT_LIFF_ID');
  });

  it.each([
    { NODE_ENV: 'production', WEB_API_PUBLIC_BASE_URL: 'http://api.nook.example' },
    { NODE_ENV: 'staging', WEB_API_PUBLIC_BASE_URL: 'https://api.nook.example/path' },
    { NODE_ENV: 'production' },
  ])('rejects an unsafe deployed API origin %#', (environment) => {
    expect(() => parseWebRuntimeConfig(environment)).toThrow('WEB_API_PUBLIC_BASE_URL');
  });
});
