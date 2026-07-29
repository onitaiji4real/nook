import { z } from 'zod';

import { canonicalUtcTimestampSchema } from './appointment-view';

const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());

const customerNoteContentSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length >= 1)
  .refine((value) => Array.from(value).length <= 2_000);

export const customerNoteIdSchema = canonicalUuidSchema;

export const createCustomerNoteRequestSchema = z
  .object({
    content: customerNoteContentSchema,
  })
  .strict();

export const updateCustomerNoteRequestSchema = z
  .object({
    content: customerNoteContentSchema,
    expectedUpdatedAt: canonicalUtcTimestampSchema,
  })
  .strict();

export interface CustomerNote {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreateCustomerNoteRequest = z.infer<typeof createCustomerNoteRequestSchema>;
export type UpdateCustomerNoteRequest = z.infer<typeof updateCustomerNoteRequestSchema>;
