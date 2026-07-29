import { describe, expect, it } from 'vitest';

import { normalizeCustomerTagName } from '../src';

describe('customer tag policy', () => {
  it('normalizes display and uniqueness forms without plan-name behavior', () => {
    expect(normalizeCustomerTagName('  ＶＩＰ 客戶  ')).toEqual({
      ok: true,
      displayName: 'VIP 客戶',
      normalizedName: 'vip 客戶',
    });
  });

  it('rejects empty, overlong, control, and format characters', () => {
    expect(normalizeCustomerTagName('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeCustomerTagName('客'.repeat(33))).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(normalizeCustomerTagName('高價值\u0000客戶')).toEqual({
      ok: false,
      reason: 'control_or_format',
    });
    expect(normalizeCustomerTagName('高價值\u200b客戶')).toEqual({
      ok: false,
      reason: 'control_or_format',
    });
  });

  it('fails closed for sensitive classifications after separator folding', () => {
    for (const value of ['醫療需求', '宗教-佛教', '性別 認同', 'National_ID', 'pregnancy']) {
      expect(normalizeCustomerTagName(value)).toEqual({
        ok: false,
        reason: 'sensitive_category',
      });
    }
  });
});
