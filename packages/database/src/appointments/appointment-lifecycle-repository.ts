import {
  Prisma,
  type AppointmentReasonCode,
  type AppointmentStatus,
  type AppointmentTransitionAction,
  type PrismaClient,
} from '@prisma/client';
import {
  assertAppointmentTransition,
  isConsumerLifecycleBeforeDeadline,
  isMerchantLifecycleActionAvailable,
} from '@nook/domain';

const transactionAttemptLimit = 3;

export type AppointmentLifecycleRepositoryErrorCode =
  | 'account_inactive'
  | 'forbidden'
  | 'appointment_not_found'
  | 'idempotency_conflict'
  | 'invalid_appointment_transition'
  | 'consumer_action_deadline_passed'
  | 'appointment_action_too_early'
  | 'target_hold_not_found'
  | 'target_hold_expired'
  | 'target_hold_not_active'
  | 'policy_version_mismatch'
  | 'policy_version_unsupported'
  | 'reschedule_target_mismatch'
  | 'reschedule_target_unavailable'
  | 'appointment_lifecycle_corruption'
  | 'appointment_lifecycle_retry_exhausted';

export class AppointmentLifecycleRepositoryError extends Error {
  constructor(readonly code: AppointmentLifecycleRepositoryErrorCode) {
    super(code);
    this.name = 'AppointmentLifecycleRepositoryError';
  }
}

export interface AppointmentTransitionRecord {
  readonly appointmentId: string;
  readonly status: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'RESCHEDULED';
  readonly occurredAt: Date;
  readonly replacementAppointmentId: string | null;
  readonly replayed: boolean;
}

export type MerchantSimpleAction =
  | 'MERCHANT_CANCEL'
  | 'MERCHANT_CHECK_IN'
  | 'MERCHANT_COMPLETE'
  | 'MERCHANT_NO_SHOW';

export interface AppointmentLifecycleRepository {
  authorizeConsumerAppointment(input: {
    readonly actorUserId: string;
    readonly appointmentId: string;
  }): Promise<void>;
  transitionConsumerCancel(input: {
    readonly actorUserId: string;
    readonly appointmentId: string;
    readonly reasonCode: AppointmentReasonCode;
    readonly keyHash: string;
    readonly requestFingerprint: string;
    readonly requestId: string;
  }): Promise<AppointmentTransitionRecord>;
  transitionMerchant(input: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly action: MerchantSimpleAction;
    readonly reasonCode: AppointmentReasonCode | null;
    readonly keyHash: string;
    readonly requestFingerprint: string;
    readonly requestId: string;
  }): Promise<AppointmentTransitionRecord>;
  transitionConsumerReschedule(input: {
    readonly actorUserId: string;
    readonly appointmentId: string;
    readonly holdId: string;
    readonly policyVersion: string;
    readonly policiesAccepted: true;
    readonly reasonCode: AppointmentReasonCode;
    readonly keyHash: string;
    readonly requestFingerprint: string;
    readonly requestId: string;
  }): Promise<
    | { readonly kind: 'transition'; readonly result: AppointmentTransitionRecord }
    | { readonly kind: 'target_expired' }
  >;
  authorizeMerchant(input: {
    readonly actorUserId: string;
    readonly tenantId: string;
  }): Promise<void>;
  authorizeMerchantAppointment(input: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly appointmentId: string;
  }): Promise<void>;
}

