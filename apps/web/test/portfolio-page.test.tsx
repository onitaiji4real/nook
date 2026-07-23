import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PortfolioPage } from '../src/features/portfolio/portfolio-page';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('portfolio page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <PortfolioPage />
    </StudioPreviewSessionProvider>,
  );

  it('shows an entitlement-driven contact sheet and controlled file input', () => {
    expect(html).toContain('MAX_PORTFOLIO_IMAGES');
    expect(html).toContain('4<i>/20</i>');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('鏡面銀・短甲');
    expect(html).toContain('需重傳');
  });

  it('provides metadata, ordering and removal controls without claiming a remote upload', () => {
    expect(html).toContain('最多 10 個');
    expect(html).toContain('← 往前');
    expect(html).toContain('移除作品');
    expect(html).toContain('重新整理即還原');
    expect(html).toContain('登入後才會正式儲存');
    expect(html).not.toContain('上傳成功');
  });

  it('links the complete merchant workspace', () => {
    expect(html).toContain('href="/studio/onboarding"');
    expect(html).toContain('href="/studio/services"');
    expect(html).toContain('href="/studio/staff"');
    expect(html).toContain('href="/studio/portfolio"');
  });
});
