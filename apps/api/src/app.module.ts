import { Module } from '@nestjs/common';
import { CUSTOM_TOKEN_ISSUER, IDENTITY_TOKEN_VERIFIER } from '@nook/auth';
import { getPrismaClient, PrismaIdentityRepository, PrismaTenantRepository } from '@nook/database';
import { LineIdTokenVerifier } from '@nook/line';

import { AuthenticationGuard } from './authentication.guard';
import { DatabaseProbeService } from './database-probe.service';
import { createFirebaseIdentityAdapter } from './firebase-identity.adapter';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { IDENTITY_REPOSITORY, LINE_IDENTITY_VERIFIER } from './identity.tokens';
import { LineAuthApplicationService } from './line-auth-application.service';
import { LineAuthController } from './line-auth.controller';
import { runtimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime-config.token';
import { TenantApplicationService } from './tenant-application.service';
import { TenantController } from './tenant.controller';
import { TENANT_REPOSITORY } from './tenant-repository.token';
import { UnavailableCustomTokenIssuer } from './unavailable-custom-token-issuer';
import { UnavailableIdentityTokenVerifier } from './unavailable-identity-token-verifier';
import { UnavailableLineIdentityVerifier } from './unavailable-line-identity-verifier';

const firebaseAdapter =
  runtimeConfig.identity.mode === 'firebase'
    ? createFirebaseIdentityAdapter(runtimeConfig.identity)
    : undefined;
const lineVerifier =
  runtimeConfig.identity.mode === 'firebase'
    ? new LineIdTokenVerifier({ channelId: runtimeConfig.identity.lineChannelId })
    : new UnavailableLineIdentityVerifier();

@Module({
  controllers: [HealthController, LineAuthController, TenantController],
  providers: [
    AuthenticationGuard,
    DatabaseProbeService,
    HealthService,
    LineAuthApplicationService,
    TenantApplicationService,
    {
      provide: IDENTITY_TOKEN_VERIFIER,
      useValue: firebaseAdapter ?? new UnavailableIdentityTokenVerifier(),
    },
    {
      provide: CUSTOM_TOKEN_ISSUER,
      useValue: firebaseAdapter ?? new UnavailableCustomTokenIssuer(),
    },
    { provide: LINE_IDENTITY_VERIFIER, useValue: lineVerifier },
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: () => new PrismaIdentityRepository(getPrismaClient()),
    },
    { provide: TENANT_REPOSITORY, useFactory: () => new PrismaTenantRepository(getPrismaClient()) },
    { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
  ],
})
export class AppModule {}
