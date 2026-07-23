import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MerchantPublicPage } from '../src/features/merchant-public/merchant-public-page';
import { consumerHoldBlockedLabel } from '../src/features/merchant-public/availability-picker';
import { previewMerchant } from '../src/features/merchant-public/preview-data';

describe('merchant public page', () => {
  const html = renderToStaticMarkup(<MerchantPublicPage merchant={previewMerchant} preview />);

  it('renders a useful merchant storefront and truthful availability boundary', () => {
    expect(html).toContain('留白製甲所');
    expect(html).toContain('手部單色凝膠');
    expect(html).toContain('NT$ 1,200');
    expect(html).toContain('即時查看候選時段');
    expect(html).toContain('查看候選時段');
    expect(html).toContain('尚未保留');
    expect(html).toContain('<form');
  });

  it('labels synthetic preview and respects district-only address disclosure', () => {
    expect(html).toContain('LOCAL PREVIEW');
    expect(html).toContain('台北市 大安區');
    expect(html).toContain('完整地址將於預約成立後提供');
    expect(html).not.toContain('106');
  });

  it('blocks hold creation while browser identity is unavailable', () => {
    expect(consumerHoldBlockedLabel('config-loading')).toBe('正在準備 LINE 登入…');
    expect(consumerHoldBlockedLabel('signing-in')).toBe('LINE 登入中…');
    expect(consumerHoldBlockedLabel('not-configured')).toBe('LINE 登入尚未設定');
    expect(consumerHoldBlockedLabel('degraded')).toBe('登入服務暫時不可用');
    expect(consumerHoldBlockedLabel('signed-out')).toBeNull();
    expect(consumerHoldBlockedLabel('ready')).toBeNull();
    expect(consumerHoldBlockedLabel('local-preview')).toBeNull();
  });

  it('renders a distinct reschedule flow without claiming the old appointment changed', () => {
    const rescheduleHtml = renderToStaticMarkup(
      <MerchantPublicPage
        bookingIntent={{
          serviceId: previewMerchant.services[0]!.id,
          locationId: '70000000-0000-4000-8000-000000000001',
          rescheduleAppointmentId: '50000000-0000-4000-8000-000000000001',
        }}
        merchant={previewMerchant}
        preview
      />,
    );

    expect(rescheduleHtml).toContain('為原預約換一段時間');
    expect(rescheduleHtml).toContain('RESCHEDULE');
    expect(rescheduleHtml).toContain('確認前原預約維持不變');
  });
});
