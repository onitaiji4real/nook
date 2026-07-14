export type MembershipRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';

export interface AuthorizationContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly MembershipRole[];
}

export interface AuthenticatedPrincipal {
  readonly userId: string;
}

export interface IdentityTokenVerifier {
  verify(token: string): Promise<AuthenticatedPrincipal>;
}

export const IDENTITY_TOKEN_VERIFIER = Symbol('IDENTITY_TOKEN_VERIFIER');

export class IdentityTokenVerificationError extends Error {
  constructor(
    readonly code: 'invalid_token' | 'verifier_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'IdentityTokenVerificationError';
  }
}
