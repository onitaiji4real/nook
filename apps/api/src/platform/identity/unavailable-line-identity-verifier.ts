import { LineVerificationError, type LineIdentityVerifier } from '@nook/line';

export class UnavailableLineIdentityVerifier implements LineIdentityVerifier {
  verify(): Promise<never> {
    return Promise.reject(new LineVerificationError('provider_unavailable'));
  }
}
