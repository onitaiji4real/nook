import { Prisma, type PrismaClient } from '@prisma/client';

const deliveryLeaseMilliseconds = 2 * 60 * 1_000;
const terminalStatuses = ['ACCEPTED', 'CANCELLED', 'SKIPPED', 'DEAD_LETTER'] as const;

export interface NotificationTemplateData {
  readonly templateKey:
    | 'appointment.confirmed.v1'
    | 'appointment.cancelled.v1'
    | 'appointment.rescheduled.v1'
    | 'appointment.reminder.24h.v1'
    | 'appointment.reminder.2h.v1';
  readonly tenantName: string;
  readonly serviceName: string;
  readonly startAt: Date;
  readonly timezone: string;
  readonly locationName: string;
}

export type NotificationDeliveryClaimOutcome =
  | { readonly kind: 'terminal' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'skipped'; readonly code: string }
  | { readonly kind: 'dead_letter'; readonly code: string }
  | {
      readonly kind: 'claimed';
      readonly jobId: string;
      readonly attemptNumber: number;
      readonly leaseUntil: Date;
      readonly recipient: string;
      readonly retryKey: string;
      readonly text: string;
    };

export type NotificationProviderResult =
  | { readonly kind: 'accepted'; readonly httpStatus: 200; readonly requestId?: string }
  | { readonly kind: 'replayed'; readonly httpStatus: 409; readonly requestId?: string }
  | {
      readonly kind: 'retryable' | 'terminal';
      readonly httpStatus?: number;
      readonly requestId?: string;
      readonly code: string;
    };

export type NotificationDeliveryCompletion =
  | { readonly kind: 'terminal' }
  | { readonly kind: 'accepted'; readonly replayed: boolean }
  | { readonly kind: 'retryable' }
  | { readonly kind: 'dead_letter'; readonly code: string };

export interface NotificationDeliveryRepository {
  claim(input: {
    readonly jobId: string;
    readonly monthlyCap: number;
    readonly render: (data: NotificationTemplateData) => string | null;
  }): Promise<NotificationDeliveryClaimOutcome>;
  complete(input: {
    readonly claim: Extract<NotificationDeliveryClaimOutcome, { readonly kind: 'claimed' }>;
    readonly result: NotificationProviderResult;
  }): Promise<NotificationDeliveryCompletion>;
}

