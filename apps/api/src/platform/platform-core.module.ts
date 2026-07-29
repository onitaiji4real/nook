import { Module } from '@nestjs/common';
import { CUSTOM_TOKEN_ISSUER, IDENTITY_TOKEN_VERIFIER } from '@nook/auth';
import { getPrismaClient, PrismaIdentityRepository, PrismaTenantRepository } from '@nook/database';

import { runtimeConfig } from './config/runtime-config';
import { RUNTIME_CONFIG } from './config/runtime-config.token';
import { AuthenticationGuard } from './identity/authentication.guard';
import { createFirebaseIdentityAdapter } from './identity/firebase-identity.adapter';
import { IDENTITY_REPOSITORY } from './identity/identity.tokens';
import { TENANT_REPOSITORY } from './identity/tenant-repository.token';
import { UnavailableCustomTokenIssuer } from './identity/unavailable-custom-token-issuer';
import { UnavailableIdentityTokenVerifier } from './identity/unavailable-identity-token-verifier';
import { UserAccessService } from './identity/user-access.service';

const firebaseAdapter =
  runtimeConfig.identity.mode === 'firebase'
    ? createFirebaseIdentityAdapter(runtimeConfig.identity)
    : undefined;

const exportedProviders = [
  AuthenticationGuard,
  UserAccessService,
  IDENTITY_TOKEN_VERIFIER,
  CUSTOM_TOKEN_ISSUER,
  IDENTITY_REPOSITORY,
  TENANT_REPOSITORY,
  RUNTIME_CONFIG,
] as const;

@Module({
  providers: [
    AuthenticationGuard,
    UserAccessService,
    {
      provide: IDENTITY_TOKEN_VERIFIER,
      useValue: firebaseAdapter ?? new UnavailableIdentityTokenVerifier(),
    },
    {
      provide: CUSTOM_TOKEN_ISSUER,
      useValue: firebaseAdapter ?? new UnavailableCustomTokenIssuer(),
    },
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: () => new PrismaIdentityRepository(getPrismaClient()),
    },
    {
      provide: TENANT_REPOSITORY,
      useFactory: () => new PrismaTenantRepository(getPrismaClient()),
    },
    { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
  ],
  exports: [...exportedProviders],
})
export class PlatformCoreModule {}
