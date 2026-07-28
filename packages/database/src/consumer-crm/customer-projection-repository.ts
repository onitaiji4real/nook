import { randomUUID } from 'node:crypto';

import { CustomerProjectionCorruption, deriveCustomerProjection } from '@nook/domain';
import { Prisma, type PrismaClient } from '@prisma/client';

const PROJECTOR = 'consumer_crm_v1';
const LEASE_MILLISECONDS = 60_000;
const MAX_ATTEMPTS = 10;
const supportedEventTypes = [
  'appointment.confirmed.v1',
  'appointment.cancelled.v1',
  'appointment.rescheduled.v1',
  'appointment.checked_in.v1',
  'appointment.completed.v1',
  'appointment.no_show.v1',
] as const;

interface SeedCandidate {
  readonly outboxEventId: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly appointmentId: string;
}

interface ProjectionClaim {
  readonly deliveryId: string;
  readonly claimToken: string;
  readonly outboxEventId: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly appointmentId: string;
}

export type CustomerProjectionOutcome =
  | { readonly kind: 'empty'; readonly seededCount: number }
  | {
      readonly kind: 'projected';
      readonly deliveryId: string;
      readonly customerId: string;
      readonly seededCount: number;
    }
  | {
      readonly kind: 'terminal';
      readonly deliveryId: string;
      readonly code: string;
      readonly seededCount: number;
    };

export interface CustomerProjectionRepository {
  projectNext(): Promise<CustomerProjectionOutcome>;
  seedDeliveries(limit?: number): Promise<number>;
}

export class PrismaCustomerProjectionRepository implements CustomerProjectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async projectNext(): Promise<CustomerProjectionOutcome> {
    const seededCount = await this.seedDeliveries();
    const claim = await claimNext(this.prisma);
    if (claim === null) return { kind: 'empty', seededCount };

