import { Inject, Injectable } from '@nestjs/common';
import type {
  MerchantPublicationResponse,
  MerchantVisibilityRequest,
  PortfolioPublicationRequest,
  PublicMerchantResponse,
  PublicationReadinessItem,
} from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  MerchantPublicationRepositoryError,
  type MerchantPublicationRecord,
  type MerchantPublicationRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { ApplicationError } from '../../application-error';
import { RUNTIME_CONFIG } from '../../runtime-config.token';
import { TENANT_REPOSITORY } from '../../tenant-repository.token';
import type { MarketplaceMediaSigner } from './marketplace-media-signer';
import { MARKETPLACE_MEDIA_SIGNER, MERCHANT_PUBLICATION_REPOSITORY } from './marketplace.tokens';

type RequestContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
};

const readinessMetadata = {
  PROFILE_CONTENT: ['完成商家介紹與預約政策', '/studio/profile'],
  ACTIVE_LOCATION: ['設定有效服務地點', '/studio/profile'],
  ACTIVE_SERVICE: ['啟用至少一項可預約服務', '/studio/services'],
  ACTIVE_STAFF: ['啟用至少一位具服務資格的人員', '/studio/staff'],
  WEEKLY_AVAILABILITY: ['設定至少一段週間營業時段', '/studio/staff'],
  PUBLISHED_PORTFOLIO: ['發布至少一張已完成處理的作品', '/studio/portfolio'],
} as const;

