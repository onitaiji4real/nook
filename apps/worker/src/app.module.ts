import { Module } from '@nestjs/common';

import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { runtimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime-config.token';

@Module({
  controllers: [HealthController],
  providers: [
    DatabaseProbeService,
    HealthService,
    { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
  ],
})
export class AppModule {}
