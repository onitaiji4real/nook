import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('notification migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260723020000_notifications_line/migration.sql'),
    'utf8',
  );

  it('binds jobs to tenant-owned appointments and source events', () => {
    expect(migration).toContain('CREATE TABLE "notification_jobs"');
    expect(migration).toContain('FOREIGN KEY ("tenant_id", "consumer_user_id", "appointment_id")');
    expect(migration).toContain('FOREIGN KEY ("tenant_id", "source_outbox_event_id")');
    expect(migration).toContain('"notification_jobs_dedupe_check"');
    expect(migration).toContain('"delivery_attempt_count" BETWEEN 0 AND 10');
  });

  it('models truthful STARTED and AMBIGUOUS attempt evidence', () => {
    expect(migration).toContain("'STARTED'");
    expect(migration).toContain("'AMBIGUOUS'");
    expect(migration).toContain('"notification_deliveries_completion_check"');
    expect(migration).toContain('"attempt_number" BETWEEN 1 AND 10');
    expect(migration).toContain('"outcome" = \'ACCEPTED\' AND "provider_http_status" = 200');
    expect(migration).toContain('"outcome" = \'REPLAYED\' AND "provider_http_status" = 409');
  });

  it('protects recipient ordering evidence and bounded webhook retention', () => {
    expect(migration).toContain('"provider_subject" ~ \'^U[0-9a-f]{32}$\'');
    expect(migration).toContain('"observed_webhook_event_id" VARCHAR(128) NOT NULL');
    expect(migration).toContain('"line_webhook_events_webhook_event_id_key"');
    expect(migration).toContain('"line_webhook_events_retention_idx"');
    expect(migration).toContain('"received_at", "id"');
  });

  it('adds a bounded generic reminder entitlement without plan-name branching', () => {
    expect(migration).toContain("'APPOINTMENT_REMINDER_COUNT'");
    expect(migration).toContain('FROM "plans"');
    expect(migration).toContain('"plan_entitlements_reminder_count_check"');
    expect(migration).toContain("(\"value_json\" #>> '{}') ~ '^[0-2]$'");
    expect(migration).not.toMatch(/'FREE_EXPOSURE'|'BASIC'|'PRO'|'PREMIUM'/);
  });
});
