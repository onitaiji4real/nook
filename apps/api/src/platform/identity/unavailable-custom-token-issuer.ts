import type { CustomTokenIssuer } from '@nook/auth';

export class UnavailableCustomTokenIssuer implements CustomTokenIssuer {
  issue(): Promise<never> {
    return Promise.reject(new Error('Identity token issuer is unavailable.'));
  }
}