    try {
      const outcome = await projectClaim(this.prisma, claim);
      return { ...outcome, seededCount };
    } catch (error) {
      await releaseForRetry(this.prisma, claim);
      throw error;
    }
  }

  async seedDeliveries(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError('CRM projection seed limit must be between 1 and 1000');
    }

    const candidates = await this.prisma.$queryRaw<SeedCandidate[]>(Prisma.sql`
      SELECT
        event."id" AS "outboxEventId",
        event."tenant_id" AS "tenantId",
        appointment."consumer_user_id" AS "consumerUserId",
        appointment."id" AS "appointmentId"
      FROM "outbox_events" AS event
      INNER JOIN "appointments" AS appointment
        ON appointment."tenant_id" = event."tenant_id"
       AND appointment."id" = event."aggregate_id"
      WHERE event."aggregate_type" = 'appointment'
        AND event."event_type" IN (${Prisma.join(supportedEventTypes)})
        AND NOT EXISTS (
          SELECT 1
          FROM "crm_projection_deliveries" AS delivery
          WHERE delivery."projector" = ${PROJECTOR}
            AND delivery."outbox_event_id" = event."id"
        )
      ORDER BY event."created_at", event."id"
      LIMIT ${limit}
    `);
    if (candidates.length === 0) return 0;

    const result = await this.prisma.crmProjectionDelivery.createMany({
      data: candidates.map((candidate) => ({
        id: randomUUID(),
        projector: PROJECTOR,
        outboxEventId: candidate.outboxEventId,
        tenantId: candidate.tenantId,
        consumerUserId: candidate.consumerUserId,
        appointmentId: candidate.appointmentId,
        nextAttemptAt: new Date(0),
        updatedAt: new Date(),
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}

async function claimNext(prisma: PrismaClient): Promise<ProjectionClaim | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<Omit<ProjectionClaim, 'claimToken'>>>(Prisma.sql`
      SELECT
        delivery."id" AS "deliveryId",
        delivery."outbox_event_id" AS "outboxEventId",
        delivery."tenant_id" AS "tenantId",
        delivery."consumer_user_id" AS "consumerUserId",
        delivery."appointment_id" AS "appointmentId"
      FROM "crm_projection_deliveries" AS delivery
      LEFT JOIN "crm_projection_streams" AS stream
        ON stream."projector" = delivery."projector"
       AND stream."tenant_id" = delivery."tenant_id"
       AND stream."consumer_user_id" = delivery."consumer_user_id"
      WHERE delivery."projector" = ${PROJECTOR}
        AND delivery."attempt_count" < ${MAX_ATTEMPTS}
        AND (
          (
            delivery."status" = 'PENDING'::"CrmProjectionDeliveryStatus"
            AND delivery."next_attempt_at" <= transaction_timestamp()
          )
          OR (
            delivery."status" = 'PROCESSING'::"CrmProjectionDeliveryStatus"
            AND delivery."lease_expires_at" <= transaction_timestamp()
          )
        )
        AND COALESCE(stream."status", 'ACTIVE'::"CrmProjectionStreamStatus")
            = 'ACTIVE'::"CrmProjectionStreamStatus"
      ORDER BY delivery."next_attempt_at", delivery."id"
      FOR UPDATE OF delivery SKIP LOCKED
      LIMIT 1
    `);
    const row = rows[0];
    if (row === undefined) return null;

    const claimToken = randomUUID();
    const dbNow = await transactionNow(tx);
    const leaseExpiresAt = new Date(dbNow.getTime() + LEASE_MILLISECONDS);
    await tx.crmProjectionDelivery.update({
      where: { id: row.deliveryId },
      data: {
        status: 'PROCESSING',
        claimToken,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        safeCode: null,
        updatedAt: dbNow,
      },
    });
    return { ...row, claimToken };
  });
}

async function projectClaim(
  prisma: PrismaClient,
  claim: ProjectionClaim,
): Promise<
  | { readonly kind: 'projected'; readonly deliveryId: string; readonly customerId: string }
  | { readonly kind: 'terminal'; readonly deliveryId: string; readonly code: string }
> {
  return prisma.$transaction(async (tx) => {
    const delivery = await lockClaim(tx, claim);
    if (delivery === null) throw new Error('CRM projection claim was lost');

    await tx.crmProjectionStream.upsert({
      where: {
        projector_tenantId_consumerUserId: {
          projector: PROJECTOR,
          tenantId: claim.tenantId,
          consumerUserId: claim.consumerUserId,
        },
      },
      create: {
        projector: PROJECTOR,
        tenantId: claim.tenantId,
        consumerUserId: claim.consumerUserId,
        updatedAt: new Date(),
      },
      update: {},
    });
    const stream = await lockStream(tx, claim);
    if (stream === null || stream.status === 'BLOCKED') {
      throw new Error('CRM projection stream is blocked');
    }

    const appointments = await tx.appointment.findMany({
      where: { tenantId: claim.tenantId, consumerUserId: claim.consumerUserId },
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

    try {
      const aggregate = deriveCustomerProjection(appointments, claim.appointmentId);
      const dbNow = await transactionNow(tx);
      const customer = await tx.customer.upsert({
        where: {
          tenantId_consumerUserId: {
            tenantId: claim.tenantId,
            consumerUserId: claim.consumerUserId,
          },
        },
        create: {
          tenantId: claim.tenantId,
          consumerUserId: claim.consumerUserId,
          relationshipStartedAt: aggregate.relationshipStartedAt,
          firstVisitAt: aggregate.firstVisitAt,
          lastVisitAt: aggregate.lastVisitAt,
          completedVisitCount: aggregate.completedVisitCount,
          noShowCount: aggregate.noShowCount,
          projectionVersion: 1,
          projectedThroughEventId: claim.outboxEventId,
          projectedAt: dbNow,
          updatedAt: dbNow,
        },
        update: {
          firstVisitAt: aggregate.firstVisitAt,
          lastVisitAt: aggregate.lastVisitAt,
          completedVisitCount: aggregate.completedVisitCount,
          noShowCount: aggregate.noShowCount,
          projectionVersion: 1,
          projectedThroughEventId: claim.outboxEventId,
          projectedAt: dbNow,
          updatedAt: dbNow,
        },
      });
      await completeDelivery(tx, claim, customer.id, dbNow);
      return { kind: 'projected', deliveryId: claim.deliveryId, customerId: customer.id };
    } catch (error) {
      if (!(error instanceof CustomerProjectionCorruption)) throw error;
      const dbNow = await transactionNow(tx);
      await tx.crmProjectionDelivery.update({
        where: { id: claim.deliveryId },
        data: {
          status: 'TERMINAL',
          claimToken: null,
          leaseExpiresAt: null,
          outcome: 'INVARIANT_CORRUPTION',
          projectedAt: dbNow,
          safeCode: error.code,
          updatedAt: dbNow,
        },
      });
      await tx.crmProjectionStream.update({
        where: {
          projector_tenantId_consumerUserId: {
            projector: PROJECTOR,
            tenantId: claim.tenantId,
            consumerUserId: claim.consumerUserId,
          },
        },
        data: {
          status: 'BLOCKED',
          blockedDeliveryId: claim.deliveryId,
          safeCode: error.code,
          updatedAt: dbNow,
        },
      });
      return { kind: 'terminal', deliveryId: claim.deliveryId, code: error.code };
    }
  });
}

async function lockClaim(
  tx: Prisma.TransactionClient,
  claim: ProjectionClaim,
): Promise<{ readonly id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "crm_projection_deliveries"
    WHERE "id" = ${claim.deliveryId}::uuid
      AND "status" = 'PROCESSING'::"CrmProjectionDeliveryStatus"
      AND "claim_token" = ${claim.claimToken}::uuid
      AND "lease_expires_at" > transaction_timestamp()
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockStream(
  tx: Prisma.TransactionClient,
  claim: ProjectionClaim,
): Promise<{ readonly status: string } | null> {
  const rows = await tx.$queryRaw<Array<{ readonly status: string }>>(Prisma.sql`
    SELECT "status"::text AS "status"
    FROM "crm_projection_streams"
    WHERE "projector" = ${PROJECTOR}
      AND "tenant_id" = ${claim.tenantId}::uuid
      AND "consumer_user_id" = ${claim.consumerUserId}::uuid
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function completeDelivery(
  tx: Prisma.TransactionClient,
  claim: ProjectionClaim,
  customerId: string,
  dbNow: Date,
): Promise<void> {
  const result = await tx.crmProjectionDelivery.updateMany({
    where: {
      id: claim.deliveryId,
      status: 'PROCESSING',
      claimToken: claim.claimToken,
    },
    data: {
      customerId,
      status: 'PROJECTED',
      claimToken: null,
      leaseExpiresAt: null,
      outcome: 'PROJECTED',
      projectedAt: dbNow,
      safeCode: null,
      updatedAt: dbNow,
    },
  });
  if (result.count !== 1) throw new Error('CRM projection claim was lost');
}

async function releaseForRetry(prisma: PrismaClient, claim: ProjectionClaim): Promise<void> {
  const delivery = await prisma.crmProjectionDelivery.findFirst({
    where: { id: claim.deliveryId, status: 'PROCESSING', claimToken: claim.claimToken },
    select: { attemptCount: true },
  });
  if (delivery === null) return;
  const delaySeconds = Math.min(3_600, 2 ** Math.max(0, delivery.attemptCount - 1) * 5);
  await prisma.crmProjectionDelivery.updateMany({
    where: { id: claim.deliveryId, status: 'PROCESSING', claimToken: claim.claimToken },
    data: {
      status: 'PENDING',
      claimToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + delaySeconds * 1_000),
      safeCode: 'retryable_failure',
      updatedAt: new Date(),
    },
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
