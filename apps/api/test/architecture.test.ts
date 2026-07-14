import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('tenant slice architecture', () => {
  it('keeps Prisma out of HTTP controllers', () => {
    const controller = readFileSync(resolve(process.cwd(), 'src/tenant.controller.ts'), 'utf8');
    expect(controller).not.toContain('@prisma/client');
    expect(controller).not.toMatch(/\bPrisma(?:Client)?\b/);
  });

  it('requires tenantId in tenant-owned repository methods', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/tenant-repository.ts'),
      'utf8',
    );
    expect(repository).toMatch(/findActiveTenantMembership\(input: \{[\s\S]*?tenantId: string/);
    expect(repository).toMatch(
      /recordAuthorizationDeniedIfTenantExists\(input: \{[\s\S]*?tenantId: string/,
    );
  });
});
