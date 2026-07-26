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
export const membershipRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'VIEWER']);
export const membershipStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED']);
export const tenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']);

export const meMembershipSchema = z
  .object({
    membershipId: z.string().uuid(),
    tenantId: tenantIdSchema,
    tenantName: z.string().min(1),
    tenantSlug: z.string().min(1),
    tenantStatus: z.literal('ACTIVE'),
    tenantTimezone: z.string().min(1),
    role: membershipRoleSchema,
    status: z.literal('ACTIVE'),
  })
  .strict();

export const meResponseSchema = z
  .object({
    id: z.string().uuid(),
    memberships: z.array(meMembershipSchema).readonly(),
  })
  .strict();

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

export type MeResponse = z.infer<typeof meResponseSchema>;
