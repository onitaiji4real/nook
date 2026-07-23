import { describe, expect, it } from 'vitest';

import { buildBrowserRuntimeConfig } from '../src/lib/browser-runtime-config';

describe('buildBrowserRuntimeConfig', () => {
  it('returns only the public local-preview contract by default', () => {
    const config = buildBrowserRuntimeConfig({ NODE_ENV: 'test' });

    expect(config).toEqual({
      mode: 'disabled',
      apiBaseUrl: 'http://localhost:8080',
      capabilities: { bookingPolicyV2Writes: true, appointmentLifecycle: true },
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
});
