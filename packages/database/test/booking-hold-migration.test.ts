import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('booking hold migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260722070000_booking_hold_occupancy/migration.sql'),
    'utf8',
  );

  it('uses one shared occupancy ledger with a half-open GiST exclusion constraint', () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(migration).toContain('CREATE TABLE "booking_occupancies"');
    expect(migration).toContain('CONSTRAINT "booking_occupancies_no_overlap"');
    expect(migration).toContain(
      'tstzrange("occupied_start_at", "occupied_end_at", \'[)\') WITH &&',
    );
    expect(migration).toContain('WHERE ("status" = \'ACTIVE\')');
  });

  it('scopes foreign keys and keeps idempotency and rate attempts unique', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id")',
    );
    expect(migration).toContain('"booking_holds_consumer_idempotency_key"');
    expect(migration).toContain('PRIMARY KEY ("consumer_user_id", "window_start", "key_hash")');
  });
});
