import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_TOKEN_VERIFIER,
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';

import { ApplicationError } from './application-error';
import type { RequestWithContext } from './request-context';
import { UserAccessService } from './user-access.service';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_TOKEN_VERIFIER) private readonly verifier: IdentityTokenVerifier,
    @Inject(UserAccessService) private readonly users: UserAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authorization = request.header('authorization');

    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      throw new ApplicationError(
        401,
        'authentication_required',
        'Unauthorized',
        'Authentication is required.',
      );
    }

    const token = authorization.slice('Bearer '.length);
    if (token.length === 0 || token.length > 4096) {
      throw new ApplicationError(
        401,
        'invalid_token',
        'Unauthorized',
        'The access token is invalid.',
      );
    }

    let principal: AuthenticatedPrincipal;
    try {
      principal = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof IdentityTokenVerificationError) {
        const status = error.code === 'verifier_unavailable' ? 503 : 401;
        const code =
          error.code === 'verifier_unavailable' ? 'identity_verifier_unavailable' : 'invalid_token';
        const title = status === 503 ? 'Service Unavailable' : 'Unauthorized';
        const detail =
          status === 503
            ? 'Authentication is temporarily unavailable.'
            : 'The access token is invalid.';
        throw new ApplicationError(status, code, title, detail);
      }

      throw new ApplicationError(
        503,
        'identity_verifier_unavailable',
        'Service Unavailable',
        'Authentication is temporarily unavailable.',
      );
    }

    await this.users.requireActive(principal.userId);
    request.principal = principal;
    return true;
  }
}
