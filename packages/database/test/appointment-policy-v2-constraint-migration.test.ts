import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260723010000_appointment_policy_v2_constraint/migration.sql',
  ),
  'utf8',
);

describe('appointment v2 policy constraint follow-up migration', () => {
  it('replaces the v1-only appointment policy constraint with an explicit v1/v2 reader', () => {
    expect(migration).toContain('DROP CONSTRAINT "appointments_policy_check"');
    expect(migration).toContain('"policy_version" ~ \'^v[12]:[0-9a-f]{64}$\'');
    expect(migration).toContain('"policies_accepted_at" = "confirmed_at"');
  });
});
