import { Module } from '@nestjs/common';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PlatformCoreModule],
  controllers: [HealthController],
  providers: [DatabaseProbeService, HealthService],
})
export class HealthModule {}
