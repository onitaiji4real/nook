import { parseRuntimeConfig } from '@nook/config';

export const runtimeConfig = parseRuntimeConfig(process.env, {
  defaultPort: 8080,
  requireDatabase: true,
});
