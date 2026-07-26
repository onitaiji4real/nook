import { Prisma, type PrismaClient } from '@prisma/client';
import { createNoDepositConfirmedAppointment } from '@nook/domain';

const transactionAttemptLimit = 3;
const onlineSources = ['MERCHANT_LINK', 'MARKETPLACE'] as const;

export type AppointmentConfirmationErrorCode =
  | 'hold_not_found'
  | 'hold_expired'
  | 'hold_not_active'
  | 'idempotency_conflict'
  | 'policy_version_mismatch'
  | 'monthly_booking_limit_reached'
  | 'entitlement_unavailable'
  | 'booking_confirmation_unavailable';

export class AppointmentConfirmationRepositoryError extends Error {
  constructor(readonly code: AppointmentConfirmationErrorCode) {
    super(code);
    this.name = 'AppointmentConfirmationRepositoryError';
  }
}

export interface ConfirmAppointmentInput {
  readonly consumerUserId: string;
  readonly holdId: string;
  readonly policyVersion: string;
  readonly keyHash: string;
  readonly requestFingerprint: string;
  readonly requestId: string;
}

export interface AppointmentConfirmationRecord {
  readonly id: string;
  readonly status: 'CONFIRMED';
  readonly source: 'MERCHANT_LINK' | 'MARKETPLACE' | 'ADMIN' | 'STAFF' | 'IMPORT';
  readonly pricingStatus: 'EXACT' | 'ESTIMATE' | 'QUOTE_REQUIRED';
  readonly paymentStatus: 'NOT_REQUIRED';
  readonly timezone: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly confirmedAt: Date;
  readonly currency: string;
  readonly subtotalAmount: number | null;
  readonly depositAmount: 0;
  readonly totalAmount: number | null;
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: string;
  };
  readonly staff: { readonly id: string; readonly displayName: string };
  readonly policies: {
    readonly version: string;
    readonly bookingPolicy: string;
    readonly cancellationPolicy: string;
    readonly acceptedAt: Date;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
    readonly cancelUntil: Date;
    readonly rescheduleUntil: Date;
    readonly cancelUntilInclusive: boolean;
    readonly rescheduleUntilInclusive: boolean;
  };
  readonly location: {
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
  };
}

export type AppointmentConfirmationOutcome =
  | {
      readonly kind: 'created' | 'replayed';
      readonly appointment: AppointmentConfirmationRecord;
    }
  | { readonly kind: 'expired' };

export interface AppointmentConfirmationRepository {
  confirm(input: ConfirmAppointmentInput): Promise<AppointmentConfirmationOutcome>;
}

