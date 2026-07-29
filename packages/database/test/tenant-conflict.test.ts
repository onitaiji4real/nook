import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { classifyTenantConflict } from '../src';

function uniqueError(target: readonly string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.0',
    meta: { target },
  });
}

describe('classifyTenantConflict', () => {
  it('maps duplicate slugs to a stable conflict code', () => {
    expect(classifyTenantConflict(uniqueError(['slug']))).toBe('duplicate_slug');
  });

  it('maps duplicate memberships to a stable conflict code', () => {
    expect(classifyTenantConflict(uniqueError(['tenant_id', 'user_id']))).toBe(
      'duplicate_membership',
    );
  });
});
