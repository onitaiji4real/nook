import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarketingPage } from '../src/features/marketing/marketing-page';

describe('marketing page', () => {
  const html = renderToStaticMarkup(<MarketingPage />);

  it('states the product value and current launch status honestly', () => {
    expect(html).toContain('把空檔，');
    expect(html).toContain('顧客不用再下載一個 App');
    expect(html).toContain('尚未開放註冊或收費');
    expect(html).toContain('申請尚未開放');
  });

  it('publishes the planned pricing and attribution rules', () => {
    expect(html).toContain('個人版');
    expect(html).toContain('399');
    expect(html).toContain('專業版');
    expect(html).toContain('899');
    expect(html).toContain('平台首次媒合');
    expect(html).toContain('上限 NT$250');
    expect(html).toContain('產品規劃價');
  });

  it('provides semantic navigation and a keyboard skip link without dead signup links', () => {
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="主要導覽"');
    expect(html).toContain('href="#flow"');
    expect(html).toContain('href="#pricing"');
    expect(html).toContain('href="/studio/onboarding"');
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain('<form');
  });
});
