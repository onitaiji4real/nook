import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublicationPage } from '../src/features/publication/publication-page';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('publication page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <PublicationPage />
    </StudioPreviewSessionProvider>,
  );

  it('shows every server-owned readiness dimension without a fake publish success', () => {
    expect(html).toContain('PROFILE_CONTENT');
    expect(html).toContain('ACTIVE_LOCATION');
    expect(html).toContain('ACTIVE_SERVICE');
    expect(html).toContain('ACTIVE_STAFF');
    expect(html).toContain('WEEKLY_AVAILABILITY');
    expect(html).toContain('PUBLISHED_PORTFOLIO');
    expect(html).toContain('還有門檻未完成');
  });

  it('keeps preview publishing disabled and explains the public allowlist', () => {
    expect(html).toContain('LOCAL PREVIEW');
    expect(html).toContain('disabled=""');
    expect(html).toContain('私人電話');
    expect(html).toContain('儲存路徑');
  });

  it('links each incomplete gate to the responsible Studio workspace', () => {
    expect(html).toContain('href="/studio/onboarding"');
    expect(html).toContain('href="/studio/services"');
    expect(html).toContain('href="/studio/staff"');
    expect(html).toContain('href="/studio/portfolio"');
  });
});
