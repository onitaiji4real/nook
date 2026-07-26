import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  IdentityTokenVerificationError,
  type AuthenticatedPrincipal,
  type CustomTokenIssuer,
  type IdentityTokenVerifier,
} from '@nook/auth';
import type { RuntimeConfig } from '@nook/config';

interface FirebaseAuthClient {
  createCustomToken(uid: string): Promise<string>;
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<{ readonly uid: string }>;
}

const rejectedTokenCodes = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-argument',
  'auth/invalid-id-token',
  'auth/tenant-id-mismatch',
  'auth/user-disabled',
  'auth/user-not-found',
]);

export class FirebaseIdentityAdapter implements CustomTokenIssuer, IdentityTokenVerifier {
  constructor(private readonly auth: FirebaseAuthClient) {}

  async issue(
    userId: string,
  ): Promise<{ readonly customToken: string; readonly expiresIn: number }> {
    return { customToken: await this.auth.createCustomToken(userId), expiresIn: 3_600 };
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    try {
      const decoded = await this.auth.verifyIdToken(token, true);
      return { userId: decoded.uid };
    } catch (error) {
      const code = readFirebaseErrorCode(error);
      if (code !== undefined && rejectedTokenCodes.has(code)) {
        throw new IdentityTokenVerificationError('invalid_token', 'Identity token rejected.');
      }

      throw new IdentityTokenVerificationError(
        'verifier_unavailable',
        'Identity verification is unavailable.',
      );
    }
  }
}

function readFirebaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

export function createFirebaseIdentityAdapter(
  config: Extract<RuntimeConfig['identity'], { readonly mode: 'firebase' }>,
): FirebaseIdentityAdapter {
  const existing = getApps().find((app) => app.name === 'nook-api');
  const app =
    existing ??
    initializeApp(
      {
        credential: applicationDefault(),
        projectId: config.firebaseProjectId,
        ...(config.firebaseServiceAccountId === undefined
          ? {}
          : { serviceAccountId: config.firebaseServiceAccountId }),
      },
      'nook-api',
    );
  return new FirebaseIdentityAdapter(getAuth(app));
}
