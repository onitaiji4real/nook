import {
  Prisma,
  type PrismaClient,
  type ServicePriceType,
  type ServiceStatus,
} from '@prisma/client';

const maxServicesEntitlement = 'MAX_SERVICES';

export interface ServiceCatalogRecordItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly priceType: ServicePriceType;
  readonly priceAmount: number | null;
  readonly priceMin: number | null;
  readonly priceMax: number | null;
  readonly currency: string;
  readonly bookingEnabled: boolean;
  readonly status: ServiceStatus;
  readonly sortOrder: number;
}

export interface ServiceCatalogRecord {
  readonly tenantId: string;
  readonly services: readonly ServiceCatalogRecordItem[];
  readonly limit: number;
  readonly used: number;
}

interface ServiceWriteFields {
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly priceType: ServicePriceType;
  readonly priceAmount: number | null;
  readonly priceMin: number | null;
  readonly priceMax: number | null;
  readonly bookingEnabled: boolean;
}

export interface CreateCatalogServiceInput extends ServiceWriteFields {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly id: string;
}

export interface UpdateCatalogServiceInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly serviceId: string;
  readonly patch: Partial<ServiceWriteFields>;
}

export interface ChangeCatalogServiceStatusInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly serviceId: string;
  readonly status: ServiceStatus;
}

export interface ReorderCatalogServicesInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly serviceIds: readonly string[];
}

export type ServiceCatalogConflictCode =
  | 'entitlement_limit_reached'
  | 'entitlement_unavailable'
  | 'last_active_service'
  | 'resource_conflict'
  | 'service_not_found'
  | 'service_order_mismatch';

export class ServiceCatalogRepositoryError extends Error {
  constructor(readonly code: ServiceCatalogConflictCode) {
    super(code);
    this.name = 'ServiceCatalogRepositoryError';
  }
}

export interface ServiceCatalogRepository {
  list(tenantId: string): Promise<ServiceCatalogRecord>;
  create(input: CreateCatalogServiceInput): Promise<ServiceCatalogRecord>;
  update(input: UpdateCatalogServiceInput): Promise<ServiceCatalogRecord>;
  changeStatus(input: ChangeCatalogServiceStatusInput): Promise<ServiceCatalogRecord>;
  reorder(input: ReorderCatalogServicesInput): Promise<ServiceCatalogRecord>;
}

const serviceSelection = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  bufferBeforeMinutes: true,
  bufferAfterMinutes: true,
  priceType: true,
  priceAmount: true,
  priceMin: true,
  priceMax: true,
  currency: true,
  bookingEnabled: true,
  status: true,
  sortOrder: true,
} as const;