export class PrismaNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  claim(
    input: Parameters<NotificationDeliveryRepository['claim']>[0],
  ): Promise<NotificationDeliveryClaimOutcome> {
    if (!Number.isInteger(input.monthlyCap) || input.monthlyCap < 1) {
      throw new Error('notification_monthly_cap_invalid');
    }
    return this.prisma.$transaction(async (tx) => {
      const dbNow = await transactionNow(tx);
      const job = await lockJob(tx, input.jobId);
      if (job === null || terminalStatuses.includes(job.status as (typeof terminalStatuses)[number])) {
        return { kind: 'terminal' };
      }
      if (job.status === 'DELIVERING' && job.deliveryLeaseUntil !== null) {
        if (job.deliveryLeaseUntil.getTime() > dbNow.getTime()) return { kind: 'busy' };
        const previous = await tx.notificationDelivery.findFirst({
          where: { notificationJobId: job.id, outcome: 'STARTED' },
          orderBy: { attemptNumber: 'desc' },
        });
        if (previous === null) {
          await deadLetter(tx, job.id, 'delivery_state_corrupt', dbNow);
          return { kind: 'dead_letter', code: 'delivery_state_corrupt' };
        }
        await tx.notificationDelivery.update({
          where: { id: previous.id },
          data: {
            outcome: 'AMBIGUOUS',
            code: 'delivery_outcome_ambiguous',
            finishedAt: dbNow,
          },
        });
        if (previous.attemptNumber >= 10) {
          await deadLetter(tx, job.id, 'attempt_limit_ambiguous', dbNow);
          return { kind: 'dead_letter', code: 'attempt_limit_ambiguous' };
        }
      } else if (job.status !== 'ENQUEUED') {
        return { kind: 'busy' };
      }

      if (isExpired(job.templateKey, job.dueAt, dbNow)) {
        await skip(tx, job.id, 'notification_expired', dbNow);
        return { kind: 'skipped', code: 'notification_expired' };
      }

      const templateData = await lockAndResolveTemplateData(tx, job, dbNow);
      if (templateData === null) {
        await skip(tx, job.id, 'appointment_not_eligible', dbNow);
        return { kind: 'skipped', code: 'appointment_not_eligible' };
      }
      const text = input.render(templateData);
      if (text === null) {
        await skip(tx, job.id, 'template_data_invalid', dbNow);
        return { kind: 'skipped', code: 'template_data_invalid' };
      }

      const recipient = await lockRecipient(tx, job.consumerUserId);
      if (recipient === null) {
        await skip(tx, job.id, 'line_recipient_unavailable', dbNow);
        return { kind: 'skipped', code: 'line_recipient_unavailable' };
      }

      const budgetMonth = taipeiUsageMonth(dbNow);
      if (job.budgetMonth === null) {
        const reserved = await reserveBudget(tx, budgetMonth, input.monthlyCap, dbNow);
        if (!reserved) {
          await skip(tx, job.id, 'line_monthly_cap_exhausted', dbNow);
          return { kind: 'skipped', code: 'line_monthly_cap_exhausted' };
        }
      }

      const attemptNumber = job.deliveryAttemptCount + 1;
      if (attemptNumber > 10) {
        await deadLetter(tx, job.id, 'delivery_attempt_limit', dbNow);
        return { kind: 'dead_letter', code: 'delivery_attempt_limit' };
      }
      const leaseUntil = new Date(dbNow.getTime() + deliveryLeaseMilliseconds);
      await tx.notificationJob.update({
        where: { id: job.id },
        data: {
          status: 'DELIVERING',
          deliveryLeaseUntil: leaseUntil,
          deliveryAttemptCount: attemptNumber,
          budgetMonth: job.budgetMonth ?? budgetMonth,
          updatedAt: dbNow,
        },
      });
      await tx.notificationDelivery.create({
        data: {
          notificationJobId: job.id,
          attemptNumber,
          outcome: 'STARTED',
          startedAt: dbNow,
        },
      });
      return {
        kind: 'claimed',
        jobId: job.id,
        attemptNumber,
        leaseUntil,
        recipient,
        retryKey: job.providerRetryKey,
        text,
      };
    });
  }

  complete(
    input: Parameters<NotificationDeliveryRepository['complete']>[0],
  ): Promise<NotificationDeliveryCompletion> {
    return this.prisma.$transaction(async (tx) => {
      const dbNow = await transactionNow(tx);
      const job = await lockJob(tx, input.claim.jobId);
      if (job === null) return { kind: 'terminal' };
      const attempt = await tx.notificationDelivery.findUnique({
        where: {
          notificationJobId_attemptNumber: {
            notificationJobId: input.claim.jobId,
            attemptNumber: input.claim.attemptNumber,
          },
        },
      });
      if (attempt === null || attempt.outcome !== 'STARTED') return { kind: 'terminal' };

      const evidence = completionEvidence(input.result, dbNow);
      await tx.notificationDelivery.update({
        where: { id: attempt.id },
        data: evidence,
      });
      const ownsClaim =
        job.status === 'DELIVERING' &&
        job.deliveryLeaseUntil?.getTime() === input.claim.leaseUntil.getTime();
      if (!ownsClaim) return { kind: 'terminal' };

      if (input.result.kind === 'accepted' || input.result.kind === 'replayed') {
        await tx.notificationJob.update({
          where: { id: job.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: dbNow,
            deliveryLeaseUntil: null,
            updatedAt: dbNow,
          },
        });
        return { kind: 'accepted', replayed: input.result.kind === 'replayed' };
      }
      if (input.result.kind === 'retryable' && input.claim.attemptNumber < 10) {
        await tx.notificationJob.update({
          where: { id: job.id },
          data: { status: 'ENQUEUED', deliveryLeaseUntil: null, updatedAt: dbNow },
        });
        return { kind: 'retryable' };
      }
      const code =
        input.result.kind === 'retryable' ? 'delivery_attempt_limit' : input.result.code;
      await deadLetter(tx, job.id, code, dbNow);
      return { kind: 'dead_letter', code };
    });
  }
}

interface LockedJob {
  readonly id: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly appointmentId: string;
  readonly templateKey: NotificationTemplateData['templateKey'];
  readonly dueAt: Date;
  readonly status: string;
  readonly providerRetryKey: string;
  readonly deliveryAttemptCount: number;
  readonly deliveryLeaseUntil: Date | null;
  readonly budgetMonth: string | null;
}

