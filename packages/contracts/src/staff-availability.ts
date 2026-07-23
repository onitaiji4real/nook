import { z } from 'zod';

const uuidSchema = z.string().uuid();
const displayNameSchema = z.string().trim().min(1).max(120);
const bioSchema = z.string().trim().min(1).max(2000);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => Number(value.slice(3)) % 15 === 0, 'Time must use a 15-minute grid.');
const timestampSchema = z.string().datetime({ offset: true });

const uniqueServiceIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Service IDs must be unique.');

export const staffIdSchema = uuidSchema;
export const availabilityExceptionIdSchema = uuidSchema;

export const createStaffRequestSchema = z
  .object({
    id: staffIdSchema,
    locationId: uuidSchema,
    displayName: displayNameSchema,
    bio: bioSchema.optional(),
    bookingEnabled: z.boolean().default(true),
    serviceIds: uniqueServiceIdsSchema,
  })
  .strict();

export const updateStaffRequestSchema = z
  .object({
    locationId: uuidSchema.optional(),
    displayName: displayNameSchema.optional(),
    bio: z.union([bioSchema, z.null()]).optional(),
    bookingEnabled: z.boolean().optional(),
    serviceIds: uniqueServiceIdsSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one staff field is required.');

export const changeStaffStatusRequestSchema = z
  .object({ status: z.enum(['ACTIVE', 'INACTIVE']) })
  .strict();

export const reorderStaffRequestSchema = z
  .object({
    staffIds: z
      .array(staffIdSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Staff IDs must be unique.'),
  })
  .strict();

export const weeklyAvailabilityRuleSchema = z
  .object({
    id: uuidSchema,
    weekday: z.number().int().min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    validFrom: isoDateSchema,
    validUntil: isoDateSchema.nullable().default(null),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.startTime >= rule.endTime) {
      context.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be later.' });
    }
    if (rule.validUntil !== null && rule.validUntil < rule.validFrom) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Valid until must not be earlier than valid from.',
      });
    }
  });

export const replaceWeeklyAvailabilityRequestSchema = z
  .object({ rules: z.array(weeklyAvailabilityRuleSchema).max(42) })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.rules.map(({ id }) => id)).size !== input.rules.length) {
      context.addIssue({ code: 'custom', path: ['rules'], message: 'Rule IDs must be unique.' });
    }
    for (let left = 0; left < input.rules.length; left += 1) {
      for (let right = left + 1; right < input.rules.length; right += 1) {
        const a = input.rules[left];
        const b = input.rules[right];
        if (a === undefined || b === undefined || a.weekday !== b.weekday) continue;
        const datesOverlap =
          a.validFrom <= (b.validUntil ?? '9999-12-31') &&
          b.validFrom <= (a.validUntil ?? '9999-12-31');
        const timesOverlap = a.startTime < b.endTime && b.startTime < a.endTime;
        if (datesOverlap && timesOverlap) {
          context.addIssue({
            code: 'custom',
            path: ['rules', right],
            message: 'Weekly rules must not overlap.',
          });
        }
      }
    }
  });

export const createAvailabilityExceptionRequestSchema = z
  .object({
    id: availabilityExceptionIdSchema,
    type: z.enum(['TIME_OFF', 'EXTRA_HOURS', 'BLOCK']),
    startAt: timestampSchema,
    endAt: timestampSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((input) => new Date(input.startAt).getTime() < new Date(input.endAt).getTime(), {
    path: ['endAt'],
    message: 'End time must be later.',
  });

export const updateAvailabilityExceptionRequestSchema = z
  .object({
    type: z.enum(['TIME_OFF', 'EXTRA_HOURS', 'BLOCK']).optional(),
    startAt: timestampSchema.optional(),
    endAt: timestampSchema.optional(),
    reason: z.union([z.string().trim().min(1).max(500), z.null()]).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one exception field is required.')
  .superRefine((input, context) => {
    if (
      input.startAt !== undefined &&
      input.endAt !== undefined &&
      new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()
    ) {
      context.addIssue({ code: 'custom', path: ['endAt'], message: 'End time must be later.' });
    }
  });

export const changeAvailabilityExceptionStatusRequestSchema = z
  .object({ status: z.enum(['ACTIVE', 'CANCELLED']) })
  .strict();

export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;
export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>;
export type ChangeStaffStatusRequest = z.infer<typeof changeStaffStatusRequestSchema>;
export type ReorderStaffRequest = z.infer<typeof reorderStaffRequestSchema>;
export type ReplaceWeeklyAvailabilityRequest = z.infer<
  typeof replaceWeeklyAvailabilityRequestSchema
>;
export type CreateAvailabilityExceptionRequest = z.infer<
  typeof createAvailabilityExceptionRequestSchema
>;
export type UpdateAvailabilityExceptionRequest = z.infer<
  typeof updateAvailabilityExceptionRequestSchema
>;
export type ChangeAvailabilityExceptionStatusRequest = z.infer<
  typeof changeAvailabilityExceptionStatusRequestSchema
>;

export interface StaffAvailabilityItem {
  readonly id: string;
  readonly userId: string | null;
  readonly locationId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly bookingEnabled: boolean;
  readonly sortOrder: number;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly serviceIds: readonly string[];
  readonly weeklyRules: readonly z.infer<typeof weeklyAvailabilityRuleSchema>[];
  readonly exceptions: readonly {
    readonly id: string;
    readonly type: 'TIME_OFF' | 'EXTRA_HOURS' | 'BLOCK';
    readonly startAt: string;
    readonly endAt: string;
    readonly reason: string | null;
    readonly status: 'ACTIVE' | 'CANCELLED';
  }[];
}

export interface StaffAvailabilityResponse {
  readonly tenantId: string;
  readonly timezone: 'Asia/Taipei';
  readonly staff: readonly StaffAvailabilityItem[];
  readonly entitlement: {
    readonly code: 'MAX_STAFF';
    readonly limit: number;
    readonly used: number;
    readonly remaining: number;
  };
}
