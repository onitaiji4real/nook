import { Module } from '@nestjs/common';
import { IDENTITY_TOKEN_VERIFIER } from '@nook/auth';
import { getPrismaClient, PrismaTenantRepository } from '@nook/database';

import { AuthenticationGuard } from './authentication.guard';
import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { runtimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime-config.token';
import { TenantApplicationService } from './tenant-application.service';
import { TenantController } from './tenant.controller';
import { TENANT_REPOSITORY } from './tenant-repository.token';
import { UnavailableIdentityTokenVerifier } from './unavailable-identity-token-verifier';

@Module({
  controllers: [HealthController, TenantController],
  providers: [
    AuthenticationGuard,
    DatabaseProbeService,
    HealthService,
    TenantApplicationService,
    { provide: IDENTITY_TOKEN_VERIFIER, useClass: UnavailableIdentityTokenVerifier },
    { provide: TENANT_REPOSITORY, useFactory: () => new PrismaTenantRepository(getPrismaClient()) },
    { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
  ],
})
export class AppModule {}
