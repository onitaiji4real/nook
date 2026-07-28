import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaCustomerProjectionRepository } from '@nook/database';

import { CustomerProjectionController } from './customer-projection.controller';
import { CustomerProjectionService } from './customer-projection.service';
import { CUSTOMER_PROJECTION_REPOSITORY } from './customer-projection.tokens';

@Module({
  controllers: [CustomerProjectionController],
  providers: [
    CustomerProjectionService,
    {
      provide: CUSTOMER_PROJECTION_REPOSITORY,
      useFactory: () => new PrismaCustomerProjectionRepository(getPrismaClient()),
    },
  ],
})
export class CustomerProjectionModule {}
