import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'staging', 'production'] as const;

export interface RuntimeConfigOptions {
  readonly defaultPort: number;
  readonly requireDatabase?: boolean;
}

export interface RuntimeConfig {
  readonly nodeEnv: (typeof nodeEnvironments)[number];
  readonly port: number;
  readonly appVersion: string;
  readonly databaseUrl?: string;
}

export function parseRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  options: RuntimeConfigOptions,
): RuntimeConfig {
  const schema = z.object({
    NODE_ENV: z.enum(nodeEnvironments).default('development'),
    PORT: z.coerce.number().int().positive().max(65_535).default(options.defaultPort),
    APP_VERSION: z.string().trim().min(1).default('dev'),
    DATABASE_URL: options.requireDatabase
      ? z.string().url().startsWith('postgresql://')
      : z.string().url().startsWith('postgresql://').optional(),
  });

  const parsed = schema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appVersion: parsed.APP_VERSION,
    ...(parsed.DATABASE_URL === undefined ? {} : { databaseUrl: parsed.DATABASE_URL }),
  };
}
