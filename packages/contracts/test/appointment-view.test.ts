import { describe, expect, it } from 'vitest';

import {
  appointmentStatusSchema,
  canonicalAppointmentIdSchema,
  canonicalUtcTimestampSchema,
  consumerAppointmentListQuerySchema,
  merchantAppointmentListQuerySchema,
  type ConsumerAppointmentDetail,
  type MerchantAppointmentSummary,
} from '../src/appointment-view';

const id = 'a0000000-0000-4000-8000-000000000001';

describe('appointment view contract', () => {
  it('accepts the complete appointment status set and canonical identifiers', () => {
    expect(appointmentStatusSchema.options).toEqual([
      'CONFIRMED',
      'CHECKED_IN',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'RESCHEDULED',
    ]);
    expect(canonicalAppointmentIdSchema.safeParse(id).success).toBe(true);
    expect(canonicalAppointmentIdSchema.safeParse(id.toUpperCase()).success).toBe(false);
    expect(canonicalUtcTimestampSchema.safeParse('2026-07-24T03:00:00.000Z').success).toBe(true);
    expect(canonicalUtcTimestampSchema.safeParse('2026-07-24T11:00:00.000+08:00').success).toBe(
      false,
    );
  });

  it('keeps consumer pagination bounded and strict', () => {
    expect(consumerAppointmentListQuerySchema.parse({ view: 'upcoming' })).toEqual({
      view: 'upcoming',
      limit: 20,
    });
    expect(
      consumerAppointmentListQuerySchema.safeParse({ view: 'past', limit: '50' }).success,
    ).toBe(true);
    expect(consumerAppointmentListQuerySchema.safeParse({ view: 'past', limit: 51 }).success).toBe(
      false,
    );
    expect(
      consumerAppointmentListQuerySchema.safeParse({ view: 'past', consumerUserId: id }).success,
    ).toBe(false);
  });

  it('requires an exact UTC calendar window no longer than 31 elapsed days', () => {
    const query = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    };
    expect(merchantAppointmentListQuerySchema.safeParse(query).success).toBe(true);
    expect(
      merchantAppointmentListQuerySchema.safeParse({
        ...query,
        to: '2026-08-01T00:00:00.001Z',
      }).success,
    ).toBe(false);
    expect(
      merchantAppointmentListQuerySchema.safeParse({ ...query, source: 'MARKETPLACE' }).success,
    ).toBe(false);
  });

  it('keeps consumer detail and merchant summary allowlists intentionally different', () => {
    const base = {
      id,
      status: 'CONFIRMED',
      pricingStatus: 'EXACT',
      paymentStatus: 'NOT_REQUIRED',
      timezone: 'Asia/Taipei',
      startAt: '2026-07-24T03:00:00.000Z',
      endAt: '2026-07-24T04:00:00.000Z',
      confirmedAt: '2026-07-22T03:00:00.000Z',
      currency: 'TWD',
      subtotalAmount: 1200,
      depositAmount: 0,
      totalAmount: 1200,
      service: {
        id,
        name: '凝膠服務',
        durationMinutes: 60,
        priceType: 'FIXED',
        priceAmount: 1200,
        priceMin: null,
        priceMax: null,
        currency: 'TWD',
      },
      staff: { id, displayName: 'Yun' },
    } as const;
    const consumer = {
      ...base,
      policies: {
        version: `v1:${'a'.repeat(64)}`,
        bookingPolicy: '完全預約制',
        cancellationPolicy: '提前24小時',
        acceptedAt: '2026-07-22T03:00:00.000Z',
        consumerCancelLeadMinutes: 1_440,
        consumerRescheduleLeadMinutes: 1_440,
        cancelUntil: '2026-07-23T03:00:00.000Z',
        rescheduleUntil: '2026-07-23T03:00:00.000Z',
        cancelUntilInclusive: true,
        rescheduleUntilInclusive: true,
      },
      location: {
        name: '主要工作室',
        addressText: '台北市測試路1號',
        postalCode: '106',
        city: '台北市',
        district: '大安區',
      },
      history: [
        { fromStatus: null, toStatus: 'CONFIRMED', createdAt: base.confirmedAt, reasonCode: null },
      ],
      lifecycle: {
        evaluatedAt: '2026-07-22T12:00:00.000Z',
        allowedActions: ['CANCEL', 'RESCHEDULE'],
      },
      rescheduleContext: { merchantSlug: 'nook', serviceId: id, locationId: id },
    } satisfies ConsumerAppointmentDetail;
    const merchant = {
      ...base,
      source: 'MERCHANT_LINK',
      consumer: { displayName: '顧客A' },
      location: { name: '主要工作室', city: '台北市', district: '大安區' },
    } satisfies MerchantAppointmentSummary;
    expect('source' in consumer).toBe(false);
    expect('addressText' in merchant.location).toBe(false);
    expect(consumer.location.addressText).toContain('測試路');
  });
});
