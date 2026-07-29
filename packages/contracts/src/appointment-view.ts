import { z } from 'zod';

import type {
  ConsumerAppointmentLifecycle,
  ConsumerRescheduleContext,
  MerchantAppointmentLifecycle,
} from './appointment-lifecycle';

export const appointmentStatusSchema = z.enum([
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

export const appointmentViewSchema = z.enum(['upcoming', 'past']);

export const canonicalAppointmentIdSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());

export const canonicalUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  });

const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const consumerAppointmentListQuerySchema = z
  .object({
    view: appointmentViewSchema,
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const merchantAppointmentListQuerySchema = z
  .object({
    from: canonicalUtcTimestampSchema,
    to: canonicalUtcTimestampSchema,
    staffId: canonicalAppointmentIdSchema.optional(),
    status: appointmentStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: cursorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    if (from >= to || to - from > 31 * 24 * 60 * 60 * 1_000) {
      context.addIssue({ code: 'custom', message: 'Appointment calendar range is invalid.' });
    }
  });

export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type AppointmentView = z.infer<typeof appointmentViewSchema>;
export type ConsumerAppointmentListQuery = z.infer<typeof consumerAppointmentListQuerySchema>;
export type MerchantAppointmentListQuery = z.infer<typeof merchantAppointmentListQuerySchema>;

export interface AppointmentServiceSnapshot {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
  readonly priceAmount: number | null;
  readonly priceMin: number | null;
  readonly priceMax: number | null;
  readonly currency: string;
}

export interface AppointmentStaffSnapshot {
  readonly id: string;
  readonly displayName: string;
}

export interface AppointmentLocationSummary {
  readonly name: string;
  readonly city: string;
  readonly district: string;
}

export interface AppointmentHistoryItem {
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus;
  readonly createdAt: string;
  readonly reasonCode:
    | 'CONSUMER_CHANGE_OF_PLANS'
    | 'CONSUMER_SCHEDULE_CONFLICT'
    | 'CONSUMER_BOOKED_ELSEWHERE'
    | 'CONSUMER_OTHER'
    | 'MERCHANT_CUSTOMER_REQUEST'
    | 'MERCHANT_STAFF_UNAVAILABLE'
    | 'MERCHANT_BUSINESS_CLOSURE'
    | 'MERCHANT_DUPLICATE'
    | 'MERCHANT_OTHER'
    | 'RESCHEDULE_SCHEDULE_CONFLICT'
    | 'RESCHEDULE_PREFERENCE_CHANGE'
    | 'RESCHEDULE_OTHER'
    | null;
}

export interface ConsumerAppointmentSummary {
  readonly id: string;
  readonly status: AppointmentStatus;
  readonly pricingStatus: 'EXACT' | 'ESTIMATE' | 'QUOTE_REQUIRED';
  readonly paymentStatus: 'NOT_REQUIRED';
  readonly timezone: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly confirmedAt: string;
  readonly currency: string;
  readonly subtotalAmount: number | null;
  readonly depositAmount: 0;
  readonly totalAmount: number | null;
  readonly service: AppointmentServiceSnapshot;
  readonly staff: AppointmentStaffSnapshot;
  readonly location: AppointmentLocationSummary;
}

export interface ConsumerAppointmentDetail extends Omit<ConsumerAppointmentSummary, 'location'> {
  readonly policies: {
    readonly version: string;
    readonly bookingPolicy: string;
    readonly cancellationPolicy: string;
    readonly acceptedAt: string;
    readonly consumerCancelLeadMinutes: number;
    readonly consumerRescheduleLeadMinutes: number;
    readonly cancelUntil: string;
    readonly rescheduleUntil: string;
    readonly cancelUntilInclusive: boolean;
    readonly rescheduleUntilInclusive: boolean;
  };
  readonly location: AppointmentLocationSummary & {
    readonly addressText: string;
    readonly postalCode: string | null;
  };
  readonly history: readonly AppointmentHistoryItem[];
  readonly lifecycle: ConsumerAppointmentLifecycle;
  readonly rescheduleContext: ConsumerRescheduleContext | null;
}

export interface MerchantAppointmentSummary extends ConsumerAppointmentSummary {
  readonly source: 'MERCHANT_LINK' | 'MARKETPLACE' | 'ADMIN' | 'STAFF' | 'IMPORT';
  readonly consumer: { readonly displayName: string };
}

export interface MerchantAppointmentDetail extends MerchantAppointmentSummary {
  readonly history: readonly AppointmentHistoryItem[];
  readonly lifecycle: MerchantAppointmentLifecycle;
}

export interface ConsumerAppointmentListResponse {
  readonly asOf: string;
  readonly items: readonly ConsumerAppointmentSummary[];
  readonly nextCursor: string | null;
}

export interface MerchantAppointmentListResponse {
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly calendarTimezone: string;
  readonly items: readonly MerchantAppointmentSummary[];
  readonly nextCursor: string | null;
}
