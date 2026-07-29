import { createHash } from 'node:crypto';

import type { RuntimeConfig } from '@nook/config';
import {
  MarketingConsentRepositoryError,
  type MarketingConsentRepository,
  type MarketingConsentStateRecord,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { MarketingConsentApplicationService } from '../../../src/modules/consumer-crm/consent/marketing-consent-application.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const consumerUserId = '00000000-0000-4000-8000-000000000002';
const documentId = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';

const baseConfig: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'disabled',
  crmNotesMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: {
    globalLimit: 120,
    tokenLimit: 5,
    windowSeconds: 60,
    bucketTtlSeconds: 600,
  },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('MarketingConsentApplicationService', () => {
  it('reads current state while the grant incident gate is disabled', async () => {
    const repository = createRepository();
    repository.readCurrent.mockResolvedValue(state('NOT_GRANTED', 0));
    const service = new MarketingConsentApplicationService(repository, baseConfig);

    await expect(service.readCurrent({ tenantId, consumerUserId })).resolves.toMatchObject({
      state: 'NOT_GRANTED',
      revision: 0,
      grantedAt: null,
    });
    expect(repository.readCurrent).toHaveBeenCalledWith({ tenantId, consumerUserId });
  });

  it('fails closed without touching the repository when grant is disabled', async () => {
    const repository = createRepository();
    const service = new MarketingConsentApplicationService(repository, baseConfig);

    await expect(
      service.grant({
        tenantId,
        consumerUserId,
        idempotencyKey,
        requestId: 'request-disabled',
        body: { purpose: 'MARKETING_MESSAGES', consentDocumentId: documentId, expectedRevision: 0 },
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'marketing_consent_grant_disabled',
    });
    expect(repository.grant).not.toHaveBeenCalled();
  });

  it('hashes the idempotency key, binds the consumer actor and returns ISO timestamps', async () => {
    const repository = createRepository();
    const grantedAt = new Date('2026-07-28T12:00:00.000Z');
    repository.grant.mockResolvedValue({ ...state('GRANTED', 1), grantedAt });
    const service = new MarketingConsentApplicationService(repository, {
      ...baseConfig,
      marketingConsentGrantEnabled: true,
    });

    await expect(
      service.grant({
        tenantId,
        consumerUserId,
        idempotencyKey: idempotencyKey.toUpperCase(),
        requestId: 'request-grant',
        body: {
          purpose: 'MARKETING_MESSAGES',
          consentDocumentId: documentId,
          expectedRevision: 0,
        },
      }),
    ).resolves.toMatchObject({
      state: 'GRANTED',
      eligible: true,
      revision: 1,
      grantedAt: grantedAt.toISOString(),
    });
    expect(repository.grant).toHaveBeenCalledWith({
      tenantId,
      consumerUserId,
      actorUserId: consumerUserId,
      consentDocumentId: documentId,
      expectedRevision: 0,
      idempotencyKeyHash: sha256(idempotencyKey),
      requestFingerprint: sha256(
        JSON.stringify({
          version: 1,
          command: 'GRANT',
          documentId,
          expectedRevision: 0,
        }),
      ),
      requestId: 'request-grant',
    });
  });

  it('keeps withdrawal enabled and maps stale revision without leaking repository details', async () => {
    const repository = createRepository();
    repository.withdraw.mockRejectedValue(new MarketingConsentRepositoryError('revision_conflict'));
    const service = new MarketingConsentApplicationService(repository, baseConfig);

    await expect(
      service.withdraw({
        tenantId,
        consumerUserId,
        idempotencyKey,
        requestId: 'request-withdraw',
        expectedRevision: '2',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'consent_revision_conflict',
    });
    expect(repository.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        consumerUserId,
        actorUserId: consumerUserId,
        expectedRevision: 2,
        idempotencyKeyHash: sha256(idempotencyKey),
      }),
    );
  });
});

function state(
  current: MarketingConsentStateRecord['state'],
  revision: number,
): MarketingConsentStateRecord {
  return {
    tenantId,
    tenantDisplayName: '範例美甲店',
    purpose: 'MARKETING_MESSAGES',
    state: current,
    eligible: current === 'GRANTED',
    revision,
    activeDocument: {
      id: documentId,
      purpose: 'MARKETING_MESSAGES',
      version: '2026-07-28.v1',
      locale: 'zh-TW',
      content: '合成同意文案',
    },
    grantedAt: null,
    withdrawnAt: null,
  };
}

function createRepository() {
  return {
    readCurrent: vi.fn<MarketingConsentRepository['readCurrent']>(),
    grant: vi.fn<MarketingConsentRepository['grant']>(),
    withdraw: vi.fn<MarketingConsentRepository['withdraw']>(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
