import { createHash, randomUUID } from 'node:crypto';

import {
  canonicalMarketingConsentEvidence,
  deriveMarketingConsentCurrentState,
  MARKETING_CONSENT_EVIDENCE_SCHEMA,
  MARKETING_CONSENT_PURPOSE,
  normalizeConsentTenantDisplayName,
  type MarketingConsentCurrentState,
} from '@nook/domain';
import { Prisma, type PrismaClient } from '@prisma/client';

export interface MarketingConsentDocumentRecord {
  readonly id: string;
  readonly purpose: typeof MARKETING_CONSENT_PURPOSE;
  readonly version: string;
  readonly locale: string;
  readonly content: string;
}

export interface MarketingConsentStateRecord {
  readonly tenantId: string;
  readonly tenantDisplayName: string;
  readonly purpose: typeof MARKETING_CONSENT_PURPOSE;
  readonly state: MarketingConsentCurrentState;
  readonly eligible: boolean;
  readonly revision: number;
  readonly activeDocument: MarketingConsentDocumentRecord | null;
  readonly grantedAt: Date | null;
  readonly withdrawnAt: Date | null;
}

export interface GrantMarketingConsentInput {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly actorUserId: string;
  readonly consentDocumentId: string;
  readonly expectedRevision: number;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  readonly requestId: string;
}

export interface WithdrawMarketingConsentInput {
  readonly tenantId: string;
  readonly consumerUserId: string;
  readonly actorUserId: string;
  readonly expectedRevision: number;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  readonly requestId: string;
}

export type MarketingConsentRepositoryErrorCode =
  | 'relationship_not_found'
  | 'consent_stream_not_found'
  | 'tenant_inactive'
  | 'consent_not_active'
  | 'tenant_display_name_invalid'
  | 'revision_conflict'
  | 'idempotency_conflict'
  | 'consent_already_granted'
  | 'consent_unavailable';

export class MarketingConsentRepositoryError extends Error {
  constructor(readonly code: MarketingConsentRepositoryErrorCode) {
    super(code);
    this.name = 'MarketingConsentRepositoryError';
  }
}

export interface MarketingConsentRepository {
  readCurrent(input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
  }): Promise<MarketingConsentStateRecord>;
  grant(input: GrantMarketingConsentInput): Promise<MarketingConsentStateRecord>;
  withdraw(input: WithdrawMarketingConsentInput): Promise<MarketingConsentStateRecord>;
}

