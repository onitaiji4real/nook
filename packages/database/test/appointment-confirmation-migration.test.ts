import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('appointment confirmation migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260722080000_appointment_confirmation/migration.sql',
    ),
    'utf8',
  );
  const relationMigration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260722081000_appointment_prisma_relation_fks/migration.sql',
    ),
    'utf8',
  );

  it('expands shared occupancy to exactly one hold or appointment owner', () => {
    expect(migration).toContain('ALTER COLUMN "hold_id" DROP NOT NULL');
    expect(migration).toContain('ADD COLUMN "appointment_id" UUID');
    expect(migration).toContain('CONSTRAINT "booking_occupancies_owner_check"');
    expect(migration).toContain('("hold_id" IS NOT NULL AND "appointment_id" IS NULL) OR');
    expect(migration).toContain('("hold_id" IS NULL AND "appointment_id" IS NOT NULL)');
    expect(migration).toContain('"booking_occupancies_appointment_fkey"');
    expect(migration).toContain('"tenant_id", "staff_id", "appointment_id"');
  });

  it('retains composite ownership while supporting nullable Prisma relations', () => {
    expect(relationMigration).toContain("conname = 'appointments_hold_id_fkey'");
    expect(relationMigration).toContain("conname = 'booking_occupancies_appointment_id_fkey'");
    expect(relationMigration).toContain('FOREIGN KEY ("appointment_id")');
  });

  it('protects consumer ownership, confirmation idempotency, and outbox dedupe', () => {
    expect(migration).toContain('"booking_holds_tenant_consumer_id_key"');
    expect(migration).toContain('"appointments_owned_hold_fkey"');
    expect(migration).toContain('"appointment_confirmation_keys_owned_appointment_fkey"');
    expect(migration).toContain('PRIMARY KEY ("consumer_user_id", "key_hash")');
    expect(migration).toContain('"outbox_events_dedupe_key_key"');
  });

  it('keeps no-deposit and truthful price shapes database-enforced', () => {
    expect(migration).toContain('CONSTRAINT "appointments_no_deposit_check"');
    expect(migration).toContain('CONSTRAINT "appointments_pricing_check"');
    expect(migration).toContain('CONSTRAINT "appointment_items_price_check"');
    expect(migration).toContain('"price_amount_snapshot" >= 0');
    expect(migration).toContain('"price_max_snapshot" >= "price_min_snapshot"');
  });

  it('backfills a validated usage timezone and a generic monthly limit', () => {
    expect(migration).toContain('FROM pg_timezone_names AS timezone');
    expect(migration).toContain('ADD COLUMN "usage_timezone"');
    expect(migration).toContain("'MAX_MONTHLY_BOOKINGS'");
    expect(migration).toContain('WHERE "is_default" = true');
    expect(migration).toContain("indexname = 'plans_single_default_key'");
  });
});