export class PrismaAppointmentLifecycleRepository implements AppointmentLifecycleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async authorizeMerchant(input: {
    readonly actorUserId: string;
    readonly tenantId: string;
  }): Promise<void> {
    await resolveMerchantScope(this.prisma, input);
  }

  async authorizeConsumerAppointment(input: {
    readonly actorUserId: string;
    readonly appointmentId: string;
  }): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: input.actorUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (user === null) throw new AppointmentLifecycleRepositoryError('account_inactive');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: input.appointmentId, consumerUserId: input.actorUserId },
      select: { id: true },
    });
    if (appointment === null)
      throw new AppointmentLifecycleRepositoryError('appointment_not_found');
  }

  async authorizeMerchantAppointment(input: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly appointmentId: string;
  }): Promise<void> {
    const staffId = await resolveMerchantScope(this.prisma, input);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: input.appointmentId,
        tenantId: input.tenantId,
        ...(staffId === null ? {} : { staffId }),
      },
      select: { id: true },
    });
    if (appointment === null)
      throw new AppointmentLifecycleRepositoryError('appointment_not_found');
  }

  transitionConsumerCancel(
    input: Parameters<AppointmentLifecycleRepository['transitionConsumerCancel']>[0],
  ): Promise<AppointmentTransitionRecord> {
    return this.withRetry((tx) => this.transitionConsumerCancelOnce(tx, input));
  }

  transitionMerchant(
    input: Parameters<AppointmentLifecycleRepository['transitionMerchant']>[0],
  ): Promise<AppointmentTransitionRecord> {
    return this.withRetry((tx) => this.transitionMerchantOnce(tx, input));
  }

  async transitionConsumerReschedule(
    input: Parameters<AppointmentLifecycleRepository['transitionConsumerReschedule']>[0],
  ): ReturnType<AppointmentLifecycleRepository['transitionConsumerReschedule']> {
    for (let attempt = 0; attempt < transactionAttemptLimit; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.transitionConsumerRescheduleOnce(tx, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error)) throw error;
        if (attempt === transactionAttemptLimit - 1)
          throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_retry_exhausted');
      }
    }
    throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_retry_exhausted');
  }

  private async withRetry(
    operation: (tx: Prisma.TransactionClient) => Promise<AppointmentTransitionRecord>,
  ): Promise<AppointmentTransitionRecord> {
    for (let attempt = 0; attempt < transactionAttemptLimit; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isRetryable(error)) throw error;
        if (attempt === transactionAttemptLimit - 1)
          throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_retry_exhausted');
      }
    }
    throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_retry_exhausted');
  }

  private async transitionConsumerCancelOnce(
    tx: Prisma.TransactionClient,
    input: Parameters<AppointmentLifecycleRepository['transitionConsumerCancel']>[0],
  ): Promise<AppointmentTransitionRecord> {
    await advisoryLock(tx, input.actorUserId, input.keyHash);
    await requireActiveUser(tx, input.actorUserId);
    const appointment = await lockConsumerAppointment(tx, input.actorUserId, input.appointmentId);
    const replay = await readReplay(tx, input.actorUserId, input.keyHash, input.requestFingerprint);
    if (replay !== null) return replay;
    const dbNow = await transactionNow(tx);
    if (appointment.status !== 'CONFIRMED') invalidTransition();
    if (
      !isConsumerLifecycleBeforeDeadline({
        status: appointment.status,
        targetStatus: 'CANCELLED',
        now: dbNow,
        startAt: appointment.startAt,
        leadMinutes: appointment.consumerCancelLeadMinutesSnapshot,
      })
    ) {
      throw new AppointmentLifecycleRepositoryError('consumer_action_deadline_passed');
    }
    return applyTransition(tx, {
      actorUserId: input.actorUserId,
      tenantId: appointment.tenantId,
      appointment,
      targetStatus: 'CANCELLED',
      action: 'CONSUMER_CANCEL',
      reasonCode: input.reasonCode,
      keyHash: input.keyHash,
      requestFingerprint: input.requestFingerprint,
      requestId: input.requestId,
      dbNow,
      releaseOccupancy: true,
    });
  }

  private async transitionMerchantOnce(
    tx: Prisma.TransactionClient,
    input: Parameters<AppointmentLifecycleRepository['transitionMerchant']>[0],
  ): Promise<AppointmentTransitionRecord> {
    await advisoryLock(tx, input.actorUserId, input.keyHash);
    const staffId = await resolveMerchantScope(tx, input);
    const appointment = await lockMerchantAppointment(tx, {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      staffId,
    });
    const replay = await readReplay(tx, input.actorUserId, input.keyHash, input.requestFingerprint);
    if (replay !== null) return replay;
    const dbNow = await transactionNow(tx);
    const targetStatus = merchantTargetStatus(input.action);
    try {
      assertAppointmentTransition(appointment.status, targetStatus);
    } catch {
      invalidTransition();
    }
    if (
      !isMerchantLifecycleActionAvailable({
        status: appointment.status,
        targetStatus,
        now: dbNow,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
      })
    ) {
      throw new AppointmentLifecycleRepositoryError('appointment_action_too_early');
    }
    return applyTransition(tx, {
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      appointment,
      targetStatus,
      action: input.action,
      reasonCode: input.reasonCode,
      keyHash: input.keyHash,
      requestFingerprint: input.requestFingerprint,
      requestId: input.requestId,
      dbNow,
      releaseOccupancy: targetStatus === 'CANCELLED' || targetStatus === 'NO_SHOW',
    });
  }

  private async transitionConsumerRescheduleOnce(
    tx: Prisma.TransactionClient,
    input: Parameters<AppointmentLifecycleRepository['transitionConsumerReschedule']>[0],
  ): Promise<
    | { readonly kind: 'transition'; readonly result: AppointmentTransitionRecord }
    | { readonly kind: 'target_expired' }
  > {
    await advisoryLock(tx, input.actorUserId, input.keyHash);
    await requireActiveUser(tx, input.actorUserId);
    const locked = await lockConsumerAppointment(tx, input.actorUserId, input.appointmentId);
    const source = await readRescheduleSource(tx, locked.id);
    const replay = await readReplay(tx, input.actorUserId, input.keyHash, input.requestFingerprint);
    if (replay !== null) return { kind: 'transition', result: replay };
    const dbNow = await transactionNow(tx);

    if (source.status === 'RESCHEDULED') {
      const natural = await naturalRescheduleReplay(tx, source, input, dbNow);
      return { kind: 'transition', result: natural };
    }
    if (source.status !== 'CONFIRMED' || source.rescheduledTo !== null) invalidTransition();
    if (
      !isConsumerLifecycleBeforeDeadline({
        status: source.status,
        targetStatus: 'RESCHEDULED',
        now: dbNow,
        startAt: source.startAt,
        leadMinutes: source.consumerRescheduleLeadMinutesSnapshot,
      })
    ) {
      throw new AppointmentLifecycleRepositoryError('consumer_action_deadline_passed');
    }
    if (!isCanonicalUuid(input.holdId))
      throw new AppointmentLifecycleRepositoryError('target_hold_not_found');

    await lockTargetHold(tx, input.actorUserId, input.holdId);
    const target = await tx.bookingHold.findFirst({
      where: { id: input.holdId, consumerUserId: input.actorUserId },
    });
    if (target === null) throw new AppointmentLifecycleRepositoryError('target_hold_not_found');
    if (target.status === 'EXPIRED')
      throw new AppointmentLifecycleRepositoryError('target_hold_expired');
    if (target.status === 'ACTIVE' && target.expiresAt <= dbNow) {
      const occupancy = await tx.bookingOccupancy.updateMany({
        where: { holdId: target.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', updatedAt: dbNow },
      });
      const hold = await tx.bookingHold.updateMany({
        where: { id: target.id, status: 'ACTIVE', expiresAt: { lte: dbNow } },
        data: { status: 'EXPIRED', updatedAt: dbNow },
      });
      if (occupancy.count !== 1 || hold.count !== 1) corruption();
      return { kind: 'target_expired' };
    }
    if (target.status !== 'ACTIVE')
      throw new AppointmentLifecycleRepositoryError('target_hold_not_active');

    const tenant = await tx.tenant.findUnique({
      where: { id: source.tenantId },
      select: { status: true },
    });
    if (tenant?.status !== 'ACTIVE')
      throw new AppointmentLifecycleRepositoryError('reschedule_target_unavailable');
    if (!/^v2:[0-9a-f]{64}$/.test(target.policyVersion ?? ''))
      throw new AppointmentLifecycleRepositoryError('policy_version_unsupported');
    if (target.policyVersion !== input.policyVersion)
      throw new AppointmentLifecycleRepositoryError('policy_version_mismatch');
    if (
      target.tenantId !== source.tenantId ||
      target.locationId !== source.locationId ||
      target.serviceId !== source.item.serviceId
    ) {
      throw new AppointmentLifecycleRepositoryError('reschedule_target_mismatch');
    }
    validateTargetSnapshots(target);
    const root = await validateRescheduleRoot(tx, source);
    const occupancies = await lockRescheduleOccupancies(tx, source, target);
    const oldOccupancy = occupancies.find(({ appointmentId }) => appointmentId === source.id);
    const targetOccupancy = occupancies.find(({ holdId }) => holdId === target.id);
    if (oldOccupancy === undefined || targetOccupancy === undefined) corruption();

    assertAppointmentTransition(source.status, 'RESCHEDULED');
    const pricing = reschedulePricing(target);
    const replacement = await tx.appointment.create({
      data: {
        tenantId: source.tenantId,
        locationId: target.locationId,
        staffId: target.staffId,
        consumerUserId: source.consumerUserId,
        holdId: target.id,
        status: 'CONFIRMED',
        source: root.source,
        pricingStatus: pricing.pricingStatus,
        paymentStatus: 'NOT_REQUIRED',
        startAt: target.startAt,
        endAt: target.endAt,
        confirmedAt: dbNow,
        usageTimezoneSnapshot: root.usageTimezoneSnapshot,
        usageMonth: root.usageMonth,
        locationTimezoneSnapshot: requiredSnapshot(target.locationTimezoneSnapshot),
        currency: target.currencySnapshot,
        subtotalAmount: pricing.total,
        depositAmount: 0,
        totalAmount: pricing.total,
        bookingPolicySnapshot: requiredSnapshot(target.bookingPolicySnapshot),
        cancellationPolicySnapshot: requiredSnapshot(target.cancellationPolicySnapshot),
        consumerCancelLeadMinutesSnapshot: target.consumerCancelLeadMinutesSnapshot,
        consumerRescheduleLeadMinutesSnapshot: target.consumerRescheduleLeadMinutesSnapshot,
        policyVersion: requiredSnapshot(target.policyVersion),
        policiesAcceptedAt: dbNow,
        locationNameSnapshot: requiredSnapshot(target.locationNameSnapshot),
        addressTextSnapshot: requiredSnapshot(target.addressTextSnapshot),
        postalCodeSnapshot: target.postalCodeSnapshot,
        citySnapshot: requiredSnapshot(target.citySnapshot),
        districtSnapshot: requiredSnapshot(target.districtSnapshot),
        rescheduledFromId: source.id,
        rescheduleRootId: root.id,
        createdAt: dbNow,
        updatedAt: dbNow,
      },
    });
    await tx.appointmentItem.create({
      data: {
        tenantId: source.tenantId,
        appointmentId: replacement.id,
        serviceId: target.serviceId,
        serviceNameSnapshot: target.serviceNameSnapshot,
        durationMinutesSnapshot: target.durationMinutesSnapshot,
        priceTypeSnapshot: target.priceTypeSnapshot,
        priceAmountSnapshot: target.priceAmountSnapshot,
        priceMinSnapshot: target.priceMinSnapshot,
        priceMaxSnapshot: target.priceMaxSnapshot,
        currencySnapshot: target.currencySnapshot,
        createdAt: dbNow,
      },
    });
    await tx.appointmentStatusHistory.createMany({
      data: [
        {
          tenantId: source.tenantId,
          appointmentId: source.id,
          fromStatus: 'CONFIRMED',
          toStatus: 'RESCHEDULED',
          actorUserId: input.actorUserId,
          reasonCode: input.reasonCode,
          createdAt: dbNow,
        },
        {
          tenantId: source.tenantId,
          appointmentId: replacement.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          actorUserId: input.actorUserId,
          reasonCode: null,
          createdAt: dbNow,
        },
      ],
    });
    const sourceChanged = await tx.appointment.updateMany({
      where: { id: source.id, tenantId: source.tenantId, status: 'CONFIRMED' },
      data: { status: 'RESCHEDULED', updatedAt: dbNow },
    });
    const oldReleased = await tx.bookingOccupancy.updateMany({
      where: { id: oldOccupancy.id, appointmentId: source.id, status: 'ACTIVE' },
      data: { status: 'RELEASED', updatedAt: dbNow },
    });
    const targetTransferred = await tx.bookingOccupancy.updateMany({
      where: {
        id: targetOccupancy.id,
        holdId: target.id,
        appointmentId: null,
        status: 'ACTIVE',
      },
      data: { holdId: null, appointmentId: replacement.id, updatedAt: dbNow },
    });
    const targetConsumed = await tx.bookingHold.updateMany({
      where: { id: target.id, status: 'ACTIVE', expiresAt: { gt: dbNow } },
      data: { status: 'CONSUMED', updatedAt: dbNow },
    });
    if (
      sourceChanged.count !== 1 ||
      oldReleased.count !== 1 ||
      targetTransferred.count !== 1 ||
      targetConsumed.count !== 1
    )
      corruption();
    await createRescheduleEffects(tx, input, source, replacement.id, dbNow);
    return {
      kind: 'transition',
      result: {
        appointmentId: source.id,
        status: 'RESCHEDULED',
        occurredAt: dbNow,
        replacementAppointmentId: replacement.id,
        replayed: false,
      },
    };
  }
}

