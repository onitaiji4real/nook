import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('appointment view migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260722090000_appointment_views_indexes/migration.sql',
    ),
    'utf8',
  );

  it('adds only the three bounded appointment read indexes', () => {
    expect(migration.match(/CREATE INDEX/g)).toHaveLength(3);
    expect(migration).toContain(
      '"appointments_consumer_start_id_idx"\nON "appointments" ("consumer_user_id", "start_at", "id")',
    );
    expect(migration).toContain(
      '"appointments_tenant_start_id_idx"\nON "appointments" ("tenant_id", "start_at", "id")',
    );
    expect(migration).toContain(
      '"appointments_tenant_staff_start_id_idx"\nON "appointments" ("tenant_id", "staff_id", "start_at", "id")',
    );
    expect(migration).not.toMatch(/ALTER TABLE|UPDATE|DELETE|INSERT/);
  });
});
