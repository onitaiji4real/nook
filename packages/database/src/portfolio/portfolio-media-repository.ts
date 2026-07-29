import { Prisma, type MediaAssetStatus, type PrismaClient } from '@prisma/client';

const entitlementCode = 'MAX_PORTFOLIO_IMAGES';

export interface PortfolioMediaRecordItem {
  readonly id: string;
  readonly staffId: string | null;
  readonly serviceId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  readonly sortOrder: number;
  readonly media: {
    readonly id: string;
    readonly status: 'PENDING' | 'READY' | 'REJECTED';
    readonly mimeType: string | null;
    readonly byteSize: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly rejectionCode: string | null;
  };
}

export interface PortfolioMediaRecord {
  readonly tenantId: string;
  readonly items: readonly PortfolioMediaRecordItem[];
  readonly limit: number;
  readonly used: number;
}

export interface CreatePortfolioMediaInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly portfolioItemId: string;
  readonly mediaAssetId: string;
  readonly staffId?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly tags: readonly string[];
  readonly bucket: string;
  readonly uploadObjectKey: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteSize: number;
  readonly uploadExpiresAt: Date;
}

export interface UpdatePortfolioMediaInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly portfolioItemId: string;
  readonly patch: {
    readonly title?: string | undefined;
    readonly description?: string | null | undefined;
    readonly staffId?: string | null | undefined;
    readonly serviceId?: string | null | undefined;
    readonly tags?: readonly string[] | undefined;
  };
}

export interface ReorderPortfolioMediaInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly portfolioItemIds: readonly string[];
}

export interface DeletePortfolioMediaInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly portfolioItemId: string;
}

export interface MediaVerificationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly bucket: string;
  readonly uploadObjectKey: string;
  readonly objectKey: string | null;
  readonly thumbnailObjectKey: string | null;
  readonly declaredMimeType: string;
  readonly declaredByteSize: number;
  readonly uploadExpiresAt: Date;
  readonly status: MediaAssetStatus;
}

export interface CompleteMediaVerificationInput {
  readonly tenantId: string;
  readonly mediaAssetId: string;
  readonly objectKey: string;
  readonly thumbnailObjectKey: string;
  readonly mimeType: 'image/webp';
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly checksum: string;
}

export type PortfolioMediaConflictCode =
  | 'entitlement_limit_reached'
  | 'entitlement_unavailable'
  | 'portfolio_not_found'
  | 'media_not_found'
  | 'media_not_pending'
  | 'related_resource_not_found'
  | 'resource_conflict'
  | 'portfolio_order_mismatch';

export class PortfolioMediaRepositoryError extends Error {
  constructor(readonly code: PortfolioMediaConflictCode) {
    super(code);
    this.name = 'PortfolioMediaRepositoryError';
  }
}

