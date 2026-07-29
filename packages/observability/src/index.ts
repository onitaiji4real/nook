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
  readonly version: string;
  readonly environment: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export function createRequestLog(input: RequestLogInput): Record<string, unknown> {
  const outcome = input.statusCode >= 400 ? 'failure' : 'success';

  return {
    severity: input.statusCode >= 500 ? 'ERROR' : 'INFO',
    event: 'http.request.completed',
    operation: 'http.request',
    outcome,
    ...input,
  };
}

export type ApplicationOperation =
  | 'consumer.cancel'
  | 'consumer.reschedule'
  | 'merchant.cancel'
  | 'merchant.check_in'
  | 'merchant.complete'
  | 'merchant.no_show'
  | 'booking_policy.get'
  | 'booking_policy.update';

export interface ApplicationOperationLogInput {
  readonly requestId: string;
  readonly operation: ApplicationOperation;
  readonly outcome: 'success' | 'replayed' | 'rejected' | 'unavailable';
  readonly httpStatus: number;
  readonly tenantId?: string;
  readonly appointmentId?: string;
}

export function createApplicationOperationLog(
  input: ApplicationOperationLogInput,
): Record<string, unknown> {
  return {
    requestId: input.requestId,
    operation: input.operation,
    outcome: input.outcome,
    httpStatus: input.httpStatus,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.appointmentId === undefined ? {} : { appointmentId: input.appointmentId }),
  };
}

export interface SecurityEventLogInput {
  readonly event:
    | 'tenant.created'
    | 'authorization.denied'
    | 'merchant.onboarding.saved'
    | 'service.created'
    | 'service.updated'
    | 'service.status_changed'
    | 'service.reordered'
    | 'staff.created'
    | 'staff.updated'
    | 'staff.status_changed'
    | 'staff.reordered'
    | 'staff.weekly_schedule_replaced'
    | 'staff.exception_created'
    | 'staff.exception_updated'
    | 'staff.exception_status_changed'
    | 'portfolio.upload_intent_created'
    | 'portfolio.upload_completed'
    | 'portfolio.updated'
    | 'portfolio.reordered'
    | 'portfolio.deleted'
    | 'portfolio.publication_status_changed'
    | 'merchant.publication_status_changed'
    | 'crm.customer_list_read'
    | 'crm.customer_detail_viewed'
    | 'crm.customer_tags_listed'
    | 'crm.customer_tag_definition_created'
    | 'crm.customer_tag_definition_status_changed'
    | 'crm.customer_tag_attached'
    | 'crm.customer_tag_detached'
    | 'media.verification_succeeded'
    | 'media.verification_rejected';
  readonly requestId: string;
  readonly version: string;
  readonly environment: string;
  readonly actorUserId?: string;
  readonly tenantId: string;
  readonly outcome: 'success' | 'denied';
}

export function createSecurityEventLog(input: SecurityEventLogInput): Record<string, unknown> {
  return {
    severity: input.outcome === 'denied' ? 'WARNING' : 'INFO',
    service: 'api',
    operation: input.event,
    requestId: input.requestId,
    ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
    tenantId: input.tenantId,
    outcome: input.outcome,
  };
}
