import { z } from 'zod';

import type { CustomerNote } from './customer-notes';

export const customerIdSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());

const customerCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const customerListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: customerCursorSchema.optional(),
  })
  .strict();

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export interface CustomerTag {
  readonly id: string;
  readonly name: string;
}

export interface CustomerSummary {
  readonly id: string;
  readonly displayName: string;
  readonly relationshipStartedAt: string;
  readonly firstVisitAt: string | null;
  readonly lastVisitAt: string | null;
  readonly completedVisitCount: number;
  readonly noShowCount: number;
  readonly totalSpent: null;
  readonly spendStatus: 'UNKNOWN';
  readonly marketingState: 'NOT_GRANTED' | 'GRANTED' | 'WITHDRAWN' | 'SUPERSEDED';
  readonly activeMarketingDocumentVersion: string | null;
  readonly tags: readonly CustomerTag[];
}

export interface CustomerListResponse {
  readonly asOf: string;
  readonly items: readonly CustomerSummary[];
  readonly nextCursor: string | null;
}

export interface CustomerDetail {
  readonly customer: CustomerSummary;
  readonly contact: {
    readonly phone: null;
    readonly email: null;
    readonly source: null;
  };
  readonly notes: readonly CustomerNote[];
}
