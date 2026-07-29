import { CustomerProjectionCorruption, deriveCustomerProjection } from '@nook/domain';
import { Prisma, type PrismaClient } from '@prisma/client';

export const CUSTOMER_PROJECTOR = 'consumer_crm_v1';
export const CUSTOMER_PROJECTION_MAX_ATTEMPTS = 10;

interface BackfillCandidate {
  readonly appointmentId: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly createdAt: Date;
}

export type CustomerProjectionBackfillOutcome =
  | { readonly kind: 'projected'; readonly customerId: string; readonly appointmentId: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly code: string };

export interface RepairCustomerProjectionInput {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly blockedDeliveryId: string;
}

export type RepairCustomerProjectionOutcome =
  | { readonly kind: 'repaired'; readonly deliveryId: string }
  | { readonly kind: 'not_blocked' }
  | { readonly kind: 'still_corrupt'; readonly code: string };

export interface RetryExhaustedCustomerProjectionInput {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly deliveryId: string;
}

export interface CustomerProjectionOperationalSnapshot {
  readonly oldestPendingAgeSeconds: number | null;
  readonly blockedStreamCount: number;
  readonly retryExhaustedCount: number;
  readonly backfillStatus: 'NOT_STARTED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly backfillRemainingAppointmentCount: number;
}

export async function runCustomerProjectionBackfillNext(
  prisma: PrismaClient,
): Promise<CustomerProjectionBackfillOutcome> {
  return prisma.$transaction(async (tx) => {
    const dbNow = await transactionNow(tx);
    await tx.crmBackfillCheckpoint.upsert({
      where: { projector: CUSTOMER_PROJECTOR },
      create: { projector: CUSTOMER_PROJECTOR, status: 'PENDING', updatedAt: dbNow },
      update: {},
    });
    const checkpoint = await lockBackfillCheckpoint(tx);
    if (checkpoint.status === 'COMPLETED') return { kind: 'completed' };
    if (checkpoint.status === 'FAILED') {
      return { kind: 'failed', code: checkpoint.safeCode ?? 'backfill_failed' };
    }

    const candidate = await findNextBackfillCandidate(tx, checkpoint);
    if (candidate === null) {
      await tx.crmBackfillCheckpoint.update({
        where: { projector: CUSTOMER_PROJECTOR },
        data: { status: 'COMPLETED', safeCode: null, updatedAt: dbNow },
      });
      return { kind: 'completed' };
    }

    await ensureActiveStream(tx, candidate, dbNow);
    const stream = await lockProjectionStream(tx, candidate);
    if (stream.status === 'BLOCKED') {
      await failBackfill(tx, 'blocked_stream', dbNow);
      return { kind: 'failed', code: 'blocked_stream' };
    }

    const appointments = await readAppointments(tx, candidate);
    try {
      const aggregate = deriveCustomerProjection(appointments, candidate.appointmentId);
      const customer = await tx.customer.upsert({
        where: {
          tenantId_consumerUserId: {
            tenantId: candidate.tenantId,
            consumerUserId: candidate.consumerUserId,
          },
        },
        create: {
          tenantId: candidate.tenantId,
          consumerUserId: candidate.consumerUserId,
          relationshipStartedAt: aggregate.relationshipStartedAt,
          firstVisitAt: aggregate.firstVisitAt,
          lastVisitAt: aggregate.lastVisitAt,
          completedVisitCount: aggregate.completedVisitCount,
          noShowCount: aggregate.noShowCount,
          projectionVersion: 1,
          projectedAt: dbNow,
          updatedAt: dbNow,
        },
        update: {
          firstVisitAt: aggregate.firstVisitAt,
          lastVisitAt: aggregate.lastVisitAt,
          completedVisitCount: aggregate.completedVisitCount,
          noShowCount: aggregate.noShowCount,
          projectionVersion: 1,
          projectedAt: dbNow,
          updatedAt: dbNow,
        },
      });
      await tx.crmBackfillCheckpoint.update({
        where: { projector: CUSTOMER_PROJECTOR },
        data: {
          cursorCreatedAt: candidate.createdAt,
          cursorId: candidate.appointmentId,
          status: 'PROCESSING',
          safeCode: null,
          updatedAt: dbNow,
        },
      });
      return {
        kind: 'projected',
        customerId: customer.id,
        appointmentId: candidate.appointmentId,
      };
    } catch (error) {
      if (!(error instanceof CustomerProjectionCorruption)) throw error;
      await failBackfill(tx, error.code, dbNow);
      return { kind: 'failed', code: error.code };
    }
  });
}

