import {
  Prisma,
  type AvailabilityExceptionStatus,
  type AvailabilityExceptionType,
  type PrismaClient,
  type StaffStatus,
} from '@prisma/client';

const maxStaffEntitlement = 'MAX_STAFF';

export interface StaffSchedulingRecord {
  readonly tenantId: string;
  readonly limit: number;
  readonly used: number;
  readonly staff: readonly StaffSchedulingRecordItem[];
}

export interface StaffSchedulingRecordItem {
  readonly id: string;
  readonly userId: string | null;
  readonly locationId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly bookingEnabled: boolean;
  readonly sortOrder: number;
  readonly status: StaffStatus;
  readonly serviceIds: readonly string[];
  readonly weeklyRules: readonly WeeklyAvailabilityRecord[];
  readonly exceptions: readonly AvailabilityExceptionRecord[];
}

export interface WeeklyAvailabilityRecord {
  readonly id: string;
  readonly weekday: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

export interface AvailabilityExceptionRecord {
  readonly id: string;
  readonly type: AvailabilityExceptionType;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly reason: string | null;
  readonly status: AvailabilityExceptionStatus;
}

interface WriteContext {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface CreateStaffInput extends WriteContext {
  readonly id: string;
  readonly locationId: string;
  readonly displayName: string;
  readonly bio?: string | undefined;
  readonly bookingEnabled: boolean;
  readonly serviceIds: readonly string[];
}

export interface UpdateStaffInput extends WriteContext {
  readonly staffId: string;
  readonly patch: {
    readonly locationId?: string | undefined;
    readonly displayName?: string | undefined;
    readonly bio?: string | null | undefined;
    readonly bookingEnabled?: boolean | undefined;
    readonly serviceIds?: readonly string[] | undefined;
  };
}

export interface ChangeStaffStatusInput extends WriteContext {
  readonly staffId: string;
  readonly status: StaffStatus;
}

export interface ReorderStaffInput extends WriteContext {
  readonly staffIds: readonly string[];
}

export interface ReplaceWeeklyAvailabilityInput extends WriteContext {
  readonly staffId: string;
  readonly rules: readonly {
    readonly id: string;
    readonly weekday: number;
    readonly startTime: string;
    readonly endTime: string;
    readonly validFrom: string;
    readonly validUntil: string | null;
  }[];
}

export interface CreateAvailabilityExceptionInput extends WriteContext {
  readonly staffId: string;
  readonly id: string;
  readonly type: AvailabilityExceptionType;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly reason?: string | undefined;
}

export interface UpdateAvailabilityExceptionInput extends WriteContext {
  readonly staffId: string;
  readonly exceptionId: string;
  readonly patch: {
    readonly type?: AvailabilityExceptionType | undefined;
    readonly startAt?: Date | undefined;
    readonly endAt?: Date | undefined;
    readonly reason?: string | null | undefined;
  };
}

export interface ChangeAvailabilityExceptionStatusInput extends WriteContext {
  readonly staffId: string;
  readonly exceptionId: string;
  readonly status: AvailabilityExceptionStatus;
}

export type StaffSchedulingConflictCode =
  | 'entitlement_limit_reached'
  | 'entitlement_unavailable'
  | 'staff_not_found'
  | 'location_not_found'
  | 'service_assignment_invalid'
  | 'inactive_staff_booking'
  | 'last_active_staff'
  | 'staff_order_mismatch'
  | 'weekly_schedule_overlap'
  | 'exception_not_found'
  | 'exception_overlap'
  | 'resource_conflict';

export class StaffSchedulingRepositoryError extends Error {
  constructor(readonly code: StaffSchedulingConflictCode) {
    super(code);
    this.name = 'StaffSchedulingRepositoryError';
  }
}

export interface StaffSchedulingRepository {
  list(tenantId: string): Promise<StaffSchedulingRecord>;
  create(input: CreateStaffInput): Promise<StaffSchedulingRecord>;
  update(input: UpdateStaffInput): Promise<StaffSchedulingRecord>;
  changeStatus(input: ChangeStaffStatusInput): Promise<StaffSchedulingRecord>;
  reorder(input: ReorderStaffInput): Promise<StaffSchedulingRecord>;
  replaceWeeklyAvailability(input: ReplaceWeeklyAvailabilityInput): Promise<StaffSchedulingRecord>;
  createException(input: CreateAvailabilityExceptionInput): Promise<StaffSchedulingRecord>;
  updateException(input: UpdateAvailabilityExceptionInput): Promise<StaffSchedulingRecord>;
  changeExceptionStatus(
    input: ChangeAvailabilityExceptionStatusInput,
  ): Promise<StaffSchedulingRecord>;
}

const staffSelection = Prisma.validator<Prisma.StaffProfileSelect>()({
  id: true,
  userId: true,
  locationId: true,
  displayName: true,
  bio: true,
  bookingEnabled: true,
  sortOrder: true,
  status: true,
  services: { orderBy: { serviceId: 'asc' }, select: { serviceId: true } },
  weeklyRules: {
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { validFrom: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      weekday: true,
      startTime: true,
      endTime: true,
      validFrom: true,
      validUntil: true,
    },
  },
  exceptions: {
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      startAt: true,
      endAt: true,
      reason: true,
      status: true,
    },
  },
});

export class PrismaStaffSchedulingRepository implements StaffSchedulingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(tenantId: string): Promise<StaffSchedulingRecord> {
    return readScheduling(this.prisma, tenantId);
  }

