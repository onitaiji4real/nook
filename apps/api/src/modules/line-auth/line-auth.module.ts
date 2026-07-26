import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaRateLimitRepository } from '@nook/database';
import { LineIdTokenVerifier } from '@nook/line';

import { runtimeConfig } from '../../platform/config/runtime-config';
import { LINE_IDENTITY_VERIFIER } from '../../platform/identity/identity.tokens';
import { UnavailableLineIdentityVerifier } from '../../platform/identity/unavailable-line-identity-verifier';
import { PlatformCoreModule } from '../../platform/platform-core.module';
import { LineAuthApplicationService } from './line-auth-application.service';
import { LineAuthRateLimitService } from './line-auth-rate-limit.service';
import { LineAuthController } from './line-auth.controller';
import { RATE_LIMIT_REPOSITORY } from './rate-limit.tokens';

const lineVerifier =
  runtimeConfig.identity.mode === 'firebase'
    ? new LineIdTokenVerifier({ channelId: runtimeConfig.identity.lineChannelId })
    : new UnavailableLineIdentityVerifier();

@Module({
  imports: [PlatformCoreModule],
  controllers: [LineAuthController],
  providers: [
    LineAuthApplicationService,
    LineAuthRateLimitService,
    { provide: LINE_IDENTITY_VERIFIER, useValue: lineVerifier },
    {
      provide: RATE_LIMIT_REPOSITORY,
      useFactory: () => new PrismaRateLimitRepository(getPrismaClient()),
    },
  ],
})
export class LineAuthModule {}