export interface PortfolioMediaRepository {
  list(tenantId: string, now: Date): Promise<PortfolioMediaRecord>;
  create(input: CreatePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord>;
  update(input: UpdatePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord>;
  reorder(input: ReorderPortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord>;
  softDelete(input: DeletePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord>;
  requirePending(tenantId: string, mediaAssetId: string): Promise<MediaVerificationRecord>;
  findForVerification(tenantId: string, mediaAssetId: string): Promise<MediaVerificationRecord>;
  markReady(input: CompleteMediaVerificationInput): Promise<void>;
  markRejected(tenantId: string, mediaAssetId: string, rejectionCode: string): Promise<void>;
}

const itemSelection = {
  id: true,
  staffId: true,
  serviceId: true,
  title: true,
  description: true,
  status: true,
  sortOrder: true,
  tags: { orderBy: { value: 'asc' as const }, select: { value: true } },
  mediaAsset: {
    select: {
      id: true,
      status: true,
      mimeType: true,
      byteSize: true,
      width: true,
      height: true,
      rejectionCode: true,
    },
  },
} as const;

const verificationSelection = {
  id: true,
  tenantId: true,
  bucket: true,
  uploadObjectKey: true,
  objectKey: true,
  thumbnailObjectKey: true,
  declaredMimeType: true,
  declaredByteSize: true,
  uploadExpiresAt: true,
  status: true,
} as const;

export class PrismaPortfolioMediaRepository implements PortfolioMediaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(tenantId: string, now: Date): Promise<PortfolioMediaRecord> {
    return readPortfolio(this.prisma, tenantId, now);
  }

  create(input: CreatePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const existing = await transaction.mediaAsset.findFirst({
        where: { tenantId: input.tenantId, id: input.mediaAssetId },
        select: {
          ownerId: true,
          bucket: true,
          uploadObjectKey: true,
          declaredMimeType: true,
          declaredByteSize: true,
          status: true,
          owner: {
            select: {
              staffId: true,
              serviceId: true,
              title: true,
              description: true,
              tags: { orderBy: { value: 'asc' }, select: { value: true } },
            },
          },
        },
      });
      if (existing !== null) {
        const expectedTags = [...input.tags].sort();
        const matches =
          existing.status === 'PENDING' &&
          existing.ownerId === input.portfolioItemId &&
          existing.bucket === input.bucket &&
          existing.uploadObjectKey === input.uploadObjectKey &&
          existing.declaredMimeType === input.mimeType &&
          existing.declaredByteSize === input.byteSize &&
          existing.owner.staffId === (input.staffId ?? null) &&
          existing.owner.serviceId === (input.serviceId ?? null) &&
          existing.owner.title === input.title &&
          existing.owner.description === (input.description ?? null) &&
          existing.owner.tags.map(({ value }) => value).join('\u0000') ===
            expectedTags.join('\u0000');
        if (!matches) throw new PortfolioMediaRepositoryError('resource_conflict');
        await transaction.mediaAsset.update({
          where: { tenantId_id: { tenantId: input.tenantId, id: input.mediaAssetId } },
          data: { uploadExpiresAt: input.uploadExpiresAt },
        });
        return readPortfolio(transaction, input.tenantId, now);
      }
      const portfolio = await readPortfolio(transaction, input.tenantId, now);
      if (portfolio.used >= portfolio.limit) {
        throw new PortfolioMediaRepositoryError('entitlement_limit_reached');
      }
      await requireRelatedResources(transaction, {
        tenantId: input.tenantId,
        ...(input.staffId === undefined ? {} : { staffId: input.staffId }),
        ...(input.serviceId === undefined ? {} : { serviceId: input.serviceId }),
      });
      const last = await transaction.portfolioItem.findFirst({
        where: { tenantId: input.tenantId, status: { not: 'DELETED' } },
        orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
        select: { sortOrder: true },
      });
      try {
        await transaction.portfolioItem.create({
          data: {
            id: input.portfolioItemId,
            tenantId: input.tenantId,
            staffId: input.staffId ?? null,
            serviceId: input.serviceId ?? null,
            title: input.title,
            description: input.description ?? null,
            sortOrder: (last?.sortOrder ?? -1) + 1,
          },
        });
        if (input.tags.length > 0) {
          await transaction.portfolioTag.createMany({
            data: input.tags.map((value) => ({
              tenantId: input.tenantId,
              portfolioItemId: input.portfolioItemId,
              value,
            })),
          });
        }
        await transaction.mediaAsset.create({
          data: {
            id: input.mediaAssetId,
            tenantId: input.tenantId,
            ownerId: input.portfolioItemId,
            bucket: input.bucket,
            uploadObjectKey: input.uploadObjectKey,
            declaredMimeType: input.mimeType,
            declaredByteSize: input.byteSize,
            uploadExpiresAt: input.uploadExpiresAt,
            createdByUserId: input.actorUserId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new PortfolioMediaRepositoryError('resource_conflict');
        }
        throw error;
      }
      await writeAudit(transaction, input, 'portfolio.created', input.portfolioItemId);
      return readPortfolio(transaction, input.tenantId, now);
    });
  }

  update(input: UpdatePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord> {
    return this.prisma.$transaction(async (transaction) => {
      await requireRelatedResources(transaction, {
        tenantId: input.tenantId,
        ...(typeof input.patch.staffId === 'string' ? { staffId: input.patch.staffId } : {}),
        ...(typeof input.patch.serviceId === 'string' ? { serviceId: input.patch.serviceId } : {}),
      });
      const result = await transaction.portfolioItem.updateMany({
        where: { tenantId: input.tenantId, id: input.portfolioItemId, status: { not: 'DELETED' } },
        data: {
          ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
          ...(input.patch.description !== undefined
            ? { description: input.patch.description }
            : {}),
          ...(input.patch.staffId !== undefined ? { staffId: input.patch.staffId } : {}),
          ...(input.patch.serviceId !== undefined ? { serviceId: input.patch.serviceId } : {}),
        },
      });
      if (result.count !== 1) throw new PortfolioMediaRepositoryError('portfolio_not_found');
      if (input.patch.tags !== undefined) {
        await transaction.portfolioTag.deleteMany({
          where: { tenantId: input.tenantId, portfolioItemId: input.portfolioItemId },
        });
        if (input.patch.tags.length > 0) {
          await transaction.portfolioTag.createMany({
            data: input.patch.tags.map((value) => ({
              tenantId: input.tenantId,
              portfolioItemId: input.portfolioItemId,
              value,
            })),
          });
        }
      }
      await writeAudit(transaction, input, 'portfolio.updated', input.portfolioItemId);
      return readPortfolio(transaction, input.tenantId, now);
    });
  }

  reorder(input: ReorderPortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const items = await transaction.portfolioItem.findMany({
        where: { tenantId: input.tenantId, status: { not: 'DELETED' } },
        select: { id: true },
      });
      const ids = new Set(items.map(({ id }) => id));
      if (
        ids.size !== input.portfolioItemIds.length ||
        input.portfolioItemIds.some((id) => !ids.has(id))
      ) {
        throw new PortfolioMediaRepositoryError('portfolio_order_mismatch');
      }
      for (const [sortOrder, id] of input.portfolioItemIds.entries()) {
        await transaction.portfolioItem.update({
          where: { tenantId_id: { tenantId: input.tenantId, id } },
          data: { sortOrder },
        });
      }
      await writeAudit(transaction, input, 'portfolio.reordered', input.tenantId);
      return readPortfolio(transaction, input.tenantId, now);
    });
  }

  softDelete(input: DeletePortfolioMediaInput, now: Date): Promise<PortfolioMediaRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.portfolioItem.updateMany({
        where: { tenantId: input.tenantId, id: input.portfolioItemId, status: { not: 'DELETED' } },
        data: { status: 'DELETED', publishedAt: null },
      });
      if (result.count !== 1) throw new PortfolioMediaRepositoryError('portfolio_not_found');
      await transaction.mediaAsset.updateMany({
        where: { tenantId: input.tenantId, ownerId: input.portfolioItemId },
        data: { status: 'DELETED' },
      });
      await writeAudit(transaction, input, 'portfolio.deleted', input.portfolioItemId);
      return readPortfolio(transaction, input.tenantId, now);
    });
  }

  async requirePending(tenantId: string, mediaAssetId: string): Promise<MediaVerificationRecord> {
    const record = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: mediaAssetId },
      select: verificationSelection,
    });
    if (record === null) throw new PortfolioMediaRepositoryError('media_not_found');
    if (record.status !== 'PENDING') throw new PortfolioMediaRepositoryError('media_not_pending');
    return record;
  }

  async findForVerification(
    tenantId: string,
    mediaAssetId: string,
  ): Promise<MediaVerificationRecord> {
    const record = await this.prisma.mediaAsset.findFirst({
      where: { tenantId, id: mediaAssetId },
      select: verificationSelection,
    });
    if (record === null) throw new PortfolioMediaRepositoryError('media_not_found');
    return record;
  }

  async markReady(input: CompleteMediaVerificationInput): Promise<void> {
    await this.withSerializableRetry(async (transaction) => {
      const tenant = await transaction.tenant.findUnique({
        where: { id: input.tenantId },
        select: {
          plan: {
            select: {
              entitlements: {
                where: { entitlementCode },
                select: { valueJson: true },
              },
            },
          },
        },
      });
      const limit = tenant?.plan?.entitlements[0]?.valueJson;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
        throw new PortfolioMediaRepositoryError('entitlement_unavailable');
      }
      const usedByOtherAssets = await transaction.mediaAsset.count({
        where: {
          tenantId: input.tenantId,
          id: { not: input.mediaAssetId },
          OR: [{ status: 'READY' }, { status: 'PENDING', uploadExpiresAt: { gt: new Date() } }],
        },
      });
      if (usedByOtherAssets >= limit) {
        throw new PortfolioMediaRepositoryError('entitlement_limit_reached');
      }
      const result = await transaction.mediaAsset.updateMany({
        where: { tenantId: input.tenantId, id: input.mediaAssetId, status: 'PENDING' },
        data: {
          status: 'READY',
          objectKey: input.objectKey,
          thumbnailObjectKey: input.thumbnailObjectKey,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          checksum: input.checksum,
          rejectionCode: null,
        },
      });
      if (result.count !== 1) throw new PortfolioMediaRepositoryError('media_not_pending');
    });
  }

  async markRejected(tenantId: string, mediaAssetId: string, rejectionCode: string): Promise<void> {
    const result = await this.prisma.mediaAsset.updateMany({
      where: { tenantId, id: mediaAssetId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionCode },
    });
    if (result.count !== 1) throw new PortfolioMediaRepositoryError('media_not_pending');
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
        const retry =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!retry || attempt === 2) throw error;
      }
    }
    throw new Error('unreachable serializable retry state');
  }
}

