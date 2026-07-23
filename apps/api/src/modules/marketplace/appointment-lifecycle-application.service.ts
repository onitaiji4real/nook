import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  appointmentLifecycleIdempotencyKeySchema,
  canonicalAppointmentIdSchema,
  consumerCancelAppointmentRequestSchema,
  emptyAppointmentTransitionRequestSchema,
  merchantCancelAppointmentRequestSchema,
  rescheduleAppointmentRequestSchema,
  type AppointmentTransitionResponse,
  type MerchantCancelReason,
} from '@nook/contracts';
import {
  AppointmentLifecycleRepositoryError,
  type AppointmentLifecycleRepository,
  type AppointmentTransitionRecord,
  type MerchantSimpleAction,
} from '@nook/database';
import { createApplicationOperationLog, type ApplicationOperation } from '@nook/observability';

import { ApplicationError } from '../../application-error';
import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { APPOINTMENT_LIFECYCLE_REPOSITORY } from './marketplace.tokens';

type MerchantEndpoint =
  | 'merchant.cancel'
  | 'merchant.check_in'
  | 'merchant.complete'
  | 'merchant.no_show';

interface ConsumerTransitionInput {
  readonly actorUserId: string;
  readonly rawAppointmentId: string;
  readonly rawIdempotencyKey: unknown;
  readonly body: unknown;
  readonly requestId: string;
}

interface MerchantTransitionInput extends ConsumerTransitionInput {
  readonly tenantId: string;
  readonly endpoint: MerchantEndpoint;
}