  create(input: CreateStaffInput): Promise<StaffSchedulingRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const scheduling = await readScheduling(transaction, input.tenantId);
      if (scheduling.used >= scheduling.limit) {
        throw new StaffSchedulingRepositoryError('entitlement_limit_reached');
      }
      await requireLocationAndServices(
        transaction,
        input.tenantId,
        input.locationId,
        input.serviceIds,
      );
      const lastStaff = await transaction.staffProfile.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
        select: { sortOrder: true },
      });
      try {
        await transaction.staffProfile.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            locationId: input.locationId,
            displayName: input.displayName,
            bio: input.bio ?? null,
            bookingEnabled: input.bookingEnabled,
            sortOrder: (lastStaff?.sortOrder ?? -1) + 1,
          },
        });
        await transaction.staffService.createMany({
          data: input.serviceIds.map((serviceId) => ({
            tenantId: input.tenantId,
            staffId: input.id,
            serviceId,
          })),
        });
      } catch (error) {
        this.mapResourceConflict(error);
      }
      await writeAudit(transaction, input, 'staff.created', input.id);
      return readScheduling(transaction, input.tenantId);
    });
  }

  update(input: UpdateStaffInput): Promise<StaffSchedulingRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const staff = await transaction.staffProfile.findFirst({
        where: { tenantId: input.tenantId, id: input.staffId },
        select: { id: true, locationId: true, status: true },
      });
      if (staff === null) throw new StaffSchedulingRepositoryError('staff_not_found');
      if (staff.status === 'INACTIVE' && input.patch.bookingEnabled === true) {
        throw new StaffSchedulingRepositoryError('inactive_staff_booking');
      }
      if (input.patch.locationId !== undefined || input.patch.serviceIds !== undefined) {
        await requireLocationAndServices(
          transaction,
          input.tenantId,
          input.patch.locationId ?? staff.locationId,
          input.patch.serviceIds,
        );
      }
      await transaction.staffProfile.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.staffId } },
        data: {
          ...(input.patch.locationId !== undefined ? { locationId: input.patch.locationId } : {}),
          ...(input.patch.displayName !== undefined
            ? { displayName: input.patch.displayName }
            : {}),
          ...(input.patch.bio !== undefined ? { bio: input.patch.bio } : {}),
          ...(input.patch.bookingEnabled !== undefined
            ? { bookingEnabled: input.patch.bookingEnabled }
            : {}),
        },
      });
      if (input.patch.serviceIds !== undefined) {
        await transaction.staffService.deleteMany({
          where: { tenantId: input.tenantId, staffId: input.staffId },
        });
        await transaction.staffService.createMany({
          data: input.patch.serviceIds.map((serviceId) => ({
            tenantId: input.tenantId,
            staffId: input.staffId,
            serviceId,
          })),
        });
      }
      await writeAudit(transaction, input, 'staff.updated', input.staffId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  changeStatus(input: ChangeStaffStatusInput): Promise<StaffSchedulingRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const staff = await transaction.staffProfile.findFirst({
        where: { tenantId: input.tenantId, id: input.staffId },
        select: { status: true },
      });
      if (staff === null) throw new StaffSchedulingRepositoryError('staff_not_found');
      if (staff.status === input.status) return readScheduling(transaction, input.tenantId);
      if (input.status === 'ACTIVE') {
        const scheduling = await readScheduling(transaction, input.tenantId);
        if (scheduling.used >= scheduling.limit) {
          throw new StaffSchedulingRepositoryError('entitlement_limit_reached');
        }
      } else {
        const otherActive = await transaction.staffProfile.count({
          where: { tenantId: input.tenantId, id: { not: input.staffId }, status: 'ACTIVE' },
        });
        if (otherActive === 0) throw new StaffSchedulingRepositoryError('last_active_staff');
      }
      await transaction.staffProfile.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.staffId } },
        data: {
          status: input.status,
          ...(input.status === 'INACTIVE' ? { bookingEnabled: false } : {}),
        },
      });
      await writeAudit(transaction, input, 'staff.status_changed', input.staffId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  reorder(input: ReorderStaffInput): Promise<StaffSchedulingRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const owned = await transaction.staffProfile.findMany({
        where: { tenantId: input.tenantId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map(({ id }) => id));
      if (
        ownedIds.size !== input.staffIds.length ||
        input.staffIds.some((staffId) => !ownedIds.has(staffId))
      ) {
        throw new StaffSchedulingRepositoryError('staff_order_mismatch');
      }
      for (const [sortOrder, staffId] of input.staffIds.entries()) {
        await transaction.staffProfile.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: staffId } },
          data: { sortOrder },
        });
      }
      await writeAudit(transaction, input, 'staff.reordered', input.tenantId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  replaceWeeklyAvailability(input: ReplaceWeeklyAvailabilityInput): Promise<StaffSchedulingRecord> {
    requireNonOverlappingWeeklyRules(input.rules);
    return this.prisma.$transaction(async (transaction) => {
      await requireStaff(transaction, input.tenantId, input.staffId);
      await transaction.weeklyAvailabilityRule.deleteMany({
        where: { tenantId: input.tenantId, staffId: input.staffId },
      });
      try {
        await transaction.weeklyAvailabilityRule.createMany({
          data: input.rules.map((rule) => ({
            id: rule.id,
            tenantId: input.tenantId,
            staffId: input.staffId,
            weekday: rule.weekday,
            startTime: parseTime(rule.startTime),
            endTime: parseTime(rule.endTime),
            validFrom: parseDate(rule.validFrom),
            validUntil: rule.validUntil === null ? null : parseDate(rule.validUntil),
          })),
        });
      } catch (error) {
        this.mapResourceConflict(error);
      }
      await writeAudit(transaction, input, 'staff.weekly_schedule_replaced', input.staffId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  createException(input: CreateAvailabilityExceptionInput): Promise<StaffSchedulingRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await requireStaff(transaction, input.tenantId, input.staffId);
      await requireNoExceptionOverlap(
        transaction,
        input.tenantId,
        input.staffId,
        input.startAt,
        input.endAt,
      );
      try {
        await transaction.availabilityException.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            staffId: input.staffId,
            type: input.type,
            startAt: input.startAt,
            endAt: input.endAt,
            reason: input.reason ?? null,
          },
        });
      } catch (error) {
        this.mapResourceConflict(error);
      }
      await writeAudit(transaction, input, 'staff.exception_created', input.id);
      return readScheduling(transaction, input.tenantId);
    });
  }

  updateException(input: UpdateAvailabilityExceptionInput): Promise<StaffSchedulingRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await requireStaff(transaction, input.tenantId, input.staffId);
      const exception = await transaction.availabilityException.findFirst({
        where: { tenantId: input.tenantId, staffId: input.staffId, id: input.exceptionId },
      });
      if (exception === null) throw new StaffSchedulingRepositoryError('exception_not_found');
      const startAt = input.patch.startAt ?? exception.startAt;
      const endAt = input.patch.endAt ?? exception.endAt;
      if (startAt.getTime() >= endAt.getTime()) {
        throw new StaffSchedulingRepositoryError('exception_overlap');
      }
      if (exception.status === 'ACTIVE') {
        await requireNoExceptionOverlap(
          transaction,
          input.tenantId,
          input.staffId,
          startAt,
          endAt,
          input.exceptionId,
        );
      }
      await transaction.availabilityException.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.exceptionId } },
        data: {
          ...(input.patch.type !== undefined ? { type: input.patch.type } : {}),
          ...(input.patch.startAt !== undefined ? { startAt: input.patch.startAt } : {}),
          ...(input.patch.endAt !== undefined ? { endAt: input.patch.endAt } : {}),
          ...(input.patch.reason !== undefined ? { reason: input.patch.reason } : {}),
        },
      });
      await writeAudit(transaction, input, 'staff.exception_updated', input.exceptionId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  changeExceptionStatus(
    input: ChangeAvailabilityExceptionStatusInput,
  ): Promise<StaffSchedulingRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await requireStaff(transaction, input.tenantId, input.staffId);
      const exception = await transaction.availabilityException.findFirst({
        where: { tenantId: input.tenantId, staffId: input.staffId, id: input.exceptionId },
      });
      if (exception === null) throw new StaffSchedulingRepositoryError('exception_not_found');
      if (exception.status === input.status) return readScheduling(transaction, input.tenantId);
      if (input.status === 'ACTIVE') {
        await requireNoExceptionOverlap(
          transaction,
          input.tenantId,
          input.staffId,
          exception.startAt,
          exception.endAt,
          input.exceptionId,
        );
      }
      await transaction.availabilityException.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.exceptionId } },
        data: { status: input.status },
      });
      await writeAudit(transaction, input, 'staff.exception_status_changed', input.exceptionId);
      return readScheduling(transaction, input.tenantId);
    });
  }

  private mapResourceConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new StaffSchedulingRepositoryError('resource_conflict');
    }
    throw error;
  }

  private async withSerializableRetry<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const canRetry =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!canRetry || attempt === 2) throw error;
      }
    }
    throw new Error('unreachable serializable retry state');
  }
}

