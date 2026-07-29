import { describe, expect, it } from 'vitest';

import {
  merchantSlugSchema,
  merchantVisibilityRequestSchema,
  portfolioPublicationRequestSchema,
} from '../src';

describe('merchant publication contracts', () => {
  it('accepts canonical slugs and bounded lifecycle transitions', () => {
    expect(merchantSlugSchema.parse('atelier-nook')).toBe('atelier-nook');
    expect(merchantVisibilityRequestSchema.parse({ visibilityStatus: 'PUBLISHED' })).toEqual({
      visibilityStatus: 'PUBLISHED',
    });
    expect(portfolioPublicationRequestSchema.parse({ status: 'HIDDEN' })).toEqual({
      status: 'HIDDEN',
    });
  });

  it.each(['Uppercase', '../private', 'space here', 'a', 'trailing-'])(
    'rejects an unsafe slug: %s',
    (slug) => {
      expect(merchantSlugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it('rejects suspended self-restoration and unknown fields at the HTTP boundary', () => {
    expect(
      merchantVisibilityRequestSchema.safeParse({ visibilityStatus: 'SUSPENDED' }).success,
    ).toBe(false);
    expect(portfolioPublicationRequestSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
    expect(
      merchantVisibilityRequestSchema.safeParse({ visibilityStatus: 'DRAFT', tenantId: 'leak' })
        .success,
    ).toBe(false);
  });
});
