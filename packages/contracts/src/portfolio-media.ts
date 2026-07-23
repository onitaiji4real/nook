import { z } from 'zod';

export const portfolioItemIdSchema = z.string().uuid();
export const mediaAssetIdSchema = z.string().uuid();

const titleSchema = z.string().trim().min(1).max(160);
const descriptionSchema = z.string().trim().min(1).max(2000);
const tagSchema = z.string().trim().min(1).max(50);
const tagsSchema = z
  .array(tagSchema)
  .max(10)
  .refine((tags) => new Set(tags).size === tags.length, 'Portfolio tags must be unique.');

export const portfolioImageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

export const createPortfolioUploadIntentRequestSchema = z
  .object({
    portfolioItemId: portfolioItemIdSchema,
    mediaAssetId: mediaAssetIdSchema,
    title: titleSchema,
    description: descriptionSchema.optional(),
    staffId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    tags: tagsSchema.default([]),
    mimeType: portfolioImageMimeTypeSchema,
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(15 * 1024 * 1024),
  })
  .strict();

export const updatePortfolioItemRequestSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.union([descriptionSchema, z.null()]).optional(),
    staffId: z.union([z.string().uuid(), z.null()]).optional(),
    serviceId: z.union([z.string().uuid(), z.null()]).optional(),
    tags: tagsSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one portfolio field is required.');

export const reorderPortfolioItemsRequestSchema = z
  .object({
    portfolioItemIds: z
      .array(portfolioItemIdSchema)
      .max(3000)
      .refine((ids) => new Set(ids).size === ids.length, 'Portfolio item IDs must be unique.'),
  })
  .strict();

export const completePortfolioUploadRequestSchema = z.object({}).strict();

export const verifyMediaTaskRequestSchema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: mediaAssetIdSchema,
  })
  .strict();

export type PortfolioImageMimeType = z.infer<typeof portfolioImageMimeTypeSchema>;
export type CreatePortfolioUploadIntentRequest = z.infer<
  typeof createPortfolioUploadIntentRequestSchema
>;
export type UpdatePortfolioItemRequest = z.infer<typeof updatePortfolioItemRequestSchema>;
export type ReorderPortfolioItemsRequest = z.infer<typeof reorderPortfolioItemsRequestSchema>;
export type VerifyMediaTaskRequest = z.infer<typeof verifyMediaTaskRequestSchema>;

export interface PortfolioItemResponse {
  readonly id: string;
  readonly staffId: string | null;
  readonly serviceId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  readonly sortOrder: number;
  readonly media: {
    readonly id: string;
    readonly status: 'PENDING' | 'READY' | 'REJECTED';
    readonly mimeType: string | null;
    readonly byteSize: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly rejectionCode: string | null;
  };
}

export interface PortfolioResponse {
  readonly tenantId: string;
  readonly items: readonly PortfolioItemResponse[];
  readonly entitlement: {
    readonly code: 'MAX_PORTFOLIO_IMAGES';
    readonly limit: number;
    readonly used: number;
    readonly remaining: number;
  };
}

export interface PortfolioUploadIntentResponse {
  readonly portfolio: PortfolioResponse;
  readonly upload: {
    readonly mediaAssetId: string;
    readonly method: 'POST';
    readonly url: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly expiresAt: string;
    readonly maxBytes: 15728640;
  };
}

export interface PortfolioUploadCompleteResponse {
  readonly mediaAssetId: string;
  readonly status: 'PENDING';
}

export interface VerifyMediaTaskResponse {
  readonly mediaAssetId: string;
  readonly status: 'READY' | 'REJECTED';
  readonly idempotent: boolean;
}
