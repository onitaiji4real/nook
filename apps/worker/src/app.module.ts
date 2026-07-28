import { Module } from '@nestjs/common';

import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { runtimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime-config.token';
import { MediaModule } from './modules/media/media.module';
import { BookingHoldExpiryModule } from './modules/booking-holds/booking-hold-expiry.module';
import { CustomerProjectionModule } from './modules/customer-projection/customer-projection.module';
import { NotificationModule } from './modules/notifications/notification.module';

@Module({
  imports: [MediaModule, BookingHoldExpiryModule, NotificationModule, CustomerProjectionModule],
  controllers: [HealthController],
  providers: [
    DatabaseProbeService,
    HealthService,
    { provide: RUNTIME_CONFIG, useValue: runtimeConfig },
  ],
})
export class AppModule {}