async function readPortfolio(
  client: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  now: Date,
): Promise<PortfolioMediaRecord> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: {
        select: {
          entitlements: {
            where: { entitlementCode },
            select: { valueJson: true },
          },
        },
      },
      portfolioItems: {
        where: { status: { not: 'DELETED' } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: itemSelection,
      },
      mediaAssets: {
        where: {
          OR: [{ status: 'READY' }, { status: 'PENDING', uploadExpiresAt: { gt: now } }],
        },
        select: { id: true },
      },
    },
  });
  if (tenant === null) throw new PortfolioMediaRepositoryError('entitlement_unavailable');
  const limit = tenant.plan?.entitlements[0]?.valueJson;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new PortfolioMediaRepositoryError('entitlement_unavailable');
  }
  return {
    tenantId,
    limit,
    used: tenant.mediaAssets.length,
    items: tenant.portfolioItems.flatMap((item) => {
      const media = item.mediaAsset;
      if (item.status === 'DELETED' || media === null) return [];
      const mediaStatus = media.status;
      if (mediaStatus === 'DELETED') return [];
      return [
        {
          id: item.id,
          staffId: item.staffId,
          serviceId: item.serviceId,
          title: item.title,
          description: item.description,
          tags: item.tags.map(({ value }) => value),
          status: item.status,
          sortOrder: item.sortOrder,
          media: { ...media, status: mediaStatus },
        },
      ];
    }),
  };
}

async function requireRelatedResources(
  transaction: Prisma.TransactionClient,
  input: {
    readonly tenantId: string;
    readonly staffId?: string | undefined;
    readonly serviceId?: string | undefined;
  },
): Promise<void> {
  const [staff, service] = await Promise.all([
    input.staffId === undefined
      ? Promise.resolve(true)
      : transaction.staffProfile
          .count({ where: { tenantId: input.tenantId, id: input.staffId } })
          .then((count) => count === 1),
    input.serviceId === undefined
      ? Promise.resolve(true)
      : transaction.service
          .count({ where: { tenantId: input.tenantId, id: input.serviceId } })
          .then((count) => count === 1),
  ]);
  if (!staff || !service) throw new PortfolioMediaRepositoryError('related_resource_not_found');
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
      resourceType: 'portfolio_item',
      resourceId,
      requestId: input.requestId,
    },
  });
}
