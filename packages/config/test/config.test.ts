import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '../src';

describe('parseRuntimeConfig', () => {
  it('applies safe local defaults', () => {
    expect(parseRuntimeConfig({}, { defaultPort: 8080 })).toEqual({
      nodeEnv: 'development',
      port: 8080,
      appVersion: 'dev',
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
