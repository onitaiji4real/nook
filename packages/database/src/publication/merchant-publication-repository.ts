import { Prisma, type PrismaClient } from '@prisma/client';

export type PublicationReadinessCode =
  | 'PROFILE_CONTENT'
  | 'ACTIVE_LOCATION'
  | 'ACTIVE_SERVICE'
  | 'ACTIVE_STAFF'
  | 'WEEKLY_AVAILABILITY'
  | 'PUBLISHED_PORTFOLIO';

export interface MerchantPublicationRecord {
  readonly tenantId: string;
  readonly slug: string;
  readonly visibilityStatus: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
  readonly verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  readonly publishedAt: Date | null;
  readonly readiness: Readonly<Record<PublicationReadinessCode, boolean>>;
}

export interface PublicMerchantRecord {
  readonly slug: string;
  readonly name: string;
  readonly category: 'NAIL' | 'LASH' | 'BROW' | 'BEAUTY' | 'HAIR' | 'OTHER';
  readonly description: string;
  readonly verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
  readonly publishedAt: Date;
  readonly lineOaUrl: string | null;
  readonly instagramUrl: string | null;
  readonly bookingPolicy: string;
  readonly cancellationPolicy: string;
  readonly location: {
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
    readonly timezone: string;
    readonly isPublicAddress: boolean;
  };
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly durationMinutes: number;
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: string;
  }[];
  readonly staff: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly bio: string | null;
    readonly serviceIds: readonly string[];
  }[];
  readonly weeklyHours: readonly {
    readonly weekday: number;
    readonly startTime: Date;
    readonly endTime: Date;
  }[];
  readonly portfolio: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly tags: readonly string[];
    readonly bucket: string;
    readonly objectKey: string;
    readonly thumbnailObjectKey: string;
  }[];
}

export type MerchantPublicationConflictCode =
  | 'publication_not_found'
  | 'publication_not_ready'
  | 'publication_suspended'
  | 'portfolio_not_found'
  | 'portfolio_media_not_ready';

export class MerchantPublicationRepositoryError extends Error {
  constructor(readonly code: MerchantPublicationConflictCode) {
    super(code);
    this.name = 'MerchantPublicationRepositoryError';
  }
}

export interface MerchantPublicationRepository {
  get(tenantId: string): Promise<MerchantPublicationRecord>;
  changeVisibility(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly visibilityStatus: 'DRAFT' | 'PUBLISHED';
  }): Promise<MerchantPublicationRecord>;
  changePortfolioStatus(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly portfolioItemId: string;
    readonly status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  }): Promise<MerchantPublicationRecord>;
  findPublishedBySlug(slug: string): Promise<PublicMerchantRecord | null>;
}

