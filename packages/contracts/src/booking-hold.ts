import { z } from 'zod';

import { merchantSlugSchema } from './merchant-publication';
import { serviceIdSchema } from './service-catalog';
import { staffIdSchema } from './staff-availability';

export { merchantSlugSchema };

export const bookingHoldIdSchema = z.string().uuid();
export const bookingHoldIdempotencyKeySchema = z.string().uuid();

export const createBookingHoldRequestSchema = z
  .object({
    serviceId: serviceIdSchema,
    staffId: staffIdSchema.optional(),
    startAt: z.string().datetime({ offset: false, precision: 3 }),
  })
  .strict();

export type CreateBookingHoldRequest = z.infer<typeof createBookingHoldRequestSchema>;

export interface BookingHoldResponse {
  readonly id: string;
  readonly bookingState: 'HELD';
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'CONSUMED';
  readonly appointmentCreated: false;
  readonly timezone: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly expiresAt: string;
  readonly policies: {
    readonly version: string;
    readonly bookingPolicy: string;
    readonly cancellationPolicy: string;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
    readonly cancelUntil: string;
    readonly rescheduleUntil: string;
    readonly cancelUntilInclusive: boolean;
    readonly rescheduleUntilInclusive: boolean;
  };
  readonly service: {
    readonly id: string;
    readonly name: string;
    readonly durationMinutes: number;
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: string;
  };
  readonly staff: { readonly id: string; readonly displayName: string };
}
