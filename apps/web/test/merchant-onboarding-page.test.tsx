import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MerchantOnboardingPage } from '../src/features/merchant-onboarding/merchant-onboarding-page';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('merchant onboarding page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <MerchantOnboardingPage />
    </StudioPreviewSessionProvider>,
  );

  it('collects the first profile, location, and service without a fake remote save', () => {
    expect(html).toContain('你的工作室');
    expect(html).toContain('主要服務地點');
    expect(html).toContain('先建立一項服務');
    expect(html).toContain('資料尚未送出');
    expect(html).toContain('目前只在這個頁面記憶；重新整理即清除。');
    expect(html).not.toContain('action=');
  });

  it('defaults private address handling and exposes an honest preview state', () => {
    expect(html).toContain('預設關閉');
    expect(html).toContain('地址保護中');
    expect(html).toContain('尚未開放預約');
    expect(html).toContain('LIVE PREVIEW');
  });

  it('uses semantic labels and Taiwan product defaults', () => {
    expect(html).toContain('name="studioName"');
    expect(html).toContain('name="isPublicAddress"');
    expect(html).toContain('時區固定為台北');
    expect(html).toContain('金額以新台幣整數儲存');
  });
});
