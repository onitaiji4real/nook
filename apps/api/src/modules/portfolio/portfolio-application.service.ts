import { Inject, Injectable } from '@nestjs/common';
import type {
  CreatePortfolioUploadIntentRequest,
  PortfolioItemResponse,
  PortfolioResponse,
  PortfolioUploadCompleteResponse,
  PortfolioUploadIntentResponse,
  ReorderPortfolioItemsRequest,
  UpdatePortfolioItemRequest,
} from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  PortfolioMediaRepositoryError,
  type PortfolioMediaRecord,
  type PortfolioMediaRecordItem,
  type PortfolioMediaRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../platform/identity/tenant-repository.token';
import {
  MediaGatewayUnavailableError,
  type MediaUploadSigner,
  type MediaVerificationQueue,
} from './media-gateways';
import {
  MEDIA_UPLOAD_SIGNER,
  MEDIA_VERIFICATION_QUEUE,
  PORTFOLIO_MEDIA_REPOSITORY,
} from './portfolio.tokens';

type RequestContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
};

@Injectable()
export class PortfolioApplicationService {
  constructor(
    @Inject(PORTFOLIO_MEDIA_REPOSITORY) private readonly repository: PortfolioMediaRepository,
    @Inject(MEDIA_UPLOAD_SIGNER) private readonly signer: MediaUploadSigner,
    @Inject(MEDIA_VERIFICATION_QUEUE) private readonly queue: MediaVerificationQueue,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async list(input: RequestContext): Promise<PortfolioResponse> {
    await this.requireMember(input);
    return toResponse(await this.execute(() => this.repository.list(input.tenantId, new Date())));
  }

  async createUploadIntent(
    input: RequestContext & { readonly body: CreatePortfolioUploadIntentRequest },
  ): Promise<PortfolioUploadIntentResponse> {
    await this.requireUploader(input);
    const mediaConfig = this.requireMediaConfig();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const objectKey = uploadObjectKey(input.tenantId, input.body.mediaAssetId);
    const record = await this.execute(() =>
      this.repository.create(
        {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          requestId: input.requestId,
          ...input.body,
          bucket: mediaConfig.bucket,
          uploadObjectKey: objectKey,
          uploadExpiresAt: expiresAt,
        },
        new Date(),
      ),
    );
    try {
      const policy = await this.signer.sign({
        bucket: mediaConfig.bucket,
        objectKey,
        mimeType: input.body.mimeType,
        expiresAt,
      });
      this.log('portfolio.upload_intent_created', input, 'success');
      return {
        portfolio: toResponse(record),
        upload: {
          mediaAssetId: input.body.mediaAssetId,
          ...policy,
          expiresAt: expiresAt.toISOString(),
          maxBytes: 15_728_640,
        },
      };
    } catch (error) {
      throw mediaUnavailable(error);
    }
  }

  async completeUpload(
    input: RequestContext & { readonly mediaAssetId: string },
  ): Promise<PortfolioUploadCompleteResponse> {
    await this.requireUploader(input);
    this.requireMediaConfig();
    await this.execute(() => this.repository.requirePending(input.tenantId, input.mediaAssetId));
    try {
      await this.queue.enqueue({ tenantId: input.tenantId, mediaAssetId: input.mediaAssetId });
    } catch (error) {
      throw mediaUnavailable(error);
    }
    this.log('portfolio.upload_completed', input, 'success');
    return { mediaAssetId: input.mediaAssetId, status: 'PENDING' };
  }

  async update(
    input: RequestContext & {
      readonly portfolioItemId: string;
      readonly body: UpdatePortfolioItemRequest;
    },
  ): Promise<PortfolioResponse> {
    await this.requireUploader(input);
    const record = await this.execute(() =>
      this.repository.update(
        {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          requestId: input.requestId,
          portfolioItemId: input.portfolioItemId,
          patch: input.body,
        },
        new Date(),
      ),
    );
    this.log('portfolio.updated', input, 'success');
    return toResponse(record);
  }

  async reorder(
    input: RequestContext & { readonly body: ReorderPortfolioItemsRequest },
  ): Promise<PortfolioResponse> {
    await this.requireUploader(input);
    const record = await this.execute(() =>
      this.repository.reorder(
        {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          requestId: input.requestId,
          portfolioItemIds: input.body.portfolioItemIds,
        },
        new Date(),
      ),
    );
    this.log('portfolio.reordered', input, 'success');
    return toResponse(record);
  }

  async remove(
    input: RequestContext & { readonly portfolioItemId: string },
  ): Promise<PortfolioResponse> {
    await this.requireUploader(input);
    const record = await this.execute(() =>
      this.repository.softDelete(
        {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          requestId: input.requestId,
          portfolioItemId: input.portfolioItemId,
        },
        new Date(),
      ),
    );
    this.log('portfolio.deleted', input, 'success');
    return toResponse(record);
  }

  private requireMediaConfig(): Extract<RuntimeConfig['media'], { mode: 'gcp' }> {
    if (this.config.media.mode === 'disabled') {
      throw new ApplicationError(
        503,
        'media_upload_unavailable',
        'Service Unavailable',
        'Controlled media upload is not configured.',
      );
    }
    return this.config.media;
  }

  private async requireUploader(input: RequestContext): Promise<void> {
    const membership = await this.requireMember(input);
    if (!['OWNER', 'MANAGER', 'STAFF'].includes(membership.membership.role)) {
      await this.deny(input);
    }
  }

  private async requireMember(input: RequestContext): Promise<TenantMembershipRecord> {
    const membership = await this.tenants.findActiveTenantMembership({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (membership === null) return this.deny(input);
    return membership;
  }

  private async deny(input: RequestContext): Promise<never> {
    await this.tenants.recordAuthorizationDeniedIfTenantExists({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      requestId: input.requestId,
    });
    this.log('authorization.denied', input, 'denied');
    throw new ApplicationError(403, 'tenant_access_denied', 'Forbidden', 'Access is denied.');
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof PortfolioMediaRepositoryError)) throw error;
      const mapping: Record<
        typeof error.code,
        readonly [400 | 403 | 404 | 409 | 503, string, string]
      > = {
        entitlement_limit_reached: [403, 'portfolio_limit_reached', 'Portfolio limit reached.'],
        entitlement_unavailable: [
          503,
          'portfolio_entitlement_unavailable',
          'Entitlement unavailable.',
        ],
        portfolio_not_found: [404, 'portfolio_not_found', 'Portfolio item not found.'],
        media_not_found: [404, 'media_not_found', 'Media asset not found.'],
        media_not_pending: [409, 'media_not_pending', 'Media asset is not pending.'],
        related_resource_not_found: [
          409,
          'portfolio_relation_invalid',
          'Related resource is invalid.',
        ],
        resource_conflict: [409, 'portfolio_resource_conflict', 'Resource ID is already in use.'],
        portfolio_order_mismatch: [
          409,
          'portfolio_order_mismatch',
          'Portfolio order is incomplete.',
        ],
      };
      const [status, code, detail] = mapping[error.code];
      throw new ApplicationError(status, code, status === 404 ? 'Not Found' : 'Conflict', detail);
    }
  }

  private log(
    event: Parameters<typeof createSecurityEventLog>[0]['event'],
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

export function uploadObjectKey(tenantId: string, mediaAssetId: string): string {
  return `tenants/${tenantId}/portfolio/${mediaAssetId}/upload`;
}

function toResponse(record: PortfolioMediaRecord): PortfolioResponse {
  return {
    tenantId: record.tenantId,
    items: record.items.map(toItem),
    entitlement: {
      code: 'MAX_PORTFOLIO_IMAGES',
      limit: record.limit,
      used: record.used,
      remaining: Math.max(0, record.limit - record.used),
    },
  };
}

function toItem(item: PortfolioMediaRecordItem): PortfolioItemResponse {
  return item;
}

function mediaUnavailable(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (error instanceof MediaGatewayUnavailableError || error instanceof Error) {
    return new ApplicationError(
      503,
      'media_upload_unavailable',
      'Service Unavailable',
      'Controlled media upload is temporarily unavailable.',
    );
  }
  return new ApplicationError(
    503,
    'media_upload_unavailable',
    'Service Unavailable',
    'Controlled media upload is temporarily unavailable.',
  );
}
