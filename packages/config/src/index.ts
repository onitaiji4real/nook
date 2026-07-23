import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'staging', 'production'] as const;
const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);
const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().email().optional(),
);

export interface RuntimeConfigOptions {
  readonly defaultPort: number;
  readonly requireDatabase?: boolean;
  readonly service?: 'api' | 'worker';
}

export interface RuntimeConfig {
  readonly nodeEnv: (typeof nodeEnvironments)[number];
  readonly port: number;
  readonly appVersion: string;
  readonly databaseUrl?: string;
  readonly apiCorsAllowedOrigins: readonly string[];
  readonly appointmentConfirmationEnabled: boolean;
  readonly bookingPolicyV2WritesEnabled: boolean;
  readonly appointmentLifecycleEnabled: boolean;
  readonly lineAuthRateLimit: {
    readonly globalLimit: number;
    readonly tokenLimit: number;
    readonly windowSeconds: number;
    readonly bucketTtlSeconds: number;
  };
  readonly identity:
    | { readonly mode: 'disabled' }
    | {
        readonly mode: 'firebase';
        readonly lineChannelId: string;
        readonly firebaseProjectId: string;
        readonly firebaseServiceAccountId?: string;
      };
  readonly media:
    | { readonly mode: 'disabled' }
    | {
        readonly mode: 'gcp';
        readonly projectId: string;
        readonly region: string;
        readonly bucket: string;
        readonly taskQueue: string;
        readonly workerUrl: string;
        readonly taskInvokerServiceAccount: string;
      };
  readonly notification:
    | { readonly mode: 'disabled' }
    | {
        readonly mode: 'line_push';
        readonly service: 'api';
        readonly channelSecret: string;
      }
    | {
        readonly mode: 'line_push';
        readonly service: 'worker';
        readonly accessToken: string;
        readonly projectId: string;
        readonly region: string;
        readonly taskQueue: string;
        readonly workerUrl: string;
        readonly taskInvokerServiceAccount: string;
        readonly publicWebBaseUrl: string;
        readonly monthlyCap: number;
      };
}

export interface WebRuntimeConfig {
  readonly nodeEnv: (typeof nodeEnvironments)[number];
  readonly apiBaseUrl: string;
  readonly capabilities: {
    readonly bookingPolicyV2Writes: boolean;
    readonly appointmentLifecycle: boolean;
  };
  readonly auth:
    | { readonly mode: 'disabled' }
    | {
        readonly mode: 'firebase-line';
        readonly liffId: string;
        readonly firebase: {
          readonly apiKey: string;
          readonly authDomain: string;
          readonly projectId: string;
          readonly appId: string;
          readonly messagingSenderId: string;
        };
      };
}

