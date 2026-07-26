import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  createBookingHoldRequestSchema,
  merchantSlugSchema,
  type BookingHoldResponse,
} from '@nook/contracts';
import {
  BookingHoldRepositoryError,
  type BookingHoldRecord,
  type BookingHoldRepository,
} from '@nook/database';
import type { RuntimeConfig } from '@nook/config';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { BOOKING_HOLD_REPOSITORY } from './booking.tokens';

@Injectable()
export class BookingHoldApplicationService {
  constructor(
    @Inject(BOOKING_HOLD_REPOSITORY) private readonly repository: BookingHoldRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async create(input: {
    readonly consumerUserId: string;
    readonly slug: string;
    readonly idempotencyKey: string;
    readonly body: unknown;
  }): Promise<BookingHoldResponse> {
    const keyHash = sha256(input.idempotencyKey);
    const decision = await this.repository.consumeCreateAttempt({
      consumerUserId: input.consumerUserId,
      keyHash,
      limit: 10,
      windowSeconds: 600,
    });
    if (!decision.allowed) {
      throw new ApplicationError(
        429,
        'booking_hold_rate_limited',
        'Too Many Requests',
        'Too many booking hold attempts. Please try again later.',
        decision.retryAfterSeconds,
      );
    }

    const slug = merchantSlugSchema.safeParse(input.slug);
    if (!slug.success) {
      throw new ApplicationError(
        404,
        'booking_hold_not_found',
        'Not Found',
        'The booking hold was not found.',
      );
    }
    const body = createBookingHoldRequestSchema.safeParse(input.body);
    if (!body.success) {
      throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
    }

    const startAt = new Date(body.data.startAt);
    try {
      const hold = await this.repository.acquire({
        consumerUserId: input.consumerUserId,
        slug: slug.data,
        serviceId: body.data.serviceId,
        ...(body.data.staffId === undefined ? {} : { staffId: body.data.staffId }),
        startAt,
        idempotencyKeyHash: keyHash,
        requestFingerprint: sha256(
          JSON.stringify({
            endpoint: 'marketplace.booking-holds.create',
            slug: slug.data,
            serviceId: body.data.serviceId,
            staffId: body.data.staffId ?? null,
            startAt: startAt.toISOString(),
          }),
        ),
        policyVersion: this.config.bookingPolicyV2WritesEnabled ? 2 : 1,
      });
      return toResponse(hold);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async release(input: {
    readonly consumerUserId: string;
    readonly holdId: string;
  }): Promise<void> {
    try {
      await this.repository.release(input);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }
}

function toResponse(hold: BookingHoldRecord): BookingHoldResponse {
  return {
    id: hold.id,
    bookingState: 'HELD',
    status: hold.status,
    appointmentCreated: false,
    timezone: hold.timezone,
    startAt: hold.startAt.toISOString(),
    endAt: hold.endAt.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
    policies: {
      ...hold.policies,
      cancelUntil: hold.policies.cancelUntil.toISOString(),
      rescheduleUntil: hold.policies.rescheduleUntil.toISOString(),
    },
    service: hold.service,
    staff: hold.staff,
  };
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof BookingHoldRepositoryError)) return error as Error;
  switch (error.code) {
    case 'hold_not_found':
      return new ApplicationError(
        404,
        'booking_hold_not_found',
        'Not Found',
        'The booking hold was not found.',
      );
    case 'idempotency_conflict':
      return new ApplicationError(
        409,
        'idempotency_conflict',
        'Conflict',
        'The idempotency key was already used for a different request.',
      );
    case 'slot_no_longer_available':
      return new ApplicationError(
        409,
        'slot_no_longer_available',
        'Conflict',
        'The selected time is no longer available.',
      );
    case 'hold_consumed':
      return new ApplicationError(
        409,
        'booking_hold_consumed',
        'Conflict',
        'The booking hold has already been consumed.',
      );
    case 'availability_policy_unavailable':
      return new ApplicationError(
        503,
        'availability_policy_unavailable',
        'Service Unavailable',
        'Booking is temporarily unavailable.',
      );
    case 'hold_snapshot_unavailable':
      return new ApplicationError(
        503,
        'booking_hold_snapshot_unavailable',
        'Service Unavailable',
        'Booking is temporarily unavailable.',
      );
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