export class PrismaMarketingConsentRepository implements MarketingConsentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  readCurrent(input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
  }): Promise<MarketingConsentStateRecord> {
    return this.prisma
      .$transaction(async (tx) => {
        await requireRelationshipOrStream(tx, input);
        return readCurrentState(tx, input);
      })
      .catch(mapUnexpectedError);
  }

  grant(input: GrantMarketingConsentInput): Promise<MarketingConsentStateRecord> {
    return withSerializableRetry(this.prisma, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { name: true, status: true },
      });
      if (tenant === null) fail('relationship_not_found');
      if (tenant.status !== 'ACTIVE') fail('tenant_inactive');
      await requireRelationshipOrStream(tx, input);

      const tenantDisplayName = normalizeConsentTenantDisplayName(tenant.name);
      if (tenantDisplayName === null) fail('tenant_display_name_invalid');
      const document = await tx.consentDocument.findFirst({
        where: {
          id: input.consentDocumentId,
          purpose: MARKETING_CONSENT_PURPOSE,
          status: 'ACTIVE',
        },
      });
      if (document === null) fail('consent_not_active');

      await createStreamIfMissing(tx, input);
      const stream = await lockStream(tx, input);
      const replay = await findCommand(tx, input);
      if (replay !== null) {
        if (replay.requestFingerprint !== input.requestFingerprint) {
          fail('idempotency_conflict');
        }
        return readCurrentState(tx, input);
      }
      if (stream.currentRevision !== input.expectedRevision) fail('revision_conflict');

      const latestEvent =
        stream.currentEventId === null
          ? null
          : await tx.consumerConsentEvent.findUniqueOrThrow({
              where: { id: stream.currentEventId },
              select: { eventType: true, consentDocumentId: true },
            });
      const currentState = deriveMarketingConsentCurrentState({
        latestEvent,
        activeDocumentId: document.id,
      });
      if (currentState === 'GRANTED') fail('consent_already_granted');

      const occurredAt = await transactionNow(tx);
      const revision = stream.currentRevision + 1;
      const commandId = randomUUID();
      const eventId = randomUUID();
      await tx.consumerConsentCommand.create({
        data: {
          id: commandId,
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          purpose: MARKETING_CONSENT_PURPOSE,
          idempotencyKeyHash: input.idempotencyKeyHash,
          commandType: 'GRANT',
          requestFingerprint: input.requestFingerprint,
          resultRevision: revision,
          outcome: 'APPLIED',
          requestId: input.requestId,
          createdAt: occurredAt,
        },
      });
      await tx.consumerConsentEvent.create({
        data: {
          id: eventId,
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          purpose: MARKETING_CONSENT_PURPOSE,
          revision,
          eventType: 'GRANTED',
          consentDocumentId: document.id,
          source: 'CONSUMER_WEB',
          actorUserId: input.actorUserId,
          commandId,
          tenantDisplayNameSnapshot: tenantDisplayName,
          renderedEvidenceSchema: MARKETING_CONSENT_EVIDENCE_SCHEMA,
          renderedEvidenceSha256: sha256(
            canonicalMarketingConsentEvidence({
              tenantId: input.tenantId,
              tenantDisplayName,
              documentId: document.id,
              documentVersion: document.version,
              locale: document.locale,
              contentSha256: document.contentSha256,
            }),
          ),
          occurredAt,
          requestId: input.requestId,
          createdAt: occurredAt,
        },
      });
      await finishTransition(tx, input, revision, eventId, occurredAt, 'marketing_consent.granted');
      return readCurrentState(tx, input);
    }).catch(mapUnexpectedError);
  }

  withdraw(input: WithdrawMarketingConsentInput): Promise<MarketingConsentStateRecord> {
    return withSerializableRetry(this.prisma, async (tx) => {
      const stream = await lockStream(tx, input);
      const replay = await findCommand(tx, input);
      if (replay !== null) {
        if (replay.requestFingerprint !== input.requestFingerprint) {
          fail('idempotency_conflict');
        }
        return readCurrentState(tx, input);
      }
      if (stream.currentRevision !== input.expectedRevision) fail('revision_conflict');
      if (stream.currentEventId === null) fail('consent_stream_not_found');

      const latestEvent = await tx.consumerConsentEvent.findUniqueOrThrow({
        where: { id: stream.currentEventId },
        select: { eventType: true, consentDocumentId: true },
      });
      const occurredAt = await transactionNow(tx);
      if (latestEvent.eventType === 'WITHDRAWN') {
        await tx.consumerConsentCommand.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            consumerUserId: input.consumerUserId,
            purpose: MARKETING_CONSENT_PURPOSE,
            idempotencyKeyHash: input.idempotencyKeyHash,
            commandType: 'WITHDRAW',
            requestFingerprint: input.requestFingerprint,
            resultRevision: stream.currentRevision,
            outcome: 'NOOP_ALREADY_WITHDRAWN',
            requestId: input.requestId,
            createdAt: occurredAt,
          },
        });
        return readCurrentState(tx, input);
      }

      const revision = stream.currentRevision + 1;
      const commandId = randomUUID();
      const eventId = randomUUID();
      await tx.consumerConsentCommand.create({
        data: {
          id: commandId,
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          purpose: MARKETING_CONSENT_PURPOSE,
          idempotencyKeyHash: input.idempotencyKeyHash,
          commandType: 'WITHDRAW',
          requestFingerprint: input.requestFingerprint,
          resultRevision: revision,
          outcome: 'APPLIED',
          requestId: input.requestId,
          createdAt: occurredAt,
        },
      });
      await tx.consumerConsentEvent.create({
        data: {
          id: eventId,
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          purpose: MARKETING_CONSENT_PURPOSE,
          revision,
          eventType: 'WITHDRAWN',
          consentDocumentId: latestEvent.consentDocumentId,
          source: 'CONSUMER_WEB',
          actorUserId: input.actorUserId,
          commandId,
          tenantDisplayNameSnapshot: null,
          renderedEvidenceSchema: null,
          renderedEvidenceSha256: null,
          occurredAt,
          requestId: input.requestId,
          createdAt: occurredAt,
        },
      });
      await finishTransition(
        tx,
        input,
        revision,
        eventId,
        occurredAt,
        'marketing_consent.withdrawn',
      );
      return readCurrentState(tx, input);
    }).catch(mapUnexpectedError);
  }
}

