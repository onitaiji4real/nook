import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  changeCustomerTagDefinitionStatusRequestSchema,
  createCustomerTagDefinitionRequestSchema,
  type CustomerTagDefinition,
} from '@nook/contracts';
import {
  CustomerTagRepositoryError,
  type CustomerTagRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { normalizeCustomerTagName } from '@nook/domain';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../../platform/config/runtime-config.token';
import { ApplicationError } from '../../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../../platform/identity/tenant-repository.token';
import { CUSTOMER_TAG_REPOSITORY } from './customer-tags.tokens';

interface RequestContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

type TagEvent =
  | 'crm.customer_tags_listed'
  | 'crm.customer_tag_definition_created'
  | 'crm.customer_tag_definition_status_changed'
  | 'crm.customer_tag_attached'
  | 'crm.customer_tag_detached';

@Injectable()
export class CustomerTagsApplicationService {
  constructor(
    @Inject(CUSTOMER_TAG_REPOSITORY)
    private readonly tags: CustomerTagRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async list(input: RequestContext): Promise<readonly CustomerTagDefinition[]> {
    await this.requireRole(input, ['OWNER', 'MANAGER']);
    this.requireActiveFeature();
    const records = await this.execute(() => this.tags.listDefinitions(input.tenantId));
    this.log('crm.customer_tags_listed', input);
    return records.map((record) => ({
      id: record.id,
      name: record.displayName,
      status: record.status,
    }));
  }

  async create(input: RequestContext & { readonly body: unknown }): Promise<CustomerTagDefinition> {
    await this.requireRole(input, ['OWNER']);
    this.requireActiveFeature();
    const body = createCustomerTagDefinitionRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const name = normalizeCustomerTagName(body.data.name);
    if (!name.ok) {
      throw new ApplicationError(
        400,
        name.reason === 'sensitive_category'
          ? 'customer_tag_sensitive_category'
          : 'invalid_request',
        'Bad Request',
        'The customer tag name is not allowed.',
      );
    }
    const record = await this.execute(() =>
      this.tags.createDefinition({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        id: randomUUID(),
        normalizedName: name.normalizedName,
        displayName: name.displayName,
      }),
    );
    this.log('crm.customer_tag_definition_created', input);
    return { id: record.id, name: record.displayName, status: record.status };
  }

  async changeStatus(
    input: RequestContext & { readonly tagId: string; readonly body: unknown },
  ): Promise<CustomerTagDefinition> {
    await this.requireRole(input, ['OWNER']);
    this.requireActiveFeature();
    const body = changeCustomerTagDefinitionStatusRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const record = await this.execute(() =>
      this.tags.changeDefinitionStatus({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        tagId: input.tagId,
        status: body.data.status,
      }),
    );
    this.log('crm.customer_tag_definition_status_changed', input);
    return { id: record.id, name: record.displayName, status: record.status };
  }

  async attach(
    input: RequestContext & { readonly customerId: string; readonly tagId: string },
  ): Promise<void> {
    await this.requireRole(input, ['OWNER', 'MANAGER']);
    this.requireActiveFeature();
    await this.execute(() =>
      this.tags.attach({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        customerId: input.customerId,
        tagId: input.tagId,
      }),
    );
    this.log('crm.customer_tag_attached', input);
  }

  async detach(
    input: RequestContext & { readonly customerId: string; readonly tagId: string },
  ): Promise<void> {
    await this.requireRole(input, ['OWNER', 'MANAGER']);
    this.requireActiveFeature();
    await this.execute(() =>
      this.tags.detach({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
        customerId: input.customerId,
        tagId: input.tagId,
      }),
    );
    this.log('crm.customer_tag_detached', input);
  }

  private async requireRole(
    input: RequestContext,
    allowed: readonly TenantMembershipRecord['membership']['role'][],
  ): Promise<void> {
    let membership: TenantMembershipRecord | null;
    try {
      membership = await this.tenants.findActiveTenantMembership({
        tenantId: input.tenantId,
        userId: input.userId,
      });
    } catch {
      throw tagsUnavailable();
    }
    if (membership !== null && allowed.includes(membership.membership.role)) return;
    try {
      await this.tenants.recordAuthorizationDeniedIfTenantExists({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
      });
    } catch {
      throw tagsUnavailable();
    }
    if (membership === null) throw tagNotFound();
    throw new ApplicationError(403, 'tenant_access_denied', 'Forbidden', 'Access is denied.');
  }

  private requireActiveFeature(): void {
    if (this.config.crmTagsMode !== 'active') throw tagsUnavailable();
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  private log(event: TagEvent, input: RequestContext): void {
    process.stdout.write(
      `${JSON.stringify(
        redactValue(
          createSecurityEventLog({
            event,
            requestId: input.requestId,
            actorUserId: input.userId,
            tenantId: input.tenantId,
            outcome: 'success',
            version: this.config.appVersion,
            environment: this.config.nodeEnv,
          }),
        ),
      )}\n`,
    );
  }
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof CustomerTagRepositoryError)) return tagsUnavailable();
  const mapping = {
    entitlement_denied: [
      403,
      'customer_tags_not_in_plan',
      'Forbidden',
      'Customer tags are not included in the current plan.',
    ],
    entitlement_unavailable: [
      503,
      'customer_tags_unavailable',
      'Service Unavailable',
      'Customer tags are temporarily unavailable.',
    ],
    definition_limit_reached: [
      409,
      'customer_tag_limit_reached',
      'Conflict',
      'The customer tag definition limit has been reached.',
    ],
    link_limit_reached: [
      409,
      'customer_tag_link_limit_reached',
      'Conflict',
      'The customer tag link limit has been reached.',
    ],
    tag_conflict: [409, 'customer_tag_conflict', 'Conflict', 'The customer tag already exists.'],
    tag_not_found: [404, 'customer_tag_not_found', 'Not Found', 'The customer tag was not found.'],
    customer_not_found: [404, 'customer_not_found', 'Not Found', 'The customer was not found.'],
    tag_inactive: [409, 'customer_tag_inactive', 'Conflict', 'The customer tag is inactive.'],
    tag_unavailable: [
      503,
      'customer_tags_unavailable',
      'Service Unavailable',
      'Customer tags are temporarily unavailable.',
    ],
  } as const;
  const [status, code, title, detail] = mapping[error.code];
  return new ApplicationError(status, code, title, detail);
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function tagNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_tag_not_found',
    'Not Found',
    'The customer tag was not found.',
  );
}

function tagsUnavailable(): ApplicationError {
  return new ApplicationError(
    503,
    'customer_tags_unavailable',
    'Service Unavailable',
    'Customer tags are temporarily unavailable.',
  );
}
