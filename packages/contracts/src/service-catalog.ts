import { z } from 'zod';

import { servicePriceSchema } from './merchant-onboarding';

const serviceName = z.string().trim().min(1).max(160);
const optionalDescription = z.string().trim().min(1).max(2000).optional();
const durationMinutes = z.number().int().min(5).max(720);
const bufferMinutes = z.number().int().min(0).max(180);

export const serviceIdSchema = z.string().uuid();

export const createServiceRequestSchema = z
  .object({
    id: serviceIdSchema,
    name: serviceName,
    description: optionalDescription,
    durationMinutes,
    bufferBeforeMinutes: bufferMinutes.default(0),
    bufferAfterMinutes: bufferMinutes.default(0),
    price: servicePriceSchema,
    bookingEnabled: z.boolean().default(true),
  })
  .strict();

export const updateServiceRequestSchema = z
  .object({
    name: serviceName.optional(),
    description: z.union([z.string().trim().min(1).max(2000), z.null()]).optional(),
    durationMinutes: durationMinutes.optional(),
    bufferBeforeMinutes: bufferMinutes.optional(),
    bufferAfterMinutes: bufferMinutes.optional(),
    price: servicePriceSchema.optional(),
    bookingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one service field is required.');

export const changeServiceStatusRequestSchema = z
  .object({ status: z.enum(['ACTIVE', 'INACTIVE']) })
  .strict();

export const reorderServicesRequestSchema = z
  .object({
    serviceIds: z
      .array(serviceIdSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Service IDs must be unique.'),
  })
  .strict();

export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;
export type ChangeServiceStatusRequest = z.infer<typeof changeServiceStatusRequestSchema>;
export type ReorderServicesRequest = z.infer<typeof reorderServicesRequestSchema>;

export interface ServiceCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly price: z.infer<typeof servicePriceSchema>;
  readonly currency: 'TWD';
  readonly bookingEnabled: boolean;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly sortOrder: number;
}

export interface ServiceCatalogResponse {
  readonly tenantId: string;
  readonly services: readonly ServiceCatalogItem[];
  readonly entitlement: {
    readonly code: 'MAX_SERVICES';
    readonly limit: number;
    readonly used: number;
    readonly remaining: number;
  };
}
