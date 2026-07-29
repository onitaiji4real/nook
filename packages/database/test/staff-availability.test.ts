import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');

describe('staff availability schema contract', () => {
  it('enforces tenant-composite ownership for assignments and schedule data', () => {
    const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');

    expect(schema).toContain('model StaffProfile {');
    expect(schema).toContain('model StaffService {');
    expect(schema).toContain('model WeeklyAvailabilityRule {');
    expect(schema).toContain('model AvailabilityException {');
    expect(schema).toContain('@@id([tenantId, staffId, serviceId])');
    expect(schema).toMatch(
      /StaffProfile\s+@relation\(fields: \[tenantId, staffId\], references: \[tenantId, id\]/,
    );
  });

  it('backfills MAX_STAFF and one neutral staff without guessing weekly hours', () => {
    const migration = readFileSync(
      resolve(packageRoot, 'prisma/migrations/20260722030000_staff_availability/migration.sql'),
      'utf8',
    );

    expect(migration).toContain("'MAX_STAFF'");
    expect(migration).toContain("'1'::jsonb");
    expect(migration).toContain("'主要服務人員'");
    expect(migration).toMatch(/INSERT INTO "staff_services"[\s\S]*service\."status" = 'ACTIVE'/);
    expect(migration).not.toMatch(/INSERT INTO "weekly_availability_rules"/);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"(?:tenants|services|staff_profiles)"/i);
  });

  it('keeps inactive booking and weekly-overlap rules enforced below HTTP', () => {
    const repository = readFileSync(
      resolve(packageRoot, 'src/scheduling/staff-scheduling-repository.ts'),
      'utf8',
    );

    expect(repository).toContain("StaffSchedulingRepositoryError('inactive_staff_booking')");
    expect(repository).toContain('requireNonOverlappingWeeklyRules(input.rules)');
    expect(repository).toContain("StaffSchedulingRepositoryError('weekly_schedule_overlap')");
  });
});
