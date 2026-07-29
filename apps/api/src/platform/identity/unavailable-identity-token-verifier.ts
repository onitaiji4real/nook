import {
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type IdentityTokenVerifier,
} from '@nook/auth';

export class UnavailableIdentityTokenVerifier implements IdentityTokenVerifier {
  verify(): Promise<AuthenticatedPrincipal> {
    return Promise.reject(
      new IdentityTokenVerificationError(
        'verifier_unavailable',
        'The identity token verifier is not configured.',
      ),
    );
  }
}
