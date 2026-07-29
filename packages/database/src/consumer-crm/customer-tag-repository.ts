import { Prisma, type CustomerTagStatus, type PrismaClient } from '@prisma/client';

export const CUSTOMER_TAGS_ENTITLEMENT = 'CUSTOMER_TAGS' as const;
export const CUSTOMER_TAG_DEFINITION_LIMIT = 100;
export const CUSTOMER_TAG_LINK_LIMIT = 50;

export interface CustomerTagDefinitionRecord {
  readonly id: string;
  readonly displayName: string;
  readonly status: CustomerTagStatus;
}

export interface CustomerTagMutationContext {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export type CustomerTagRepositoryErrorCode =
  | 'entitlement_denied'
  | 'entitlement_unavailable'
  | 'definition_limit_reached'
  | 'link_limit_reached'
  | 'tag_conflict'
  | 'tag_not_found'
  | 'customer_not_found'
  | 'tag_inactive'
  | 'tag_unavailable';

export class CustomerTagRepositoryError extends Error {
  constructor(readonly code: CustomerTagRepositoryErrorCode) {
    super(code);
    this.name = 'CustomerTagRepositoryError';
  }
}

export interface CustomerTagRepository {
  access(tenantId: string): Promise<'enabled' | 'disabled' | 'unavailable'>;
  listDefinitions(tenantId: string): Promise<readonly CustomerTagDefinitionRecord[]>;
  createDefinition(
    input: CustomerTagMutationContext & {
      readonly id: string;
      readonly normalizedName: string;
      readonly displayName: string;
    },
  ): Promise<CustomerTagDefinitionRecord>;
  changeDefinitionStatus(
    input: CustomerTagMutationContext & {
      readonly tagId: string;
      readonly status: CustomerTagStatus;
    },
  ): Promise<CustomerTagDefinitionRecord>;
  attach(
    input: CustomerTagMutationContext & {
      readonly customerId: string;
      readonly tagId: string;
    },
  ): Promise<boolean>;
  detach(
    input: CustomerTagMutationContext & {
      readonly customerId: string;
      readonly tagId: string;
    },
  ): Promise<boolean>;
}

type TransactionClient = Prisma.TransactionClient;
type EntitlementClient = Pick<PrismaClient, 'tenant' | 'plan'> | TransactionClient;

const definitionSelect = {
  id: true,
  displayName: true,
  status: true,
} as const;

export class PrismaCustomerTagRepository implements CustomerTagRepository {
  constructor(private readonly prisma: PrismaClient) {}

  access(tenantId: string): Promise<'enabled' | 'disabled' | 'unavailable'> {
    return readCustomerTagsEntitlement(this.prisma, tenantId);
  }

  async listDefinitions(tenantId: string): Promise<readonly CustomerTagDefinitionRecord[]> {
    try {
      await requireEntitlement(this.prisma, tenantId);
      return await this.prisma.customerTagDefinition.findMany({
        where: { tenantId },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
        take: CUSTOMER_TAG_DEFINITION_LIMIT,
        select: definitionSelect,
      });
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  createDefinition(
    input: CustomerTagMutationContext & {
      readonly id: string;
      readonly normalizedName: string;
      readonly displayName: string;
    },
  ): Promise<CustomerTagDefinitionRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await lockTenant(transaction, input.tenantId);
      await requireEntitlement(transaction, input.tenantId);
      const count = await transaction.customerTagDefinition.count({
        where: { tenantId: input.tenantId },
      });
      if (count >= CUSTOMER_TAG_DEFINITION_LIMIT) {
        throw new CustomerTagRepositoryError('definition_limit_reached');
      }
      let definition: CustomerTagDefinitionRecord;
      try {
        definition = await transaction.customerTagDefinition.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            normalizedName: input.normalizedName,
            displayName: input.displayName,
          },
          select: definitionSelect,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new CustomerTagRepositoryError('tag_conflict');
        }
        throw error;
      }
      await writeTagAudit(transaction, input, 'crm.customer_tag_definition_created', input.id);
      return definition;
    });
  }

  changeDefinitionStatus(
    input: CustomerTagMutationContext & {
      readonly tagId: string;
      readonly status: CustomerTagStatus;
    },
  ): Promise<CustomerTagDefinitionRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await lockTenant(transaction, input.tenantId);
      await requireEntitlement(transaction, input.tenantId);
      const current = await transaction.customerTagDefinition.findFirst({
        where: { tenantId: input.tenantId, id: input.tagId },
        select: definitionSelect,
      });
      if (current === null) throw new CustomerTagRepositoryError('tag_not_found');
      if (current.status === input.status) return current;
      const updated = await transaction.customerTagDefinition.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.tagId } },
        data: { status: input.status },
        select: definitionSelect,
      });
      await writeTagAudit(
        transaction,
        input,
        'crm.customer_tag_definition_status_changed',
        input.tagId,
      );
      return updated;
    });
  }

  attach(
    input: CustomerTagMutationContext & {
      readonly customerId: string;
      readonly tagId: string;
    },
  ): Promise<boolean> {
    return this.withSerializableRetry(async (transaction) => {
      await lockTenant(transaction, input.tenantId);
      await requireEntitlement(transaction, input.tenantId);
      await lockCustomer(transaction, input.tenantId, input.customerId);
      const tag = await transaction.customerTagDefinition.findFirst({
        where: { tenantId: input.tenantId, id: input.tagId },
        select: { status: true },
      });
      if (tag === null) throw new CustomerTagRepositoryError('tag_not_found');
      if (tag.status !== 'ACTIVE') throw new CustomerTagRepositoryError('tag_inactive');
      const existing = await transaction.customerTagLink.findUnique({
        where: {
          tenantId_customerId_tagId: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            tagId: input.tagId,
          },
        },
        select: { tagId: true },
      });
      if (existing !== null) return false;
      const count = await transaction.customerTagLink.count({
        where: { tenantId: input.tenantId, customerId: input.customerId },
      });
      if (count >= CUSTOMER_TAG_LINK_LIMIT) {
        throw new CustomerTagRepositoryError('link_limit_reached');
      }
      const membershipId = await requireActiveMembership(
        transaction,
        input.tenantId,
        input.actorUserId,
      );
      await transaction.customerTagLink.create({
        data: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          tagId: input.tagId,
          createdByMembershipId: membershipId,
        },
      });
      await writeTagAudit(transaction, input, 'crm.customer_tag_attached', input.tagId);
      return true;
    });
  }

  detach(
    input: CustomerTagMutationContext & {
      readonly customerId: string;
      readonly tagId: string;
    },
  ): Promise<boolean> {
    return this.withSerializableRetry(async (transaction) => {
      await lockTenant(transaction, input.tenantId);
      await requireEntitlement(transaction, input.tenantId);
      await lockCustomer(transaction, input.tenantId, input.customerId);
      const tag = await transaction.customerTagDefinition.findFirst({
        where: { tenantId: input.tenantId, id: input.tagId },
        select: { id: true },
      });
      if (tag === null) throw new CustomerTagRepositoryError('tag_not_found');
      const deleted = await transaction.customerTagLink.deleteMany({
        where: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          tagId: input.tagId,
        },
      });
      if (deleted.count === 0) return false;
      await writeTagAudit(transaction, input, 'crm.customer_tag_detached', input.tagId);
      return true;
    });
  }

  private async withSerializableRetry<T>(
    operation: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (error instanceof CustomerTagRepositoryError) throw error;
        if (attempt < 3 && isRetryableTransactionError(error)) continue;
        throw normalizeRepositoryError(error);
      }
    }
    throw new CustomerTagRepositoryError('tag_unavailable');
  }
}

