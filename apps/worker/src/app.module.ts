import { Module } from '@nestjs/common';

import { DatabaseProbeService } from './database-probe.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MediaModule } from './modules/media/media.module';
import { BookingHoldExpiryModule } from './modules/booking-holds/booking-hold-expiry.module';
import { CustomerProjectionModule } from './modules/customer-projection/customer-projection.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { RuntimeConfigModule } from './runtime-config.module';

@Module({
  imports: [
    RuntimeConfigModule,
    MediaModule,
    BookingHoldExpiryModule,
    NotificationModule,
    CustomerProjectionModule,
  ],
  controllers: [HealthController],
  providers: [DatabaseProbeService, HealthService],
})
export class AppModule {}