export function parseWebRuntimeConfig(environment: NodeJS.ProcessEnv): WebRuntimeConfig {
  const schema = z.object({
    NODE_ENV: z.enum(nodeEnvironments).default('development'),
    WEB_AUTH_MODE: z.enum(['disabled', 'firebase-line']).default('disabled'),
    WEB_API_PUBLIC_BASE_URL: optionalNonEmptyString,
    WEB_BOOKING_POLICY_V2_WRITES_ENABLED: z.enum(['true', 'false']).optional(),
    WEB_APPOINTMENT_LIFECYCLE_ENABLED: z.enum(['true', 'false']).optional(),
    LINE_LIFF_ID: optionalNonEmptyString,
    FIREBASE_WEB_API_KEY: optionalNonEmptyString,
    FIREBASE_WEB_AUTH_DOMAIN: optionalNonEmptyString,
    FIREBASE_WEB_PROJECT_ID: optionalNonEmptyString,
    FIREBASE_WEB_APP_ID: optionalNonEmptyString,
    FIREBASE_WEB_MESSAGING_SENDER_ID: optionalNonEmptyString,
  });

  const parsed = schema.parse(environment);
  const apiBaseUrl =
    parsed.WEB_API_PUBLIC_BASE_URL ??
    (['development', 'test'].includes(parsed.NODE_ENV) ? 'http://localhost:8080' : undefined);
  if (apiBaseUrl === undefined) {
    throw new Error('WEB_API_PUBLIC_BASE_URL is required outside development and test.');
  }
  validateWebApiOrigin(apiBaseUrl, parsed.NODE_ENV);

  const auth =
    parsed.WEB_AUTH_MODE === 'disabled'
      ? ({ mode: 'disabled' } as const)
      : ({
          mode: 'firebase-line',
          liffId: requireWebIdentityValue(parsed.LINE_LIFF_ID, 'LINE_LIFF_ID'),
          firebase: {
            apiKey: requireWebIdentityValue(parsed.FIREBASE_WEB_API_KEY, 'FIREBASE_WEB_API_KEY'),
            authDomain: requireWebIdentityValue(
              parsed.FIREBASE_WEB_AUTH_DOMAIN,
              'FIREBASE_WEB_AUTH_DOMAIN',
            ),
            projectId: requireWebIdentityValue(
              parsed.FIREBASE_WEB_PROJECT_ID,
              'FIREBASE_WEB_PROJECT_ID',
            ),
            appId: requireWebIdentityValue(parsed.FIREBASE_WEB_APP_ID, 'FIREBASE_WEB_APP_ID'),
            messagingSenderId: requireWebIdentityValue(
              parsed.FIREBASE_WEB_MESSAGING_SENDER_ID,
              'FIREBASE_WEB_MESSAGING_SENDER_ID',
            ),
          },
        } as const);

  const localCapabilities = ['development', 'test'].includes(parsed.NODE_ENV);
  const capabilities = {
    bookingPolicyV2Writes:
      parsed.WEB_BOOKING_POLICY_V2_WRITES_ENABLED === undefined
        ? localCapabilities
        : parsed.WEB_BOOKING_POLICY_V2_WRITES_ENABLED === 'true',
    appointmentLifecycle:
      parsed.WEB_APPOINTMENT_LIFECYCLE_ENABLED === undefined
        ? localCapabilities
        : parsed.WEB_APPOINTMENT_LIFECYCLE_ENABLED === 'true',
  };

  return { nodeEnv: parsed.NODE_ENV, apiBaseUrl, capabilities, auth };
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
    LINE_CHANNEL_ID: optionalNonEmptyString,
    IDENTITY_PLATFORM_PROJECT_ID: optionalNonEmptyString,
    IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID: optionalEmail,
    API_CORS_ALLOWED_ORIGINS: z.string().default(''),
    APPOINTMENT_CONFIRMATION_ENABLED: z.enum(['true', 'false']).optional(),
    BOOKING_POLICY_V2_WRITES_ENABLED: z.enum(['true', 'false']).optional(),
    APPOINTMENT_LIFECYCLE_ENABLED: z.enum(['true', 'false']).optional(),
    AUTH_LINE_EXCHANGE_GLOBAL_LIMIT: z.coerce.number().int().positive().max(10_000).default(120),
    AUTH_LINE_EXCHANGE_TOKEN_LIMIT: z.coerce.number().int().positive().max(100).default(5),
    AUTH_LINE_EXCHANGE_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
    MEDIA_STORAGE_MODE: z.enum(['disabled', 'gcp']).default('disabled'),
    GCP_PROJECT_ID: optionalNonEmptyString,
    GCP_REGION: optionalNonEmptyString,
    MEDIA_BUCKET: optionalNonEmptyString,
    MEDIA_TASK_QUEUE: optionalNonEmptyString,
    MEDIA_WORKER_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
      z.string().url().startsWith('https://').optional(),
    ),
    MEDIA_TASK_INVOKER_SERVICE_ACCOUNT: optionalEmail,
    NOTIFICATION_MODE: z.enum(['disabled', 'line_push']).default('disabled'),
    LINE_MESSAGING_CHANNEL_SECRET: optionalNonEmptyString,
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: optionalNonEmptyString,
    NOTIFICATION_TASK_QUEUE: optionalNonEmptyString,
    NOTIFICATION_WORKER_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
      z.string().url().optional(),
    ),
    NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT: optionalEmail,
    PUBLIC_WEB_BASE_URL: optionalNonEmptyString,
    LINE_MESSAGING_MONTHLY_CAP: z.coerce.number().int().positive().max(1_000_000).optional(),
  });

  const parsed = schema.parse(environment);
  const appointmentConfirmationEnabled =
    parsed.APPOINTMENT_CONFIRMATION_ENABLED === undefined
      ? ['development', 'test'].includes(parsed.NODE_ENV)
      : parsed.APPOINTMENT_CONFIRMATION_ENABLED === 'true';
  const localCapabilities = ['development', 'test'].includes(parsed.NODE_ENV);
  const bookingPolicyV2WritesEnabled =
    parsed.BOOKING_POLICY_V2_WRITES_ENABLED === undefined
      ? localCapabilities
      : parsed.BOOKING_POLICY_V2_WRITES_ENABLED === 'true';
  const appointmentLifecycleEnabled =
    parsed.APPOINTMENT_LIFECYCLE_ENABLED === undefined
      ? localCapabilities
      : parsed.APPOINTMENT_LIFECYCLE_ENABLED === 'true';
  if (parsed.AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS < parsed.AUTH_LINE_EXCHANGE_WINDOW_SECONDS) {
    throw new Error(
      'AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS must be greater than or equal to AUTH_LINE_EXCHANGE_WINDOW_SECONDS.',
    );
  }

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

  const media =
    parsed.MEDIA_STORAGE_MODE === 'disabled'
      ? ({ mode: 'disabled' } as const)
      : ({
          mode: 'gcp',
          projectId: requireMediaValue(parsed.GCP_PROJECT_ID, 'GCP_PROJECT_ID'),
          region: requireMediaValue(parsed.GCP_REGION, 'GCP_REGION'),
          bucket: requireMediaValue(parsed.MEDIA_BUCKET, 'MEDIA_BUCKET'),
          taskQueue: requireMediaValue(parsed.MEDIA_TASK_QUEUE, 'MEDIA_TASK_QUEUE'),
          workerUrl: requireMediaValue(parsed.MEDIA_WORKER_URL, 'MEDIA_WORKER_URL'),
          taskInvokerServiceAccount: requireMediaValue(
            parsed.MEDIA_TASK_INVOKER_SERVICE_ACCOUNT,
            'MEDIA_TASK_INVOKER_SERVICE_ACCOUNT',
          ),
        } as const);

  const notification = notificationConfig(parsed, options.service);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appVersion: parsed.APP_VERSION,
    ...(parsed.DATABASE_URL === undefined ? {} : { databaseUrl: parsed.DATABASE_URL }),
    apiCorsAllowedOrigins: parseAllowedOrigins(parsed.API_CORS_ALLOWED_ORIGINS),
    appointmentConfirmationEnabled,
    bookingPolicyV2WritesEnabled,
    appointmentLifecycleEnabled,
    lineAuthRateLimit: {
      globalLimit: parsed.AUTH_LINE_EXCHANGE_GLOBAL_LIMIT,
      tokenLimit: parsed.AUTH_LINE_EXCHANGE_TOKEN_LIMIT,
      windowSeconds: parsed.AUTH_LINE_EXCHANGE_WINDOW_SECONDS,
      bucketTtlSeconds: parsed.AUTH_RATE_LIMIT_BUCKET_TTL_SECONDS,
    },
    identity,
    media,
    notification,
  };
}

