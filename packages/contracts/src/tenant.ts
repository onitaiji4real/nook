import { z } from 'zod';

export const createTenantRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export const tenantIdSchema = z.string().uuid();

export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export interface TenantResponse {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly membership: {
    readonly role: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';
    readonly status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
  };
}

export interface MeResponse {
  readonly id: string;
  readonly memberships: ReadonlyArray<{
    readonly tenantId: string;
    readonly tenantName: string;
    readonly tenantSlug: string;
    readonly tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
    readonly tenantTimezone: string;
    readonly role: 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';
    readonly status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
  }>;
}
