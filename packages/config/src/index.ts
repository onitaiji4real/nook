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
  readonly identity:
    | { readonly mode: 'disabled' }
    | {
        readonly mode: 'firebase';
        readonly lineChannelId: string;
        readonly firebaseProjectId: string;
        readonly firebaseServiceAccountId?: string;
      };
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
    AUTH_ADAPTER_MODE: z.enum(['disabled', 'firebase']).default('disabled'),
    LINE_CHANNEL_ID: z.string().trim().min(1).optional(),
    IDENTITY_PLATFORM_PROJECT_ID: z.string().trim().min(1).optional(),
    IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID: z.string().email().optional(),
  });

  const parsed = schema.parse(environment);

  const identity =
    parsed.AUTH_ADAPTER_MODE === 'disabled'
      ? ({ mode: 'disabled' } as const)
      : ({
          mode: 'firebase',
          lineChannelId: requireIdentityValue(parsed.LINE_CHANNEL_ID, 'LINE_CHANNEL_ID'),
          firebaseProjectId: requireIdentityValue(
            parsed.IDENTITY_PLATFORM_PROJECT_ID,
            'IDENTITY_PLATFORM_PROJECT_ID',
          ),
          ...(parsed.IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID === undefined
            ? {}
            : { firebaseServiceAccountId: parsed.IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID }),
        } as const);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appVersion: parsed.APP_VERSION,
    ...(parsed.DATABASE_URL === undefined ? {} : { databaseUrl: parsed.DATABASE_URL }),
    identity,
  };
}

function requireIdentityValue(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required when AUTH_ADAPTER_MODE=firebase.`);
  }
  return value;
}