export class PrismaAppointmentConfirmationRepository implements AppointmentConfirmationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async confirm(input: ConfirmAppointmentInput): Promise<AppointmentConfirmationOutcome> {
    for (let attempt = 0; attempt < transactionAttemptLimit; attempt += 1) {
      try {
        return await this.confirmOnce(input);
      } catch (error) {
        if (!isRetryableTransactionError(error)) throw error;
        if (attempt === transactionAttemptLimit - 1)
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
        await boundedBackoff(attempt);
      }
    }
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  }

  private async confirmOnce(
    input: ConfirmAppointmentInput,
  ): Promise<AppointmentConfirmationOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        await advisoryLock(tx, `appointment-key:${input.consumerUserId}:${input.keyHash}`);
        const dbNow = await transactionNow(tx);
        const keyedReplay = await tx.appointmentConfirmationKey.findUnique({
          where: {
            consumerUserId_keyHash: {
              consumerUserId: input.consumerUserId,
              keyHash: input.keyHash,
            },
          },
          include: { appointment: { include: appointmentPresentationInclude } },
        });
        if (keyedReplay !== null) {
          if (keyedReplay.requestFingerprint !== input.requestFingerprint)
            throw new AppointmentConfirmationRepositoryError('idempotency_conflict');
          return {
            kind: 'replayed',
            appointment: toRecord(keyedReplay.appointment),
          };
        }

        const lockedHold = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "booking_holds"
          WHERE "id" = ${input.holdId}::uuid
            AND "consumer_user_id" = ${input.consumerUserId}::uuid
          FOR UPDATE
        `);
        if (lockedHold.length !== 1)
          throw new AppointmentConfirmationRepositoryError('hold_not_found');

        const hold = await tx.bookingHold.findUnique({ where: { id: input.holdId } });
        if (hold === null)
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');

        if (hold.status === 'CONSUMED') {
          const appointment = await tx.appointment.findUnique({
            where: { holdId: hold.id },
            include: appointmentPresentationInclude,
          });
          if (
            appointment === null ||
            appointment.consumerUserId !== input.consumerUserId ||
            appointment.tenantId !== hold.tenantId ||
            appointment.staffId !== hold.staffId
          )
            throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
          await lockAndValidateAppointmentOccupancy(tx, hold, appointment.id);
          if (appointment.policyVersion !== input.policyVersion)
            throw new AppointmentConfirmationRepositoryError('policy_version_mismatch');
          await createConfirmationKey(tx, input, appointment.tenantId, appointment.id, dbNow);
          return { kind: 'replayed', appointment: toRecord(appointment) };
        }

        const occupancy = await lockAndReadHoldOccupancy(tx, hold.id);
        validateHoldOccupancy(hold, occupancy);
        if (hold.status === 'RELEASED') {
          if (occupancy.status !== 'RELEASED')
            throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
          throw new AppointmentConfirmationRepositoryError('hold_not_active');
        }
        if (hold.status === 'EXPIRED') {
          if (occupancy.status !== 'EXPIRED')
            throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
          throw new AppointmentConfirmationRepositoryError('hold_expired');
        }
        if (occupancy.status !== 'ACTIVE')
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
        if (hold.expiresAt <= dbNow) {
          const occupancyResult = await tx.bookingOccupancy.updateMany({
            where: { id: occupancy.id, holdId: hold.id, status: 'ACTIVE' },
            data: { status: 'EXPIRED', updatedAt: dbNow },
          });
          const holdResult = await tx.bookingHold.updateMany({
            where: { id: hold.id, status: 'ACTIVE', expiresAt: { lte: dbNow } },
            data: { status: 'EXPIRED', updatedAt: dbNow },
          });
          if (occupancyResult.count !== 1 || holdResult.count !== 1)
            throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
          return { kind: 'expired' };
        }

        validateConfirmationSnapshots(hold);
        if (hold.policyVersion !== input.policyVersion)
          throw new AppointmentConfirmationRepositoryError('policy_version_mismatch');
        const tenant = await tx.tenant.findUnique({
          where: { id: hold.tenantId },
          include: {
            plan: {
              include: {
                entitlements: {
                  where: { entitlementCode: 'MAX_MONTHLY_BOOKINGS' },
                  include: { entitlement: true },
                },
              },
            },
          },
        });
        if (tenant?.status !== 'ACTIVE')
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
        const usageMonth = appointmentUsageMonth(dbNow, tenant.usageTimezone);
        const monthlyLimit = await effectiveMonthlyLimit(tx, tenant);
        await advisoryLock(tx, `appointment-usage:${tenant.id}:${usageMonth}`);
        if (monthlyLimit > 0) {
          const used = await tx.appointment.count({
            where: {
              tenantId: tenant.id,
              usageMonth,
              source: { in: [...onlineSources] },
              rescheduledFromId: null,
            },
          });
          if (used >= monthlyLimit)
            throw new AppointmentConfirmationRepositoryError('monthly_booking_limit_reached');
        }

        const initial = createNoDepositConfirmedAppointment();
        const pricing = pricingTruth(hold);
        const appointment = await tx.appointment.create({
          data: {
            tenantId: hold.tenantId,
            locationId: hold.locationId,
            staffId: hold.staffId,
            consumerUserId: input.consumerUserId,
            holdId: hold.id,
            status: initial.status,
            source: hold.source,
            pricingStatus: pricing.pricingStatus,
            paymentStatus: initial.paymentStatus,
            startAt: hold.startAt,
            endAt: hold.endAt,
            confirmedAt: dbNow,
            usageTimezoneSnapshot: tenant.usageTimezone,
            usageMonth,
            locationTimezoneSnapshot: requiredSnapshot(hold.locationTimezoneSnapshot),
            currency: hold.currencySnapshot,
            subtotalAmount: pricing.total,
            depositAmount: initial.depositAmount,
            totalAmount: pricing.total,
            bookingPolicySnapshot: requiredSnapshot(hold.bookingPolicySnapshot),
            cancellationPolicySnapshot: requiredSnapshot(hold.cancellationPolicySnapshot),
            policyVersion: requiredSnapshot(hold.policyVersion),
            policiesAcceptedAt: dbNow,
            consumerCancelLeadMinutesSnapshot: hold.consumerCancelLeadMinutesSnapshot,
            consumerRescheduleLeadMinutesSnapshot: hold.consumerRescheduleLeadMinutesSnapshot,
            locationNameSnapshot: requiredSnapshot(hold.locationNameSnapshot),
            addressTextSnapshot: requiredSnapshot(hold.addressTextSnapshot),
            postalCodeSnapshot: hold.postalCodeSnapshot,
            citySnapshot: requiredSnapshot(hold.citySnapshot),
            districtSnapshot: requiredSnapshot(hold.districtSnapshot),
            createdAt: dbNow,
            updatedAt: dbNow,
          },
        });
        await tx.appointmentItem.create({
          data: {
            tenantId: hold.tenantId,
            appointmentId: appointment.id,
            serviceId: hold.serviceId,
            serviceNameSnapshot: hold.serviceNameSnapshot,
            durationMinutesSnapshot: hold.durationMinutesSnapshot,
            priceTypeSnapshot: hold.priceTypeSnapshot,
            priceAmountSnapshot: hold.priceAmountSnapshot,
            priceMinSnapshot: hold.priceMinSnapshot,
            priceMaxSnapshot: hold.priceMaxSnapshot,
            currencySnapshot: hold.currencySnapshot,
            createdAt: dbNow,
          },
        });
        await tx.appointmentStatusHistory.create({
          data: {
            tenantId: hold.tenantId,
            appointmentId: appointment.id,
            fromStatus: initial.history.fromStatus,
            toStatus: initial.history.toStatus,
            actorUserId: input.consumerUserId,
            createdAt: dbNow,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: hold.tenantId,
            actorUserId: input.consumerUserId,
            action: 'appointment.confirmed',
            resourceType: 'appointment',
            resourceId: appointment.id,
            requestId: input.requestId,
            beforeJson: { holdId: hold.id, status: 'ACTIVE' },
            afterJson: {
              appointmentId: appointment.id,
              holdId: hold.id,
              status: initial.status,
              source: hold.source,
            },
            createdAt: dbNow,
          },
        });
        await tx.outboxEvent.create({
          data: {
            tenantId: hold.tenantId,
            aggregateType: 'appointment',
            aggregateId: appointment.id,
            eventType: 'appointment.confirmed.v1',
            payloadJson: { appointmentId: appointment.id, tenantId: hold.tenantId },
            dedupeKey: `appointment.confirmed:${appointment.id}:v1`,
            status: 'PENDING',
            availableAt: dbNow,
            attemptCount: 0,
            createdAt: dbNow,
            updatedAt: dbNow,
          },
        });
        const transfer = await tx.bookingOccupancy.updateMany({
          where: { id: occupancy.id, holdId: hold.id, appointmentId: null, status: 'ACTIVE' },
          data: { holdId: null, appointmentId: appointment.id, updatedAt: dbNow },
        });
        const consumed = await tx.bookingHold.updateMany({
          where: { id: hold.id, status: 'ACTIVE', expiresAt: { gt: dbNow } },
          data: { status: 'CONSUMED', updatedAt: dbNow },
        });
        if (transfer.count !== 1 || consumed.count !== 1)
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
        await createConfirmationKey(tx, input, hold.tenantId, appointment.id, dbNow);
        const presentation = await tx.appointment.findUnique({
          where: { id: appointment.id },
          include: appointmentPresentationInclude,
        });
        if (presentation === null)
          throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
        return { kind: 'created', appointment: toRecord(presentation) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

const appointmentPresentationInclude = {
  item: true,
  hold: { select: { staffDisplayNameSnapshot: true } },
} as const;

type AppointmentPresentation = Prisma.AppointmentGetPayload<{
  include: typeof appointmentPresentationInclude;
}>;

type LockedOccupancy = {
  readonly id: string;
  readonly tenantId: string;
  readonly staffId: string;
  readonly holdId: string | null;
  readonly appointmentId: string | null;
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  readonly occupiedStartAt: Date;
  readonly occupiedEndAt: Date;
};

async function lockAndReadHoldOccupancy(
  tx: Prisma.TransactionClient,
  holdId: string,
): Promise<LockedOccupancy> {
  const rows = await tx.$queryRaw<LockedOccupancy[]>(Prisma.sql`
    SELECT
      "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId",
      "hold_id" AS "holdId", "appointment_id" AS "appointmentId", "status",
      "occupied_start_at" AS "occupiedStartAt", "occupied_end_at" AS "occupiedEndAt"
    FROM "booking_occupancies"
    WHERE "hold_id" = ${holdId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1)
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  return rows[0] as LockedOccupancy;
}