export async function readCustomerTagsEntitlement(
  client: EntitlementClient,
  tenantId: string,
): Promise<'enabled' | 'disabled' | 'unavailable'> {
  try {
    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: {
          select: {
            entitlements: {
              where: { entitlementCode: CUSTOMER_TAGS_ENTITLEMENT },
              select: { valueJson: true, entitlement: { select: { valueType: true } } },
            },
          },
        },
      },
    });
    if (tenant === null) return 'unavailable';
    let entitlement = tenant.plan?.entitlements[0];
    if (entitlement === undefined) {
      const fallback = await client.plan.findFirst({
        where: { isDefault: true },
        select: {
          entitlements: {
            where: { entitlementCode: CUSTOMER_TAGS_ENTITLEMENT },
            select: { valueJson: true, entitlement: { select: { valueType: true } } },
          },
        },
      });
      entitlement = fallback?.entitlements[0];
    }
    if (
      entitlement === undefined ||
      entitlement.entitlement.valueType !== 'BOOLEAN' ||
      typeof entitlement.valueJson !== 'boolean'
    ) {
      return 'unavailable';
    }
    return entitlement.valueJson ? 'enabled' : 'disabled';
  } catch {
    return 'unavailable';
  }
}

async function requireEntitlement(client: EntitlementClient, tenantId: string): Promise<void> {
  const access = await readCustomerTagsEntitlement(client, tenantId);
  if (access === 'disabled') throw new CustomerTagRepositoryError('entitlement_denied');
  if (access === 'unavailable') throw new CustomerTagRepositoryError('entitlement_unavailable');
}

async function lockTenant(transaction: TransactionClient, tenantId: string): Promise<void> {
  const rows = await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id"
    FROM "tenants"
    WHERE "id" = ${tenantId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new CustomerTagRepositoryError('tag_unavailable');
}

async function lockCustomer(
  transaction: TransactionClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id"
    FROM "customers"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "id" = ${customerId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new CustomerTagRepositoryError('customer_not_found');
}

async function requireActiveMembership(
  transaction: TransactionClient,
  tenantId: string,
  actorUserId: string,
): Promise<string> {
  const membership = await transaction.membership.findFirst({
    where: {
      tenantId,
      userId: actorUserId,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
      user: { status: 'ACTIVE' },
    },
    select: { id: true },
  });
  if (membership === null) throw new CustomerTagRepositoryError('tag_unavailable');
  return membership.id;
}

function writeTagAudit(
  transaction: TransactionClient,
  input: CustomerTagMutationContext,
  action:
    | 'crm.customer_tag_definition_created'
    | 'crm.customer_tag_definition_status_changed'
    | 'crm.customer_tag_attached'
    | 'crm.customer_tag_detached',
  tagId: string,
): Promise<unknown> {
  return transaction.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'customer_tag',
      resourceId: tagId,
      requestId: input.requestId,
    },
  });
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  const message = error instanceof Error ? error.message : '';
  return (
    /\b40001\b/.test(message) ||
    /\b40P01\b/.test(message) ||
    /could not serialize access|deadlock detected/i.test(message)
  );
}

function normalizeRepositoryError(error: unknown): CustomerTagRepositoryError {
  return error instanceof CustomerTagRepositoryError
    ? error
    : new CustomerTagRepositoryError('tag_unavailable');
}
