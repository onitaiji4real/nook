import {
  type MerchantCategory,
  type MerchantVerificationStatus,
  type MerchantVisibilityStatus,
  type LocationStatus,
  Prisma,
  type PrismaClient,
  type ServicePriceType,
  type ServiceStatus,
} from '@prisma/client';

export interface SaveMerchantOnboardingInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly profile: {
    readonly category: MerchantCategory;
    readonly description?: string | undefined;
    readonly phone?: string | undefined;
    readonly lineOaUrl?: string | undefined;
    readonly instagramUrl?: string | undefined;
    readonly bookingPolicy?: string | undefined;
    readonly cancellationPolicy?: string | undefined;
  };
  readonly location: {
    readonly id: string;
    readonly name: string;
    readonly addressText: string;
    readonly postalCode?: string | undefined;
    readonly city: string;
    readonly district: string;
    readonly isPublicAddress: boolean;
  };
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly description?: string | undefined;
    readonly durationMinutes: number;
    readonly bufferBeforeMinutes: number;
    readonly bufferAfterMinutes: number;
    readonly priceType: ServicePriceType;
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly bookingEnabled: boolean;
  };
}

export interface MerchantOnboardingRecord {
  readonly tenantId: string;
  readonly category: MerchantCategory;
  readonly description: string | null;
  readonly phone: string | null;
  readonly lineOaUrl: string | null;
  readonly instagramUrl: string | null;
  readonly bookingPolicy: string | null;
  readonly cancellationPolicy: string | null;
  readonly visibilityStatus: MerchantVisibilityStatus;
  readonly verificationStatus: MerchantVerificationStatus;
  readonly primaryLocation: {
    readonly id: string;
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
    readonly timezone: string;
    readonly isPublicAddress: boolean;
    readonly status: LocationStatus;
  };
  readonly starterService: {
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
  };
}

export interface MerchantOnboardingRepository {
  save(input: SaveMerchantOnboardingInput): Promise<MerchantOnboardingRecord>;
  findByTenantId(tenantId: string): Promise<MerchantOnboardingRecord | null>;
}

export function isMerchantOnboardingResourceConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const onboardingSelection = {
  tenantId: true,
  category: true,
  description: true,
  phone: true,
  lineOaUrl: true,
  instagramUrl: true,
  bookingPolicy: true,
  cancellationPolicy: true,
  visibilityStatus: true,
  verificationStatus: true,
  primaryLocation: {
    select: {
      id: true,
      name: true,
      addressText: true,
      postalCode: true,
      city: true,
      district: true,
      timezone: true,
      isPublicAddress: true,
      status: true,
    },
  },
  starterService: {
    select: {
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
    },
  },
} as const;

export class PrismaMerchantOnboardingRepository implements MerchantOnboardingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: SaveMerchantOnboardingInput): Promise<MerchantOnboardingRecord> {
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.merchantProfile.upsert({
        where: { tenantId: input.tenantId },
        create: {
          tenantId: input.tenantId,
          category: input.profile.category,
          description: input.profile.description ?? null,
          phone: input.profile.phone ?? null,
          lineOaUrl: input.profile.lineOaUrl ?? null,
          instagramUrl: input.profile.instagramUrl ?? null,
          bookingPolicy: input.profile.bookingPolicy ?? null,
          cancellationPolicy: input.profile.cancellationPolicy ?? null,
        },
        update: {
          category: input.profile.category,
          description: input.profile.description ?? null,
          phone: input.profile.phone ?? null,
          lineOaUrl: input.profile.lineOaUrl ?? null,
          instagramUrl: input.profile.instagramUrl ?? null,
          bookingPolicy: input.profile.bookingPolicy ?? null,
          cancellationPolicy: input.profile.cancellationPolicy ?? null,
        },
      });

      await transaction.location.upsert({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.location.id } },
        create: {
          id: input.location.id,
          tenantId: input.tenantId,
          name: input.location.name,
          addressText: input.location.addressText,
          postalCode: input.location.postalCode ?? null,
          city: input.location.city,
          district: input.location.district,
          timezone: 'Asia/Taipei',
          isPublicAddress: input.location.isPublicAddress,
        },
        update: {
          name: input.location.name,
          addressText: input.location.addressText,
          postalCode: input.location.postalCode ?? null,
          city: input.location.city,
          district: input.location.district,
          timezone: 'Asia/Taipei',
          isPublicAddress: input.location.isPublicAddress,
          status: 'ACTIVE',
        },
      });

      await transaction.service.upsert({
        where: { tenantId_id: { tenantId: input.tenantId, id: input.service.id } },
        create: {
          id: input.service.id,
          tenantId: input.tenantId,
          name: input.service.name,
          description: input.service.description ?? null,
          durationMinutes: input.service.durationMinutes,
          bufferBeforeMinutes: input.service.bufferBeforeMinutes,
          bufferAfterMinutes: input.service.bufferAfterMinutes,
          priceType: input.service.priceType,
          priceAmount: input.service.priceAmount,
          priceMin: input.service.priceMin,
          priceMax: input.service.priceMax,
          currency: 'TWD',
          bookingEnabled: input.service.bookingEnabled,
        },
        update: {
          name: input.service.name,
          description: input.service.description ?? null,
          durationMinutes: input.service.durationMinutes,
          bufferBeforeMinutes: input.service.bufferBeforeMinutes,
          bufferAfterMinutes: input.service.bufferAfterMinutes,
          priceType: input.service.priceType,
          priceAmount: input.service.priceAmount,
          priceMin: input.service.priceMin,
          priceMax: input.service.priceMax,
          currency: 'TWD',
          bookingEnabled: input.service.bookingEnabled,
          status: 'ACTIVE',
        },
      });

      const aggregate = await transaction.merchantProfile.update({
        where: { tenantId: input.tenantId },
        data: {
          primaryLocationId: input.location.id,
          starterServiceId: input.service.id,
        },
        select: onboardingSelection,
      });

      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'merchant.onboarding.saved',
          resourceType: 'merchant_profile',
          resourceId: input.tenantId,
          requestId: input.requestId,
        },
      });

      return aggregate;
    });

    return requireCompleteOnboarding(record);
  }

  async findByTenantId(tenantId: string): Promise<MerchantOnboardingRecord | null> {
    const record = await this.prisma.merchantProfile.findUnique({
      where: { tenantId },
      select: onboardingSelection,
    });

    return record === null ? null : requireCompleteOnboarding(record);
  }
}

function requireCompleteOnboarding(
  record: Omit<MerchantOnboardingRecord, 'primaryLocation' | 'starterService'> & {
    readonly primaryLocation: MerchantOnboardingRecord['primaryLocation'] | null;
    readonly starterService: MerchantOnboardingRecord['starterService'] | null;
  },
): MerchantOnboardingRecord {
  if (record.primaryLocation === null || record.starterService === null) {
    throw new Error('merchant onboarding aggregate is incomplete');
  }

  return {
    ...record,
    primaryLocation: record.primaryLocation,
    starterService: record.starterService,
  };
}