function notificationConfig(
  parsed: {
    readonly NODE_ENV: (typeof nodeEnvironments)[number];
    readonly NOTIFICATION_MODE: 'disabled' | 'line_push';
    readonly LINE_MESSAGING_CHANNEL_SECRET?: string | undefined;
    readonly LINE_MESSAGING_CHANNEL_ACCESS_TOKEN?: string | undefined;
    readonly GCP_PROJECT_ID?: string | undefined;
    readonly GCP_REGION?: string | undefined;
    readonly NOTIFICATION_TASK_QUEUE?: string | undefined;
    readonly NOTIFICATION_WORKER_URL?: string | undefined;
    readonly NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT?: string | undefined;
    readonly PUBLIC_WEB_BASE_URL?: string | undefined;
    readonly LINE_MESSAGING_MONTHLY_CAP?: number | undefined;
  },
  service: RuntimeConfigOptions['service'],
): RuntimeConfig['notification'] {
  if (parsed.NOTIFICATION_MODE === 'disabled') return { mode: 'disabled' };
  if (service === undefined) {
    throw new Error('service is required when NOTIFICATION_MODE=line_push.');
  }
  if (service === 'api') {
    return {
      mode: 'line_push',
      service,
      channelSecret: requireNotificationValue(
        parsed.LINE_MESSAGING_CHANNEL_SECRET,
        'LINE_MESSAGING_CHANNEL_SECRET',
      ),
    };
  }
  const publicWebBaseUrl = requireNotificationValue(
    parsed.PUBLIC_WEB_BASE_URL,
    'PUBLIC_WEB_BASE_URL',
  );
  const workerUrl = requireNotificationValue(
    parsed.NOTIFICATION_WORKER_URL,
    'NOTIFICATION_WORKER_URL',
  );
  validatePublicWebOrigin(publicWebBaseUrl, parsed.NODE_ENV);
  validateNotificationWorkerOrigin(workerUrl, parsed.NODE_ENV);
  return {
    mode: 'line_push',
    service,
    accessToken: requireNotificationValue(
      parsed.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN,
      'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
    ),
    projectId: requireNotificationValue(parsed.GCP_PROJECT_ID, 'GCP_PROJECT_ID'),
    region: requireNotificationValue(parsed.GCP_REGION, 'GCP_REGION'),
    taskQueue: requireNotificationValue(parsed.NOTIFICATION_TASK_QUEUE, 'NOTIFICATION_TASK_QUEUE'),
    workerUrl,
    taskInvokerServiceAccount: requireNotificationValue(
      parsed.NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT,
      'NOTIFICATION_TASK_INVOKER_SERVICE_ACCOUNT',
    ),
    publicWebBaseUrl,
    monthlyCap: requireNotificationNumber(
      parsed.LINE_MESSAGING_MONTHLY_CAP,
      'LINE_MESSAGING_MONTHLY_CAP',
    ),
  };
}

