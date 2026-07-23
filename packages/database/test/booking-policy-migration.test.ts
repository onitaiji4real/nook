import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('booking policy migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260722060000_booking_policy/migration.sql'),
    'utf8',
  );

  it('backfills every existing tenant and enforces the one-to-one foreign key', () => {
    expect(migration).toMatch(
      /INSERT INTO "booking_policies" \("tenant_id"\)\s+SELECT "id"\s+FROM "tenants"/,
    );
    expect(migration).toContain('PRIMARY KEY ("tenant_id")');
    expect(migration).toContain('REFERENCES "tenants"("id") ON DELETE CASCADE');
  });

  it('keeps policy ranges enforced by PostgreSQL', () => {
    expect(migration).toContain('"slot_interval_minutes" IN (5, 10, 15, 20, 30, 60)');
    expect(migration).toContain('"minimum_lead_minutes" BETWEEN 0 AND 10080');
    expect(migration).toContain('"maximum_advance_days" BETWEEN 1 AND 365');
  });
});
