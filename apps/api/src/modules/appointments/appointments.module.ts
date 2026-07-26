import { Module } from '@nestjs/common';
import {
  getPrismaClient,
  PrismaAppointmentConfirmationRepository,
  PrismaAppointmentLifecycleRepository,
  PrismaAppointmentViewRepository,
} from '@nook/database';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { AppointmentApplicationService } from './appointment-application.service';
import { AppointmentLifecycleApplicationService } from './appointment-lifecycle-application.service';
import { AppointmentLifecycleController } from './appointment-lifecycle.controller';
import { AppointmentViewApplicationService } from './appointment-view-application.service';
import { AppointmentViewController } from './appointment-view.controller';
import { AppointmentController } from './appointment.controller';
import {
  APPOINTMENT_CONFIRMATION_REPOSITORY,
  APPOINTMENT_LIFECYCLE_REPOSITORY,
  APPOINTMENT_VIEW_REPOSITORY,
} from './appointment.tokens';

@Module({
  imports: [PlatformCoreModule],
  controllers: [AppointmentController, AppointmentViewController, AppointmentLifecycleController],
  providers: [
    AppointmentApplicationService,
    AppointmentViewApplicationService,
    AppointmentLifecycleApplicationService,
    {
      provide: APPOINTMENT_CONFIRMATION_REPOSITORY,
      useFactory: () => new PrismaAppointmentConfirmationRepository(getPrismaClient()),
    },
    {
      provide: APPOINTMENT_VIEW_REPOSITORY,
      useFactory: () => new PrismaAppointmentViewRepository(getPrismaClient()),
    },
    {
      provide: APPOINTMENT_LIFECYCLE_REPOSITORY,
      useFactory: () => new PrismaAppointmentLifecycleRepository(getPrismaClient()),
    },
  ],
})
export class AppointmentsModule {}
