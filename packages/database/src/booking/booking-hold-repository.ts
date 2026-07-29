import { createHash } from 'node:crypto';

import { Prisma, type BookingHoldStatus, type PrismaClient } from '@prisma/client';
import { calculateAvailability, instantToLocalDate } from '@nook/domain';

const minuteMs = 60_000;
const holdTtlMinutes = 10;
const transactionAttemptLimit = 3;

export type BookingHoldConflictCode =
  | 'hold_not_found'
  | 'hold_consumed'
  | 'hold_snapshot_unavailable'
  | 'idempotency_conflict'
  | 'availability_policy_unavailable'
  | 'slot_no_longer_available';

export class BookingHoldRepositoryError extends Error {
  constructor(readonly code: BookingHoldConflictCode) {
    super(code);
    this.name = 'BookingHoldRepositoryError';
  }
}

export interface BookingHoldRecord {
  readonly id: string;
  readonly status: BookingHoldStatus;
  readonly timezone: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly expiresAt: Date;
  readonly appointmentCreated: false;
  readonly policies: {
    readonly version: string;
    readonly bookingPolicy: string;
    readonly cancellationPolicy: string;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
    readonly cancelUntil: Date;
    readonly rescheduleUntil: Date;
    readonly cancelUntilInclusive: boolean;
    readonly rescheduleUntilInclusive: boolean;
  };
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
}

export interface AcquireBookingHoldInput {
  readonly consumerUserId: string;
  readonly slug: string;
  readonly serviceId: string;
  readonly staffId?: string;
  readonly startAt: Date;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  /** Legacy callers omit this field and deliberately retain v1 snapshots during rollout. */
  readonly policyVersion?: 1 | 2;
}

export interface BookingHoldRateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly replay: boolean;
}

export interface BookingHoldRepository {
  consumeCreateAttempt(input: {
    readonly consumerUserId: string;
    readonly keyHash: string;
    readonly limit: number;
    readonly windowSeconds: number;
  }): Promise<BookingHoldRateDecision>;
  acquire(input: AcquireBookingHoldInput): Promise<BookingHoldRecord>;
  release(input: { readonly consumerUserId: string; readonly holdId: string }): Promise<void>;
  expireBatch(limit: number): Promise<number>;
}

