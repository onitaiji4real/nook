import { Inject, Injectable } from '@nestjs/common';
import type {
  ChangeServiceStatusRequest,
  CreateServiceRequest,
  ReorderServicesRequest,
  ServiceCatalogItem,
  ServiceCatalogResponse,
  UpdateServiceRequest,
} from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import {
  ServiceCatalogRepositoryError,
  type ServiceCatalogRecord,
  type ServiceCatalogRecordItem,
  type ServiceCatalogRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../platform/identity/tenant-repository.token';
import { SERVICE_CATALOG_REPOSITORY } from './service-catalog-repository.token';

type RequestContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
};

@Injectable()
export class ServiceCatalogApplicationService {
  constructor(
    @Inject(SERVICE_CATALOG_REPOSITORY)
    private readonly repository: ServiceCatalogRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async list(input: RequestContext): Promise<ServiceCatalogResponse> {
    await this.requireMember(input);
    return toResponse(await this.execute(() => this.repository.list(input.tenantId)));
  }

  async create(
    input: RequestContext & { readonly body: CreateServiceRequest },
  ): Promise<ServiceCatalogResponse> {
    await this.requireEditor(input);
    const price = toRepositoryPrice(input.body.price);
    const catalog = await this.execute(() =>
      this.repository.create({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        id: input.body.id,
        name: input.body.name,
        description: input.body.description,
        durationMinutes: input.body.durationMinutes,
        bufferBeforeMinutes: input.body.bufferBeforeMinutes,
        bufferAfterMinutes: input.body.bufferAfterMinutes,
        bookingEnabled: input.body.bookingEnabled,
        ...price,
      }),
    );
    this.logChange('service.created', input);
    return toResponse(catalog);
  }

  async update(
    input: RequestContext & { readonly serviceId: string; readonly body: UpdateServiceRequest },
  ): Promise<ServiceCatalogResponse> {
    await this.requireEditor(input);
    const price = input.body.price === undefined ? {} : toRepositoryPrice(input.body.price);
    const catalog = await this.execute(() =>
      this.repository.update({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        serviceId: input.serviceId,
        patch: {
          ...(input.body.name !== undefined ? { name: input.body.name } : {}),
          ...(input.body.description !== undefined ? { description: input.body.description } : {}),
          ...(input.body.durationMinutes !== undefined
            ? { durationMinutes: input.body.durationMinutes }
            : {}),
          ...(input.body.bufferBeforeMinutes !== undefined
            ? { bufferBeforeMinutes: input.body.bufferBeforeMinutes }
            : {}),
          ...(input.body.bufferAfterMinutes !== undefined
            ? { bufferAfterMinutes: input.body.bufferAfterMinutes }
            : {}),
          ...(input.body.bookingEnabled !== undefined
            ? { bookingEnabled: input.body.bookingEnabled }
            : {}),
          ...price,
        },
      }),
    );
    this.logChange('service.updated', input);
    return toResponse(catalog);
  }

  async changeStatus(
    input: RequestContext & {
      readonly serviceId: string;
      readonly body: ChangeServiceStatusRequest;
    },
  ): Promise<ServiceCatalogResponse> {
    await this.requireEditor(input);
    const catalog = await this.execute(() =>
      this.repository.changeStatus({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        serviceId: input.serviceId,
        status: input.body.status,
      }),
    );
    this.logChange('service.status_changed', input);
    return toResponse(catalog);
  }

  async reorder(
    input: RequestContext & { readonly body: ReorderServicesRequest },
  ): Promise<ServiceCatalogResponse> {
    await this.requireEditor(input);
    const catalog = await this.execute(() =>
      this.repository.reorder({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        serviceIds: input.body.serviceIds,
      }),
    );
    this.logChange('service.reordered', input);
    return toResponse(catalog);
  }

  private async execute(operation: () => Promise<ServiceCatalogRecord>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ServiceCatalogRepositoryError)) throw error;
      switch (error.code) {
        case 'entitlement_limit_reached':
          throw new ApplicationError(
            403,
            'service_limit_reached',
            'Forbidden',
            'The active service entitlement limit has been reached.',
          );
        case 'entitlement_unavailable':
          throw new ApplicationError(
            503,
            'service_entitlement_unavailable',
            'Service Unavailable',
            'The service entitlement configuration is unavailable.',
          );
        case 'last_active_service':
          throw new ApplicationError(
            409,
            'last_active_service',
            'Conflict',
            'At least one active service is required.',
          );
        case 'resource_conflict':
          throw new ApplicationError(
            409,
            'service_resource_conflict',
            'Conflict',
            'The service resource ID is already in use.',
          );
        case 'service_not_found':
          throw new ApplicationError(
            404,
            'service_not_found',
            'Not Found',
            'The service was not found.',
          );
        case 'service_order_mismatch':
          throw new ApplicationError(
            409,
            'service_order_mismatch',
            'Conflict',
            'The ordering list must contain every service exactly once.',
          );
      }
    }
  }

  private async requireEditor(input: RequestContext): Promise<void> {
    const membership = await this.requireMember(input);
    if (!['OWNER', 'MANAGER'].includes(membership.membership.role)) {
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
    this.writeSecurityEvent('authorization.denied', input, 'denied');
    throw new ApplicationError(
      403,
      'tenant_access_denied',
      'Forbidden',
      'Access to this tenant is denied.',
    );
  }

  private logChange(
    event: 'service.created' | 'service.updated' | 'service.status_changed' | 'service.reordered',
    input: RequestContext,
  ) {
    this.writeSecurityEvent(event, input, 'success');
  }

  private writeSecurityEvent(
    event: Parameters<typeof createSecurityEventLog>[0]['event'],
    input: RequestContext,
    outcome: 'success' | 'denied',
  ) {
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

function toRepositoryPrice(price: CreateServiceRequest['price']): {
  readonly priceType: ServiceCatalogRecordItem['priceType'];
  readonly priceAmount: number | null;
  readonly priceMin: number | null;
  readonly priceMax: number | null;
} {
  switch (price.type) {
    case 'FIXED':
    case 'FROM':
      return { priceType: price.type, priceAmount: price.amount, priceMin: null, priceMax: null };
    case 'RANGE':
      return { priceType: price.type, priceAmount: null, priceMin: price.min, priceMax: price.max };
    case 'QUOTE':
      return { priceType: price.type, priceAmount: null, priceMin: null, priceMax: null };
  }
}

function toResponse(catalog: ServiceCatalogRecord): ServiceCatalogResponse {
  return {
    tenantId: catalog.tenantId,
    services: catalog.services.map(toResponseItem),
    entitlement: {
      code: 'MAX_SERVICES',
      limit: catalog.limit,
      used: catalog.used,
      remaining: Math.max(0, catalog.limit - catalog.used),
    },
  };
}

function toResponseItem(service: ServiceCatalogRecordItem): ServiceCatalogItem {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    price: toResponsePrice(service),
    currency: 'TWD',
    bookingEnabled: service.bookingEnabled,
    status: service.status,
    sortOrder: service.sortOrder,
  };
}

function toResponsePrice(service: ServiceCatalogRecordItem): ServiceCatalogItem['price'] {
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
