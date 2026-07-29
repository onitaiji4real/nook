import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { getPrismaClient, PrismaCustomerTagRepository } from '@nook/database';

import { PlatformCoreModule } from '../../../platform/platform-core.module';
import { CustomerTagsApplicationService } from './customer-tags-application.service';
import { CustomerTagsNoStoreMiddleware } from './customer-tags-no-store.middleware';
import { CustomerTagsController } from './customer-tags.controller';
import { CUSTOMER_TAG_REPOSITORY } from './customer-tags.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [CustomerTagsController],
  providers: [
    CustomerTagsApplicationService,
    CustomerTagsNoStoreMiddleware,
    {
      provide: CUSTOMER_TAG_REPOSITORY,
      useFactory: () => new PrismaCustomerTagRepository(getPrismaClient()),
    },
  ],
})
export class CustomerTagsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CustomerTagsNoStoreMiddleware).forRoutes(CustomerTagsController);
  }
}
