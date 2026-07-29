import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConsumerAppointmentsPage } from '../src/features/appointment-views/consumer-appointments-page';
import {
  previewConsumerDetail,
  previewConsumerUpcoming,
  previewMerchantAppointments,
  previewMerchantDetail,
} from '../src/features/appointment-views/preview-appointments';
import { MerchantCalendarPage } from '../src/features/appointment-views/merchant-calendar-page';
import { BookingPolicyPage } from '../src/features/appointment-views/booking-policy-page';
import { ConsumerSessionProvider } from '../src/features/merchant-public/consumer-session-provider';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('appointment views', () => {
  it('labels the consumer preview truthfully and exposes upcoming/history navigation', () => {
    const html = renderToStaticMarkup(
      <ConsumerSessionProvider preview>
        <ConsumerAppointmentsPage />
      </ConsumerSessionProvider>,
    );
    expect(html).toContain('LOCAL PREVIEW');
    expect(html).toContain('即將到來');
    expect(html).toContain('過去紀錄');
    expect(html).toContain('不代表LINE通知已送達');
  });

  it('keeps confirmed address and policy fields out of merchant detail', () => {
    const consumer = previewConsumerDetail(previewConsumerUpcoming[0]!);
    const merchant = previewMerchantDetail(previewMerchantAppointments[0]!);
    expect(consumer.location.addressText).toBeTruthy();
    expect(consumer.policies.bookingPolicy).toBeTruthy();
    expect(merchant).not.toHaveProperty('location.addressText');
    expect(merchant).not.toHaveProperty('policies');
    expect(typeof merchant.consumer.displayName).toBe('string');
  });

  it('renders a tenant calendar preview without claiming real customer data', () => {
    const html = renderToStaticMarkup(
      <StudioPreviewSessionProvider>
        <MerchantCalendarPage />
      </StudioPreviewSessionProvider>,
    );
    expect(html).toContain('APPOINTMENT DESK');
    expect(html).toContain('7 DAY WINDOW');
    expect(html).toContain('服務人員');
    expect(html).toContain('合成資料，不會讀取顧客或真實預約');
  });

  it('uses a stable staff identity so cross-filtering keeps every Yun appointment', () => {
    const yunAppointments = previewMerchantAppointments.filter(
      (appointment) => appointment.staff.displayName === 'Yun',
    );

    expect(yunAppointments).toHaveLength(2);
    expect(new Set(yunAppointments.map((appointment) => appointment.staff.id)).size).toBe(1);
    expect(
      yunAppointments.filter((appointment) => appointment.status === 'CHECKED_IN'),
    ).toHaveLength(1);
  });

  it('exposes the structured booking-policy workspace in preview mode', () => {
    const html = renderToStaticMarkup(
      <StudioPreviewSessionProvider>
        <BookingPolicyPage />
      </StudioPreviewSessionProvider>,
    );

    expect(html).toContain('BOOKING RULES');
    expect(html).toContain('規則會在顧客保留時段時快照保存');
    expect(html).toContain('正在讀取');
  });
});
