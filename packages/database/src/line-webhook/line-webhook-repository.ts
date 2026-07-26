import { IdentityProvider, Prisma, type PrismaClient } from '@prisma/client';

export interface RecordLineWebhookEventInput {
  readonly webhookEventId: string;
  readonly eventType: string;
  readonly routedType: 'follow' | 'unfollow' | 'other';
  readonly sourceType: 'user' | 'group' | 'room';
  readonly providerSubject?: string;
  readonly providerTimestamp: Date;
  readonly payloadJson: Readonly<Record<string, unknown>>;
}

export interface LineWebhookRepository {
  record(input: RecordLineWebhookEventInput): Promise<{
    readonly replayed: boolean;
    readonly status: 'PROCESSED' | 'IGNORED';
  }>;
  deleteExpired(input: { readonly limit: number }): Promise<number>;
}

export class PrismaLineWebhookRepository implements LineWebhookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordLineWebhookEventInput): Promise<{
    readonly replayed: boolean;
    readonly status: 'PROCESSED' | 'IGNORED';
  }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.lineWebhookEvent.findUnique({
          where: { webhookEventId: input.webhookEventId },
          select: { status: true },
        });
        if (existing !== null) {
          return {
            replayed: true,
            status: existing.status === 'IGNORED' ? 'IGNORED' : 'PROCESSED',
          };
        }

        const dbNow = await transactionNow(tx);
        const linkedUserId =
          input.providerSubject === undefined
            ? null
            : await lockVerifiedLineIdentity(tx, input.providerSubject);
        if (input.providerSubject !== undefined) {
          await tx.$queryRaw<Array<{ provider_subject: string }>>(Prisma.sql`
            SELECT "provider_subject"
            FROM "line_messaging_recipients"
            WHERE "provider_subject" = ${input.providerSubject}
            FOR UPDATE
          `);
        }

        await tx.lineWebhookEvent.create({
          data: {
            webhookEventId: input.webhookEventId,
            eventType: input.eventType,
            sourceType: input.sourceType,
            payloadJson: input.payloadJson as Prisma.InputJsonValue,
            status: 'RECEIVED',
            receivedAt: dbNow,
          },
        });

        const status = input.routedType === 'other' ? 'IGNORED' : 'PROCESSED';
        if (input.routedType !== 'other' && input.providerSubject !== undefined) {
          await applyRecipientObservation(tx, {
            providerSubject: input.providerSubject,
            linkedUserId,
            status: input.routedType === 'follow' ? 'FOLLOWING' : 'BLOCKED',
            observedAt: input.providerTimestamp,
            webhookEventId: input.webhookEventId,
            dbNow,
          });
        }
        await tx.lineWebhookEvent.update({
          where: { webhookEventId: input.webhookEventId },
          data: { status, processedAt: dbNow },
        });
        return { replayed: false, status };
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const existing = await this.prisma.lineWebhookEvent.findUnique({
          where: { webhookEventId: input.webhookEventId },
          select: { status: true },
        });
        if (existing !== null) {
          return {
            replayed: true,
            status: existing.status === 'IGNORED' ? 'IGNORED' : 'PROCESSED',
          };
        }
      }
      throw error;
    }
  }

  async deleteExpired(input: { readonly limit: number }): Promise<number> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error('line_webhook_retention_limit_invalid');
    }
    const deleted = await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "line_webhook_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "line_webhook_events"
        WHERE "received_at" < clock_timestamp() - INTERVAL '30 days'
        ORDER BY "received_at", "id"
        LIMIT ${input.limit}
      )
    `);
    return deleted;
  }
}

async function lockVerifiedLineIdentity(
  tx: Prisma.TransactionClient,
  providerSubject: string,
): Promise<string | null> {
  const identity = await tx.userIdentity.findUnique({
    where: {
      provider_providerSubject: { provider: IdentityProvider.LINE, providerSubject },
    },
    select: { id: true, userId: true },
  });
  if (identity === null) return null;
  const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "users" WHERE "id" = ${identity.userId}::uuid FOR UPDATE
  `);
  const identities = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "user_identities"
    WHERE "id" = ${identity.id}::uuid
      AND "user_id" = ${identity.userId}::uuid
      AND "provider" = 'LINE'::"IdentityProvider"
      AND "provider_subject" = ${providerSubject}
    FOR UPDATE
  `);
  if (users.length !== 1 || identities.length !== 1) throw new Error('line_identity_corrupt');
  return identity.userId;
}

async function applyRecipientObservation(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerSubject: string;
    readonly linkedUserId: string | null;
    readonly status: 'FOLLOWING' | 'BLOCKED';
    readonly observedAt: Date;
    readonly webhookEventId: string;
    readonly dbNow: Date;
  },
): Promise<void> {
  const current = await tx.lineMessagingRecipient.findUnique({
    where: { providerSubject: input.providerSubject },
  });
  if (current === null) {
    await tx.lineMessagingRecipient.create({
      data: {
        providerSubject: input.providerSubject,
        ...(input.linkedUserId === null ? {} : { userId: input.linkedUserId }),
        status: input.status,
        observedAt: input.observedAt,
        observedWebhookEventId: input.webhookEventId,
        createdAt: input.dbNow,
        updatedAt: input.dbNow,
      },
    });
    return;
  }
  if (
    current.userId !== null &&
    input.linkedUserId !== null &&
    current.userId !== input.linkedUserId
  ) {
    throw new Error('line_recipient_identity_mismatch');
  }
  if (!isNewerObservation(current, input)) return;
  await tx.lineMessagingRecipient.update({
    where: { providerSubject: input.providerSubject },
    data: {
      ...(current.userId === null && input.linkedUserId !== null
        ? { userId: input.linkedUserId }
        : {}),
      status: input.status,
      observedAt: input.observedAt,
      observedWebhookEventId: input.webhookEventId,
      updatedAt: input.dbNow,
    },
  });
}

function isNewerObservation(
  current: {
    readonly status: 'FOLLOWING' | 'BLOCKED';
    readonly observedAt: Date;
    readonly observedWebhookEventId: string;
  },
  incoming: {
    readonly status: 'FOLLOWING' | 'BLOCKED';
    readonly observedAt: Date;
    readonly webhookEventId: string;
  },
): boolean {
  const currentTime = current.observedAt.getTime();
  const incomingTime = incoming.observedAt.getTime();
  if (incomingTime !== currentTime) return incomingTime > currentTime;
  if (incoming.status !== current.status) return incoming.status === 'BLOCKED';
  return incoming.webhookEventId > current.observedWebhookEventId;
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  if (row === undefined) throw new Error('database_clock_unavailable');
  return row.now;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
