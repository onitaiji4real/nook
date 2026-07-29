import { Prisma, type PrismaClient } from '@prisma/client';

import { readCustomerTagsEntitlement } from './customer-tag-repository';

export interface CustomerReadCursor {
  readonly relationshipStartedAt: Date;
  readonly id: string;
}

export interface CustomerReadRecord {
  readonly id: string;
  readonly displayName: string;
  readonly relationshipStartedAt: Date;
  readonly firstVisitAt: Date | null;
  readonly lastVisitAt: Date | null;
  readonly completedVisitCount: number;
  readonly noShowCount: number;
  readonly marketingState: 'NOT_GRANTED' | 'GRANTED' | 'WITHDRAWN' | 'SUPERSEDED';
  readonly activeMarketingDocumentVersion: string | null;
  readonly tags: readonly { readonly id: string; readonly name: string }[];
}

export interface CustomerReadPage {
  readonly asOf: Date;
  readonly items: readonly CustomerReadRecord[];
  readonly next: CustomerReadCursor | null;
  readonly tagsEntitled: boolean;
}

export type CustomerDetailReadResult = {
  readonly kind: 'found';
  readonly customer: CustomerReadRecord;
  readonly tagsEntitled: boolean;
} | null;

export type CustomerReadRepositoryErrorCode = 'customer_read_unavailable';

export class CustomerReadRepositoryError extends Error {
  constructor(readonly code: CustomerReadRepositoryErrorCode) {
    super(code);
    this.name = 'CustomerReadRepositoryError';
  }
}

export interface CustomerReadRepository {
  list(input: {
    readonly tenantId: string;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: CustomerReadCursor | undefined;
  }): Promise<CustomerReadPage>;
  readDetail(input: {
    readonly tenantId: string;
    readonly customerId: string;
  }): Promise<CustomerDetailReadResult>;
  recordDetailAudit(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly action: 'crm.customer_detail_viewed' | 'crm.customer_detail_unavailable';
  }): Promise<void>;
  recordDetailDeniedIfTenantExists(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  }): Promise<void>;
}

const customerSelect = Prisma.validator<Prisma.CustomerSelect>()({
  id: true,
  consumerUserId: true,
  relationshipStartedAt: true,
  firstVisitAt: true,
  lastVisitAt: true,
  completedVisitCount: true,
  noShowCount: true,
  consumer: { select: { displayName: true } },
  tagLinks: {
    where: { tag: { status: 'ACTIVE' } },
    orderBy: [{ createdAt: 'asc' }, { tagId: 'asc' }],
    select: { tag: { select: { id: true, displayName: true } } },
  },
});

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;
type TransactionClient = Prisma.TransactionClient;

export class PrismaCustomerReadRepository implements CustomerReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: {
    readonly tenantId: string;
    readonly limit: number;
    readonly asOf?: Date | undefined;
    readonly after?: CustomerReadCursor | undefined;
  }): Promise<CustomerReadPage> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const asOf = input.asOf ?? (await transactionNow(transaction));
        const rows = await transaction.customer.findMany({
          where: {
            tenantId: input.tenantId,
            createdAt: { lte: asOf },
            ...cursorPredicate(input.after),
          },
          orderBy: [{ relationshipStartedAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          select: customerSelect,
        });
        const visible = rows.slice(0, input.limit);
        const [consent, tagsAccess] = await Promise.all([
          readConsentState(transaction, input.tenantId, visible),
          readCustomerTagsEntitlement(transaction, input.tenantId),
        ]);
        const items = visible.map((row) => toRecord(row, consent));
        const last = visible.at(-1);
        return {
          asOf,
          items,
          tagsEntitled: tagsAccess === 'enabled',
          next:
            rows.length > input.limit && last !== undefined
              ? { relationshipStartedAt: last.relationshipStartedAt, id: last.id }
              : null,
        };
      });
    } catch {
      throw new CustomerReadRepositoryError('customer_read_unavailable');
    }
  }

  async readDetail(input: {
    readonly tenantId: string;
    readonly customerId: string;
  }): Promise<CustomerDetailReadResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.customer.findFirst({
          where: { tenantId: input.tenantId, id: input.customerId },
          select: customerSelect,
        });
        if (row === null) return null;
        const [consent, tagsAccess] = await Promise.all([
          readConsentState(transaction, input.tenantId, [row]),
          readCustomerTagsEntitlement(transaction, input.tenantId),
        ]);
        return {
          kind: 'found',
          customer: toRecord(row, consent),
          tagsEntitled: tagsAccess === 'enabled',
        };
      });
    } catch {
      throw new CustomerReadRepositoryError('customer_read_unavailable');
    }
  }

  async recordDetailAudit(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly action: 'crm.customer_detail_viewed' | 'crm.customer_detail_unavailable';
  }): Promise<void> {
    try {
      await this.prisma.$transaction((transaction) =>
        writeDetailAudit(transaction, input, input.action),
      );
    } catch {
      throw new CustomerReadRepositoryError('customer_read_unavailable');
    }
  }

  async recordDetailDeniedIfTenantExists(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: input.tenantId },
          select: { id: true },
        });
        if (tenant === null) return;
        await writeDetailAudit(transaction, input, 'crm.customer_detail_access_denied');
      });
    } catch {
      throw new CustomerReadRepositoryError('customer_read_unavailable');
    }
  }
}

