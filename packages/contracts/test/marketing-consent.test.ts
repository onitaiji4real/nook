import { describe, expect, it } from 'vitest';

import {
  grantMarketingConsentRequestSchema,
  marketingConsentExpectedRevisionSchema,
  marketingConsentIdempotencyKeySchema,
} from '../src';

describe('marketing consent contracts', () => {
  it('accepts only the purpose-specific strict grant body', () => {
    const valid = {
      purpose: 'MARKETING_MESSAGES',
      consentDocumentId: '00000000-0000-4000-8000-000000000001',
      expectedRevision: 0,
    };
    expect(grantMarketingConsentRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      grantMarketingConsentRequestSchema.safeParse({ ...valid, purpose: 'OPERATIONAL' }).success,
    ).toBe(false);
    expect(grantMarketingConsentRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(
      false,
    );
  });

  it('bounds the withdrawal revision and requires a UUID idempotency key', () => {
    expect(marketingConsentExpectedRevisionSchema.parse('2')).toBe(2);
    expect(marketingConsentExpectedRevisionSchema.safeParse('-1').success).toBe(false);
    expect(
      marketingConsentIdempotencyKeySchema.safeParse('00000000-0000-4000-8000-000000000002')
        .success,
    ).toBe(true);
    expect(marketingConsentIdempotencyKeySchema.safeParse('raw-key').success).toBe(false);
  });
});
