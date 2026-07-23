import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');

describe('portfolio media schema contract', () => {
  it('models tenant-composite portfolio ownership and a private media lifecycle', () => {
    const schema = readFileSync(resolve(packageRoot, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('model PortfolioItem {');
    expect(schema).toContain('model MediaAsset {');
    expect(schema).toContain('@@unique([tenantId, ownerId], map: "media_assets_tenant_owner_key")');
    expect(schema).toMatch(/owner\s+PortfolioItem\s+@relation\(fields: \[tenantId, ownerId\]/);
    expect(schema).toContain('uploadExpiresAt');
  });

  it('adds bounded image checks and MAX_PORTFOLIO_IMAGES without destructive statements', () => {
    const migration = readFileSync(
      resolve(
        packageRoot,
        'prisma/migrations/20260722040000_portfolio_controlled_upload/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain("'MAX_PORTFOLIO_IMAGES'");
    expect(migration).toContain("'20'::jsonb");
    expect(migration).toContain('"declared_byte_size" BETWEEN 1 AND 15728640');
    expect(migration).toContain('"mime_type" = \'image/webp\'');
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
  });
});
