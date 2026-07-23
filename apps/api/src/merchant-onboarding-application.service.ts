import { Inject, Injectable } from '@nestjs/common';
import type { MerchantOnboardingRequest, MerchantOnboardingResponse } from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  isMerchantOnboardingResourceConflict,
  type MerchantOnboardingRecord,
  type MerchantOnboardingRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { ApplicationError } from './application-error';
import { MERCHANT_ONBOARDING_REPOSITORY } from './merchant-onboarding-repository.token';
import { RUNTIME_CONFIG } from './runtime-config.token';
import { TENANT_REPOSITORY } from './tenant-repository.token';

@Injectable()
export class MerchantOnboardingApplicationService {
  constructor(
    @Inject(MERCHANT_ONBOARDING_REPOSITORY)
    private readonly repository: MerchantOnboardingRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async save(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
    readonly body: MerchantOnboardingRequest;
  }): Promise<MerchantOnboardingResponse> {
    await this.requireOwner(input);
    const price = toRepositoryPrice(input.body.service.price);

    try {
      const record = await this.repository.save({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        profile: input.body.profile,
        location: input.body.location,
        service: {
          ...input.body.service,
          ...price,
        },
      });

      this.writeSecurityEvent({
        event: 'merchant.onboarding.saved',
        requestId: input.requestId,
        actorUserId: input.userId,
        tenantId: input.tenantId,
        outcome: 'success',
        version: this.config.appVersion,
        environment: this.config.nodeEnv,
      });

      return toResponse(record);
    } catch (error) {
      if (isMerchantOnboardingResourceConflict(error)) {
        throw new ApplicationError(
          409,
          'onboarding_resource_conflict',
          'Conflict',
          'An onboarding resource ID is already in use.',
        );
      }
      throw error;
    }
  }

  async get(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  }): Promise<MerchantOnboardingResponse> {
    await this.requireMember(input);
    const record = await this.repository.findByTenantId(input.tenantId);
    if (record === null) {
      throw new ApplicationError(
        404,
        'merchant_onboarding_not_found',
        'Not Found',
        'Merchant onboarding has not been started.',
      );
    }
    return toResponse(record);
  }

  private async requireOwner(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  }): Promise<void> {
    const membership = await this.requireMember(input);
    if (membership.membership.role !== 'OWNER') {
      await this.deny(input);
    }
  }

  private async requireMember(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  }): Promise<TenantMembershipRecord> {
    const membership = await this.tenants.findActiveTenantMembership({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (membership === null) {
      return this.deny(input);
    }
    return membership;
  }

  private async deny(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  }): Promise<never> {
    await this.tenants.recordAuthorizationDeniedIfTenantExists({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      requestId: input.requestId,
    });
    this.writeSecurityEvent({
      event: 'authorization.denied',
      requestId: input.requestId,
      actorUserId: input.userId,
      tenantId: input.tenantId,
      outcome: 'denied',
      version: this.config.appVersion,
      environment: this.config.nodeEnv,
    });
    throw new ApplicationError(
      403,
      'tenant_access_denied',
      'Forbidden',
      'Access to this tenant is denied.',
    );
  }

  private writeSecurityEvent(input: Parameters<typeof createSecurityEventLog>[0]): void {
    process.stdout.write(`${JSON.stringify(redactValue(createSecurityEventLog(input)))}\n`);
  }
}

function toRepositoryPrice(price: MerchantOnboardingRequest['service']['price']): {
  readonly priceType: MerchantOnboardingRecord['starterService']['priceType'];
  readonly priceAmount: number | null;
  readonly priceMin: number | null;
  readonly priceMax: number | null;
} {
  switch (price.type) {
    case 'FIXED':
    case 'FROM':
      return {
        priceType: price.type,
        priceAmount: price.amount,
        priceMin: null,
        priceMax: null,
      };
    case 'RANGE':
      return {
        priceType: price.type,
        priceAmount: null,
        priceMin: price.min,
        priceMax: price.max,
      };
    case 'QUOTE':
      return { priceType: price.type, priceAmount: null, priceMin: null, priceMax: null };
  }
}

function toResponse(record: MerchantOnboardingRecord): MerchantOnboardingResponse {
  return {
    tenantId: record.tenantId,
    profile: {
      category: record.category,
      description: record.description,
      phone: record.phone,
      lineOaUrl: record.lineOaUrl,
      instagramUrl: record.instagramUrl,
      bookingPolicy: record.bookingPolicy,
      cancellationPolicy: record.cancellationPolicy,
      visibilityStatus: record.visibilityStatus,
      verificationStatus: record.verificationStatus,
    },
    primaryLocation: {
      ...record.primaryLocation,
      timezone: 'Asia/Taipei',
    },
    starterService: {
      id: record.starterService.id,
      name: record.starterService.name,
      description: record.starterService.description,
      durationMinutes: record.starterService.durationMinutes,
      bufferBeforeMinutes: record.starterService.bufferBeforeMinutes,
      bufferAfterMinutes: record.starterService.bufferAfterMinutes,
      price: toResponsePrice(record.starterService),
      currency: 'TWD',
      bookingEnabled: record.starterService.bookingEnabled,
      status: record.starterService.status,
    },
    readiness: {
      completedSteps: ['PROFILE', 'LOCATION', 'SERVICE'],
      readyForSchedule: true,
      readyToPublish: false,
    },
  };
}

function toResponsePrice(
  service: MerchantOnboardingRecord['starterService'],
): MerchantOnboardingResponse['starterService']['price'] {
  switch (service.priceType) {
    case 'FIXED':
    case 'FROM':
      if (service.priceAmount === null) throw new Error('service price amount is missing');
      return { type: service.priceType, amount: service.priceAmount };
    case 'RANGE':
      if (service.priceMin === null || service.priceMax === null) {
        throw new Error('service price range is missing');
      }
      return { type: service.priceType, min: service.priceMin, max: service.priceMax };
    case 'QUOTE':
      return { type: 'QUOTE' };
  }
}
