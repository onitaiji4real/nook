import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerCrmPage } from '../src/features/customer-crm/customer-crm-page';
import {
  previewCustomerDetail,
  previewCustomers,
} from '../src/features/customer-crm/preview-customers';
import { StudioPreviewSessionProvider } from '../src/features/studio-session/studio-session-provider';

describe('customer CRM page', () => {
  const html = renderToStaticMarkup(
    <StudioPreviewSessionProvider>
      <CustomerCrmPage />
    </StudioPreviewSessionProvider>,
  );

  it('labels preview records as synthetic appointment-backed data', () => {
    expect(html).toContain('CLIENT REGISTER · APPOINTMENT-BACKED');
    expect(html).toContain('LOCAL PREVIEW');
    expect(html).toContain('合成顧客資料');
    expect(html).toContain('營運關係 ≠ 行銷同意');
    expect(html).toContain('尚無可確認消費金額');
    expect(html).toContain('陳小美');
    expect(html).not.toContain('上傳成功');
  });

  it('does not invent contact, notes or spend in preview details', () => {
    const detail = previewCustomerDetail(previewCustomers[0]!.id);

    expect(detail?.contact).toEqual({ phone: null, email: null, source: null });
    expect(detail?.notes).toEqual([]);
    expect(detail?.customer.totalSpent).toBeNull();
    expect(detail?.customer.spendStatus).toBe('UNKNOWN');
  });
});
