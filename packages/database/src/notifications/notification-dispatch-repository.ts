import { Prisma, type PrismaClient } from '@prisma/client';

const leaseMilliseconds = 2 * 60 * 1_000;

export interface NotificationDispatchClaim {
  readonly jobId: string;
  readonly leaseUntil: Date;
}

export interface NotificationOperationalSnapshot {
  readonly oldestPendingOutboxAgeSeconds: number | null;
  readonly oldestDueJobDelaySeconds: number | null;
  readonly deadLetterJobCount: number;
  readonly retryableAttemptCount24h: number;
  readonly acceptedAttemptCount24h: number;
  readonly lineBudgetReservedCount: number;
}

export type NotificationExpirySweepOutcome =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'terminal';
      readonly jobId: string;
      readonly status: 'SKIPPED' | 'DEAD_LETTER';
      readonly code: string;
    };

export interface NotificationDispatchRepository {
  claimNext(): Promise<NotificationDispatchClaim | null>;
  markEnqueued(claim: NotificationDispatchClaim): Promise<boolean>;
  sweepNextExpired(): Promise<NotificationExpirySweepOutcome>;
  readOperationalSnapshot(): Promise<NotificationOperationalSnapshot>;
}

export class PrismaNotificationDispatchRepository implements NotificationDispatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  claimNext(): Promise<NotificationDispatchClaim | null> {
    return this.prisma.$transaction(async (tx) => {
      const dbNow = await transactionNow(tx);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "notification_jobs"
        WHERE (
          ("status" = 'PENDING'::"NotificationJobStatus" AND "due_at" <= ${dbNow})
          OR (
            "status" = 'DISPATCHING'::"NotificationJobStatus"
            AND "dispatch_lease_until" <= ${dbNow}
          )
        )
          AND ${dbNow} < (
            "due_at" + CASE
              WHEN "template_key" IN (
                'appointment.confirmed.v1',
                'appointment.cancelled.v1',
                'appointment.rescheduled.v1'
              ) THEN INTERVAL '24 hours'
              ELSE INTERVAL '1 hour'
            END
          )
        ORDER BY "due_at", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const jobId = rows[0]?.id;
      if (jobId === undefined) return null;
      const leaseUntil = new Date(dbNow.getTime() + leaseMilliseconds);
      const claimed = await tx.notificationJob.updateMany({
        where: {
          id: jobId,
          OR: [
            { status: 'PENDING', dueAt: { lte: dbNow } },
            { status: 'DISPATCHING', dispatchLeaseUntil: { lte: dbNow } },
          ],
        },
        data: {
          status: 'DISPATCHING',
          dispatchLeaseUntil: leaseUntil,
          dispatchAttemptCount: { increment: 1 },
          terminalCode: null,
          updatedAt: dbNow,
        },
      });
      if (claimed.count !== 1) throw new Error('notification_dispatch_claim_lost');
      return { jobId, leaseUntil };
    });
  }

  async markEnqueued(claim: NotificationDispatchClaim): Promise<boolean> {
    const dbNow = await databaseNow(this.prisma);
    const result = await this.prisma.notificationJob.updateMany({
      where: {
        id: claim.jobId,
        status: 'DISPATCHING',
        dispatchLeaseUntil: claim.leaseUntil,
      },
      data: {
        status: 'ENQUEUED',
        enqueuedAt: dbNow,
        dispatchLeaseUntil: null,
        updatedAt: dbNow,
      },
    });
    return result.count === 1;
  }

  sweepNextExpired(): Promise<NotificationExpirySweepOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const dbNow = await transactionNow(tx);
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: 'PENDING' | 'DISPATCHING' | 'ENQUEUED' | 'DELIVERING' }>
      >(Prisma.sql`
        SELECT "id", "status"
        FROM "notification_jobs"
        WHERE ${dbNow} >= (
          "due_at" + CASE
            WHEN "template_key" IN (
              'appointment.confirmed.v1',
              'appointment.cancelled.v1',
              'appointment.rescheduled.v1'
            ) THEN INTERVAL '24 hours'
            ELSE INTERVAL '1 hour'
          END
        )
          AND (
            "status" IN (
              'PENDING'::"NotificationJobStatus",
              'ENQUEUED'::"NotificationJobStatus"
            )
            OR (
              "status" = 'DISPATCHING'::"NotificationJobStatus"
              AND "dispatch_lease_until" <= ${dbNow}
            )
            OR (
              "status" = 'DELIVERING'::"NotificationJobStatus"
              AND "delivery_lease_until" <= ${dbNow}
            )
          )
        ORDER BY "due_at", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const job = rows[0];
      if (job === undefined) return { kind: 'empty' };
      if (job.status !== 'DELIVERING') {
        await tx.notificationJob.update({
          where: { id: job.id },
          data: {
            status: 'SKIPPED',
            terminalCode: 'notification_expired',
            dispatchLeaseUntil: null,
            deliveryLeaseUntil: null,
            updatedAt: dbNow,
          },
        });
        return {
          kind: 'terminal',
          jobId: job.id,
          status: 'SKIPPED',
          code: 'notification_expired',
        };
      }

      const started = await tx.notificationDelivery.findFirst({
        where: { notificationJobId: job.id, outcome: 'STARTED' },
        orderBy: { attemptNumber: 'desc' },
        select: { id: true },
      });
      const code = started === null ? 'delivery_state_corrupt' : 'delivery_outcome_ambiguous';
      if (started !== null) {
        await tx.notificationDelivery.update({
          where: { id: started.id },
          data: { outcome: 'AMBIGUOUS', code, finishedAt: dbNow },
        });
      }
      await tx.notificationJob.update({
        where: { id: job.id },
        data: {
          status: 'DEAD_LETTER',
          terminalCode: code,
          deliveryLeaseUntil: null,
          updatedAt: dbNow,
        },
      });
      return { kind: 'terminal', jobId: job.id, status: 'DEAD_LETTER', code };
    });
  }

  async readOperationalSnapshot(): Promise<NotificationOperationalSnapshot> {
    const [snapshot] = await this.prisma.$queryRaw<NotificationOperationalSnapshot[]>(Prisma.sql`
      WITH database_clock AS (
        SELECT transaction_timestamp() AS "now"
      )
      SELECT
        (
          SELECT GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (database_clock."now" - MIN("available_at"))))
          )::integer
          FROM "outbox_events"
          WHERE "aggregate_type" = 'appointment'
            AND "status" = 'PENDING'::"OutboxEventStatus"
            AND "available_at" <= database_clock."now"
        ) AS "oldestPendingOutboxAgeSeconds",
        (
          SELECT GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (database_clock."now" - MIN("due_at"))))
          )::integer
          FROM "notification_jobs"
          WHERE "status" IN (
            'PENDING'::"NotificationJobStatus",
            'DISPATCHING'::"NotificationJobStatus",
            'ENQUEUED'::"NotificationJobStatus",
            'DELIVERING'::"NotificationJobStatus"
          )
            AND "due_at" <= database_clock."now"
        ) AS "oldestDueJobDelaySeconds",
        (
          SELECT COUNT(*)::integer
          FROM "notification_jobs"
          WHERE "status" = 'DEAD_LETTER'::"NotificationJobStatus"
        ) AS "deadLetterJobCount",
        (
          SELECT COUNT(*)::integer
          FROM "notification_deliveries"
          WHERE "outcome" = 'RETRYABLE'::"NotificationDeliveryOutcome"
            AND "finished_at" >= database_clock."now" - INTERVAL '24 hours'
        ) AS "retryableAttemptCount24h",
        (
          SELECT COUNT(*)::integer
          FROM "notification_deliveries"
          WHERE "outcome" IN (
            'ACCEPTED'::"NotificationDeliveryOutcome",
            'REPLAYED'::"NotificationDeliveryOutcome"
          )
            AND "finished_at" >= database_clock."now" - INTERVAL '24 hours'
        ) AS "acceptedAttemptCount24h",
        COALESCE(
          (
            SELECT "reserved_count"
            FROM "notification_provider_monthly_usage"
            WHERE "provider" = 'LINE_MESSAGING'::"NotificationProvider"
              AND "usage_month" = TO_CHAR(
                database_clock."now" AT TIME ZONE 'Asia/Taipei',
                'YYYY-MM'
              )
          ),
          0
        )::integer AS "lineBudgetReservedCount"
      FROM database_clock
    `);
    if (snapshot === undefined) throw new Error('notification_operational_snapshot_unavailable');
    return snapshot;
  }
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ dbNow: Date }>>`
    SELECT transaction_timestamp() AS "dbNow"
  `;
  if (row === undefined) throw new Error('database_clock_unavailable');
  return row.dbNow;
}

async function databaseNow(prisma: PrismaClient): Promise<Date> {
  const [row] = await prisma.$queryRaw<Array<{ dbNow: Date }>>`
    SELECT clock_timestamp() AS "dbNow"
  `;
  if (row === undefined) throw new Error('database_clock_unavailable');
  return row.dbNow;
}
