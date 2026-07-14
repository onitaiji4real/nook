export type HealthStatus = 'ok' | 'ready' | 'unavailable';

export interface HealthResponse {
  readonly status: HealthStatus;
  readonly service: string;
  readonly version: string;
  readonly timestamp: string;
}

export type { ProblemDetails } from './problem-details';
export {
  lineExchangeRequestSchema,
  type LineExchangeRequest,
  type LineExchangeResponse,
} from './auth';
export {
  createTenantRequestSchema,
  tenantIdSchema,
  type CreateTenantRequest,
  type MeResponse,
  type TenantResponse,
} from './tenant';

export interface HealthResponseInput {
  readonly status: HealthStatus;
  readonly service: string;
  readonly version: string;
  readonly now?: Date;
}

export function createHealthResponse(input: HealthResponseInput): HealthResponse {
  return {
    status: input.status,
    service: input.service,
    version: input.version,
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}