async function requireRelationshipOrStream(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<void> {
  const stream = await tx.consumerConsentStream.findUnique({
    where: {
      tenantId_consumerUserId_purpose: {
        tenantId: input.tenantId,
        consumerUserId: input.consumerUserId,
        purpose: MARKETING_CONSENT_PURPOSE,
      },
    },
    select: { currentRevision: true },
  });
  if (stream !== null) return;
  await requireConfirmedRelationship(tx, input);
}

async function requireConfirmedRelationship(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<void> {
  const relationship = await tx.appointment.findFirst({
    where: { tenantId: input.tenantId, consumerUserId: input.consumerUserId },
    select: { id: true },
  });
  if (relationship === null) fail('relationship_not_found');
}

async function createStreamIfMissing(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "consumer_consent_streams" (
      "tenant_id", "consumer_user_id", "purpose", "current_revision", "current_event_id", "updated_at"
    )
    VALUES (
      ${input.tenantId}::uuid,
      ${input.consumerUserId}::uuid,
      ${MARKETING_CONSENT_PURPOSE}::"ConsentPurpose",
      0,
      NULL,
      transaction_timestamp()
    )
    ON CONFLICT ("tenant_id", "consumer_user_id", "purpose") DO NOTHING
  `;
}

async function lockStream(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<{ readonly currentRevision: number; readonly currentEventId: string | null }> {
  const rows = await tx.$queryRaw<{ currentRevision: number; currentEventId: string | null }[]>`
    SELECT
      "current_revision" AS "currentRevision",
      "current_event_id" AS "currentEventId"
    FROM "consumer_consent_streams"
    WHERE "tenant_id" = ${input.tenantId}::uuid
      AND "consumer_user_id" = ${input.consumerUserId}::uuid
      AND "purpose" = ${MARKETING_CONSENT_PURPOSE}::"ConsentPurpose"
    FOR UPDATE
  `;
  const stream = rows[0];
  if (stream === undefined) fail('consent_stream_not_found');
  return stream;
}

function findCommand(
  tx: Prisma.TransactionClient,
  input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
    readonly idempotencyKeyHash: string;
  },
) {
  return tx.consumerConsentCommand.findUnique({
    where: {
      tenantId_consumerUserId_purpose_idempotencyKeyHash: {
        tenantId: input.tenantId,
        consumerUserId: input.consumerUserId,
        purpose: MARKETING_CONSENT_PURPOSE,
        idempotencyKeyHash: input.idempotencyKeyHash,
      },
    },
    select: { requestFingerprint: true },
  });
}

async function finishTransition(
  tx: Prisma.TransactionClient,
  input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  },
  revision: number,
  eventId: string,
  occurredAt: Date,
  action: string,
): Promise<void> {
  await tx.consumerConsentStream.update({
    where: {
      tenantId_consumerUserId_purpose: {
        tenantId: input.tenantId,
        consumerUserId: input.consumerUserId,
        purpose: MARKETING_CONSENT_PURPOSE,
      },
    },
    data: { currentRevision: revision, currentEventId: eventId, updatedAt: occurredAt },
  });
  await tx.tenantCrmPrivacyVersion.upsert({
    where: { tenantId: input.tenantId },
    create: { tenantId: input.tenantId, consentWatermark: 1n, updatedAt: occurredAt },
    update: { consentWatermark: { increment: 1 }, updatedAt: occurredAt },
  });
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'marketing_consent_event',
      resourceId: eventId,
      requestId: input.requestId,
    },
  });
}

async function readCurrentState(
  tx: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly consumerUserId: string },
): Promise<MarketingConsentStateRecord> {
  const [tenant, stream, activeDocument, latestGrant] = await Promise.all([
    tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true },
    }),
    tx.consumerConsentStream.findUnique({
      where: {
        tenantId_consumerUserId_purpose: {
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          purpose: MARKETING_CONSENT_PURPOSE,
        },
      },
      include: { currentEvent: true },
    }),
    tx.consentDocument.findFirst({
      where: { purpose: MARKETING_CONSENT_PURPOSE, status: 'ACTIVE' },
    }),
    tx.consumerConsentEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        consumerUserId: input.consumerUserId,
        purpose: MARKETING_CONSENT_PURPOSE,
        eventType: 'GRANTED',
      },
      orderBy: { revision: 'desc' },
      select: { occurredAt: true },
    }),
  ]);
  if (tenant === null) fail('relationship_not_found');
  const latestEvent = stream?.currentEvent ?? null;
  const state = deriveMarketingConsentCurrentState({
    latestEvent,
    activeDocumentId: activeDocument?.id ?? null,
  });
  return {
    tenantId: input.tenantId,
    tenantDisplayName: tenant.name,
    purpose: MARKETING_CONSENT_PURPOSE,
    state,
    eligible: state === 'GRANTED',
    revision: stream?.currentRevision ?? 0,
    activeDocument:
      activeDocument === null
        ? null
        : {
            id: activeDocument.id,
            purpose: MARKETING_CONSENT_PURPOSE,
            version: activeDocument.version,
            locale: activeDocument.locale,
            content: activeDocument.contentText,
          },
    grantedAt: latestGrant?.occurredAt ?? null,
    withdrawnAt: latestEvent?.eventType === 'WITHDRAWN' ? latestEvent.occurredAt : null,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function withSerializableRetry<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw new MarketingConsentRepositoryError('consent_unavailable');
}

async function transactionNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT transaction_timestamp() AS "now"`;
  const now = rows[0]?.now;
  if (now === undefined) fail('consent_unavailable');
  return now;
}

function fail(code: MarketingConsentRepositoryErrorCode): never {
  throw new MarketingConsentRepositoryError(code);
}

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

function mapUnexpectedError(error: unknown): never {
  if (error instanceof MarketingConsentRepositoryError) throw error;
  throw new MarketingConsentRepositoryError('consent_unavailable');
}
