import type { ExecutionContext } from '@nestjs/common';
import { IdentityTokenVerificationError, type IdentityTokenVerifier } from '@nook/auth';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/authentication.guard';
import type { RequestWithContext } from '../src/request-context';
import type { UserAccessService } from '../src/user-access.service';

function createContext(authorization = 'Bearer synthetic-token'): {
  readonly context: ExecutionContext;
  readonly request: RequestWithContext;
} {
  const request = {
    header: vi.fn((name: string) => (name === 'authorization' ? authorization : undefined)),
  } as unknown as RequestWithContext;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function createUsers(): {
  readonly service: UserAccessService;
  readonly requireActive: ReturnType<typeof vi.fn>;
} {
  const requireActive = vi.fn().mockResolvedValue(undefined);
  return {
    service: { requireActive } as unknown as UserAccessService,
    requireActive,
  };
}

describe('AuthenticationGuard', () => {
  it('attaches a verified active principal', async () => {
    const verifier: IdentityTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ userId: 'active-user' }),
    };
    const users = createUsers();
    const guard = new AuthenticationGuard(verifier, users.service);
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({ userId: 'active-user' });
    expect(users.requireActive).toHaveBeenCalledWith('active-user');
  });

  it.each([
    ['invalid_token', 401, 'invalid_token'],
    ['verifier_unavailable', 503, 'identity_verifier_unavailable'],
  ] as const)('maps %s to HTTP %s', async (verificationCode, status, applicationCode) => {
    const verifier: IdentityTokenVerifier = {
      verify: vi
        .fn()
        .mockRejectedValue(new IdentityTokenVerificationError(verificationCode, 'provider detail')),
    };
    const guard = new AuthenticationGuard(verifier, createUsers().service);

    await expect(guard.canActivate(createContext().context)).rejects.toMatchObject({
      status,
      code: applicationCode,
    });
  });

  it('fails closed as unavailable for an unknown verifier exception', async () => {
    const verifier: IdentityTokenVerifier = {
      verify: vi.fn().mockRejectedValue(new Error('provider detail')),
    };
    const guard = new AuthenticationGuard(verifier, createUsers().service);

    await expect(guard.canActivate(createContext().context)).rejects.toMatchObject({
      status: 503,
      code: 'identity_verifier_unavailable',
    });
  });
});