export class PrismaBookingHoldRepository implements BookingHoldRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async consumeCreateAttempt(input: {
    readonly consumerUserId: string;
    readonly keyHash: string;
    readonly limit: number;
    readonly windowSeconds: number;
  }): Promise<BookingHoldRateDecision> {
    return this.prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `booking-hold-rate:${input.consumerUserId}`);
      const dbNow = await transactionNow(tx);
      const windowMilliseconds = input.windowSeconds * 1_000;
      const windowStart = new Date(
        Math.floor(dbNow.getTime() / windowMilliseconds) * windowMilliseconds,
      );
      const expiresAt = new Date(windowStart.getTime() + windowMilliseconds * 2);
      await tx.bookingHoldRateAttempt.deleteMany({ where: { expiresAt: { lte: dbNow } } });
      const inserted = await tx.bookingHoldRateAttempt.createMany({
        data: [
          { consumerUserId: input.consumerUserId, windowStart, keyHash: input.keyHash, expiresAt },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        return { allowed: true, retryAfterSeconds: 0, replay: true };
      }
      const attemptCount = await tx.bookingHoldRateAttempt.count({
        where: { consumerUserId: input.consumerUserId, windowStart },
      });
      return {
        allowed: attemptCount <= input.limit,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowStart.getTime() + windowMilliseconds - dbNow.getTime()) / 1_000),
        ),
        replay: false,
      };
    });
  }

  async acquire(input: AcquireBookingHoldInput): Promise<BookingHoldRecord> {
    for (let attempt = 0; attempt < transactionAttemptLimit; attempt += 1) {
      try {
        return await this.acquireOnce(input);
      } catch (error) {
        if (isRetryableTransactionError(error)) {
          if (attempt < transactionAttemptLimit - 1) continue;
          throw new BookingHoldRepositoryError('slot_no_longer_available');
        }
        if (isOccupancyConflict(error)) {
          throw new BookingHoldRepositoryError('slot_no_longer_available');
        }
        throw error;
      }
    }
    throw new BookingHoldRepositoryError('slot_no_longer_available');
  }

  async release(input: {
    readonly consumerUserId: string;
    readonly holdId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockHoldIds(tx, [input.holdId]);
      const hold = await tx.bookingHold.findFirst({
        where: { id: input.holdId, consumerUserId: input.consumerUserId },
        select: { id: true, status: true, expiresAt: true },
      });
      if (hold === null) throw new BookingHoldRepositoryError('hold_not_found');
      const dbNow = await transactionNow(tx);
      if (hold.status === 'CONSUMED') throw new BookingHoldRepositoryError('hold_consumed');
      if (hold.status === 'RELEASED' || hold.status === 'EXPIRED') return;
      const status = hold.expiresAt <= dbNow ? 'EXPIRED' : 'RELEASED';
      await tx.bookingOccupancy.updateMany({
        where: { holdId: hold.id, status: 'ACTIVE' },
        data: { status },
      });
      await tx.bookingHold.update({ where: { id: hold.id }, data: { status } });
    });
  }

  async expireBatch(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error('invalid batch limit');
    return this.prisma.$transaction(async (tx) => {
      await advisoryLock(tx, 'booking-hold-expiry-worker');
      const dbNow = await transactionNow(tx);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "booking_holds"
        WHERE "status" = 'ACTIVE'::"BookingHoldStatus"
          AND "expires_at" <= ${dbNow}
        ORDER BY "expires_at" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      const ids = rows.map(({ id }) => id);
      if (ids.length === 0) return 0;
      await tx.bookingOccupancy.updateMany({
        where: { holdId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      const result = await tx.bookingHold.updateMany({
        where: { id: { in: ids }, status: 'ACTIVE', expiresAt: { lte: dbNow } },
        data: { status: 'EXPIRED' },
      });
      return result.count;
    });
  }

  private async acquireOnce(input: AcquireBookingHoldInput): Promise<BookingHoldRecord> {
    return this.prisma.$transaction(
      async (tx) => {
        // Acquire before the first snapshot-producing query. Under SERIALIZABLE isolation,
        // locking later would let a waiter keep a snapshot from before the winner committed.
        await advisoryLock(tx, `booking-hold-slug:${input.slug}:${input.consumerUserId}`);
        const dbNow = await transactionNow(tx);
        const replay = await tx.bookingHold.findUnique({
          where: {
            consumerUserId_idempotencyKeyHash: {
              consumerUserId: input.consumerUserId,
              idempotencyKeyHash: input.idempotencyKeyHash,
            },
          },
          include: { location: { select: { timezone: true } } },
        });
        if (replay !== null) {
          if (replay.requestFingerprint !== input.requestFingerprint)
            throw new BookingHoldRepositoryError('idempotency_conflict');
          const current = await this.expireReplayIfNeeded(tx, replay, dbNow);
          return toRecord(current, replay.location.timezone);
        }

        const tenant = await tx.tenant.findFirst({
          where: {
            slug: input.slug,
            status: 'ACTIVE',
            merchantProfile: { is: { visibilityStatus: 'PUBLISHED', publishedAt: { not: null } } },
          },
          select: {
            id: true,
            bookingPolicy: true,
            merchantProfile: {
              select: {
                bookingPolicy: true,
                cancellationPolicy: true,
                primaryLocation: {
                  select: {
                    id: true,
                    name: true,
                    addressText: true,
                    postalCode: true,
                    city: true,
                    district: true,
                    timezone: true,
                    status: true,
                  },
                },
              },
            },
          },
        });
        const location = tenant?.merchantProfile?.primaryLocation;
        if (tenant === null || tenant === undefined || location?.status !== 'ACTIVE')
          throw new BookingHoldRepositoryError('hold_not_found');
        if (tenant.bookingPolicy === null)
          throw new BookingHoldRepositoryError('availability_policy_unavailable');
        const bookingPolicy = tenant.merchantProfile?.bookingPolicy?.trim();
        const cancellationPolicy = tenant.merchantProfile?.cancellationPolicy?.trim();
        if (
          bookingPolicy === undefined ||
          bookingPolicy === '' ||
          cancellationPolicy === undefined ||
          cancellationPolicy === ''
        )
          throw new BookingHoldRepositoryError('hold_snapshot_unavailable');
        const policySchemaVersion = input.policyVersion ?? 1;
        const consumerCancelLeadMinutes =
          policySchemaVersion === 2 ? tenant.bookingPolicy.consumerCancelLeadMinutes : 1_440;
        const consumerRescheduleLeadMinutes =
          policySchemaVersion === 2 ? tenant.bookingPolicy.consumerRescheduleLeadMinutes : 1_440;
        const policyVersion =
          policySchemaVersion === 2
            ? createBookingPolicyVersionV2(
                bookingPolicy,
                cancellationPolicy,
                consumerCancelLeadMinutes,
                consumerRescheduleLeadMinutes,
              )
            : createBookingPolicyVersion(bookingPolicy, cancellationPolicy);

        await advisoryLock(tx, `booking-hold:${tenant.id}:${input.consumerUserId}`);
        const localDate = instantToLocalDate(input.startAt, location.timezone);
        validateDateWindow(
          localDate,
          instantToLocalDate(dbNow, location.timezone),
          tenant.bookingPolicy.maximumAdvanceDays,
        );
        const rangeStart = new Date(input.startAt.getTime() - 18 * 60 * minuteMs);
        const rangeEnd = new Date(input.startAt.getTime() + (24 + 18) * 60 * minuteMs);
        const service = await tx.service.findFirst({
          where: {
            id: input.serviceId,
            tenantId: tenant.id,
            status: 'ACTIVE',
            bookingEnabled: true,
          },
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
            priceType: true,
            priceAmount: true,
            priceMin: true,
            priceMax: true,
            currency: true,
          },
        });
        if (service === null) throw new BookingHoldRepositoryError('hold_not_found');
        const staff = await tx.staffProfile.findMany({
          where: {
            tenantId: tenant.id,
            locationId: location.id,
            ...(input.staffId === undefined ? {} : { id: input.staffId }),
            status: 'ACTIVE',
            bookingEnabled: true,
            services: { some: { serviceId: service.id } },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            displayName: true,
            services: {
              where: { serviceId: service.id },
              select: { customDurationMinutes: true, customPriceAmount: true },
              take: 1,
            },
            weeklyRules: {
              where: {
                validFrom: { lte: rangeEnd },
                OR: [{ validUntil: null }, { validUntil: { gte: rangeStart } }],
              },
              select: {
                weekday: true,
                startTime: true,
                endTime: true,
                validFrom: true,
                validUntil: true,
              },
            },
            exceptions: {
              where: {
                status: 'ACTIVE',
                startAt: { lt: rangeEnd },
                endAt: { gt: rangeStart },
              },
              select: { type: true, startAt: true, endAt: true },
            },
          },
        });
        if (staff.length === 0) throw new BookingHoldRepositoryError('hold_not_found');

        await expireCandidateStaff(
          tx,
          tenant.id,
          staff.map(({ id }) => id),
          dbNow,
        );
        const occupancies = await tx.bookingOccupancy.findMany({
          where: {
            tenantId: tenant.id,
            staffId: { in: staff.map(({ id }) => id) },
            status: 'ACTIVE',
            occupiedStartAt: { lt: rangeEnd },
            occupiedEndAt: { gt: rangeStart },
            OR: [
              { appointmentId: { not: null } },
              { holdId: { not: null }, hold: { status: 'ACTIVE', expiresAt: { gt: dbNow } } },
            ],
          },
          select: { staffId: true, occupiedStartAt: true, occupiedEndAt: true },
        });
        const slots = calculateAvailability({
          timeZone: location.timezone,
          date: localDate,
          days: 1,
          slotIntervalMinutes: tenant.bookingPolicy.slotIntervalMinutes,
          earliestStartAt: new Date(
            dbNow.getTime() + tenant.bookingPolicy.minimumLeadMinutes * minuteMs,
          ),
          serviceDurationMinutes: service.durationMinutes,
          bufferBeforeMinutes: service.bufferBeforeMinutes,
          bufferAfterMinutes: service.bufferAfterMinutes,
          staff: staff.map((item) => ({
            id: item.id,
            displayName: item.displayName,
            durationMinutes: item.services[0]?.customDurationMinutes ?? null,
            weeklyRules: item.weeklyRules.map((rule) => ({
              weekday: rule.weekday,
              startTime: timeValue(rule.startTime),
              endTime: timeValue(rule.endTime),
              validFrom: dateValue(rule.validFrom),
              validUntil: rule.validUntil === null ? null : dateValue(rule.validUntil),
            })),
            exceptions: item.exceptions.map((exception) => ({
              kind: exception.type,
              startAt: exception.startAt,
              endAt: exception.endAt,
            })),
            occupancy: occupancies
              .filter(({ staffId }) => staffId === item.id)
              .map(({ occupiedStartAt, occupiedEndAt }) => ({
                startAt: occupiedStartAt,
                endAt: occupiedEndAt,
              })),
          })),
        });
        const slot = slots.find(({ startAt }) => startAt.getTime() === input.startAt.getTime());
        const chosenStaffId =
          input.staffId ?? staff.find(({ id }) => slot?.eligibleStaffIds.includes(id))?.id;
        if (
          slot === undefined ||
          chosenStaffId === undefined ||
          !slot.eligibleStaffIds.includes(chosenStaffId)
        )
          throw new BookingHoldRepositoryError('slot_no_longer_available');
        const chosenStaff = staff.find(({ id }) => id === chosenStaffId);
        if (chosenStaff === undefined)
          throw new BookingHoldRepositoryError('slot_no_longer_available');
        const durationMinutes =
          chosenStaff.services[0]?.customDurationMinutes ?? service.durationMinutes;
        const price = priceSnapshot(service, chosenStaff.services[0]?.customPriceAmount ?? null);

        const previous = await tx.bookingHold.findMany({
          where: {
            tenantId: tenant.id,
            consumerUserId: input.consumerUserId,
            status: 'ACTIVE',
            expiresAt: { gt: dbNow },
          },
          select: { id: true },
        });
        const previousIds = previous.map(({ id }) => id);
        if (previousIds.length > 0) {
          await lockHoldIds(tx, previousIds);
          await tx.bookingOccupancy.updateMany({
            where: { holdId: { in: previousIds }, status: 'ACTIVE' },
            data: { status: 'RELEASED' },
          });
          await tx.bookingHold.updateMany({
            where: { id: { in: previousIds }, status: 'ACTIVE' },
            data: { status: 'RELEASED' },
          });
        }

        const expiresAt = new Date(dbNow.getTime() + holdTtlMinutes * minuteMs);
        const hold = await tx.bookingHold.create({
          data: {
            tenantId: tenant.id,
            locationId: location.id,
            serviceId: service.id,
            staffId: chosenStaff.id,
            consumerUserId: input.consumerUserId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            serviceNameSnapshot: service.name,
            staffDisplayNameSnapshot: chosenStaff.displayName,
            durationMinutesSnapshot: durationMinutes,
            ...price,
            source: 'MERCHANT_LINK',
            bookingPolicySnapshot: bookingPolicy,
            cancellationPolicySnapshot: cancellationPolicy,
            policyVersion,
            consumerCancelLeadMinutesSnapshot: consumerCancelLeadMinutes,
            consumerRescheduleLeadMinutesSnapshot: consumerRescheduleLeadMinutes,
            locationNameSnapshot: location.name,
            addressTextSnapshot: location.addressText,
            postalCodeSnapshot: location.postalCode,
            citySnapshot: location.city,
            districtSnapshot: location.district,
            locationTimezoneSnapshot: location.timezone,
            expiresAt,
            idempotencyKeyHash: input.idempotencyKeyHash,
            requestFingerprint: input.requestFingerprint,
            createdAt: dbNow,
            updatedAt: dbNow,
          },
        });
        await tx.bookingOccupancy.create({
          data: {
            tenantId: tenant.id,
            staffId: chosenStaff.id,
            holdId: hold.id,
            occupiedStartAt: new Date(
              slot.startAt.getTime() - service.bufferBeforeMinutes * minuteMs,
            ),
            occupiedEndAt: new Date(slot.endAt.getTime() + service.bufferAfterMinutes * minuteMs),
            createdAt: dbNow,
            updatedAt: dbNow,
          },
        });
        return toRecord(hold, location.timezone);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async expireReplayIfNeeded(
    tx: Prisma.TransactionClient,
    hold: Parameters<typeof toRecord>[0],
    dbNow: Date,
  ): Promise<Parameters<typeof toRecord>[0]> {
    if (hold.status !== 'ACTIVE' || hold.expiresAt > dbNow) return hold;
    await lockHoldIds(tx, [hold.id]);
    const locked = await tx.bookingHold.findUniqueOrThrow({ where: { id: hold.id } });
    if (locked.status !== 'ACTIVE' || locked.expiresAt > dbNow) return locked;
    await tx.bookingOccupancy.updateMany({
      where: { holdId: locked.id, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    return tx.bookingHold.update({ where: { id: locked.id }, data: { status: 'EXPIRED' } });
  }
}

async function expireCandidateStaff(
  tx: Prisma.TransactionClient,
  tenantId: string,
  staffIds: readonly string[],
  dbNow: Date,
): Promise<void> {
  const expired = await tx.bookingHold.findMany({
    where: {
      tenantId,
      staffId: { in: [...staffIds] },
      status: 'ACTIVE',
      expiresAt: { lte: dbNow },
    },
    select: { id: true },
  });
  const ids = expired.map(({ id }) => id);
  if (ids.length === 0) return;
  await lockHoldIds(tx, ids);
  await tx.bookingOccupancy.updateMany({
    where: { holdId: { in: ids }, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });
  await tx.bookingHold.updateMany({
    where: { id: { in: ids }, status: 'ACTIVE', expiresAt: { lte: dbNow } },
    data: { status: 'EXPIRED' },
  });
}

async function lockHoldIds(
  tx: Prisma.TransactionClient,
  holdIds: readonly string[],
): Promise<void> {
  if (holdIds.length === 0) return;
  const ids = holdIds.map((id) => Prisma.sql`${id}::uuid`);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "booking_holds"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
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
  if (dbNow === undefined) throw new Error('database clock did not return a value');
  return dbNow;
}

function toRecord(
  hold: {
    readonly id: string;
    readonly serviceId: string;
    readonly staffId: string;
    readonly status: BookingHoldStatus;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly expiresAt: Date;
    readonly serviceNameSnapshot: string;
    readonly staffDisplayNameSnapshot: string;
    readonly durationMinutesSnapshot: number;
    readonly priceTypeSnapshot: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmountSnapshot: number | null;
    readonly priceMinSnapshot: number | null;
    readonly priceMaxSnapshot: number | null;
    readonly currencySnapshot: string;
    readonly bookingPolicySnapshot: string | null;
    readonly cancellationPolicySnapshot: string | null;
    readonly policyVersion: string | null;
    readonly consumerCancelLeadMinutesSnapshot: number;
    readonly consumerRescheduleLeadMinutesSnapshot: number;
  },
  timezone: string,
): BookingHoldRecord {
  if (
    hold.bookingPolicySnapshot === null ||
    hold.cancellationPolicySnapshot === null ||
    hold.policyVersion === null
  )
    throw new BookingHoldRepositoryError('hold_snapshot_unavailable');
  return {
    id: hold.id,
    status: hold.status,
    timezone,
    startAt: hold.startAt,
    endAt: hold.endAt,
    expiresAt: hold.expiresAt,
    appointmentCreated: false,
    policies: {
      version: hold.policyVersion,
      bookingPolicy: hold.bookingPolicySnapshot,
      cancellationPolicy: hold.cancellationPolicySnapshot,
      consumerCancelLeadMinutes: hold.consumerCancelLeadMinutesSnapshot,
      consumerRescheduleLeadMinutes: hold.consumerRescheduleLeadMinutesSnapshot,
      cancelUntil: new Date(
        hold.startAt.getTime() - hold.consumerCancelLeadMinutesSnapshot * minuteMs,
      ),
      rescheduleUntil: new Date(
        hold.startAt.getTime() - hold.consumerRescheduleLeadMinutesSnapshot * minuteMs,
      ),
      cancelUntilInclusive: hold.consumerCancelLeadMinutesSnapshot > 0,
      rescheduleUntilInclusive: hold.consumerRescheduleLeadMinutesSnapshot > 0,
    },
    service: {
      id: hold.serviceId,
      name: hold.serviceNameSnapshot,
      durationMinutes: hold.durationMinutesSnapshot,
      priceType: hold.priceTypeSnapshot,
      priceAmount: hold.priceAmountSnapshot,
      priceMin: hold.priceMinSnapshot,
      priceMax: hold.priceMaxSnapshot,
      currency: hold.currencySnapshot,
    },
    staff: { id: hold.staffId, displayName: hold.staffDisplayNameSnapshot },
  };
}

export function createBookingPolicyVersion(
  bookingPolicy: string,
  cancellationPolicy: string,
): string {
  const canonical = JSON.stringify({ version: 1, bookingPolicy, cancellationPolicy });
  return `v1:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function createBookingPolicyVersionV2(
  bookingPolicy: string,
  cancellationPolicy: string,
  consumerCancelLeadMinutes: number,
  consumerRescheduleLeadMinutes: number,
): string {
  const canonical = JSON.stringify({
    version: 2,
    bookingPolicy,
    cancellationPolicy,
    consumerCancelLeadMinutes,
    consumerRescheduleLeadMinutes,
  });
  return `v2:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function priceSnapshot(
  service: {
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: string;
  },
  customPriceAmount: number | null,
) {
  if (customPriceAmount !== null) {
    return {
      priceTypeSnapshot: 'FIXED' as const,
      priceAmountSnapshot: customPriceAmount,
      priceMinSnapshot: null,
      priceMaxSnapshot: null,
      currencySnapshot: service.currency,
    };
  }
  return {
    priceTypeSnapshot: service.priceType,
    priceAmountSnapshot: service.priceAmount,
    priceMinSnapshot: service.priceMin,
    priceMaxSnapshot: service.priceMax,
    currencySnapshot: service.currency,
  };
}

function validateDateWindow(date: string, today: string, maximumAdvanceDays: number): void {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  const todayValue = Date.parse(`${today}T00:00:00.000Z`);
  if (value < todayValue || value > todayValue + maximumAdvanceDays * 86_400_000)
    throw new BookingHoldRepositoryError('slot_no_longer_available');
}

function timeValue(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}

function dateValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isRetryableTransactionError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')
  )
    return true;
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    (error.message.includes('code: "40P01"') || error.message.includes('code: "40001"'))
  );
}

function isOccupancyConflict(error: unknown): boolean {
  const constraintName = 'booking_occupancies_no_overlap';
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    return (
      error.message.includes(constraintName) ||
      JSON.stringify(error.meta ?? {}).includes(constraintName)
    );
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes('23P01') &&
    error.message.includes(constraintName)
  );
}