async function lockJob(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<LockedJob | null> {
  const rows = await tx.$queryRaw<LockedJob[]>(Prisma.sql`
    SELECT
      "id",
      "tenant_id" AS "tenantId",
      "consumer_user_id" AS "consumerUserId",
      "appointment_id" AS "appointmentId",
      "template_key" AS "templateKey",
      "due_at" AS "dueAt",
      "status",
      "provider_retry_key" AS "providerRetryKey",
      "delivery_attempt_count" AS "deliveryAttemptCount",
      "delivery_lease_until" AS "deliveryLeaseUntil",
      "budget_month" AS "budgetMonth"
    FROM "notification_jobs"
    WHERE "id" = ${jobId}::uuid
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function lockAndResolveTemplateData(
  tx: Prisma.TransactionClient,
  job: LockedJob,
  dbNow: Date,
): Promise<NotificationTemplateData | null> {
  const initial = await tx.appointment.findFirst({
    where: { id: job.appointmentId, tenantId: job.tenantId, consumerUserId: job.consumerUserId },
    select: { id: true, rescheduledFromId: true },
  });
  if (initial === null) return null;
  const appointmentIds = [initial.id, initial.rescheduledFromId]
    .filter((value): value is string => value !== null)
    .sort();
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "appointments"
    WHERE "tenant_id" = ${job.tenantId}::uuid
      AND "consumer_user_id" = ${job.consumerUserId}::uuid
      AND "id" IN (${Prisma.join(appointmentIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE
  `);
  if (locked.length !== appointmentIds.length) return null;

  const appointment = await tx.appointment.findFirst({
    where: { id: job.appointmentId, tenantId: job.tenantId, consumerUserId: job.consumerUserId },
    select: {
      id: true,
      status: true,
      startAt: true,
      locationTimezoneSnapshot: true,
      locationNameSnapshot: true,
      rescheduledFromId: true,
      rescheduleRootId: true,
      tenant: { select: { name: true } },
      item: { select: { serviceNameSnapshot: true } },
      rescheduledFrom: {
        select: {
          id: true,
          status: true,
          rescheduleRootId: true,
          tenantId: true,
          consumerUserId: true,
        },
      },
      rescheduledTo: { select: { id: true } },
    },
  });
  if (appointment === null || appointment.item === null) return null;
  if (!isEligible(job.templateKey, appointment, dbNow)) return null;
  return {
    templateKey: job.templateKey,
    tenantName: appointment.tenant.name,
    serviceName: appointment.item.serviceNameSnapshot,
    startAt: appointment.startAt,
    timezone: appointment.locationTimezoneSnapshot,
    locationName: appointment.locationNameSnapshot,
  };
}

function isEligible(
  templateKey: NotificationTemplateData['templateKey'],
  appointment: {
    readonly id: string;
    readonly status: string;
    readonly startAt: Date;
    readonly rescheduledFromId: string | null;
    readonly rescheduleRootId: string | null;
    readonly rescheduledTo: { readonly id: string } | null;
    readonly rescheduledFrom: {
      readonly id: string;
      readonly status: string;
      readonly rescheduleRootId: string | null;
      readonly tenantId: string;
      readonly consumerUserId: string;
    } | null;
  },
  dbNow: Date,
): boolean {
  if (templateKey === 'appointment.cancelled.v1') {
    return appointment.status === 'CANCELLED' && appointment.rescheduledTo === null;
  }
  if (templateKey === 'appointment.rescheduled.v1') {
    const source = appointment.rescheduledFrom;
    return (
      appointment.status === 'CONFIRMED' &&
      appointment.rescheduledTo === null &&
      source !== null &&
      source.status === 'RESCHEDULED' &&
      appointment.rescheduledFromId === source.id &&
      appointment.rescheduleRootId === (source.rescheduleRootId ?? source.id)
    );
  }
  const currentConfirmed = appointment.status === 'CONFIRMED' && appointment.rescheduledTo === null;
  if (!currentConfirmed) return false;
  return !templateKey.startsWith('appointment.reminder.') || dbNow < appointment.startAt;
}

async function lockRecipient(
  tx: Prisma.TransactionClient,
  consumerUserId: string,
): Promise<string | null> {
  const users = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status" FROM "users" WHERE "id" = ${consumerUserId}::uuid FOR UPDATE
  `);
  if (users[0]?.status !== 'ACTIVE') return null;
  const identities = await tx.$queryRaw<Array<{ id: string; providerSubject: string }>>(Prisma.sql`
    SELECT "id", "provider_subject" AS "providerSubject"
    FROM "user_identities"
    WHERE "user_id" = ${consumerUserId}::uuid
      AND "provider" = 'LINE'::"IdentityProvider"
    ORDER BY "id"
    FOR UPDATE
  `);
  if (identities.length !== 1) return null;
  const identity = identities[0];
  if (identity === undefined) return null;
  const recipients = await tx.$queryRaw<
    Array<{ providerSubject: string; userId: string | null; status: string }>
  >(Prisma.sql`
    SELECT
      "provider_subject" AS "providerSubject",
      "user_id" AS "userId",
      "status"
    FROM "line_messaging_recipients"
    WHERE "provider_subject" = ${identity.providerSubject}
    FOR UPDATE
  `);
  const recipient = recipients[0];
  if (
    recipient?.status !== 'FOLLOWING' ||
    recipient.userId !== consumerUserId ||
    recipient.providerSubject !== identity.providerSubject
  ) {
    return null;
  }
  return recipient.providerSubject;
}

async function reserveBudget(
  tx: Prisma.TransactionClient,
  usageMonth: string,
  monthlyCap: number,
  dbNow: Date,
): Promise<boolean> {
  await tx.notificationProviderMonthlyUsage.upsert({
    where: { provider_usageMonth: { provider: 'LINE_MESSAGING', usageMonth } },
    create: { provider: 'LINE_MESSAGING', usageMonth, reservedCount: 0, updatedAt: dbNow },
    update: {},
  });
  const rows = await tx.$queryRaw<Array<{ reservedCount: number }>>(Prisma.sql`
    SELECT "reserved_count" AS "reservedCount"
    FROM "notification_provider_monthly_usage"
    WHERE "provider" = 'LINE_MESSAGING'::"NotificationProvider"
      AND "usage_month" = ${usageMonth}
    FOR UPDATE
  `);
  const usage = rows[0];
  if (usage === undefined) throw new Error('notification_budget_missing');
  if (usage.reservedCount >= monthlyCap) return false;
  await tx.notificationProviderMonthlyUsage.update({
    where: { provider_usageMonth: { provider: 'LINE_MESSAGING', usageMonth } },
    data: { reservedCount: { increment: 1 }, updatedAt: dbNow },
  });
  return true;
}

function completionEvidence(result: NotificationProviderResult, dbNow: Date) {
  const outcome =
    result.kind === 'accepted'
      ? ('ACCEPTED' as const)
      : result.kind === 'replayed'
        ? ('REPLAYED' as const)
        : result.kind === 'retryable'
          ? ('RETRYABLE' as const)
          : ('TERMINAL' as const);
  const code =
    result.kind === 'accepted'
      ? 'line_accepted'
      : result.kind === 'replayed'
        ? 'line_retry_key_replayed'
        : result.code;
  return {
    outcome,
    code,
    finishedAt: dbNow,
    ...('httpStatus' in result && result.httpStatus !== undefined
      ? { providerHttpStatus: result.httpStatus }
      : {}),
    ...(result.requestId === undefined ? {} : { providerRequestId: result.requestId }),
  };
}

async function skip(
  tx: Prisma.TransactionClient,
  jobId: string,
  code: string,
  dbNow: Date,
): Promise<void> {
  await tx.notificationJob.update({
    where: { id: jobId },
    data: {
      status: 'SKIPPED',
      terminalCode: code,
      dispatchLeaseUntil: null,
      deliveryLeaseUntil: null,
      updatedAt: dbNow,
    },
  });
}

async function deadLetter(
  tx: Prisma.TransactionClient,
  jobId: string,
  code: string,
  dbNow: Date,
): Promise<void> {
  await tx.notificationJob.update({
    where: { id: jobId },
    data: {
      status: 'DEAD_LETTER',
      terminalCode: code,
      dispatchLeaseUntil: null,
      deliveryLeaseUntil: null,
      updatedAt: dbNow,
    },
  });
}

function isExpired(templateKey: string, dueAt: Date, dbNow: Date): boolean {
  const maxAge = templateKey.startsWith('appointment.reminder.')
    ? 60 * 60 * 1_000
    : 24 * 60 * 60 * 1_000;
  return dbNow.getTime() >= dueAt.getTime() + maxAge;
}

function taipeiUsageMonth(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(value);
  const year = parts.find(({ type }) => type === 'year')?.value;
  const month = parts.find(({ type }) => type === 'month')?.value;
  if (year === undefined || month === undefined) throw new Error('notification_budget_month_invalid');
  return `${year}-${month}`;
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ dbNow: Date }>>`
    SELECT transaction_timestamp() AS "dbNow"
  `;
  if (row === undefined) throw new Error('database_clock_unavailable');
  return row.dbNow;
}
