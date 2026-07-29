import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalMarketingConsentEvidence,
  deriveMarketingConsentCurrentState,
  normalizeConsentTenantDisplayName,
} from '../src';

describe('marketing consent', () => {
  it('matches the canonical evidence vector', () => {
    const canonical = canonicalMarketingConsentEvidence({
      tenantId: '00000000-0000-4000-8000-000000000001',
      tenantDisplayName: '範例美甲店',
      documentId: '00000000-0000-4000-8000-000000000002',
      documentVersion: '2026-07-28.v1',
      locale: 'zh-TW',
      contentSha256: '0'.repeat(64),
    });

    expect(canonical).toBe(
      '["nook-consent-evidence-v1","MARKETING_MESSAGES","00000000-0000-4000-8000-000000000001","範例美甲店","00000000-0000-4000-8000-000000000002","2026-07-28.v1","zh-TW","0000000000000000000000000000000000000000000000000000000000000000"]',
    );
    expect(createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(
      '39ba7498efff4f6ce8968608705a28131151cc9956c9ce6b1d23305f72438e2a',
    );
  });

  it('derives current truth from the latest event and active document', () => {
    expect(deriveMarketingConsentCurrentState({ latestEvent: null, activeDocumentId: null })).toBe(
      'NOT_GRANTED',
    );
    expect(
      deriveMarketingConsentCurrentState({
        latestEvent: { eventType: 'GRANTED', consentDocumentId: 'document-a' },
        activeDocumentId: 'document-a',
      }),
    ).toBe('GRANTED');
    expect(
      deriveMarketingConsentCurrentState({
        latestEvent: { eventType: 'GRANTED', consentDocumentId: 'document-a' },
        activeDocumentId: 'document-b',
      }),
    ).toBe('SUPERSEDED');
    expect(
      deriveMarketingConsentCurrentState({
        latestEvent: { eventType: 'WITHDRAWN', consentDocumentId: 'document-a' },
        activeDocumentId: 'document-b',
      }),
    ).toBe('WITHDRAWN');
  });

  it('normalizes the tenant display name and rejects an unsafe snapshot length', () => {
    expect(normalizeConsentTenantDisplayName('  範例美甲店  ')).toBe('範例美甲店');
    expect(normalizeConsentTenantDisplayName('')).toBeNull();
    expect(normalizeConsentTenantDisplayName('店'.repeat(121))).toBeNull();
  });
});
