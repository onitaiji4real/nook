import { parseRuntimeConfig } from '@nook/config';

export const runtimeConfig = parseRuntimeConfig(process.env, {
  defaultPort: 8081,
  requireDatabase: true,
});
