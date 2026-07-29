import { describe, expect, it } from 'vitest';

import {
  changeCustomerTagDefinitionStatusRequestSchema,
  createCustomerTagDefinitionRequestSchema,
  customerTagIdSchema,
} from '../src/customer-tags';

describe('customer tag contracts', () => {
  it('accepts bounded names and exact status payloads', () => {
    expect(createCustomerTagDefinitionRequestSchema.parse({ name: 'VIP 客戶' })).toEqual({
      name: 'VIP 客戶',
    });
    expect(changeCustomerTagDefinitionStatusRequestSchema.parse({ status: 'INACTIVE' })).toEqual({
      status: 'INACTIVE',
    });
  });

  it('rejects overlong or ambiguous request shapes', () => {
    expect(
      createCustomerTagDefinitionRequestSchema.safeParse({ name: '客'.repeat(33) }).success,
    ).toBe(false);
    expect(
      createCustomerTagDefinitionRequestSchema.safeParse({ name: 'VIP', extra: true }).success,
    ).toBe(false);
    expect(
      changeCustomerTagDefinitionStatusRequestSchema.safeParse({
        status: 'ACTIVE',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('only accepts canonical lower-case UUID tag identifiers', () => {
    expect(customerTagIdSchema.safeParse('10000000-0000-4000-8000-000000000001').success).toBe(
      true,
    );
    expect(customerTagIdSchema.safeParse('10000000-0000-4000-8000-00000000000A').success).toBe(
      false,
    );
  });
});