async function lockAndValidateAppointmentOccupancy(
  tx: Prisma.TransactionClient,
  hold: {
    readonly tenantId: string;
    readonly staffId: string;
    readonly startAt: Date;
    readonly endAt: Date;
  },
  appointmentId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<LockedOccupancy[]>(Prisma.sql`
    SELECT
      "id", "tenant_id" AS "tenantId", "staff_id" AS "staffId",
      "hold_id" AS "holdId", "appointment_id" AS "appointmentId", "status",
      "occupied_start_at" AS "occupiedStartAt", "occupied_end_at" AS "occupiedEndAt"
    FROM "booking_occupancies"
    WHERE "appointment_id" = ${appointmentId}::uuid
    FOR UPDATE
  `);
  const occupancy = rows[0];
  if (
    rows.length !== 1 ||
    occupancy === undefined ||
    occupancy.status !== 'ACTIVE' ||
    occupancy.holdId !== null ||
    occupancy.appointmentId !== appointmentId ||
    occupancy.tenantId !== hold.tenantId ||
    occupancy.staffId !== hold.staffId ||
    occupancy.occupiedStartAt > hold.startAt ||
    occupancy.occupiedEndAt < hold.endAt
  )
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
}

function validateHoldOccupancy(
  hold: {
    readonly tenantId: string;
    readonly staffId: string;
    readonly startAt: Date;
    readonly endAt: Date;
  },
  occupancy: LockedOccupancy,
): void {
  if (
    occupancy.holdId === null ||
    occupancy.appointmentId !== null ||
    occupancy.tenantId !== hold.tenantId ||
    occupancy.staffId !== hold.staffId ||
    occupancy.occupiedStartAt > hold.startAt ||
    occupancy.occupiedEndAt < hold.endAt
  )
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
}

