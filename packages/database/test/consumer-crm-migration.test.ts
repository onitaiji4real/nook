import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('consumer CRM expand migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260728010000_consumer_crm_expand/migration.sql'),
    'utf8',
  );

  it('keeps customer projection independent from the shared outbox status', () => {
    expect(migration).toContain('CREATE TABLE "crm_projection_deliveries"');
    expect(migration).toContain('"crm_projection_deliveries_projector_event_key"');
    expect(migration).toContain('CREATE TABLE "crm_projection_streams"');
    expect(migration).toContain('"crm_projection_streams_state_check"');
    expect(migration).toContain('FOREIGN KEY ("tenant_id", "outbox_event_id")');
    expect(migration).not.toMatch(/ALTER TABLE "outbox_events".*(status|attempt_count)/s);
  });

  it('tenant-scopes customers, notes, tags, and export ownership', () => {
    expect(migration).toContain('"customers_tenant_consumer_key"');
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "requested_by_membership_id") REFERENCES "memberships"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("tenant_id", "tag_id") REFERENCES "customer_tag_definitions"',
    );
    expect(migration).toContain('"customer_notes_envelope_check"');
  });

  it('stores versioned consent evidence and current-safe command replay', () => {
    expect(migration).toContain('CREATE TABLE "consumer_consent_streams"');
    expect(migration).toContain('CREATE TABLE "consumer_consent_commands"');
    expect(migration).toContain('CREATE TABLE "consumer_consent_events"');
    expect(migration).toContain('"consumer_consent_commands_stream_key"');
    expect(migration).toContain('"consumer_consent_events_stream_revision_key"');
    expect(migration).toContain('"consumer_consent_events_evidence_check"');
    expect(migration).toContain('"consent_documents_active_purpose_key"');
  });

  it('hard-bounds export state without mutating unrelated Phase 2 and 3 tables', () => {
    expect(migration).toContain('"customer_export_jobs_attempt_check"');
    expect(migration).toContain('"customer_count" BETWEEN 0 AND 10000');
    expect(migration).toContain('"note_count" BETWEEN 0 AND 50000');
    expect(migration).toContain('"tag_link_count" BETWEEN 0 AND 100000');
    expect(migration).toContain('"uncompressed_bytes" BETWEEN 0 AND 209715200');
    expect(migration).toContain('"compressed_bytes" BETWEEN 0 AND 52428800');
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN|CONSTRAINT)/);
    expect(migration).not.toContain('-- RenameForeignKey');
  });
});