function parseAllowedOrigins(rawValue: string): readonly string[] {
  if (rawValue.trim().length === 0) {
    return [];
  }

  const origins = rawValue.split(',').map((value) => value.trim());
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`API_CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      origin.includes('*') ||
      url.origin !== origin ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      throw new Error(`API_CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins: ${origin}`);
    }
  }

  if (new Set(origins).size !== origins.length) {
    throw new Error('API_CORS_ALLOWED_ORIGINS must not contain duplicate origins.');
  }

  return origins;
}

function requireIdentityValue(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required when AUTH_ADAPTER_MODE=firebase.`);
  }
  return value;
}

function requireMediaValue(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required when MEDIA_STORAGE_MODE=gcp.`);
  }
  return value;
}

function requireNotificationValue(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required when NOTIFICATION_MODE=line_push.`);
  }
  return value;
}

function requireNotificationNumber(value: number | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(`${name} is required when NOTIFICATION_MODE=line_push.`);
  }
  return value;
}

function requireWebIdentityValue(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required when WEB_AUTH_MODE=firebase-line.`);
  }
  return value;
}

function validateWebApiOrigin(rawValue: string, nodeEnv: (typeof nodeEnvironments)[number]): void {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('WEB_API_PUBLIC_BASE_URL must be an exact HTTP(S) origin.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== rawValue ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('WEB_API_PUBLIC_BASE_URL must be an exact HTTP(S) origin.');
  }
  if (['staging', 'production'].includes(nodeEnv) && url.protocol !== 'https:') {
    throw new Error('WEB_API_PUBLIC_BASE_URL must use HTTPS in staging and production.');
  }
}

function validatePublicWebOrigin(
  rawValue: string,
  nodeEnv: (typeof nodeEnvironments)[number],
): void {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('PUBLIC_WEB_BASE_URL must be an exact HTTP(S) origin.');
  }
  const localHttp =
    ['development', 'test'].includes(nodeEnv) &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.origin !== rawValue ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('PUBLIC_WEB_BASE_URL must be an exact HTTPS origin.');
  }
}

function validateNotificationWorkerOrigin(
  rawValue: string,
  nodeEnv: (typeof nodeEnvironments)[number],
): void {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('NOTIFICATION_WORKER_URL must be an exact HTTP(S) origin.');
  }
  const localHttp =
    ['development', 'test'].includes(nodeEnv) &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.origin !== rawValue ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error('NOTIFICATION_WORKER_URL must be an exact HTTPS origin.');
  }
}
