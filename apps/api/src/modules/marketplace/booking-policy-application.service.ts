import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import { bookingPolicyUpdateRequestSchema, type BookingPolicyResponse } from '@nook/contracts';
import {
  BookingPolicyRepositoryError,
  type BookingPolicyRecord,
  type BookingPolicyRepository,
} from '@nook/database';
import { createApplicationOperationLog } from '@nook/observability';

import { ApplicationError } from '../../application-error';
import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { BOOKING_POLICY_REPOSITORY } from './marketplace.tokens';

@Injectable()
export class BookingPolicyApplicationService {
  constructor(
    @Inject(BOOKING_POLICY_REPOSITORY) private readonly policies: BookingPolicyRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async get(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  }): Promise<BookingPolicyResponse> {
    let safeTenantId: string | undefined;
    try {
      let result: Awaited<ReturnType<BookingPolicyRepository['getForMember']>>;
      try {
        result = await this.policies.getForMember(input);
      } catch (error) {
        throw mapError(error);
      }
      safeTenantId = input.tenantId;
      writeOperationLog({
        requestId: input.requestId,
        operation: 'booking_policy.get',
        outcome: 'success',
        httpStatus: 200,
        tenantId: safeTenantId,
      });
      return toResponse(result.policy);
    } catch (error) {
      writeOperationFailure(input.requestId, 'booking_policy.get', error, safeTenantId);
      throw error;
    }
  }

  async update(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly body: unknown;
  }): Promise<BookingPolicyResponse> {
    let safeTenantId: string | undefined;
    try {
      let access: Awaited<ReturnType<BookingPolicyRepository['getForMember']>>;
      try {
        access = await this.policies.getForMember(input);
      } catch (error) {
        throw mapError(error);
      }
      if (
        access.tenantStatus !== 'ACTIVE' ||
        (access.role !== 'OWNER' && access.role !== 'MANAGER')
      ) {
        throw forbidden();
      }
      safeTenantId = input.tenantId;
      if (!this.config.bookingPolicyV2WritesEnabled) {
        throw new ApplicationError(
          503,
          'booking_policy_update_unavailable',
          'Service Unavailable',
          'Booking policy updates are temporarily unavailable.',
        );
      }
      const body = bookingPolicyUpdateRequestSchema.safeParse(input.body);
      if (!body.success) {
        throw new ApplicationError(
          400,
          'invalid_request',
          'Bad Request',
          'The request is invalid.',
        );
      }
      let policy: BookingPolicyRecord;
      try {
        policy = await this.policies.update({
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          requestId: input.requestId,
          ...body.data,
        });
      } catch (error) {
        throw mapError(error);
      }
      writeOperationLog({
        requestId: input.requestId,
        operation: 'booking_policy.update',
        outcome: 'success',
        httpStatus: 200,
        tenantId: safeTenantId,
      });
      return toResponse(policy);
    } catch (error) {
      writeOperationFailure(input.requestId, 'booking_policy.update', error, safeTenantId);
      throw error;
    }
  }
}

function writeOperationFailure(
  requestId: string,
  operation: 'booking_policy.get' | 'booking_policy.update',
  error: unknown,
  tenantId: string | undefined,
): void {
  const httpStatus = error instanceof ApplicationError ? error.status : 500;
  writeOperationLog({
    requestId,
    operation,
    outcome: httpStatus >= 500 ? 'unavailable' : 'rejected',
    httpStatus,
    ...(tenantId === undefined ? {} : { tenantId }),
  });
}

function writeOperationLog(input: Parameters<typeof createApplicationOperationLog>[0]): void {
  process.stdout.write(`${JSON.stringify(createApplicationOperationLog(input))}\n`);
}

function toResponse(policy: BookingPolicyRecord): BookingPolicyResponse {
  return { ...policy, updatedAt: policy.updatedAt.toISOString() };
}

function mapError(error: unknown): Error {
  if (!(error instanceof BookingPolicyRepositoryError)) return error as Error;
  if (error.code === 'forbidden') return forbidden();
  if (error.code === 'booking_policy_revision_conflict') {
    return new ApplicationError(
      409,
      'booking_policy_revision_conflict',
      'Conflict',
      'The booking policy changed. Refresh and try again.',
    );
  }
  return new ApplicationError(
    503,
    'booking_policy_unavailable',
    'Service Unavailable',
    'The booking policy is temporarily unavailable.',
  );
}

function forbidden(): ApplicationError {
  return new ApplicationError(403, 'forbidden', 'Forbidden', 'This operation is not permitted.');
}