@Injectable()
export class AppointmentLifecycleApplicationService {
  constructor(
    @Inject(APPOINTMENT_LIFECYCLE_REPOSITORY)
    private readonly lifecycle: AppointmentLifecycleRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async consumerCancel(input: ConsumerTransitionInput): Promise<AppointmentTransitionResponse> {
    let safeAppointmentId: string | undefined;
    try {
      this.requireEnabled();
      const appointmentId = parseAppointmentId(input.rawAppointmentId);
      try {
        await this.lifecycle.authorizeConsumerAppointment({
          actorUserId: input.actorUserId,
          appointmentId,
        });
      } catch (error) {
        throw mapError(error);
      }
      safeAppointmentId = appointmentId;
      const key = parseKey(input.rawIdempotencyKey);
      const body = consumerCancelAppointmentRequestSchema.safeParse(input.body);
      if (!body.success) invalidRequest();
      const fingerprint = transitionFingerprint({
        endpoint: 'consumer.cancel',
        tenantId: null,
        appointmentId,
        holdId: null,
        policyVersion: null,
        policiesAccepted: null,
        reasonCode: body.data.reasonCode,
      });
      let record: AppointmentTransitionRecord;
      try {
        record = await this.lifecycle.transitionConsumerCancel({
          actorUserId: input.actorUserId,
          appointmentId,
          reasonCode: body.data.reasonCode,
          keyHash: sha256(key),
          requestFingerprint: fingerprint,
          requestId: input.requestId,
        });
      } catch (error) {
        throw mapError(error);
      }
      this.writeOperationLog(
        input.requestId,
        'consumer.cancel',
        record,
        safeIds(undefined, safeAppointmentId),
      );
      return toResponse(record);
    } catch (error) {
      this.writeOperationFailure(
        input.requestId,
        'consumer.cancel',
        error,
        safeIds(undefined, safeAppointmentId),
      );
      throw error;
    }
  }

  async consumerReschedule(input: ConsumerTransitionInput): Promise<AppointmentTransitionResponse> {
    let safeAppointmentId: string | undefined;
    try {
      this.requireEnabled();
      const appointmentId = parseAppointmentId(input.rawAppointmentId);
      try {
        await this.lifecycle.authorizeConsumerAppointment({
          actorUserId: input.actorUserId,
          appointmentId,
        });
      } catch (error) {
        throw mapError(error);
      }
      safeAppointmentId = appointmentId;
      const key = parseKey(input.rawIdempotencyKey);
      const body = rescheduleAppointmentRequestSchema.safeParse(input.body);
      if (!body.success) invalidRequest();
      const fingerprint = sha256(
        JSON.stringify({
          version: 1,
          endpoint: 'consumer.reschedule',
          tenantId: null,
          appointmentId,
          holdId: body.data.holdId,
          policyVersion: body.data.policyVersion,
          policiesAccepted: body.data.policiesAccepted,
          reasonCode: body.data.reasonCode,
        }),
      );
      let outcome: Awaited<
        ReturnType<AppointmentLifecycleRepository['transitionConsumerReschedule']>
      >;
      try {
        outcome = await this.lifecycle.transitionConsumerReschedule({
          actorUserId: input.actorUserId,
          appointmentId,
          holdId: body.data.holdId,
          policyVersion: body.data.policyVersion,
          policiesAccepted: true,
          reasonCode: body.data.reasonCode,
          keyHash: sha256(key),
          requestFingerprint: fingerprint,
          requestId: input.requestId,
        });
      } catch (error) {
        throw mapError(error);
      }
      if (outcome.kind === 'target_expired') {
        throw new ApplicationError(
          409,
          'target_hold_expired',
          'Conflict',
          'The target booking hold has expired.',
        );
      }
      this.writeOperationLog(
        input.requestId,
        'consumer.reschedule',
        outcome.result,
        safeIds(undefined, safeAppointmentId),
      );
      return toResponse(outcome.result);
    } catch (error) {
      this.writeOperationFailure(
        input.requestId,
        'consumer.reschedule',
        error,
        safeIds(undefined, safeAppointmentId),
      );
      throw error;
    }
  }

  async merchantTransition(input: MerchantTransitionInput): Promise<AppointmentTransitionResponse> {
    let safeTenantId: string | undefined;
    let safeAppointmentId: string | undefined;
    try {
      try {
        await this.lifecycle.authorizeMerchant({
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
        });
      } catch (error) {
        throw mapError(error);
      }
      safeTenantId = input.tenantId;
      this.requireEnabled();
      const appointmentId = parseAppointmentId(input.rawAppointmentId);
      try {
        await this.lifecycle.authorizeMerchantAppointment({
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          appointmentId,
        });
      } catch (error) {
        throw mapError(error);
      }
      safeAppointmentId = appointmentId;
      const key = parseKey(input.rawIdempotencyKey);
      const parsedBody =
        input.endpoint === 'merchant.cancel'
          ? merchantCancelAppointmentRequestSchema.safeParse(input.body)
          : emptyAppointmentTransitionRequestSchema.safeParse(input.body);
      if (!parsedBody.success) invalidRequest();
      const reasonCode =
        input.endpoint === 'merchant.cancel'
          ? (
              parsedBody.data as {
                readonly reasonCode: MerchantCancelReason;
              }
            ).reasonCode
          : null;
      const action = merchantAction(input.endpoint);
      const fingerprint = transitionFingerprint({
        endpoint: input.endpoint,
        tenantId: input.tenantId,
        appointmentId,
        holdId: null,
        policyVersion: null,
        policiesAccepted: null,
        reasonCode,
      });
      let record: AppointmentTransitionRecord;
      try {
        record = await this.lifecycle.transitionMerchant({
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          appointmentId,
          action,
          reasonCode,
          keyHash: sha256(key),
          requestFingerprint: fingerprint,
          requestId: input.requestId,
        });
      } catch (error) {
        throw mapError(error);
      }
      this.writeOperationLog(
        input.requestId,
        input.endpoint,
        record,
        safeIds(safeTenantId, safeAppointmentId),
      );
      return toResponse(record);
    } catch (error) {
      this.writeOperationFailure(
        input.requestId,
        input.endpoint,
        error,
        safeIds(safeTenantId, safeAppointmentId),
      );
      throw error;
    }
  }

  private writeOperationLog(
    requestId: string,
    operation: ApplicationOperation,
    record: AppointmentTransitionRecord,
    safeIds: { readonly tenantId?: string; readonly appointmentId?: string },
  ): void {
    writeOperationLog({
      requestId,
      operation,
      outcome: record.replayed ? 'replayed' : 'success',
      httpStatus: 200,
      ...safeIds,
    });
  }

  private writeOperationFailure(
    requestId: string,
    operation: ApplicationOperation,
    error: unknown,
    safeIds: { readonly tenantId?: string; readonly appointmentId?: string },
  ): void {
    const httpStatus = error instanceof ApplicationError ? error.status : 500;
    writeOperationLog({
      requestId,
      operation,
      outcome: httpStatus >= 500 ? 'unavailable' : 'rejected',
      httpStatus,
      ...safeIds,
    });
  }

  private requireEnabled(): void {
    if (!this.config.appointmentLifecycleEnabled) {
      throw new ApplicationError(
        503,
        'appointment_lifecycle_unavailable',
        'Service Unavailable',
        'Appointment actions are temporarily unavailable.',
      );
    }
  }
}

function writeOperationLog(input: Parameters<typeof createApplicationOperationLog>[0]): void {
  process.stdout.write(`${JSON.stringify(createApplicationOperationLog(input))}\n`);
}

function safeIds(
  tenantId: string | undefined,
  appointmentId: string | undefined,
): { readonly tenantId?: string; readonly appointmentId?: string } {
  return {
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(appointmentId === undefined ? {} : { appointmentId }),
  };
}

function transitionFingerprint(input: {
  readonly endpoint: 'consumer.cancel' | MerchantEndpoint;
  readonly tenantId: string | null;
  readonly appointmentId: string;
  readonly holdId: null;
  readonly policyVersion: null;
  readonly policiesAccepted: null;
  readonly reasonCode: string | null;
}): string {
  return sha256(JSON.stringify({ version: 1, ...input }));
}

function merchantAction(endpoint: MerchantEndpoint): MerchantSimpleAction {
  const actions = {
    'merchant.cancel': 'MERCHANT_CANCEL',
    'merchant.check_in': 'MERCHANT_CHECK_IN',
    'merchant.complete': 'MERCHANT_COMPLETE',
    'merchant.no_show': 'MERCHANT_NO_SHOW',
  } as const;
  return actions[endpoint];
}

function toResponse(record: AppointmentTransitionRecord): AppointmentTransitionResponse {
  return {
    appointmentId: record.appointmentId,
    status: record.status,
    occurredAt: record.occurredAt.toISOString(),
    replacementAppointmentId: record.replacementAppointmentId,
  };
}

function parseAppointmentId(raw: string): string {
  const parsed = canonicalAppointmentIdSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw appointmentNotFound();
}

function parseKey(raw: unknown): string {
  const parsed = appointmentLifecycleIdempotencyKeySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return invalidRequest();
}

function mapError(error: unknown): Error {
  if (!(error instanceof AppointmentLifecycleRepositoryError)) return error as Error;
  const mapping = {
    account_inactive: [403, 'account_inactive', 'Forbidden', 'This account is inactive.'],
    forbidden: [403, 'forbidden', 'Forbidden', 'This operation is not permitted.'],
    appointment_not_found: [
      404,
      'appointment_not_found',
      'Not Found',
      'The appointment was not found.',
    ],
    idempotency_conflict: [
      409,
      'idempotency_conflict',
      'Conflict',
      'The idempotency key was already used for another request.',
    ],
    invalid_appointment_transition: [
      409,
      'invalid_appointment_transition',
      'Conflict',
      'The appointment cannot perform this action.',
    ],
    consumer_action_deadline_passed: [
      409,
      'consumer_action_deadline_passed',
      'Conflict',
      'The self-service deadline has passed. Please contact the merchant.',
    ],
    appointment_action_too_early: [
      409,
      'appointment_action_too_early',
      'Conflict',
      'This appointment action is not available yet.',
    ],
    target_hold_not_found: [
      404,
      'target_hold_not_found',
      'Not Found',
      'The target booking hold was not found.',
    ],
    target_hold_expired: [
      409,
      'target_hold_expired',
      'Conflict',
      'The target booking hold has expired.',
    ],
    target_hold_not_active: [
      409,
      'target_hold_not_active',
      'Conflict',
      'The target booking hold is not active.',
    ],
    policy_version_mismatch: [
      409,
      'policy_version_mismatch',
      'Conflict',
      'The accepted policy version does not match the booking hold.',
    ],
    policy_version_unsupported: [
      409,
      'policy_version_unsupported',
      'Conflict',
      'The target booking hold uses an unsupported policy version.',
    ],
    reschedule_target_mismatch: [
      409,
      'reschedule_target_mismatch',
      'Conflict',
      'The target booking hold cannot replace this appointment.',
    ],
    reschedule_target_unavailable: [
      503,
      'reschedule_target_unavailable',
      'Service Unavailable',
      'Rescheduling is temporarily unavailable.',
    ],
    appointment_lifecycle_corruption: [
      503,
      'appointment_lifecycle_corruption',
      'Service Unavailable',
      'Appointment actions are temporarily unavailable.',
    ],
    appointment_lifecycle_retry_exhausted: [
      503,
      'appointment_lifecycle_retry_exhausted',
      'Service Unavailable',
      'Appointment actions are temporarily unavailable.',
    ],
  } as const;
  const [status, code, title, detail] = mapping[error.code];
  return new ApplicationError(status, code, title, detail);
}

function invalidRequest(): never {
  throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function appointmentNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'appointment_not_found',
    'Not Found',
    'The appointment was not found.',
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
