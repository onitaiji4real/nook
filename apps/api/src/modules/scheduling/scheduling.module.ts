import { Module } from '@nestjs/common';
import { getPrismaClient, PrismaStaffSchedulingRepository } from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { StaffSchedulingApplicationService } from './staff-scheduling-application.service';
import { StaffSchedulingController } from './staff-scheduling.controller';
import { STAFF_SCHEDULING_REPOSITORY } from './staff-scheduling-repository.token';

@Module({
  imports: [PlatformCoreModule],
  controllers: [StaffSchedulingController],
  providers: [
    StaffSchedulingApplicationService,
    {
      provide: STAFF_SCHEDULING_REPOSITORY,
      useFactory: () => new PrismaStaffSchedulingRepository(getPrismaClient()),
    },
  ],
})
export class SchedulingModule {}
