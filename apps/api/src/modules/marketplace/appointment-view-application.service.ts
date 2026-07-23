import { Buffer } from 'node:buffer';

import { Inject, Injectable } from '@nestjs/common';
import {
  appointmentStatusSchema,
  canonicalAppointmentIdSchema,
  canonicalUtcTimestampSchema,
  type AppointmentHistoryItem,
  type AppointmentStatus,
  type AppointmentView,
  type ConsumerAppointmentDetail,
  type ConsumerAppointmentListQuery,
  type ConsumerAppointmentListResponse,
  type ConsumerAppointmentSummary,
  type MerchantAppointmentDetail,
  type MerchantAppointmentListQuery,
  type MerchantAppointmentListResponse,
  type MerchantAppointmentSummary,
} from '@nook/contracts';
import {
  AppointmentViewRepositoryError,
  type AppointmentPageCursor,
  type AppointmentViewRecord,
  type AppointmentViewRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import type { RuntimeConfig } from '@nook/config';
import {
  isConsumerLifecycleBeforeDeadline,
  isMerchantLifecycleActionAvailable,
} from '@nook/domain';

import { ApplicationError } from '../../application-error';
import { TENANT_REPOSITORY } from '../../tenant-repository.token';
import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { APPOINTMENT_VIEW_REPOSITORY } from './marketplace.tokens';

interface MerchantRequestContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

interface ConsumerCursor {
  readonly v: 1;
  readonly kind: 'consumer';
  readonly view: AppointmentView;
  readonly asOf: string;
  readonly lastStartAt: string;
  readonly lastId: string;
}

interface MerchantCursor {
  readonly v: 1;
  readonly kind: 'merchant';
  readonly asOf: string;
  readonly tenantId: string;
  readonly from: string;
  readonly to: string;
  readonly staffId: string | null;
  readonly status: AppointmentStatus | null;
  readonly lastStartAt: string;
  readonly lastId: string;
}

@Injectable()
export class AppointmentViewApplicationService {
  constructor(
    @Inject(APPOINTMENT_VIEW_REPOSITORY)
    private readonly appointments: AppointmentViewRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async listConsumer(input: {
    readonly consumerUserId: string;
    readonly query: ConsumerAppointmentListQuery;
  }): Promise<ConsumerAppointmentListResponse> {
    const cursor =
      input.query.cursor === undefined
        ? undefined
        : decodeConsumerCursor(input.query.cursor, input.query.view);
    const page = await this.execute(() =>
      this.appointments.listForConsumer({
        consumerUserId: input.consumerUserId,
        view: input.query.view,
        limit: input.query.limit,
        asOf: cursor === undefined ? undefined : new Date(cursor.asOf),
        after: cursor === undefined ? undefined : cursorPoint(cursor),
      }),
    );
    return {
      asOf: page.asOf.toISOString(),
      items: page.items.map(toConsumerSummary),
      nextCursor:
        page.next === null
          ? null
          : encodeCursor({
              v: 1,
              kind: 'consumer',
              view: input.query.view,
              asOf: page.asOf.toISOString(),
              lastStartAt: page.next.startAt.toISOString(),
              lastId: page.next.id,
            }),
    };
  }

  async getConsumer(input: {
    readonly consumerUserId: string;
    readonly appointmentId: string;
  }): Promise<ConsumerAppointmentDetail> {
    const appointment = await this.execute(() => this.appointments.findForConsumer(input));
    if (appointment === null) throw appointmentNotFound();
    return toConsumerDetail(appointment, this.config.appointmentLifecycleEnabled);
  }

  async listMerchant(
    input: MerchantRequestContext & { readonly query: MerchantAppointmentListQuery },
  ): Promise<MerchantAppointmentListResponse> {
    const membership = await this.requireMember(input);
    const staffId = await this.effectiveStaffId(membership, input, input.query.staffId, true);
    const cursor =
      input.query.cursor === undefined
        ? undefined
        : decodeMerchantCursor(input.query.cursor, {
            tenantId: input.tenantId,
            from: input.query.from,
            to: input.query.to,
            staffId: staffId ?? null,
            status: input.query.status ?? null,
          });
    const page = await this.execute(() =>
      this.appointments.listForTenant({
        tenantId: input.tenantId,
        from: new Date(input.query.from),
        to: new Date(input.query.to),
        staffId,
        status: input.query.status,
        limit: input.query.limit,
        asOf: cursor === undefined ? undefined : new Date(cursor.asOf),
        after: cursor === undefined ? undefined : cursorPoint(cursor),
      }),
    );
    return {
      asOf: page.asOf.toISOString(),
      from: input.query.from,
      to: input.query.to,
      calendarTimezone: page.calendarTimezone,
      items: page.items.map(toMerchantSummary),
      nextCursor:
        page.next === null
          ? null
          : encodeCursor({
              v: 1,
              kind: 'merchant',
              asOf: page.asOf.toISOString(),
              tenantId: input.tenantId,
              from: input.query.from,
              to: input.query.to,
              staffId: staffId ?? null,
              status: input.query.status ?? null,
              lastStartAt: page.next.startAt.toISOString(),
              lastId: page.next.id,
            }),
    };
  }

  async getMerchant(
    input: MerchantRequestContext & { readonly appointmentId: string },
  ): Promise<MerchantAppointmentDetail> {
    const membership = await this.requireMember(input);
    const staffId = await this.effectiveStaffId(membership, input, undefined, false);
    const appointment = await this.execute(() =>
      this.appointments.findForTenant({
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        staffId,
      }),
    );
    if (appointment === null) throw appointmentNotFound();
    return {
      ...toMerchantSummary(appointment),
      history: toHistory(appointment),
      lifecycle: merchantLifecycle(
        appointment,
        this.config.appointmentLifecycleEnabled && membership.membership.role !== 'VIEWER',
      ),
    };
  }

  private async requireMember(input: MerchantRequestContext): Promise<TenantMembershipRecord> {
    const membership = await this.tenants.findActiveTenantMembership({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (membership !== null) return membership;
    throw new ApplicationError(
      403,
      'tenant_access_denied',
      'Forbidden',
      'Tenant access is denied.',
    );
  }

  private async effectiveStaffId(
    membership: TenantMembershipRecord,
    input: MerchantRequestContext,
    requestedStaffId: string | undefined,
    rejectOtherFilter: boolean,
  ): Promise<string | undefined> {
    if (membership.membership.role !== 'STAFF') return requestedStaffId;
    const staffId = await this.execute(() =>
      this.appointments.resolveActiveStaffId({ tenantId: input.tenantId, userId: input.userId }),
    );
    if (
      staffId === null ||
      (rejectOtherFilter && requestedStaffId !== undefined && requestedStaffId !== staffId)
    ) {
      throw new ApplicationError(
        403,
        'staff_calendar_access_denied',
        'Forbidden',
        'Calendar access is denied.',
      );
    }
    return staffId;
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AppointmentViewRepositoryError)) throw error;
      throw new ApplicationError(
        503,
        'appointment_view_unavailable',
        'Service Unavailable',
        'Appointments are temporarily unavailable.',
      );
    }
  }
}

function toConsumerSummary(appointment: AppointmentViewRecord): ConsumerAppointmentSummary {
  return {
    id: appointment.id,
    status: appointment.status,
    pricingStatus: appointment.pricingStatus,
    paymentStatus: appointment.paymentStatus,
    timezone: appointment.timezone,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    confirmedAt: appointment.confirmedAt.toISOString(),
    currency: appointment.currency,
    subtotalAmount: appointment.subtotalAmount,
    depositAmount: 0,
    totalAmount: appointment.totalAmount,
    service: appointment.service,
    staff: appointment.staff,
    location: {
      name: appointment.location.name,
      city: appointment.location.city,
      district: appointment.location.district,
    },
  };
}

function toConsumerDetail(
  appointment: AppointmentViewRecord,
  lifecycleEnabled: boolean,
): ConsumerAppointmentDetail {
  const cancelAllowed =
    lifecycleEnabled &&
    isConsumerLifecycleBeforeDeadline({
      status: appointment.status,
      targetStatus: 'CANCELLED',
      now: appointment.evaluatedAt,
      startAt: appointment.startAt,
      leadMinutes: appointment.policies.consumerCancelLeadMinutes,
    });
  const rescheduleAllowed =
    lifecycleEnabled &&
    appointment.rescheduleContext !== null &&
    isConsumerLifecycleBeforeDeadline({
      status: appointment.status,
      targetStatus: 'RESCHEDULED',
      now: appointment.evaluatedAt,
      startAt: appointment.startAt,
      leadMinutes: appointment.policies.consumerRescheduleLeadMinutes,
    });
  return {
    ...toConsumerSummary(appointment),
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
    history: toHistory(appointment),
    lifecycle: {
      evaluatedAt: appointment.evaluatedAt.toISOString(),
      allowedActions: [
        ...(cancelAllowed ? (['CANCEL'] as const) : []),
        ...(rescheduleAllowed ? (['RESCHEDULE'] as const) : []),
      ],
    },
    rescheduleContext: rescheduleAllowed ? appointment.rescheduleContext : null,
  };
}

function toMerchantSummary(appointment: AppointmentViewRecord): MerchantAppointmentSummary {
  return {
    ...toConsumerSummary(appointment),
    source: appointment.source,
    consumer: {
      displayName:
        appointment.consumerDisplayName?.trim() === '' || appointment.consumerDisplayName === null
          ? '顧客'
          : appointment.consumerDisplayName,
    },
  };
}

function toHistory(appointment: AppointmentViewRecord): readonly AppointmentHistoryItem[] {
  return appointment.history.map((item) => ({
    fromStatus: item.fromStatus,
    toStatus: item.toStatus,
    createdAt: item.createdAt.toISOString(),
    reasonCode: item.reasonCode,
  }));
}

function merchantLifecycle(appointment: AppointmentViewRecord, enabled: boolean) {
  const targets = [
    ['CANCEL', 'CANCELLED'],
    ['CHECK_IN', 'CHECKED_IN'],
    ['COMPLETE', 'COMPLETED'],
    ['NO_SHOW', 'NO_SHOW'],
  ] as const;
  return {
    evaluatedAt: appointment.evaluatedAt.toISOString(),
    allowedActions: enabled
      ? targets
          .filter(([, targetStatus]) =>
            isMerchantLifecycleActionAvailable({
              status: appointment.status,
              targetStatus,
              now: appointment.evaluatedAt,
              startAt: appointment.startAt,
              endAt: appointment.endAt,
            }),
          )
          .map(([action]) => action)
      : [],
    checkInAvailableAt: new Date(appointment.startAt.getTime() - 120 * 60_000).toISOString(),
    completeAvailableAt: appointment.startAt.toISOString(),
    noShowAvailableAt: appointment.endAt.toISOString(),
  };
}

function cursorPoint(cursor: ConsumerCursor | MerchantCursor): AppointmentPageCursor {
  return { startAt: new Date(cursor.lastStartAt), id: cursor.lastId };
}

export function encodeCursor(value: ConsumerCursor | MerchantCursor): string {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  if (Buffer.byteLength(encoded, 'utf8') > 512) throw invalidCursor();
  return encoded;
}

export function decodeConsumerCursor(raw: string, view: AppointmentView): ConsumerCursor {
  const value = decodeCursorObject(raw);
  if (
    !hasExactKeys(value, ['v', 'kind', 'view', 'asOf', 'lastStartAt', 'lastId']) ||
    value.v !== 1 ||
    value.kind !== 'consumer' ||
    value.view !== view ||
    !isTimestamp(value.asOf) ||
    !isTimestamp(value.lastStartAt) ||
    !isUuid(value.lastId)
  ) {
    throw invalidCursor();
  }
  return value as unknown as ConsumerCursor;
}

export function decodeMerchantCursor(
  raw: string,
  expected: {
    readonly tenantId: string;
    readonly from: string;
    readonly to: string;
    readonly staffId: string | null;
    readonly status: AppointmentStatus | null;
  },
): MerchantCursor {
  const value = decodeCursorObject(raw);
  if (
    !hasExactKeys(value, [
      'v',
      'kind',
      'asOf',
      'tenantId',
      'from',
      'to',
      'staffId',
      'status',
      'lastStartAt',
      'lastId',
    ]) ||
    value.v !== 1 ||
    value.kind !== 'merchant' ||
    !isTimestamp(value.asOf) ||
    value.tenantId !== expected.tenantId ||
    value.from !== expected.from ||
    value.to !== expected.to ||
    value.staffId !== expected.staffId ||
    value.status !== expected.status ||
    !isTimestamp(value.lastStartAt) ||
    !isUuid(value.lastId) ||
    (value.staffId !== null && !isUuid(value.staffId)) ||
    (value.status !== null && !appointmentStatusSchema.safeParse(value.status).success)
  ) {
    throw invalidCursor();
  }
  return value as unknown as MerchantCursor;
}

function decodeCursorObject(raw: string): Record<string, unknown> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw) || Buffer.byteLength(raw, 'utf8') > 512)
      throw invalidCursor();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.length > 512 || bytes.toString('base64url') !== raw) throw invalidCursor();
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw invalidCursor();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidCursor();
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && canonicalUtcTimestampSchema.safeParse(value).success;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && canonicalAppointmentIdSchema.safeParse(value).success;
}

function invalidCursor(): ApplicationError {
  return new ApplicationError(400, 'invalid_cursor', 'Bad Request', 'The cursor is invalid.');
}

function appointmentNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'appointment_not_found',
    'Not Found',
    'The appointment was not found.',
  );
}
