import type { BrowserRuntimeConfigResponse } from '@nook/contracts';
import { parseWebRuntimeConfig } from '@nook/config';

export function buildBrowserRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): BrowserRuntimeConfigResponse {
  const config = parseWebRuntimeConfig(environment);
  if (config.auth.mode === 'disabled') {
    return {
      mode: 'disabled',
      apiBaseUrl: config.apiBaseUrl,
      capabilities: config.capabilities,
    };
  }

  return {
    mode: 'firebase-line',
    apiBaseUrl: config.apiBaseUrl,
    capabilities: config.capabilities,
    liffId: config.auth.liffId,
    merchantLiffId: config.auth.merchantLiffId,
    firebase: config.auth.firebase,
  };
}
