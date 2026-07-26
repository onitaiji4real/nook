import { Inject, Injectable } from '@nestjs/common';
import type {
  ChangeAvailabilityExceptionStatusRequest,
  ChangeStaffStatusRequest,
  CreateAvailabilityExceptionRequest,
  CreateStaffRequest,
  ReorderStaffRequest,
  ReplaceWeeklyAvailabilityRequest,
  StaffAvailabilityItem,
  StaffAvailabilityResponse,
  UpdateAvailabilityExceptionRequest,
  UpdateStaffRequest,
} from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  StaffSchedulingRepositoryError,
  type StaffSchedulingRecord,
  type StaffSchedulingRecordItem,
  type StaffSchedulingRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../platform/identity/tenant-repository.token';
import { STAFF_SCHEDULING_REPOSITORY } from './staff-scheduling-repository.token';

type RequestContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
};

type SchedulingEvent =
  | 'staff.created'
  | 'staff.updated'
  | 'staff.status_changed'
  | 'staff.reordered'
  | 'staff.weekly_schedule_replaced'
  | 'staff.exception_created'
  | 'staff.exception_updated'
  | 'staff.exception_status_changed';

@Injectable()
export class StaffSchedulingApplicationService {
  constructor(
    @Inject(STAFF_SCHEDULING_REPOSITORY)
    private readonly repository: StaffSchedulingRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async list(input: RequestContext): Promise<StaffAvailabilityResponse> {
    await this.requireMember(input);
    return toResponse(await this.execute(() => this.repository.list(input.tenantId)));
  }

  async create(
    input: RequestContext & { readonly body: CreateStaffRequest },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.create({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        ...input.body,
      }),
    );
    this.logChange('staff.created', input);
    return toResponse(result);
  }

  async update(
    input: RequestContext & {
      readonly staffId: string;
      readonly body: UpdateStaffRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.update({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        patch: input.body,
      }),
    );
    this.logChange('staff.updated', input);
    return toResponse(result);
  }

  async changeStatus(
    input: RequestContext & {
      readonly staffId: string;
      readonly body: ChangeStaffStatusRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.changeStatus({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        status: input.body.status,
      }),
    );
    this.logChange('staff.status_changed', input);
    return toResponse(result);
  }