@Injectable()
export class MerchantPublicationApplicationService {
  constructor(
    @Inject(MERCHANT_PUBLICATION_REPOSITORY)
    private readonly repository: MerchantPublicationRepository,
    @Inject(MARKETPLACE_MEDIA_SIGNER) private readonly mediaSigner: MarketplaceMediaSigner,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async get(input: RequestContext): Promise<MerchantPublicationResponse> {
    await this.requireMember(input);
    return toPublicationResponse(await this.execute(() => this.repository.get(input.tenantId)));
  }

  async changeVisibility(
    input: RequestContext & { readonly body: MerchantVisibilityRequest },
  ): Promise<MerchantPublicationResponse> {
    await this.requireManager(input);
    const record = await this.execute(() =>
      this.repository.changeVisibility({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        visibilityStatus: input.body.visibilityStatus,
      }),
    );
    this.log('merchant.publication_status_changed', input, 'success');
    return toPublicationResponse(record);
  }

  async changePortfolioStatus(
    input: RequestContext & {
      readonly portfolioItemId: string;
      readonly body: PortfolioPublicationRequest;
    },
  ): Promise<MerchantPublicationResponse> {
    await this.requireManager(input);
    const record = await this.execute(() =>
      this.repository.changePortfolioStatus({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        portfolioItemId: input.portfolioItemId,
        status: input.body.status,
      }),
    );
    this.log('portfolio.publication_status_changed', input, 'success');
    return toPublicationResponse(record);
  }

  async findPublic(slug: string): Promise<PublicMerchantResponse> {
    const record = await this.repository.findPublishedBySlug(slug);
    if (record === null) {
      throw new ApplicationError(
        404,
        'merchant_not_found',
        'Not Found',
        'The merchant is not published.',
      );
    }
    let images: readonly { imageUrl: string; thumbnailUrl: string }[];
    try {
      images = await Promise.all(
        record.portfolio.map(async ({ bucket, objectKey, thumbnailObjectKey }) => ({
          imageUrl: await this.mediaSigner.sign({ bucket, objectKey }),
          thumbnailUrl: await this.mediaSigner.sign({ bucket, objectKey: thumbnailObjectKey }),
        })),
      );
    } catch {
      throw new ApplicationError(
        503,
        'merchant_media_unavailable',
        'Service Unavailable',
        'Merchant images are temporarily unavailable.',
      );
    }
    return {
      slug: record.slug,
      name: record.name,
      category: record.category,
      description: record.description,
      verificationStatus: record.verificationStatus,
      publishedAt: record.publishedAt.toISOString(),
      contact: { lineOaUrl: record.lineOaUrl, instagramUrl: record.instagramUrl },
      location: record.location.isPublicAddress
        ? {
            disclosure: 'FULL',
            name: record.location.name,
            address: record.location.addressText,
            postalCode: record.location.postalCode,
            city: record.location.city,
            district: record.location.district,
            timezone: 'Asia/Taipei',
          }
        : {
            disclosure: 'DISTRICT_ONLY',
            name: null,
            address: null,
            postalCode: null,
            city: record.location.city,
            district: record.location.district,
            timezone: 'Asia/Taipei',
          },
      services: record.services.map((service) => ({ ...service, currency: 'TWD' })),
      staff: record.staff,
      weeklyHours: uniqueHours(record.weeklyHours),
      portfolio: record.portfolio.map((item, index) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        tags: item.tags,
        ...images[index]!,
      })),
      policies: { booking: record.bookingPolicy, cancellation: record.cancellationPolicy },
      bookingAvailability: 'CANDIDATE_SLOTS',
    };
  }

  private async requireMember(input: RequestContext): Promise<TenantMembershipRecord> {
    const membership = await this.tenants.findActiveTenantMembership(input);
    if (membership !== null) return membership;
    await this.tenants.recordAuthorizationDeniedIfTenantExists({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      requestId: input.requestId,
    });
    this.log('authorization.denied', input, 'denied');
    throw new ApplicationError(
      403,
      'tenant_access_denied',
      'Forbidden',
      'Tenant access is denied.',
    );
  }

  private async requireManager(input: RequestContext): Promise<void> {
    const membership = await this.requireMember(input);
    if (membership.membership.role === 'OWNER' || membership.membership.role === 'MANAGER') return;
    await this.tenants.recordAuthorizationDeniedIfTenantExists({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      requestId: input.requestId,
    });
    this.log('authorization.denied', input, 'denied');
    throw new ApplicationError(
      403,
      'publication_write_denied',
      'Forbidden',
      'Publication access is denied.',
    );
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof MerchantPublicationRepositoryError)) throw error;
      const mapping = {
        publication_not_found: [
          404,
          'publication_not_found',
          'Publication settings were not found.',
        ],
        publication_not_ready: [
          409,
          'publication_not_ready',
          'Complete every readiness item before publishing.',
        ],
        publication_suspended: [
          409,
          'publication_suspended',
          'A suspended page cannot be changed.',
        ],
        portfolio_not_found: [404, 'portfolio_not_found', 'The portfolio item was not found.'],
        portfolio_media_not_ready: [
          409,
          'portfolio_media_not_ready',
          'Only a ready image can be published.',
        ],
      } as const;
      const [status, code, detail] = mapping[error.code];
      throw new ApplicationError(status, code, status === 404 ? 'Not Found' : 'Conflict', detail);
    }
  }

  private log(
    event:
      | 'authorization.denied'
      | 'merchant.publication_status_changed'
      | 'portfolio.publication_status_changed',
    input: RequestContext,
    outcome: 'success' | 'denied',
  ): void {
    process.stdout.write(
      `${JSON.stringify(
        redactValue(
          createSecurityEventLog({
            event,
            requestId: input.requestId,
            actorUserId: input.userId,
            tenantId: input.tenantId,
            outcome,
            version: this.config.appVersion,
            environment: this.config.nodeEnv,
          }),
        ),
      )}\n`,
    );
  }
}

function toPublicationResponse(record: MerchantPublicationRecord): MerchantPublicationResponse {
  const readiness: PublicationReadinessItem[] = Object.entries(record.readiness).map(
    ([code, ready]) => ({
      code: code as keyof typeof readinessMetadata,
      ready,
      label: readinessMetadata[code as keyof typeof readinessMetadata][0],
      actionPath: readinessMetadata[code as keyof typeof readinessMetadata][1],
    }),
  );
  return {
    tenantId: record.tenantId,
    slug: record.slug,
    visibilityStatus: record.visibilityStatus,
    verificationStatus: record.verificationStatus,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    publicPath: `/m/${record.slug}`,
    readyToPublish: readiness.every(({ ready }) => ready),
    readiness,
  };
}

function uniqueHours(
  hours: readonly { readonly weekday: number; readonly startTime: Date; readonly endTime: Date }[],
): readonly { readonly weekday: number; readonly startTime: string; readonly endTime: string }[] {
  const seen = new Set<string>();
  return hours.flatMap(({ weekday, startTime, endTime }) => {
    const value = {
      weekday,
      startTime: timeValue(startTime),
      endTime: timeValue(endTime),
    };
    const key = `${value.weekday}:${value.startTime}:${value.endTime}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function timeValue(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}
