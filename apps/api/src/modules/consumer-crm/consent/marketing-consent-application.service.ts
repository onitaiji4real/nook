import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  grantMarketingConsentRequestSchema,
  marketingConsentExpectedRevisionSchema,
  type MarketingConsentResponse,
} from '@nook/contracts';
import {
  MarketingConsentRepositoryError,
  type MarketingConsentRepository,
  type MarketingConsentStateRecord,
} from '@nook/database';

import { RUNTIME_CONFIG } from '../../../platform/config/runtime-config.token';
import { ApplicationError } from '../../../platform/http/application-error';
import { MARKETING_CONSENT_REPOSITORY } from './marketing-consent.tokens';

@Injectable()
export class MarketingConsentApplicationService {
  constructor(
    @Inject(MARKETING_CONSENT_REPOSITORY)
    private readonly repository: MarketingConsentRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async readCurrent(input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
  }): Promise<MarketingConsentResponse> {
    try {
      return toResponse(await this.repository.readCurrent(input));
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async grant(input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
    readonly idempotencyKey: string;
    readonly requestId: string;
    readonly body: unknown;
  }): Promise<MarketingConsentResponse> {
    if (!this.config.marketingConsentGrantEnabled) {
      throw new ApplicationError(
        503,
        'marketing_consent_grant_disabled',
        'Service Unavailable',
        'Marketing consent grant is temporarily unavailable.',
      );
    }
    const body = grantMarketingConsentRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const keyHash = sha256(input.idempotencyKey.toLowerCase());
    const requestFingerprint = sha256(
      JSON.stringify({
        version: 1,
        command: 'GRANT',
        documentId: body.data.consentDocumentId.toLowerCase(),
        expectedRevision: body.data.expectedRevision,
      }),
    );
    try {
      return toResponse(
        await this.repository.grant({
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          actorUserId: input.consumerUserId,
          consentDocumentId: body.data.consentDocumentId.toLowerCase(),
          expectedRevision: body.data.expectedRevision,
          idempotencyKeyHash: keyHash,
          requestFingerprint,
          requestId: input.requestId,
        }),
      );
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async withdraw(input: {
    readonly tenantId: string;
    readonly consumerUserId: string;
    readonly idempotencyKey: string;
    readonly requestId: string;
    readonly expectedRevision: unknown;
  }): Promise<MarketingConsentResponse> {
    const expectedRevision = marketingConsentExpectedRevisionSchema.safeParse(
      input.expectedRevision,
    );
    if (!expectedRevision.success) throw invalidRequest();
    const keyHash = sha256(input.idempotencyKey.toLowerCase());
    const requestFingerprint = sha256(
      JSON.stringify({
        version: 1,
        command: 'WITHDRAW',
        documentId: null,
        expectedRevision: expectedRevision.data,
      }),
    );
    try {
      return toResponse(
        await this.repository.withdraw({
          tenantId: input.tenantId,
          consumerUserId: input.consumerUserId,
          actorUserId: input.consumerUserId,
          expectedRevision: expectedRevision.data,
          idempotencyKeyHash: keyHash,
          requestFingerprint,
          requestId: input.requestId,
        }),
      );
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }
}

function toResponse(record: MarketingConsentStateRecord): MarketingConsentResponse {
  return {
    ...record,
    grantedAt: record.grantedAt?.toISOString() ?? null,
    withdrawnAt: record.withdrawnAt?.toISOString() ?? null,
  };
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof MarketingConsentRepositoryError)) return error as Error;
  const mapping = {
    relationship_not_found: [
      404,
      'marketing_consent_not_found',
      'Not Found',
      'The marketing consent relationship was not found.',
    ],
    consent_stream_not_found: [
      404,
      'marketing_consent_not_found',
      'Not Found',
      'The marketing consent relationship was not found.',
    ],
    tenant_inactive: [409, 'tenant_inactive', 'Conflict', 'The merchant is not active.'],
    consent_not_active: [
      409,
      'consent_not_active',
      'Conflict',
      'No active marketing consent document is available.',
    ],
    tenant_display_name_invalid: [
      503,
      'marketing_consent_unavailable',
      'Service Unavailable',
      'Marketing consent is temporarily unavailable.',
    ],
    revision_conflict: [
      409,
      'consent_revision_conflict',
      'Conflict',
      'The marketing consent state has changed.',
    ],
    idempotency_conflict: [
      409,
      'idempotency_conflict',
      'Conflict',
      'The idempotency key was already used for a different request.',
    ],
    consent_already_granted: [
      409,
      'consent_already_granted',
      'Conflict',
      'The active marketing consent document is already granted.',
    ],
    consent_unavailable: [
      503,
      'marketing_consent_unavailable',
      'Service Unavailable',
      'Marketing consent is temporarily unavailable.',
    ],
  } as const;
  const [status, code, title, detail] = mapping[error.code];
  return new ApplicationError(status, code, title, detail);
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
