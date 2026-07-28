export const MARKETING_CONSENT_PURPOSE = 'MARKETING_MESSAGES' as const;
export const MARKETING_CONSENT_EVIDENCE_SCHEMA = 'nook-consent-evidence-v1' as const;

export type MarketingConsentCurrentState = 'NOT_GRANTED' | 'GRANTED' | 'WITHDRAWN' | 'SUPERSEDED';

export interface MarketingConsentLatestEvent {
  readonly eventType: 'GRANTED' | 'WITHDRAWN';
  readonly consentDocumentId: string;
}

export function deriveMarketingConsentCurrentState(input: {
  readonly latestEvent: MarketingConsentLatestEvent | null;
  readonly activeDocumentId: string | null;
}): MarketingConsentCurrentState {
  if (input.latestEvent === null) return 'NOT_GRANTED';
  if (input.latestEvent.eventType === 'WITHDRAWN') return 'WITHDRAWN';
  return input.latestEvent.consentDocumentId === input.activeDocumentId ? 'GRANTED' : 'SUPERSEDED';
}

export function canonicalMarketingConsentEvidence(input: {
  readonly tenantId: string;
  readonly tenantDisplayName: string;
  readonly documentId: string;
  readonly documentVersion: string;
  readonly locale: string;
  readonly contentSha256: string;
}): string {
  return JSON.stringify([
    MARKETING_CONSENT_EVIDENCE_SCHEMA,
    MARKETING_CONSENT_PURPOSE,
    input.tenantId,
    input.tenantDisplayName,
    input.documentId,
    input.documentVersion,
    input.locale,
    input.contentSha256,
  ]);
}

export function normalizeConsentTenantDisplayName(value: string): string | null {
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= 1 && Array.from(normalized).length <= 120 ? normalized : null;
}
