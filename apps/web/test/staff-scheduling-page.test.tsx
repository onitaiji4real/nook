import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StaffSchedulingPage } from '../src/features/staff-scheduling/staff-scheduling-page';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('staff scheduling page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <StaffSchedulingPage />
    </StudioPreviewSessionProvider>,
  );

  it('shows entitlement-driven staff selection and weekly scheduling controls', () => {
    expect(html).toContain('MAX_STAFF');
    expect(html).toContain('1 / 1');
    expect(html).toContain('Mia');
    expect(html).toContain('Lin');
    expect(html).toContain('15 分鐘一格');
    expect(html).toContain('aria-label="週一開始時間"');
    expect(html).toContain('＋ 時段');
  });

  it('offers exception creation and cancellation without claiming a remote save', () => {
    expect(html).toContain('休假、加開或保留');
    expect(html).toContain('name="exceptionStart"');
    expect(html).toContain('取消但保留紀錄');
    expect(html).toContain('重新整理即還原');
    expect(html).not.toContain('遠端儲存成功');
  });

  it('links all merchant workspace routes and states the secured API boundary', () => {
    expect(html).toContain('href="/studio/onboarding"');
    expect(html).toContain('href="/studio/services"');
    expect(html).toContain('href="/studio/staff"');
    expect(html).toContain('RBAC、租戶隔離、MAX_STAFF與UTC');
  });
});
