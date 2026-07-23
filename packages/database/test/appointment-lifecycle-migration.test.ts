import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('appointment lifecycle migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260722100000_appointment_lifecycle/migration.sql'),
    'utf8',
  );

  it('keeps mixed-version writers compatible with bounded lead snapshots', () => {
    expect(migration.match(/NOT NULL DEFAULT 1440/g)).toHaveLength(6);
    expect(migration).toContain('"consumer_cancel_lead_minutes" BETWEEN 0 AND 43200');
    expect(migration).toContain('"consumer_reschedule_lead_minutes_snapshot" BETWEEN 0 AND 43200');
    expect(migration).toContain('SELECT "id", 15, 120, 60, 1440, 1440, 1');
    expect(migration).toContain('ON CONFLICT ("tenant_id") DO NOTHING');
  });

  it('tenant- and consumer-scopes both immutable reschedule links', () => {
    expect(migration).toContain('"appointments_reschedule_link_pair_check"');
    expect(migration).toContain('"appointments_rescheduled_from_not_self_check"');
    expect(migration).toContain('"appointments_rescheduled_from_id_key"');
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "consumer_user_id", "rescheduled_from_id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "consumer_user_id", "reschedule_root_id")',
    );
  });

  it('uses controlled reasons without deleting the legacy free-text column', () => {
    expect(migration).toContain('CREATE TYPE "AppointmentReasonCode"');
    expect(migration).toContain('ADD COLUMN "reason_code" "AppointmentReasonCode"');
    expect(migration).toContain('"appointment_status_history_reason_code_check"');
    expect(migration).not.toMatch(/DROP COLUMN "reason"/);
  });

  it('database-binds transition keys to exact result shapes', () => {
    expect(migration).toContain('CREATE TABLE "appointment_transition_keys"');
    expect(migration).toContain('PRIMARY KEY ("actor_user_id", "key_hash")');
    expect(migration).toContain('"appointment_transition_keys_result_check"');
    expect(migration).toContain('"request_fingerprint" ~ \'^[0-9a-f]{64}$\'');
    expect(migration).toContain('FOREIGN KEY ("tenant_id", "replacement_appointment_id")');
  });
});
