import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { getPrismaClient, PrismaCustomerReadRepository } from '@nook/database';

import { PlatformCoreModule } from '../../../platform/platform-core.module';
import { CustomerReadApplicationService } from './customer-read-application.service';
import { CustomerReadNoStoreMiddleware } from './customer-read-no-store.middleware';
import { CustomerReadController } from './customer-read.controller';
import { CUSTOMER_READ_REPOSITORY } from './customer-read.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [CustomerReadController],
  providers: [
    CustomerReadApplicationService,
    CustomerReadNoStoreMiddleware,
    {
      provide: CUSTOMER_READ_REPOSITORY,
      useFactory: () => new PrismaCustomerReadRepository(getPrismaClient()),
    },
  ],
})
export class CustomerReadModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CustomerReadNoStoreMiddleware).forRoutes(CustomerReadController);
  }
}