const rescheduleSourceInclude = Prisma.validator<Prisma.AppointmentInclude>()({
  item: true,
  rescheduledTo: {
    select: {
      id: true,
      tenantId: true,
      consumerUserId: true,
      holdId: true,
      policyVersion: true,
      source: true,
      usageMonth: true,
      usageTimezoneSnapshot: true,
      rescheduledFromId: true,
      rescheduleRootId: true,
    },
  },
  statusHistory: {
    where: { toStatus: 'RESCHEDULED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
});

type RescheduleSourceBase = Prisma.AppointmentGetPayload<{
  include: typeof rescheduleSourceInclude;
}>;
type RescheduleSource = RescheduleSourceBase & {
  readonly item: NonNullable<RescheduleSourceBase['item']>;
};

type LockedAppointment = {
  readonly id: string;
  readonly tenantId: string;
  readonly staffId: string;
  readonly status: AppointmentStatus;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly consumerCancelLeadMinutesSnapshot: number;
};

async function readRescheduleSource(
  tx: Prisma.TransactionClient,
  appointmentId: string,
): Promise<RescheduleSource> {
  const source = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: rescheduleSourceInclude,
  });
  if (source === null || source.item === null) corruption();
  return source as RescheduleSource;
}

async function lockTargetHold(
  tx: Prisma.TransactionClient,
  consumerUserId: string,
  holdId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "booking_holds"
    WHERE "id" = ${holdId}::uuid AND "consumer_user_id" = ${consumerUserId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new AppointmentLifecycleRepositoryError('target_hold_not_found');
}

async function naturalRescheduleReplay(
  tx: Prisma.TransactionClient,
  source: RescheduleSource,
  input: Parameters<AppointmentLifecycleRepository['transitionConsumerReschedule']>[0],
  dbNow: Date,
): Promise<AppointmentTransitionRecord> {
  const successor = source.rescheduledTo;
  const history = source.statusHistory;
  if (
    successor === null ||
    successor.holdId !== input.holdId ||
    successor.policyVersion !== input.policyVersion ||
    history.length !== 1 ||
    history[0]?.reasonCode !== input.reasonCode
  )
    invalidTransition();
  const root = await validateRescheduleRoot(tx, source);
  if (
    successor.tenantId !== source.tenantId ||
    successor.consumerUserId !== source.consumerUserId ||
    successor.rescheduledFromId !== source.id ||
    successor.rescheduleRootId !== root.id ||
    successor.source !== root.source ||
    successor.usageMonth !== root.usageMonth ||
    successor.usageTimezoneSnapshot !== root.usageTimezoneSnapshot
  )
    corruption();
  const occurredAt = history[0]?.createdAt;
  if (occurredAt === undefined) corruption();
  await tx.appointmentTransitionKey.create({
    data: {
      actorUserId: input.actorUserId,
      keyHash: input.keyHash,
      tenantId: source.tenantId,
      sourceAppointmentId: source.id,
      action: 'CONSUMER_RESCHEDULE',
      requestFingerprint: input.requestFingerprint,
      resultStatus: 'RESCHEDULED',
      occurredAt,
      replacementAppointmentId: successor.id,
      createdAt: dbNow,
    },
  });
  return {
    appointmentId: source.id,
    status: 'RESCHEDULED',
    occurredAt,
    replacementAppointmentId: successor.id,
    replayed: true,
  };
}

async function validateRescheduleRoot(
  tx: Prisma.TransactionClient,
  source: RescheduleSource,
): Promise<{
  readonly id: string;
  readonly source: RescheduleSource['source'];
  readonly usageMonth: string;
  readonly usageTimezoneSnapshot: string;
}> {
  if (source.rescheduleRootId === null) {
    if (source.rescheduledFromId !== null) corruption();
    return {
      id: source.id,
      source: source.source,
      usageMonth: source.usageMonth,
      usageTimezoneSnapshot: source.usageTimezoneSnapshot,
    };
  }
  if (source.rescheduledFromId === null || source.rescheduleRootId === source.id) corruption();
  const root = await tx.appointment.findFirst({
    where: {
      id: source.rescheduleRootId,
      tenantId: source.tenantId,
      consumerUserId: source.consumerUserId,
    },
    select: {
      id: true,
      source: true,
      usageMonth: true,
      usageTimezoneSnapshot: true,
      rescheduledFromId: true,
      rescheduleRootId: true,
    },
  });
  if (
    root === null ||
    root.rescheduledFromId !== null ||
    root.rescheduleRootId !== null ||
    source.source !== root.source ||
    source.usageMonth !== root.usageMonth ||
    source.usageTimezoneSnapshot !== root.usageTimezoneSnapshot
  )
    corruption();
  return root;
}

type RescheduleOccupancy = {
  readonly id: string;
  readonly tenantId: string;
  readonly staffId: string;
  readonly holdId: string | null;
  readonly appointmentId: string | null;
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  readonly occupiedStartAt: Date;
  readonly occupiedEndAt: Date;
};

async function lockRescheduleOccupancies(
  tx: Prisma.TransactionClient,
  source: RescheduleSource,
  target: {
    readonly id: string;
    readonly tenantId: string;
    readonly staffId: string;
    readonly startAt: Date;
    readonly endAt: Date;
  },
): Promise<readonly RescheduleOccupancy[]> {
  const rows = await tx.$queryRaw<RescheduleOccupancy[]>(Prisma.sql`
    SELECT "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId",
      "hold_id" AS "holdId", "appointment_id" AS "appointmentId", "status",
      "occupied_start_at" AS "occupiedStartAt", "occupied_end_at" AS "occupiedEndAt"
    FROM "booking_occupancies"
    WHERE "appointment_id" = ${source.id}::uuid OR "hold_id" = ${target.id}::uuid
    ORDER BY "id" FOR UPDATE
  `);
  const old = rows.find(({ appointmentId }) => appointmentId === source.id);
  const next = rows.find(({ holdId }) => holdId === target.id);
  if (
    rows.length !== 2 ||
    old === undefined ||
    next === undefined ||
    old.tenantId !== source.tenantId ||
    old.staffId !== source.staffId ||
    old.holdId !== null ||
    old.status !== 'ACTIVE' ||
    old.occupiedStartAt > source.startAt ||
    old.occupiedEndAt < source.endAt ||
    next.tenantId !== target.tenantId ||
    next.staffId !== target.staffId ||
    next.appointmentId !== null ||
    next.status !== 'ACTIVE' ||
    next.occupiedStartAt > target.startAt ||
    next.occupiedEndAt < target.endAt
  )
    corruption();
  return rows;
}

function validateTargetSnapshots(target: {
  readonly bookingPolicySnapshot: string | null;
  readonly cancellationPolicySnapshot: string | null;
  readonly policyVersion: string | null;
  readonly locationTimezoneSnapshot: string | null;
  readonly locationNameSnapshot: string | null;
  readonly addressTextSnapshot: string | null;
  readonly citySnapshot: string | null;
  readonly districtSnapshot: string | null;
}): void {
  for (const value of [
    target.bookingPolicySnapshot,
    target.cancellationPolicySnapshot,
    target.policyVersion,
    target.locationTimezoneSnapshot,
    target.locationNameSnapshot,
    target.addressTextSnapshot,
    target.citySnapshot,
    target.districtSnapshot,
  ]) {
    if (value === null || value.trim() === '') corruption();
  }
}

function reschedulePricing(target: {
  readonly priceTypeSnapshot: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
  readonly priceAmountSnapshot: number | null;
}) {
  if (target.priceTypeSnapshot === 'FIXED') {
    if (target.priceAmountSnapshot === null) corruption();
    return { pricingStatus: 'EXACT' as const, total: target.priceAmountSnapshot };
  }
  return {
    pricingStatus:
      target.priceTypeSnapshot === 'QUOTE' ? ('QUOTE_REQUIRED' as const) : ('ESTIMATE' as const),
    total: null,
  };
}

async function createRescheduleEffects(
  tx: Prisma.TransactionClient,
  input: Parameters<AppointmentLifecycleRepository['transitionConsumerReschedule']>[0],
  source: RescheduleSource,
  replacementAppointmentId: string,
  dbNow: Date,
): Promise<void> {
  await tx.appointmentTransitionKey.create({
    data: {
      actorUserId: input.actorUserId,
      keyHash: input.keyHash,
      tenantId: source.tenantId,
      sourceAppointmentId: source.id,
      action: 'CONSUMER_RESCHEDULE',
      requestFingerprint: input.requestFingerprint,
      resultStatus: 'RESCHEDULED',
      occurredAt: dbNow,
      replacementAppointmentId,
      createdAt: dbNow,
    },
  });
  await tx.auditLog.create({
    data: {
      tenantId: source.tenantId,
      actorUserId: input.actorUserId,
      action: 'CONSUMER_RESCHEDULE',
      resourceType: 'appointment',
      resourceId: source.id,
      requestId: input.requestId,
      afterJson: {
        appointmentId: source.id,
        action: 'CONSUMER_RESCHEDULE',
        reasonCode: input.reasonCode,
        replacementAppointmentId,
      },
      createdAt: dbNow,
    },
  });
  await tx.outboxEvent.create({
    data: {
      tenantId: source.tenantId,
      aggregateType: 'appointment',
      aggregateId: source.id,
      eventType: 'appointment.rescheduled.v1',
      payloadJson: { appointmentId: source.id, replacementAppointmentId },
      dedupeKey: `appointment.rescheduled:${source.id}:v1`,
      status: 'PENDING',
      availableAt: dbNow,
      attemptCount: 0,
      createdAt: dbNow,
      updatedAt: dbNow,
    },
  });
}

function requiredSnapshot(value: string | null): string {
  if (value === null || value.trim() === '') corruption();
  return value;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

async function lockConsumerAppointment(
  tx: Prisma.TransactionClient,
  consumerUserId: string,
  appointmentId: string,
): Promise<LockedAppointment> {
  const rows = await tx.$queryRaw<LockedAppointment[]>(Prisma.sql`
    SELECT "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId", "status",
      "start_at" AS "startAt", "end_at" AS "endAt",
      "consumer_cancel_lead_minutes_snapshot" AS "consumerCancelLeadMinutesSnapshot"
    FROM "appointments"
    WHERE "id" = ${appointmentId}::uuid AND "consumer_user_id" = ${consumerUserId}::uuid
    FOR UPDATE
  `);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined)
    throw new AppointmentLifecycleRepositoryError('appointment_not_found');
  return row;
}

async function lockMerchantAppointment(
  tx: Prisma.TransactionClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly staffId: string | null;
  },
): Promise<LockedAppointment> {
  const staffPredicate =
    input.staffId === null ? Prisma.empty : Prisma.sql`AND "staff_id" = ${input.staffId}::uuid`;
  const rows = await tx.$queryRaw<LockedAppointment[]>(Prisma.sql`
    SELECT "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId", "status",
      "start_at" AS "startAt", "end_at" AS "endAt",
      "consumer_cancel_lead_minutes_snapshot" AS "consumerCancelLeadMinutesSnapshot"
    FROM "appointments"
    WHERE "id" = ${input.appointmentId}::uuid AND "tenant_id" = ${input.tenantId}::uuid
      ${staffPredicate}
    FOR UPDATE
  `);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined)
    throw new AppointmentLifecycleRepositoryError('appointment_not_found');
  return row;
}

