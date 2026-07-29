import { z } from 'zod';

const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());

const customerTagNameSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 32);

export const customerTagIdSchema = canonicalUuidSchema;

export const createCustomerTagDefinitionRequestSchema = z
  .object({
    name: customerTagNameSchema,
  })
  .strict();

export const changeCustomerTagDefinitionStatusRequestSchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .strict();

export type CreateCustomerTagDefinitionRequest = z.infer<
  typeof createCustomerTagDefinitionRequestSchema
>;
export type ChangeCustomerTagDefinitionStatusRequest = z.infer<
  typeof changeCustomerTagDefinitionStatusRequestSchema
>;

export interface CustomerTagDefinition {
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
}
