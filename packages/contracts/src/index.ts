export type HealthStatus = 'ok' | 'ready' | 'unavailable';

export interface HealthResponse {
  readonly status: HealthStatus;
  readonly service: string;
  readonly version: string;
  readonly timestamp: string;
}

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
