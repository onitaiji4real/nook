import { describe, expect, it } from 'vitest';

import { customerIdSchema, customerListQuerySchema } from '../src/customer-crm';

describe('customer CRM contracts', () => {
  it('applies the bounded list default and accepts a canonical cursor', () => {
    expect(customerListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(customerListQuerySchema.parse({ limit: '100', cursor: 'eyJ2IjoxfQ' })).toEqual({
      limit: 100,
      cursor: 'eyJ2IjoxfQ',
    });
  });

  it('rejects unbounded, malformed, and ambiguous list input', () => {
    expect(customerListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ cursor: 'not a cursor' }).success).toBe(false);
    expect(customerListQuerySchema.safeParse({ extra: 'value' }).success).toBe(false);
  });

  it('only accepts canonical lower-case UUID customer identifiers', () => {
    expect(customerIdSchema.safeParse('10000000-0000-4000-8000-000000000001').success).toBe(true);
    expect(customerIdSchema.safeParse('10000000-0000-4000-8000-00000000000A').success).toBe(false);
  });
});
