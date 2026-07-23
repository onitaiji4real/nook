import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('notification projection repository contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/notification-projection-repository.ts'),
    'utf8',
  );

  it('claims one due appointment event with SKIP LOCKED and a bounded caller contract', () => {
    expect(source).toContain('FOR UPDATE SKIP LOCKED');
    expect(source).toContain('LIMIT 1');
    expect(source).toContain('candidate."available_at" <= transaction_timestamp()');
    expect(source).toContain("candidate.\"aggregate_type\" = 'appointment'");
    expect(source).toContain('AND NOT EXISTS (');
    expect(source).toContain('earlier."aggregate_id" = candidate."aggregate_id"');
  });

  it('rolls corrupt projections back to a savepoint before terminal failure', () => {
    expect(source).toContain('SAVEPOINT notification_projection');
    expect(source).toContain('ROLLBACK TO SAVEPOINT notification_projection');
    expect(source).toContain("status: 'FAILED'");
  });

  it('uses event time for results and exact appointment-relative reminder times', () => {
    expect(source).toContain('templateKey, event.createdAt');
    expect(source).toContain('24 * 60 * 60 * 1_000');
    expect(source).toContain('2 * 60 * 60 * 1_000');
    expect(source).toContain('dueAt.getTime() > dbNow.getTime()');
  });

  it('uses a generic bounded entitlement and exact notification dedupe identity', () => {
    expect(source).toContain("entitlementCode: 'APPOINTMENT_REMINDER_COUNT'");
    expect(source).toContain('value > 2');
    expect(source).toContain('`notification:${templateKey}:${appointment.id}`');
  });

  it('revalidates an exact winner after a skipped concurrent insert', () => {
    expect(source).toContain('if (result.count === 0)');
    expect(source).toContain('validateJobShape(winner, spec)');
  });
});
