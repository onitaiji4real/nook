import { Buffer } from 'node:buffer';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  canonicalUtcTimestampSchema,
  customerIdSchema,
  type CustomerDetail,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerSummary,
} from '@nook/contracts';
import {
  CustomerReadRepositoryError,
  type CustomerReadRecord,
  type CustomerReadRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../../platform/config/runtime-config.token';
import { ApplicationError } from '../../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../../platform/identity/tenant-repository.token';
import { CUSTOMER_READ_REPOSITORY } from './customer-read.tokens';

interface RequestContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

interface CustomerCursor {
  readonly v: 1;
  readonly asOf: string;
  readonly relationshipStartedAt: string;
  readonly id: string;
}

@Injectable()
export class CustomerReadApplicationService {
  constructor(
    @Inject(CUSTOMER_READ_REPOSITORY)
    private readonly customers: CustomerReadRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async list(
    input: RequestContext & { readonly query: CustomerListQuery },
  ): Promise<CustomerListResponse> {
    await this.requireReader(input);
    this.requireActiveProjection();
    const cursor =
      input.query.cursor === undefined ? undefined : decodeCustomerCursor(input.query.cursor);
    const page = await this.execute(() =>
      this.customers.list({
        tenantId: input.tenantId,
        limit: input.query.limit,
        asOf: cursor === undefined ? undefined : new Date(cursor.asOf),
        after:
          cursor === undefined
            ? undefined
            : {
                relationshipStartedAt: new Date(cursor.relationshipStartedAt),
                id: cursor.id,
              },
      }),
    );
    this.log('crm.customer_list_read', input, 'success');
    const includeTags = this.config.crmTagsMode === 'active' && page.tagsEntitled;
    return {
      asOf: page.asOf.toISOString(),
      items: page.items.map((record) => toSummary(record, includeTags)),
      nextCursor:
        page.next === null
          ? null
          : encodeCustomerCursor({
              v: 1,
              asOf: page.asOf.toISOString(),
              relationshipStartedAt: page.next.relationshipStartedAt.toISOString(),
              id: page.next.id,
            }),
    };
  }

  async getDetail(
    input: RequestContext & { readonly customerId: string },
  ): Promise<CustomerDetail> {
    await this.requireReader(input, input.customerId);
    this.requireActiveProjection();
    const result = await this.execute(() =>
      this.customers.readDetailAndAudit({
        tenantId: input.tenantId,
        customerId: input.customerId,
        actorUserId: input.userId,
        requestId: input.requestId,
      }),
    );
    if (result === null) {
      await this.recordDetailDenied(input, input.customerId);
      throw customerNotFound();
    }
    if (result.kind === 'notes_unavailable') {
      throw new ApplicationError(
        503,
        'customer_notes_unavailable',
        'Service Unavailable',
        'Customer notes are temporarily unavailable.',
      );
    }
    this.log('crm.customer_detail_viewed', input, 'success');
    return {
      customer: toSummary(
        result.customer,
        this.config.crmTagsMode === 'active' && result.tagsEntitled,
      ),
      contact: { phone: null, email: null, source: null },
      notes: [],
    };
  }

  private async requireReader(input: RequestContext, customerId?: string): Promise<void> {
    let membership: TenantMembershipRecord | null;
    try {
      membership = await this.tenants.findActiveTenantMembership({
        tenantId: input.tenantId,
        userId: input.userId,
      });
    } catch {
      throw customerReadUnavailable();
    }
    if (
      membership !== null &&
      (membership.membership.role === 'OWNER' || membership.membership.role === 'MANAGER')
    ) {
      return;
    }
    if (customerId === undefined) {
      try {
        await this.tenants.recordAuthorizationDeniedIfTenantExists({
          tenantId: input.tenantId,
          actorUserId: input.userId,
          requestId: input.requestId,
        });
      } catch {
        throw customerReadUnavailable();
      }
    } else {
      await this.recordDetailDenied(input, customerId);
    }
    this.log('authorization.denied', input, 'denied');
    throw new ApplicationError(403, 'tenant_access_denied', 'Forbidden', 'Access is denied.');
  }

  private requireActiveProjection(): void {
    if (this.config.crmProjectionMode !== 'active') {
      throw customerReadUnavailable();
    }
  }

  private async recordDetailDenied(input: RequestContext, customerId: string): Promise<void> {
    await this.execute(() =>
      this.customers.recordDetailDeniedIfTenantExists({
        tenantId: input.tenantId,
        customerId,
        actorUserId: input.userId,
        requestId: input.requestId,
      }),
    );
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CustomerReadRepositoryError) throw customerReadUnavailable();
      throw error;
    }
  }

  private log(
    event: 'crm.customer_list_read' | 'crm.customer_detail_viewed' | 'authorization.denied',
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

function toSummary(record: CustomerReadRecord, includeTags: boolean): CustomerSummary {
  return {
    id: record.id,
    displayName: record.displayName,
    relationshipStartedAt: record.relationshipStartedAt.toISOString(),
    firstVisitAt: record.firstVisitAt?.toISOString() ?? null,
    lastVisitAt: record.lastVisitAt?.toISOString() ?? null,
    completedVisitCount: record.completedVisitCount,
    noShowCount: record.noShowCount,
    totalSpent: null,
    spendStatus: 'UNKNOWN',
    marketingState: record.marketingState,
    activeMarketingDocumentVersion: record.activeMarketingDocumentVersion,
    tags: includeTags ? record.tags : [],
  };
}

export function encodeCustomerCursor(value: CustomerCursor): string {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  if (Buffer.byteLength(encoded, 'utf8') > 512) throw invalidCursor();
  return encoded;
}

export function decodeCustomerCursor(raw: string): CustomerCursor {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    !isExactObject(value, ['v', 'asOf', 'relationshipStartedAt', 'id']) ||
    value.v !== 1 ||
    !canonicalUtcTimestampSchema.safeParse(value.asOf).success ||
    !canonicalUtcTimestampSchema.safeParse(value.relationshipStartedAt).success ||
    !customerIdSchema.safeParse(value.id).success
  ) {
    throw invalidCursor();
  }
  return value as unknown as CustomerCursor;
}

function isExactObject(
  value: unknown,
  keys: readonly (keyof CustomerCursor)[],
): value is Record<keyof CustomerCursor, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function invalidCursor(): ApplicationError {
  return new ApplicationError(400, 'invalid_cursor', 'Bad Request', 'The cursor is invalid.');
}

function customerNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_not_found',
    'Not Found',
    'The customer was not found.',
  );
}

function customerReadUnavailable(): ApplicationError {
  return new ApplicationError(
    503,
    'customer_crm_unavailable',
    'Service Unavailable',
    'Customer CRM is temporarily unavailable.',
  );
}