function validateConfirmationSnapshots(hold: {
  readonly bookingPolicySnapshot: string | null;
  readonly cancellationPolicySnapshot: string | null;
  readonly policyVersion: string | null;
  readonly locationNameSnapshot: string | null;
  readonly addressTextSnapshot: string | null;
  readonly citySnapshot: string | null;
  readonly districtSnapshot: string | null;
  readonly locationTimezoneSnapshot: string | null;
}): void {
  for (const value of [
    hold.bookingPolicySnapshot,
    hold.cancellationPolicySnapshot,
    hold.policyVersion,
    hold.locationNameSnapshot,
    hold.addressTextSnapshot,
    hold.citySnapshot,
    hold.districtSnapshot,
    hold.locationTimezoneSnapshot,
  ]) {
    if (value === null || value.trim() === '')
      throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  }
  if (!/^v[12]:[0-9a-f]{64}$/.test(hold.policyVersion ?? ''))
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
}

async function effectiveMonthlyLimit(
  tx: Prisma.TransactionClient,
  tenant: {
    readonly subscriptionStatus: 'FREE' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
    readonly plan: {
      readonly entitlements: readonly {
        readonly valueJson: Prisma.JsonValue;
        readonly entitlement: { readonly valueType: 'INTEGER' | 'BOOLEAN' };
      }[];
    } | null;
  },
): Promise<number> {
  let entitlement:
    | {
        readonly valueJson: Prisma.JsonValue;
        readonly entitlement: { readonly valueType: 'INTEGER' | 'BOOLEAN' };
      }
    | undefined;
  if (tenant.subscriptionStatus === 'TRIALING' || tenant.subscriptionStatus === 'ACTIVE') {
    entitlement = tenant.plan?.entitlements[0];
  } else {
    const defaults = await tx.plan.findMany({
      where: { isDefault: true },
      take: 2,
      include: {
        entitlements: {
          where: { entitlementCode: 'MAX_MONTHLY_BOOKINGS' },
          include: { entitlement: true },
        },
      },
    });
    if (defaults.length !== 1)
      throw new AppointmentConfirmationRepositoryError('entitlement_unavailable');
    entitlement = defaults[0]?.entitlements[0];
  }
  if (
    entitlement?.entitlement.valueType !== 'INTEGER' ||
    typeof entitlement.valueJson !== 'number' ||
    !Number.isInteger(entitlement.valueJson) ||
    entitlement.valueJson < 0
  )
    throw new AppointmentConfirmationRepositoryError('entitlement_unavailable');
  return entitlement.valueJson;
}