export class PrismaServiceCatalogRepository implements ServiceCatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(tenantId: string): Promise<ServiceCatalogRecord> {
    return readCatalog(this.prisma, tenantId);
  }

  create(input: CreateCatalogServiceInput): Promise<ServiceCatalogRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const catalog = await readCatalog(transaction, input.tenantId);
      if (catalog.used >= catalog.limit) {
        throw new ServiceCatalogRepositoryError('entitlement_limit_reached');
      }

      const lastService = await transaction.service.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
        select: { sortOrder: true },
      });

      try {
        await transaction.service.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            name: input.name,
            description: input.description ?? null,
            durationMinutes: input.durationMinutes,
            bufferBeforeMinutes: input.bufferBeforeMinutes,
            bufferAfterMinutes: input.bufferAfterMinutes,
            priceType: input.priceType,
            priceAmount: input.priceAmount,
            priceMin: input.priceMin,
            priceMax: input.priceMax,
            currency: 'TWD',
            bookingEnabled: input.bookingEnabled,
            sortOrder: (lastService?.sortOrder ?? -1) + 1,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ServiceCatalogRepositoryError('resource_conflict');
        }
        throw error;
      }

      await writeAudit(transaction, input, 'service.created', input.id);
      return readCatalog(transaction, input.tenantId);
    });
  }

  update(input: UpdateCatalogServiceInput): Promise<ServiceCatalogRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const patch: Prisma.ServiceUpdateManyMutationInput = {
        ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
        ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
        ...(input.patch.durationMinutes !== undefined
          ? { durationMinutes: input.patch.durationMinutes }
          : {}),
        ...(input.patch.bufferBeforeMinutes !== undefined
          ? { bufferBeforeMinutes: input.patch.bufferBeforeMinutes }
          : {}),
        ...(input.patch.bufferAfterMinutes !== undefined
          ? { bufferAfterMinutes: input.patch.bufferAfterMinutes }
          : {}),
        ...(input.patch.priceType !== undefined ? { priceType: input.patch.priceType } : {}),
        ...(input.patch.priceAmount !== undefined ? { priceAmount: input.patch.priceAmount } : {}),
        ...(input.patch.priceMin !== undefined ? { priceMin: input.patch.priceMin } : {}),
        ...(input.patch.priceMax !== undefined ? { priceMax: input.patch.priceMax } : {}),
        ...(input.patch.bookingEnabled !== undefined
          ? { bookingEnabled: input.patch.bookingEnabled }
          : {}),
      };
      const result = await transaction.service.updateMany({
        where: { tenantId: input.tenantId, id: input.serviceId },
        data: patch,
      });
      if (result.count !== 1) {
        throw new ServiceCatalogRepositoryError('service_not_found');
      }

      await writeAudit(transaction, input, 'service.updated', input.serviceId);
      return readCatalog(transaction, input.tenantId);
    });
  }

  changeStatus(input: ChangeCatalogServiceStatusInput): Promise<ServiceCatalogRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const service = await transaction.service.findFirst({
        where: { tenantId: input.tenantId, id: input.serviceId },
        select: { id: true, status: true },
      });
      if (service === null) {
        throw new ServiceCatalogRepositoryError('service_not_found');
      }
      if (service.status === input.status) {
        return readCatalog(transaction, input.tenantId);
      }

      if (input.status === 'ACTIVE') {
        const catalog = await readCatalog(transaction, input.tenantId);
        if (catalog.used >= catalog.limit) {
          throw new ServiceCatalogRepositoryError('entitlement_limit_reached');
        }
      } else {
        const replacement = await transaction.service.findFirst({
          where: { tenantId: input.tenantId, id: { not: input.serviceId }, status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement === null) {
          throw new ServiceCatalogRepositoryError('last_active_service');
        }
        await transaction.merchantProfile.updateMany({
          where: { tenantId: input.tenantId, starterServiceId: input.serviceId },
          data: { starterServiceId: replacement.id },
        });
      }

      await transaction.service.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.serviceId } },
        data: {
          status: input.status,
          ...(input.status === 'INACTIVE' ? { bookingEnabled: false } : {}),
        },
      });
      await writeAudit(transaction, input, 'service.status_changed', input.serviceId);
      return readCatalog(transaction, input.tenantId);
    });
  }

  reorder(input: ReorderCatalogServicesInput): Promise<ServiceCatalogRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const owned = await transaction.service.findMany({
        where: { tenantId: input.tenantId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((service) => service.id));
      if (
        ownedIds.size !== input.serviceIds.length ||
        input.serviceIds.some((serviceId) => !ownedIds.has(serviceId))
      ) {
        throw new ServiceCatalogRepositoryError('service_order_mismatch');
      }

      for (const [sortOrder, serviceId] of input.serviceIds.entries()) {
        await transaction.service.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: serviceId } },
          data: { sortOrder },
        });
      }

      await writeAudit(transaction, input, 'service.reordered', input.tenantId);
      return readCatalog(transaction, input.tenantId);
    });
  }

  private async withSerializableRetry<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const canRetry =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!canRetry || attempt === 2) throw error;
      }
    }
    throw new Error('unreachable serializable retry state');
  }
}

async function readCatalog(
  client: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
): Promise<ServiceCatalogRecord> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: {
        select: {
          entitlements: {
            where: { entitlementCode: maxServicesEntitlement },
            select: { valueJson: true },
          },
        },
      },
      services: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: serviceSelection,
      },
    },
  });
  if (tenant === null) {
    throw new ServiceCatalogRepositoryError('entitlement_unavailable');
  }
  const value = tenant.plan?.entitlements[0]?.valueJson;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ServiceCatalogRepositoryError('entitlement_unavailable');
  }
  const services = tenant.services;
  return {
    tenantId,
    services,
    limit: value,
    used: services.filter((service) => service.status === 'ACTIVE').length,
  };
}

function writeAudit(
  transaction: Prisma.TransactionClient,
  input: { readonly tenantId: string; readonly actorUserId: string; readonly requestId: string },
  action: string,
  resourceId: string,
): Promise<unknown> {
  return transaction.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'service',
      resourceId,
      requestId: input.requestId,
    },
  });
}
