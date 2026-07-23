import { z } from 'zod';

import { canonicalAppointmentIdSchema, canonicalUtcTimestampSchema } from './appointment-view';

export const appointmentLifecycleIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);

export const consumerCancelReasonSchema = z.enum([
  'CONSUMER_CHANGE_OF_PLANS',
  'CONSUMER_SCHEDULE_CONFLICT',
  'CONSUMER_BOOKED_ELSEWHERE',
  'CONSUMER_OTHER',
]);

export const merchantCancelReasonSchema = z.enum([
  'MERCHANT_CUSTOMER_REQUEST',
  'MERCHANT_STAFF_UNAVAILABLE',
  'MERCHANT_BUSINESS_CLOSURE',
  'MERCHANT_DUPLICATE',
  'MERCHANT_OTHER',
]);

export const rescheduleReasonSchema = z.enum([
  'RESCHEDULE_SCHEDULE_CONFLICT',
  'RESCHEDULE_PREFERENCE_CHANGE',
  'RESCHEDULE_OTHER',
]);

export const consumerCancelAppointmentRequestSchema = z
  .object({ reasonCode: consumerCancelReasonSchema })
  .strict();

export const merchantCancelAppointmentRequestSchema = z
  .object({ reasonCode: merchantCancelReasonSchema })
  .strict();

export const rescheduleAppointmentRequestSchema = z
  .object({
    holdId: z.string().min(1).max(100),
    policyVersion: z.string().regex(/^v2:[0-9a-f]{64}$/),
    policiesAccepted: z.literal(true),
    reasonCode: rescheduleReasonSchema,
  })
  .strict();

export const emptyAppointmentTransitionRequestSchema = z.object({}).strict();

export const bookingPolicyUpdateRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    slotIntervalMinutes: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(20),
      z.literal(30),
      z.literal(60),
    ]),
    minimumLeadMinutes: z.number().int().min(0).max(10_080),
    maximumAdvanceDays: z.number().int().min(1).max(365),
    consumerCancelLeadMinutes: z.number().int().min(0).max(43_200),
    consumerRescheduleLeadMinutes: z.number().int().min(0).max(43_200),
  })
  .strict();

export type ConsumerCancelReason = z.infer<typeof consumerCancelReasonSchema>;
export type MerchantCancelReason = z.infer<typeof merchantCancelReasonSchema>;
export type RescheduleReason = z.infer<typeof rescheduleReasonSchema>;
export type ConsumerCancelAppointmentRequest = z.infer<
  typeof consumerCancelAppointmentRequestSchema
>;
export type MerchantCancelAppointmentRequest = z.infer<
  typeof merchantCancelAppointmentRequestSchema
>;
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentRequestSchema>;
export type BookingPolicyUpdateRequest = z.infer<typeof bookingPolicyUpdateRequestSchema>;

export type ConsumerLifecycleAction = 'CANCEL' | 'RESCHEDULE';
export type MerchantLifecycleAction = 'CANCEL' | 'CHECK_IN' | 'COMPLETE' | 'NO_SHOW';

export interface AppointmentTransitionResponse {
  readonly appointmentId: string;
  readonly status: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'RESCHEDULED';
  readonly occurredAt: string;
  readonly replacementAppointmentId: string | null;
}

export interface BookingPolicyResponse {
  readonly revision: number;
  readonly slotIntervalMinutes: 5 | 10 | 15 | 20 | 30 | 60;
  readonly minimumLeadMinutes: number;
  readonly maximumAdvanceDays: number;
  readonly consumerCancelLeadMinutes: number;
  readonly consumerRescheduleLeadMinutes: number;
  readonly updatedAt: string;
}

export interface ConsumerAppointmentLifecycle {
  readonly evaluatedAt: string;
  readonly allowedActions: readonly ConsumerLifecycleAction[];
}

export interface MerchantAppointmentLifecycle {
  readonly evaluatedAt: string;
  readonly allowedActions: readonly MerchantLifecycleAction[];
  readonly checkInAvailableAt: string;
  readonly completeAvailableAt: string;
  readonly noShowAvailableAt: string;
}

export interface ConsumerRescheduleContext {
  readonly merchantSlug: string;
  readonly serviceId: string;
  readonly locationId: string;
}

export const appointmentTransitionResponseSchema = z
  .object({
    appointmentId: canonicalAppointmentIdSchema,
    status: z.enum(['CANCELLED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED']),
    occurredAt: canonicalUtcTimestampSchema,
    replacementAppointmentId: canonicalAppointmentIdSchema.nullable(),
  })
  .strict();
