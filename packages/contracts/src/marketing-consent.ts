import { z } from 'zod';

export const marketingConsentIdempotencyKeySchema = z.string().uuid();
export const marketingConsentTenantIdSchema = z.string().uuid();
export const marketingConsentPurposeSchema = z.literal('MARKETING_MESSAGES');
export const marketingConsentExpectedRevisionSchema = z.coerce.number().int().min(0);
export const grantMarketingConsentRequestSchema = z
  .object({
    purpose: marketingConsentPurposeSchema,
    consentDocumentId: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export type GrantMarketingConsentRequest = z.infer<typeof grantMarketingConsentRequestSchema>;

export interface MarketingConsentResponse {
  readonly tenantId: string;
  readonly tenantDisplayName: string;
  readonly purpose: 'MARKETING_MESSAGES';
  readonly state: 'NOT_GRANTED' | 'GRANTED' | 'WITHDRAWN' | 'SUPERSEDED';
  readonly eligible: boolean;
  readonly revision: number;
  readonly activeDocument: {
    readonly id: string;
    readonly purpose: 'MARKETING_MESSAGES';
    readonly version: string;
    readonly locale: string;
    readonly content: string;
  } | null;
  readonly grantedAt: string | null;
  readonly withdrawnAt: string | null;
}
