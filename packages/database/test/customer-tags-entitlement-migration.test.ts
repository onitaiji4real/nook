import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('customer tags entitlement migration', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260728020000_customer_tags_entitlement/migration.sql',
    ),
    'utf8',
  );

  it('adds a generic boolean entitlement with a fail-closed default', () => {
    expect(migration).toContain("'CUSTOMER_TAGS'");
    expect(migration).toContain("'BOOLEAN'");
    expect(migration).toContain("'false'::jsonb");
    expect(migration).toContain('"plan_entitlements_customer_tags_check"');
    expect(migration).toContain('jsonb_typeof("value_json") = \'boolean\'');
  });

  it('does not branch on a paid plan name or destructively rewrite data', () => {
    expect(migration).not.toMatch(/PERSONAL|PROFESSIONAL|STUDIO/);
    expect(migration).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/);
  });
});
