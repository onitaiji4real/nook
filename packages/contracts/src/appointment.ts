import { z } from 'zod';

export const appointmentIdempotencyKeySchema = z.string().uuid();
export const appointmentPolicyVersionSchema = z.string().regex(/^v[12]:[0-9a-f]{64}$/);

export const createAppointmentRequestSchema = z
  .object({
    holdId: z.string().min(1).max(100),
    policiesAccepted: z.literal(true),
    policyVersion: appointmentPolicyVersionSchema,
  })
  .strict();

export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

export interface AppointmentResponse {
  readonly id: string;
  readonly appointmentCreated: true;
  readonly status: 'CONFIRMED';
  readonly source: 'MERCHANT_LINK' | 'MARKETPLACE' | 'ADMIN' | 'STAFF' | 'IMPORT';
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
  readonly location: {
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
  };
}
