import { z } from 'zod';

import { serviceIdSchema } from './service-catalog';
import { staffIdSchema } from './staff-availability';

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    );
  }, 'Date must be a real calendar date.');

export const availabilityQuerySchema = z
  .object({
    serviceId: serviceIdSchema,
    staffId: staffIdSchema.optional(),
    date: localDateSchema,
    days: z.coerce.number().int().min(1).max(7).default(1),
  })
  .strict();

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface PublicAvailabilityResponse {
  readonly timezone: string;
  readonly generatedAt: string;
  readonly reservation: false;
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
  };
  readonly staff: readonly {
    readonly id: string;
    readonly displayName: string;
  }[];
  readonly slots: readonly {
    readonly startAt: string;
    readonly endAt: string;
    readonly eligibleStaffIds: readonly string[];
  }[];
}