function pricingTruth(hold: {
  readonly priceTypeSnapshot: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
  readonly priceAmountSnapshot: number | null;
}): {
  readonly pricingStatus: 'EXACT' | 'ESTIMATE' | 'QUOTE_REQUIRED';
  readonly total: number | null;
} {
  if (hold.priceTypeSnapshot === 'FIXED') {
    if (hold.priceAmountSnapshot === null)
      throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
    return { pricingStatus: 'EXACT', total: hold.priceAmountSnapshot };
  }
  return {
    pricingStatus: hold.priceTypeSnapshot === 'QUOTE' ? 'QUOTE_REQUIRED' : 'ESTIMATE',
    total: null,
  };
}

export function appointmentUsageMonth(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
  } catch {
    throw new AppointmentConfirmationRepositoryError('entitlement_unavailable');
  }
  const year = parts.find(({ type }) => type === 'year')?.value;
  const month = parts.find(({ type }) => type === 'month')?.value;
  if (year === undefined || month === undefined)
    throw new AppointmentConfirmationRepositoryError('entitlement_unavailable');
  return `${year}-${month}`;
}

async function createConfirmationKey(
  tx: Prisma.TransactionClient,
  input: ConfirmAppointmentInput,
  tenantId: string,
  appointmentId: string,
  dbNow: Date,
): Promise<void> {
  await tx.appointmentConfirmationKey.create({
    data: {
      consumerUserId: input.consumerUserId,
      keyHash: input.keyHash,
      tenantId,
      appointmentId,
      requestFingerprint: input.requestFingerprint,
      createdAt: dbNow,
    },
  });
}

function toRecord(appointment: AppointmentPresentation): AppointmentConfirmationRecord {
  const item = appointment.item;
  if (
    item === null ||
    appointment.status !== 'CONFIRMED' ||
    appointment.paymentStatus !== 'NOT_REQUIRED'
  )
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  return {
    id: appointment.id,
    status: appointment.status,
    source: appointment.source,
    pricingStatus: appointment.pricingStatus,
    paymentStatus: appointment.paymentStatus,
    timezone: appointment.locationTimezoneSnapshot,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    confirmedAt: appointment.confirmedAt,
    currency: appointment.currency,
    subtotalAmount: appointment.subtotalAmount,
    depositAmount: 0,
    totalAmount: appointment.totalAmount,
    service: {
      id: item.serviceId,
      name: item.serviceNameSnapshot,
      durationMinutes: item.durationMinutesSnapshot,
      priceType: item.priceTypeSnapshot,
      priceAmount: item.priceAmountSnapshot,
      priceMin: item.priceMinSnapshot,
      priceMax: item.priceMaxSnapshot,
      currency: item.currencySnapshot,
    },
    staff: { id: appointment.staffId, displayName: appointment.hold.staffDisplayNameSnapshot },
    policies: {
      version: appointment.policyVersion,
      bookingPolicy: appointment.bookingPolicySnapshot,
      cancellationPolicy: appointment.cancellationPolicySnapshot,
      acceptedAt: appointment.policiesAcceptedAt,
      consumerCancelLeadMinutes: appointment.consumerCancelLeadMinutesSnapshot,
      consumerRescheduleLeadMinutes: appointment.consumerRescheduleLeadMinutesSnapshot,
      cancelUntil: new Date(
        appointment.startAt.getTime() - appointment.consumerCancelLeadMinutesSnapshot * 60_000,
      ),
      rescheduleUntil: new Date(
        appointment.startAt.getTime() - appointment.consumerRescheduleLeadMinutesSnapshot * 60_000,
      ),
      cancelUntilInclusive: appointment.consumerCancelLeadMinutesSnapshot > 0,
      rescheduleUntilInclusive: appointment.consumerRescheduleLeadMinutesSnapshot > 0,
    },
    location: {
      name: appointment.locationNameSnapshot,
      addressText: appointment.addressTextSnapshot,
      postalCode: appointment.postalCodeSnapshot,
      city: appointment.citySnapshot,
      district: appointment.districtSnapshot,
    },
  };
}

function requiredSnapshot(value: string | null): string {
  if (value === null || value.trim() === '')
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  return value;
}

async function advisoryLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`,
  );
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ dbNow: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "dbNow"`,
  );
  const dbNow = rows[0]?.dbNow;
  if (dbNow === undefined)
    throw new AppointmentConfirmationRepositoryError('booking_confirmation_unavailable');
  return dbNow;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientKnownRequestError
  )
    return error.message.includes('40001') || error.message.includes('40P01');
  return false;
}

async function boundedBackoff(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
}
