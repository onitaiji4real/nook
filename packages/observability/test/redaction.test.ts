import { describe, expect, it } from 'vitest';

import { redactValue } from '../src';

describe('redactValue', () => {
  it('redacts secrets, PII, and database URLs recursively', () => {
    const databaseUrl = 'postgresql://nook:password@localhost:5432/nook';
    const serialized = JSON.stringify(
      redactValue({
        databaseUrl,
        message: `connection failed for ${databaseUrl}`,
        nested: { email: 'customer@example.com', authorization: 'Bearer abc.def' },
      }),
    );

    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('abc.def');
    expect(serialized).toContain('[REDACTED]');
  });
});