async function readScheduling(
  client: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
): Promise<StaffSchedulingRecord> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: {
        select: {
          entitlements: {
            where: { entitlementCode: maxStaffEntitlement },
            select: { valueJson: true },
          },
        },
      },
      staffProfiles: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: staffSelection,
      },
    },
  });
  if (tenant === null) throw new StaffSchedulingRepositoryError('entitlement_unavailable');
  const value = tenant.plan?.entitlements[0]?.valueJson;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new StaffSchedulingRepositoryError('entitlement_unavailable');
  }
  return {
    tenantId,
    limit: value,
    used: tenant.staffProfiles.filter(({ status }) => status === 'ACTIVE').length,
    staff: tenant.staffProfiles.map(({ services, ...staff }) => ({
      ...staff,
      serviceIds: services.map(({ serviceId }) => serviceId),
    })),
  };
}

function requireNonOverlappingWeeklyRules(rules: ReplaceWeeklyAvailabilityInput['rules']): void {
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left];
      const b = rules[right];
      if (a === undefined || b === undefined || a.weekday !== b.weekday) continue;
      const datesOverlap =
        a.validFrom <= (b.validUntil ?? '9999-12-31') &&
        b.validFrom <= (a.validUntil ?? '9999-12-31');
      const timesOverlap = a.startTime < b.endTime && b.startTime < a.endTime;
      if (datesOverlap && timesOverlap) {
        throw new StaffSchedulingRepositoryError('weekly_schedule_overlap');
      }
    }
  }
}

