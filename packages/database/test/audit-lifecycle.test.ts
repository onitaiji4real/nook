import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');

describe('audit lifecycle schema contract', () => {
  it('requires request IDs and restricts tenant deletion', () => {
    const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');

    expect(schema).toMatch(/requestId\s+String\s+@map\("request_id"\)/);
    expect(schema).toMatch(
      /tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Restrict\)/,
    );
  });

  it('keeps the contract migration safe for legacy rows', () => {
    const migration = readFileSync(
      resolve(
        packageRoot,
        'prisma/migrations/20260721170000_audit_lifecycle_contract/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(`SET "request_id" = 'legacy-' || "id"::text`);
    expect(migration).toContain('ALTER COLUMN "request_id" SET NOT NULL');
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"audit_logs"/i);
  });
});
