import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '../src';

describe('parseRuntimeConfig', () => {
  it('applies safe local defaults', () => {
    expect(parseRuntimeConfig({}, { defaultPort: 8080 })).toEqual({
      nodeEnv: 'development',
      port: 8080,
      appVersion: 'dev',
      identity: { mode: 'disabled' },
    });
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
  });

  it('fails closed when a database URL is required', () => {
    expect(() => parseRuntimeConfig({}, { defaultPort: 8080, requireDatabase: true })).toThrow();
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      parseRuntimeConfig(
        { DATABASE_URL: 'https://example.com/database' },
        { defaultPort: 8080, requireDatabase: true },
      ),
    ).toThrow();
  });
});
