import { Module } from '@nestjs/common';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { TenantApplicationService } from './tenant-application.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [PlatformCoreModule],
  controllers: [TenantController],
  providers: [TenantApplicationService],
})
export class TenancyModule {}
