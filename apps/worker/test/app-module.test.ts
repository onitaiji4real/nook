import type { RuntimeConfig } from '@nook/config';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeConfig = vi.hoisted(
  (): RuntimeConfig => ({
    nodeEnv: 'test',
    port: 8081,
    appVersion: 'test-sha',
    databaseUrl: 'postgresql://nook:nook@localhost:5432/nook',
    apiCorsAllowedOrigins: [],
    appointmentConfirmationEnabled: true,
    bookingPolicyV2WritesEnabled: true,
    appointmentLifecycleEnabled: true,
    crmProjectionMode: 'disabled',
    crmTagsMode: 'disabled',
    crmNotesMode: 'disabled',
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
  }),
);

vi.mock('../src/runtime-config', () => ({ runtimeConfig }));

import { AppModule } from '../src/app.module';

describe('worker AppModule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the shared runtime config for every feature module', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    expect(app).toBeDefined();
    await app.close();
  });
});
