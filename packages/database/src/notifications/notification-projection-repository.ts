import { Prisma, type PrismaClient } from '@prisma/client';

const supportedEvents = [
  'appointment.confirmed.v1',
  'appointment.cancelled.v1',
  'appointment.rescheduled.v1',
  'appointment.checked_in.v1',
  'appointment.completed.v1',
  'appointment.no_show.v1',
] as const;

type SupportedEventType = (typeof supportedEvents)[number];

interface LockedOutboxEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payloadJson: Prisma.JsonValue;
  readonly createdAt: Date;
}

interface AppointmentProjection {
  readonly id: string;
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly status: string;
  readonly startAt: Date;
  readonly rescheduledFromId: string | null;
  readonly rescheduleRootId: string | null;
}

interface JobSpec {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly appointmentId: string;
  readonly sourceOutboxEventId: string;
  readonly templateKey: string;
  readonly dueAt: Date;
  readonly dedupeKey: string;
}

export type NotificationProjectionOutcome =
  | { readonly kind: 'empty' }
  | { readonly kind: 'projected'; readonly eventId: string; readonly jobCount: number }
  | { readonly kind: 'failed'; readonly eventId: string; readonly code: string };

export interface NotificationProjectionRepository {
  projectNext(): Promise<NotificationProjectionOutcome>;
}

export class PrismaNotificationProjectionRepository implements NotificationProjectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  projectNext(): Promise<NotificationProjectionOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const event = await lockNextEvent(tx);
      if (event === null) return { kind: 'empty' };
      const dbNow = await transactionNow(tx);
      await tx.$executeRaw(Prisma.sql`SAVEPOINT notification_projection`);
      try {
        const jobCount = await projectEvent(tx, event, dbNow);
        await tx.$executeRaw(Prisma.sql`RELEASE SAVEPOINT notification_projection`);
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: dbNow,
            attemptCount: { increment: 1 },
            updatedAt: dbNow,
          },
        });
        return { kind: 'projected', eventId: event.id, jobCount };
      } catch (error) {
        if (!(error instanceof NotificationProjectionCorruption)) throw error;
        await tx.$executeRaw(Prisma.sql`ROLLBACK TO SAVEPOINT notification_projection`);
        await tx.$executeRaw(Prisma.sql`RELEASE SAVEPOINT notification_projection`);
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            attemptCount: { increment: 1 },
            updatedAt: dbNow,
          },
        });
        return { kind: 'failed', eventId: event.id, code: error.code };
      }
    });
  }
}

