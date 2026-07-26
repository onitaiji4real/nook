import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  bookingHoldIdSchema,
  createAppointmentRequestSchema,
  type AppointmentResponse,
} from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  AppointmentConfirmationRepositoryError,
  type AppointmentConfirmationRecord,
  type AppointmentConfirmationRepository,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { APPOINTMENT_CONFIRMATION_REPOSITORY } from './appointment.tokens';

@Injectable()
export class AppointmentApplicationService {
  constructor(
    @Inject(APPOINTMENT_CONFIRMATION_REPOSITORY)
    private readonly repository: AppointmentConfirmationRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async create(input: {
    readonly consumerUserId: string;
    readonly idempotencyKey: string;
    readonly requestId: string;
    readonly body: unknown;
  }): Promise<AppointmentResponse> {
    if (!this.config.appointmentConfirmationEnabled)
      throw new ApplicationError(
        503,
        'appointment_confirmation_disabled',
        'Service Unavailable',
        'Appointment confirmation is temporarily unavailable.',
      );
    const body = createAppointmentRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const holdId = bookingHoldIdSchema.safeParse(body.data.holdId);
    if (!holdId.success) throw holdNotFound();
    const canonicalHoldId = holdId.data.toLowerCase();
    const key = input.idempotencyKey.toLowerCase();
    try {
      const outcome = await this.repository.confirm({
        consumerUserId: input.consumerUserId,
        holdId: canonicalHoldId,
        policyVersion: body.data.policyVersion,
        keyHash: sha256(key),
        requestFingerprint: sha256(
          JSON.stringify({
            version: 1,
            endpoint: 'appointments.create',
            holdId: canonicalHoldId,
            policiesAccepted: true,
            policyVersion: body.data.policyVersion,
          }),
        ),
        requestId: input.requestId,
      });
      if (outcome.kind === 'expired')
        throw new ApplicationError(
          409,
          'hold_expired',
          'Conflict',
          'The booking hold has expired.',
        );
      return toResponse(outcome.appointment);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw mapRepositoryError(error);
    }
  }
}

function toResponse(appointment: AppointmentConfirmationRecord): AppointmentResponse {
  return {
    id: appointment.id,
    appointmentCreated: true,
    status: appointment.status,
    source: appointment.source,
    pricingStatus: appointment.pricingStatus,
    paymentStatus: appointment.paymentStatus,
    timezone: appointment.timezone,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    confirmedAt: appointment.confirmedAt.toISOString(),
    currency: appointment.currency,
    subtotalAmount: appointment.subtotalAmount,
    depositAmount: appointment.depositAmount,
    totalAmount: appointment.totalAmount,
    service: appointment.service,
    staff: appointment.staff,
    policies: {
      version: appointment.policies.version,
      bookingPolicy: appointment.policies.bookingPolicy,
      cancellationPolicy: appointment.policies.cancellationPolicy,
      acceptedAt: appointment.policies.acceptedAt.toISOString(),
      consumerCancelLeadMinutes: appointment.policies.consumerCancelLeadMinutes,
      consumerRescheduleLeadMinutes: appointment.policies.consumerRescheduleLeadMinutes,
      cancelUntil: appointment.policies.cancelUntil.toISOString(),
      rescheduleUntil: appointment.policies.rescheduleUntil.toISOString(),
      cancelUntilInclusive: appointment.policies.cancelUntilInclusive,
      rescheduleUntilInclusive: appointment.policies.rescheduleUntilInclusive,
    },
    location: appointment.location,
  };
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof AppointmentConfirmationRepositoryError)) return error as Error;
  const mapping = {
    hold_not_found: [404, 'booking_hold_not_found', 'Not Found', 'The booking hold was not found.'],
    hold_expired: [409, 'hold_expired', 'Conflict', 'The booking hold has expired.'],
    hold_not_active: [409, 'hold_not_active', 'Conflict', 'The booking hold is not active.'],
    idempotency_conflict: [
      409,
      'idempotency_conflict',
      'Conflict',
      'The idempotency key was already used for a different request.',
    ],
    policy_version_mismatch: [
      409,
      'policy_version_mismatch',
      'Conflict',
      'The accepted policy version does not match the booking hold.',
    ],
    monthly_booking_limit_reached: [
      403,
      'monthly_booking_limit_reached',
      'Forbidden',
      'The merchant cannot accept more online bookings right now.',
    ],
    entitlement_unavailable: [
      503,
      'booking_entitlement_unavailable',
      'Service Unavailable',
      'Appointment confirmation is temporarily unavailable.',
    ],
    booking_confirmation_unavailable: [
      503,
      'booking_confirmation_unavailable',
      'Service Unavailable',
      'Appointment confirmation is temporarily unavailable.',
    ],
  } as const;
  const [status, code, title, detail] = mapping[error.code];
  return new ApplicationError(status, code, title, detail);
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function holdNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'booking_hold_not_found',
    'Not Found',
    'The booking hold was not found.',
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
