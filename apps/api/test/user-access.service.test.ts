import type { IdentityRepository } from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { UserAccessService } from '../src/user-access.service';

function createRepository(active: boolean): IdentityRepository {
  return {
    findOrCreateLineIdentity: vi.fn(),
    linkLineMessagingRecipient: vi.fn(),
    isActiveUser: vi.fn().mockResolvedValue(active),
  };
}

describe('UserAccessService', () => {
  it('allows an active local user', async () => {
    const service = new UserAccessService(createRepository(true));
    await expect(service.requireActive('active-user')).resolves.toBeUndefined();
  });

  it('returns a stable forbidden error for inactive or missing users', async () => {
    const service = new UserAccessService(createRepository(false));
    await expect(service.requireActive('inactive-user')).rejects.toMatchObject({
      status: 403,
      code: 'account_inactive',
    });
  });

  it('fails closed when local user status cannot be read', async () => {
    const identities: IdentityRepository = {
      findOrCreateLineIdentity: vi.fn(),
      linkLineMessagingRecipient: vi.fn(),
      isActiveUser: vi.fn().mockRejectedValue(new Error('database detail')),
    };
    const service = new UserAccessService(identities);

    await expect(service.requireActive('unknown-user')).rejects.toMatchObject({
      status: 503,
      code: 'user_status_unavailable',
    });
  });
});
