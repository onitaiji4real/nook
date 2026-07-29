import { describe, expect, it } from 'vitest';

import {
  createCustomerNoteRequestSchema,
  customerNoteIdSchema,
  updateCustomerNoteRequestSchema,
} from '../src/customer-notes';

describe('customer note contracts', () => {
  it('accepts bounded UTF-8 content and a canonical update precondition', () => {
    expect(
      createCustomerNoteRequestSchema.parse({ content: '喜歡自然透明感\n避免太厚重。' }),
    ).toEqual({
      content: '喜歡自然透明感\n避免太厚重。',
    });
    expect(
      updateCustomerNoteRequestSchema.parse({
        content: '更新內容',
        expectedUpdatedAt: '2026-07-29T15:00:00.000Z',
      }),
    ).toEqual({
      content: '更新內容',
      expectedUpdatedAt: '2026-07-29T15:00:00.000Z',
    });
  });

  it('rejects empty, overlong, non-canonical, or ambiguous requests', () => {
    expect(createCustomerNoteRequestSchema.safeParse({ content: '' }).success).toBe(false);
    expect(createCustomerNoteRequestSchema.safeParse({ content: ' \n\t ' }).success).toBe(false);
    expect(createCustomerNoteRequestSchema.safeParse({ content: '客'.repeat(2_001) }).success).toBe(
      false,
    );
    expect(
      updateCustomerNoteRequestSchema.safeParse({
        content: '更新內容',
        expectedUpdatedAt: '2026-07-29T15:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      createCustomerNoteRequestSchema.safeParse({ content: '內容', extra: true }).success,
    ).toBe(false);
  });

  it('only accepts canonical lower-case UUID note identifiers', () => {
    expect(customerNoteIdSchema.safeParse('10000000-0000-4000-8000-000000000001').success).toBe(
      true,
    );
    expect(customerNoteIdSchema.safeParse('10000000-0000-4000-8000-00000000000A').success).toBe(
      false,
    );
  });
});