async function requireLocationAndServices(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  serviceIds?: readonly string[],
): Promise<void> {
  const location = await transaction.location.findFirst({
    where: { tenantId, id: locationId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (location === null) throw new StaffSchedulingRepositoryError('location_not_found');
  if (serviceIds === undefined) return;
  const count = await transaction.service.count({
    where: { tenantId, id: { in: [...serviceIds] }, status: 'ACTIVE' },
  });
  if (count !== serviceIds.length) {
    throw new StaffSchedulingRepositoryError('service_assignment_invalid');
  }
}

async function requireStaff(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  staffId: string,
): Promise<void> {
  const staff = await transaction.staffProfile.findFirst({
    where: { tenantId, id: staffId },
    select: { id: true },
  });
  if (staff === null) throw new StaffSchedulingRepositoryError('staff_not_found');
}

async function requireNoExceptionOverlap(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  staffId: string,
  startAt: Date,
  endAt: Date,
  excludedId?: string,
): Promise<void> {
  const overlap = await transaction.availabilityException.findFirst({
    where: {
      tenantId,
      staffId,
      status: 'ACTIVE',
      ...(excludedId === undefined ? {} : { id: { not: excludedId } }),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (overlap !== null) throw new StaffSchedulingRepositoryError('exception_overlap');
}

function parseTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function writeAudit(
  transaction: Prisma.TransactionClient,
  input: WriteContext,
  action: string,
  resourceId: string,
): Promise<unknown> {
  return transaction.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'staff_schedule',
      resourceId,
      requestId: input.requestId,
    },
  });
}