async function lockNextEvent(tx: Prisma.TransactionClient): Promise<LockedOutboxEvent | null> {
  const rows = await tx.$queryRaw<LockedOutboxEvent[]>(Prisma.sql`
    SELECT
      candidate."id",
      candidate."tenant_id" AS "tenantId",
      candidate."aggregate_id" AS "aggregateId",
      candidate."event_type" AS "eventType",
      candidate."payload_json" AS "payloadJson",
      candidate."created_at" AS "createdAt"
    FROM "outbox_events" AS candidate
    WHERE candidate."aggregate_type" = 'appointment'
      AND candidate."status" = 'PENDING'::"OutboxEventStatus"
      AND candidate."available_at" <= transaction_timestamp()
      AND NOT EXISTS (
        SELECT 1
        FROM "outbox_events" AS earlier
        WHERE earlier."aggregate_type" = candidate."aggregate_type"
          AND earlier."aggregate_id" = candidate."aggregate_id"
          AND earlier."status" = 'PENDING'::"OutboxEventStatus"
          AND earlier."available_at" <= transaction_timestamp()
          AND (earlier."available_at", earlier."id") <
              (candidate."available_at", candidate."id")
      )
    ORDER BY candidate."available_at", candidate."id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function projectEvent(
  tx: Prisma.TransactionClient,
  event: LockedOutboxEvent,
  dbNow: Date,
): Promise<number> {
  const eventType = parseEventType(event.eventType);
  const payload = parsePayload(eventType, event.payloadJson, event.tenantId);
  if (payload.appointmentId !== event.aggregateId) corrupt('aggregate_id_mismatch');

  const source = await readAppointment(tx, event.tenantId, event.aggregateId);
  let specs: readonly JobSpec[] = [];
  let cancellation: CancellationPlan | null = null;

  switch (eventType) {
    case 'appointment.confirmed.v1': {
      specs = [
        resultSpec(event, source, 'appointment.confirmed.v1'),
        ...(await reminderSpecs(tx, event, source, dbNow)),
      ];
      break;
    }
    case 'appointment.cancelled.v1': {
      specs = [resultSpec(event, source, 'appointment.cancelled.v1')];
      cancellation = {
        appointmentId: source.id,
        excludedDedupeKey: specs[0]?.dedupeKey ?? null,
        remindersOnly: false,
        futureOnly: false,
      };
      break;
    }
    case 'appointment.rescheduled.v1': {
      if (source.status !== 'RESCHEDULED') corrupt('reschedule_source_status_invalid');
      const replacementId = payload.replacementAppointmentId;
      if (replacementId === undefined) corrupt('replacement_id_missing');
      const replacement = await readAppointment(tx, event.tenantId, replacementId);
      validateDirectReplacement(source, replacement);
      specs = [
        resultSpec(event, replacement, 'appointment.rescheduled.v1'),
        ...(await reminderSpecs(tx, event, replacement, dbNow)),
      ];
      cancellation = {
        appointmentId: source.id,
        excludedDedupeKey: null,
        remindersOnly: false,
        futureOnly: false,
      };
      break;
    }
    case 'appointment.checked_in.v1':
      cancellation = {
        appointmentId: source.id,
        excludedDedupeKey: null,
        remindersOnly: true,
        futureOnly: true,
      };
      break;
    case 'appointment.completed.v1':
    case 'appointment.no_show.v1':
      cancellation = {
        appointmentId: source.id,
        excludedDedupeKey: null,
        remindersOnly: true,
        futureOnly: false,
      };
      break;
  }

  await validateExistingJobs(tx, specs);
  if (cancellation !== null) await cancelJobs(tx, cancellation, dbNow);
  let created = 0;
  for (const spec of specs) created += await createJobIfMissing(tx, spec, dbNow);
  return created;
}

interface CancellationPlan {
  readonly appointmentId: string;
  readonly excludedDedupeKey: string | null;
  readonly remindersOnly: boolean;
  readonly futureOnly: boolean;
}

async function cancelJobs(
  tx: Prisma.TransactionClient,
  plan: CancellationPlan,
  dbNow: Date,
): Promise<void> {
  await tx.notificationJob.updateMany({
    where: {
      appointmentId: plan.appointmentId,
      status: { in: ['PENDING', 'DISPATCHING', 'ENQUEUED', 'DELIVERING'] },
      ...(plan.excludedDedupeKey === null ? {} : { dedupeKey: { not: plan.excludedDedupeKey } }),
      ...(plan.remindersOnly ? { templateKey: { in: [...reminderTemplateKeys] } } : {}),
      ...(plan.futureOnly ? { dueAt: { gt: dbNow } } : {}),
    },
    data: {
      status: 'CANCELLED',
      terminalCode: 'appointment_lifecycle_changed',
      dispatchLeaseUntil: null,
      deliveryLeaseUntil: null,
      updatedAt: dbNow,
    },
  });
}

async function readAppointment(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appointmentId: string,
): Promise<AppointmentProjection> {
  const appointment = await tx.appointment.findFirst({
    where: { tenantId, id: appointmentId },
    select: {
      id: true,
      tenantId: true,
      consumerUserId: true,
      status: true,
      startAt: true,
      rescheduledFromId: true,
      rescheduleRootId: true,
    },
  });
  if (appointment === null) corrupt('appointment_missing_or_cross_tenant');
  return appointment;
}

function validateDirectReplacement(
  source: AppointmentProjection,
  replacement: AppointmentProjection,
): void {
  if (
    replacement.status !== 'CONFIRMED' ||
    replacement.rescheduledFromId !== source.id ||
    replacement.tenantId !== source.tenantId ||
    replacement.consumerUserId !== source.consumerUserId ||
    replacement.rescheduleRootId !== (source.rescheduleRootId ?? source.id)
  ) {
    corrupt('reschedule_chain_invalid');
  }
}

function resultSpec(
  event: LockedOutboxEvent,
  appointment: AppointmentProjection,
  templateKey: ResultTemplateKey,
): JobSpec {
  return jobSpec(event, appointment, templateKey, event.createdAt);
}

async function reminderSpecs(
  tx: Prisma.TransactionClient,
  event: LockedOutboxEvent,
  appointment: AppointmentProjection,
  dbNow: Date,
): Promise<readonly JobSpec[]> {
  const count = await readReminderCount(tx, appointment.tenantId);
  const candidates = [
    {
      templateKey: 'appointment.reminder.24h.v1' as const,
      dueAt: new Date(appointment.startAt.getTime() - 24 * 60 * 60 * 1_000),
    },
    {
      templateKey: 'appointment.reminder.2h.v1' as const,
      dueAt: new Date(appointment.startAt.getTime() - 2 * 60 * 60 * 1_000),
    },
  ];
  return candidates
    .slice(0, count)
    .filter(({ dueAt }) => dueAt.getTime() > dbNow.getTime())
    .map(({ templateKey, dueAt }) => jobSpec(event, appointment, templateKey, dueAt));
}

async function readReminderCount(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: {
        select: {
          entitlements: {
            where: { entitlementCode: 'APPOINTMENT_REMINDER_COUNT' },
            select: { valueJson: true, entitlement: { select: { valueType: true } } },
          },
        },
      },
    },
  });
  if (tenant === null) corrupt('tenant_missing');
  let entitlement = tenant.plan?.entitlements[0];
  if (entitlement === undefined) {
    const defaults = await tx.plan.findMany({
      where: { isDefault: true },
      take: 2,
      select: {
        entitlements: {
          where: { entitlementCode: 'APPOINTMENT_REMINDER_COUNT' },
          select: { valueJson: true, entitlement: { select: { valueType: true } } },
        },
      },
    });
    if (defaults.length !== 1) corrupt('default_plan_invalid');
    entitlement = defaults[0]?.entitlements[0];
  }
  const value = entitlement?.valueJson;
  if (
    entitlement?.entitlement.valueType !== 'INTEGER' ||
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 2
  ) {
    corrupt('reminder_entitlement_invalid');
  }
  return value;
}

async function validateExistingJobs(
  tx: Prisma.TransactionClient,
  specs: readonly JobSpec[],
): Promise<void> {
  if (specs.length === 0) return;
  const existing = await tx.notificationJob.findMany({
    where: { dedupeKey: { in: specs.map(({ dedupeKey }) => dedupeKey) } },
    select: {
      tenantId: true,
      consumerUserId: true,
      appointmentId: true,
      channel: true,
      templateKey: true,
      dueAt: true,
      dedupeKey: true,
    },
  });
  for (const job of existing) {
    const expected = specs.find(({ dedupeKey }) => dedupeKey === job.dedupeKey);
    if (expected === undefined) corrupt('notification_dedupe_collision');
    validateJobShape(job, expected);
  }
}

async function createJobIfMissing(
  tx: Prisma.TransactionClient,
  spec: JobSpec,
  dbNow: Date,
): Promise<number> {
  const result = await tx.notificationJob.createMany({
    data: [
      { ...spec, channel: 'LINE_PUSH', status: 'PENDING', createdAt: dbNow, updatedAt: dbNow },
    ],
    skipDuplicates: true,
  });
  if (result.count === 0) {
    const winner = await tx.notificationJob.findUnique({
      where: { dedupeKey: spec.dedupeKey },
      select: {
        tenantId: true,
        consumerUserId: true,
        appointmentId: true,
        channel: true,
        templateKey: true,
        dueAt: true,
      },
    });
    if (winner === null) corrupt('notification_dedupe_collision');
    validateJobShape(winner, spec);
  }
  return result.count;
}

function validateJobShape(
  job: {
    readonly tenantId: string;
    readonly consumerUserId: string;
    readonly appointmentId: string;
    readonly channel: string;
    readonly templateKey: string;
    readonly dueAt: Date;
  },
  expected: JobSpec,
): void {
  if (
    job.tenantId !== expected.tenantId ||
    job.consumerUserId !== expected.consumerUserId ||
    job.appointmentId !== expected.appointmentId ||
    job.channel !== 'LINE_PUSH' ||
    job.templateKey !== expected.templateKey ||
    job.dueAt.getTime() !== expected.dueAt.getTime()
  ) {
    corrupt('notification_dedupe_collision');
  }
}

function jobSpec(
  event: LockedOutboxEvent,
  appointment: AppointmentProjection,
  templateKey: NotificationTemplateKey,
  dueAt: Date,
): JobSpec {
  return {
    tenantId: appointment.tenantId,
    consumerUserId: appointment.consumerUserId,
    appointmentId: appointment.id,
    sourceOutboxEventId: event.id,
    templateKey,
    dueAt,
    dedupeKey: `notification:${templateKey}:${appointment.id}`,
  };
}

interface ParsedPayload {
  readonly appointmentId: string;
  readonly replacementAppointmentId?: string;
}

function parsePayload(
  eventType: SupportedEventType,
  value: Prisma.JsonValue,
  tenantId: string,
): ParsedPayload {
  if (!isJsonObject(value)) corrupt('payload_invalid');
  const keys = Object.keys(value).sort();
  const appointmentId = value.appointmentId;
  if (!isUuid(appointmentId)) corrupt('payload_appointment_id_invalid');
  if (eventType === 'appointment.confirmed.v1') {
    if (keys.join(',') !== 'appointmentId,tenantId' || value.tenantId !== tenantId) {
      corrupt('payload_shape_invalid');
    }
    return { appointmentId };
  }
  if (eventType === 'appointment.rescheduled.v1') {
    if (keys.join(',') !== 'appointmentId,replacementAppointmentId') {
      corrupt('payload_shape_invalid');
    }
    if (!isUuid(value.replacementAppointmentId)) corrupt('replacement_id_invalid');
    return { appointmentId, replacementAppointmentId: value.replacementAppointmentId };
  }
  if (keys.join(',') !== 'appointmentId') corrupt('payload_shape_invalid');
  return { appointmentId };
}

function parseEventType(value: string): SupportedEventType {
  if (!supportedEvents.includes(value as SupportedEventType)) corrupt('event_type_unsupported');
  return value as SupportedEventType;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ dbNow: Date }>>`
    SELECT transaction_timestamp() AS "dbNow"
  `;
  if (row === undefined) throw new Error('database_clock_unavailable');
  return row.dbNow;
}

class NotificationProjectionCorruption extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NotificationProjectionCorruption';
  }
}

function corrupt(code: string): never {
  throw new NotificationProjectionCorruption(code);
}

const reminderTemplateKeys = ['appointment.reminder.24h.v1', 'appointment.reminder.2h.v1'] as const;

type ResultTemplateKey =
  | 'appointment.confirmed.v1'
  | 'appointment.cancelled.v1'
  | 'appointment.rescheduled.v1';

type NotificationTemplateKey = ResultTemplateKey | (typeof reminderTemplateKeys)[number];
