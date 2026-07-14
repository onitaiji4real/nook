const sensitiveKeyPattern =
  /authorization|cookie|credential|customer.*note|database.*url|email|password|phone|secret|token/i;
const postgresUrlPattern = /postgres(?:ql)?:\/\/[^\s"']+/gi;
const bearerPattern = /bearer\s+[a-z0-9._~+/-]+=*/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function redactString(value: string): string {
  return value
    .replace(postgresUrlPattern, '[REDACTED_DATABASE_URL]')
    .replace(bearerPattern, 'Bearer [REDACTED]')
    .replace(emailPattern, '[REDACTED_EMAIL]');
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactValue(nestedValue),
    ]),
  );
}

export interface RequestLogInput {
  readonly service: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export function createRequestLog(input: RequestLogInput): Record<string, unknown> {
  return {
    severity: input.statusCode >= 500 ? 'ERROR' : 'INFO',
    event: 'http.request.completed',
    ...input,
  };
}
