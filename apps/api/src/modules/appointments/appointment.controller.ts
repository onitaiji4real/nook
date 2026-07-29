import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { appointmentIdempotencyKeySchema, type AppointmentResponse } from '@nook/contracts';

import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';
import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { AppointmentApplicationService } from './appointment-application.service';

@Controller('v1/appointments')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class AppointmentController {
  constructor(
    @Inject(AppointmentApplicationService)
    private readonly service: AppointmentApplicationService,
  ) {}

  @Post()
  create(
    @Req() request: RequestWithContext,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
    @Body() body: unknown,
  ): Promise<AppointmentResponse> {
    const key = appointmentIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!key.success)
      throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
    return this.service.create({
      consumerUserId: requirePrincipal(request).userId,
      idempotencyKey: key.data,
      requestId: requireRequestId(request),
      body,
    });
  }
}