export class PrismaMerchantPublicationRepository implements MerchantPublicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  get(tenantId: string): Promise<MerchantPublicationRecord> {
    return readPublication(this.prisma, tenantId);
  }

  changeVisibility(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly visibilityStatus: 'DRAFT' | 'PUBLISHED';
  }): Promise<MerchantPublicationRecord> {
    return this.withSerializableRetry(async (transaction) => {
      const current = await readPublication(transaction, input.tenantId);
      if (current.visibilityStatus === 'SUSPENDED') {
        throw new MerchantPublicationRepositoryError('publication_suspended');
      }
      if (
        input.visibilityStatus === 'PUBLISHED' &&
        !Object.values(current.readiness).every(Boolean)
      ) {
        throw new MerchantPublicationRepositoryError('publication_not_ready');
      }
      await transaction.merchantProfile.update({
        where: { tenantId: input.tenantId },
        data: {
          visibilityStatus: input.visibilityStatus,
          publishedAt: input.visibilityStatus === 'PUBLISHED' ? new Date() : null,
        },
      });
      await writeAudit(transaction, input, 'merchant.publication_status_changed', input.tenantId);
      return readPublication(transaction, input.tenantId);
    });
  }

  changePortfolioStatus(input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly portfolioItemId: string;
    readonly status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  }): Promise<MerchantPublicationRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.portfolioItem.findFirst({
        where: { tenantId: input.tenantId, id: input.portfolioItemId, status: { not: 'DELETED' } },
        select: { mediaAsset: { select: { status: true } } },
      });
      if (item === null) throw new MerchantPublicationRepositoryError('portfolio_not_found');
      if (input.status === 'PUBLISHED' && item.mediaAsset?.status !== 'READY') {
        throw new MerchantPublicationRepositoryError('portfolio_media_not_ready');
      }
      await transaction.portfolioItem.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.portfolioItemId } },
        data: {
          status: input.status,
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        },
      });
      await writeAudit(
        transaction,
        input,
        'portfolio.publication_status_changed',
        input.portfolioItemId,
      );
      return readPublication(transaction, input.tenantId);
    });
  }

  async findPublishedBySlug(slug: string): Promise<PublicMerchantRecord | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        slug,
        status: 'ACTIVE',
        merchantProfile: { is: { visibilityStatus: 'PUBLISHED', publishedAt: { not: null } } },
      },
      select: {
        name: true,
        slug: true,
        merchantProfile: {
          select: {
            category: true,
            description: true,
            lineOaUrl: true,
            instagramUrl: true,
            bookingPolicy: true,
            cancellationPolicy: true,
            verificationStatus: true,
            publishedAt: true,
            primaryLocation: {
              select: {
                name: true,
                addressText: true,
                postalCode: true,
                city: true,
                district: true,
                timezone: true,
                isPublicAddress: true,
              },
            },
          },
        },
        services: {
          where: { status: 'ACTIVE', bookingEnabled: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            durationMinutes: true,
            priceType: true,
            priceAmount: true,
            priceMin: true,
            priceMax: true,
            currency: true,
          },
        },
        staffProfiles: {
          where: { status: 'ACTIVE', bookingEnabled: true, location: { status: 'ACTIVE' } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            displayName: true,
            bio: true,
            services: {
              where: { service: { status: 'ACTIVE', bookingEnabled: true } },
              select: { serviceId: true },
            },
            weeklyRules: {
              orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
              select: { weekday: true, startTime: true, endTime: true },
            },
          },
        },
        portfolioItems: {
          where: { status: 'PUBLISHED', mediaAsset: { is: { status: 'READY' } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            title: true,
            description: true,
            tags: { orderBy: { value: 'asc' }, select: { value: true } },
            mediaAsset: {
              select: { bucket: true, objectKey: true, thumbnailObjectKey: true },
            },
          },
        },
      },
    });
    if (tenant === null || tenant.merchantProfile === null) return null;
    const profile = tenant.merchantProfile;
    const location = profile.primaryLocation;
    if (
      location === null ||
      profile.description === null ||
      profile.bookingPolicy === null ||
      profile.cancellationPolicy === null ||
      profile.publishedAt === null ||
      profile.verificationStatus === 'REJECTED'
    ) {
      return null;
    }
    const portfolio = tenant.portfolioItems.flatMap((item) => {
      const media = item.mediaAsset;
      if (media?.objectKey === null || media?.thumbnailObjectKey === null || media === null)
        return [];
      return [
        {
          id: item.id,
          title: item.title,
          description: item.description,
          tags: item.tags.map(({ value }) => value),
          bucket: media.bucket,
          objectKey: media.objectKey,
          thumbnailObjectKey: media.thumbnailObjectKey,
        },
      ];
    });
    return {
      slug: tenant.slug,
      name: tenant.name,
      category: profile.category,
      description: profile.description,
      verificationStatus: profile.verificationStatus,
      publishedAt: profile.publishedAt,
      lineOaUrl: profile.lineOaUrl,
      instagramUrl: profile.instagramUrl,
      bookingPolicy: profile.bookingPolicy,
      cancellationPolicy: profile.cancellationPolicy,
      location,
      services: tenant.services,
      staff: tenant.staffProfiles.map((staff) => ({
        id: staff.id,
        displayName: staff.displayName,
        bio: staff.bio,
        serviceIds: staff.services.map(({ serviceId }) => serviceId),
      })),
      weeklyHours: tenant.staffProfiles.flatMap(({ weeklyRules }) => weeklyRules),
      portfolio,
    };
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

async function readPublication(
  client: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
): Promise<MerchantPublicationRecord> {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      slug: true,
      status: true,
      merchantProfile: {
        select: {
          description: true,
          bookingPolicy: true,
          cancellationPolicy: true,
          visibilityStatus: true,
          verificationStatus: true,
          publishedAt: true,
          primaryLocation: { select: { status: true, city: true, district: true } },
        },
      },
      services: {
        where: { status: 'ACTIVE', bookingEnabled: true },
        select: { id: true },
      },
      staffProfiles: {
        where: { status: 'ACTIVE', bookingEnabled: true, location: { status: 'ACTIVE' } },
        select: {
          services: {
            where: { service: { status: 'ACTIVE', bookingEnabled: true } },
            select: { serviceId: true },
          },
          weeklyRules: { select: { id: true } },
        },
      },
      portfolioItems: {
        where: { status: 'PUBLISHED', mediaAsset: { is: { status: 'READY' } } },
        select: { id: true },
      },
    },
  });
  if (tenant === null || tenant.merchantProfile === null) {
    throw new MerchantPublicationRepositoryError('publication_not_found');
  }
  const profile = tenant.merchantProfile;
  const eligibleStaff = tenant.staffProfiles.filter(({ services }) => services.length > 0);
  return {
    tenantId,
    slug: tenant.slug,
    visibilityStatus: profile.visibilityStatus,
    verificationStatus: profile.verificationStatus,
    publishedAt: profile.publishedAt,
    readiness: {
      PROFILE_CONTENT:
        tenant.status === 'ACTIVE' &&
        profile.verificationStatus !== 'REJECTED' &&
        hasText(profile.description) &&
        hasText(profile.bookingPolicy) &&
        hasText(profile.cancellationPolicy),
      ACTIVE_LOCATION:
        profile.primaryLocation?.status === 'ACTIVE' &&
        hasText(profile.primaryLocation.city) &&
        hasText(profile.primaryLocation.district),
      ACTIVE_SERVICE: tenant.services.length > 0,
      ACTIVE_STAFF: eligibleStaff.length > 0,
      WEEKLY_AVAILABILITY: eligibleStaff.some(({ weeklyRules }) => weeklyRules.length > 0),
      PUBLISHED_PORTFOLIO: tenant.portfolioItems.length > 0,
    },
  };
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
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
      resourceType: 'merchant_publication',
      resourceId,
      requestId: input.requestId,
    },
  });
}
