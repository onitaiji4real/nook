import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaLineWebhookRepository } from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { LineWebhookApplicationService } from './line-webhook-application.service';
import { LineWebhookController } from './line-webhook.controller';
import { LINE_WEBHOOK_REPOSITORY } from './line-webhook.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [LineWebhookController],
  providers: [
    LineWebhookApplicationService,
    {
      provide: LINE_WEBHOOK_REPOSITORY,
      useFactory: () => new PrismaLineWebhookRepository(getPrismaClient()),
    },
  ],
})
export class LineWebhookModule {}
