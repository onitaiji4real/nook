import { Inject, Injectable } from '@nestjs/common';
import type { IdentityRepository } from '@nook/database';

import { ApplicationError } from '../http/application-error';
import { IDENTITY_REPOSITORY } from './identity.tokens';

@Injectable()
export class UserAccessService {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository) {}

  async requireActive(userId: string): Promise<void> {
    let active: boolean;
    try {
      active = await this.identities.isActiveUser(userId);
    } catch {
      throw new ApplicationError(
        503,
        'user_status_unavailable',
        'Service Unavailable',
        'Account authorization is temporarily unavailable.',
      );
    }

    if (!active) {
      throw new ApplicationError(
        403,
        'account_inactive',
        'Forbidden',
        'This account is not active.',
      );
    }
  }
}
