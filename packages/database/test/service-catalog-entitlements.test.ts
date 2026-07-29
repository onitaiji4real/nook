import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');

describe('service catalog entitlement schema contract', () => {
  it('models generic plan entitlement mappings and stable service ordering', () => {
    const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');

    expect(schema).toContain('model Plan {');
    expect(schema).toContain('model Entitlement {');
    expect(schema).toContain('model PlanEntitlement {');
    expect(schema).toMatch(/sortOrder\s+Int\s+@default\(0\) @map\("sort_order"\)/);
    expect(schema).toContain('@@index([tenantId, sortOrder, id], map: "services_tenant_sort_idx")');
  });

  it('backfills a default plan and MAX_SERVICES without deleting legacy data', () => {
    const migration = readFileSync(
      resolve(
        packageRoot,
        'prisma/migrations/20260722020000_service_catalog_entitlements/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain("'MAX_SERVICES'");
    expect(migration).toContain("'5'::jsonb");
    expect(migration).toMatch(/UPDATE "tenants"[\s\S]*WHERE "plan_id" IS NULL/);
    expect(migration).toContain('PARTITION BY "tenant_id"');
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"(?:tenants|services)"/i);
  });
});