  async reorder(
    input: RequestContext & { readonly body: ReorderStaffRequest },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.reorder({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffIds: input.body.staffIds,
      }),
    );
    this.logChange('staff.reordered', input);
    return toResponse(result);
  }

  async replaceWeeklyAvailability(
    input: RequestContext & {
      readonly staffId: string;
      readonly body: ReplaceWeeklyAvailabilityRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.replaceWeeklyAvailability({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        rules: input.body.rules,
      }),
    );
    this.logChange('staff.weekly_schedule_replaced', input);
    return toResponse(result);
  }

  async createException(
    input: RequestContext & {
      readonly staffId: string;
      readonly body: CreateAvailabilityExceptionRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.createException({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        id: input.body.id,
        type: input.body.type,
        startAt: new Date(input.body.startAt),
        endAt: new Date(input.body.endAt),
        ...(input.body.reason === undefined ? {} : { reason: input.body.reason }),
      }),
    );
    this.logChange('staff.exception_created', input);
    return toResponse(result);
  }

  async updateException(
    input: RequestContext & {
      readonly staffId: string;
      readonly exceptionId: string;
      readonly body: UpdateAvailabilityExceptionRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const body = input.body;
    const result = await this.execute(() =>
      this.repository.updateException({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        exceptionId: input.exceptionId,
        patch: {
          ...(body.type === undefined ? {} : { type: body.type }),
          ...(body.startAt === undefined ? {} : { startAt: new Date(body.startAt) }),
          ...(body.endAt === undefined ? {} : { endAt: new Date(body.endAt) }),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        },
      }),
    );
    this.logChange('staff.exception_updated', input);
    return toResponse(result);
  }

  async changeExceptionStatus(
    input: RequestContext & {
      readonly staffId: string;
      readonly exceptionId: string;
      readonly body: ChangeAvailabilityExceptionStatusRequest;
    },
  ): Promise<StaffAvailabilityResponse> {
    await this.requireEditor(input);
    const result = await this.execute(() =>
      this.repository.changeExceptionStatus({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        staffId: input.staffId,
        exceptionId: input.exceptionId,
        status: input.body.status,
      }),
    );
    this.logChange('staff.exception_status_changed', input);
    return toResponse(result);
  }

  private async execute(operation: () => Promise<StaffSchedulingRecord>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof StaffSchedulingRepositoryError)) throw error;
      switch (error.code) {
        case 'entitlement_limit_reached':
          throw new ApplicationError(
            403,
            'staff_limit_reached',
            'Forbidden',
            'The active staff entitlement limit has been reached.',
          );
        case 'entitlement_unavailable':
          throw new ApplicationError(
            503,
            'staff_entitlement_unavailable',
            'Service Unavailable',
            'The staff entitlement configuration is unavailable.',
          );
        case 'staff_not_found':
          throw new ApplicationError(
            404,
            'staff_not_found',
            'Not Found',
            'The staff member was not found.',
          );
        case 'location_not_found':
          throw new ApplicationError(
            409,
            'staff_location_not_found',
            'Conflict',
            'The active staff location was not found in this tenant.',
          );
        case 'service_assignment_invalid':
          throw new ApplicationError(
            409,
            'staff_service_assignment_invalid',
            'Conflict',
            'Every staff service must be active and belong to this tenant.',
          );
        case 'inactive_staff_booking':
          throw new ApplicationError(
            409,
            'inactive_staff_booking',
            'Conflict',
            'An inactive staff member cannot accept bookings.',
          );
        case 'last_active_staff':
          throw new ApplicationError(
            409,
            'last_active_staff',
            'Conflict',
            'At least one active staff member is required.',
          );
        case 'staff_order_mismatch':
          throw new ApplicationError(
            409,
            'staff_order_mismatch',
            'Conflict',
            'The ordering list must contain every staff member exactly once.',
          );
        case 'weekly_schedule_overlap':
          throw new ApplicationError(
            409,
            'weekly_schedule_overlap',
            'Conflict',
            'Weekly availability rules must not overlap.',
          );
        case 'exception_not_found':
          throw new ApplicationError(
            404,
            'availability_exception_not_found',
            'Not Found',
            'The availability exception was not found.',
          );
        case 'exception_overlap':
          throw new ApplicationError(
            409,
            'availability_exception_overlap',
            'Conflict',
            'Active availability exceptions must not overlap and require a valid interval.',
          );
        case 'resource_conflict':
          throw new ApplicationError(
            409,
            'staff_resource_conflict',
            'Conflict',
            'The scheduling resource ID is already in use.',
          );
      }
    }
  }

  private async requireEditor(input: RequestContext): Promise<void> {
    const membership = await this.requireMember(input);
    if (!['OWNER', 'MANAGER'].includes(membership.membership.role)) await this.deny(input);
  }

  private async requireMember(input: RequestContext): Promise<TenantMembershipRecord> {
    const membership = await this.tenants.findActiveTenantMembership({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (membership === null) return this.deny(input);
    return membership;
  }

  private async deny(input: RequestContext): Promise<never> {
    await this.tenants.recordAuthorizationDeniedIfTenantExists({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      requestId: input.requestId,
    });
    this.writeSecurityEvent('authorization.denied', input, 'denied');
    throw new ApplicationError(
      403,
      'tenant_access_denied',
      'Forbidden',
      'Access to this tenant is denied.',
    );
  }

  private logChange(event: SchedulingEvent, input: RequestContext): void {
    this.writeSecurityEvent(event, input, 'success');
  }

  private writeSecurityEvent(
    event: Parameters<typeof createSecurityEventLog>[0]['event'],
    input: RequestContext,
    outcome: 'success' | 'denied',
  ): void {
    process.stdout.write(
      `${JSON.stringify(
        redactValue(
          createSecurityEventLog({
            event,
            requestId: input.requestId,
            actorUserId: input.userId,
            tenantId: input.tenantId,
            outcome,
            version: this.config.appVersion,
            environment: this.config.nodeEnv,
          }),
        ),
      )}\n`,
    );
  }
}

function toResponse(record: StaffSchedulingRecord): StaffAvailabilityResponse {
  return {
    tenantId: record.tenantId,
    timezone: 'Asia/Taipei',
    staff: record.staff.map(toResponseItem),
    entitlement: {
      code: 'MAX_STAFF',
      limit: record.limit,
      used: record.used,
      remaining: Math.max(0, record.limit - record.used),
    },
  };
}

function toResponseItem(staff: StaffSchedulingRecordItem): StaffAvailabilityItem {
  return {
    id: staff.id,
    userId: staff.userId,
    locationId: staff.locationId,
    displayName: staff.displayName,
    bio: staff.bio,
    bookingEnabled: staff.bookingEnabled,
    sortOrder: staff.sortOrder,
    status: staff.status,
    serviceIds: staff.serviceIds,
    weeklyRules: staff.weeklyRules.map((rule) => ({
      id: rule.id,
      weekday: rule.weekday,
      startTime: rule.startTime.toISOString().slice(11, 16),
      endTime: rule.endTime.toISOString().slice(11, 16),
      validFrom: rule.validFrom.toISOString().slice(0, 10),
      validUntil: rule.validUntil?.toISOString().slice(0, 10) ?? null,
    })),
    exceptions: staff.exceptions.map((exception) => ({
      id: exception.id,
      type: exception.type,
      startAt: exception.startAt.toISOString(),
      endAt: exception.endAt.toISOString(),
      reason: exception.reason,
      status: exception.status,
    })),
  };
}