async function resolveMerchantScope(
  db: PrismaClient | Prisma.TransactionClient,
  input: { readonly actorUserId: string; readonly tenantId: string },
): Promise<string | null> {
  const membership = await db.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { role: true },
  });
  if (membership === null || membership.role === 'VIEWER')
    throw new AppointmentLifecycleRepositoryError('forbidden');
  if (membership.role !== 'STAFF') return null;
  const profiles = await db.staffProfile.findMany({
    where: { tenantId: input.tenantId, userId: input.actorUserId, status: 'ACTIVE' },
    take: 2,
    select: { id: true },
  });
  if (profiles.length !== 1) throw new AppointmentLifecycleRepositoryError('forbidden');
  return profiles[0]?.id ?? null;
}

async function requireActiveUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const user = await tx.user.findFirst({
    where: { id: userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (user === null) throw new AppointmentLifecycleRepositoryError('account_inactive');
}

async function readReplay(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  keyHash: string,
  requestFingerprint: string,
): Promise<AppointmentTransitionRecord | null> {
  const key = await tx.appointmentTransitionKey.findUnique({
    where: { actorUserId_keyHash: { actorUserId, keyHash } },
  });
  if (key === null) return null;
  if (key.requestFingerprint !== requestFingerprint)
    throw new AppointmentLifecycleRepositoryError('idempotency_conflict');
  if (
    !['CANCELLED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'].includes(key.resultStatus)
  )
    throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_corruption');
  return {
    appointmentId: key.sourceAppointmentId,
    status: key.resultStatus as AppointmentTransitionRecord['status'],
    occurredAt: key.occurredAt,
    replacementAppointmentId: key.replacementAppointmentId,
    replayed: true,
  };
}

async function applyTransition(
  tx: Prisma.TransactionClient,
  input: {
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly appointment: LockedAppointment;
    readonly targetStatus: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW';
    readonly action: Exclude<AppointmentTransitionAction, 'CONSUMER_RESCHEDULE'>;
    readonly reasonCode: AppointmentReasonCode | null;
    readonly keyHash: string;
    readonly requestFingerprint: string;
    readonly requestId: string;
    readonly dbNow: Date;
    readonly releaseOccupancy: boolean;
  },
): Promise<AppointmentTransitionRecord> {
  assertAppointmentTransition(input.appointment.status, input.targetStatus);
  const occupancy = await lockOccupancy(tx, input.appointment);
  if (input.releaseOccupancy) {
    const released = await tx.bookingOccupancy.updateMany({
      where: { id: occupancy.id, appointmentId: input.appointment.id, status: 'ACTIVE' },
      data: { status: 'RELEASED', updatedAt: input.dbNow },
    });
    if (released.count !== 1) corruption();
  }
  const changed = await tx.appointment.updateMany({
    where: {
      id: input.appointment.id,
      tenantId: input.tenantId,
      status: input.appointment.status,
    },
    data: { status: input.targetStatus, updatedAt: input.dbNow },
  });
  if (changed.count !== 1) corruption();
  await tx.appointmentStatusHistory.create({
    data: {
      tenantId: input.tenantId,
      appointmentId: input.appointment.id,
      fromStatus: input.appointment.status,
      toStatus: input.targetStatus,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode,
      createdAt: input.dbNow,
    },
  });
  await tx.appointmentTransitionKey.create({
    data: {
      actorUserId: input.actorUserId,
      keyHash: input.keyHash,
      tenantId: input.tenantId,
      sourceAppointmentId: input.appointment.id,
      action: input.action,
      requestFingerprint: input.requestFingerprint,
      resultStatus: input.targetStatus,
      occurredAt: input.dbNow,
      createdAt: input.dbNow,
    },
  });
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: 'appointment',
      resourceId: input.appointment.id,
      requestId: input.requestId,
      afterJson: {
        appointmentId: input.appointment.id,
        action: input.action,
        ...(input.reasonCode === null ? {} : { reasonCode: input.reasonCode }),
      },
      createdAt: input.dbNow,
    },
  });
  const event = eventContract(input.targetStatus, input.appointment.id);
  await tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      aggregateType: 'appointment',
      aggregateId: input.appointment.id,
      eventType: event.type,
      payloadJson: { appointmentId: input.appointment.id },
      dedupeKey: event.dedupeKey,
      status: 'PENDING',
      availableAt: input.dbNow,
      attemptCount: 0,
      createdAt: input.dbNow,
      updatedAt: input.dbNow,
    },
  });
  return {
    appointmentId: input.appointment.id,
    status: input.targetStatus,
    occurredAt: input.dbNow,
    replacementAppointmentId: null,
    replayed: false,
  };
}