function cursorPredicate(after: CustomerReadCursor | undefined): Prisma.CustomerWhereInput {
  if (after === undefined) return {};
  return {
    OR: [
      { relationshipStartedAt: { lt: after.relationshipStartedAt } },
      { relationshipStartedAt: after.relationshipStartedAt, id: { lt: after.id } },
    ],
  };
}

async function readConsentState(
  transaction: TransactionClient,
  tenantId: string,
  customers: readonly CustomerRow[],
): Promise<{
  readonly activeVersion: string | null;
  readonly activeDocumentId: string | null;
  readonly eventByConsumer: ReadonlyMap<
    string,
    { readonly eventType: 'GRANTED' | 'WITHDRAWN'; readonly documentId: string }
  >;
}> {
  const [activeDocument, streams] = await Promise.all([
    transaction.consentDocument.findFirst({
      where: { purpose: 'MARKETING_MESSAGES', status: 'ACTIVE' },
      select: { id: true, version: true },
    }),
    customers.length === 0
      ? Promise.resolve([])
      : transaction.consumerConsentStream.findMany({
          where: {
            tenantId,
            purpose: 'MARKETING_MESSAGES',
            consumerUserId: { in: customers.map((customer) => customer.consumerUserId) },
          },
          select: {
            consumerUserId: true,
            currentEvent: { select: { eventType: true, consentDocumentId: true } },
          },
        }),
  ]);
  return {
    activeVersion: activeDocument?.version ?? null,
    activeDocumentId: activeDocument?.id ?? null,
    eventByConsumer: new Map(
      streams.flatMap((stream) =>
        stream.currentEvent === null
          ? []
          : [
              [
                stream.consumerUserId,
                {
                  eventType: stream.currentEvent.eventType,
                  documentId: stream.currentEvent.consentDocumentId,
                },
              ] as const,
            ],
      ),
    ),
  };
}

function toRecord(
  row: CustomerRow,
  consent: Awaited<ReturnType<typeof readConsentState>>,
): CustomerReadRecord {
  const currentEvent = consent.eventByConsumer.get(row.consumerUserId);
  return {
    id: row.id,
    displayName: normalizedDisplayName(row.consumer.displayName),
    relationshipStartedAt: row.relationshipStartedAt,
    firstVisitAt: row.firstVisitAt,
    lastVisitAt: row.lastVisitAt,
    completedVisitCount: row.completedVisitCount,
    noShowCount: row.noShowCount,
    marketingState:
      currentEvent === undefined
        ? 'NOT_GRANTED'
        : currentEvent.eventType === 'WITHDRAWN'
          ? 'WITHDRAWN'
          : currentEvent.documentId === consent.activeDocumentId
            ? 'GRANTED'
            : 'SUPERSEDED',
    activeMarketingDocumentVersion: consent.activeVersion,
    tags: row.tagLinks.map(({ tag }) => ({ id: tag.id, name: tag.displayName })),
  };
}

function normalizedDisplayName(value: string): string {
  const normalized = value.normalize('NFC').trim();
  return normalized.length === 0 ? '顧客' : normalized;
}

async function transactionNow(transaction: TransactionClient): Promise<Date> {
  const [row] = await transaction.$queryRaw<readonly { now: Date }[]>`
    SELECT transaction_timestamp() AS "now"
  `;
  if (row === undefined) throw new Error('database time unavailable');
  return row.now;
}

function writeDetailAudit(
  transaction: TransactionClient,
  input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly actorUserId: string;
    readonly requestId: string;
  },
  action:
    | 'crm.customer_detail_viewed'
    | 'crm.customer_detail_access_denied'
    | 'crm.customer_detail_unavailable',
): Promise<unknown> {
  return transaction.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'customer',
      resourceId: input.customerId,
      requestId: input.requestId,
    },
  });
}
