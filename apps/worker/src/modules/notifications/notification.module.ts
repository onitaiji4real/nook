import { Module } from '@nestjs/common';
import {
  getPrismaClient,
  PrismaLineWebhookRepository,
  PrismaNotificationDeliveryRepository,
  PrismaNotificationDispatchRepository,
  PrismaNotificationProjectionRepository,
} from '@nook/database';
import { LinePushClient } from '@nook/line';

import { runtimeConfig } from '../../runtime-config';
import { NotificationDispatchController } from './notification-dispatch.controller';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationDeliveryController } from './notification-delivery.controller';
import { NotificationDeliveryService } from './notification-delivery.service';
import { GcpNotificationTaskGateway, type NotificationTaskGateway } from './notification-task-gateway';
import {
  LINE_WEBHOOK_REPOSITORY,
  LINE_PUSH_CLIENT,
  NOTIFICATION_DELIVERY_REPOSITORY,
  NOTIFICATION_DISPATCH_REPOSITORY,
  NOTIFICATION_PROJECTION_REPOSITORY,
  NOTIFICATION_TASK_GATEWAY,
} from './notification.tokens';

const disabledTaskGateway: NotificationTaskGateway = {
  enqueue: () => Promise.reject(new Error('notification_dispatch_disabled')),
};

@Module({
  controllers: [NotificationDispatchController, NotificationDeliveryController],
  providers: [
    NotificationDispatchService,
    NotificationDeliveryService,
    {
      provide: NOTIFICATION_PROJECTION_REPOSITORY,
      useFactory: () => new PrismaNotificationProjectionRepository(getPrismaClient()),
    },
    {
      provide: NOTIFICATION_DISPATCH_REPOSITORY,
      useFactory: () => new PrismaNotificationDispatchRepository(getPrismaClient()),
    },
    {
      provide: LINE_WEBHOOK_REPOSITORY,
      useFactory: () => new PrismaLineWebhookRepository(getPrismaClient()),
    },
    {
      provide: NOTIFICATION_DELIVERY_REPOSITORY,
      useFactory: () => new PrismaNotificationDeliveryRepository(getPrismaClient()),
    },
    {
      provide: LINE_PUSH_CLIENT,
      useFactory: () =>
        runtimeConfig.notification.mode === 'line_push' &&
        runtimeConfig.notification.service === 'worker'
          ? new LinePushClient({ accessToken: runtimeConfig.notification.accessToken })
          : { send: () => Promise.reject(new Error('notification_dispatch_disabled')) },
    },
    {
      provide: NOTIFICATION_TASK_GATEWAY,
      useFactory: (): NotificationTaskGateway =>
        runtimeConfig.notification.mode === 'line_push' &&
        runtimeConfig.notification.service === 'worker'
          ? new GcpNotificationTaskGateway(runtimeConfig.notification)
          : disabledTaskGateway,
    },
  ],
})
export class NotificationModule {}
