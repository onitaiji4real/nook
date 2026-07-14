import { Inject, Injectable } from '@nestjs/common';
import { CUSTOM_TOKEN_ISSUER, type CustomTokenIssuer } from '@nook/auth';
import type { LineExchangeResponse } from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import type { IdentityRepository } from '@nook/database';
import { LineVerificationError, type LineIdentityVerifier } from '@nook/line';
import { redactValue } from '@nook/observability';

import { ApplicationError } from './application-error';
import { IDENTITY_REPOSITORY, LINE_IDENTITY_VERIFIER } from './identity.tokens';
import { RUNTIME_CONFIG } from './runtime-config.token';

@Injectable()
export class LineAuthApplicationService {
  constructor(
    @Inject(LINE_IDENTITY_VERIFIER) private readonly verifier: LineIdentityVerifier,
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(CUSTOM_TOKEN_ISSUER) private readonly issuer: CustomTokenIssuer,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async exchange(idToken: string, nonce: string, requestId: string): Promise<LineExchangeResponse> {
    const startedAt = performance.now();
    try {
      const identity = await this.verifier.verify(idToken, nonce);
      const user = await this.identities.findOrCreateLineIdentity(identity);
      const token = await this.issuer.issue(user.userId);
      this.log(requestId, 'success', startedAt);
      return token;
    } catch (error) {
      this.log(requestId, 'failure', startedAt);
      if (error instanceof LineVerificationError) {
        if (error.code === 'provider_timeout' || error.code === 'provider_unavailable') {
          throw new ApplicationError(
            503,
            error.code === 'provider_timeout'
              ? 'line_provider_timeout'
              : 'line_provider_unavailable',
            'Service Unavailable',
            'LINE authentication is temporarily unavailable.',
          );
        }
        throw new ApplicationError(
          401,
          error.code,
          'Unauthorized',
          'The LINE identity token is invalid.',
        );
      }
      throw new ApplicationError(
        503,
        'identity_exchange_unavailable',
        'Service Unavailable',
        'Identity exchange is temporarily unavailable.',
      );
    }
  }

  private log(requestId: string, outcome: 'success' | 'failure', startedAt: number): void {
    const entry = {
      severity: outcome === 'success' ? 'INFO' : 'WARNING',
      service: 'api',
      version: this.config.appVersion,
      environment: this.config.nodeEnv,
      operation: 'auth.line.exchange',
      requestId,
      outcome,
      providerLatencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
    process.stdout.write(`${JSON.stringify(redactValue(entry))}\n`);
  }
}