export async function sweepCustomerProjectionRetryExhausted(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const dbNow = await transactionNow(tx);
    const result = await tx.crmProjectionDelivery.updateMany({
      where: {
        projector: CUSTOMER_PROJECTOR,
        attemptCount: { gte: CUSTOMER_PROJECTION_MAX_ATTEMPTS },
        OR: [
          { status: 'PENDING', NOT: { safeCode: 'retry_exhausted' } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: dbNow } },
        ],
      },
      data: {
        status: 'PENDING',
        claimToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: dbNow,
        safeCode: 'retry_exhausted',
        updatedAt: dbNow,
      },
    });
    return result.count;
  });
}

export async function retryCustomerProjectionExhaustedDelivery(
  prisma: PrismaClient,
  input: RetryExhaustedCustomerProjectionInput,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const dbNow = await transactionNow(tx);
    const rows = await tx.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
      SELECT delivery."id"
      FROM "crm_projection_deliveries" AS delivery
      LEFT JOIN "crm_projection_streams" AS stream
        ON stream."projector" = delivery."projector"
       AND stream."tenant_id" = delivery."tenant_id"
       AND stream."consumer_user_id" = delivery."consumer_user_id"
      WHERE delivery."id" = ${input.deliveryId}::uuid
        AND delivery."projector" = ${CUSTOMER_PROJECTOR}
        AND delivery."tenant_id" = ${input.tenantId}::uuid
        AND delivery."consumer_user_id" = ${input.consumerUserId}::uuid
        AND delivery."status" = 'PENDING'::"CrmProjectionDeliveryStatus"
        AND delivery."attempt_count" >= ${CUSTOMER_PROJECTION_MAX_ATTEMPTS}
        AND delivery."safe_code" = 'retry_exhausted'
        AND COALESCE(stream."status", 'ACTIVE'::"CrmProjectionStreamStatus")
            = 'ACTIVE'::"CrmProjectionStreamStatus"
      FOR UPDATE OF delivery
    `);
    if (rows[0] === undefined) return false;
    await tx.crmProjectionDelivery.update({
      where: { id: input.deliveryId },
      data: {
        attemptCount: 0,
        nextAttemptAt: dbNow,
        safeCode: null,
        updatedAt: dbNow,
      },
    });
    return true;
  });
}

export async function repairCustomerProjectionStream(
  prisma: PrismaClient,
  input: RepairCustomerProjectionInput,
): Promise<RepairCustomerProjectionOutcome> {
  return prisma.$transaction(async (tx) => {
    const stream = await lockProjectionStream(tx, input);
    if (stream.status !== 'BLOCKED' || stream.blockedDeliveryId !== input.blockedDeliveryId) {
      return { kind: 'not_blocked' };
    }

    const delivery = await tx.crmProjectionDelivery.findFirst({
      where: {
        id: input.blockedDeliveryId,
        projector: CUSTOMER_PROJECTOR,
        tenantId: input.tenantId,
        consumerUserId: input.consumerUserId,
        status: 'TERMINAL',
        outcome: 'INVARIANT_CORRUPTION',
      },
      select: { id: true, appointmentId: true },
    });
    if (delivery === null) return { kind: 'not_blocked' };

    const appointments = await readAppointments(tx, input);
    try {
      deriveCustomerProjection(appointments, delivery.appointmentId);
    } catch (error) {
      if (!(error instanceof CustomerProjectionCorruption)) throw error;
      return { kind: 'still_corrupt', code: error.code };
    }

    const dbNow = await transactionNow(tx);
    await tx.crmProjectionDelivery.update({
      where: { id: delivery.id },
      data: {
        customerId: null,
        status: 'PENDING',
        claimToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        nextAttemptAt: dbNow,
        outcome: null,
        projectedAt: null,
        safeCode: null,
        updatedAt: dbNow,
      },
    });
    await tx.crmProjectionStream.update({
      where: {
        projector_tenantId_consumerUserId: {
          projector: CUSTOMER_PROJECTOR,
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
        },
      },
      data: {
        status: 'ACTIVE',
        blockedDeliveryId: null,
        safeCode: null,
        updatedAt: dbNow,
      },
    });
    return { kind: 'repaired', deliveryId: delivery.id };
  });
}

export async function resumeCustomerProjectionBackfill(
  prisma: PrismaClient,
  expectedCursorId: string | null,
): Promise<boolean> {
  const result = await prisma.crmBackfillCheckpoint.updateMany({
    where: {
      projector: CUSTOMER_PROJECTOR,
      status: 'FAILED',
      cursorId: expectedCursorId,
    },
    data: { status: 'PENDING', safeCode: null, updatedAt: new Date() },
  });
  return result.count === 1;
}

export async function readCustomerProjectionOperationalSnapshot(
  prisma: PrismaClient,
): Promise<CustomerProjectionOperationalSnapshot> {
  const rows = await prisma.$queryRaw<
    Array<{
      readonly oldestPendingAgeSeconds: number | null;
      readonly blockedStreamCount: bigint;
      readonly retryExhaustedCount: bigint;
      readonly backfillStatus: 'NOT_STARTED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      readonly backfillRemainingAppointmentCount: bigint;
    }>
  >(Prisma.sql`
    WITH checkpoint AS (
      SELECT "cursor_created_at", "cursor_id", "status"::text AS "status"
      FROM "crm_backfill_checkpoints"
      WHERE "projector" = ${CUSTOMER_PROJECTOR}
    )
    SELECT
      (
        SELECT EXTRACT(EPOCH FROM (
          transaction_timestamp() - MIN(delivery."created_at")
        ))::double precision
        FROM "crm_projection_deliveries" AS delivery
        WHERE delivery."projector" = ${CUSTOMER_PROJECTOR}
          AND delivery."status" = 'PENDING'::"CrmProjectionDeliveryStatus"
          AND delivery."attempt_count" < ${CUSTOMER_PROJECTION_MAX_ATTEMPTS}
      ) AS "oldestPendingAgeSeconds",
      (
        SELECT COUNT(*)
        FROM "crm_projection_streams" AS stream
        WHERE stream."projector" = ${CUSTOMER_PROJECTOR}
          AND stream."status" = 'BLOCKED'::"CrmProjectionStreamStatus"
      ) AS "blockedStreamCount",
      (
        SELECT COUNT(*)
        FROM "crm_projection_deliveries" AS delivery
        WHERE delivery."projector" = ${CUSTOMER_PROJECTOR}
          AND delivery."attempt_count" >= ${CUSTOMER_PROJECTION_MAX_ATTEMPTS}
          AND delivery."status" IN (
            'PENDING'::"CrmProjectionDeliveryStatus",
            'PROCESSING'::"CrmProjectionDeliveryStatus"
          )
      ) AS "retryExhaustedCount",
      COALESCE((SELECT checkpoint."status" FROM checkpoint), 'NOT_STARTED')
        AS "backfillStatus",
      (
        SELECT COUNT(*)
        FROM "appointments" AS appointment
        WHERE NOT EXISTS (SELECT 1 FROM checkpoint)
           OR (
             SELECT checkpoint."status" <> 'COMPLETED'
                AND (
                  checkpoint."cursor_created_at" IS NULL
                  OR (appointment."created_at", appointment."id")
                     > (checkpoint."cursor_created_at", checkpoint."cursor_id")
                )
             FROM checkpoint
           )
      ) AS "backfillRemainingAppointmentCount"
  `);
  const row = rows[0];
  if (row === undefined) throw new Error('Database did not return CRM projection snapshot');
  return {
    oldestPendingAgeSeconds:
      row.oldestPendingAgeSeconds === null
        ? null
        : Math.max(0, Math.floor(row.oldestPendingAgeSeconds)),
    blockedStreamCount: Number(row.blockedStreamCount),
    retryExhaustedCount: Number(row.retryExhaustedCount),
    backfillStatus: row.backfillStatus,
    backfillRemainingAppointmentCount: Number(row.backfillRemainingAppointmentCount),
  };
}

async function findNextBackfillCandidate(
  tx: Prisma.TransactionClient,
  checkpoint: { readonly cursorCreatedAt: Date | null; readonly cursorId: string | null },
): Promise<BackfillCandidate | null> {
  const rows = await tx.$queryRaw<BackfillCandidate[]>(Prisma.sql`
    SELECT
      appointment."id" AS "appointmentId",
      appointment."tenant_id" AS "tenantId",
      appointment."consumer_user_id" AS "consumerUserId",
      appointment."created_at" AS "createdAt"
    FROM "appointments" AS appointment
    WHERE (
      ${checkpoint.cursorCreatedAt}::timestamptz IS NULL
      OR (appointment."created_at", appointment."id")
         > (${checkpoint.cursorCreatedAt}::timestamptz, ${checkpoint.cursorId}::uuid)
    )
    ORDER BY appointment."created_at", appointment."id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function readAppointments(
  tx: Prisma.TransactionClient,
  stream: { readonly tenantId: string; readonly consumerUserId: string },
) {
  return tx.appointment.findMany({
    where: { tenantId: stream.tenantId, consumerUserId: stream.consumerUserId },
    select: {
      id: true,
      tenantId: true,
      consumerUserId: true,
      status: true,
      startAt: true,
      confirmedAt: true,
      rescheduledFromId: true,
      rescheduleRootId: true,
    },
  });
}

