import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaServiceCatalogRepository } from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { ServiceCatalogApplicationService } from './service-catalog-application.service';
import { SERVICE_CATALOG_REPOSITORY } from './service-catalog-repository.token';
import { ServiceCatalogController } from './service-catalog.controller';

@Module({
  imports: [PlatformCoreModule],
  controllers: [ServiceCatalogController],
  providers: [
    ServiceCatalogApplicationService,
    {
      provide: SERVICE_CATALOG_REPOSITORY,
      useFactory: () => new PrismaServiceCatalogRepository(getPrismaClient()),
    },
  ],
})
export class ServiceCatalogModule {}
