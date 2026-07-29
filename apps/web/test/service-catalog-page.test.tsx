import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ServiceCatalogPage } from '../src/features/service-catalog/service-catalog-page';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('service catalog page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <ServiceCatalogPage />
    </StudioPreviewSessionProvider>,
  );

  it('shows an entitlement-driven catalog instead of a plan-name branch', () => {
    expect(html).toContain('MAX_SERVICES');
    expect(html).toContain('2<small> / 5');
    expect(html).toContain('只計算 ACTIVE 服務');
    expect(html).not.toContain('if plan');
  });

  it('offers local add, edit, status, and ordering controls honestly', () => {
    expect(html).toContain('＋ 新增服務');
    expect(html).toContain('更新本機預覽');
    expect(html).toContain('停用此服務');
    expect(html).toContain('aria-label="上移 單色凝膠"');
    expect(html).toContain('重新整理即還原');
    expect(html).not.toContain('遠端儲存成功');
  });

  it('links the merchant workspace routes and describes the secured API boundary', () => {
    expect(html).toContain('href="/studio/onboarding"');
    expect(html).toContain('href="/studio/services"');
    expect(html).toContain('登入後才會送出API');
  });
});