async function ensureActiveStream(
  tx: Prisma.TransactionClient,
  stream: { readonly tenantId: string; readonly consumerUserId: string },
  dbNow: Date,
): Promise<void> {
  await tx.crmProjectionStream.upsert({
    where: {
      projector_tenantId_consumerUserId: {
        projector: CUSTOMER_PROJECTOR,
        tenantId: stream.tenantId,
        consumerUserId: stream.consumerUserId,
      },
    },
    create: {
      projector: CUSTOMER_PROJECTOR,
      tenantId: stream.tenantId,
      consumerUserId: stream.consumerUserId,
      updatedAt: dbNow,
    },
    update: {},
  });
}

async function lockProjectionStream(
  tx: Prisma.TransactionClient,
  stream: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<{ readonly status: string; readonly blockedDeliveryId: string | null }> {
  const rows = await tx.$queryRaw<
    Array<{ readonly status: string; readonly blockedDeliveryId: string | null }>
  >(Prisma.sql`
    SELECT
      "status"::text AS "status",
      "blocked_delivery_id" AS "blockedDeliveryId"
    FROM "crm_projection_streams"
    WHERE "projector" = ${CUSTOMER_PROJECTOR}
      AND "tenant_id" = ${stream.tenantId}::uuid
      AND "consumer_user_id" = ${stream.consumerUserId}::uuid
    FOR UPDATE
  `);
  return rows[0] ?? { status: 'MISSING', blockedDeliveryId: null };
}

async function lockBackfillCheckpoint(tx: Prisma.TransactionClient): Promise<{
  readonly cursorCreatedAt: Date | null;
  readonly cursorId: string | null;
  readonly status: string;
  readonly safeCode: string | null;
}> {
  const rows = await tx.$queryRaw<
    Array<{
      readonly cursorCreatedAt: Date | null;
      readonly cursorId: string | null;
      readonly status: string;
      readonly safeCode: string | null;
    }>
  >(Prisma.sql`
    SELECT
      "cursor_created_at" AS "cursorCreatedAt",
      "cursor_id" AS "cursorId",
      "status"::text AS "status",
      "safe_code" AS "safeCode"
    FROM "crm_backfill_checkpoints"
    WHERE "projector" = ${CUSTOMER_PROJECTOR}
    FOR UPDATE
  `);
  const row = rows[0];
  if (row === undefined) throw new Error('CRM backfill checkpoint was not created');
  return row;
}

async function failBackfill(
  tx: Prisma.TransactionClient,
  code: string,
  dbNow: Date,
): Promise<void> {
  await tx.crmBackfillCheckpoint.update({
    where: { projector: CUSTOMER_PROJECTOR },
    data: { status: 'FAILED', safeCode: code, updatedAt: dbNow },
  });
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ readonly now: Date }>>(
    Prisma.sql`SELECT transaction_timestamp() AS "now"`,
  );
  const value = rows[0]?.now;
  if (value === undefined) throw new Error('Database did not return transaction timestamp');
  return value;
}