async function lockOccupancy(tx: Prisma.TransactionClient, appointment: LockedAppointment) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      tenantId: string;
      staffId: string;
      holdId: string | null;
      appointmentId: string | null;
      status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
      occupiedStartAt: Date;
      occupiedEndAt: Date;
    }>
  >(Prisma.sql`
    SELECT "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId",
      "hold_id" AS "holdId", "appointment_id" AS "appointmentId", "status",
      "occupied_start_at" AS "occupiedStartAt", "occupied_end_at" AS "occupiedEndAt"
    FROM "booking_occupancies"
    WHERE "appointment_id" = ${appointment.id}::uuid
    ORDER BY "id" FOR UPDATE
  `);
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.tenantId !== appointment.tenantId ||
    row.staffId !== appointment.staffId ||
    row.holdId !== null ||
    row.appointmentId !== appointment.id ||
    row.status !== 'ACTIVE' ||
    row.occupiedStartAt > appointment.startAt ||
    row.occupiedEndAt < appointment.endAt
  )
    corruption();
  return row;
}

function merchantTargetStatus(action: MerchantSimpleAction) {
  const targets = {
    MERCHANT_CANCEL: 'CANCELLED',
    MERCHANT_CHECK_IN: 'CHECKED_IN',
    MERCHANT_COMPLETE: 'COMPLETED',
    MERCHANT_NO_SHOW: 'NO_SHOW',
  } as const;
  return targets[action];
}

function eventContract(status: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW', id: string) {
  const values = {
    CANCELLED: ['appointment.cancelled.v1', `appointment.cancelled:${id}:v1`],
    CHECKED_IN: ['appointment.checked_in.v1', `appointment.checked_in:${id}:v1`],
    COMPLETED: ['appointment.completed.v1', `appointment.completed:${id}:v1`],
    NO_SHOW: ['appointment.no_show.v1', `appointment.no_show:${id}:v1`],
  } as const;
  const [type, dedupeKey] = values[status];
  return { type, dedupeKey };
}

async function advisoryLock(tx: Prisma.TransactionClient, actorUserId: string, keyHash: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorUserId}:${keyHash}`}, 0)) IS NULL AS locked`,
  );
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ dbNow: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dbNow"`,
  );
  const dbNow = rows[0]?.dbNow;
  if (dbNow === undefined) corruption();
  return dbNow;
}

function invalidTransition(): never {
  throw new AppointmentLifecycleRepositoryError('invalid_appointment_transition');
}

function corruption(): never {
  throw new AppointmentLifecycleRepositoryError('appointment_lifecycle_corruption');
}

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
